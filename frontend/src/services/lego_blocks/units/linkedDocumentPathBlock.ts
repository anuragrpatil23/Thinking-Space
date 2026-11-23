// A file in a linked papers folder, addressed like a vault path so the app's
// readers work on it: `@linked/<folder id>/<path inside it>`. These paths are
// read-only. Main looks the folder up by id and checks the real path on disk.
// See docs/contracts/SECURITY.md.

const LINKED_DOCUMENT_PREFIX_BLOCK = '@linked/'

export function isLinkedDocumentPathBlock(path: string): boolean {
  return path.startsWith(LINKED_DOCUMENT_PREFIX_BLOCK)
}

export function linkedDocumentPathBlock(folderId: string, relPath: string): string {
  return `${LINKED_DOCUMENT_PREFIX_BLOCK}${folderId}/${relPath}`
}

export function parseLinkedDocumentPathBlock(path: string): { folderId: string; relPath: string } | null {
  if (!isLinkedDocumentPathBlock(path)) return null
  const rest = path.slice(LINKED_DOCUMENT_PREFIX_BLOCK.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  return { folderId: rest.slice(0, slash), relPath: rest.slice(slash + 1) }
}

/** The folders to show above a linked file's name, without the internal id. */
export function linkedDocumentBreadcrumbBlock(path: string): string {
  const parts = parseLinkedDocumentPathBlock(path)?.relPath.split('/') ?? []
  return ['Linked folder', ...parts.slice(0, -1)].join(' / ')
}
