// How a vault path reads in a list.
//
// A full path is the wrong primary text for a file: every path under one
// project shares its first two segments, so a column of them opens with the
// same twenty characters on every row and truncates before reaching the part
// that differs. The name is what tells them apart, and the folder is context —
// so they are split, and the name leads.

export interface VaultPathLabel {
  /** The file's own name, extension dropped — the part that identifies it. */
  name: string
  /** The folder it sits in, relative to `within` when that prefix matches. '' at
   *  the root. */
  folder: string
}

/**
 * Split a vault-relative path into the name that identifies a file and the
 * folder that places it.
 *
 * `within` (a project root like `acceleration_core/F9`) is stripped from the
 * folder when it matches: inside one project's drawer, repeating the project on
 * every row says nothing, and it is exactly the part that was eating the width.
 */
export function vaultPathLabelBlock(path: string, within?: string): VaultPathLabel {
  const clean = path.replace(/^\/+|\/+$/g, '')
  const cut = clean.lastIndexOf('/')
  const name = (cut === -1 ? clean : clean.slice(cut + 1)).replace(/\.(md|markdown)$/i, '')
  let folder = cut === -1 ? '' : clean.slice(0, cut)

  const prefix = within?.replace(/^\/+|\/+$/g, '') ?? ''
  if (prefix) {
    if (folder === prefix) folder = ''
    else if (folder.startsWith(`${prefix}/`)) folder = folder.slice(prefix.length + 1)
  }
  return { name, folder }
}

/**
 * The deepest folder every one of these paths sits under — what to strip so a
 * list shows only where the paths actually differ.
 *
 * Derived from the paths themselves rather than passed in, because the caller
 * (a drawer showing one undertaking's pages) knows the project id but not the
 * vault folder it lives in, and that folder is precisely the shared head.
 * Returns '' for a single path — there is nothing to compare it against, so
 * stripping would hide its whole location.
 */
export function commonVaultFolderBlock(paths: string[]): string {
  if (paths.length < 2) return ''
  const segmentLists = paths.map(p => p.replace(/^\/+/, '').split('/').slice(0, -1))
  const [first, ...rest] = segmentLists
  const shared: string[] = []
  for (let i = 0; i < first.length; i++) {
    if (rest.some(segments => segments[i] !== first[i])) break
    shared.push(first[i])
  }
  return shared.join('/')
}
