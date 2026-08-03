import { describe, expect, it } from 'vitest'
import {
  taskBodyBlock,
  taskCategoryCodeBlock,
  taskCategoryLabelBlock,
  taskIsReferenceBlock,
  taskTicketBlock,
  parseTaskMarkdownBlock,
  taskDispositionBlock,
  taskIsDoneBlock,
} from '@/services/lego_blocks/units/aiActivityTaskBlock'

describe('taskIsReferenceBlock', () => {
  it('marks captured-knowledge kinds as reference (no open glyph)', () => {
    for (const code of ['KT', 'TT', 'EL', 'EM', 'MIDE']) {
      expect(taskIsReferenceBlock(code)).toBe(true)
    }
  })
  it('leaves open-loop kinds non-reference', () => {
    for (const code of ['QT', 'IC', 'IDE', 'ET', 'EO', 'TD']) {
      expect(taskIsReferenceBlock(code)).toBe(false)
    }
  })
})

describe('taskTicketBlock', () => {
  it('extracts the plain ticket from a slugged key', () => {
    expect(taskTicketBlock('f9-qt-e-541-history-of-silicon-chips')).toBe('F9-QT-E-541')
    expect(taskTicketBlock('F9-IDE-E-429')).toBe('F9-IDE-E-429')
  })

  it('reads any type letter, not just the epic E', () => {
    // Thinking Space mints tasks (`-t-`), F9 mints epics (`-e-`). Pinning the
    // letter returned the whole slug for every Thinking Space record, so no
    // `fed_by` edge could match one.
    expect(taskTicketBlock('tp-af-t-108-open-in-new-window-context-action')).toBe('TP-AF-T-108')
    expect(taskTicketBlock('tp-da-t-856-ios-memory')).toBe('TP-DA-T-856')
  })

  it('falls back to the whole key when it carries no ticket shape', () => {
    expect(taskTicketBlock('some-hand-written-note')).toBe('SOME-HAND-WRITTEN-NOTE')
  })
})

describe('taskCategoryCodeBlock', () => {
  it('extracts the category code from a task key, case-insensitively', () => {
    expect(taskCategoryCodeBlock('f9-qt-e-318')).toBe('QT')
    expect(taskCategoryCodeBlock('F9-IDE-E-429')).toBe('IDE')
    expect(taskCategoryCodeBlock('f9-ic-e-499')).toBe('IC')
  })
  it('folds II into IDE and MI into MIDE', () => {
    expect(taskCategoryCodeBlock('f9-ii-e-348')).toBe('IDE')
    expect(taskCategoryCodeBlock('f9-mi-e-300')).toBe('MIDE')
  })
  it('returns empty for a key that is not the task shape', () => {
    expect(taskCategoryCodeBlock('f9-und-micron-memory-cycle')).toBe('')
  })
})

describe('taskCategoryLabelBlock', () => {
  it('labels known codes and title-cases an unlabelled one', () => {
    expect(taskCategoryLabelBlock('QT')).toBe('Questions to research')
    expect(taskCategoryLabelBlock('IC')).toBe('Interesting companies')
    expect(taskCategoryLabelBlock('TAX')).toBe('Tax')
    // Headings are names, so an unlabelled code must not read as a raw code
    // sitting among them.
    expect(taskCategoryLabelBlock('ZZ')).toBe('Zz')
    // No code at all is a project whose records have no kinds (Thinking Space),
    // not a record that lost one — so the heading names the corpus.
    expect(taskCategoryLabelBlock('')).toBe('Tasks')
  })
})

describe('parseTaskMarkdownBlock', () => {
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

  it('parses an epic into a task — category, date, tags, and a ticket-stripped title', () => {
    const task = parseTaskMarkdownBlock(epic)
    expect(task).not.toBeNull()
    expect(task!.key).toBe('f9-ic-e-499')
    expect(task!.categoryCode).toBe('IC')
    expect(task!.category).toBe('Interesting companies')
    expect(task!.openedDate).toBe('2026-03-01')
    expect(task!.tags).toEqual(['for sure for value', 'bucket 1'])
    // The ticket prefix moves to the detail page; the row title is clean.
    expect(task!.title).toBe('learn more about LAM Research')
  })

  it('reads the single `tags` field and ignores any legacy project_preset_tags', () => {
    const withLegacy = epic.replace('---\n\n## Description', 'project_preset_tags:\n  - legacy\n---\n\n## Description')
    expect(parseTaskMarkdownBlock(withLegacy)!.tags).toEqual(['for sure for value', 'bucket 1'])
  })

  it('rejects a non-epic record_kind', () => {
    const program = epic.replace('record_kind: epic', 'record_kind: program')
    expect(parseTaskMarkdownBlock(program)).toBeNull()
  })

  it('returns null on a file without frontmatter', () => {
    expect(parseTaskMarkdownBlock('just text')).toBeNull()
  })
})

describe('taskBodyBlock', () => {
  // The real shape from the old organizer: frontmatter, then a Description
  // section and a Comments thread.
  const FILE = [
    '---',
    'key: f9-mi-e-300-the-price-increase',
    'title: F9-MI-E-300 - the price increase',
    'created_at: "2026-02-26T18:22:06.606Z"',
    '---',
    '',
    '## Description',
    '',
    'this is not a for sure thing.',
    '',
  ].join('\n')

  it('returns everything after the frontmatter, leading blank lines trimmed', () => {
    expect(taskBodyBlock(FILE)).toBe('## Description\n\nthis is not a for sure thing.\n')
  })

  it('treats a file with no frontmatter as all body', () => {
    // A hand-written file is still readable; the drawer shows what is there.
    expect(taskBodyBlock('just a thought\n')).toBe('just a thought\n')
  })

  it('returns empty when the frontmatter never closes', () => {
    // Half-saved file: better a blank body than the YAML rendered as prose.
    expect(taskBodyBlock('---\nkey: x\n')).toBe('')
  })
})

describe('parseTaskMarkdownBlock — the ticket', () => {
  it("trusts the record's own ticket over the one in its key", () => {
    // A Thinking Space task. Its key does not carry the epic shape, so deriving
    // the ticket from it yields the whole slug — the record states its own
    // address and that is what `fed_by` edges name it by.
    const task = parseTaskMarkdownBlock(`---
uuid: b2
key: tp-af-t-108-open-in-new-window-context-action-available-everywhere
title: TP-AF-T-108 - Open in New Window context action available everywhere
record_kind: task
ticket: TP-AF-T-108
created_at: "2026-02-26T00:33:07.809Z"
---
Body.
`)
    expect(task!.ticket).toBe('TP-AF-T-108')
    // No kind on the record and none in the key: these are simply tasks.
    expect(task!.category).toBe('Tasks')
  })
})

describe('the disposition', () => {
  it('reads task_status, with status behind it', () => {
    // Thinking Space states `task_status`; F9 has only ever had `status`.
    expect(taskDispositionBlock('done', 'completed')).toBe('done')
    expect(taskDispositionBlock(undefined, 'Active')).toBe('active')
    expect(taskDispositionBlock('  In_Progress ', undefined)).toBe('in_progress')
  })

  it('is empty when the record states neither, which is not the same as open', () => {
    // A thinking record has no lifecycle to be in. Calling it live would put
    // ideas under a filter that means work.
    expect(taskDispositionBlock(undefined, undefined)).toBe('')
    expect(taskDispositionBlock('', '  ')).toBe('')
  })

  it('counts both stores’ words for finished', () => {
    expect(taskIsDoneBlock('done')).toBe(true)
    expect(taskIsDoneBlock('completed')).toBe(true)
    expect(taskIsDoneBlock('in_progress')).toBe(false)
    expect(taskIsDoneBlock('ready')).toBe(false)
    expect(taskIsDoneBlock('blocked')).toBe(false)
    expect(taskIsDoneBlock('')).toBe(false)
  })

  it('lands on the parsed task', () => {
    const task = parseTaskMarkdownBlock(`---
key: tp-da-t-902-x
title: X
record_kind: task
task_status: done
created_at: "2026-02-26T00:33:07.809Z"
---
Body.
`)
    expect(task!.disposition).toBe('done')
  })
})
