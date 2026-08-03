import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  nextTaskTicketBlock,
  renderTaskMarkdownBlock,
  taskFileKeyBlock,
  taskTemplateFromMarkdownBlock,
} from '@/services/lego_blocks/units/taskDraftBlock'

const SIBLING = `---
uuid: 92cecbed-a630-4e58-81d6-d7292a1bb8b1
key: f9-tt-e-767-appls-margins
title: F9-TT-E-767 - APPLs margins
type: epic
level: 1
status: active
created_at: "2026-03-18T21:55:42.014Z"
updated_at: "2026-03-18T21:55:42.014Z"
parent: f9-tt-p-206-things-to-remember-2026
record_kind: epic
task_kind: TT
project_root: acceleration_core/F9
ticket: F9-TT-E-767
owner: codex-gpt5
---

## Description

Body text.
`

describe('taskTemplateFromMarkdownBlock', () => {
  it('keeps the fields that say what and where, and drops the ones that say which', () => {
    const template = taskTemplateFromMarkdownBlock(SIBLING)
    expect(template).toEqual({
      type: 'epic',
      level: 1,
      status: 'active',
      parent: 'f9-tt-p-206-things-to-remember-2026',
      record_kind: 'epic',
      task_kind: 'TT',
      project_root: 'acceleration_core/F9',
    })
  })

  it('never carries the sibling’s identity across', () => {
    const template = taskTemplateFromMarkdownBlock(SIBLING)
    expect(template.key).toBeUndefined()
    expect(template.uuid).toBeUndefined()
    expect(template.ticket).toBeUndefined()
    expect(template.title).toBeUndefined()
    // A record typed into the composer is Anurag's, not the agent's that wrote
    // the sibling it was minted from.
    expect(template.owner).toBeUndefined()
  })

  it('returns nothing for a file with no frontmatter, so the caller refuses to mint', () => {
    expect(taskTemplateFromMarkdownBlock('just prose')).toEqual({})
    expect(taskTemplateFromMarkdownBlock('---\n: : bad yaml :\n---\n')).toEqual({})
  })
})

describe('nextTaskTicketBlock', () => {
  it('runs past the highest number in the most-used stem', () => {
    // Thinking Space's real distribution: one dominant stem and two strays.
    const tickets = [
      ...Array.from({ length: 5 }, (_, i) => `TP-DA-T-${100 + i}`),
      'TP-AF-T-900',
      'TP-PG-T-12',
    ]
    expect(nextTaskTicketBlock(tickets)).toBe('TP-DA-T-105')
  })

  it('breaks a tie on the higher number, so a migration grows the newer stem', () => {
    expect(nextTaskTicketBlock(['F9-QT-E-10', 'F9-QT-T-40'])).toBe('F9-QT-T-41')
  })

  it('returns nothing when no ticket carries an address shape', () => {
    expect(nextTaskTicketBlock(['SOME-HAND-WRITTEN-NOTE', ''])).toBe('')
    expect(nextTaskTicketBlock([])).toBe('')
  })
})

describe('taskFileKeyBlock', () => {
  it('is the ticket plus a slug of the title', () => {
    expect(taskFileKeyBlock('TP-DA-T-902', 'Make the drawer white')).toBe(
      'tp-da-t-902-make-the-drawer-white',
    )
  })

  it('caps a title long enough to break a filename, without a trailing dash', () => {
    const key = taskFileKeyBlock('TP-DA-T-902', 'a'.repeat(200))
    expect(key.length).toBeLessThanOrEqual('tp-da-t-902-'.length + 80)
    expect(key.endsWith('-')).toBe(false)
  })

  it('falls back to the bare ticket when the title has nothing sluggable', () => {
    expect(taskFileKeyBlock('TP-DA-T-902', '???')).toBe('tp-da-t-902')
  })
})

describe('renderTaskMarkdownBlock', () => {
  const rendered = renderTaskMarkdownBlock({
    template: taskTemplateFromMarkdownBlock(SIBLING),
    uuid: 'new-uuid',
    key: 'f9-tt-e-768-a-new-thought',
    ticket: 'F9-TT-E-768',
    title: 'A new thought',
    description: 'Why it matters.',
    nowIso: '2026-08-03T10:00:00.000Z',
    body: '## Description\n\nWhy it matters.',
  })
  const front = yaml.load(rendered.split('---')[1]) as Record<string, unknown>

  it('inherits the sibling’s shape', () => {
    expect(front.parent).toBe('f9-tt-p-206-things-to-remember-2026')
    expect(front.task_kind).toBe('TT')
    expect(front.record_kind).toBe('epic')
    expect(front.type).toBe('epic')
  })

  it('writes its own identity, ticket-prefixed title included', () => {
    expect(front.uuid).toBe('new-uuid')
    expect(front.key).toBe('f9-tt-e-768-a-new-thought')
    expect(front.ticket).toBe('F9-TT-E-768')
    expect(front.title).toBe('F9-TT-E-768 - A new thought')
    expect(front.created_at).toBe('2026-08-03T10:00:00.000Z')
    expect(front.updated_at).toBe('2026-08-03T10:00:00.000Z')
  })

  it('keeps the description in the body where the drawer reads it', () => {
    expect(rendered).toContain('## Description\n\nWhy it matters.')
  })

  it('lets identity win over anything the template carried under the same name', () => {
    const out = renderTaskMarkdownBlock({
      template: { key: 'the-sibling', ticket: 'F9-TT-E-767' },
      uuid: 'u',
      key: 'mine',
      ticket: 'F9-TT-E-768',
      title: 'T',
      description: '',
      nowIso: '2026-08-03T10:00:00.000Z',
      body: '',
    })
    const parsed = yaml.load(out.split('---')[1]) as Record<string, unknown>
    expect(parsed.key).toBe('mine')
    expect(parsed.ticket).toBe('F9-TT-E-768')
  })
})

describe('the new record’s disposition', () => {
  it('inherits the presence of a disposition, never the sibling’s value', () => {
    // The newest sibling is almost always `done` — copying it would mint a
    // record that arrives already finished.
    const template = taskTemplateFromMarkdownBlock(`---
key: tp-da-t-901-y
task_status: done
status: completed
---
body`)
    expect(template.task_status).toBe('ready')
    expect(template.status).toBe('active')
  })

  it('gives no disposition to a project whose records track none', () => {
    // F9's thinking records: an idea has no lifecycle to be in.
    const template = taskTemplateFromMarkdownBlock(`---
key: f9-tt-e-767-x
type: epic
---
body`)
    expect(template.task_status).toBeUndefined()
    expect(template.status).toBeUndefined()
  })
})
