// One story as several outlets tell it: what they all report, and where they
// part (a number one gives and another does not, an angle only one pushes).
// Like the article summary, it reports; it does not judge the story or say
// what it means for anyone. Seeing what the crowd is told is the point, so
// the differences between outlets are kept, not smoothed over.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

export interface StoryCardSourceBlock {
  publisher: string
  title: string
  /** The AI's summary of that outlet's article, else the feed's teaser */
  text: string
}

export interface StoryCardInputBlock {
  /** Cache identity: the story's articles */
  storyId: string
  sources: StoryCardSourceBlock[]
}

export interface StoryCardOutputBlock {
  /** Two or three sentences: what the outlets report */
  common: string
  /** Where they differ, in a sentence or two; null when they tell it the same way */
  differ: string | null
}

/** Outlets sent per story, and characters of each one's text. */
export const STORY_CARD_MAX_SOURCES_BLOCK = 10
export const STORY_CARD_SOURCE_CHARS_BLOCK = 1200

const SYSTEM_PROMPT = [
  'Several news outlets are reporting the same story. You are given each',
  "outlet's headline and a short summary of its article.",
  '',
  'Answer in exactly two lines:',
  'Reported: two or three plain sentences on what the outlets report together:',
  '  who did what, with the numbers and names that matter.',
  'Differs: where the outlets part: a fact or number only some give, a',
  '  different emphasis or angle, a claim one makes that others do not. Name',
  '  the outlets. If they tell it the same way, write "Differs: none".',
  '',
  'Rules:',
  '  - Use only what the summaries say. Do not fill gaps from general knowledge.',
  '  - Report, do not judge. No "this matters because", no predictions, no advice.',
  '  - Plain words. No preamble, no markdown, no bullets.',
].join('\n')

function lineAfterBlock(raw: string, label: string): string | null {
  const match = raw.match(new RegExp(`(?:^|\\n)\\s*\\**${label}\\**\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\**(?:reported|differs)\\**\\s*:|$)`, 'i'))
  const text = match?.[1].replace(/\s+/g, ' ').trim() ?? ''
  return text || null
}

/** The card as shown, or null when the answer is unusable. */
export function parseStoryCardBlock(raw: string): StoryCardOutputBlock | null {
  const common = lineAfterBlock(raw, 'reported')
  if (!common || common.length < 20) return null
  const differ = lineAfterBlock(raw, 'differs')
  return {
    common: common.length > 700 ? `${common.slice(0, 697).replace(/\s+\S*$/, '')}…` : common,
    differ: !differ || /^(none|n\/a|no differences?)\.?$/i.test(differ) ? null : differ.slice(0, 500),
  }
}

export const storyCardContract = defineContractBlock<StoryCardInputBlock, ReturnType<typeof s.string>, StoryCardOutputBlock>({
  id: 'story-card',
  // Bump whenever the prompt or the text sent changes, so cards are rebuilt.
  promptVersion: 1,
  outputSchema: s.string({ description: 'Two lines: "Reported: …" and "Differs: …"' }),
  cacheKey: (input: StoryCardInputBlock) => `${input.storyId}|${input.sources.map(x => `${x.publisher}:${x.text.length}`).join(',')}`,
  buildRequest: (input: StoryCardInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [
        ...input.sources.map((x, i) => `${i + 1}. ${x.publisher}\nHeadline: ${x.title}\n${x.text || '(headline only)'}`),
        '',
        'Answer:',
      ].join('\n\n'),
    }],
    temperature: 0.2,
  }),
  finalize: (raw: string): ContractOutput<StoryCardOutputBlock> | null => {
    const card = parseStoryCardBlock(raw)
    return card ? { value: card, meta: {} } : null
  },
})
