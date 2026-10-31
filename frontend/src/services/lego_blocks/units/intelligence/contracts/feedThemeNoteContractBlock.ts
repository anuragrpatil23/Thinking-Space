// One paragraph per theme from the articles the AI read in sources outside the
// reading list: what else happened in this theme, read after the reader's own
// articles. It names the outlets, says only what the articles say, and does
// not repeat what the reader's own topics already cover.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

export interface FeedThemeNoteInputBlock {
  /** Cache identity: the theme and its articles */
  noteId: string
  theme: string
  /** The reader's own topics in this theme, not to be repeated */
  ownTopics: string[]
  articles: Array<{ source: string; title: string; text: string }>
}

/** Articles sent per paragraph, and characters of each one's text. */
export const FEED_THEME_NOTE_MAX_ARTICLES_BLOCK = 15
export const FEED_THEME_NOTE_TEXT_CHARS_BLOCK = 500

const SYSTEM_PROMPT = [
  'A reader has read their own articles on one theme. You get the theme, the',
  'topics they already read, and articles on the theme from other sources.',
  '',
  'Write one paragraph, two to four plain sentences: what else happened in',
  'this theme according to these articles. Name the outlet for each point',
  '("Bloomberg reports …"). When several outlets carry one of the reader\'s',
  'own topics, you may say so in a few words, but do not retell it.',
  '',
  'Rules:',
  '  - Use only what the articles say. No predictions, no advice, no judging.',
  '  - No preamble, no markdown, no bullets.',
  '  - If the articles add nothing beyond the reader\'s own topics, answer NONE.',
].join('\n')

/** The paragraph, or null for NONE or an answer too short to use. */
export function cleanFeedThemeNoteBlock(raw: string): string | null {
  const text = raw.replace(/^\s*(paragraph|answer)\s*:\s*/i, '').replace(/\s+/g, ' ').trim()
  if (/^none\.?$/i.test(text) || text.length < 30) return null
  return text.length > 900 ? `${text.slice(0, 897).replace(/\s+\S*$/, '')}…` : text
}

export const feedThemeNoteContract = defineContractBlock<FeedThemeNoteInputBlock, ReturnType<typeof s.string>, string | null>({
  id: 'feed-theme-note',
  // Bump whenever the prompt or the text sent changes.
  promptVersion: 1,
  outputSchema: s.string({ description: 'One paragraph, or NONE' }),
  cacheKey: (input: FeedThemeNoteInputBlock) => input.noteId,
  buildRequest: (input: FeedThemeNoteInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [
        `Theme: ${input.theme}`,
        input.ownTopics.length > 0 ? `Already read:\n${input.ownTopics.map(t => `- ${t}`).join('\n')}` : 'Already read: nothing on this theme.',
        `Other sources:\n${input.articles.map((a, i) => `${i + 1}. ${a.source}: ${a.title}\n   ${a.text}`).join('\n')}`,
        'Paragraph:',
      ].join('\n\n'),
    }],
    temperature: 0.2,
  }),
  // A NONE is a real answer: the theme has nothing more today. Kept as '' so it is cached and not asked again.
  finalize: (raw: string): ContractOutput<string | null> | null => ({ value: cleanFeedThemeNoteBlock(raw) ?? '', meta: {} }),
})
