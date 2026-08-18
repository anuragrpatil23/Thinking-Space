import { describe, expect, it } from 'vitest'
import {
  applyTagsBlock,
  extendVocabularyBlock,
  normalizeTagBlock,
  parseUndertakingBlock,
  resolveTagBlock,
  serializeUndertakingBlock,
  similarUndertakingsBlock,
  titleSimilarityBlock,
  type TagVocabulary,
} from '@/services/lego_blocks/units/aiActivityUndertakingBlock'

// A real Phase 1 record, trimmed.
const FILE = `---
uuid: fad676da-5afa-4e71-a4f2-4073ee68a6f0
key: f9-und-micron-memory-cycle
title: "Micron — the memory cycle"
type: undertaking
level: 1
record_kind: undertaking
project_id: 8bf4d342-df75-4df2-93ec-c35327f1016f
parent: f9-sec-company-studies
parent_type: section
created_at: "2026-06-19"
updated_at: "2026-06-22"
sort_order: 5
proposed_tags:
  - "held"
  - "exit-priced"
grew_out_of:
  - "f9-und-tsmc-entry-discipline-hbm-bottleneck"
chains:
  - "F9::native/claude/abc.jsonl"
files: []
origin: dry-run-2026-07
---

The memory cycle turned, and the turn was priced before the earnings confirmed it.
`

const VOCAB: TagVocabulary = {
  tags: ['for sure for value', 'for sure for price', 'bucket 1', 'bucket 2', 'worked'],
}

describe('parseUndertakingBlock', () => {
  it('reads frontmatter and treats the body as the head', () => {
    const record = parseUndertakingBlock(FILE)!
    expect(record.key).toBe('f9-und-micron-memory-cycle')
    expect(record.title).toBe('Micron — the memory cycle')
    expect(record.section).toBe('f9-sec-company-studies')
    expect(record.proposedTags).toEqual(['held', 'exit-priced'])
    expect(record.grewOutOf).toHaveLength(1)
    expect(record.head).toBe(
      'The memory cycle turned, and the turn was priced before the earnings confirmed it.',
    )
  })

  it('defaults tags to empty when the field is absent', () => {
    expect(parseUndertakingBlock(FILE)!.tags).toEqual([])
  })

  // The organizer folder holds sections and misattribution notes alongside
  // undertakings; misreading one as the other would file it into the index.
  it('rejects a record of a different kind', () => {
    expect(parseUndertakingBlock(FILE.replace('record_kind: undertaking', 'record_kind: section'))).toBeNull()
  })

  it('rejects malformed or non-frontmatter input', () => {
    expect(parseUndertakingBlock('just prose')).toBeNull()
    expect(parseUndertakingBlock('---\n: : :\n---\n')).toBeNull()
  })
})

describe('serializeUndertakingBlock', () => {
  it('round-trips without losing fields', () => {
    const record = parseUndertakingBlock(FILE)!
    const again = parseUndertakingBlock(serializeUndertakingBlock(record))!
    expect(again).toEqual(record)
  })

  // An empty `files: []` records that chains carry no file references yet.
  // Dropping the key would make a known gap look like an absent concept.
  it('keeps empty arrays rather than dropping the keys', () => {
    const out = serializeUndertakingBlock(parseUndertakingBlock(FILE)!)
    expect(out).toContain('files: []')
    expect(out).toContain('tags: []')
  })
})

describe('undertaking comments (body)', () => {
  const WITH_COMMENTS = FILE.replace(
    'The memory cycle turned, and the turn was priced before the earnings confirmed it.\n',
    `The memory cycle turned, and the turn was priced before the earnings confirmed it.

## Comments

**2026-07-31** — reconsidered after the MU earnings; thesis held.

**2026-06-02** · Kai — first flagged this.

a paragraph typed straight into Obsidian with no date lead
`,
  )

  it('leaves comments empty and head whole when there is no ## Comments heading', () => {
    const record = parseUndertakingBlock(FILE)!
    expect(record.comments).toEqual([])
    expect(record.head).not.toContain('## Comments')
  })

  it('splits head from a dated comments section', () => {
    const record = parseUndertakingBlock(WITH_COMMENTS)!
    expect(record.head).toBe(
      'The memory cycle turned, and the turn was priced before the earnings confirmed it.',
    )
    expect(record.comments).toHaveLength(3)
    expect(record.comments[0]).toEqual({ date: '2026-07-31', author: '', text: 'reconsidered after the MU earnings; thesis held.' })
    expect(record.comments[1]).toEqual({ date: '2026-06-02', author: 'Kai', text: 'first flagged this.' })
  })

  it('parses a lead-less paragraph as an undated comment rather than dropping it', () => {
    const record = parseUndertakingBlock(WITH_COMMENTS)!
    expect(record.comments[2]).toEqual({ date: '', author: '', text: 'a paragraph typed straight into Obsidian with no date lead' })
  })

  it('round-trips comments without loss', () => {
    const record = parseUndertakingBlock(WITH_COMMENTS)!
    const again = parseUndertakingBlock(serializeUndertakingBlock(record))!
    expect(again.comments).toEqual(record.comments)
    expect(again.head).toBe(record.head)
  })

  it('writes a ## Comments section only when there are comments', () => {
    expect(serializeUndertakingBlock(parseUndertakingBlock(FILE)!)).not.toContain('## Comments')
    expect(serializeUndertakingBlock(parseUndertakingBlock(WITH_COMMENTS)!)).toContain('## Comments')
  })
})

describe('normalizeTagBlock', () => {
  it('collapses case, separators, and edge punctuation', () => {
    expect(normalizeTagBlock('For Sure For Value')).toBe('for sure for value')
    expect(normalizeTagBlock('entry_priced')).toBe('entry priced')
    expect(normalizeTagBlock('  (held)  ')).toBe('held')
  })

  // `held?` is a real dry-run tag and the question mark is the whole meaning.
  it('preserves a trailing question mark', () => {
    expect(normalizeTagBlock('held?')).toBe('held?')
  })
})

describe('resolveTagBlock', () => {
  it('matches case-insensitively and returns the vocabulary display form', () => {
    expect(resolveTagBlock('FOR SURE FOR VALUE', VOCAB)).toBe('for sure for value')
  })

  it('returns null for a tag outside the vocabulary', () => {
    expect(resolveTagBlock('momentum phase', VOCAB)).toBeNull()
  })
})

describe('applyTagsBlock', () => {
  const record = { tags: ['bucket 1'], proposedTags: ['held', 'exit-priced'] }

  it('adds a known tag', () => {
    const result = applyTagsBlock(record, { add: ['worked'] }, VOCAB)
    expect(result.tags).toEqual(['bucket 1', 'worked'])
    expect(result.rejected).toEqual([])
  })

  // The old organizer accumulated both `bucket 2` and `bucket 2 - momentum
  // phase` across only six tagged records. Refusing unknown tags by default is
  // what stops that.
  it('refuses an unknown tag unless allowNew is set', () => {
    const strict = applyTagsBlock(record, { add: ['momentum phase'] }, VOCAB)
    expect(strict.tags).toEqual(['bucket 1'])
    expect(strict.rejected).toEqual(['momentum phase'])

    const loose = applyTagsBlock(record, { add: ['momentum phase'], allowNew: true }, VOCAB)
    expect(loose.tags).toContain('momentum phase')
    expect(loose.added).toEqual(['momentum phase'])
  })

  it('promotes a proposed tag out of the pending list', () => {
    const result = applyTagsBlock(record, { accept: ['held'], allowNew: true }, VOCAB)
    expect(result.tags).toContain('held')
    expect(result.proposedTags).toEqual(['exit-priced'])
  })

  it('rejects a proposal without accepting it', () => {
    const result = applyTagsBlock(record, { reject: ['held'] }, VOCAB)
    expect(result.tags).toEqual(['bucket 1'])
    expect(result.proposedTags).toEqual(['exit-priced'])
  })

  it('removes an existing tag', () => {
    expect(applyTagsBlock(record, { remove: ['bucket 1'] }, VOCAB).tags).toEqual([])
  })

  // Removal runs before addition so one call can swap a tag.
  it('supports replacing a tag in a single call', () => {
    const result = applyTagsBlock(record, { remove: ['bucket 1'], add: ['bucket 2'] }, VOCAB)
    expect(result.tags).toEqual(['bucket 2'])
  })

  it('is idempotent — adding an existing tag changes nothing', () => {
    const result = applyTagsBlock(record, { add: ['Bucket 1'] }, VOCAB)
    expect(result.tags).toEqual(['bucket 1'])
  })

  it('normalizes an accepted tag to the vocabulary display form', () => {
    const result = applyTagsBlock({ tags: [], proposedTags: [] }, { add: ['BUCKET 2'] }, VOCAB)
    expect(result.tags).toEqual(['bucket 2'])
  })

  it('drops a proposal that duplicates an accepted tag', () => {
    const result = applyTagsBlock(
      { tags: [], proposedTags: ['Bucket 1'] },
      { add: ['bucket 1'] },
      VOCAB,
    )
    expect(result.tags).toEqual(['bucket 1'])
    expect(result.proposedTags).toEqual([])
  })
})

describe('extendVocabularyBlock', () => {
  it('appends new tags and preserves existing order', () => {
    const next = extendVocabularyBlock(VOCAB, ['momentum phase'])
    expect(next.tags[next.tags.length - 1]).toBe('momentum phase')
    expect(next.tags.slice(0, VOCAB.tags.length)).toEqual(VOCAB.tags)
  })

  it('does not duplicate a tag that already exists in another case', () => {
    expect(extendVocabularyBlock(VOCAB, ['Bucket 1']).tags).toHaveLength(VOCAB.tags.length)
  })
})

describe('similarUndertakingsBlock', () => {
  const records = [
    { key: 'f9-und-the-cognition-tide', title: 'The Cognition Tide — AI and where value goes' },
    { key: 'f9-und-micron-memory-cycle', title: 'Micron — the memory cycle' },
    { key: 'f9-und-tsmc', title: 'TSMC — entry discipline and the HBM bottleneck' },
    { key: 'f9-und-interest-rates', title: 'Interest rates as gravity' },
  ]

  it('surfaces the neighbour a new title is probably duplicating', () => {
    expect(similarUndertakingsBlock('The Cognition Tide — where value actually goes', records)).toEqual([
      { key: 'f9-und-the-cognition-tide', title: 'The Cognition Tide — AI and where value goes' },
    ])
  })

  it('stays quiet on a genuinely new strand', () => {
    // The failure mode that matters more than a missed duplicate: an advisory
    // that fires on everything is one nobody reads, and this one sits next to a
    // decision the human is already being asked to make quickly.
    expect(similarUndertakingsBlock('Rare earths and the magnet bottleneck', records)).toEqual([])
  })

  it('does not match on stopwords alone', () => {
    expect(similarUndertakingsBlock('The and of the', records)).toEqual([])
  })

  it('scores symmetrically, so a short title is not a subset match', () => {
    // Overlap-over-shortest made every two-word title look like a duplicate of
    // any longer title containing both words. Jaccard punishes the size gap.
    expect(titleSimilarityBlock('memory cycle', 'Micron — the memory cycle')).toBeLessThan(1)
    expect(titleSimilarityBlock('a', 'b')).toBe(0)
  })

  it('is order-independent', () => {
    expect(titleSimilarityBlock('alpha beta', 'beta alpha')).toBe(1)
  })
})
