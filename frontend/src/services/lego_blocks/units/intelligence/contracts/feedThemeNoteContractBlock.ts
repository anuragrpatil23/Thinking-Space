// A distillation per theme from the articles the AI read in sources outside
// the reading list: the points worth knowing that the reader's own articles did
// not give, read after them. As many points as the articles warrant, each with
// its outlets; only what the articles say; nothing the reader's topics covered.

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

/** Articles sent per distillation, and characters of each one's text. */
export const FEED_THEME_NOTE_MAX_ARTICLES_BLOCK = 15
export const FEED_THEME_NOTE_TEXT_CHARS_BLOCK = 500

const SYSTEM_PROMPT = [
  'A reader has read their own articles on one theme. You get the theme, the',
  'topics they already read, and articles on the theme from other sources.',
  '',
  'Distill what these articles add: the facts, numbers, names and',
  'developments worth knowing that the reader\'s own topics did not give. Not',
  'a summary of each article: merge what several say into one point, drop',
  'what does not matter.',
  '',
  'Write one point a line, each starting "- ", as many as there are things',
  'worth knowing (often two to five; one is fine). End each point with its',
  'outlets in brackets, e.g. "[Bloomberg, FT]".',
  '',
  'Rules:',
  '  - Use only what the articles say. No predictions, no advice, no judging.',
  '  - No preamble, no headings, no closing line.',
  '  - If the articles add nothing beyond the reader\'s own topics, answer NONE.',
].join('\n')

/**
 * The points, one a line as "- point [outlets]", or null for NONE or an answer
 * too short to use. A paragraph without dashes (an older answer, or a model
 * that ignored the format) is kept as one point.
 */
export function cleanFeedThemeNoteBlock(raw: string): string | null {
  const body = raw.replace(/^\s*(distillation|points|answer)\s*:\s*/i, '').trim()
  if (/^none\.?$/i.test(body) || body.length < 30) return null
  const lines = body.split(/\n+/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()).filter(l => l.length > 0)
  const points = lines.length > 0 ? lines : [body.replace(/\s+/g, ' ')]
  return points.slice(0, 8).map(p => `- ${p.length > 400 ? `${p.slice(0, 397).replace(/\s+\S*$/, '')}…` : p}`).join('\n')
}

export const feedThemeNoteContract = defineContractBlock<FeedThemeNoteInputBlock, ReturnType<typeof s.string>, string | null>({
  id: 'feed-theme-note',
  // Bump whenever the prompt or the text sent changes.
  promptVersion: 2,
  outputSchema: s.string({ description: 'One point a line, each "- point [outlets]", or NONE' }),
  cacheKey: (input: FeedThemeNoteInputBlock) => input.noteId,
  buildRequest: (input: FeedThemeNoteInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [
        `Theme: ${input.theme}`,
        input.ownTopics.length > 0 ? `Already read:\n${input.ownTopics.map(t => `- ${t}`).join('\n')}` : 'Already read: nothing on this theme.',
        `Other sources:\n${input.articles.map((a, i) => `${i + 1}. ${a.source}: ${a.title}\n   ${a.text}`).join('\n')}`,
        'Points:',
      ].join('\n\n'),
    }],
    temperature: 0.2,
  }),
  // A NONE is a real answer: the theme has nothing more today. Kept as '' so it is cached and not asked again.
  finalize: (raw: string): ContractOutput<string | null> | null => ({ value: cleanFeedThemeNoteBlock(raw) ?? '', meta: {} }),
})
