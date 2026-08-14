// Parse Claude Code / Codex session transcripts into typed sessions and group
// them into work-chains.
//
// Ported from `kai-workspace/scripts/claude-activity.py` so the UI and the CLI
// produce the same shape of data. Keep both in sync when changing chain rules.
// (Divergence: project detection here is generic — cwd folder name — not the
// script's hardcoded paths.)

export type ActivitySource =
  | 'claude-code'
  | 'codex'
  | 'chatgpt'
  | 'grok'
  | 'goodnotes'
  | 'memorized'
  | 'reading-md'
  | 'reading-draw'
  /** User-authored time blocks logged by hand ("painting 4h") — not AI, not
   *  reading. Durable in ai-activity/manual-sessions.jsonl. */
  | 'manual'

export function isManualSource(source: ActivitySource): boolean {
  return source === 'manual'
}

/** Sources that represent reading/memorization rather than AI chat sessions.
 *  These all roll up under the single "Reading" source pill and are filtered
 *  among themselves by the reading sub-source pills. */
export const READING_SOURCES: ReadonlySet<ActivitySource> = new Set<ActivitySource>([
  'goodnotes',
  'memorized',
  'reading-md',
  'reading-draw',
])

export function isReadingSource(source: ActivitySource): boolean {
  return READING_SOURCES.has(source)
}

export interface ParsedSession {
  /** Vault-relative path of the source markdown file. */
  path: string
  source: ActivitySource
  /** ISO timestamp of session start (best-effort: filename + _Last saved_ line). */
  startedIso: string
  /** ISO timestamp of session end. Native JSONL sources track this from the
   *  last event in the file; vault markdown can't (no per-message timestamps),
   *  so it equals `startedIso` there. Used for accurate timeline pill widths. */
  endedIso?: string
  /** Resolved project bucket (e.g. "Thinking-Space", "[auto-commit]"). */
  project: string
  /** Working directory the session ran in, when the transcript reveals it.
   *  Lets mapping rules / detection roots re-resolve without a reparse signal loss. */
  cwd?: string
  /** Count of real user-message blocks (slash commands count, tool_results don't). */
  userMsgCount: number
  /** First substantive user prompt (preferred for topic labels); falls back to slash-command label. */
  topic: string
  /** Whether the session contains a /clear command (forces a chain break). */
  hadClear: boolean
  /** File mtime in unix seconds — used for incremental cache invalidation. */
  mtime: number
  /** Token usage if the source surfaces it (native JSONL only). */
  tokens?: SessionTokens
  /** Model id last seen in the session (e.g. "claude-opus-4-7", "gpt-5"). */
  model?: string
  /** Full session UUID when we can extract one (Claude Code session id). Used
   *  for exact dedup against the native ~/.claude/projects/<uuid>.jsonl source.
   *  Falls back to the 8-char short id if only that's available. */
  sessionId?: string
  /** True when the session was rebuilt from `~/.claude/history.jsonl` (the
   *  permanent prompt log) because the real transcript was deleted by Claude
   *  Code's cleanup. Reconstructed sessions have prompt counts and a rough
   *  time window but no tokens, model, or assistant turns. */
  reconstructed?: boolean
  /** Absolute paths of files the session wrote (Edit/Write/MultiEdit/
   *  NotebookEdit tool calls). Powers the vault-graph session lens: the exact
   *  notes a session touched, not a time-window guess. Native Claude sources
   *  only; absent for chat/reading sources and pre-provenance cached rows. */
  touchedPaths?: string[]
  /** Active duration in ms: sum of inter-message gaps within the window, each
   *  clamped so a long pause counts as a bounded sliver, not its full length.
   *  This is the honest "how much work" measure for the density sparkline;
   *  `endedIso - startedIso` remains the wall-clock span. Native sources only —
   *  absent for chat/vault sources with no per-message timestamps. */
  activeDurationMs?: number
}

export interface SessionTokens {
  input: number
  output: number
  /** Tokens served from cache (cheaper). 0 when not reported. */
  cacheRead: number
  /** Total tokens written into cache (sum of 5m + 1h TTL buckets). Display
   *  formatters use this; cost math splits it via `cacheCreation1h`. */
  cacheCreation: number
  /** Portion of `cacheCreation` that is 1-hour TTL (~2.0x input rate). The
   *  remainder is 5-minute TTL (~1.25x). Optional — older cache rows and Codex
   *  transcripts default to 0 (treated as all-5m). */
  cacheCreation1h?: number
}

export interface ActivityChain {
  /** Stable per-chain key derived from project + earliest session id. */
  key: string
  project: string
  source: ActivitySource
  startedIso: string
  endedIso: string
  msgCount: number
  /** First substantive topic across the chain's sessions. */
  topic: string
  sessions: ParsedSession[]
  /** Union of every session's file-edit provenance (absolute paths). Absent
   *  when no session in the chain carried edits. */
  touchedPaths?: string[]
  /** Sum of the chain's sessions' active durations (see ParsedSession). Absent
   *  when no session carried per-message timing. */
  activeDurationMs?: number
}

// Strict id form used by Claude Code transcripts (date + 8-char hex).
const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})_([0-9a-f]{8})\.md$/
// Permissive: any filename that *starts* with YYYY-MM-DD. Covers Codex
// transcripts and any other tool that prefixes a date but uses a different id.
const FILENAME_DATE_RE = /^(\d{4}-\d{2}-\d{2})/
const SAVED_RE = /_Last saved:\s*([0-9T:\-]+)_/
const CLEAR_RE = /<command-name>\/clear<\/command-name>/i
const COMMAND_NAME_RE = /<command-name>([^<]+)<\/command-name>/
// Vault session files (Claude Code save-skill output) begin with a line like
//   `# Claude Code Session — ad551ea8-9dd1-4a76-a0e4-2813b308384c`
// We grab the full UUID so dedup against the native ~/.claude/projects/<uuid>.jsonl
// is an exact match, not a fragile 8-char prefix scan.
const FULL_UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

// Detect the project a session was working in: the folder name of its working
// directory. The cwd is the truth — nothing user- or machine-specific lives in
// code. Wrong/ugly names are fixed post-parse via the user's mapping rules
// (Settings ▸ AI Activity), and sessions without any cwd signal fall back to
// `<unknown>` + temporal inheritance.

import { autoInferProjectFromPathBlock } from '@/services/lego_blocks/units/aiActivityMappingBlock'

// Claude Code writes a "Primary working directory:" line at the top of every
// transcript. When present, this is a high-confidence signal — way more
// reliable than scanning random path mentions in tool output. Global flag so we
// can walk every match and pick the first that's an actual path (the regex also
// matches JSON tool-args like {"cwd": "..."} and shell fragments deeper in the
// body — those must be skipped, not blindly trusted).
const CWD_RE = /(?:Primary working directory|Working directory|cwd)\s*[:=]\s*([^\n`<]+)/gi

// Turn a raw captured cwd into a clean absolute path, or null if it doesn't look
// like one. Strips JSON/quote wrappers, then requires an absolute-path shape and
// rejects shell/JSON metacharacters — a real working directory never contains
// `$( ) | " ; *` etc., but the garbage buckets ($(pwd | sed...), "Size: $(wc -c,
// JSON arg blobs) always do.
function sanitizeCwd(raw: string): string | null {
  let v = raw.trim()
  v = v.replace(/^["'`]+/, '').replace(/["'`,]+$/, '').trim()
  if (!v) return null
  if (!/^(~|\/|[A-Za-z]:[\\/])/.test(v)) return null
  if (/[$()|`;*<>"]/.test(v)) return null
  return v
}

function detectProject(text: string): { project: string; cwd?: string } {
  let cwd: string | undefined
  for (const m of text.matchAll(CWD_RE)) {
    const candidate = sanitizeCwd(m[1])
    if (candidate) {
      cwd = candidate
      break
    }
  }
  if (cwd) {
    const project = autoInferProjectFromPathBlock(cwd)
    if (project) return { project, cwd }
  }
  return { project: '<unknown>', cwd }
}

function parseStarted(filename: string, text: string, mtimeUnix: number): string {
  // Prefer the explicit "_Last saved:" timestamp in the body (most accurate).
  const saved = SAVED_RE.exec(text)
  if (saved) {
    const raw = saved[1]
    // Format in file: 2026-06-06T13-58-13 (hyphens in time slot)
    const norm = raw.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3')
    const d = new Date(norm)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  // Next best: the date prefix on the filename. Use both the strict id form
  // and the permissive YYYY-MM-DD-anywhere-at-start so Codex / other tools'
  // filenames still classify into the right day.
  const dateMatch = FILENAME_RE.exec(filename) ?? FILENAME_DATE_RE.exec(filename)
  if (dateMatch) return new Date(dateMatch[1] + 'T00:00:00').toISOString()
  // Last resort: file mtime. Never default to `new Date()` — that would stamp
  // every unreadable session as "now" and explode short-range totals.
  return new Date(mtimeUnix * 1000).toISOString()
}

/**
 * Count user message blocks and extract a topic. Mirrors the Python `parse_session`
 * logic: skip pure tool_result blobs, treat slash commands and auto-commit prompts
 * as real "user actions" but only use their labels as a topic fallback.
 */
function countUserMessages(text: string): { count: number; topic: string } {
  const blocks = text.split(/^## User\s*$/m).slice(1)
  let real = 0
  let substantive = ''
  let fallback = ''

  for (const rawBlock of blocks) {
    // body up to next "## " header or end
    const body = rawBlock.split(/^## /m)[0].trim()
    const cleaned = body
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim()
      .replace(/^-+/, '')
      .trim()
    if (!cleaned || cleaned.startsWith('[tool_result]')) continue

    if (/^<(local-command-caveat|command-name|command-message)/.test(cleaned)) {
      const cmd = COMMAND_NAME_RE.exec(cleaned)
      if (cmd && !fallback) fallback = `[${cmd[1].trim()}]`
      real += 1
      continue
    }
    if (cleaned.startsWith('You are writing a git commit message')) {
      if (!fallback) fallback = '[auto commit message]'
      real += 1
      continue
    }
    real += 1
    if (!substantive) substantive = cleaned.split('\n')[0].slice(0, 140)
  }

  return { count: real, topic: substantive || fallback || '(no user message)' }
}

export interface ParseInput {
  /** Vault-relative path. Used to derive filename pattern + source. */
  path: string
  /** File contents. */
  text: string
  /** Unix-seconds mtime — propagated into the parsed session for cache keying. */
  mtime: number
}

// ── Chat-export sessions (ChatGPT / Grok) ───────────────────────────────────
// The vault's `ai-activity/raw-sessions/{chatgpt,grok}/` markdown is generated from the
// providers' export JSON by the user's converter scripts. Everything we need
// is machine-written YAML frontmatter: provider, conversation_id, created,
// user_messages, title, model(s). No cwd exists for web chats — per user
// decision, the provider name IS the project bucket.

const CHAT_EXPORT_PROVIDERS = new Set<ActivitySource>(['chatgpt', 'grok'])

// Frontmatter `updated` is untrustworthy (provider migrations bulk-rewrite it
// — dozens of conversations all "updated" the same minute), but the BODY has
// real per-message timestamps: `## User` / `## Assistant` headers each followed
// by `*YYYY-MM-DD HH:MM[ | model: …]*`. Durations come from those, split into
// sittings at 1h idle gaps — same window logic as the history.jsonl parser. A
// revisited conversation becomes several short sessions instead of one
// months-long monster.

const CHAT_EXPORT_MSG_RE = /^## (User|Assistant)[ \t]*\r?\n\*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/gm
const CHAT_EXPORT_WINDOW_GAP_MS = 3_600_000

function parseChatExportSessions(input: ParseInput): ParsedSession[] | null {
  if (!input.text.startsWith('---')) return null
  const fmEnd = input.text.indexOf('\n---', 3)
  if (fmEnd === -1) return null
  const fm = input.text.slice(3, fmEnd)
  const get = (key: string): string | null => {
    const m = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(fm)
    if (!m) return null
    const v = m[1].trim()
    return v.replace(/^"(.*)"$/, '$1') || null
  }

  const provider = get('provider')
  if (!provider || !CHAT_EXPORT_PROVIDERS.has(provider as ActivitySource)) return null
  const conversationId = get('conversation_id')
  const created = get('created')
  if (!conversationId || !created) return null
  // Timestamps are local-time `YYYY-MM-DD HH:MM` — Date parses the T-form as local.
  const startedDate = new Date(created.replace(' ', 'T'))
  if (Number.isNaN(startedDate.getTime())) return null
  const userMsgs = Number(get('user_messages'))
  // `model: <scalar>` (ChatGPT) or a `models:` list (Grok) — take the first.
  let model = get('model') ?? undefined
  if (!model) {
    const list = /^models:[ \t]*\n([ \t]+-[ \t]+.+)/m.exec(fm)
    if (list) model = list[1].replace(/^[ \t]+-[ \t]+/, '').trim() || undefined
  }
  if (model === 'auto') model = undefined

  const base = {
    source: provider as ActivitySource,
    project: provider,
    topic: get('title') ?? '(untitled)',
    hadClear: false,
    mtime: input.mtime,
    model,
  }
  const convId = conversationId.toLowerCase()

  // Real per-message timestamps from the body.
  const msgs: Array<{ user: boolean; ts: number }> = []
  const body = input.text.slice(fmEnd + 4)
  CHAT_EXPORT_MSG_RE.lastIndex = 0
  for (let m = CHAT_EXPORT_MSG_RE.exec(body); m; m = CHAT_EXPORT_MSG_RE.exec(body)) {
    const t = Date.parse(m[2].replace(' ', 'T'))
    if (Number.isFinite(t)) msgs.push({ user: m[1] === 'User', ts: t })
  }
  msgs.sort((a, b) => a.ts - b.ts)

  if (msgs.length === 0) {
    // No body timestamps — fall back to a zero-duration point event at
    // `created`, with the frontmatter user_messages count.
    return [
      {
        ...base,
        path: input.path,
        startedIso: startedDate.toISOString(),
        endedIso: startedDate.toISOString(),
        userMsgCount: Number.isFinite(userMsgs) && userMsgs > 0 ? userMsgs : 0,
        sessionId: convId,
      },
    ]
  }

  // Split at idle gaps — each window is one sitting.
  const windows: Array<Array<{ user: boolean; ts: number }>> = []
  let cur: Array<{ user: boolean; ts: number }> = []
  for (const msg of msgs) {
    if (cur.length > 0 && msg.ts - cur[cur.length - 1].ts > CHAT_EXPORT_WINDOW_GAP_MS) {
      windows.push(cur)
      cur = []
    }
    cur.push(msg)
  }
  windows.push(cur)

  return windows.map((win, i) => ({
    ...base,
    path: i === 0 ? input.path : `${input.path}#w${i}`,
    startedIso: new Date(win[0].ts).toISOString(),
    endedIso: new Date(win[win.length - 1].ts).toISOString(),
    userMsgCount: win.filter(m => m.user).length,
    sessionId: i === 0 ? convId : `${convId}::w${i}`,
  }))
}

/**
 * Parse one vault markdown file into sessions. Chat exports (gated on
 * frontmatter `provider: chatgpt|grok` — their files are slug-named) can yield
 * multiple per-sitting windows; everything else yields 0 or 1 sessions via the
 * date-prefixed-filename path. Index/wikilink files yield [].
 */
export function parseVaultSessionsBlock(input: ParseInput): ParsedSession[] {
  const chatExport = parseChatExportSessions(input)
  if (chatExport) return chatExport
  const single = parseSession(input)
  return single ? [single] : []
}

/** Parse a single session file. Returns null if the filename doesn't match the expected pattern. */
export function parseSession(input: ParseInput): ParsedSession | null {
  const filename = input.path.split('/').pop() ?? ''
  // Codex filenames historically share the same YYYY-MM-DD_<id>.md shape; if not,
  // tolerate any filename starting with a date.
  const looksLikeSession = FILENAME_RE.test(filename) || /^\d{4}-\d{2}-\d{2}_/.test(filename)
  if (!looksLikeSession) return null

  const source: ActivitySource = input.path.includes('/codex/') ? 'codex' : 'claude-code'
  const startedIso = parseStarted(filename, input.text, input.mtime)
  const detected = detectProject(input.text)
  let project = detected.project

  // Noise buckets: automated wrapper sessions get their own buckets so they
  // don't inflate real project counts. Same first-2KB heuristic as Python.
  const head = input.text.slice(0, 2000)
  if (head.includes('You are writing a git commit message')) project = '[auto-commit]'
  else if (head.includes('TELEGRAM MODE')) project = '[telegram]'

  const { count, topic } = countUserMessages(input.text)

  // Pull the full session UUID from the header so dedup against the native
  // store is exact (vault filenames only carry the 8-char short id).
  const uuidMatch = FULL_UUID_RE.exec(input.text.slice(0, 500))
  const sessionId = uuidMatch ? uuidMatch[1].toLowerCase() : undefined

  return {
    path: input.path,
    source,
    startedIso,
    // Vault markdown has no per-message timestamps; the file-level _Last saved_
    // we used for startedIso is also the end. Keeps the field consistent across
    // sources without inventing data we don't have.
    endedIso: startedIso,
    project,
    cwd: detected.cwd,
    userMsgCount: count,
    topic,
    hadClear: CLEAR_RE.test(input.text),
    mtime: input.mtime,
    sessionId,
  }
}

// Chains break when the *idle gap* (end of previous session → start of next)
// exceeds this. Start-to-start was glueing four unrelated same-project bursts
// across a workday into one 10-hour chain; idle-time is the real signal —
// "I came back after an hour and kept going" reads as one chain, "I worked on
// auth this morning and bills this afternoon" doesn't.
//
// The same threshold splits one JSONL file into active windows in
// `nativeAiSessionParserBlock` — deliberately one constant, because two copies
// of "what counts as idle" can disagree, and then a file splits into windows
// that immediately re-merge into one chain (or don't, and nobody can say why).
export const IDLE_GAP_HOURS = 1
export const IDLE_GAP_MS = IDLE_GAP_HOURS * 3_600_000
// How close (in time) an unknown session has to be to a classified one to
// inherit its project. Pure-chat sessions don't include any path signals in
// the saved transcript, so they fall to <unknown> on the structural detector.
// In practice they're almost always quick follow-ups to a real work session
// in the same project, so temporal proximity is a strong tiebreaker.
const INHERIT_WINDOW_HOURS = 4

function isInheritable(project: string): boolean {
  return project !== '<unknown>' && !(project.startsWith('[') && project.endsWith(']'))
}

/**
 * Reassign `<unknown>` sessions to the project of the nearest classified session
 * within INHERIT_WINDOW_HOURS. Noise buckets ([auto-commit], [telegram]) and
 * already-classified sessions are left alone. Returns a new array; inputs are
 * not mutated. Run BEFORE buildChains so the resulting chains group correctly.
 */
export function inheritUnknownSessions(sessions: ParsedSession[]): ParsedSession[] {
  if (sessions.length === 0) return sessions
  const sorted = [...sessions].sort(
    (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
  )
  // Pre-extract classified anchors with their start ms. Linear scan is fine —
  // session counts are in the low thousands at most.
  const anchors: Array<{ t: number; project: string }> = []
  for (const s of sorted) {
    // Web-chat (ChatGPT/Grok) and reading/memorization (GoodNotes, memorized,
    // markdown, excalidraw) sessions bucket under their own labels — those must
    // never bleed onto a nearby unknown coding session via temporal inheritance.
    if (s.source === 'chatgpt' || s.source === 'grok' || isReadingSource(s.source) || isManualSource(s.source)) continue
    if (isInheritable(s.project)) {
      anchors.push({ t: Date.parse(s.startedIso), project: s.project })
    }
  }
  if (anchors.length === 0) return sorted

  const windowMs = INHERIT_WINDOW_HOURS * 3_600_000
  return sorted.map(s => {
    if (s.project !== '<unknown>') return s
    const t = Date.parse(s.startedIso)
    let bestProject: string | null = null
    let bestDist = Infinity
    for (const a of anchors) {
      const d = Math.abs(a.t - t)
      if (d < bestDist) {
        bestDist = d
        bestProject = a.project
        if (d === 0) break
      }
    }
    if (bestProject && bestDist <= windowMs) {
      return { ...s, project: bestProject }
    }
    return s
  })
}


/**
 * The minimum a thing must expose to be grouped into chains.
 *
 * Grouping asks only four questions — which project, when did it start, when
 * did it end, did it `/clear` — and a `ParsedSession` is merely one thing that
 * can answer them. A stored `ProjectSessionDigest` answers them too, which is
 * what lets a device with no access to `~/.claude` (iPhone, web) re-derive the
 * same chains from records alone instead of being shipped a chain-shaped file.
 *
 * That matters beyond convenience: a transport file for chains would have to be
 * *addressed*, and every available address is an output of this very algorithm
 * — the derived-address defect that docs/contracts/DERIVATION.md exists to
 * document. Making the grouping reproducible everywhere means no such file has
 * to exist.
 */
export interface ChainableBlock {
  project: string
  startedIso: string
  /** Absent for sources with no per-message timing; treated as start, which is
   *  what makes zero-length rows measure start-to-start rather than over-merge. */
  endedIso?: string
  hadClear: boolean
  /** Stable tie-break for identical start instants. Must not depend on readdir
   *  order or the filesystem decides chain membership, differently per device. */
  chainSortKey: string
}

/** A chain still accepting members. One project can have several at once —
 *  that is the whole point (see `groupChainableBlock`). */
interface OpenChain<T> {
  sessions: T[]
  /** Latest end across every member. A new member starting before this
   *  overlaps the chain and therefore belongs to a different thread. */
  maxEndMs: number
  /** The most recent member ran `/clear`, so this chain is finished. Per-chain,
   *  not per-project: clearing in one terminal says nothing about another. */
  cleared: boolean
}

/**
 * THE grouping algorithm. Same project, within IDLE_GAP_MS of the chain's last
 * activity, not overlapping it, and not after a `/clear`.
 *
 * Generic over `ChainableBlock` so there is exactly one definition of "what
 * counts as one logical sitting" in the codebase. The alternative — a second
 * implementation over stored digests for devices that cannot parse transcripts
 * — is two copies of the idle rule that can disagree, which is the same defect
 * as the duplicated idle threshold that `IDLE_GAP_MS` was extracted to fix.
 *
 * Returns groups of members, each in ascending time order; the caller decides
 * what to build from them. Every rule here is pinned by
 * `tests/aiActivityBuildChains.test.ts` — add a failing test before changing
 * any of it.
 */
export function groupChainableBlock<T extends ChainableBlock>(items: T[]): T[][] {
  if (items.length === 0) return []

  // Sort ascending so adjacency math works. `chainSortKey` breaks ties because
  // the first member decides the chain's identity downstream: leaving two
  // same-instant members in readdir order would let the filesystem decide, and
  // it would decide differently on another device.
  const sorted = [...items].sort(
    (a, b) =>
      Date.parse(a.startedIso) - Date.parse(b.startedIso) ||
      a.chainSortKey.localeCompare(b.chainSortKey),
  )

  // Group by project, then chain within each project's time-ordered list.
  const byProject = new Map<string, T[]>()
  for (const s of sorted) {
    const arr = byProject.get(s.project) ?? []
    arr.push(s)
    byProject.set(s.project, arr)
  }

  const groups: T[][] = []
  for (const list of byProject.values()) {
    let open: OpenChain<T>[] = []
    for (const s of list) {
      const sStartMs = Date.parse(s.startedIso)
      const sEndMs = Date.parse(s.endedIso ?? s.startedIso)

      // Retire anything this member is already too late to join. Members
      // arrive in ascending start order, so nothing later can revive it either.
      const stillOpen: OpenChain<T>[] = []
      for (const chain of open) {
        if (sStartMs - chain.maxEndMs > IDLE_GAP_MS) groups.push(chain.sessions)
        else stillOpen.push(chain)
      }
      open = stillOpen

      // Among the chains it may join, take the one active most recently — the
      // shortest idle gap. `maxEndMs` is the chain's latest known end and falls
      // back to the start for rows with no end, where measuring start-to-start
      // is what stops zero-length members from over-merging.
      //
      // A member starting before a chain's end overlaps it: parallel work in
      // two terminals, which must split so the second keeps its own row in the
      // drill-down instead of vanishing into the first's topic.
      let best: OpenChain<T> | null = null
      for (const chain of open) {
        if (chain.cleared) continue
        if (sStartMs < chain.maxEndMs) continue
        if (!best || chain.maxEndMs > best.maxEndMs) best = chain
      }

      if (best) {
        best.sessions.push(s)
        if (sEndMs > best.maxEndMs) best.maxEndMs = sEndMs
        best.cleared = s.hadClear
      } else {
        open.push({ sessions: [s], maxEndMs: sEndMs, cleared: s.hadClear })
      }
    }
    for (const chain of open) groups.push(chain.sessions)
  }
  return groups
}

/**
 * Group sessions into chains: same project, within IDLE_GAP_HOURS of the chain's
 * last activity, not overlapping it, and not after a `/clear`.
 *
 * A project can have several chains open at once, and that is load-bearing. Two
 * terminals on one repo interleave: A runs 10:00–12:00, B cuts in at 10:30, A
 * resumes at 12:30. B correctly breaks out — it overlaps A, and absorbing it
 * would hide it from the drill-down. But with a single open chain per project,
 * breaking B out also *discarded* A, so A's resumption at 12:30 started a third
 * chain. A thread that got interleaved even once became permanently unresumable,
 * and every resumption minted a new chain key — a new digest, a new provider
 * call, a new row for work the user experienced as continuous.
 *
 * So each project keeps a list of open chains. A session joins the one that was
 * active most recently among those it can legally join, which is the same choice
 * the single-chain version made whenever only one was open — i.e. this is a
 * strict generalisation, not a new rule.
 */
export function buildChains(sessions: ParsedSession[]): ActivityChain[] {
  if (sessions.length === 0) return []

  // A session's tie-break is its path: the first session's path becomes the
  // chain's key, so this is what keeps that key from depending on readdir order.
  const chainable = sessions.map(s => ({ session: s, ...s, chainSortKey: s.path }))

  const chains = groupChainableBlock(chainable).map(group =>
    makeChain(group[0].project, group.map(g => g.session)),
  )

  chains.sort((a, b) => Date.parse(b.startedIso) - Date.parse(a.startedIso))
  return chains
}

/** A topic that names nothing: an auto-prompt label like `[auto-commit]`, or a
 *  session that never got a user message. */
function isPlaceholderTopic(topic: string): boolean {
  return (topic.startsWith('[') && topic.endsWith(']')) || topic === '(no user message)'
}

/** The chain's topic is its head session's, reaching past placeholder heads to
 *  the first session that actually says what the work was. Resolved here rather
 *  than patched onto the chain afterwards — a chain is built once and is then
 *  final, so nothing downstream can read a half-formed one. */
function chainTopic(sessions: ParsedSession[]): string {
  for (const s of sessions) {
    if (!isPlaceholderTopic(s.topic)) return s.topic
  }
  return sessions[0].topic
}

function makeChain(project: string, sessions: ParsedSession[]): ActivityChain {
  const first = sessions[0]
  const last = sessions[sessions.length - 1]
  const msgCount = sessions.reduce((n, s) => n + s.userMsgCount, 0)
  // Stable id: project + first session path is unique because session files are
  // identified by filename in the vault.
  const key = `${project}::${first.path}`
  // Chain end is the real end of the last session when we have one — for
  // native JSONL sources this is the last-event timestamp; for vault sources
  // we fall back to the start (no per-message data to work with).
  const lastEnded = last.endedIso ?? last.startedIso
  // Union the sessions' file-edit provenance so the chain knows every note it
  // wrote across its windows.
  let touched: Set<string> | null = null
  // Sum active durations across the chain's sessions. Left undefined when no
  // session carried timing, so downstream can tell "0 active work" apart from
  // "never measured" (an old cached row) and fall back to wall-clock.
  let activeDurationMs: number | undefined
  for (const s of sessions) {
    if (s.touchedPaths && s.touchedPaths.length > 0) {
      if (!touched) touched = new Set()
      for (const p of s.touchedPaths) touched.add(p)
    }
    if (typeof s.activeDurationMs === 'number') {
      activeDurationMs = (activeDurationMs ?? 0) + s.activeDurationMs
    }
  }
  return {
    key,
    project,
    source: first.source,
    startedIso: first.startedIso,
    endedIso: lastEnded,
    msgCount,
    topic: chainTopic(sessions),
    sessions,
    touchedPaths: touched ? Array.from(touched) : undefined,
    activeDurationMs,
  }
}
