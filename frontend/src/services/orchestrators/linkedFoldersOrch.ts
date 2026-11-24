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

export async function readLinkedCodeTextOrch(folderId: string, relPath: string): Promise<string> {
  const api = window.electronAPI
  if (!api?.linkedFoldersCodeRead) throw new Error('Linked folders open in the desktop app.')
  return api.linkedFoldersCodeRead(folderId, relPath).catch((err) => { throw plainLinkedErrorBlock(err) })
}

/** A data file of a code folder (.jsonl, .json, .html), up to 16 MB. */
export async function readLinkedCodeDataOrch(folderId: string, relPath: string): Promise<string> {
  const api = window.electronAPI
  if (!api?.linkedFoldersCodeReadData) throw new Error('Linked folders open in the desktop app.')
  return api.linkedFoldersCodeReadData(folderId, relPath).catch((err) => { throw plainLinkedErrorBlock(err) })
}

/** An image of a code folder, as base64. */
export async function readLinkedCodeImageOrch(folderId: string, relPath: string): Promise<string> {
  const api = window.electronAPI
  if (!api?.linkedFoldersCodeReadBytes) throw new Error('Linked folders open in the desktop app.')
  return api.linkedFoldersCodeReadBytes(folderId, relPath).catch((err) => { throw plainLinkedErrorBlock(err) })
}

/**
 * Calls `onChange` when anything under a folder of a linked code folder changes
 * (a git pull, a new file). Returns the stop function; a no-op outside the
 * desktop app or when the folder cannot be watched.
 */
export function watchLinkedCodeFolderOrch(folderId: string, relPath: string, onChange: () => void): () => void {
  const api = window.electronAPI
  if (!api?.linkedFoldersCodeWatch || !api.onLinkedFoldersCodeChanged) return () => {}
  let watchId: string | null = null
  let stopped = false
  const unlisten = api.onLinkedFoldersCodeChanged((id) => { if (id === watchId) onChange() })
  api.linkedFoldersCodeWatch(folderId, relPath).then((id) => {
    if (stopped) void api.linkedFoldersCodeUnwatch?.(id)
    else watchId = id
  }).catch(() => {})
  return () => {
    stopped = true
    unlisten()
    if (watchId) void api.linkedFoldersCodeUnwatch?.(watchId)
  }
}
