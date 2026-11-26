// The user's own launch phrasings that mark a session as spawned by a launcher
// rather than typed by them — e.g. "Read the brief at". Matched as
// case-insensitive prefixes of a session's first prompt (`isSpawnedKickoffBlock`).
//
// Why a setting and not code: a launcher-spawned session's first prompt is
// recorded exactly like typing (`origin: human, promptSource: typed`), so the
// only signal is its wording, and wording is personal. New launchers should
// put `[spawned-by: <parent> via <script>]` on the first line instead, which
// needs no entry here. This list exists for sessions launched before a
// launcher adopted the tag.

import { getJsonStorageItem, setJsonStorageItem, STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'

let cached: string[] | null = null
const listeners = new Set<() => void>()

function sanitize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export function readAiActivitySpawnPatternsBlock(): string[] {
  if (cached) return cached
  cached = sanitize(getJsonStorageItem<unknown>(STORAGE_KEYS.aiActivitySpawnPatterns, []))
  return cached
}

export function writeAiActivitySpawnPatternsBlock(next: readonly string[]): string[] {
  cached = sanitize(next)
  setJsonStorageItem(STORAGE_KEYS.aiActivitySpawnPatterns, cached)
  for (const cb of listeners) cb()
  return cached
}

export function subscribeAiActivitySpawnPatternsBlock(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
