// Today's feed by what is happening, not by who published it: each article
// is put in a topic the model names, reusing today's topics where one fits.
// Two kinds: "mood" is the market's mood, articles about prices moving (a
// sell-off, a trillion lost from chip stocks), whatever company they name;
// "subject" is what is happening in a business, an industry, a country or a
// field (a new memory plant, UK politics, Nvidia and China). It sorts; it
// does not judge the news or say what it means for anyone.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

export type FeedTopicKindBlock = 'mood' | 'subject'

export interface FeedTopicsInputBlock {
  /** Cache identity: the batch's articles and the topics offered */
  batchId: string
  /** Today's topics so far, to reuse by name */
  topics: Array<{ name: string; kind: FeedTopicKindBlock }>
  /** Numbered from 1 */
  articles: Array<{ title: string; story: string; point: string }>
}

/** Each article's topic, by its number (a plain array, so a cached answer reads back the same). */
export type FeedTopicsOutputBlock = Array<{ n: number; kind: FeedTopicKindBlock; name: string }>

/** Articles sorted per request. */
export const FEED_TOPICS_BATCH_BLOCK = 40

const SYSTEM_PROMPT = [
  'You sort today\'s news articles by what is happening, so a reader can follow',
  'each thing across outlets. For each article you get its headline, a few',
  'words on the story, and its main point.',
  '',
  'Put every article in a topic. Two kinds of topic:',
  '  mood    — the market\'s mood: the article is about prices moving. A',
  '            stock selling off, an index falling, "chip stocks lose $1',
  '            trillion", a rally. It goes here even when it names a company',
  '            or an industry: a memory stock falling is mood, not memory.',
  '  subject — what is happening in a business, an industry, a country, a',
  '            technology or a field: a new memory plant, a chip export rule,',
  '            UK politics, an AI model release, a merger.',
  '',
  'Topic names: short and specific, a few words, e.g. "Memory supply build-out",',
  '"Nvidia and China", "UK politics", "Chip stocks sell off". Not outlet names,',
  'not "Technology" or "Business" or "Other". Several articles about the same',
  'thing share one topic. An article on its own may have a topic of its own.',
  'When one of today\'s topics listed fits, use its name exactly as written.',
  '',
  'Answer with one line per article, nothing else:',
  '<number> | <mood or subject> | <topic name>',
  'e.g. "3 | subject | Memory supply build-out"',
].join('\n')

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

/** The lines as numbered assignments; lines that do not parse are dropped. */
export function parseFeedTopicsBlock(raw: string, count: number): FeedTopicsOutputBlock {
  const out = new Map<number, { n: number; kind: FeedTopicKindBlock; name: string }>()
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*\**\s*(\d+)\s*[.)]?\s*\|\s*(mood|subject)\s*\|\s*(.+?)\s*\**\s*$/i)
    if (!m) continue
    const n = Number(m[1])
    const name = m[3].replace(/^["'“]|["'”]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (n >= 1 && n <= count && name.length >= 2) out.set(n, { n, kind: m[2].toLowerCase() as FeedTopicKindBlock, name })
  }
  return [...out.values()]
}

export const feedTopicsContract = defineContractBlock<FeedTopicsInputBlock, ReturnType<typeof s.string>, FeedTopicsOutputBlock>({
  id: 'feed-topics',
  // Bump whenever the prompt or the text sent changes.
  promptVersion: 1,
  outputSchema: s.string({ description: 'One line per article: "<number> | <mood or subject> | <topic name>"' }),
  cacheKey: (input: FeedTopicsInputBlock) => `${input.batchId}|${input.topics.map(t => t.name).join(',')}`,
  buildRequest: (input: FeedTopicsInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [
        input.topics.length > 0
          ? `Today's topics so far:\n${input.topics.map(t => `- ${t.name} (${t.kind})`).join('\n')}`
          : 'No topics yet today.',
        `Articles:\n${input.articles.map((a, i) => `${i + 1}. ${clip(a.title, 160)}\n   Story: ${clip(a.story || '—', 120)}\n   Point: ${clip(a.point || '—', 240)}`).join('\n')}`,
        'Answer:',
      ].join('\n\n'),
    }],
    temperature: 0.1,
  }),
  finalize: (raw: string, input: FeedTopicsInputBlock): ContractOutput<FeedTopicsOutputBlock> | null => {
    const out = parseFeedTopicsBlock(raw, input.articles.length)
    return out.length > 0 ? { value: out, meta: {} } : null
  },
})
