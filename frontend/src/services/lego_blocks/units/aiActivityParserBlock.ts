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
// The vault's `ai-raw/raw/{chatgpt,grok}/` markdown is generated from the
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
const GAP_HOURS = 1
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
    if (s.source === 'chatgpt' || s.source === 'grok' || isReadingSource(s.source)) continue
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
 * Group sessions into chains: same project + within GAP_HOURS of previous session
 * in that project (and no /clear in the previous session) belong together.
 */
export function buildChains(sessions: ParsedSession[]): ActivityChain[] {
  if (sessions.length === 0) return []

  // Sort ascending so adjacency math works
  const sorted = [...sessions].sort(
    (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
  )

  // Group by project, then chain within each project's time-ordered list.
  const byProject = new Map<string, ParsedSession[]>()
  for (const s of sorted) {
    const arr = byProject.get(s.project) ?? []
    arr.push(s)
    byProject.set(s.project, arr)
  }

  const chains: ActivityChain[] = []
  for (const [project, list] of byProject.entries()) {
    let current: ParsedSession[] = []
    let lastBreaker = false
    // Track the latest end timestamp seen across every session already in the
    // open chain so a new session that *overlaps* one of them (parallel work in
    // two terminals on the same project) breaks into its own chain instead of
    // getting absorbed. Without this, two concurrent Claude sessions on the
    // same cwd merge into a single chain and the second session disappears from
    // the drill-down table — the table row + timeline pill only carry the first
    // session's topic + msg count.
    let maxEndMs = -Infinity
    for (const s of list) {
      const sStartMs = Date.parse(s.startedIso)
      const sEndMs = Date.parse(s.endedIso ?? s.startedIso)
      if (current.length === 0) {
        current = [s]
        lastBreaker = s.hadClear
        maxEndMs = sEndMs
        continue
      }
      // Idle gap = time between the chain's latest known end and the new
      // session's start. Falls back to start-to-start when the previous
      // session has no real end (vault markdown rows where endedIso ==
      // startedIso) so we don't artificially over-merge.
      const prev = current[current.length - 1]
      const prevEndMs = Date.parse(prev.endedIso ?? prev.startedIso)
      const referenceEndMs = Number.isFinite(maxEndMs) && maxEndMs > prevEndMs ? maxEndMs : prevEndMs
      const idleHours = (sStartMs - referenceEndMs) / 3_600_000
      const overlapsOpen = sStartMs < maxEndMs
      if (lastBreaker || idleHours > GAP_HOURS || overlapsOpen) {
        chains.push(makeChain(project, current))
        current = [s]
        maxEndMs = sEndMs
      } else {
        current.push(s)
        if (sEndMs > maxEndMs) maxEndMs = sEndMs
      }
      lastBreaker = s.hadClear
    }
    if (current.length > 0) chains.push(makeChain(project, current))
  }

  // Lift the chain's topic to the first substantive (non-label, non-empty) prompt
  // across its sessions — first session might be /clear-only or auto-prompt.
  const isLabel = (t: string) => t.startsWith('[') && t.endsWith(']')
  for (const c of chains) {
    if (isLabel(c.topic) || c.topic === '(no user message)') {
      for (const s of c.sessions.slice(1)) {
        if (!isLabel(s.topic) && s.topic !== '(no user message)') {
          c.topic = s.topic
          break
        }
      }
    }
  }

  chains.sort((a, b) => Date.parse(b.startedIso) - Date.parse(a.startedIso))
  return chains
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
  for (const s of sessions) {
    if (!s.touchedPaths || s.touchedPaths.length === 0) continue
    if (!touched) touched = new Set()
    for (const p of s.touchedPaths) touched.add(p)
  }
  return {
    key,
    project,
    source: first.source,
    startedIso: first.startedIso,
    endedIso: lastEnded,
    msgCount,
    topic: first.topic,
    sessions,
    touchedPaths: touched ? Array.from(touched) : undefined,
  }
}
