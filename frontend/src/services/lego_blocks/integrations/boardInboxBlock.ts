import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'

/**
 * Post-its jotted on a device that is not holding the board (the iPhone).
 *
 * The board is one file, `.thinking-space/home-canvas.json`, and the desktop
 * board loads it once and then writes its whole in-memory copy over it on
 * every change. A note appended to that file from the phone would be wiped by
 * the next desktop write. So the phone never touches the board file: each
 * note is its own file here, the desktop board pulls them in, and deletes a
 * note's file only after a board write that contains it has succeeded
 * (DURABILITY: a crash during cleanup never deletes). One file per note also
 * means two quick notes never conflict in iCloud.
 */

export const BOARD_INBOX_DIR_BLOCK = '.thinking-space/board-inbox'

export interface BoardInboxNoteBlock {
  /** Becomes the tile's id on the board, so a note is pulled in once. */
  id: string
  text: string
  createdAt: number
}

function notePathBlock(id: string): string {
  return `${BOARD_INBOX_DIR_BLOCK}/${id}.json`
}

export async function addBoardInboxNoteBlock(text: string): Promise<BoardInboxNoteBlock> {
  const createdAt = Date.now()
  const note: BoardInboxNoteBlock = {
    id: `tile-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt,
  }
  const fs = getVaultFS()
  await fs.mkdir(BOARD_INBOX_DIR_BLOCK)
  await fs.write(notePathBlock(note.id), JSON.stringify(note, null, 2))
  return note
}

/** Every waiting note, oldest first. A file that will not parse is skipped,
 *  never deleted — it may be an iCloud download still in flight. */
export async function readBoardInboxBlock(): Promise<BoardInboxNoteBlock[]> {
  const fs = getVaultFS()
  try {
    if (!(await fs.exists(BOARD_INBOX_DIR_BLOCK))) return []
    const { files } = await fs.list(BOARD_INBOX_DIR_BLOCK)
    const notes: BoardInboxNoteBlock[] = []
    for (const name of files) {
      if (!name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(await fs.read(`${BOARD_INBOX_DIR_BLOCK}/${name}`)) as BoardInboxNoteBlock
        if (typeof parsed?.id === 'string' && typeof parsed.text === 'string') notes.push(parsed)
      } catch { /* not readable yet */ }
    }
    return notes.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

/** Call only after a board write containing these notes has succeeded. */
export async function removeBoardInboxNotesBlock(ids: string[]): Promise<void> {
  const fs = getVaultFS()
  for (const id of ids) {
    try {
      await fs.delete(notePathBlock(id))
    } catch { /* already gone (another device pulled it in) */ }
  }
}
