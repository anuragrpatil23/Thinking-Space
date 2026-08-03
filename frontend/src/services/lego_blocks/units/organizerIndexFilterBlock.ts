import { taskIsReferenceBlock } from '@/services/lego_blocks/units/aiActivityTaskBlock'
import type {
  TaskEntry,
  UndertakingIndex,
  UndertakingIndexRow,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// Filters for the organizer index. Attributes are just data on a row; a filter
// picks a value and the view narrows to rows carrying it (AND across filters).
// This never regroups — kind stays the section spine; filtering only hides rows.
// A row that lacks the filtered attribute (an undertaking has no engagement)
// simply doesn't match, so that filter scopes it out.

export type FilterAttr = 'year' | 'tag' | 'kind' | 'engagement'

export interface OrganizerFilter {
  attr: FilterAttr
  value: string
}

export interface RowAttrs {
  year: string
  tags: string[]
  kind: string
  /** Only open-loop tasks have this; undertakings and reference tasks don't. */
  engagement?: 'open' | 'engaged'
}

/** One selectable attribute in the filter bar, with its distinct values. */
export interface FilterGroup {
  attr: FilterAttr
  label: string
  values: Array<{ value: string; label: string }>
}

const yearOf = (iso: string): string => (iso && iso.length >= 4 ? iso.slice(0, 4) : '')

export function undertakingRowAttrsBlock(row: UndertakingIndexRow, kind: string): RowAttrs {
  return {
    year: yearOf(row.tail.lastDate || row.tail.firstDate || row.record.updatedAt || row.record.createdAt),
    tags: [...row.record.tags, ...row.record.proposedTags],
    kind,
  }
}

export function taskEntryAttrsBlock(entry: TaskEntry, kind: string): RowAttrs {
  const reference = taskIsReferenceBlock(entry.task.categoryCode)
  return {
    year: yearOf(entry.task.openedDate),
    tags: entry.task.tags,
    kind,
    engagement: reference ? undefined : entry.fedInto || entry.producedBy ? 'engaged' : 'open',
  }
}

/** True when the row satisfies every active filter (AND). Empty filters pass. */
export function rowMatchesFiltersBlock(attrs: RowAttrs, filters: OrganizerFilter[]): boolean {
  return filters.every(f => {
    switch (f.attr) {
      case 'year':
        return attrs.year === f.value
      case 'tag':
        return attrs.tags.includes(f.value)
      case 'kind':
        return attrs.kind === f.value
      case 'engagement':
        return attrs.engagement === f.value
    }
  })
}

const ENGAGEMENT_LABELS: Record<string, string> = { open: 'Open', engaged: 'Engaged' }

/** The filter bar's options, derived from the whole (unfiltered) index. */
export function collectFilterGroupsBlock(index: UndertakingIndex): FilterGroup[] {
  const years = new Set<string>()
  const tags = new Set<string>()
  const kinds: string[] = []
  const engagements = new Set<string>()

  const take = (attrs: RowAttrs): void => {
    if (attrs.year) years.add(attrs.year)
    for (const t of attrs.tags) tags.add(t)
    if (attrs.engagement) engagements.add(attrs.engagement)
  }

  for (const section of index.sections) {
    kinds.push(section.title)
    for (const row of section.rows) take(undertakingRowAttrsBlock(row, section.title))
  }
  for (const section of index.taskSections) {
    kinds.push(section.title)
    for (const entry of section.tasks) take(taskEntryAttrsBlock(entry, section.title))
  }

  const groups: FilterGroup[] = []
  if (years.size) {
    groups.push({
      attr: 'year',
      label: 'Year',
      values: [...years].sort().reverse().map(y => ({ value: y, label: y })),
    })
  }
  if (kinds.length) {
    groups.push({ attr: 'kind', label: 'Kind', values: kinds.map(k => ({ value: k, label: k })) })
  }
  if (tags.size) {
    groups.push({
      attr: 'tag',
      label: 'Tag',
      values: [...tags].sort().map(t => ({ value: t, label: t })),
    })
  }
  if (engagements.size) {
    groups.push({
      attr: 'engagement',
      label: 'State',
      values: ['open', 'engaged']
        .filter(e => engagements.has(e))
        .map(e => ({ value: e, label: ENGAGEMENT_LABELS[e] })),
    })
  }
  return groups
}
