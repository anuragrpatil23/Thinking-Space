import { describe, expect, it } from 'vitest'
import {
  parseSectionBlock,
  sectionKeyFromTitleBlock,
  serializeSectionBlock,
} from '@/services/lego_blocks/units/aiActivitySectionBlock'

// A real migration-produced section file, trimmed.
const FILE = `---
uuid: 5dd155d0-2fc4-43e7-9842-6a4d906dba39
key: f9-sec-company-studies
title: "Company Studies"
type: program
level: 0
record_kind: section
project_id: 8bf4d342-df75-4df2-93ec-c35327f1016f
sort_order: 1
origin: dry-run-2026-07
---

Section of the F9 index. Holds undertakings, not tasks.
`

describe('parseSectionBlock', () => {
  it('reads a section node', () => {
    const s = parseSectionBlock(FILE)!
    expect(s.key).toBe('f9-sec-company-studies')
    expect(s.title).toBe('Company Studies')
    expect(s.sortOrder).toBe(1)
    expect(s.body).toBe('Section of the F9 index. Holds undertakings, not tasks.')
  })

  it('rejects a non-section record', () => {
    expect(parseSectionBlock(FILE.replace('record_kind: section', 'record_kind: undertaking'))).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(parseSectionBlock('not a node')).toBeNull()
  })
})

describe('serializeSectionBlock', () => {
  it('round-trips without loss', () => {
    const s = parseSectionBlock(FILE)!
    const again = parseSectionBlock(serializeSectionBlock(s))!
    expect(again).toEqual(s)
  })
})

describe('sectionKeyFromTitleBlock', () => {
  it('builds a project-prefixed slug', () => {
    expect(sectionKeyFromTitleBlock('F9', 'Company Studies', [])).toBe('f9-sec-company-studies')
  })

  it('de-duplicates against existing keys', () => {
    const existing = ['f9-sec-ideas']
    expect(sectionKeyFromTitleBlock('F9', 'Ideas', existing)).toBe('f9-sec-ideas-2')
    expect(sectionKeyFromTitleBlock('F9', 'Ideas', [...existing, 'f9-sec-ideas-2'])).toBe('f9-sec-ideas-3')
  })

  it('falls back when a title slugs to nothing', () => {
    const key = sectionKeyFromTitleBlock('F9', '!!!', [])
    expect(key).toBe('f9-sec-section')
  })
})
