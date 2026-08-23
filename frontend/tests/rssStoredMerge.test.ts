import { describe, expect, it } from 'vitest'
import { mergeStoredRssItemsBlock, type RssFeedItemBlock } from '../src/services/lego_blocks/units/rssFeedBlock'

function item(patch: Partial<RssFeedItemBlock> = {}): RssFeedItemBlock {
  return {
    id: 'feed-1::abc', feedId: 'feed-1', title: 'T', link: 'https://e.com/a',
    description: '', pubDate: '2026-08-10T09:00:00Z', imageUrl: null,
    read: false, viewedAt: null, dismissedAt: null,
    tags: [], keep: false, important: false, ...patch,
  }
}

describe('mergeStoredRssItemsBlock', () => {
  it('keeps the article read when only the stale conflict copy says unread', () => {
    const original = item({ read: true, dismissedAt: '2026-08-23T16:23:42.406Z' })
    const conflict = item({ read: false, dismissedAt: null })
    expect(mergeStoredRssItemsBlock(original, conflict).read).toBe(true)
    expect(mergeStoredRssItemsBlock(conflict, original).read).toBe(true)
  })

  it('is order independent — the batch that resolves first must not decide', () => {
    const a = item({ read: true, viewedAt: '2026-08-23T10:00:00Z' })
    const b = item({ read: false })
    const ab = mergeStoredRssItemsBlock(a, b)
    const ba = mergeStoredRssItemsBlock(b, a)
    expect(ab.read).toBe(ba.read)
    expect(ab.viewedAt).toBe(ba.viewedAt)
    expect(ab.dismissedAt).toBe(ba.dismissedAt)
  })

  it('recovers a dismissal that only one copy recorded', () => {
    const merged = mergeStoredRssItemsBlock(item(), item({ dismissedAt: '2026-08-23T16:14:40.252Z' }))
    expect(merged.dismissedAt).toBe('2026-08-23T16:14:40.252Z')
    expect(merged.read).toBe(true)
  })

  it('never loses a deliberate mark', () => {
    const merged = mergeStoredRssItemsBlock(
      item({ keep: true, tags: ['research more'] }),
      item({ important: true, tags: ['new company'] }),
    )
    expect(merged.keep).toBe(true)
    expect(merged.important).toBe(true)
    expect(merged.tags.sort()).toEqual(['new company', 'research more'])
  })

  it('prefers the copy that actually carries content', () => {
    const merged = mergeStoredRssItemsBlock(
      item({ description: 'short', imageUrl: null }),
      item({ description: 'a much longer stored body', imageUrl: 'https://e.com/i.png' }),
    )
    expect(merged.description).toBe('a much longer stored body')
    expect(merged.imageUrl).toBe('https://e.com/i.png')
  })
})
