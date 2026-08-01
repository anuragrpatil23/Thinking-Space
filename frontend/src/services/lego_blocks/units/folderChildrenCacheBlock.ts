// Shared cache for "what folders live under this path".
//
// Extracted from `CascadingFolderPickerBlock` (2026-07-31) when the destination
// browser gained a lazily-expanding tree. Both surfaces walk the same vault, so
// they must share one cache — two private caches would double the filesystem
// calls and let the two pickers disagree about what exists.
//
// Three layers, cheapest first:
//   1. in-memory map     — survives component unmount, dies with the reload
//   2. sessionStorage    — survives reload, dies with the window
//   3. in-flight promise — collapses concurrent requests for the same path,
//                          which a tree does constantly when several nodes
//                          expand at once
import { listChildFolders } from '@/services/orchestrators/fileSystemOrch'

const CACHE_TTL_MS = 5 * 60 * 1000
const SESSION_PREFIX = 'ltm-folder-children:'

const childrenCache = new Map<string, { ts: number; data: string[] }>()
const inFlight = new Map<string, Promise<string[]>>()

function getCachedChildren(path: string): string[] | null {
  const entry = childrenCache.get(path)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    childrenCache.delete(path)
    return null
  }
  return entry.data
}

function getSessionChildren(path: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${path}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ts: number; data: string[] }
    if (!parsed || !Array.isArray(parsed.data)) return null
    if (Date.now() - parsed.ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(`${SESSION_PREFIX}${path}`)
      return null
    }
    childrenCache.set(path, { ts: parsed.ts, data: parsed.data })
    return parsed.data
  } catch {
    return null
  }
}

function setSessionChildren(path: string, data: string[]): void {
  try {
    sessionStorage.setItem(
      `${SESSION_PREFIX}${path}`,
      JSON.stringify({ ts: Date.now(), data }),
    )
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}

/** Child folder names under `path`. Never rejects — an unreadable folder reads
 *  as empty, because a picker that throws mid-navigation is worse than one that
 *  shows a leaf. */
export function fetchFolderChildrenBlock(path: string): Promise<string[]> {
  const cached = getCachedChildren(path)
  if (cached) return Promise.resolve(cached)

  const sessionCached = getSessionChildren(path)
  if (sessionCached) return Promise.resolve(sessionCached)

  const existing = inFlight.get(path)
  if (existing) return existing

  const request = listChildFolders(path)
    .then(folders => {
      childrenCache.set(path, { ts: Date.now(), data: folders })
      setSessionChildren(path, folders)
      return folders
    })
    .catch(() => [] as string[])
    .finally(() => {
      inFlight.delete(path)
    })

  inFlight.set(path, request)
  return request
}

/** Drop a path's cached children so the next read hits the vault. Call after
 *  creating a folder — otherwise the new folder stays invisible for the TTL. */
export function invalidateFolderChildrenBlock(path: string): void {
  childrenCache.delete(path)
  try {
    sessionStorage.removeItem(`${SESSION_PREFIX}${path}`)
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}
