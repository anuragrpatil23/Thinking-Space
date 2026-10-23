// What a feed article says, distilled: every point that matters, as short
// lines, as many as the article carries (a teaser gets one, a rich piece eight).
// The AI reading alongside the user. It reports the article; it does not
// judge it, rank it, or say what it means for anyone.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

export interface ArticleSummaryInputBlock {
  /** Cache identity: the article and how much of it there was */
  itemId: string
  title: string
  source: string
  /** The article text (or the feed's teaser), plain text, clipped */
  text: string
}

/** Characters of article text sent: enough for a long feature. */
export const ARTICLE_SUMMARY_TEXT_CHARS_BLOCK = 14000

/** At most this many points are kept. */
const MAX_POINTS = 10

const SYSTEM_PROMPT = [
  'You distil a news article for a reader who wants everything that matters',
  'in it without reading all of it.',
  '',
  'Write the key points, one per line, each starting with "- ". Each point is',
  'one plain sentence: who did what, with the numbers, names, dates and claims',
  'that matter. Include what people quoted actually say (the claim, not the',
  'quote). Cover the whole article, not only its opening.',
  '',
  'How many points: as many as the article carries. A teaser or a short news',
  'item gets one or two; a rich article gets up to eight. Never pad.',
  '',
  'Rules:',
  '  - Use only what the text says. Do not fill gaps from general knowledge.',
  '  - Report, do not judge. No "this matters because", no predictions, no',
  '    advice, no opinion about investing.',
  '  - Skip ads, sign-up prompts and navigation text that got into the article.',
  '  - Plain words. No preamble, no "The article", no headings, no bold.',
  '',
  'Then, on a last line of its own, the story in a few words, so the same news',
  'from other outlets can be found: "Story: <who>; <what happened>", e.g.',
  '"Story: Meta; shares fall after third-quarter earnings". Name the company,',
  'person or place by its usual name.',
].join('\n')

export function plainArticleTextBlock(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/h\d>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

export interface ArticleSummaryOutputBlock {
  text: string
  /** "Who; what happened"; null when the model gave none */
  storyKey: string | null
}

/** The "Story: …" line, taken off the end of the answer. */
export function splitStoryKeyBlock(raw: string): { body: string; storyKey: string | null } {
  const match = raw.match(/\n?\s*\**story\**\s*:\s*(.+?)\s*$/i)
  if (!match || match.index === undefined) return { body: raw, storyKey: null }
  const storyKey = match[1].replace(/^["'“]|["'”]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return { body: raw.slice(0, match.index), storyKey: storyKey.length >= 3 ? storyKey : null }
}

/** The points as the reader will see them, one per line, or null when the answer is unusable. */
export function cleanArticleSummaryBlock(raw: string): string | null {
  const lines = raw
    .replace(/^\s*(summary|key points|here (is|are)[^:\n]*):\s*/i, '')
    .split('\n')
    .map(line => line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/^(the article|this article)\s+(reports|says|describes)\s+(that\s+)?/i, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(line => line.length > 0)
  const points = lines.slice(0, MAX_POINTS).map(line => (line.length > 400 ? `${line.slice(0, 397).replace(/\s+\S*$/, '')}…` : line))
  if (points.join(' ').length < 20) return null
  return points.join('\n')
}

/** The points of a summary (older summaries are one paragraph: one point). */
export function articleSummaryPointsBlock(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

export const articleSummaryContract = defineContractBlock<ArticleSummaryInputBlock, ReturnType<typeof s.string>, ArticleSummaryOutputBlock>({
  id: 'article-summary',
  // Bump whenever the prompt or the text sent changes, so summaries are rebuilt.
  promptVersion: 3,
  outputSchema: s.string({ description: 'Key points, one per line starting "- ", then a "Story: <who>; <what happened>" line' }),
  cacheKey: (input: ArticleSummaryInputBlock) => `${input.itemId}|${input.text.length}`,
  buildRequest: (input: ArticleSummaryInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [`Source: ${input.source}`, `Headline: ${input.title}`, '', input.text || '(no text, headline only)', '', 'Key points:'].join('\n'),
    }],
    temperature: 0.2,
  }),
  finalize: (raw: string): ContractOutput<ArticleSummaryOutputBlock> | null => {
    const { body, storyKey } = splitStoryKeyBlock(raw)
    const text = cleanArticleSummaryBlock(body)
    return text ? { value: { text, storyKey }, meta: {} } : null
  },
})
