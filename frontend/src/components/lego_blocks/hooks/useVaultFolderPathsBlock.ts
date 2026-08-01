import { useEffect, useState } from 'react'
import { getAllFilePaths } from '@/services/lego_blocks/integrations/dbBlock'

// Every folder in the vault that could hold a note, as a flat sorted list.
//
// Derived from the cached file index rather than walked. `FolderTreePickerBlock`
// loads folders one level at a time (`fetchFolderChildrenBlock`), which is right
// for a tree you expand by hand but useless for search: you cannot match against
// folders you have not opened yet. A recursive walk would answer that and cost a
// full vault traversal — slow enough on iOS to read as broken.
//
// The cache already knows every file path, and a folder is just a parent of one.
// So the set falls out of `getAllFilePaths()` for free, and it covers exactly the
// folders that actually contain notes — which is the set anyone would save into.
// Folders that exist but hold nothing are missing by construction; that is the
// deliberate tradeoff, and the tree is still there to reach them.

/** Every ancestor folder of `filePath`, e.g. `a/b/c.md` -> ['a', 'a/b']. */
function ancestorFoldersOfBlock(filePath: string): string[] {
  const segments = filePath.split('/').filter(Boolean)
  // Drop the filename itself — the last segment is the file, not a folder.
  const folders: string[] = []
  for (let index = 0; index < segments.length - 1; index += 1) {
    folders.push(segments.slice(0, index + 1).join('/'))
  }
  return folders
}

export interface VaultFolderPathsBlock {
  /** Vault-relative folder paths, sorted. Never includes the vault root (''). */
  folders: string[]
  loading: boolean
}

/**
 * @param enabled Skip the read entirely when the picker is closed — this runs
 *   over the whole cached path set, and there is no reason to pay for it while
 *   nothing is showing it.
 */
export function useVaultFolderPathsBlock(enabled: boolean): VaultFolderPathsBlock {
  const [folders, setFolders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const paths = await getAllFilePaths()
        const unique = new Set<string>()
        for (const path of paths) {
          for (const folder of ancestorFoldersOfBlock(path)) unique.add(folder)
        }
        if (cancelled) return
        setFolders([...unique].sort((a, b) => a.localeCompare(b)))
      } catch {
        // A folder list we could not build is an empty one — search finds
        // nothing and the tree still works. Nothing here is worth an error
        // surface in a picker.
        if (!cancelled) setFolders([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [enabled])

  return { folders, loading }
}
