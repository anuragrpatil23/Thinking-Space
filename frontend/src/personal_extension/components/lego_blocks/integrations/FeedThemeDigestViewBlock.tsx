import { useMemo } from 'react'
import { Layers, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RssThemeDigestEntryBlock } from '@/components/lego_blocks/integrations/RssFeedPanelBlock'
import { rssOutletNameBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { rssItemReadableBlock, type RssFeedItemBlock, type RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'

/** One distilled point, its outlets split off the "[A, B]" it ends with. */
function pointPartsBlock(line: string): { text: string; outlets: string | null } {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(line)
  return m ? { text: m[1], outlets: m[2] } : { text: line, outlets: null }
}

/**
 * A theme's digest from the sources outside the reading list, opened beside
 * the list like an article: the points they add, which of the reader's topics
 * they also carried, and every article behind it, each one opening in the
 * reader.
 */
export function FeedThemeDigestViewBlock({ entry, feeds, onOpenItem, onClose }: {
  entry: RssThemeDigestEntryBlock
  feeds: RssFeedResultBlock[]
  onOpenItem: (item: RssFeedItemBlock) => void
  onClose: () => void
}) {
  const { digest, theme } = entry
  const points = (digest.note ?? '').split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean).map(pointPartsBlock)
  // The articles behind it, newest first, from whichever feed holds each
  const articles = useMemo(() => {
    const byId = new Map<string, { item: RssFeedItemBlock; source: string }>()
    for (const feed of feeds) for (const item of feed.items) if (!byId.has(item.id)) byId.set(item.id, { item, source: feed.feedTitle })
    return digest.itemIds.map(id => byId.get(id)).filter((x): x is { item: RssFeedItemBlock; source: string } => Boolean(x))
      .sort((a, b) => Date.parse(b.item.pubDate ?? '') - Date.parse(a.item.pubDate ?? ''))
  }, [feeds, digest.itemIds])
  const section = 'text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b-[0.5px] border-[#EFEFF2] px-5 py-4 dark:border-zinc-800">
        <Layers className="mt-1 h-4 w-4 shrink-0 text-violet-500 dark:text-violet-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug">{theme}</h2>
          <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
            {digest.itemIds.length} {digest.itemIds.length === 1 ? 'article' : 'articles'} from {digest.sources.length} {digest.sources.length === 1 ? 'outlet' : 'outlets'} the AI read beyond your reading list
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 text-[13.5px] leading-relaxed">
        {points.length > 0 && (
          <section>
            <p className={section}>What they add</p>
            <ul className="mt-2 space-y-2.5">
              {points.map((p, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/80" aria-hidden />
                  <span className="min-w-0">
                    <span className="text-zinc-800 dark:text-zinc-100">{p.text}</span>
                    {p.outlets && <span className="ml-1.5 whitespace-nowrap text-[12px] text-zinc-500 dark:text-zinc-400">{p.outlets}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {digest.cited.length > 0 && (
          <section>
            <p className={section}>Your topics, also carried by</p>
            <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
              {digest.cited.map(c => (
                <li key={c.topic} className="flex items-baseline gap-3 py-1.5">
                  <span className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-100">{c.topic}</span>
                  <span className="shrink-0 text-right text-[12px] text-zinc-500 dark:text-zinc-400">{c.sources.map(rssOutletNameBlock).join(', ')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {articles.length > 0 && (
          <section>
            <p className={section}>The articles · {articles.length}</p>
            <ul className="mt-1.5">
              {articles.map(({ item, source }) => {
                const headline = !rssItemReadableBlock(item)
                const point = item.aiSummary?.text.split('\n').find(Boolean)?.replace(/^-\s*/, '')
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => onOpenItem(item)} className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                      <span className="block font-medium leading-snug text-zinc-900 dark:text-zinc-100">{item.title || '(Untitled)'}</span>
                      {point && !headline && <span className="mt-0.5 block text-[12px] leading-snug text-zinc-600 line-clamp-2 dark:text-zinc-300">{point}</span>}
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span className="truncate">{rssOutletNameBlock(source)}</span>
                        {item.pubDate && <span>· {new Date(item.pubDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
                        {headline && <span className={cn('rounded px-1 py-px text-[9.5px] font-medium uppercase tracking-wide', 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400')}>Headline only</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
