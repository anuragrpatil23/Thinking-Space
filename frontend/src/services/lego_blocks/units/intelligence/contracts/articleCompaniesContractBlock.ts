// The companies a news article is about, with their stock tickers when they
// are listed: the main subject first. Asked only for articles the reader kept
// (tagged, or a question or comment on them), so the record knows whose story
// it is even when the feed it came from is not about one company.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

export interface ArticleCompaniesInputBlock {
  /** Cache identity */
  itemId: string
  title: string
  /** The AI's points, else the article text or teaser, plain, clipped */
  text: string
}

export interface ArticleCompanyBlock {
  name: string
  /** Exchange ticker, null for a private company or one not listed */
  ticker: string | null
}

export const ARTICLE_COMPANIES_TEXT_CHARS_BLOCK = 4000
const MAX_COMPANIES = 5

const SYSTEM_PROMPT = [
  'Name the companies this news article is about: the ones it reports on, not',
  'every company it mentions in passing. Main subject first, at most five.',
  '',
  'One per line, as "Name (TICKER)", using the stock ticker of its main US',
  'listing (or its home listing). Write "Name (private)" for a company that is',
  'not listed. If the article is not about any company, write "none".',
  '',
  'Use the company\'s usual name (Nvidia, not NVIDIA Corporation). No other text.',
].join('\n')

/** "Nvidia (NVDA)" lines into companies; [] for "none" or nothing usable. */
export function parseArticleCompaniesBlock(raw: string): ArticleCompanyBlock[] {
  const out: ArticleCompanyBlock[] = []
  const seen = new Set<string>()
  for (const line of raw.split('\n')) {
    const match = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().match(/^(.+?)\s*\(([^)]+)\)\s*$/)
    if (!match) continue
    const name = match[1].replace(/\*\*/g, '').trim()
    const inner = match[2].trim().replace(/^(NASDAQ|NYSE|AMEX|NYSEARCA|OTC)\s*:\s*/i, '').toUpperCase()
    const ticker = /^[A-Z][A-Z0-9.-]{0,9}$/.test(inner) && inner !== 'PRIVATE' ? inner : null
    const key = (ticker ?? name).toLowerCase()
    if (!name || name.length > 80 || seen.has(key)) continue
    seen.add(key)
    out.push({ name, ticker })
    if (out.length >= MAX_COMPANIES) break
  }
  return out
}

export const articleCompaniesContract = defineContractBlock<ArticleCompaniesInputBlock, ReturnType<typeof s.string>, ArticleCompanyBlock[]>({
  id: 'article-companies',
  // Bump whenever the prompt or the text sent changes, so answers are asked again.
  promptVersion: 1,
  outputSchema: s.string({ description: '"Name (TICKER)" lines, or "none"' }),
  cacheKey: (input: ArticleCompaniesInputBlock) => `${input.itemId}|${input.text.length}`,
  buildRequest: (input: ArticleCompaniesInputBlock) => ({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: [`Headline: ${input.title}`, '', input.text || '(headline only)', '', 'Companies:'].join('\n') }],
    temperature: 0,
  }),
  // An empty list is an answer too ("none"), so it is never asked again
  finalize: (raw: string): ContractOutput<ArticleCompanyBlock[]> | null => ({ value: parseArticleCompaniesBlock(raw), meta: {} }),
})
