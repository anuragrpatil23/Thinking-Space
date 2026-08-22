// Is this file a note, or the residue of one that was never written?
//
// See docs/contracts/DURABILITY.md. This is the only logic authorised to mark a
// file in the user's vault for deletion, so it is written to say "no" whenever
// it is unsure.
//
// The husk it exists for: type one character, auto-save writes the file with
// generated frontmatter, delete the character. `canSave` goes false, auto-save
// never fires again, and a frontmatter-only file stays in the vault forever.
//
// Provenance comes from *content*, not from memory. Memory does not survive the
// crash this contract assumes will happen, and after a crash an app-made husk
// would otherwise be indistinguishable from a stub the user made on purpose.
// The generated frontmatter is the evidence, which also means this reaches
// husks created before any of this shipped — and there are already some in
// every vault that has used the composer.
//
// Deliberately no YAML dependency. The shape emitted by `createNote` is flat
// scalars plus two string lists, and `noteComposerBlock` documents why pulling
// `js-yaml` in here caused a runtime chunk cycle once already.

import { parseNoteCanvasBlock } from './noteCanvasBlock'

/** Every key `createNote` + `thoughts.create` can emit on their own. A file
 *  carrying anything outside this set has been touched by a human or another
 *  tool, and is not ours to reap. */
export const GENERATED_FRONTMATTER_KEYS_BLOCK: ReadonlySet<string> = new Set([
  'uuid', 'key', 'title', 'type', 'level', 'status', 'created_at', 'updated_at', 'tags',
])

/** Tags the composer adds by itself, from the note kind. Anything else in
 *  `tags` — a freeform tag, an `emotion/*` tag — was the user's doing. */
export const GENERATED_ONLY_TAGS_BLOCK: ReadonlySet<string> = new Set(['thought', 'meeting'])

export interface ParsedFrontmatterBlock {
  keys: string[]
  scalars: Map<string, string>
  lists: Map<string, string[]>
}

/** Split the leading `---` block and parse its flat shape. Returns `null` when
 *  there is no frontmatter at all — which, for husk purposes, means the file
 *  was not written by the composer. */
export function parseFlatFrontmatterBlock(content: string): ParsedFrontmatterBlock | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') return null
  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) return null

  const keys: string[] = []
  const scalars = new Map<string, string>()
  const lists = new Map<string, string[]>()
  let currentList: string[] | null = null

  for (const line of lines.slice(1, closingIndex)) {
    const listItem = /^\s+-\s*(.*)$/.exec(line)
    if (listItem && currentList) {
      currentList.push(unquoteBlock(listItem[1]))
      continue
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!pair) {
      // Anything this parser does not recognise — a nested map, a block scalar
      // — is hand-written structure. Bail rather than guess.
      if (line.trim()) return null
      continue
    }
    const [, key, rawValue] = pair
    keys.push(key)
    if (rawValue.trim() === '') {
      currentList = []
      lists.set(key, currentList)
    } else {
      currentList = null
      scalars.set(key, unquoteBlock(rawValue))
    }
  }
  return { keys, scalars, lists }
}

function unquoteBlock(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return String(JSON.parse(trimmed))
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Does this frontmatter carry only what the app generates by itself? */
export function isGeneratedOnlyFrontmatterBlock(parsed: ParsedFrontmatterBlock | null): boolean {
  if (!parsed) return false
  // An unknown key means a person or another tool wrote here.
  for (const key of parsed.keys) {
    if (!GENERATED_FRONTMATTER_KEYS_BLOCK.has(key)) return false
  }
  // Emotions are always the user's, and `createNote` only emits the field when
  // they picked some.
  if (parsed.lists.has('emotions') || parsed.scalars.has('emotions')) return false
  const tags = parsed.lists.get('tags')
  if (tags) {
    for (const tag of tags) {
      if (!GENERATED_ONLY_TAGS_BLOCK.has(tag)) return false
    }
  }
  // A `tags:` written inline rather than as a list is not our shape.
  if (parsed.scalars.has('tags') && parsed.scalars.get('tags') !== '[]') return false
  return true
}

/** The title `deriveTitleFromFilename` would produce. A title that differs is a
 *  custom one the user typed, which makes the file theirs even when empty. */
export function titleFromFilenameBlock(filename: string): string {
  const basename = filename.replace(/\.md$/i, '')
  const normalized = basename.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || 'Untitled Note'
}

export interface NoteHuskInputBlock {
  content: string
  /** Basename, used to tell a generated title from a typed one. */
  filename: string
}

/** Is the note empty — nothing a human put there?
 *
 *  The canvas clause is not optional. The composer's `editorBody` deliberately
 *  strips the canvas fence, so a prose-only test classifies a finished drawing
 *  with no words as empty and would reap it. */
export function isNoteEmptyBlock(content: string): boolean {
  const parsed = parseFlatFrontmatterBlock(content)
  const body = parsed ? stripFrontmatterBlock(content) : content
  const { tiles } = parseNoteCanvasBlock(body)
  if (tiles.length > 0) return false
  return parseNoteCanvasBlock(body).bodyWithoutCanvas.trim() === ''
}

function stripFrontmatterBlock(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') return content
  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) return content
  return lines.slice(closingIndex + 1).join('\n')
}

/** May this file be deleted as litter?
 *
 *  True only for a file that is empty of anything human *and* whose frontmatter
 *  the app generated entirely by itself. Every uncertain case answers false:
 *  a stray empty file is a nuisance, a deleted paragraph is not. */
export function isReapableNoteHuskBlock(input: NoteHuskInputBlock): boolean {
  const parsed = parseFlatFrontmatterBlock(input.content)
  // No frontmatter at all means the composer never wrote it.
  if (!parsed) return false
  if (!isGeneratedOnlyFrontmatterBlock(parsed)) return false
  // A title the user typed makes the file theirs, empty or not.
  const title = parsed.scalars.get('title')
  if (title !== undefined && title !== titleFromFilenameBlock(input.filename)) return false
  // Must actually look like one of ours.
  if (parsed.scalars.get('type') !== 'thought') return false
  if (!parsed.scalars.has('uuid')) return false
  return isNoteEmptyBlock(input.content)
}
