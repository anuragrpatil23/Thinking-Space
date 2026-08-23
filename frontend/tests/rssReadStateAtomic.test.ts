import { describe, expect, it } from 'vitest'
import { rssReadStateNeedsWriteBlock, type RssFeedItemBlock } from '../src/services/lego_blocks/units/rssFeedBlock'

function item(patch: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock {
  return {
    id: 'feed-1::abc', feedId: 'feed-1', title: 'T', link: 'https://e.com/a',
    description: '', pubDate: '2026-08-10T09:00:00Z', imageUrl: null,
    read: false, viewedAt: null, dismissedAt: null,
    tags: [], keep: false, important: false, ...patch,
  }
}
const READ = { read: true, viewedAt: '2026-08-23T16:00:00Z', dismissedAt: '2026-08-23T16:00:00Z' }

describe('rssReadStateNeedsWriteBlock', () => {
  it('writes for a fresh unread article', () => {
    expect(rssReadStateNeedsWriteBlock(item(), true)).toBe(true)
  })

  it('is idempotent once all three fields agree', () => {
    expect(rssReadStateNeedsWriteBlock(item(READ), true)).toBe(false)
    expect(rssReadStateNeedsWriteBlock(item(), false)).toBe(false)
  })

  it('repairs an article the timeline only glanced — the case the old guard skipped forever', () => {
    // viewedAt set, dismissedAt null: guards keyed on dismissedAt alone saw
    // "nothing to do" and the article could never be marked.
    const glanced = item({ read: true, viewedAt: '2026-08-11T12:56:07.775Z', dismissedAt: null })
    expect(rssReadStateNeedsWriteBlock(glanced, true)).toBe(true)
  })

  it('repairs the inverse half-state too', () => {
    const halfDismissed = item({ read: false, viewedAt: null, dismissedAt: '2026-08-23T16:00:00Z' })
    expect(rssReadStateNeedsWriteBlock(halfDismissed, true)).toBe(true)
  })

  it('repairs a read flag that disagrees with its own timestamps', () => {
    expect(rssReadStateNeedsWriteBlock(item({ read: true }), true)).toBe(true)
    expect(rssReadStateNeedsWriteBlock(item({ ...READ, read: false }), true)).toBe(true)
  })

  it('clears every field when unmarking, not just one', () => {
    expect(rssReadStateNeedsWriteBlock(item({ read: false, viewedAt: '2026-08-11T00:00:00Z' }), false)).toBe(true)
    expect(rssReadStateNeedsWriteBlock(item({ dismissedAt: '2026-08-11T00:00:00Z' }), false)).toBe(true)
  })
})
