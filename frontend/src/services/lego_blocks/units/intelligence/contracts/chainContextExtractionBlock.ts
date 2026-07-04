import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { readNativeAiSession } from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'

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

const USER_HEAD_CHARS = 300
const USER_TAIL_CHARS = 200
const USER_TRUNCATE_ABOVE = 600

const ASST_HEAD_CHARS = 250
const ASST_TAIL_CHARS = 200
const ASST_TRUNCATE_ABOVE = 600
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

// ── public API ───────────────────────────────────────────────────────────

/**
 * Walk a chain's native-jsonl sessions and produce a compact, ordered
 * transcript for the chain-digest contract. Returns an empty `turns` array
 * for vault-md-only chains; callers fall back to `chain.topic`.
 */
export async function extractChainContextBlock(chain: ActivityChain): Promise<ChainContextBlock> {
  const turns: ExtractedTurnBlock[] = []
  const meta: ChainContextMetaBlock = {
    turnCount: 0,
    toolCallCount: 0,
    hadClear: false,
    hadTruncation: false,
  }

  const ordered = [...chain.sessions]
    .sort((a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso))
    .slice(0, 5)

  let order = 0
  for (const s of ordered) {
    const cleanPath = s.path.replace(/#w\d+$/, '')
    if (!cleanPath.startsWith('native/')) continue
    const rest = cleanPath.slice('native/'.length)
    const slash = rest.indexOf('/')
    if (slash < 0) continue
    const source = rest.slice(0, slash) as 'claude' | 'codex'
    const relPath = rest.slice(slash + 1)
    let jsonl: string
    try {
      jsonl = await readNativeAiSession(source, relPath)
    } catch {
      continue
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
      const msg = ev.message as Record<string, unknown> | undefined
      const content = msg?.content

      // Count tool_use across every asst message, even ones we won't keep,
      // so `session shape` reflects the true tool density.
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
        const trimmed = headTail(filtered, USER_HEAD_CHARS, USER_TAIL_CHARS, USER_TRUNCATE_ABOVE)
        if (trimmed.truncated) meta.hadTruncation = true
        turns.push({ role: 'user', text: trimmed.text, order })
      } else {
        const filtered = filterAssistantText(text)
        if (!filtered) continue
        const trimmed = headTail(filtered, ASST_HEAD_CHARS, ASST_TAIL_CHARS, ASST_TRUNCATE_ABOVE)
        if (trimmed.truncated) meta.hadTruncation = true
        turns.push({ role: 'assistant', text: trimmed.text, order })
      }
    }
  }
  meta.turnCount = turns.length
  return { turns, meta }
}

/** One-line metadata anchor for the prompt: `session: 12 turns · 32 tool calls · had /clear`. */
export function formatSessionShapeBlock(meta: ChainContextMetaBlock): string {
  const parts: string[] = [
    `${meta.turnCount} substantive ${meta.turnCount === 1 ? 'turn' : 'turns'}`,
    `${meta.toolCallCount} tool ${meta.toolCallCount === 1 ? 'call' : 'calls'}`,
  ]
  if (meta.hadClear) parts.push('had /clear')
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
