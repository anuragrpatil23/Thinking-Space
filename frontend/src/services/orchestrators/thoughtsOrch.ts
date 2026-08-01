import type { ThoughtMonthData, ThoughtSectionMonthData } from '@/services/lego_blocks/units/typesBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getNodeByKey } from '@/services/lego_blocks/integrations/dbBlock'
import {
  getThoughtsMonth as scanThoughtsMonth,
  getThoughtsSectionMonth as scanThoughtsSectionMonth,
} from '@/services/lego_blocks/integrations/thoughtsScannerBlock'
import { createNote, generateKey, stringifyNote } from '@/services/lego_blocks/units/yamlNoteBlock'
import { syncSingleFile } from './vaultSyncOrch'
import {
  MarkdownDocumentConflictError,
  readMarkdownDocument,
  saveMarkdownDocument,
} from './markdownDocumentsOrch'
export async function getThoughtsMonth(year: number, month: number): Promise<ThoughtMonthData> {
  const fs = getVaultFS()
  return scanThoughtsMonth(fs, year, month)
}

export async function getThoughtsSectionMonth(
  year: number,
  month: number,
  sections: string[],
): Promise<ThoughtSectionMonthData> {
  const fs = getVaultFS()
  return scanThoughtsSectionMonth(fs, year, month, sections)
}

export async function getThoughtForEdit(path: string): Promise<{
  path: string
  content: string
  mtime: number
  hash: string
}> {
  return readMarkdownDocument(path)
}

export async function saveThoughtEdit(params: {
  path: string
  content: string
  baseMtime: number
  baseHash: string
}): Promise<{ output_path: string; revision_path: string | null }> {
  const result = await saveMarkdownDocument(params)
  return result
}

export { MarkdownDocumentConflictError as ThoughtConflictError }

export async function createThought(params: {
  folder_path: string
  filename: string
  content: string
  title: string | null
  date_header: boolean
  emotions: string[]
  /** Freeform tags. Emotions are *also* tags (`emotion/<slug>`) — this is the
   *  same field, just the part the user typed rather than the part a picker
   *  produced. */
  tags?: string[]
  /** Written as a tag, not as `frontmatter.type`: that field is the
   *  hierarchy's `NodeType` (closed union + level mapping, ADR-004), so a
   *  `meeting` value there would need a schema change. Defaults to 'thought'
   *  so every existing caller keeps its behaviour. */
  note_kind?: 'thought' | 'meeting' | 'none'
}): Promise<{ output_path: string }> {
  const fs = getVaultFS()
  const outputPath = `${params.folder_path}/${params.filename}`

  const bodyParts: string[] = []
  const customTitle = params.title?.trim() || ''
  const emotions = (params.emotions || []).filter(e => e && e.trim())

  if (customTitle) {
    bodyParts.push(`# ${customTitle}`)
    bodyParts.push('')
  }

  if (params.date_header) {
    const today = new Date()
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' })
    const monthName = today.toLocaleDateString('en-US', { month: 'long' })
    bodyParts.push(`*${dayName}, ${monthName} ${today.getDate()}, ${today.getFullYear()}*`)
    bodyParts.push('')
  }

  bodyParts.push(params.content)

  const noteTitle = customTitle || deriveTitleFromFilename(params.filename)
  const kind = params.note_kind ?? 'thought'
  const kindTags = kind === 'none' ? [] : [kind]
  const freeformTags = (params.tags || []).map(tag => tag.trim()).filter(Boolean)
  // De-duped: a user can type `thought` by hand, and the kind already added it.
  const tags = [...new Set([...kindTags, ...freeformTags, ...emotions.map(emotionToTag)])]
  const note = createNote({
    type: 'thought',
    title: noteTitle,
    tags,
    body: bodyParts.join('\n'),
  })
  note.frontmatter.key = await ensureUniqueKeyForPath(outputPath, note.frontmatter.key)
  if (emotions.length > 0) {
    note.frontmatter.emotions = emotions
  }

  await fs.mkdir(params.folder_path)
  await fs.create(outputPath, stringifyNote(note))
  await syncSingleFile(outputPath, fs)
  return { output_path: outputPath }
}

function deriveTitleFromFilename(filename: string): string {
  const basename = filename.replace(/\.md$/i, '')
  const normalized = basename.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || 'Untitled Note'
}

function emotionToTag(emotion: string): string {
  const slug = generateKey(emotion.trim())
  return slug ? `emotion/${slug}` : 'emotion/unknown'
}

async function ensureUniqueKeyForPath(filePath: string, suggested: string): Promise<string> {
  const fallback = generateKey(filePath) || 'thought'
  const base = suggested || fallback
  let candidate = base
  let suffix = 2

  while (suffix < 1000) {
    const existing = await getNodeByKey(candidate)
    if (!existing || existing.filePath === filePath) return candidate
    candidate = `${base}-${suffix}`
    suffix += 1
  }

  throw new Error(`Could not generate a unique key for ${filePath}`)
}
