import yaml from 'js-yaml'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseUndertakingBlock,
  serializeUndertakingBlock,
  type TagVocabulary,
  type UndertakingRecord,
} from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import {
  parseSectionBlock,
  serializeSectionBlock,
  type SectionRecord,
} from '@/services/lego_blocks/units/aiActivitySectionBlock'

/**
 * Vault-side storage for undertaking records and the tag vocabulary.
 *
 * Layout — `ai-activity/thinking-organizer/<project>/`:
 *
 *   undertakings/*.md   one record each; the judgment half of an index entry
 *   sections/*.md       the six headings an undertaking files under
 *   tags.yaml           the project's tag vocabulary
 *   misattributed.md    chains this project shouldn't own (kept, not dropped)
 *
 * Under `ai-activity/` rather than beside the project, on authorship: the vault
 * is Anurag's and `ai-activity/` is Kai's. Revisitable after the first real
 * project — the move is cheap because ids are opaque, pointers are vault-root
 * relative, and there is a single writer.
 *
 * This directory is the one part of `ai-activity/` tracked in git, via the
 * `/ai-activity/*` + `!/ai-activity/thinking-organizer/` carve-out.
 */

const ROOT = 'ai-activity/thinking-organizer'

export function undertakingDirBlock(projectId: string): string {
  return `${ROOT}/${projectId}/undertakings`
}

export function sectionDirBlock(projectId: string): string {
  return `${ROOT}/${projectId}/sections`
}

export function tagVocabularyPathBlock(projectId: string): string {
  return `${ROOT}/${projectId}/tags.yaml`
}

function fileNameFor(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`
}

export function undertakingPathBlock(projectId: string, key: string): string {
  return `${undertakingDirBlock(projectId)}/${fileNameFor(key)}`
}

export function sectionPathBlock(projectId: string, key: string): string {
  return `${sectionDirBlock(projectId)}/${fileNameFor(key)}`
}

async function readIfPresent(path: string): Promise<string | null> {
  const fs = getVaultFS()
  try {
    if (!(await fs.exists(path))) return null
    return await fs.read(path)
  } catch {
    return null
  }
}

export async function listUndertakingsBlock(projectId: string): Promise<UndertakingRecord[]> {
  const fs = getVaultFS()
  const dir = undertakingDirBlock(projectId)
  let names: string[] = []
  try {
    const listed = await fs.list(dir)
    names = listed.files.filter(name => name.endsWith('.md'))
  } catch {
    return []
  }

  const records: UndertakingRecord[] = []
  for (const name of names) {
    const content = await readIfPresent(`${dir}/${name}`)
    if (!content) continue
    const record = parseUndertakingBlock(content)
    // A file that doesn't parse is skipped, not fatal. These are hand-editable
    // by design, so a half-finished edit must not take down the whole index.
    if (record) records.push(record)
  }

  records.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
  return records
}

/** A section heading an undertaking files under (the `parent` of a record). */
export interface SectionEntry {
  key: string
  title: string
  sortOrder: number
}

/** The project's full section records, ordered as they should render. Empty
 *  when the project has no sections dir. */
export async function listSectionRecordsBlock(projectId: string): Promise<SectionRecord[]> {
  const fs = getVaultFS()
  const dir = sectionDirBlock(projectId)
  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    return []
  }
  const out: SectionRecord[] = []
  for (const name of names) {
    const content = await readIfPresent(`${dir}/${name}`)
    if (!content) continue
    const record = parseSectionBlock(content)
    if (record) out.push(record)
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
  return out
}

/** The project's section headings — the lean {key,title,sortOrder} the index and
 *  the re-file dropdown read. Falls back to one group when there is no sections
 *  dir. */
export async function listSectionsBlock(projectId: string): Promise<SectionEntry[]> {
  const records = await listSectionRecordsBlock(projectId)
  return records.map(({ key, title, sortOrder }) => ({ key, title, sortOrder }))
}

export async function getSectionBlock(projectId: string, key: string): Promise<SectionRecord | null> {
  const direct = await readIfPresent(sectionPathBlock(projectId, key))
  if (direct) return parseSectionBlock(direct)
  const all = await listSectionRecordsBlock(projectId)
  return all.find(record => record.key === key) ?? null
}

export async function writeSectionBlock(projectId: string, record: SectionRecord): Promise<string> {
  const fs = getVaultFS()
  await fs.mkdir(sectionDirBlock(projectId))
  const path = sectionPathBlock(projectId, record.key)
  await fs.write(path, serializeSectionBlock(record))
  return path
}

export async function deleteSectionBlock(projectId: string, key: string): Promise<void> {
  const fs = getVaultFS()
  await fs.delete(sectionPathBlock(projectId, key))
}

export async function getUndertakingBlock(
  projectId: string,
  key: string,
): Promise<UndertakingRecord | null> {
  const direct = await readIfPresent(undertakingPathBlock(projectId, key))
  if (direct) return parseUndertakingBlock(direct)
  // The filename is derived from the key, but a hand-renamed file should still
  // be findable by the key its frontmatter actually carries.
  const all = await listUndertakingsBlock(projectId)
  return all.find(record => record.key === key) ?? null
}

export async function writeUndertakingBlock(
  projectId: string,
  record: UndertakingRecord,
): Promise<string> {
  const fs = getVaultFS()
  const dir = undertakingDirBlock(projectId)
  await fs.mkdir(dir)
  const path = undertakingPathBlock(projectId, record.key)
  await fs.write(path, serializeUndertakingBlock(record))
  return path
}

const DEFAULT_VOCABULARY: TagVocabulary = { tags: [] }

export async function readTagVocabularyBlock(projectId: string): Promise<TagVocabulary> {
  const content = await readIfPresent(tagVocabularyPathBlock(projectId))
  if (!content) return DEFAULT_VOCABULARY
  try {
    const parsed = yaml.load(content) as unknown
    if (Array.isArray(parsed)) {
      return { tags: parsed.filter((t): t is string => typeof t === 'string') }
    }
    if (parsed && typeof parsed === 'object') {
      const tags = (parsed as Record<string, unknown>).tags
      if (Array.isArray(tags)) {
        return { tags: tags.filter((t): t is string => typeof t === 'string') }
      }
    }
  } catch {
    // A broken vocabulary file must not block tagging — fall back to empty and
    // let `allowNew` carry the call.
  }
  return DEFAULT_VOCABULARY
}

export async function writeTagVocabularyBlock(
  projectId: string,
  vocabulary: TagVocabulary,
): Promise<string> {
  const fs = getVaultFS()
  await fs.mkdir(`${ROOT}/${projectId}`)
  const path = tagVocabularyPathBlock(projectId)
  const header =
    '# Tag vocabulary for this project.\n' +
    '# Anurag owns this list. Tagging refuses anything not named here unless\n' +
    '# explicitly forced, which is what stops near-duplicates accumulating.\n'
  await fs.write(path, header + yaml.dump({ tags: vocabulary.tags }, { lineWidth: -1 }))
  return path
}
