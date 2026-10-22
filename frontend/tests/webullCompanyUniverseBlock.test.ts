import { describe, expect, it } from 'vitest'
import { buildWebullCompanyUniverseBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyUniverseBlock'

describe('buildWebullCompanyUniverseBlock', () => {
  const universe = buildWebullCompanyUniverseBlock({
    executionCompanies: [{ ticker: 'TSLA', cost: 150 }, { ticker: 'MRVL', cost: 50 }],
    studies: [
      { ticker: 'TSLA', company: 'Tesla', validThrough: '2026-12-16' },
      { ticker: 'MRVL', company: 'Marvell', validThrough: '2026-01-01' },
      { ticker: 'KLAC', company: 'KLA', validThrough: null },
    ],
    research: [
      { name: 'TSLA', folderPath: 'r/TSLA' },
      { name: 'Marvell', folderPath: 'r/Additional companies/Marvell' },
      { name: 'Broadcom', folderPath: 'r/Additional companies/Broadcom' },
    ],
    today: '2026-10-22',
  })
  const byKey = new Map(universe.map(c => [c.key, c]))

  it('groups held, studied-not-held and research-only companies', () => {
    expect(byKey.get('TSLA')?.group).toBe('held')
    expect(byKey.get('KLAC')?.group).toBe('watchlist')
    expect(byKey.get('name:Broadcom')?.group).toBe('researched')
  })

  it('joins a name-only research folder to the ticker it names', () => {
    expect(byKey.get('MRVL')?.researchFolderPath).toBe('r/Additional companies/Marvell')
    expect(byKey.has('name:Marvell')).toBe(false)
  })

  it('marks a study past valid_through as due', () => {
    expect(byKey.get('TSLA')?.studyState).toBe('current')
    expect(byKey.get('MRVL')?.studyState).toBe('due')
    expect(byKey.get('name:Broadcom')?.studyState).toBe('none')
  })

  it('orders held companies by cost share first', () => {
    expect(universe[0].ticker).toBe('TSLA')
    expect(universe[0].costShare).toBeCloseTo(0.75)
  })
})
