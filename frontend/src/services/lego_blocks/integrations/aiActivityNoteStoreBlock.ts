import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { parseNoteMarkdownBlock, type Note } from '@/services/lego_blocks/units/aiActivityNoteBlock'

// Reads the old organizer's notes. They live beside the project, under its vault
// path — `<projectRoot>/thinking-organizer/epics/` — not in `ai-activity/`,
// because they are Anurag's hand-written records, the other half of the loop.
// Read-only here: the seam never edits the old store.

export function noteDirBlock(projectRoot: string): string {
  return `${projectRoot.replace(/\/+$/, '')}/thinking-organizer/epics`
}

export async function listNotesBlock(projectRoot: string): Promise<Note[]> {
  const fs = getVaultFS()
  const dir = noteDirBlock(projectRoot)
  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    return []
  }
  const out: Note[] = []
  for (const name of names) {
    try {
      const note = parseNoteMarkdownBlock(await fs.read(`${dir}/${name}`))
      if (note) out.push(note)
    } catch {
      // A half-finished hand edit skips, never breaks the list.
    }
  }
  return out
}
