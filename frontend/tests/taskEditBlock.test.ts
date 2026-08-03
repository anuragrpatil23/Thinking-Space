import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  applyTaskEditBlock,
  assertBodyRoundTripsBlock,
} from '@/services/lego_blocks/integrations/taskEditBlock'
import { parseTaskMarkdownBlock } from '@/services/lego_blocks/units/aiActivityTaskBlock'

const NOW = '2026-08-03T12:00:00.000Z'

// The shape of a real Thinking Space record, down to the quoting.
const RECORD = `---
uuid: 2f1cf878-0910-4a42-abf0-24f38587eb69
key: tp-da-t-514-fix-fixed-shell-background-while-scrolling
title: TP-DA-T-514 - Fix fixed-shell background while scrolling
type: task
level: 5
created_at: "2026-02-20T23:38:22.625Z"
updated_at: "2026-02-20T23:39:34.998Z"
parent: task-backlog
description: Keep decorative backgrounds fixed while scrolling.
record_kind: task
task_status: done
project_root: lifeblood_systems/thinkingspace.ai
ticket: TP-DA-T-514
owner: codex-cli
tags:
  - bucket 1
schema_version: "2"
---

## Description

Keep decorative backgrounds fixed while scrolling.
`

const frontOf = (raw: string): Record<string, unknown> =>
  yaml.load(raw.split('\n---\n')[0].replace(/^---\n/, '')) as Record<string, unknown>

describe('applyTaskEditBlock', () => {
  it('leaves the file untouched byte-for-byte when the edit changes nothing', () => {
    // The guarantee the read-only rule used to provide: opening the drawer and
    // closing it must not be a write.
    expect(applyTaskEditBlock(RECORD, {}, NOW)).toBe(RECORD)
  })

  it('keeps every field it was not asked to change', () => {
    const out = applyTaskEditBlock(RECORD, { title: 'Something else' }, NOW)
    const front = frontOf(out)
    expect(front.uuid).toBe('2f1cf878-0910-4a42-abf0-24f38587eb69')
    expect(front.owner).toBe('codex-cli')
    expect(front.task_status).toBe('done')
    expect(front.schema_version).toBe('2')
    expect(front.parent).toBe('task-backlog')
    expect(front.created_at).toBe('2026-02-20T23:38:22.625Z')
  })

  it('re-applies the ticket prefix the record already wore', () => {
    const out = applyTaskEditBlock(RECORD, { title: 'Fix the shell background' }, NOW)
    expect(frontOf(out).title).toBe('TP-DA-T-514 - Fix the shell background')
    // …and the row still shows it without the prefix, so a save is a no-op for
    // the thing the user was looking at.
    expect(parseTaskMarkdownBlock(out)?.title).toBe('Fix the shell background')
  })

  it('invents no prefix for a record that never had one', () => {
    const bare = RECORD.replace('title: TP-DA-T-514 - Fix', 'title: Fix')
    expect(frontOf(applyTaskEditBlock(bare, { title: 'Renamed' }, NOW)).title).toBe('Renamed')
  })

  it('refuses an empty title rather than writing a nameless record', () => {
    expect(() => applyTaskEditBlock(RECORD, { title: '   ' }, NOW)).toThrow(/needs a title/)
  })

  it('moves the frontmatter summary with the body description', () => {
    const out = applyTaskEditBlock(RECORD, { description: 'A different reason.' }, NOW)
    expect(frontOf(out).description).toBe('A different reason.')
    expect(out).toContain('## Description\n\nA different reason.')
    expect(out).not.toContain('Keep decorative backgrounds')
  })

  it('drops an emptied field instead of writing it blank', () => {
    const out = applyTaskEditBlock(RECORD, { description: '', tags: [] }, NOW)
    const front = frontOf(out)
    expect(front.description).toBeUndefined()
    expect(front.tags).toBeUndefined()
  })

  it('appends a comment without disturbing the description', () => {
    const out = applyTaskEditBlock(
      RECORD,
      { addComment: { text: 'Still worth doing.', author: 'anurag' } },
      NOW,
    )
    expect(out).toContain('## Description')
    expect(out).toContain('Still worth doing.')
    expect(out).toContain('anurag')
  })

  it('appends rather than prepends, so the app and the CLI agree on order', () => {
    const once = applyTaskEditBlock(RECORD, { addComment: { text: 'first', author: 'a' } }, NOW)
    const twice = applyTaskEditBlock(once, { addComment: { text: 'second', author: 'a' } }, NOW)
    expect(twice.indexOf('first')).toBeLessThan(twice.indexOf('second'))
  })

  it('stamps updated_at only on a real change', () => {
    expect(frontOf(applyTaskEditBlock(RECORD, { title: 'X' }, NOW)).updated_at).toBe(NOW)
    expect(frontOf(applyTaskEditBlock(RECORD, {}, NOW)).updated_at).toBe('2026-02-20T23:39:34.998Z')
  })

  it('never touches the disposition, the parent, or the edges', () => {
    // The set of editable fields is the point of the seam, not an oversight —
    // if this test starts failing, something has begun typing into derived
    // ground.
    const out = applyTaskEditBlock(
      RECORD,
      { title: 'X', description: 'Y', tags: ['z'], addComment: { text: 'c', author: 'a' } },
      NOW,
    )
    const front = frontOf(out)
    expect(front.task_status).toBe('done')
    expect(front.parent).toBe('task-backlog')
    expect(front.ticket).toBe('TP-DA-T-514')
    expect(front.key).toBe('tp-da-t-514-fix-fixed-shell-background-while-scrolling')
  })
})

describe('the round-trip guard', () => {
  // The eight real records that carry this shape: a comment write went wrong
  // months ago and leaked its YAML tail into the prose, leaving a second
  // `## Description`. Re-emitting the body drops the orphaned fragment.
  const CORRUPTED = `---
key: tp-da-t-514-x
title: TP-DA-T-514 - X
---

## Description

Keep backgrounds fixed.decorative backgrounds so only foreground scrolls."
    added_at: "2026-02-20T23:39:34.998Z"
    added_by: codex-cli

## Description

Keep backgrounds fixed.
`

  it('refuses a body it cannot re-emit intact', () => {
    expect(() => applyTaskEditBlock(CORRUPTED, { title: 'Renamed' }, NOW)).toThrow(/losing part of it/)
  })

  it('tolerates blank-line normalisation, which is not content changing', () => {
    // Seven real records differ from their own round-trip by three or four
    // whitespace characters. Refusing those would be the guard crying wolf.
    expect(() =>
      assertBodyRoundTripsBlock('## Description\n\n\n\nSome prose.\n\n\n'),
    ).not.toThrow()
  })

  it('passes an ordinary record', () => {
    expect(() => assertBodyRoundTripsBlock('## Description\n\nOne line.\n')).not.toThrow()
  })
})
