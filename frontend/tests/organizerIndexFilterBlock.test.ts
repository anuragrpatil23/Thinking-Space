import { describe, expect, it } from 'vitest'
import {
  collectFilterGroupsBlock,
  taskEntryAttrsBlock,
  rowMatchesFiltersBlock,
  undertakingRowAttrsBlock,
} from '@/services/lego_blocks/units/organizerIndexFilterBlock'
import type {
  TaskEntry,
  UndertakingIndex,
  UndertakingIndexRow,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

function undertakingRow(over: { lastDate?: string; tags?: string[]; proposedTags?: string[] }): UndertakingIndexRow {
  return {
    record: { tags: over.tags ?? [], proposedTags: over.proposedTags ?? [], updatedAt: '', createdAt: '' } as UndertakingIndexRow['record'],
    tail: { lastDate: over.lastDate ?? '', firstDate: '' } as UndertakingIndexRow['tail'],
    buckets: [],
    fedTasks: [],
  }
}

function task(over: { code: string; openedDate?: string; tags?: string[]; fed?: boolean }): TaskEntry {
  return {
    task: { categoryCode: over.code, openedDate: over.openedDate ?? '', tags: over.tags ?? [] } as TaskEntry['task'],
    fedInto: over.fed ? { key: 'u', title: 'U' } : undefined,
  }
}

describe('rowMatchesFiltersBlock', () => {
  it('ANDs filters and treats a missing attribute as a non-match', () => {
    const attrs = undertakingRowAttrsBlock(undertakingRow({ lastDate: '2026-06-01', tags: ['held'] }), 'Company Studies')
    expect(rowMatchesFiltersBlock(attrs, [{ attr: 'year', value: '2026' }])).toBe(true)
    expect(rowMatchesFiltersBlock(attrs, [{ attr: 'year', value: '2025' }])).toBe(false)
    // year AND tag both must hold.
    expect(rowMatchesFiltersBlock(attrs, [{ attr: 'year', value: '2026' }, { attr: 'tag', value: 'held' }])).toBe(true)
    expect(rowMatchesFiltersBlock(attrs, [{ attr: 'tag', value: 'watchlist' }])).toBe(false)
    // Undertakings have no engagement → an engagement filter scopes them out.
    expect(rowMatchesFiltersBlock(attrs, [{ attr: 'engagement', value: 'open' }])).toBe(false)
  })

  it('reads task engagement, with reference kinds having none', () => {
    expect(taskEntryAttrsBlock(task({ code: 'QT' }), 'Questions').engagement).toBe('open')
    expect(taskEntryAttrsBlock(task({ code: 'QT', fed: true }), 'Questions').engagement).toBe('engaged')
    // MIDE is a reference kind — no engagement, so 'open'/'engaged' filters skip it.
    expect(taskEntryAttrsBlock(task({ code: 'MIDE' }), 'Missed ideas').engagement).toBeUndefined()
  })
})

describe('collectFilterGroupsBlock', () => {
  it('gathers distinct years, kinds, tags, and states across both zones', () => {
    const index: UndertakingIndex = {
      sections: [{ key: 's1', title: 'Company Studies', rows: [undertakingRow({ lastDate: '2026-06-01', tags: ['held'] })] }],
      taskSections: [{ code: 'QT', title: 'Questions', tasks: [task({ code: 'QT', openedDate: '2025-02-01', tags: ['watchlist'] })] }],
      windowStart: '',
      windowEnd: '',
    }
    const groups = collectFilterGroupsBlock(index)
    const byAttr = Object.fromEntries(groups.map(g => [g.attr, g.values.map(v => v.value)]))
    expect(byAttr.year).toEqual(['2026', '2025']) // newest first
    expect(byAttr.kind).toEqual(['Company Studies', 'Questions'])
    expect(byAttr.tag).toEqual(['held', 'watchlist'])
    expect(byAttr.engagement).toEqual(['open'])
  })
})
