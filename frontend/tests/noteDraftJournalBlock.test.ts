// Recovery journal, pure half. See docs/contracts/DURABILITY.md.
//
// The journal is the copy of typed text that survives a crash, so its two
// dangerous mistakes are: losing a character in the round trip, and claiming a
// draft is safe when it isn't. Both are tested here.

import { describe, it, expect } from 'vitest'

import {
  createDraftIdBlock,
  draftFilePathBlock,
  sanitizeDraftIdBlock,
  serializeNoteDraftBlock,
  parseNoteDraftBlock,
  isDraftCoveredByDiskBlock,
  unresolvedDraftsBlock,
  sortDraftsByRecencyBlock,
  DRAFT_JOURNAL_DIR_BLOCK,
  type NoteDraftEntryBlock,
} from '@/services/lego_blocks/units/noteDraftJournalBlock'

const entry = (over: Partial<NoteDraftEntryBlock> = {}): NoteDraftEntryBlock => ({
  id: '2026-08-22T10-00-00-000Z-abc123',
  targetPath: 'lifeblood/thoughts/2026-08-22.md',
  content: 'a half-written thought',
  updatedAt: '2026-08-22T10:00:00.000Z',
  createdTarget: true,
  ...over,
})

describe('serialize / parse round trip', () => {
  it('preserves content exactly', () => {
    const original = entry()
    expect(parseNoteDraftBlock(serializeNoteDraftBlock(original))).toEqual(original)
  })

  // The note's own frontmatter starts with `---`, the same fence the journal
  // header uses. Getting this wrong would silently truncate every saved note
  // that was ever recovered.
  it('survives content that is itself frontmatter', () => {
    const original = entry({
      content: '---\ntitle: "Nested"\ntags:\n  - thought\n---\n\nBody below the fence.\n',
    })
    expect(parseNoteDraftBlock(serializeNoteDraftBlock(original))?.content).toBe(original.content)
  })

  it('preserves leading and trailing whitespace in the body', () => {
    const original = entry({ content: '\n\n  indented start\n\ntrailing\n\n' })
    expect(parseNoteDraftBlock(serializeNoteDraftBlock(original))?.content).toBe(original.content)
  })

  it('preserves an empty destination', () => {
    const original = entry({ targetPath: null })
    expect(parseNoteDraftBlock(serializeNoteDraftBlock(original))?.targetPath).toBeNull()
  })

  it('carries provenance across the round trip', () => {
    // Content-independent, because after a crash it is the only way to know
    // whether an empty note is ours to reap or a deliberate stub.
    expect(parseNoteDraftBlock(serializeNoteDraftBlock(entry({ createdTarget: false })))?.createdTarget)
      .toBe(false)
    expect(parseNoteDraftBlock(serializeNoteDraftBlock(entry({ createdTarget: true })))?.createdTarget)
      .toBe(true)
  })
})

describe('parseNoteDraftBlock rejects what is not a draft', () => {
  // The drafts folder is in the user's vault, so anything can end up there.
  // Misreading a real note as a draft would offer to recover it over itself.
  it.each([
    ['a plain note', '# Just a note\n\nwith text'],
    ['frontmatter without the marker', '---\ntitle: "Real note"\n---\n\nbody'],
    ['an unterminated fence', '---\nthinkspc_draft: true\nno closing fence'],
    ['empty', ''],
    ['a draft header missing its id', '---\nthinkspc_draft: true\n---\n\nbody'],
  ])('rejects %s', (_label, text) => {
    expect(parseNoteDraftBlock(text)).toBeNull()
  })
})

describe('draft ids are safe as filenames', () => {
  it('keeps generated ids inside the drafts folder', () => {
    for (let i = 0; i < 100; i += 1) {
      const path = draftFilePathBlock(createDraftIdBlock())
      expect(path.startsWith(`${DRAFT_JOURNAL_DIR_BLOCK}/`)).toBe(true)
      expect(path.includes('..')).toBe(false)
    }
  })

  it('neutralises traversal in a hostile id', () => {
    expect(sanitizeDraftIdBlock('../../etc/passwd')).not.toContain('..')
    expect(draftFilePathBlock('../../etc/passwd')).not.toContain('..')
    expect(sanitizeDraftIdBlock('a/b/c')).toBe('a-b-c')
    expect(sanitizeDraftIdBlock('...')).toBe('draft')
    expect(sanitizeDraftIdBlock('')).toBe('draft')
  })
})

describe('isDraftCoveredByDiskBlock', () => {
  // Containment, not equality: a save re-reads the file and the capability
  // generates frontmatter, so what lands is never byte-identical to what was
  // journaled. The honest question is whether the typed characters are there.
  it('accepts text present at the target under generated frontmatter', () => {
    const disk = '---\ntitle: "x"\nuuid: "1234"\n---\n\na half-written thought\n'
    expect(isDraftCoveredByDiskBlock('a half-written thought', disk)).toBe(true)
  })

  it('rejects text that is not on disk', () => {
    expect(isDraftCoveredByDiskBlock('never written', '---\ntitle: "x"\n---\n\nsomething else'))
      .toBe(false)
  })

  it('rejects when the target does not exist at all', () => {
    expect(isDraftCoveredByDiskBlock('typed this', null)).toBe(false)
  })

  it('rejects a partial landing', () => {
    // The file has the start but not the end — precisely the crash-mid-save
    // case, and precisely when the draft must be kept.
    expect(isDraftCoveredByDiskBlock('first half and second half', 'first half and')).toBe(false)
  })

  it('treats an empty draft as nothing to lose', () => {
    expect(isDraftCoveredByDiskBlock('', null)).toBe(true)
    expect(isDraftCoveredByDiskBlock('   \n  ', null)).toBe(true)
    expect(isDraftCoveredByDiskBlock('---\ntitle: "x"\n---\n', null)).toBe(true)
  })
})

describe('unresolvedDraftsBlock', () => {
  it('offers only drafts whose text is nowhere else', () => {
    const landed = entry({ id: 'landed', content: 'saved text', targetPath: 'a.md' })
    const lost = entry({ id: 'lost', content: 'unsaved text', targetPath: 'b.md' })
    const homeless = entry({ id: 'homeless', content: 'no destination', targetPath: null })

    const disk = new Map<string, string | null>([
      ['a.md', '---\ntitle: "a"\n---\n\nsaved text'],
      ['b.md', '---\ntitle: "b"\n---\n\nsomething unrelated'],
    ])

    expect(unresolvedDraftsBlock([landed, lost, homeless], disk).map(d => d.id))
      .toEqual(['lost', 'homeless'])
  })

  it('offers nothing when everything landed', () => {
    const disk = new Map<string, string | null>([['a.md', 'a half-written thought']])
    expect(unresolvedDraftsBlock([entry({ targetPath: 'a.md' })], disk)).toEqual([])
  })
})

describe('sortDraftsByRecencyBlock', () => {
  it('puts the newest first', () => {
    const older = entry({ id: 'older', updatedAt: '2026-08-20T09:00:00.000Z' })
    const newer = entry({ id: 'newer', updatedAt: '2026-08-22T18:00:00.000Z' })
    expect(sortDraftsByRecencyBlock([older, newer]).map(d => d.id)).toEqual(['newer', 'older'])
  })

  it('does not mutate its input', () => {
    const input = [entry({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }), entry({ id: 'b', updatedAt: '2026-09-01T00:00:00.000Z' })]
    sortDraftsByRecencyBlock(input)
    expect(input.map(d => d.id)).toEqual(['a', 'b'])
  })
})
