// Where AI activity looks for vault-saved session transcripts (markdown copies
// written by the save-session skill). Vault-relative folder prefixes, editable
// in Settings ▸ AI Activity ▸ Session sources. Native JSONL store locations
// (Claude Code / Codex) are configured separately in the Electron main process
// via `nativeAiSessionsBlock`.

import { getJsonStorageItem, setJsonStorageItem, STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'

export const DEFAULT_VAULT_SESSION_PREFIXES = [
  'ai-raw/raw/claude-code/',
  'ai-raw/raw/codex/',
  'ai-raw/raw/chatgpt/',
  'ai-raw/raw/grok/',
]

function sanitizePrefixes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    let p = item.trim().replace(/^\/+/, '')
    if (!p) continue
    // Migrate any stored `ai_raw/…` prefix from before the kebab-case rename;
    // the vault dir gets renamed at watcher startup so old paths won't resolve.
    if (p.startsWith('ai_raw/')) p = `ai-raw/${p.slice('ai_raw/'.length)}`
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
