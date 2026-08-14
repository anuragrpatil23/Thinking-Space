import type {
  ActivityChain,
  ParsedSession,
} from '@/services/lego_blocks/units/aiActivityParserBlock'
import { readNativeAiSession } from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getAiInputBudgetTokens } from '@/services/lego_blocks/units/storageKeyBlock'

// Shared chain-context extraction.
//
// Old shape (removed): split into intro user turns + assistant "recap" turns
// picked via a summary-phrase regex. That heuristic missed ~95% of real
// wrap-up turns on tool-heavy sessions and ~93% on talk-heavy sessions —
// eyeballed across TS / F9 / sfpi chains — so it was a signal-remover
// disguised as a signal-picker.
//
// New shape: return every substantive turn in original conversation order,
// each head+tail'd to a tight per-turn budget. Two levers per role:
//   - filter noise (slash-commands, tool_results, mid-loop stubs,
//     skill-docs dumps, trailing "Want me to…" conversational tails)
//   - head+tail with sentence-boundary snap on turns above a threshold
// Budgets: ~5K tokens across TS/F9 (tiny signal fits without truncation),
// ~5K tokens on deep ideation chains like sfpi (per-turn truncation kicks
// in). See empirical eval in tmp/extract_v2.py which was the design proto.

// Per-turn budgets, as originally tuned. They are no longer used directly:
// they define the SHAPE, and are scaled by the user's input budget so the
// relative head/tail proportions survive when the budget moves.
const USER_HEAD_CHARS = 300
const USER_TAIL_CHARS = 200
const USER_TRUNCATE_ABOVE = 600

const ASST_HEAD_CHARS = 250
const ASST_TAIL_CHARS = 200
const ASST_TRUNCATE_ABOVE = 600

/** Token budget the constants above were empirically tuned against. */
const TUNED_FOR_TOKENS = 5_000
/** Rough chars-per-token; matches estimateTokensBlock. */
const CHARS_PER_TOKEN = 4

interface TurnBudgets {
  userHead: number; userTail: number; userAbove: number
  asstHead: number; asstTail: number; asstAbove: number
}

function turnBudgetsFor(budgetTokens: number): TurnBudgets {
  const scale = Math.max(0.2, budgetTokens / TUNED_FOR_TOKENS)
  const r = (n: number) => Math.round(n * scale)
  return {
    userHead: r(USER_HEAD_CHARS), userTail: r(USER_TAIL_CHARS), userAbove: r(USER_TRUNCATE_ABOVE),
    asstHead: r(ASST_HEAD_CHARS), asstTail: r(ASST_TAIL_CHARS), asstAbove: r(ASST_TRUNCATE_ABOVE),
  }
}

/** Enforce the TOTAL budget, which per-turn trimming alone never did — a
 *  chain with hundreds of turns could blow far past it. Drops from the middle
 *  outward: the opening turns say what the session set out to do and the
 *  closing ones say how it ended, so the middle is the cheapest thing to
 *  lose. Returns the kept turns and how many were dropped. */
function fitToBudgetBlock(
  turns: ExtractedTurnBlock[],
  budgetTokens: number,
): { turns: ExtractedTurnBlock[]; dropped: number } {
  const budgetChars = budgetTokens * CHARS_PER_TOKEN
  let total = turns.reduce((n, t) => n + t.text.length, 0)
  if (total <= budgetChars) return { turns, dropped: 0 }

  const kept = [...turns]
  let dropped = 0
  // Always keep at least the first and last turn, whatever the budget.
  while (total > budgetChars && kept.length > 2) {
    const mid = Math.floor(kept.length / 2)
    total -= kept[mid].text.length
    kept.splice(mid, 1)
    dropped += 1
  }
  return { turns: kept, dropped }
}
/** Below this, the "prose" left after tool_use JSON is stripped is a
 *  mid-loop stub (e.g. "Now add the sort handler:") — pure noise. */
const ASST_MIN_PROSE_CHARS = 300

const SENTENCE_SNAP_WINDOW = 80

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const LOCAL_CMD_WRAPPER_RE = /^<(local-command-caveat|command-name|command-message|local-command-stdout)/
const CLEAR_CMD_RE = /<command-name>\s*\/clear/i
const SKILL_DOCS_PREFIX = 'Base directory for this skill:'
const SKILL_DOCS_ARGUMENTS_RE = /^ARGUMENTS:\s*([\s\S]*)$/m
const TRAILING_QUESTION_RE =
  /\n+(?:Want me to|Want you to|Want to|Would you like|Should I|Shall I)[^\n?]{5,240}\?\s*$/i

export interface ExtractedTurnBlock {
  role: 'user' | 'assistant'
  text: string
  /** Sequence position across the chain, useful for stable rendering. */
  order: number
}

export interface ChainContextMetaBlock {
  /** Substantive turns kept after filtering. */
  turnCount: number
  /** Every tool_use invocation across the chain — including turns we
   *  didn't keep (mid-loop stubs still count for shape). */
  toolCallCount: number
  /** User invoked `/clear` at least once — chain grew across topic hops. */
  hadClear: boolean
  /** At least one turn was head+tail'd — flagged so the prompt can note
   *  that `[…Nc omitted…]` markers may appear. */
  hadTruncation: boolean
  /** Whole turns dropped from the middle to fit the input budget. */
  droppedTurns: number
}

export interface ChainContextBlock {
  turns: ExtractedTurnBlock[]
  meta: ChainContextMetaBlock
}

// ── flatten + parse helpers ──────────────────────────────────────────────

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text)
  }
  return parts.join('\n')
}

function containsOnlyToolResults(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false
  for (const part of content) {
    if (!part || typeof part !== 'object') return false
    const p = part as Record<string, unknown>
    if (p.type !== 'tool_result') return false
  }
  return true
}

function countToolUses(content: unknown): number {
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if ((part as Record<string, unknown>).type === 'tool_use') n += 1
  }
  return n
}

// ── per-role filters ─────────────────────────────────────────────────────

function filterUserText(text: string): string | null {
  const clean = text
    .replace(SYSTEM_REMINDER_RE, '')
    .trim()
    .replace(/^-+/, '')
    .trim()
  if (!clean) return null
  if (clean.startsWith('[tool_result]')) return null
  if (LOCAL_CMD_WRAPPER_RE.test(clean)) return null
  if (clean.startsWith(SKILL_DOCS_PREFIX)) {
    // Skill invocations dump the entire skill readme into the transcript;
    // the real user intent is the trailing `ARGUMENTS: …` block. Keep that,
    // drop the docs body.
    const match = SKILL_DOCS_ARGUMENTS_RE.exec(clean)
    if (!match) return null
    return `ARGUMENTS: ${match[1].trim()}`
  }
  return clean
}

function filterAssistantText(text: string): string | null {
  const stripped = text.replace(TRAILING_QUESTION_RE, '').trim()
  if (stripped.length < ASST_MIN_PROSE_CHARS) return null
  return stripped
}

// ── head + tail with sentence-boundary snap ──────────────────────────────

function snapToSentence(text: string, pos: number): number {
  const lo = Math.max(0, pos - SENTENCE_SNAP_WINDOW)
  const hi = Math.min(text.length, pos + SENTENCE_SNAP_WINDOW)
  const slice = text.slice(lo, hi)
  const marks: number[] = []
  const re = /(\.\s|\n\n|\?\s|!\s)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(slice)) !== null) marks.push(m.index + m[0].length)
  if (marks.length === 0) return pos
  const target = pos - lo
  let best = marks[0]
  let bestDist = Math.abs(marks[0] - target)
  for (let i = 1; i < marks.length; i += 1) {
    const d = Math.abs(marks[i] - target)
    if (d < bestDist) {
      best = marks[i]
      bestDist = d
    }
  }
  return lo + best
}

function headTail(body: string, head: number, tail: number, above: number): {
  text: string
  truncated: boolean
} {
  if (body.length <= above || body.length <= head + tail + 100) {
    return { text: body, truncated: false }
  }
  const hEnd = snapToSentence(body, head)
  const tStart = snapToSentence(body, body.length - tail)
  if (tStart <= hEnd) return { text: body, truncated: false }
  const omitted = tStart - hEnd
  return {
    text: `${body.slice(0, hEnd).trimEnd()}\n[…${omitted}c omitted…]\n${body
      .slice(tStart)
      .trimStart()}`,
    truncated: true,
  }
}

// ── chat-export (ChatGPT / Grok) markdown transcripts ────────────────────
// No native JSONL exists for web chats — the transcript lives in the vault
// markdown as `## User` / `## Assistant` blocks, each followed by a
// `*YYYY-MM-DD HH:MM[ | model: …]*` timestamp line and then the body. We clip
// to the sitting's [startedIso, endedIso] window so a conversation's several
// `#wN` slices don't bleed into one another, then run the same per-role
// filter + head/tail pipeline the native path uses.

const CHAT_EXPORT_TURN_HEADER_RE =
  /^## (User|Assistant)[ \t]*\r?\n\*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})[^\n]*\*[ \t]*$/gm

/**
 * Parse a chat-export markdown transcript and append its in-window turns to
 * `turns`, mutating `meta` as it goes. Returns the advanced `order` counter so
 * the chain's global turn sequence stays continuous across sessions.
 */
function emitChatExportTurnsBlock(
  md: string,
  session: ParsedSession,
  startOrder: number,
  turns: ExtractedTurnBlock[],
  meta: ChainContextMetaBlock,
  budgets: TurnBudgets,
): number {
  let order = startOrder

  // Skip frontmatter so header offsets line up with the body.
  let body = md
  if (body.startsWith('---')) {
    const fmEnd = body.indexOf('\n---', 3)
    if (fmEnd !== -1) body = body.slice(fmEnd + 4)
  }

  const windowStart = Date.parse(session.startedIso)
  const windowEnd = Date.parse(session.endedIso ?? session.startedIso)

  const headers: Array<{
    role: 'user' | 'assistant'
    ts: number
    headerStart: number
    bodyStart: number
  }> = []
  CHAT_EXPORT_TURN_HEADER_RE.lastIndex = 0
  for (let m = CHAT_EXPORT_TURN_HEADER_RE.exec(body); m; m = CHAT_EXPORT_TURN_HEADER_RE.exec(body)) {
    headers.push({
      role: m[1] === 'User' ? 'user' : 'assistant',
      ts: Date.parse(m[2].replace(' ', 'T')),
      headerStart: m.index,
      bodyStart: m.index + m[0].length,
    })
  }

  for (let i = 0; i < headers.length; i += 1) {
    const cur = headers[i]
    // Clip to this sitting's window (inclusive) so `#wN` slices stay separate.
    if (Number.isFinite(cur.ts) && (cur.ts < windowStart || cur.ts > windowEnd)) continue
    const next = headers[i + 1]
    const text = body.slice(cur.bodyStart, next ? next.headerStart : body.length).trim()
    if (!text) continue
    if (CLEAR_CMD_RE.test(text)) meta.hadClear = true

    order += 1
    if (cur.role === 'user') {
      const filtered = filterUserText(text)
      if (!filtered) continue
      const trimmed = headTail(filtered, budgets.userHead, budgets.userTail, budgets.userAbove)
      if (trimmed.truncated) meta.hadTruncation = true
      turns.push({ role: 'user', text: trimmed.text, order })
    } else {
      const filtered = filterAssistantText(text)
      if (!filtered) continue
      const trimmed = headTail(filtered, budgets.asstHead, budgets.asstTail, budgets.asstAbove)
      if (trimmed.truncated) meta.hadTruncation = true
      turns.push({ role: 'assistant', text: trimmed.text, order })
    }
  }

  return order
}

// ── public API ───────────────────────────────────────────────────────────

function emptyMetaBlock(): ChainContextMetaBlock {
  return {
    turnCount: 0,
    toolCallCount: 0,
    hadClear: false,
    hadTruncation: false,
    droppedTurns: 0,
  }
}

/**
 * Append one session's turns to `turns` / `meta`, returning the next `order`.
 *
 * Shared by the per-session and per-chain extractors so there is exactly one
 * definition of "what a transcript looks like to the model". The chain version
 * calls this in a loop and splits one budget across the members; the session
 * version calls it once and gives the whole budget to a single sitting.
 *
 * `vaultMdCache` is threaded in rather than owned here because chat-export
 * windows (`#wN`) commonly slice one underlying conversation file — the chain
 * caller fetches once and slices N times. A single-session caller passes a
 * throwaway map and pays one read, which is the correct cost for one session.
 */
async function collectSessionTurnsBlock(
  s: ParsedSession,
  order: number,
  turns: ExtractedTurnBlock[],
  meta: ChainContextMetaBlock,
  budgets: TurnBudgets,
  vaultMdCache: Map<string, string | null>,
): Promise<number> {
  const cleanPath = s.path.replace(/#w\d+$/, '')

  // Vault-md chat-export sittings (ChatGPT / Grok). No native JSONL exists
  // for these — the transcript lives in the markdown file at `cleanPath`.
  // We parse `## User\n*ts*\nbody` / `## Assistant\n*ts*\nbody` blocks
  // and clip to the sitting's time window so `#wN` slices don't bleed
  // into each other.
  if (s.source === 'chatgpt' || s.source === 'grok') {
    let md = vaultMdCache.get(cleanPath) ?? null
    if (!vaultMdCache.has(cleanPath)) {
      try {
        const fs = getVaultFS()
        md = await fs.read(cleanPath)
      } catch {
        md = null
      }
      vaultMdCache.set(cleanPath, md)
    }
    if (!md) return order
    return emitChatExportTurnsBlock(md, s, order, turns, meta, budgets)
  }

  if (!cleanPath.startsWith('native/')) return order
  const rest = cleanPath.slice('native/'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return order
  const source = rest.slice(0, slash) as 'claude' | 'codex'
  const relPath = rest.slice(slash + 1)
  let jsonl: string
  try {
    jsonl = await readNativeAiSession(source, relPath)
  } catch {
    return order
  }

  // Clip to this sitting's window.
  //
  // One JSONL file can hold several sittings: `nativeAiSessionParserBlock`
  // splits it at idle gaps into `<uuid>`, `<uuid>::w1`, `<uuid>::w2`, and
  // `startedIso`/`endedIso` are exactly that window's first and last event. The
  // `#wN` suffix is stripped above to find the file, so without this clip every
  // window re-reads the WHOLE file and each one summarizes the entire day.
  //
  // That was survivable when a digest covered a whole chain; it is not now that
  // each sitting gets its own. Two windows of one file were producing near
  // identical summaries — a 14-minute sitting described as though it contained
  // the 1h45m one that followed it.
  //
  // The chat-export branch above has always done this. So has the parser, which
  // attributes file edits by `e.ts >= winStart && e.ts <= winEnd`. This is the
  // same rule, finally applied to the turns as well.
  const windowStart = Date.parse(s.startedIso)
  const windowEnd = Date.parse(s.endedIso ?? s.startedIso)
  const outsideWindow = (ev: Record<string, unknown>): boolean => {
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return false
    const raw = typeof ev.timestamp === 'string' ? Date.parse(ev.timestamp) : NaN
    // An event with no usable timestamp is kept: absence of evidence that it
    // falls outside is not evidence that it does, and dropping it would lose
    // real turns on any transcript that omits the field.
    if (!Number.isFinite(raw)) return false
    return raw < windowStart || raw > windowEnd
  }

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type !== 'user' && ev.type !== 'assistant') continue
    if (outsideWindow(ev)) continue
    const msg = ev.message as Record<string, unknown> | undefined
    const content = msg?.content

    // Count tool_use across every asst message in the window, even ones we
    // won't keep, so `session shape` reflects the true tool density.
    if (ev.type === 'assistant') meta.toolCallCount += countToolUses(content)

    // User tool_result-only messages carry the tool output back to Claude
    // — pure noise for post-hoc summarization; drop before flatten.
    if (ev.type === 'user' && containsOnlyToolResults(content)) continue

    const text = flattenContent(content).trim()
    if (!text) continue
    if (CLEAR_CMD_RE.test(text)) meta.hadClear = true

    order += 1
    if (ev.type === 'user') {
      const filtered = filterUserText(text)
      if (!filtered) continue
      const trimmed = headTail(filtered, budgets.userHead, budgets.userTail, budgets.userAbove)
      if (trimmed.truncated) meta.hadTruncation = true
      turns.push({ role: 'user', text: trimmed.text, order })
    } else {
      const filtered = filterAssistantText(text)
      if (!filtered) continue
      const trimmed = headTail(filtered, budgets.asstHead, budgets.asstTail, budgets.asstAbove)
      if (trimmed.truncated) meta.hadTruncation = true
      turns.push({ role: 'assistant', text: trimmed.text, order })
    }
  }
  return order
}

/**
 * Compact, ordered transcript for ONE session — the input to the session-digest
 * contract.
 *
 * This is the only extractor that reads raw material, and it is deliberately
 * the *narrow* one. The chain extractor below splits a single budget across up
 * to five sittings and then drops turns from the middle of the merged stream to
 * fit, so in a multi-session chain every member arrived at the model already
 * thinned, and members past the fifth never arrived at all. Summarizing one
 * sitting at a time gives each the whole budget, and the chain-level digest is
 * then composed from complete summaries rather than shared scraps.
 *
 * Returns an empty `turns` array when the transcript can't be read (vault-md
 * with no export, deleted JSONL); callers fall back to `session.topic`.
 */
export async function extractSessionContextBlock(
  session: ParsedSession,
  budgetTokens: number = getAiInputBudgetTokens(),
): Promise<ChainContextBlock> {
  const budgets = turnBudgetsFor(budgetTokens)
  const turns: ExtractedTurnBlock[] = []
  const meta = emptyMetaBlock()

  await collectSessionTurnsBlock(session, 0, turns, meta, budgets, new Map())

  const fitted = fitToBudgetBlock(turns, budgetTokens)
  if (fitted.dropped > 0) meta.hadTruncation = true
  meta.droppedTurns = fitted.dropped
  meta.turnCount = fitted.turns.length
  return { turns: fitted.turns, meta }
}

/**
 * Walk a chain's native-jsonl sessions and produce a compact, ordered
 * transcript for the chain-digest contract. Returns an empty `turns` array
 * for vault-md-only chains; callers fall back to `chain.topic`.
 *
 * Retained for the legacy whole-chain digest path. New work should summarize
 * per session (`extractSessionContextBlock`) and compose upward — see the
 * budget note there for why.
 */
export async function extractChainContextBlock(
  chain: ActivityChain,
  budgetTokens: number = getAiInputBudgetTokens(),
): Promise<ChainContextBlock> {
  const budgets = turnBudgetsFor(budgetTokens)
  const turns: ExtractedTurnBlock[] = []
  const meta = emptyMetaBlock()

  const ordered = [...chain.sessions]
    .sort((a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso))
    .slice(0, 5)

  // Cache vault-md reads across sittings that point at the same underlying
  // file. Chat-export chains commonly have several `#wN` windows off one
  // conversation file — one fetch, N slices.
  const vaultMdCache = new Map<string, string | null>()

  let order = 0
  for (const s of ordered) {
    order = await collectSessionTurnsBlock(s, order, turns, meta, budgets, vaultMdCache)
  }
  // Per-turn trimming bounds each turn but never the whole transcript, so a
  // long chain could still blow past the budget the user chose. This is the
  // only place the total is actually enforced.
  const fitted = fitToBudgetBlock(turns, budgetTokens)
  if (fitted.dropped > 0) meta.hadTruncation = true
  meta.droppedTurns = fitted.dropped
  meta.turnCount = fitted.turns.length
  return { turns: fitted.turns, meta }
}

/** One-line metadata anchor for the prompt: `session: 12 turns · 32 tool calls · had /clear`. */
export function formatSessionShapeBlock(meta: ChainContextMetaBlock): string {
  const parts: string[] = [
    `${meta.turnCount} substantive ${meta.turnCount === 1 ? 'turn' : 'turns'}`,
    `${meta.toolCallCount} tool ${meta.toolCallCount === 1 ? 'call' : 'calls'}`,
  ]
  if (meta.hadClear) parts.push('had /clear')
  if (meta.droppedTurns > 0) parts.push(`${meta.droppedTurns} mid-session turns dropped for length`)
  if (meta.hadTruncation) parts.push('some turns truncated')
  return `session shape: ${parts.join(' · ')}`
}

// ── shared output-cleanup helpers used by chainDigestContract ────────────

export const CHAIN_DIGEST_LEAK_PREFIX_RE =
  /^(?:first user message|user (?:message|input|prompt|\d+)|recap \d+|the user(?:'s)?(?: message| input| prompt| ask)?|note|topic|title|label|summary|description|output|project|input|response|here(?:'s| is)|looking at|based on)\s*[:\-—–]\s*/i

export const CHAIN_DIGEST_USER_QUOTE_LEAD_RE =
  /^(?:hey|hi|hello|can you|could you|please|i want|i need|let'?s)\b/i

export function stripWrappersBlock(text: string): string {
  return text
    .replace(/^["'`*\-\s>]+/, '')
    .replace(/["'`*\s]+$/, '')
    .trim()
}
