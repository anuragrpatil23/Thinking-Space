// Parse a Claude Code or Codex JSONL transcript (from the native CLI session
// stores under ~/.claude/projects or ~/.codex/sessions) into our shared
// ParsedSession shape.
//
// Both formats are JSONL — one JSON object per line. Differences:
//   - Claude Code: every event carries `cwd`, `sessionId`, `timestamp`, plus
//     `type: "user" | "assistant" | "file-history-snapshot" | ...`. User events
//     have `message.content` (string or array of typed blocks).
//   - Codex: first line is `type: "session_meta"` with `payload.{id,cwd,timestamp}`.
//     Subsequent events have `type: "response_item" | "event_msg" | ...` and a
//     `payload` whose `role` indicates user/assistant when applicable.
//
// We classify project directly from `cwd` (no heuristics needed — cwd is gold):
// the project is the working directory's folder name. Nothing user-specific in
// code; renames/merges happen post-parse via the user's mapping rules.

import type {
  ActivitySource,
  ParsedSession,
  SessionTokens,
} from '@/services/lego_blocks/units/aiActivityParserBlock'
import { IDLE_GAP_MS } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { autoInferProjectFromPathBlock } from '@/services/lego_blocks/units/aiActivityMappingBlock'

export type NativeSource = 'claude' | 'codex'

/** Classify an absolute cwd path into a project bucket. */
function classifyCwd(cwd: string): string {
  if (!cwd) return '<unknown>'
  return autoInferProjectFromPathBlock(cwd) ?? '<unknown>'
}

function numericField(obj: Record<string, unknown>, key: string): number {
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Pull the displayable string content out of a Claude or Codex message body,
 *  which can be a plain string or an array of typed content blocks. Codex uses
 *  `input_text` / `output_text` block types; Claude uses `text`. Tool results,
 *  images, etc. are skipped. */
function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
    } else if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>
      const bt = typeof b.type === 'string' ? b.type : ''
      if ((bt === 'text' || bt === 'input_text' || bt === 'output_text') &&
          typeof b.text === 'string') {
        parts.push(b.text)
      }
      // skip tool_result, image, function_call, reasoning, etc.
    }
  }
  return parts.join('\n')
}

/** Tool names whose `input.file_path` (or `notebook_path`) names a file the
 *  session wrote — the file-edit provenance behind the vault-graph session
 *  lens. Reads and other tools don't mutate notes, so they're ignored. */
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Resolve a tool-call path to absolute form. Claude Code writes absolute
 *  `file_path`s in practice; the relative branch is belt-and-braces so a rare
 *  relative path doesn't silently drop (it's joined against the session cwd). */
function resolveEditPath(raw: string, cwd: string): string {
  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) return raw
  if (cwd) return `${cwd.replace(/\/+$/, '')}/${raw.replace(/^\.\//, '')}`
  return raw
}

/** Pull absolute file paths out of an assistant message's `tool_use` blocks —
 *  only the mutating tools (Edit/Write/MultiEdit/NotebookEdit) count. Returns
 *  [] for message bodies that carry no file edits. */
function extractEditedPaths(content: unknown, cwd: string): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
    if (!FILE_EDIT_TOOLS.has(b.name)) continue
    const input = b.input as Record<string, unknown> | undefined
    if (!input) continue
    const raw =
      (typeof input.file_path === 'string' && input.file_path) ||
      (typeof input.notebook_path === 'string' && input.notebook_path) ||
      ''
    if (raw) out.push(resolveEditPath(raw, cwd))
  }
  return out
}

/** True if a user message body is just /clear, /export, etc. (slash command). */
function isSlashCommand(body: string): { is: boolean; name?: string } {
  const m = /<command-name>([^<]+)<\/command-name>/.exec(body)
  if (m) return { is: true, name: m[1].trim() }
  return { is: false }
}

function isLocalCommandCaveat(body: string): boolean {
  return body.startsWith('<local-command-caveat>')
}

function isAutoCommit(body: string): boolean {
  return body.startsWith('You are writing a git commit message')
}

function isTelegram(body: string): boolean {
  return body.includes('TELEGRAM MODE')
}

interface UserMsgScan {
  count: number
  substantiveTopic: string
  fallbackTopic: string
}

function emptyScan(): UserMsgScan {
  return { count: 0, substantiveTopic: '', fallbackTopic: '' }
}

function ingestUserBody(scan: UserMsgScan, raw: string): void {
  const body = raw.trim()
  if (!body) return
  if (isLocalCommandCaveat(body)) return // caveat doesn't count as a real message
  const slash = isSlashCommand(body)
  if (slash.is) {
    if (!scan.fallbackTopic && slash.name) scan.fallbackTopic = `[${slash.name}]`
    scan.count += 1
    return
  }
  if (isAutoCommit(body)) {
    if (!scan.fallbackTopic) scan.fallbackTopic = '[auto commit message]'
    scan.count += 1
    return
  }
  scan.count += 1
  if (!scan.substantiveTopic) {
    scan.substantiveTopic = body.split('\n')[0].slice(0, 140)
  }
}

interface ParseEnvelope {
  source: NativeSource
  /** Relative path under the source root (e.g. `2026/04/25/rollout-...jsonl`). */
  relPath: string
  /** File mtime in unix seconds. */
  mtime: number
  /** File contents (full JSONL). */
  text: string
}

/** Within a single session file, split into separate "active windows" wherever
 *  consecutive conversation events are this far apart. A 1h+ silence is almost
 *  always "stopped working, came back later" — counting it as one sitting
 *  inflates duration in the day table.
 *
 *  This is the same threshold `buildChains` uses to decide whether two sessions
 *  belong to one chain, and it is deliberately the same constant: a file that
 *  splits into windows here and re-merges into one chain there (or the reverse)
 *  means the two copies have drifted, and nothing in the UI would say so. */
const WINDOW_GAP_MS = IDLE_GAP_MS

/** Cap on a single inter-event gap when summing *active* duration. Windowing
 *  already removes 1h+ idle, but a 40-minute gap inside one sitting is still
 *  mostly you doing something else, and wall-clock start→end counts it in full.
 *  Active duration sums each consecutive gap clamped to this cap, so a long
 *  pause contributes a bounded sliver rather than its whole length. This is the
 *  honest input to the density sparkline, whose entire job is "how much work
 *  happened" — not "how long was the tab open". */
const ACTIVE_GAP_CAP_MS = 5 * 60_000

/** Sum of consecutive event gaps, each clamped to ACTIVE_GAP_CAP_MS. A window
 *  of one event has no gaps and therefore zero active duration. */
function activeDurationOfWindow(win: ConvEvent[]): number {
  let active = 0
  for (let i = 1; i < win.length; i++) {
    active += Math.min(win[i].ts - win[i - 1].ts, ACTIVE_GAP_CAP_MS)
  }
  return active
}

interface ConvEvent {
  ts: number          // unix ms
  isUser: boolean
  body: string        // user message body (empty for assistant events)
  /** The event's own id, when the source emits one (Claude Code puts a `uuid`
   *  on every event; Codex does not). Used to anchor a window's identity to the
   *  message it starts with — see `winSessionId` below. */
  uid?: string
}

/**
 * Parse a JSONL session file into one ParsedSession per active window. A file
 * with a long idle gap (>WINDOW_GAP_MS between consecutive conversation
 * events) becomes multiple entries: `path` (window 0), `path#w1`, `path#w2`...
 * Returns [] when the file has no recognisable events.
 */
export function parseNativeAiSession(env: ParseEnvelope): ParsedSession[] {
  const lines = env.text.split('\n')

  let cwd = ''
  let sessionId = ''
  let model: string | undefined
  // Claude usage is per-turn — we sum. Codex emits running totals — we take last.
  const claudeTotals: SessionTokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    cacheCreation1h: 0,
  }
  let codexTotals: SessionTokens | null = null

  // File-edit provenance: (timestamp, absolute path) of every note the session
  // wrote, so we can attribute exact vault notes to each window below.
  const fileEdits: Array<{ ts: number; path: string }> = []

  const convEvents: ConvEvent[] = []
  const recordConv = (tsStr: string, isUser: boolean, body: string, uid?: string): void => {
    if (!tsStr) return
    const ms = Date.parse(tsStr)
    if (!Number.isFinite(ms)) return
    convEvents.push({ ts: ms, isUser, body, uid })
  }

  for (const raw of lines) {
    if (!raw) continue
    let evt: Record<string, unknown>
    try {
      evt = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }
    const type = String(evt.type ?? '')
    const ts = typeof evt.timestamp === 'string' ? evt.timestamp : ''

    // ── Claude Code event shape ─────────────────────────────────────────────
    if (env.source === 'claude') {
      if (!cwd && typeof evt.cwd === 'string') cwd = evt.cwd
      if (!sessionId && typeof evt.sessionId === 'string') sessionId = evt.sessionId

      if (type === 'user') {
        const message = evt.message as Record<string, unknown> | undefined
        const content = message ? message.content : undefined
        const body = flattenContent(content)
        recordConv(ts, true, body, typeof evt.uuid === 'string' ? evt.uuid : undefined)
      }
      if (type === 'assistant') {
        const message = evt.message as Record<string, unknown> | undefined
        if (message && typeof message.model === 'string') model = message.model
        const usage = message ? (message.usage as Record<string, unknown> | undefined) : undefined
        if (usage) {
          claudeTotals.input += numericField(usage, 'input_tokens')
          claudeTotals.output += numericField(usage, 'output_tokens')
          claudeTotals.cacheRead += numericField(usage, 'cache_read_input_tokens')
          claudeTotals.cacheCreation += numericField(usage, 'cache_creation_input_tokens')
          // Anthropic reports the TTL breakdown of cache creation in a nested
          // object: `cache_creation.ephemeral_1h_input_tokens` (2.0x input price)
          // vs `ephemeral_5m_input_tokens` (1.25x). Without this, sessions that
          // hit the 1h cache were underbilled by ~40%.
          const cacheCreationDetail = usage.cache_creation as Record<string, unknown> | undefined
          if (cacheCreationDetail) {
            claudeTotals.cacheCreation1h =
              (claudeTotals.cacheCreation1h ?? 0) +
              numericField(cacheCreationDetail, 'ephemeral_1h_input_tokens')
          }
        }
        const editPaths = extractEditedPaths(message?.content, cwd)
        if (editPaths.length > 0) {
          const editMs = Date.parse(ts)
          if (Number.isFinite(editMs)) {
            for (const p of editPaths) fileEdits.push({ ts: editMs, path: p })
          }
        }
        recordConv(ts, false, '', typeof evt.uuid === 'string' ? evt.uuid : undefined)
      }
    }

    // ── Codex event shape ───────────────────────────────────────────────────
    if (env.source === 'codex') {
      const payload = (evt.payload as Record<string, unknown> | undefined) ?? {}
      if (type === 'session_meta') {
        if (typeof payload.cwd === 'string') cwd = payload.cwd
        if (typeof payload.id === 'string') sessionId = payload.id
        continue
      }
      if (type === 'turn_context' && typeof payload.model === 'string') {
        model = payload.model
      }
      if (type === 'event_msg') {
        const ep = payload as Record<string, unknown>
        if (ep.type === 'token_count') {
          const info = ep.info as Record<string, unknown> | undefined
          const total = info?.total_token_usage as Record<string, unknown> | undefined
          if (total) {
            // Codex semantics differ from Claude:
            //   - `input_tokens` is the TOTAL input including cache hits
            //     (Claude's `input_tokens` is fresh-only with cache as a sibling).
            //   - `cached_input_tokens` is a SUBSET of `input_tokens`.
            //   - `reasoning_output_tokens` is billed at the output rate but
            //     reported separately from `output_tokens`.
            // We normalize to Claude's disjoint-bucket convention so the shared
            // cost math (estimateCostUsd) doesn't double-count cache reads.
            const totalInput = numericField(total, 'input_tokens')
            const cached = numericField(total, 'cached_input_tokens')
            const freshInput = Math.max(0, totalInput - cached)
            const output = numericField(total, 'output_tokens')
            const reasoning = numericField(total, 'reasoning_output_tokens')
            // Running totals — overwrite each time so we end with the last seen.
            codexTotals = {
              input: freshInput,
              output: output + reasoning,
              cacheRead: cached,
              cacheCreation: 0, // Codex doesn't split out cache creation
            }
          }
        }
      }
      // Only actual conversation events count toward windowing. Background
      // emissions (`token_count`, `turn_context`, `task_started/complete`) fire
      // at idle moments and would mask a real user-side gap.
      //
      // Codex emits the *same* user/assistant turn twice — once as a
      // `response_item` with role and structured content, and again as an
      // `event_msg` with a flat `payload.message` string. We use the event_msg
      // form as the canonical body source (cleaner text, free of wrappers like
      // <environment_context>) and treat response_item as windowing-only so
      // `userMsgCount` doesn't double.
      const payloadType = String((payload as Record<string, unknown>).type ?? '')
      const isUserEventMsg = type === 'event_msg' && payloadType === 'user_message'
      const isAgentEventMsg = type === 'event_msg' && payloadType === 'agent_message'
      const isUserResponseItem =
        type === 'response_item' &&
        payloadType === 'message' &&
        typeof payload.role === 'string' &&
        payload.role === 'user'
      const isAgentResponseItem =
        type === 'response_item' &&
        payloadType === 'message' &&
        typeof payload.role === 'string' &&
        payload.role === 'assistant'
      const isUser = isUserEventMsg || isUserResponseItem
      const isAgent = isAgentEventMsg || isAgentResponseItem
      if (ts && (isUser || isAgent)) {
        let body = ''
        // Only ingest body from event_msg.user_message — it's the canonical
        // user-input form. response_item user messages carry env-context
        // wrappers we'd otherwise dedupe out, and they'd double the count.
        if (isUserEventMsg) {
          if (typeof payload.message === 'string') body = payload.message
          else if (typeof payload.text === 'string') body = payload.text
          else if (Array.isArray(payload.content)) body = flattenContent(payload.content)
          else if (typeof payload.content === 'string') body = payload.content
        }
        recordConv(ts, isUserEventMsg, body)
      }
    }
  }

  // Fall back to filename-derived sessionId if the file didn't yield one.
  if (!sessionId) {
    const base = env.relPath.split('/').pop() ?? ''
    const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(base)
    if (m) sessionId = m[1]
  }
  if (!sessionId) return []
  if (convEvents.length === 0) return []

  // Events arrive in file order, which is chronological for both formats. Belt
  // and braces: sort defensively before windowing.
  convEvents.sort((a, b) => a.ts - b.ts)

  // ── Window split: break wherever the gap to the previous event exceeds the
  // idle threshold. Each window is a contiguous run of conversation events.
  const windows: ConvEvent[][] = []
  let cur: ConvEvent[] = []
  for (const e of convEvents) {
    if (cur.length === 0) {
      cur.push(e)
      continue
    }
    if (e.ts - cur[cur.length - 1].ts > WINDOW_GAP_MS) {
      windows.push(cur)
      cur = [e]
    } else {
      cur.push(e)
    }
  }
  if (cur.length > 0) windows.push(cur)

  const sourceTag: ActivitySource = env.source === 'codex' ? 'codex' : 'claude-code'
  const basePath = `native/${env.source}/${env.relPath}`
  const baseId = sessionId.toLowerCase()

  // Tokens land on the first window only — we can't reliably attribute usage
  // per-window (claude usage tags assistant turns, codex emits running totals)
  // without re-running the math against assistant timestamps. Keeping total on
  // window 0 is faithful to "session-level cost" while letting later windows
  // render with zero token noise.
  const tokensForFirstWindow =
    env.source === 'claude'
      ? (claudeTotals.input || claudeTotals.output ? claudeTotals : undefined)
      : codexTotals ?? undefined

  const out: ParsedSession[] = []
  windows.forEach((win, idx) => {
    const scan = emptyScan()
    let winHadClear = false
    let winHadTelegram = false
    let winHadAutoCommit = false
    for (const e of win) {
      if (!e.isUser) continue
      if (/<command-name>\/clear<\/command-name>/.test(e.body)) winHadClear = true
      if (isAutoCommit(e.body)) winHadAutoCommit = true
      if (isTelegram(e.body)) winHadTelegram = true
      ingestUserBody(scan, e.body)
    }

    let project: string
    if (winHadAutoCommit) project = '[auto-commit]'
    else if (winHadTelegram) project = '[telegram]'
    else project = classifyCwd(cwd)

    const startedIso = new Date(win[0].ts).toISOString()
    const endedIso = new Date(win[win.length - 1].ts).toISOString()
    const topic = scan.substantiveTopic || scan.fallbackTopic || '(no user message)'
    const isFirst = idx === 0
    // `path` keeps the ordinal `#wN` — it is a display handle and a way back to
    // the file, never an address.
    const path = isFirst ? basePath : `${basePath}#w${idx}`
    // IDENTITY. Anchored to the first event of the window, not to the window's
    // rank among windows.
    //
    // `::w${idx}` was an ordinal, which is a *position* — the same class of
    // value as the `chainId` this stack was just rebuilt to stop using as an
    // address. Under append-only growth an ordinal is stable (a new gap can only
    // open at the end), but it shifts whenever the windowing itself changes:
    // `IDLE_GAP_HOURS` moving, or Claude Code pruning events out of the middle
    // of a transcript. When it shifts, `::w1` starts naming what `::w2` named.
    //
    // Title and summary survive that — the freshness hash covers the window
    // bounds and message count, so they regenerate. The `undertaking` field does
    // not: it is human judgment, it is not recomputable, and a silent slide onto
    // a different span of work is precisely the misattribution this refactor
    // exists to make unrepresentable.
    //
    // An event uuid is stratum-1 — Claude Code writes one on every event — so a
    // window identified by the message it *starts with* is the same window
    // whatever index the splitter later gives it. Codex emits no per-event id,
    // so its windows fall back to the first event's timestamp: still a property
    // of the content rather than of the ordering.
    //
    // Window 0 deliberately keeps the bare session id. That is load-bearing:
    // `aiActivityCacheBlock` dedups a vault-markdown session against its native
    // twin by comparing full ids, and a vault row carries the plain uuid — so
    // suffixing window 0 would make every windowed session appear twice. It is
    // also the honest name, since window 0 is where the session begins.
    //
    // ⚠ Changing anything this function *emits* requires bumping CACHE_VERSION
    // in `aiActivityCacheBlock`. Parsed sessions are cached against the file's
    // mtime, which tracks the input and says nothing about the code that read
    // it — so a parser change alone leaves every cached row exactly as it was.
    // That is how this very fix shipped inert: the ids kept their old `::wN`
    // form because no transcript had changed. Every entry in that version list
    // (v12, v13, v15, v16, v18) is the same lesson already learned once.
    const winAnchor = win[0].uid ?? String(win[0].ts)
    const winSessionId = isFirst ? baseId : `${baseId}::${winAnchor}`

    // Attribute edits to the window whose time span contains them.
    const winStart = win[0].ts
    const winEnd = win[win.length - 1].ts
    const touchedPaths = Array.from(
      new Set(fileEdits.filter(e => e.ts >= winStart && e.ts <= winEnd).map(e => e.path)),
    )

    out.push({
      path,
      source: sourceTag,
      startedIso,
      endedIso,
      project,
      cwd: cwd || undefined,
      userMsgCount: scan.count,
      topic,
      hadClear: winHadClear,
      mtime: env.mtime,
      tokens: isFirst ? tokensForFirstWindow : undefined,
      model,
      sessionId: winSessionId,
      touchedPaths: touchedPaths.length > 0 ? touchedPaths : undefined,
      activeDurationMs: activeDurationOfWindow(win),
    } as ParsedSession & { sessionId?: string } as ParsedSession)
  })

  return out
}

/** Extract the session id from a ParsedSession. Prefers the explicit
 *  `sessionId` field (full UUID extracted at parse time); falls back to path-
 *  based heuristics for older cached entries. */
export function sessionIdOf(session: ParsedSession): string {
  if (session.sessionId) return session.sessionId
  const base = session.path.split('/').pop() ?? session.path
  // Native: <uuid>.jsonl or rollout-...-<uuid>.jsonl
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(base)
  if (uuid) return uuid[1].toLowerCase()
  // Vault: <date>_<8-hex>.md  → return the 8-hex (will be matched against the
  // first 8 chars of any native UUID during dedup).
  const short = /_(\b[0-9a-f]{8}\b)\.(md|txt)$/i.exec(base)
  if (short) return short[1].toLowerCase()
  return session.path
}
