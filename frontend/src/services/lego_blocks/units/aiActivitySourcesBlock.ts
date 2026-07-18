// Where AI activity looks for vault-saved session transcripts (markdown copies
// written by the save-session skill). Vault-relative folder prefixes, editable
// in Settings ▸ AI Activity ▸ Session sources. Native JSONL store locations
// (Claude Code / Codex) are configured separately in the Electron main process
// via `nativeAiSessionsBlock`.

import { getJsonStorageItem, setJsonStorageItem, STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'

export const DEFAULT_VAULT_SESSION_PREFIXES = [
  'ai-activity/raw-sessions/claude-code/',
  'ai-activity/raw-sessions/codex/',
  'ai-activity/raw-sessions/chatgpt/',
  'ai-activity/raw-sessions/grok/',
]

function sanitizePrefixes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    let p = item.trim().replace(/^\/+/, '')
    if (!p) continue
    // Migrate stored prefixes from the pre-merge layouts — the vault dirs get
    // folded into `ai-activity/raw-sessions/` at watcher startup, so old paths
    // (`ai_raw/raw/…`, `ai-raw/raw/…`) would no longer resolve.
    if (p.startsWith('ai_raw/raw/')) p = `ai-activity/raw-sessions/${p.slice('ai_raw/raw/'.length)}`
    else if (p.startsWith('ai-raw/raw/')) p = `ai-activity/raw-sessions/${p.slice('ai-raw/raw/'.length)}`
    if (!p.endsWith('/')) p += '/'
    if (!out.includes(p)) out.push(p)
  }
  return out
}

export function readVaultSessionPrefixesBlock(): string[] {
  const stored = sanitizePrefixes(
    getJsonStorageItem<unknown>(STORAGE_KEYS.aiActivityVaultSourcePrefixes, null),
  )
  return stored ?? [...DEFAULT_VAULT_SESSION_PREFIXES]
}

export function writeVaultSessionPrefixesBlock(prefixes: string[]): string[] {
  const sanitized = sanitizePrefixes(prefixes) ?? []
  setJsonStorageItem(STORAGE_KEYS.aiActivityVaultSourcePrefixes, sanitized)
  return sanitized
}
