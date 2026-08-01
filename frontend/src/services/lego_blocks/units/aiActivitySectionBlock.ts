import yaml from 'js-yaml'

/**
 * Section records — the structural headings an undertaking files under (Ideas,
 * Questions, Company Studies…). One markdown node each, under
 * `ai-activity/thinking-organizer/<project>/sections/`.
 *
 * A section is deliberately thin: a key, a display title, and a sort order.
 * There is no status and no nesting — sections are the one level of grouping,
 * "one home per entry by kind" (the design's rule). The body is a one-line note,
 * kept editable in Obsidian.
 */

export interface SectionRecord {
  uuid: string
  key: string
  title: string
  /** The project's stable id, carried for consistency with undertakings; not a
   *  lookup handle (sections resolve by `key`, like everything else). */
  projectId: string
  sortOrder: number
  origin: string
  body: string
}

export const SECTION_RECORD_KIND = 'section'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Slug a title into the key-body form the existing sections use
 *  (`company-studies`), lowercase and hyphenated. */
function slugBlock(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * A key for a new section: `<project>-sec-<title-slug>`, matching the migration's
 * form (`f9-sec-company-studies`). De-duplicated against the keys already in use
 * so two sections named alike don't collide on one file.
 */
export function sectionKeyFromTitleBlock(projectId: string, title: string, existingKeys: string[]): string {
  const proj = slugBlock(projectId) || 'p'
  const body = slugBlock(title) || 'section'
  const base = `${proj}-sec-${body}`
  const taken = new Set(existingKeys)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Parse a section markdown file. Returns null if it isn't a section record. */
export function parseSectionBlock(content: string): SectionRecord | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return null
  const afterOpen = trimmed.indexOf('\n')
  if (afterOpen === -1) return null
  const rest = trimmed.slice(afterOpen + 1)
  const close = /^---\s*$/m.exec(rest)
  if (!close) return null

  let parsed: Record<string, unknown>
  try {
    parsed = yaml.load(rest.slice(0, close.index)) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  if (asString(parsed.record_kind) !== SECTION_RECORD_KIND) return null
  const key = asString(parsed.key)
  if (!key) return null

  const body = rest.slice(close.index + close[0].length).replace(/^\n+/, '').trim()
  const sortOrder = typeof parsed.sort_order === 'number' && Number.isFinite(parsed.sort_order) ? parsed.sort_order : 0

  return {
    uuid: asString(parsed.uuid),
    key,
    title: asString(parsed.title).trim() || key,
    projectId: asString(parsed.project_id),
    sortOrder,
    origin: asString(parsed.origin),
    body,
  }
}

/** Serialize a section back to markdown. Field order mirrors the migration's
 *  files so a round-trip is a no-op diff. */
export function serializeSectionBlock(record: SectionRecord): string {
  const frontmatter: Record<string, unknown> = {
    uuid: record.uuid,
    key: record.key,
    title: record.title,
    type: 'program',
    level: 0,
    record_kind: SECTION_RECORD_KIND,
    project_id: record.projectId,
    sort_order: record.sortOrder,
    origin: record.origin,
  }
  const yamlStr = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"' })
    .trimEnd()
  return `---\n${yamlStr}\n---\n${record.body ? `\n${record.body}\n` : ''}`
}
