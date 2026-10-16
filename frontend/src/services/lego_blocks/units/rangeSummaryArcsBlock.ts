// Read the themes ("arcs") out of a range summary body.
//
// The range-summary contract (`rangeSummaryContractBlock`) asks the model for a
// strict numbered list:
//
//   1. **<theme>** — <M sessions> on <dates>, **~Xh Ym**. <what happened…>
//
// followed by tail bullets (bug count, features shipped, "**Also worked on:**").
// The This Week rows show the theme titles collapsed and lay the rest out
// themselves, rather than rendering the model's markdown as-is — its
// continuation indent was leaking through as a ragged first line.
//
// Anything that does not parse (the rules-based fallback body, a model that
// drifted off-format) yields no arcs, and callers fall back to session titles.

export interface RangeSummaryArcBlock {
  title: string
  /** The model's own session/date/duration line, markdown stripped. */
  meta: string
  /** What the arc was about. May contain inline markdown (`code`, **bold**). */
  body: string
}

export interface RangeSummaryArcsBlock {
  arcs: RangeSummaryArcBlock[]
  /** Tail bullets — bug counts, shipped features, "Also worked on". Markdown stripped of the bold lead only. */
  extras: string[]
}

const ITEM_START = /^\s*\d+\.\s+/
const ARC = /^\*\*(.+?)\*\*\s*[—–]\s*([\s\S]*)$/
// Meta runs up to and including the bold duration (`**~1h 55m**`), then an optional period.
const META = /^(.*?\*\*~?[^*]*\d[^*]*\*\*)\.?\s*([\s\S]*)$/
const ALSO = /^also worked on:?$/i

function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1')
}

export function parseRangeSummaryArcsBlock(text: string): RangeSummaryArcsBlock {
  const items: string[] = []
  for (const line of text.split('\n')) {
    if (ITEM_START.test(line)) items.push(line.replace(ITEM_START, ''))
    else if (items.length > 0 && line.trim()) items[items.length - 1] += ` ${line.trim()}`
  }

  const arcs: RangeSummaryArcBlock[] = []
  const extras: string[] = []
  for (const raw of items) {
    const item = raw.replace(/\s+/g, ' ').trim()
    const arc = ARC.exec(item)
    if (!arc || ALSO.test(arc[1].trim())) {
      if (item) extras.push(stripBold(item))
      continue
    }
    const rest = arc[2].trim()
    const meta = META.exec(rest)
    arcs.push({
      title: arc[1].trim(),
      meta: meta ? stripBold(meta[1]).trim() : '',
      body: meta ? meta[2].trim() : rest,
    })
  }
  return { arcs, extras }
}
