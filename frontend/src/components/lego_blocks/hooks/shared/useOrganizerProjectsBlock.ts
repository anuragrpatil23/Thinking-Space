import { useEffect, useState } from 'react'
import {
  STORAGE_KEYS,
  getJsonStorageItem,
  setJsonStorageItem,
} from '@/services/orchestrators/storageOrch'
import {
  discoverOrganizerProjectsBlock,
  type DiscoveredProjectBlock,
} from '@/services/lego_blocks/integrations/organizerProjectDiscoveryBlock'

/**
 * The organizer's project list: what localStorage remembers, corrected by what
 * the vault actually holds.
 *
 * Two orchestrators need this exact behaviour — the organizer shell, which owns
 * the sidebar and is always mounted, and the backlog, which mounts for the list
 * and canvas views only. The shell alone is not enough: the backlog broadcasts
 * its own copy downward, so a stale copy there would erase discovered projects
 * from the sidebar on every switch into List. The backlog alone is not enough
 * either — that was the bug, since Index is the default view and the backlog
 * never mounts there.
 *
 * So both call this, and the merge is idempotent: whichever runs second finds
 * nothing to change and writes nothing.
 */
export interface OrganizerProjectEntryBlock {
  name: string
  root: string
  /** The id this project's chains and undertakings are filed under, which is
   *  allowed to differ from the root's basename. Absent on entries cached by an
   *  older build, which fall back to the basename exactly as before. */
  aiProjectId?: string
}

function normalizeRoot(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/** Returns `null` when nothing would change, so the caller skips both the state
 *  write and the storage write. Exported for tests. */
export function mergeDiscoveredProjectsBlock(
  cached: OrganizerProjectEntryBlock[],
  discovered: DiscoveredProjectBlock[],
): OrganizerProjectEntryBlock[] | null {
  const byRoot = new Map<string, OrganizerProjectEntryBlock>()
  for (const entry of cached) {
    const root = normalizeRoot(entry.root)
    if (root) byRoot.set(root, { ...entry, root })
  }

  let changed = false
  for (const project of discovered) {
    const root = normalizeRoot(project.root)
    if (!root) continue
    const existing = byRoot.get(root)
    // A name the user typed outranks one discovery derived from a folder name;
    // the id is discovery's to own either way.
    const next: OrganizerProjectEntryBlock = {
      root,
      name: existing?.name?.trim() || project.name,
      aiProjectId: project.aiProjectId,
    }
    if (existing && existing.name === next.name && existing.aiProjectId === next.aiProjectId) continue
    byRoot.set(root, next)
    changed = true
  }
  if (!changed) return null

  return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function useOrganizerProjectsBlock(): [
  OrganizerProjectEntryBlock[],
  React.Dispatch<React.SetStateAction<OrganizerProjectEntryBlock[]>>,
] {
  const [entries, setEntries] = useState<OrganizerProjectEntryBlock[]>(
    () => getJsonStorageItem<OrganizerProjectEntryBlock[]>(STORAGE_KEYS.thinkingOrganizerProjects, []),
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let discovered: DiscoveredProjectBlock[] = []
      try {
        discovered = await discoverOrganizerProjectsBlock()
      } catch {
        return
      }
      if (cancelled || discovered.length === 0) return
      setEntries((prev) => {
        const merged = mergeDiscoveredProjectsBlock(prev, discovered)
        if (!merged) return prev
        setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjects, merged)
        return merged
      })
    })()
    return () => { cancelled = true }
  }, [])

  return [entries, setEntries]
}
