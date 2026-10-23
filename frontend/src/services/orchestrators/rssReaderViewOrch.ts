// The reader view for a feed article: fetch its page (main's guarded
// net:fetchText — public hosts only), find the article, and keep the text in
// the article's cached file (`textInCache`, as the library does). From then on
// the article opens as clean text everywhere, counts as readable, and the AI
// summarises the whole of it. Desktop only; a page that will not give up its
// article just opens as the page.

import { isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import { extractArticleTextBlock } from '@/services/lego_blocks/units/articleExtractBlock'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { setRssItemFullTextOrch } from '@/services/orchestrators/rssFeedOrch'

const FETCH_TIMEOUT_MS = 10_000

// Articles whose page had no usable article this session, so they are not asked twice
const unavailable = new Set<string>()

export function readerViewAvailableOrch(item: RssFeedItemBlock): boolean {
  return isElectron() && Boolean(window.electronAPI?.fetchText) && /^https?:\/\//.test(item.link) && !unavailable.has(item.id)
}

/** The article with its text in place, or null when the page has none to give. */
export async function loadReaderViewOrch(item: RssFeedItemBlock): Promise<RssFeedItemBlock | null> {
  if (!readerViewAvailableOrch(item)) return null
  try {
    const page = await Promise.race([
      window.electronAPI!.fetchText!(item.link),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), FETCH_TIMEOUT_MS)),
    ])
    if (page.status < 200 || page.status >= 300) throw new Error(`HTTP ${page.status}`)
    const text = await extractArticleTextBlock(page.body, item.link)
    if (!text) throw new Error('no article')
    await setRssItemFullTextOrch(item.id, text)
    return { ...item, description: text, textInCache: true }
  } catch {
    unavailable.add(item.id)
    return null
  }
}
