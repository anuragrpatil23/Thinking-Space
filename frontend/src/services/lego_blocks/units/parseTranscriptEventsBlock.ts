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
  added?: number
  removed?: number
  /** One-line `⎿` result, e.g. "Added 12 lines, removed 3" or the first output line. */
  result?: string
  isError?: boolean
}

export type TranscriptItemBlock =
  | { kind: 'user'; ts: number | null; segments: TranscriptSegmentBlock[] }
  | { kind: 'assistant'; ts: number | null; text: string }
  | { kind: 'tool'; ts: number | null; tool: TranscriptToolBlock }
  | { kind: 'command'; ts: number | null; name: string; args: string }
  | { kind: 'compacted'; ts: number | null }

export interface TranscriptFileTouchBlock {
  path: string
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

const RESULT_PREVIEW_CHARS = 240
const COMMAND_CHARS = 1200

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
 *  home directory are abbreviated, because a 120-char iCloud path truncates to
 *  nothing in a narrow drawer. */
function relPath(p: string, cwd: string | null): string {
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  return p
    .replace(/^\/(private\/)?tmp\/claude-[^/]+\/.*?\/scratchpad\//, 'scratchpad/')
    .replace(/^\/Users\/[^/]+\/Library\/Mobile Documents\/iCloud~md~obsidian\/Documents\/[^/]+\//, 'vault/')
    .replace(/^\/Users\/[^/]+\//, '~/')
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
  const base = { id, name: displayName(name) }
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
      return { ...base, verb: 'agent', target: str('description') || str('subagent_type') }
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
    for (const hunk of r.structuredPatch as Array<{ lines?: unknown }>) {
      if (!Array.isArray(hunk?.lines)) continue
      for (const l of hunk.lines) {
        if (typeof l !== 'string') continue
        if (l.startsWith('+')) added++
        else if (l.startsWith('-')) removed++
      }
    }
    if (r.type === 'create') {
      tool.verb = 'create'
      added = typeof r.content === 'string' ? r.content.split('\n').length : added
    }
    tool.added = added
    tool.removed = removed
    tool.result = r.type === 'create'
      ? `Wrote ${added} line${added === 1 ? '' : 's'}`
      : `Added ${added} line${added === 1 ? '' : 's'}, removed ${removed}`
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
function codexPatchFiles(patch: string, cwd: string | null): Array<{ path: string; created: boolean; added: number; removed: number }> {
  const out: Array<{ path: string; created: boolean; added: number; removed: number }> = []
  let cur: (typeof out)[number] | null = null
  for (const line of patch.split('\n')) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (m) {
      cur = { path: relPath(m[2].trim(), cwd), created: m[1] === 'Add', added: 0, removed: 0 }
      out.push(cur)
      continue
    }
    if (!cur) continue
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
): ParsedTranscriptBlock {
  const items: TranscriptItemBlock[] = []
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
    if (ev.type === 'session_meta' && payload && typeof payload.cwd === 'string' && !cwd) cwd = payload.cwd

    const ts = tsOf(ev)
    if (window && ts !== null && (ts < window.startMs || ts > window.endMs)) continue

    const type = String(ev.type ?? '')

    // ── Claude ────────────────────────────────────────────────────────────
    if (type === 'user' || type === 'assistant') {
      // Subagent traffic and harness meta-turns are not the conversation.
      if (ev.isSidechain === true || ev.isMeta === true) continue
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
        if (segments.length) items.push({ kind: 'user', ts, segments })
        continue
      }

      // assistant
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
    if (type !== 'response_item' || !payload) continue
    if (payload.type === 'message') {
      if (payload.role === 'assistant') {
        const text = textParts(payload.content, ['output_text', 'text']).trim()
        if (text) items.push({ kind: 'assistant', ts, text })
      } else if (payload.role === 'user') {
        const segments = splitUserTextBlock(textParts(payload.content, ['input_text', 'text']))
        if (segments.length) items.push({ kind: 'user', ts, segments })
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

  return { items, summary: summarizeTranscriptBlock(items) }
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

  const order = { created: 0, edited: 1, read: 2 } as const
  return {
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
