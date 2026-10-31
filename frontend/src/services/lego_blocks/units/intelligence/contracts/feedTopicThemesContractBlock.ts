// A day's topics, gathered under broader themes. Topics are story-sized ("Intel
// Q3 earnings", "Intel Fab 28 explosion"); a theme is what several of them are
// part of ("Intel"): a company, an industry, a kind of news, a country, a field.
// Topics stay as they are; this only says which theme each belongs to, reusing
// the day's themes so far by name. Market-mood topics (prices moving) are
// grouped by what moved — the whole market, a sector, a company — not by what
// the news was about. It groups; it does not judge the news.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'
import type { FeedTopicKindBlock } from './feedTopicsContractBlock'

export interface FeedTopicThemesInputBlock {
  /** Cache identity: the topics asked about and the themes offered */
  batchId: string
  /** The day's themes so far, to reuse by name */
  themes: string[]
  /** Numbered from 1 */
  topics: Array<{ name: string; articles: number; kind: FeedTopicKindBlock }>
}

/** Each topic's theme, by its number. */
export type FeedTopicThemesOutputBlock = Array<{ n: number; theme: string }>

/** Topics placed per request. */
export const FEED_TOPIC_THEMES_BATCH_BLOCK = 80

/** The theme for topics that fit none; shown last. */
export const FEED_OTHER_THEME_BLOCK = 'Other news'

const SYSTEM_PROMPT = [
  'You get the day\'s news topics, each a single story with how many articles',
  'it has. Gather them under broader themes so a reader can see the day at a',
  'glance and open a theme for its stories.',
  '',
  'A theme is what several topics are part of:',
  '  - a company: "Intel", "Nvidia", "Apple"',
  '  - an industry or technology: "Memory chips", "AI models", "Electric cars"',
  '  - a kind of news: "Q3 earnings", "Crypto crime", "Data breaches"',
  '  - a country or a field: "UK politics", "Space", "Health"',
  '',
  'Rules:',
  '  - One to three words. Not "Technology", "Business" or "News".',
  '  - Prefer a theme that holds several topics: three Intel stories go under',
  '    "Intel", three companies\' results under "Q3 earnings".',
  '  - A topic about one company\'s news goes under that company when the',
  '    company has other topics today; otherwise under its industry or kind.',
  `  - A topic that fits no theme with others goes under "${FEED_OTHER_THEME_BLOCK}".`,
  '  - When one of the day\'s themes listed fits, use its name exactly as written.',
  '',
  'Topics marked [market] are prices moving. Group those by what moved, not by',
  'what the news was about:',
  '  - "Whole market": an index falling or rallying, a valuation warning, a',
  '    broad sell-off',
  '  - a sector or group: "Chips", "AI infrastructure", "Banks": several',
  '    companies of a kind moving, or one of them when the others moved too',
  '  - a company, only when it has several [market] topics of its own',
  'A [market] topic never shares a theme with a topic that is not [market].',
  '',
  'Answer with one line per topic, nothing else:',
  '<number> | <theme>',
  'e.g. "3 | Intel"',
].join('\n')

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

/** The lines as numbered themes; lines that do not parse are dropped. */
export function parseFeedTopicThemesBlock(raw: string, count: number): FeedTopicThemesOutputBlock {
  const out = new Map<number, { n: number; theme: string }>()
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*\**\s*(\d+)\s*[.)]?\s*\|\s*(.+?)\s*\**\s*$/)
    if (!m) continue
    const n = Number(m[1])
    const theme = m[2].replace(/^["'“]|["'”]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (n >= 1 && n <= count && theme.length >= 2) out.set(n, { n, theme })
  }
  return [...out.values()]
}

export const feedTopicThemesContract = defineContractBlock<FeedTopicThemesInputBlock, ReturnType<typeof s.string>, FeedTopicThemesOutputBlock>({
  id: 'feed-topic-themes',
  // Bump whenever the prompt or the text sent changes: every topic is then
  // placed again. Not bumped for the [market] rules (2026-10-31): they only
  // add to what mood topics, never placed before, are asked; the subject
  // themes already placed stay as they are.
  promptVersion: 1,
  outputSchema: s.string({ description: 'One line per topic: "<number> | <theme>"' }),
  cacheKey: (input: FeedTopicThemesInputBlock) => `${input.batchId}|${input.themes.join(',')}`,
  buildRequest: (input: FeedTopicThemesInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [
        input.themes.length > 0
          ? `The day's themes so far:\n${input.themes.map(t => `- ${t}`).join('\n')}`
          : 'No themes yet today.',
        `Topics:\n${input.topics.map((t, i) => `${i + 1}. ${t.kind === 'mood' ? '[market] ' : ''}${clip(t.name, 80)} (${t.articles} ${t.articles === 1 ? 'article' : 'articles'})`).join('\n')}`,
        'Answer:',
      ].join('\n\n'),
    }],
    temperature: 0.1,
  }),
  finalize: (raw: string, input: FeedTopicThemesInputBlock): ContractOutput<FeedTopicThemesOutputBlock> | null => {
    const out = parseFeedTopicThemesBlock(raw, input.topics.length)
    return out.length > 0 ? { value: out, meta: {} } : null
  },
})
