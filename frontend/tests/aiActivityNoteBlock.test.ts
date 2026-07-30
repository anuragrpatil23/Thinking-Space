import { describe, expect, it } from 'vitest'
import {
  noteCategoryCodeBlock,
  noteCategoryLabelBlock,
  parseNoteMarkdownBlock,
} from '@/services/lego_blocks/units/aiActivityNoteBlock'

describe('noteCategoryCodeBlock', () => {
  it('extracts the category code from an ask key, case-insensitively', () => {
    expect(noteCategoryCodeBlock('f9-qt-e-318')).toBe('QT')
    expect(noteCategoryCodeBlock('F9-IDE-E-429')).toBe('IDE')
    expect(noteCategoryCodeBlock('f9-ic-e-499')).toBe('IC')
  })
  it('returns empty for a key that is not the ask shape', () => {
    expect(noteCategoryCodeBlock('f9-und-micron-memory-cycle')).toBe('')
  })
})

describe('noteCategoryLabelBlock', () => {
  it('labels known codes and falls back to the code itself', () => {
    expect(noteCategoryLabelBlock('QT')).toBe('Questions to research')
    expect(noteCategoryLabelBlock('IC')).toBe('Interesting companies')
    expect(noteCategoryLabelBlock('ZZ')).toBe('ZZ')
  })
})

describe('parseNoteMarkdownBlock', () => {
  const epic = `---
uuid: a1
key: f9-ic-e-499
title: F9-IC-E-499 - learn more about LAM Research
type: epic
record_kind: epic
status: active
created_at: "2026-03-01T10:00:00.000Z"
parent: f9-ic-p-698
---

## Description
Understand LAM Research.
`

  it('parses an epic into an ask with category and opened date', () => {
    const ask = parseNoteMarkdownBlock(epic)
    expect(ask).not.toBeNull()
    expect(ask!.key).toBe('f9-ic-e-499')
    expect(ask!.categoryCode).toBe('IC')
    expect(ask!.category).toBe('Interesting companies')
    expect(ask!.openedDate).toBe('2026-03-01')
  })

  it('rejects a non-epic record_kind', () => {
    const program = epic.replace('record_kind: epic', 'record_kind: program')
    expect(parseNoteMarkdownBlock(program)).toBeNull()
  })

  it('returns null on a file without frontmatter', () => {
    expect(parseNoteMarkdownBlock('just text')).toBeNull()
  })
})
