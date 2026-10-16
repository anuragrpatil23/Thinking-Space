import { describe, expect, it } from 'vitest'
import { postItFilenameBlock, postItTitleBlock } from '@/services/lego_blocks/units/postItNoteBlock'
import { todayFilenameBlock } from '@/services/lego_blocks/units/noteComposerBlock'

describe('postItTitleBlock', () => {
  it('takes the first non-blank line', () => {
    expect(postItTitleBlock('\n\n  Account No - 345987003\nOrder No - 99')).toBe('Account No - 345987003')
  })

  it('strips leading markdown markers', () => {
    expect(postItTitleBlock('# Trip ideas')).toBe('Trip ideas')
    expect(postItTitleBlock('- Good food')).toBe('Good food')
    expect(postItTitleBlock('2. Jaipur')).toBe('Jaipur')
    expect(postItTitleBlock('- [ ] call bank')).toBe('call bank')
  })

  it('cuts a long first line at a word boundary', () => {
    const title = postItTitleBlock('at&t gift card - after 2 to 3 months. get an email with gift card link. use it for anything')
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith(' ')).toBe(false)
    expect('at&t gift card - after 2 to 3 months. get an email with gift card link.'.startsWith(title)).toBe(true)
  })

  it('is empty for a blank post-it', () => {
    expect(postItTitleBlock('  \n \n')).toBe('')
  })
})

describe('postItFilenameBlock', () => {
  it('slugs the title', () => {
    expect(postItFilenameBlock('Account No - 345987003\n...')).toBe('account-no-345987003.md')
  })

  it("falls back to today's date when nothing is slug-able", () => {
    expect(postItFilenameBlock('🎁🎁\nmore')).toBe(todayFilenameBlock())
    expect(postItFilenameBlock('')).toBe(todayFilenameBlock())
  })
})
