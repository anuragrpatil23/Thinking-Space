// The one function authorised to delete files in the user's vault.
// See docs/contracts/DURABILITY.md.
//
// Every test here is really the same test: does it say "no" when it should.
// A stray empty file is a nuisance; a deleted paragraph is not recoverable.

import { describe, it, expect } from 'vitest'

import {
  isReapableNoteHuskBlock,
  isNoteEmptyBlock,
  isGeneratedOnlyFrontmatterBlock,
  parseFlatFrontmatterBlock,
  titleFromFilenameBlock,
} from '@/services/lego_blocks/units/noteHuskBlock'
import {
  parseNoteCanvasBlock,
  stringifyNoteCanvasBlock,
} from '@/services/lego_blocks/units/noteCanvasBlock'
import type { CanvasTile } from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'

/** Exactly what `createNote` + `thoughts.create` emit for an untouched note. */
const generated = (over: { title?: string; tags?: string[]; extra?: string } = {}) => [
  '---',
  'uuid: "8f14e45f-ceea-467a-9f52-1c2b3d4e5f60"',
  'key: "2026-08-22"',
  `title: "${over.title ?? '2026 08 22'}"`,
  'type: thought',
  'level: 4',
  'status: active',
  'created_at: "2026-08-22T10:00:00.000Z"',
  'updated_at: "2026-08-22T10:00:00.000Z"',
  ...(over.tags ? ['tags:', ...over.tags.map(t => `  - ${t}`)] : ['tags:', '  - thought']),
  ...(over.extra ? [over.extra] : []),
  '---',
  '',
].join('\n')

describe('isReapableNoteHuskBlock — reaps the husk it exists for', () => {
  it('reaps a frontmatter-only file the composer generated', () => {
    expect(isReapableNoteHuskBlock({
      content: generated(),
      filename: '2026-08-22.md',
    })).toBe(true)
  })

  it('reaps one whose body is only whitespace', () => {
    expect(isReapableNoteHuskBlock({
      content: `${generated()}\n   \n\t\n`,
      filename: '2026-08-22.md',
    })).toBe(true)
  })

  it('reaps a meeting-kind husk', () => {
    expect(isReapableNoteHuskBlock({
      content: generated({ tags: ['meeting'] }),
      filename: '2026-08-22.md',
    })).toBe(true)
  })
})

describe('isReapableNoteHuskBlock — refuses everything else', () => {
  it('refuses a note with body text', () => {
    expect(isReapableNoteHuskBlock({
      content: `${generated()}\nOne real sentence.\n`,
      filename: '2026-08-22.md',
    })).toBe(false)
  })

  // The clause my own first definition got wrong. `editorBody` strips the
  // canvas fence, so a prose-free drawing reads as empty unless tiles count.
  it('refuses a canvas-only note', () => {
    // Built with the real serializer, so the fixture cannot drift from the
    // format and quietly start passing for the wrong reason.
    const canvas = `${generated()}\n${stringifyNoteCanvasBlock([
      { id: 't1', x: 0, y: 0, w: 10, h: 10 } as unknown as CanvasTile,
    ])}\n`
    // The fence is stripped from the body, so this is false *only* because
    // tiles are counted — which is the clause under test.
    expect(parseNoteCanvasBlock(canvas).tiles.length).toBe(1)
    expect(isNoteEmptyBlock(canvas)).toBe(false)
    expect(isReapableNoteHuskBlock({ content: canvas, filename: '2026-08-22.md' })).toBe(false)
  })

  it('refuses a note with a title the user typed', () => {
    expect(isReapableNoteHuskBlock({
      content: generated({ title: 'Thoughts on the reorg' }),
      filename: '2026-08-22.md',
    })).toBe(false)
  })

  it('refuses a note carrying user tags', () => {
    expect(isReapableNoteHuskBlock({
      content: generated({ tags: ['thought', 'work'] }),
      filename: '2026-08-22.md',
    })).toBe(false)
  })

  it('refuses a note carrying emotions', () => {
    expect(isReapableNoteHuskBlock({
      content: generated({ tags: ['thought', 'emotion/anxious'] }),
      filename: '2026-08-22.md',
    })).toBe(false)
    expect(isReapableNoteHuskBlock({
      content: generated({ extra: 'emotions:\n  - anxious' }),
      filename: '2026-08-22.md',
    })).toBe(false)
  })

  it('refuses a note placed in the hierarchy', () => {
    expect(isReapableNoteHuskBlock({
      content: generated({ extra: 'parent: "some-epic"' }),
      filename: '2026-08-22.md',
    })).toBe(false)
  })

  // A hand-written stub is a deliberate act. Empty is not permission.
  it('refuses an empty file with hand-written frontmatter', () => {
    expect(isReapableNoteHuskBlock({
      content: '---\ntitle: "Placeholder"\n---\n\n',
      filename: 'placeholder.md',
    })).toBe(false)
  })

  it('refuses a file with no frontmatter at all', () => {
    expect(isReapableNoteHuskBlock({ content: '', filename: 'x.md' })).toBe(false)
    expect(isReapableNoteHuskBlock({ content: '\n\n', filename: 'x.md' })).toBe(false)
  })

  it('refuses a non-thought note type', () => {
    expect(isReapableNoteHuskBlock({
      content: generated().replace('type: thought', 'type: epic'),
      filename: '2026-08-22.md',
    })).toBe(false)
  })

  it('refuses frontmatter with structure this parser cannot vouch for', () => {
    const nested = [
      '---',
      'uuid: "x"',
      'title: "2026 08 22"',
      'type: thought',
      'meta:',
      '  nested:',
      '    deep: true',
      '---',
      '',
    ].join('\n')
    expect(isReapableNoteHuskBlock({ content: nested, filename: '2026-08-22.md' })).toBe(false)
  })
})

describe('parseFlatFrontmatterBlock', () => {
  it('reads scalars and lists', () => {
    const parsed = parseFlatFrontmatterBlock(generated({ tags: ['thought', 'work'] }))
    expect(parsed?.scalars.get('type')).toBe('thought')
    expect(parsed?.scalars.get('title')).toBe('2026 08 22')
    expect(parsed?.lists.get('tags')).toEqual(['thought', 'work'])
  })

  it('returns null without frontmatter', () => {
    expect(parseFlatFrontmatterBlock('just text')).toBeNull()
    expect(parseFlatFrontmatterBlock('---\nunterminated')).toBeNull()
  })
})

describe('isGeneratedOnlyFrontmatterBlock', () => {
  it('rejects an unparsed file outright', () => {
    expect(isGeneratedOnlyFrontmatterBlock(null)).toBe(false)
  })
})

describe('titleFromFilenameBlock', () => {
  it('matches the app derivation, so a generated title is recognised', () => {
    expect(titleFromFilenameBlock('2026-08-22.md')).toBe('2026 08 22')
    expect(titleFromFilenameBlock('my_note-name.md')).toBe('my note name')
    expect(titleFromFilenameBlock('.md')).toBe('Untitled Note')
  })
})
