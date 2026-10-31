// The day's articles from sources outside the reading list, placed against
// what the reading list already has. They never start a topic of their own:
// each one cites one of the day's topics (the same story), adds to one of the
// day's themes (the same broad thing, a different story), or goes Elsewhere
// under a theme of its own. It places; it does not judge the news.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'
import type { RssOutsideKindBlock } from '../../rssTopicBlock'

export interface FeedOutsideMatchInputBlock {
  /** Cache identity: the articles and what they are placed against */
  batchId: string
  /** The day's topics, each with its theme */
  topics: Array<{ name: string; theme: string | null }>
  /** Theme names known from the theme list, for Elsewhere */
  knownThemes: string[]
  /** Numbered from 1 */
  articles: Array<{ title: string; point: string }>
}

export type FeedOutsideMatchOutputBlock = Array<{ n: number; kind: RssOutsideKindBlock; name: string }>

/** Articles placed per request. */
export const FEED_OUTSIDE_BATCH_BLOCK = 40

const SYSTEM_PROMPT = [
  'A reader follows some news sources; the AI also reads others. You get the',
  'day\'s topics from the reader\'s own sources, each with its theme, and',
  'articles from the other sources. Place each article:',
  '',
  '  topic     — it is the same story as one of the topics: use the topic\'s',
  '              name exactly as written',
  '  theme     — a different story, but it belongs to one of the topics\'',
  '              themes: use the theme\'s name exactly as written',
  '  elsewhere — it fits none of them: give it a theme of one to three words,',
  '              from the known themes when one fits ("Space", "Banks")',
  '  skip      — not news (an ad, a deal post, a how-to, a quiz)',
  '',
  'Answer with one line per article, nothing else:',
  '<number> | <topic, theme, elsewhere or skip> | <name>',
  'e.g. "3 | topic | Intel Q3 2026 earnings" or "7 | skip |"',
].join('\n')

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

export function parseFeedOutsideMatchBlock(raw: string, count: number): FeedOutsideMatchOutputBlock {
  const out = new Map<number, { n: number; kind: RssOutsideKindBlock; name: string }>()
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*\**\s*(\d+)\s*[.)]?\s*\|\s*(topic|theme|elsewhere|skip)\s*(?:\|\s*(.*?))?\s*\**\s*$/i)
    if (!m) continue
    const n = Number(m[1])
    const name = (m[3] ?? '').replace(/^["'“]|["'”]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (n >= 1 && n <= count) out.set(n, { n, kind: m[2].toLowerCase() as RssOutsideKindBlock, name })
  }
  return [...out.values()]
}

export const feedOutsideMatchContract = defineContractBlock<FeedOutsideMatchInputBlock, ReturnType<typeof s.string>, FeedOutsideMatchOutputBlock>({
  id: 'feed-outside-match',
  // Bump whenever the prompt or the text sent changes.
  promptVersion: 1,
  outputSchema: s.string({ description: 'One line per article: "<number> | <topic, theme, elsewhere or skip> | <name>"' }),
  cacheKey: (input: FeedOutsideMatchInputBlock) => `${input.batchId}|${input.topics.map(t => t.name).join(',')}`,
  buildRequest: (input: FeedOutsideMatchInputBlock) => {
    const byTheme = new Map<string, string[]>()
    for (const t of input.topics) byTheme.set(t.theme ?? 'No theme', [...(byTheme.get(t.theme ?? 'No theme') ?? []), t.name])
    return {
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user' as const,
        content: [
          `The reader's topics today, by theme:\n${[...byTheme.entries()].map(([theme, names]) => `${theme}:\n${names.map(n => `  - ${n}`).join('\n')}`).join('\n')}`,
          input.knownThemes.length > 0 ? `Known themes:\n${input.knownThemes.join(', ')}` : '',
          `Articles:\n${input.articles.map((a, i) => `${i + 1}. ${clip(a.title, 160)}\n   Point: ${clip(a.point || '—', 220)}`).join('\n')}`,
          'Answer:',
        ].filter(Boolean).join('\n\n'),
      }],
      temperature: 0.1,
    }
  },
  finalize: (raw: string, input: FeedOutsideMatchInputBlock): ContractOutput<FeedOutsideMatchOutputBlock> | null => {
    const out = parseFeedOutsideMatchBlock(raw, input.articles.length)
    return out.length > 0 ? { value: out, meta: {} } : null
  },
})
