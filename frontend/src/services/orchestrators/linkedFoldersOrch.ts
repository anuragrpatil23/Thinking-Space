import { plainLinkedErrorBlock } from '@/services/lego_blocks/units/linkedDocumentPathBlock'

// The renderer's way to look inside linked folders. Main checks every path.
// There is no call here that launches a code file.

export interface LinkedFolderRowOrch {
  id: string
  path: string
  kind: 'papers' | 'code'
  available: boolean
}

export type LinkedCodeEntryOrch =
  | { type: 'file'; size: number }
  | { type: 'folder'; folders: string[]; files: Array<{ name: string; size: number }> }

/** Null outside the desktop app. */
export async function listLinkedFoldersOrch(): Promise<LinkedFolderRowOrch[] | null> {
  const api = window.electronAPI
  return api?.linkedFoldersList ? api.linkedFoldersList() : null
}

export async function describeLinkedCodePathOrch(folderId: string, relPath: string): Promise<LinkedCodeEntryOrch> {
  const api = window.electronAPI
  if (!api?.linkedFoldersCodeDescribe) throw new Error('Linked folders open in the desktop app.')
  return api.linkedFoldersCodeDescribe(folderId, relPath).catch((err) => { throw plainLinkedErrorBlock(err) })
}
