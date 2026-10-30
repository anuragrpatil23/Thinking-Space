// One of today's topics, told once: what is happening, who is involved, the
// numbers, from every article in it whatever outlet carried it. It reports;
// it does not judge the news or say what it means for anyone.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'
import type { FeedTopicKindBlock } from './feedTopicsContractBlock'

export interface FeedTopicCardInputBlock {
  /** Cache identity: the topic and its articles */
  topicId: string
  name: string
  kind: FeedTopicKindBlock
  articles: Array<{ title: string; text: string }>
}

/** Articles sent per topic, and characters of each one's text. */
export const FEED_TOPIC_CARD_MAX_ARTICLES_BLOCK = 12
export const FEED_TOPIC_CARD_TEXT_CHARS_BLOCK = 700

const SYSTEM_PROMPT = [
  'Several of today\'s news articles are about the same thing. You get the',
  'topic\'s name and each article\'s headline and main points.',
  '',
  'Write the key details in two or three plain sentences: what is happening,',
  'who is involved, and the numbers, names and dates that matter. When the',
  'articles add up to more than one development, say each briefly.',
  '',
  'Rules:',
  '  - Use only what the articles say. Do not fill gaps from general knowledge.',
  '  - Report, do not judge. No "this matters because", no predictions, no advice.',
  '  - Plain words. No preamble, no markdown, no bullets, no outlet names.',
].join('\n')

export function cleanFeedTopicCardBlock(raw: string): string | null {
  const text = raw.replace(/^\s*(key details|answer)\s*:\s*/i, '').replace(/\s+/g, ' ').trim()
  if (text.length < 20) return null
  return text.length > 600 ? `${text.slice(0, 597).replace(/\s+\S*$/, '')}…` : text
}

export const feedTopicCardContract = defineContractBlock<FeedTopicCardInputBlock, ReturnType<typeof s.string>, string>({
  id: 'feed-topic-card',
  // Bump whenever the prompt or the text sent changes, so cards are rebuilt.
  promptVersion: 1,
  outputSchema: s.string({ description: 'Two or three sentences of key details' }),
  cacheKey: (input: FeedTopicCardInputBlock) => `${input.topicId}|${input.articles.map(a => a.title.length + a.text.length).join(',')}`,
  buildRequest: (input: FeedTopicCardInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [
        `Topic: ${input.name}${input.kind === 'mood' ? ' (how the market is moving)' : ''}`,
        ...input.articles.map((a, i) => `${i + 1}. ${a.title}\n${a.text || '(headline only)'}`),
        'Key details:',
      ].join('\n\n'),
    }],
    temperature: 0.2,
  }),
  finalize: (raw: string): ContractOutput<string> | null => {
    const text = cleanFeedTopicCardBlock(raw)
    return text ? { value: text, meta: {} } : null
  },
})
