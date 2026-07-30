import { describe, expect, it } from 'vitest'
import {
  noteCategoryCodeBlock,
  noteCategoryLabelBlock,
  noteIsReferenceBlock,
  noteTicketBlock,
  parseNoteMarkdownBlock,
} from '@/services/lego_blocks/units/aiActivityNoteBlock'

describe('noteIsReferenceBlock', () => {
  it('marks captured-knowledge kinds as reference (no open glyph)', () => {
    for (const code of ['KT', 'TT', 'EL', 'EM', 'MIDE']) {
      expect(noteIsReferenceBlock(code)).toBe(true)
    }
  })
  it('leaves open-loop kinds non-reference', () => {
    for (const code of ['QT', 'IC', 'IDE', 'ET', 'EO', 'TD']) {
      expect(noteIsReferenceBlock(code)).toBe(false)
    }
  })
})

describe('noteTicketBlock', () => {
  it('extracts the plain ticket from a slugged key', () => {
    expect(noteTicketBlock('f9-qt-e-541-history-of-silicon-chips')).toBe('F9-QT-E-541')
    expect(noteTicketBlock('F9-IDE-E-429')).toBe('F9-IDE-E-429')
  })
})

describe('noteCategoryCodeBlock', () => {
  it('extracts the category code from a note key, case-insensitively', () => {
    expect(noteCategoryCodeBlock('f9-qt-e-318')).toBe('QT')
    expect(noteCategoryCodeBlock('F9-IDE-E-429')).toBe('IDE')
    expect(noteCategoryCodeBlock('f9-ic-e-499')).toBe('IC')
  })
  it('folds II into IDE and MI into MIDE', () => {
    expect(noteCategoryCodeBlock('f9-ii-e-348')).toBe('IDE')
    expect(noteCategoryCodeBlock('f9-mi-e-300')).toBe('MIDE')
  })
  it('returns empty for a key that is not the note shape', () => {
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
tags:
  - for sure for value
  - bucket 1
---

## Description
Understand LAM Research.
`

  it('parses an epic into a note — category, date, tags, and a ticket-stripped title', () => {
    const note = parseNoteMarkdownBlock(epic)
    expect(note).not.toBeNull()
    expect(note!.key).toBe('f9-ic-e-499')
    expect(note!.categoryCode).toBe('IC')
    expect(note!.category).toBe('Interesting companies')
    expect(note!.openedDate).toBe('2026-03-01')
    expect(note!.tags).toEqual(['for sure for value', 'bucket 1'])
    // The ticket prefix moves to the detail page; the row title is clean.
    expect(note!.title).toBe('learn more about LAM Research')
  })

  it('reads the single `tags` field and ignores any legacy project_preset_tags', () => {
    const withLegacy = epic.replace('---\n\n## Description', 'project_preset_tags:\n  - legacy\n---\n\n## Description')
    expect(parseNoteMarkdownBlock(withLegacy)!.tags).toEqual(['for sure for value', 'bucket 1'])
  })

  it('rejects a non-epic record_kind', () => {
    const program = epic.replace('record_kind: epic', 'record_kind: program')
    expect(parseNoteMarkdownBlock(program)).toBeNull()
  })

  it('returns null on a file without frontmatter', () => {
    expect(parseNoteMarkdownBlock('just text')).toBeNull()
  })
})
