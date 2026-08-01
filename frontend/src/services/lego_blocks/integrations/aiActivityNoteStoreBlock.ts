import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { noteBodyBlock, parseNoteMarkdownBlock, type Note } from '@/services/lego_blocks/units/aiActivityNoteBlock'

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

/** One note, with the body the list drops — what the detail drawer reads. */
export interface NoteFile {
  note: Note
  /** Everything after the frontmatter, unparsed. */
  body: string
  /** Vault-relative path, so the drawer can name the file it is showing. */
  path: string
}

/**
 * Read a single note by key. The store names files `epic-<key>.md`, so the
 * common case is one read; the directory scan behind it is the fallback for a
 * hand-renamed file, where the key in the frontmatter is still the truth.
 */
export async function readNoteBlock(projectRoot: string, key: string): Promise<NoteFile | null> {
  const fs = getVaultFS()
  const dir = noteDirBlock(projectRoot)

  const parse = (raw: string, path: string): NoteFile | null => {
    const note = parseNoteMarkdownBlock(raw)
    return note ? { note, body: noteBodyBlock(raw), path } : null
  }

  const direct = `${dir}/epic-${key}.md`
  try {
    const hit = parse(await fs.read(direct), direct)
    if (hit && hit.note.key === key) return hit
  } catch {
    // Fall through to the scan.
  }

  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    return null
  }
  for (const name of names) {
    try {
      const path = `${dir}/${name}`
      const hit = parse(await fs.read(path), path)
      if (hit && hit.note.key === key) return hit
    } catch {
      // Skip an unreadable file rather than failing the lookup.
    }
  }
  return null
}
