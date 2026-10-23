// What a feed article says, in two or three plain sentences: the AI reading
// alongside the user. It reports the article; it does not judge it, rank it,
// or say what it means for anyone. Whatever more the summary should carry is
// decided after reading what this one produces on real articles.

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

/** Characters of article text sent; the opening carries the news. */
export const ARTICLE_SUMMARY_TEXT_CHARS_BLOCK = 6000

const SYSTEM_PROMPT = [
  'You summarise a news article for a reader skimming their feed.',
  '',
  'Write two or three plain sentences saying what the article reports: who did',
  'what, with the numbers and names that matter. Use only what the text says.',
  '',
  'Rules:',
  '  - Report, do not judge. No "this matters because", no predictions, no',
  '    advice, no opinion about investing.',
  '  - If the text is only a teaser, summarise just what it says, in one',
  '    sentence. Do not fill gaps from general knowledge.',
  '  - Plain words. No preamble, no "The article", no markdown, no bullets.',
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

/** The summary as the reader will see it, or null when the answer is unusable. */
export function cleanArticleSummaryBlock(raw: string): string | null {
  const text = raw
    .replace(/^\s*(summary|here is[^:]*):\s*/i, '')
    .replace(/^\s*(the article|this article)\s+(reports|says|describes)\s+(that\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length < 20) return null
  return text.length > 600 ? `${text.slice(0, 597).replace(/\s+\S*$/, '')}…` : text
}

export const articleSummaryContract = defineContractBlock({
  id: 'article-summary',
  // Bump whenever the prompt or the text sent changes, so summaries are rebuilt.
  promptVersion: 1,
  outputSchema: s.string({ description: 'Two or three plain sentences' }),
  cacheKey: (input: ArticleSummaryInputBlock) => `${input.itemId}|${input.text.length}`,
  buildRequest: (input: ArticleSummaryInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: [`Source: ${input.source}`, `Headline: ${input.title}`, '', input.text || '(no text, headline only)', '', 'Summary:'].join('\n'),
    }],
    temperature: 0.2,
  }),
  finalize: (raw: string): ContractOutput<string> | null => {
    const text = cleanArticleSummaryBlock(raw)
    return text ? { value: text, meta: {} } : null
  },
})
