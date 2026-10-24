// Where each company stands in a fetch pass (Value Line, earnings calls):
// waiting, being fetched, or what came of it. The pass keeps the list as it
// goes, so Feed → Sources can show the queue live, and saves it with the last
// pass, so what happened stays readable afterwards.

export type PassItemStateBlock =
  | 'waiting'
  | 'working'
  /** Something new was saved */
  | 'fetched'
  /** Asked; nothing newer than what is saved */
  | 'no-new'
  /** Not asked: what is saved is recent, or it was checked lately */
  | 'skipped'
  | 'not-covered'
  /** Failed once; tried again at the end of the pass */
  | 'retrying'
  | 'failed'

export interface PassItemBlock {
  /** The company (or, for articles, a unique key) */
  ticker: string
  /** Shown instead of the ticker: an article's source and headline */
  label?: string
  state: PassItemStateBlock
  /** "Sep 2026 report", "3 calls", or the error */
  detail?: string
}

export const PASS_ITEM_LABELS_BLOCK: Record<PassItemStateBlock, string> = {
  waiting: 'Waiting',
  working: 'Working…',
  fetched: 'Saved',
  'no-new': 'Nothing new',
  skipped: 'Up to date',
  'not-covered': 'Not covered',
  retrying: 'Will retry',
  failed: 'Failed',
}

/** The list with one company's entry replaced. */
export function setPassItemBlock(items: PassItemBlock[], ticker: string, state: PassItemStateBlock, detail?: string): PassItemBlock[] {
  return items.map(item => (item.ticker === ticker ? { ticker, ...(item.label ? { label: item.label } : {}), state, ...(detail ? { detail } : {}) } : item))
}

/** "2026-09-18" → "Sep 2026 report". */
export function issueDetailBlock(issueDate: string | undefined): string | undefined {
  if (!issueDate) return undefined
  const d = new Date(`${issueDate}T12:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : `${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} report`
}
