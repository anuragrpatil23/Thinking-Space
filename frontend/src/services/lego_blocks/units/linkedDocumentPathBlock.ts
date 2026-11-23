// A file in a linked folder, addressed like a vault path so the app's readers
// work on it. `@linked/<id>/<path>` is a papers folder and `@linked-code/<id>/<path>`
// a code folder, whose HTML is shown as source and never run. Both are read-only.
// Main looks the folder up by id and checks the real path. See docs/contracts/SECURITY.md.

const LINKED_DOCUMENT_PREFIX_BLOCK = '@linked/'
const LINKED_CODE_DOCUMENT_PREFIX_BLOCK = '@linked-code/'

export type LinkedDocumentKindBlock = 'papers' | 'code'

export function isLinkedCodeDocumentPathBlock(path: string): boolean {
  return path.startsWith(LINKED_CODE_DOCUMENT_PREFIX_BLOCK)
}

export function isLinkedDocumentPathBlock(path: string): boolean {
  return path.startsWith(LINKED_DOCUMENT_PREFIX_BLOCK) || isLinkedCodeDocumentPathBlock(path)
}

export function linkedDocumentPathBlock(folderId: string, relPath: string, kind: LinkedDocumentKindBlock = 'papers'): string {
  return `${kind === 'code' ? LINKED_CODE_DOCUMENT_PREFIX_BLOCK : LINKED_DOCUMENT_PREFIX_BLOCK}${folderId}/${relPath}`
}

export function parseLinkedDocumentPathBlock(path: string): { folderId: string; relPath: string; kind: LinkedDocumentKindBlock } | null {
  if (!isLinkedDocumentPathBlock(path)) return null
  const kind: LinkedDocumentKindBlock = isLinkedCodeDocumentPathBlock(path) ? 'code' : 'papers'
  const rest = path.slice((kind === 'code' ? LINKED_CODE_DOCUMENT_PREFIX_BLOCK : LINKED_DOCUMENT_PREFIX_BLOCK).length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  return { folderId: rest.slice(0, slash), relPath: rest.slice(slash + 1), kind }
}

/** The folders to show above a linked file's name, without the internal id. */
export function linkedDocumentBreadcrumbBlock(path: string): string {
  const parts = parseLinkedDocumentPathBlock(path)?.relPath.split('/') ?? []
  return ['Linked folder', ...parts.slice(0, -1)].join(' / ')
}

/** A main-process failure in words a reader can use. */
export function plainLinkedErrorBlock(err: unknown): Error {
  const message = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
  if (/ENOENT/.test(message)) return new Error('This path is not in the folder any more.')
  return new Error(message && !/^E[A-Z]+:/.test(message) ? message : 'This could not be read.')
}
