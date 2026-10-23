import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { pruneRssArticleIndexBlock, readRssArticleIndexBlock, writeRssArticleIndexBlock } from '@/services/lego_blocks/integrations/rssArticleIndexBlock'

const item = (id: string, read = false): RssFeedItemBlock => ({
  id, feedId: 'f', title: id, link: `https://example.com/${id}`, description: '', pubDate: null, imageUrl: null,
  read, viewedAt: null, dismissedAt: null, tags: [], keep: false, important: false,
})

describe('the feed article index', () => {
  it('serves an article only while its file is unchanged', async () => {
    await writeRssArticleIndexBlock([
      { key: 'v|a.md', feedKey: 'v|f', mtimeMs: 100, size: 10, item: item('a') },
      { key: 'v|b.md', feedKey: 'v|f', mtimeMs: 100, size: 10, item: item('b') },
    ])
    const got = await readRssArticleIndexBlock([
      { key: 'v|a.md', mtimeMs: 100, size: 10 },
      // b was marked read on the phone: its file changed, so it is read again
      { key: 'v|b.md', mtimeMs: 250, size: 12 },
      { key: 'v|c.md', mtimeMs: 100, size: 10 },
    ])
    expect([...got.keys()]).toEqual(['v|a.md'])
  })

  it('drops the records of files that are gone', async () => {
    await writeRssArticleIndexBlock([{ key: 'v|gone.md', feedKey: 'v|g', mtimeMs: 1, size: 1, item: item('gone') }])
    await pruneRssArticleIndexBlock('v|g', new Set())
    expect((await readRssArticleIndexBlock([{ key: 'v|gone.md', mtimeMs: 1, size: 1 }])).size).toBe(0)
  })
})
