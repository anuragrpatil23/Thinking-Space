// Native AI transcript JSONL → structured items, for the chain drawer.
//
// The drawer used to flatten every transcript into one markdown string, and
// that string is where all the structure died: a 40-line paste became 40 big
// paragraphs, `<system-reminder>` blocks read as if the user typed them, and
// tool calls were dropped outright — so the most useful thing in the file
// (which files the agent created and edited) was the one thing you could not
// see. Items keep each kind distinct so the reader can give each its own look.
//
// Memory: tool *inputs* are summarised to a target string and tool *outputs*
// to a short preview. A 100-message session carries megabytes of file dumps in
// its results, and holding those for a read-only drawer is exactly the
// WebContent kill IOS-MEMORY.md describes.
//
// Pure — no I/O, no React. Window clipping matches `extractSessionContextBlock`:
// an event belongs to the window whose bounds contain it, inclusive both ends;
// undated events are kept (absence of a timestamp is not evidence of falling
// outside).

export interface TranscriptPasteBlock {
  /** 1-based within the turn, matching Claude Code's "[Pasted text #N]". */
  n: number
  body: string
  lines: number
}

export type TranscriptSegmentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'paste'; paste: TranscriptPasteBlock }

export type TranscriptFileChangeBlock = 'created' | 'edited' | 'read'

export interface TranscriptToolBlock {
  id: string
  /** Display name as Claude Code shows it: `Read`, `Bash`, `Claude Docs - batch (MCP)`. */
  name: string
  /** What the call was aimed at: a relative path, a command, a pattern. */
  target: string
  /** Coarse class for the folded summary line. */
  verb: 'read' | 'edit' | 'create' | 'run' | 'search' | 'web' | 'agent' | 'other'
  /** Vault/repo-relative when the session cwd is a prefix; absolute otherwise. */
  file?: string
  /** The absolute path, when known — for opening the file in the app. */
  abs?: string
  added?: number
  removed?: number
  /** Unified-diff lines (`+`/`-`/` `, `@@` between hunks), capped at
   *  DIFF_LINES — enough to see the change, never the whole file. */
  diff?: string[]
  /** Lines of diff past the cap. */
  diffMore?: number
  /** Claude subagent id — its own transcript is `<sid>/subagents/agent-<id>.jsonl`. */
  agentId?: string
  /** One-line `⎿` result, e.g. "Added 12 lines, removed 3" or the first output line. */
  result?: string
  isError?: boolean
}

/** Token counts in the shape `aiPriceTableBlock` prices. */
export interface TranscriptTokensBlock {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  cacheCreation1h?: number
}

/** What one prompt cost: every response it caused, until the next prompt, by model. */
export type TranscriptUsageBlock = Record<string, TranscriptTokensBlock>

export type TranscriptItemBlock =
  | { kind: 'user'; ts: number | null; segments: TranscriptSegmentBlock[]; usage?: TranscriptUsageBlock }
  | { kind: 'assistant'; ts: number | null; text: string }
  | { kind: 'tool'; ts: number | null; tool: TranscriptToolBlock }
  | { kind: 'command'; ts: number | null; name: string; args: string }
  | { kind: 'compacted'; ts: number | null }

export interface TranscriptFileTouchBlock {
  path: string
  abs?: string
  change: TranscriptFileChangeBlock
  added: number
  removed: number
  /** How many tool calls touched it (edits + writes, or reads for a read-only file). */
  ops: number
  /** Item index of the first create/edit (or read) — the jump target. */
  firstItem: number
}

export interface TranscriptSummaryBlock {
  files: TranscriptFileTouchBlock[]
  /** Whole-session tokens by model — the sum of every prompt's `usage`. */
  usage: TranscriptUsageBlock
  prompts: number
  toolCalls: number
  commands: number
  errors: number
}

export interface ParsedTranscriptBlock {
  items: TranscriptItemBlock[]
  summary: TranscriptSummaryBlock
}

export interface TranscriptWindowBlock {
  startMs: number
  endMs: number
}

export interface ParseTranscriptOptionsBlock {
  /** A subagent's own file is all sidechain events; read them instead of skipping. */
  sidechain?: boolean
}

const RESULT_PREVIEW_CHARS = 240
const COMMAND_CHARS = 1200
const DIFF_LINES = 40
const UNKNOWN_MODEL = 'unknown'

/** Harness-injected wrappers that are never the user's own words. */
const NOISE_TAGS = [
  'system-reminder',
  'local-command-caveat',
  'local-command-stdout',
  'local-command-stderr',
  'command-message',
  'task-notification',
  'environment_context',
  'user_instructions',
  'app-context',
  'ide_opened_file',
  'ide_selection',
  'user-prompt-submit-hook',
]
const NOISE_RE = new RegExp(`<(${NOISE_TAGS.join('|')})(\\s[^>]*)?>[\\s\\S]*?</\\1>`, 'g')
const PASTE_RE = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content\b[^>]*>/g
const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/

function tsOf(ev: Record<string, unknown>): number | null {
  if (typeof ev.timestamp !== 'string') return null
  const t = Date.parse(ev.timestamp)
  return Number.isFinite(t) ? t : null
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function firstLine(s: string): string {
  const line = s.split('\n').find(l => l.trim()) ?? ''
  return clip(line.trim(), RESULT_PREVIEW_CHARS)
}

/** Relative to the session cwd when inside it; otherwise the scratchpad and the
 *  home directory are abbreviated, because a 120-char temp path truncates to
 *  nothing in a narrow drawer. */
function relPath(p: string, cwd: string | null): string {
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  return p
    .replace(/^\/(private\/)?tmp\/claude-[^/]+\/.*?\/scratchpad\//, 'scratchpad/')
    .replace(/^\/Users\/[^/]+\//, '~/')
}

function capDiff(lines: string[]): { diff: string[]; diffMore?: number } {
  if (lines.length <= DIFF_LINES) return { diff: lines }
  return { diff: lines.slice(0, DIFF_LINES), diffMore: lines.length - DIFF_LINES }
}

function num(o: Record<string, unknown> | undefined, k: string): number {
  const v = o?.[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Anthropic `usage` → priced shape, splitting out 1h cache writes (2× input). */
function claudeTokens(usage: Record<string, unknown>): TranscriptTokensBlock {
  const detail = usage.cache_creation as Record<string, unknown> | undefined
  return {
    input: num(usage, 'input_tokens'),
    output: num(usage, 'output_tokens'),
    cacheRead: num(usage, 'cache_read_input_tokens'),
    cacheCreation: num(usage, 'cache_creation_input_tokens'),
    cacheCreation1h: detail ? num(detail, 'ephemeral_1h_input_tokens') : 0,
  }
}

export function addUsageBlock(into: TranscriptUsageBlock, model: string, t: TranscriptTokensBlock): void {
  const cur = into[model] ?? (into[model] = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation1h: 0 })
  cur.input += t.input
  cur.output += t.output
  cur.cacheRead += t.cacheRead
  cur.cacheCreation += t.cacheCreation
  cur.cacheCreation1h = (cur.cacheCreation1h ?? 0) + (t.cacheCreation1h ?? 0)
}

/** User text → ordered text/paste segments, with harness noise removed. */
export function splitUserTextBlock(raw: string): TranscriptSegmentBlock[] {
  const text = raw.replace(NOISE_RE, '')
  const segments: TranscriptSegmentBlock[] = []
  let n = 0
  let last = 0
  for (const m of text.matchAll(PASTE_RE)) {
    const before = text.slice(last, m.index).trim()
    if (before) segments.push({ kind: 'text', text: before })
    const body = m[1].trim()
    if (body) segments.push({ kind: 'paste', paste: { n: ++n, body, lines: body.split('\n').length } })
    last = (m.index ?? 0) + m[0].length
  }
  const rest = text.slice(last).trim()
  if (rest) segments.push({ kind: 'text', text: rest })
  return segments
}

function textParts(content: unknown, types: string[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const out: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    if (types.includes(String(p.type)) && typeof p.text === 'string') out.push(p.text)
  }
  return out.join('\n')
}

/** Claude Code's display name for a tool: MCP tools read "Server - tool (MCP)". */
function displayName(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  if (!mcp) return name
  const server = mcp[1].replace(/^claude_ai_/, '').replace(/_/g, ' ')
  return `${server} - ${mcp[2]} (MCP)`
}

/** A tool_use → its row, minus result. Only targets are kept, never payloads. */
function describeClaudeTool(
  id: string,
  name: string,
  input: Record<string, unknown>,
  cwd: string | null,
): TranscriptToolBlock {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const fp = str('file_path') || str('notebook_path')
  const base = { id, name: displayName(name), ...(fp.startsWith('/') ? { abs: fp } : {}) }
  switch (name) {
    case 'Read':
      return { ...base, verb: 'read', target: relPath(str('file_path'), cwd), file: relPath(str('file_path'), cwd) }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const p = relPath(str('file_path') || str('notebook_path'), cwd)
      return { ...base, verb: 'edit', target: p, file: p }
    }
    case 'Write': {
      const p = relPath(str('file_path'), cwd)
      // `create` vs `update` arrives on the result; edit until then.
      return { ...base, verb: 'edit', target: p, file: p }
    }
    case 'Bash':
      return { ...base, verb: 'run', target: clip(str('command'), COMMAND_CHARS) }
    case 'Grep':
      return { ...base, verb: 'search', target: str('pattern') + (str('path') ? ` in ${relPath(str('path'), cwd)}` : '') }
    case 'Glob':
      return { ...base, verb: 'search', target: str('pattern') }
    case 'WebFetch':
      return { ...base, verb: 'web', target: str('url') }
    case 'WebSearch':
      return { ...base, verb: 'web', target: str('query') }
    case 'Task':
    case 'Agent':
      // Claude Code titles a subagent row by its type: `Explore(description)`.
      return { ...base, name: str('subagent_type') || name, verb: 'agent', target: str('description') }
    case 'Skill':
      return { ...base, verb: 'other', target: str('skill') }
    case 'TodoWrite':
      return { ...base, name: 'Update Todos', verb: 'other', target: '' }
    default: {
      // Unknown tools: the first short string argument is usually the subject.
      const first = Object.values(input).find(v => typeof v === 'string' && v.length < 200) as string | undefined
      return { ...base, verb: 'other', target: first ?? '' }
    }
  }
}

/** Fold a Claude tool result into its row: line counts, create/update, a preview. */
function applyClaudeResult(
  tool: TranscriptToolBlock,
  block: Record<string, unknown>,
  rich: unknown,
): void {
  tool.isError = block.is_error === true
  const r = rich && typeof rich === 'object' ? (rich as Record<string, unknown>) : null

  if (r && Array.isArray(r.structuredPatch)) {
    let added = 0
    let removed = 0
    const lines: string[] = []
    for (const hunk of r.structuredPatch as Array<{ lines?: unknown }>) {
      if (!Array.isArray(hunk?.lines)) continue
      if (lines.length) lines.push('@@')
      for (const l of hunk.lines) {
        if (typeof l !== 'string') continue
        lines.push(l)
        if (l.startsWith('+')) added++
        else if (l.startsWith('-')) removed++
      }
    }
    if (r.type === 'create') {
      tool.verb = 'create'
      const body = typeof r.content === 'string' ? r.content.split('\n') : []
      added = body.length || added
      Object.assign(tool, capDiff(body.map(l => `+${l}`)))
    } else {
      Object.assign(tool, capDiff(lines))
    }
    tool.added = added
    tool.removed = removed
    tool.result = r.type === 'create'
      ? `Wrote ${added} line${added === 1 ? '' : 's'}`
      : `Added ${added} line${added === 1 ? '' : 's'}, removed ${removed}`
    return
  }

  if (tool.verb === 'agent' && r && typeof r.agentId === 'string') tool.agentId = r.agentId
  if (tool.verb === 'agent' && r?.status === 'async_launched') {
    tool.result = 'Running in the background'
    return
  }
  if (tool.verb === 'agent' && r && typeof r.totalToolUseCount === 'number') {
    const uses = r.totalToolUseCount
    const ms = typeof r.totalDurationMs === 'number' ? r.totalDurationMs : 0
    const dur = ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : ms ? `${Math.round(ms / 1000)}s` : ''
    tool.result = `Done (${uses} tool use${uses === 1 ? '' : 's'}${dur ? ` · ${dur}` : ''})`
    return
  }

  const raw = typeof block.content === 'string'
    ? block.content
    : textParts(block.content, ['text'])
  if (tool.verb === 'read' && !tool.isError) {
    const n = raw ? raw.split('\n').length : 0
    tool.result = n ? `Read ${n} lines` : undefined
    return
  }
  const preview = firstLine(raw.replace(NOISE_RE, ''))
  tool.result = preview || (tool.isError ? 'Error' : undefined)
}

/** Codex `apply_patch` carries its own file list in the patch header lines. */
interface CodexPatchFile { path: string; abs: string; created: boolean; added: number; removed: number; lines: string[] }

function codexPatchFiles(patch: string, cwd: string | null): CodexPatchFile[] {
  const out: CodexPatchFile[] = []
  let cur: CodexPatchFile | null = null
  for (const line of patch.split('\n')) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (m) {
      const raw = m[2].trim()
      const abs = raw.startsWith('/') || !cwd ? raw : `${cwd}/${raw}`
      cur = { path: relPath(abs, cwd), abs, created: m[1] === 'Add', added: 0, removed: 0, lines: [] }
      out.push(cur)
      continue
    }
    if (!cur || line.startsWith('*** ')) continue
    if (line.startsWith('@@')) { if (cur.lines.length) cur.lines.push('@@'); continue }
    cur.lines.push(line)
    if (line.startsWith('+')) cur.added++
    else if (line.startsWith('-')) cur.removed++
  }
  return out
}

function describeCodexCall(
  id: string,
  name: string,
  input: string,
  cwd: string | null,
): TranscriptToolBlock[] {
  if (name === 'apply_patch' || input.includes('*** Begin Patch')) {
    const files = codexPatchFiles(input, cwd)
    if (files.length) {
      return files.map((f, i) => ({
        id: `${id}#${i}`,
        name: f.created ? 'Write' : 'Edit',
        verb: f.created ? 'create' : 'edit',
        target: f.path,
        file: f.path,
        abs: f.abs,
        ...capDiff(f.lines),
        added: f.added,
        removed: f.removed,
        result: f.created
          ? `Wrote ${f.added} lines`
          : `Added ${f.added} line${f.added === 1 ? '' : 's'}, removed ${f.removed}`,
      }))
    }
  }
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(input) as Record<string, unknown> }
  catch { /* custom tools take free text */ }
  const cmd = args.cmd ?? args.command
  const shell = Array.isArray(cmd) ? cmd.join(' ') : typeof cmd === 'string' ? cmd : null
  if (shell || name === 'shell' || name === 'exec_command' || name === 'exec') {
    const target = shell ?? (/cmd:\s*"([^"]+)"/.exec(input)?.[1] ?? firstLine(input))
    return [{ id, name: 'Bash', verb: 'run', target: clip(target, COMMAND_CHARS) }]
  }
  const title = typeof args.title === 'string' ? args.title : firstLine(input)
  return [{ id, name, verb: 'other', target: clip(title, 200) }]
}

/**
 * Parse a native transcript. `window` clips to one sitting; pass null for the
 * whole file.
 */
export function parseTranscriptEventsBlock(
  jsonl: string,
  window: TranscriptWindowBlock | null,
  options: ParseTranscriptOptionsBlock = {},
): ParsedTranscriptBlock {
  const items: TranscriptItemBlock[] = []
  /** Usage lands on the most recent prompt; before the first one it is held
   *  here so a window that opens mid-turn still counts what it saw. */
  const leadingUsage: TranscriptUsageBlock = {}
  let usageTarget: TranscriptUsageBlock = leadingUsage
  const seenUsage = new Set<string>()
  let codexModel = UNKNOWN_MODEL
  const pushUser = (ts: number | null, segments: TranscriptSegmentBlock[]) => {
    const usage: TranscriptUsageBlock = {}
    items.push({ kind: 'user', ts, segments, usage })
    usageTarget = usage
  }
  /** tool_use id → the rows its result should update. */
  const pending = new Map<string, TranscriptToolBlock[]>()
  let cwd: string | null = null

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let ev: Record<string, unknown>
    try { ev = JSON.parse(line) }
    catch { continue }

    if (typeof ev.cwd === 'string' && !cwd) cwd = ev.cwd
    const payload = ev.payload as Record<string, unknown> | undefined
    if (ev.type === 'turn_context' && payload && typeof payload.cwd === 'string') cwd = payload.cwd
    if (ev.type === 'turn_context' && payload && typeof payload.model === 'string') codexModel = payload.model
    if (ev.type === 'session_meta' && payload && typeof payload.cwd === 'string' && !cwd) cwd = payload.cwd

    const ts = tsOf(ev)
    if (window && ts !== null && (ts < window.startMs || ts > window.endMs)) continue

    const type = String(ev.type ?? '')

    // ── Claude ────────────────────────────────────────────────────────────
    if (type === 'user' || type === 'assistant') {
      // Subagent traffic and harness meta-turns are not the conversation.
      if ((ev.isSidechain === true && !options.sidechain) || ev.isMeta === true) continue
      if (ev.isCompactSummary === true) {
        items.push({ kind: 'compacted', ts })
        continue
      }
      const msg = ev.message as Record<string, unknown> | undefined
      const content = msg?.content

      if (type === 'user') {
        if (Array.isArray(content)) {
          for (const part of content) {
            const p = part as Record<string, unknown>
            if (p?.type !== 'tool_result') continue
            const rows = pending.get(String(p.tool_use_id))
            if (rows) for (const row of rows) applyClaudeResult(row, p, ev.toolUseResult)
            // A subagent's spend is reported on its result, not in this file.
            const rich = ev.toolUseResult as Record<string, unknown> | undefined
            if (rows?.[0]?.verb === 'agent' && rich?.usage && typeof rich.usage === 'object') {
              const model = typeof rich.resolvedModel === 'string' ? rich.resolvedModel : UNKNOWN_MODEL
              addUsageBlock(usageTarget, model, claudeTokens(rich.usage as Record<string, unknown>))
            }
          }
        }
        const raw = textParts(content, ['text'])
        if (!raw) continue
        const cmd = COMMAND_NAME_RE.exec(raw)
        if (cmd) {
          items.push({ kind: 'command', ts, name: cmd[1].trim(), args: (COMMAND_ARGS_RE.exec(raw)?.[1] ?? '').trim() })
          continue
        }
        const segments = splitUserTextBlock(raw)
        if (segments.length) pushUser(ts, segments)
        continue
      }

      // assistant — one response spans several lines that repeat its usage.
      const usage = msg?.usage as Record<string, unknown> | undefined
      const usageKey = typeof ev.requestId === 'string' ? ev.requestId : typeof msg?.id === 'string' ? msg.id : null
      if (usage && !(usageKey && seenUsage.has(usageKey))) {
        if (usageKey) seenUsage.add(usageKey)
        addUsageBlock(usageTarget, typeof msg?.model === 'string' ? msg.model : UNKNOWN_MODEL, claudeTokens(usage))
      }
      if (typeof content === 'string') {
        if (content.trim()) items.push({ kind: 'assistant', ts, text: content.trim() })
        continue
      }
      if (!Array.isArray(content)) continue
      for (const part of content) {
        const p = part as Record<string, unknown>
        if (p?.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
          items.push({ kind: 'assistant', ts, text: p.text.trim() })
        } else if (p?.type === 'tool_use') {
          const tool = describeClaudeTool(
            String(p.id),
            String(p.name ?? 'tool'),
            (p.input as Record<string, unknown>) ?? {},
            cwd,
          )
          pending.set(tool.id, [tool])
          items.push({ kind: 'tool', ts, tool })
        }
      }
      continue
    }

    // ── Codex ─────────────────────────────────────────────────────────────
    if (type === 'compacted') {
      items.push({ kind: 'compacted', ts })
      continue
    }
    if (type === 'event_msg' && payload?.type === 'token_count') {
      // `cached_input_tokens` is a subset of `input_tokens`.
      const last = (payload.info as Record<string, unknown> | undefined)?.last_token_usage as Record<string, unknown> | undefined
      if (last) {
        const cached = num(last, 'cached_input_tokens')
        addUsageBlock(usageTarget, codexModel, {
          input: Math.max(0, num(last, 'input_tokens') - cached),
          output: num(last, 'output_tokens'),
          cacheRead: cached,
          cacheCreation: 0,
        })
      }
      continue
    }
    if (type !== 'response_item' || !payload) continue
    if (payload.type === 'message') {
      if (payload.role === 'assistant') {
        const text = textParts(payload.content, ['output_text', 'text']).trim()
        if (text) items.push({ kind: 'assistant', ts, text })
      } else if (payload.role === 'user') {
        const segments = splitUserTextBlock(textParts(payload.content, ['input_text', 'text']))
        if (segments.length) pushUser(ts, segments)
      }
      continue
    }
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const id = String(payload.call_id ?? payload.id ?? items.length)
      const input = typeof payload.arguments === 'string'
        ? payload.arguments
        : typeof payload.input === 'string' ? payload.input : ''
      const rows = describeCodexCall(id, String(payload.name ?? 'tool'), input, cwd)
      pending.set(id, rows)
      for (const tool of rows) items.push({ kind: 'tool', ts, tool })
      continue
    }
    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const rows = pending.get(String(payload.call_id))
      if (!rows || rows.some(r => r.file)) continue
      const out = typeof payload.output === 'string'
        ? payload.output
        : textParts(payload.output, ['input_text', 'output_text', 'text'])
      // Codex prefixes "Wall time …\nOutput:" — the content starts after it.
      const body = out.replace(/^[\s\S]*?Output:\n?/, '')
      for (const row of rows) row.result = firstLine(body) || undefined
    }
  }

  const summary = summarizeTranscriptBlock(items)
  for (const [model, t] of Object.entries(leadingUsage)) addUsageBlock(summary.usage, model, t)
  return { items, summary }
}

export function summarizeTranscriptBlock(items: TranscriptItemBlock[]): TranscriptSummaryBlock {
  const files = new Map<string, TranscriptFileTouchBlock>()
  let prompts = 0
  let toolCalls = 0
  let commands = 0
  let errors = 0

  items.forEach((item, i) => {
    if (item.kind === 'user') prompts++
    if (item.kind !== 'tool') return
    const t = item.tool
    toolCalls++
    if (t.verb === 'run') commands++
    if (t.isError) errors++
    if (!t.file || t.isError) return

    const change: TranscriptFileChangeBlock =
      t.verb === 'create' ? 'created' : t.verb === 'edit' ? 'edited' : 'read'
    const prev = files.get(t.file)
    if (!prev) {
      files.set(t.file, {
        path: t.file,
        abs: t.abs,
        change,
        added: t.added ?? 0,
        removed: t.removed ?? 0,
        ops: 1,
        firstItem: i,
      })
      return
    }
    // created > edited > read: a file the session made stays "created" however
    // often it was edited after; a file only read is upgraded on first write,
    // and the jump target moves to that write.
    const rank = { read: 0, edited: 1, created: 2 } as const
    if (change === 'read' && prev.change !== 'read') return
    if (rank[change] > rank[prev.change]) {
      if (prev.change === 'read') {
        prev.firstItem = i
        prev.ops = 0
      }
      prev.change = change
    }
    prev.ops++
    prev.added += t.added ?? 0
    prev.removed += t.removed ?? 0
  })

  const usage: TranscriptUsageBlock = {}
  for (const item of items) {
    if (item.kind !== 'user' || !item.usage) continue
    for (const [model, t] of Object.entries(item.usage)) addUsageBlock(usage, model, t)
  }

  const order = { created: 0, edited: 1, read: 2 } as const
  return {
    usage,
    files: [...files.values()].sort((a, b) =>
      order[a.change] - order[b.change] || a.path.localeCompare(b.path)),
    prompts,
    toolCalls,
    commands,
    errors,
  }
}

function fmtStamp(ts: number | null): string {
  if (ts === null) return ''
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Plain markdown for copying out — same items, so it cannot disagree with the view. */
export function transcriptItemsToMarkdownBlock(items: TranscriptItemBlock[]): string {
  const out: string[] = []
  for (const item of items) {
    const when = fmtStamp(item.ts)
    const stamp = when ? ` · ${when}` : ''
    switch (item.kind) {
      case 'user':
        out.push('---', '', `### User${stamp}`, '')
        for (const seg of item.segments) {
          if (seg.kind === 'text') out.push(seg.text, '')
          else out.push('```', seg.paste.body, '```', '')
        }
        break
      case 'assistant':
        out.push('---', '', `### Assistant${stamp}`, '', item.text, '')
        break
      case 'tool': {
        const t = item.tool
        out.push(`- \`${t.name}(${t.target.split('\n')[0]})\`${t.result ? ` — ${t.result}` : ''}`)
        break
      }
      case 'command':
        out.push(`> \`${item.name}${item.args ? ` ${item.args}` : ''}\``, '')
        break
      case 'compacted':
        out.push('_Conversation compacted_', '')
        break
    }
  }
  return out.join('\n').trim()
}
