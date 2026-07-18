// Telegram conversation state on disk. Pairs a Telegram chat with a Claude
// Code sessionId so the poller can `claude --resume <sessionId>` when the
// user replies.
//
// Layout (under ~/.thinking-space/state/telegram/):
//   conversations/<convId>.json   — full state for one conv
//   active.json                   — { convId, chatId, scheduleKey } | null
//
// One active conv at a time (single-user assumption per the plan).

// Namespace imports (not named) so Vite's browser externalization doesn't
// fail at build time. Renderer never calls these helpers; they only resolve
// at runtime in Electron-as-Node (CLI) or Electron main.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function stateRoot(): string {
  return path.join(os.homedir(), '.thinking-space', 'state', 'telegram')
}
function convsDir(): string { return path.join(stateRoot(), 'conversations') }
function activePathFor(): string { return path.join(stateRoot(), 'active.json') }
function claudeProjectsRoot(): string { return path.join(os.homedir(), '.claude', 'projects') }
// Vault location where the SessionEnd hook (~/.claude/hooks/render-session.sh)
// writes rendered Claude session markdown. Telegram conversations close with
// deleteClaudeSession=true also nuke the rendered md so the conversation
// leaves no trace in the journal.
function vaultClaudeSessionsRoot(): string {
  return path.join(
    os.homedir(),
    'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents',
    'Long-Term-Memory-iCloud', 'ai-activity', 'raw-sessions', 'claude-code',
  )
}

export type ConversationStatus = 'active' | 'closed'
export type CloseReason = 'wrap_up' | 'ttl' | 'error' | 'manual'

export interface ConversationHistoryEntry {
  direction: 'in' | 'out'
  text: string
  at: string
}

export interface ConversationState {
  convId: string
  chatId: number | string
  scheduleKey: string
  sessionId: string
  cwd: string
  status: ConversationStatus
  startedAt: string
  ttlAt: string
  closedAt?: string
  closeReason?: CloseReason
  history: ConversationHistoryEntry[]
}

export interface ActivePointer {
  convId: string
  chatId: number | string
  scheduleKey: string
}

function ensureDirs(): void {
  fs.mkdirSync(convsDir(), { recursive: true })
}

function convPathFor(convId: string): string {
  return path.join(convsDir(), `${convId}.json`)
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tmp, filePath)
}

export function generateConvIdBlock(): string {
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const slug = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}` +
    `-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 8)
  return `conv-${slug}-${rand}`
}

export function readActivePointerBlock(): ActivePointer | null {
  const p = activePathFor()
  if (!fs.existsSync(p)) return null
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as ActivePointer | null
    return parsed && parsed.convId ? parsed : null
  } catch {
    return null
  }
}

export function writeActivePointerBlock(value: ActivePointer | null): void {
  ensureDirs()
  const p = activePathFor()
  if (value === null) {
    if (fs.existsSync(p)) fs.rmSync(p)
    return
  }
  writeJsonAtomic(p, value)
}

export function readConversationBlock(convId: string): ConversationState | null {
  const filePath = convPathFor(convId)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ConversationState
  } catch {
    return null
  }
}

export function writeConversationBlock(state: ConversationState): void {
  ensureDirs()
  writeJsonAtomic(convPathFor(state.convId), state)
}

export interface OpenConversationInput {
  convId?: string
  chatId: number | string
  scheduleKey: string
  sessionId: string
  cwd?: string
  ttlAt?: string
}

export interface OpenConversationResult {
  convId: string
  convPath: string
  activePath: string
  replacedConvId: string | null
}

function defaultTtlAtBlock(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

export function openConversationBlock(input: OpenConversationInput): OpenConversationResult {
  const convId = input.convId?.trim() || generateConvIdBlock()
  const state: ConversationState = {
    convId,
    chatId: input.chatId,
    scheduleKey: input.scheduleKey,
    sessionId: input.sessionId,
    cwd: input.cwd?.trim() || process.cwd(),
    status: 'active',
    startedAt: new Date().toISOString(),
    ttlAt: input.ttlAt?.trim() || defaultTtlAtBlock(),
    history: [],
  }
  const prior = readActivePointerBlock()
  const replacedConvId = prior && prior.convId !== convId ? prior.convId : null
  if (replacedConvId) {
    try {
      closeConversationBlock({ convId: replacedConvId, reason: 'ttl', deleteClaudeSession: true })
    } catch { /* prior conv state missing — nothing to clean */ }
  }
  writeConversationBlock(state)
  writeActivePointerBlock({ convId, chatId: input.chatId, scheduleKey: input.scheduleKey })
  return {
    convId,
    convPath: convPathFor(convId),
    activePath: activePathFor(),
    replacedConvId,
  }
}

export interface CloseConversationInput {
  convId: string
  reason?: CloseReason
  deleteClaudeSession?: boolean
}

export interface CloseConversationResult {
  convId: string
  status: 'closed'
  claudeSessionDeleted: boolean
  claudeSessionPaths: string[]
  activeCleared: boolean
}

function findClaudeSessionFilesBlock(sessionId: string): string[] {
  const matches: string[] = []
  // 1. JSONL transcripts under ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
  const root = claudeProjectsRoot()
  if (fs.existsSync(root)) {
    let projects: string[]
    try { projects = fs.readdirSync(root) } catch { projects = [] }
    for (const project of projects) {
      const candidate = path.join(root, project, `${sessionId}.jsonl`)
      if (fs.existsSync(candidate)) matches.push(candidate)
    }
  }
  // 2. Rendered markdown the SessionEnd hook drops into the vault. The hook
  // keys files by the first 8 chars of the session id, with an optional slug:
  //   YYYY-MM-DD_<shortId>.md  or  YYYY-MM-DD_<shortId>_<slug>.md
  const vaultRoot = vaultClaudeSessionsRoot()
  if (fs.existsSync(vaultRoot)) {
    const shortId = sessionId.slice(0, 8)
    let files: string[]
    try { files = fs.readdirSync(vaultRoot) } catch { files = [] }
    for (const name of files) {
      if (!/^\d{4}-\d{2}-\d{2}_/.test(name)) continue
      const afterDate = name.slice(11) // strip "YYYY-MM-DD_"
      if (afterDate === `${shortId}.md` || afterDate.startsWith(`${shortId}_`)) {
        matches.push(path.join(vaultRoot, name))
      }
    }
  }
  return matches
}

export function closeConversationBlock(input: CloseConversationInput): CloseConversationResult {
  const existing = readConversationBlock(input.convId)
  if (!existing) {
    throw new Error(`Conversation not found: ${input.convId}`)
  }

  const closed: ConversationState = {
    ...existing,
    status: 'closed',
    closedAt: new Date().toISOString(),
    closeReason: input.reason ?? 'manual',
  }
  writeConversationBlock(closed)

  const active = readActivePointerBlock()
  let activeCleared = false
  if (active && active.convId === input.convId) {
    writeActivePointerBlock(null)
    activeCleared = true
  }

  let claudeSessionDeleted = false
  let claudeSessionPaths: string[] = []
  if (input.deleteClaudeSession !== false && existing.sessionId) {
    claudeSessionPaths = findClaudeSessionFilesBlock(existing.sessionId)
    for (const p of claudeSessionPaths) {
      try { fs.rmSync(p) } catch { /* best effort */ }
    }
    claudeSessionDeleted = claudeSessionPaths.length > 0
  }

  return {
    convId: input.convId,
    status: 'closed',
    claudeSessionDeleted,
    claudeSessionPaths,
    activeCleared,
  }
}
