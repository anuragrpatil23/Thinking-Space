// What a reading sitting actually was, in a sentence.
//
// A reading session has no transcript, so the digest pipeline's fallback gave
// it `title: <document name>, summary: ''` — and a chain of five sittings with
// the same book open rendered as that book's name five times joined by "·",
// above five timestamps with nothing under them. All the information was
// already captured and none of it reached the page.
//
// None of this needs a model. Pages, dwells, stations and scroll depth are
// mechanically derived from what the viewer observed, which is exactly the
// split docs/contracts/DERIVATION.md asks for: a model call is for prose that
// has to be *interpreted*, and "you read pages 12-48, longest on 31" is not
// interpretation. It is also why reading sittings must never reach a provider:
// there is nothing there to summarize, and paying for one would be paying to
// have structured data described back.

import type { ThinkingspaceReadingWhere } from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

function humanMsBlock(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}

/** Contiguous runs collapse to ranges: "12-19, 31, 44-46" reads like a person
 *  describing what they got through, where a bare list does not. */
function formatPageRangesBlock(pages: number[]): string {
  if (pages.length === 0) return ''
  const sorted = [...pages].sort((a, b) => a - b)
  const runs: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i += 1) {
    const p = sorted[i]
    if (p === prev + 1) { prev = p; continue }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`)
    if (p === undefined) break
    start = p
    prev = p
  }
  return runs.join(', ')
}

/**
 * One line describing where the attention went. Returns '' when the surface
 * recorded nothing useful — an empty summary is honest, and better than a
 * sentence asserting a shape the data does not have.
 */
export function describeReadingWhereBlock(
  where: ThinkingspaceReadingWhere | undefined,
  activeMs: number,
): string {
  const spent = humanMsBlock(activeMs)
  if (!where) return `${spent} of measured attention.`

  if (where.kind === 'pdf') {
    const pages = where.pages.filter(p => p.activeMs > 0)
    if (pages.length === 0) return `${spent} of measured attention.`
    const ranges = formatPageRangesBlock(pages.map(p => p.page))
    const longest = pages.reduce((best, p) => (p.activeMs > best.activeMs ? p : best), pages[0])
    const noun = pages.length === 1 ? 'page' : 'pages'
    const parts = [`${spent} across ${pages.length} ${noun} — ${ranges}.`]
    // Only worth saying when one page genuinely dominated; otherwise it is
    // noise dressed up as a finding.
    if (pages.length > 1 && longest.activeMs >= activeMs * 0.3) {
      parts.push(`Longest on p.${longest.page} (${humanMsBlock(longest.activeMs)}).`)
    }
    if (where.maxPage > 0 && !pages.some(p => p.page === where.maxPage)) {
      parts.push(`Reached p.${where.maxPage}.`)
    }
    return parts.join(' ')
  }

  if (where.kind === 'canvas') {
    const stations = where.stations.filter(s => s.activeMs > 0)
    if (stations.length === 0) return `${spent} of measured attention.`
    const settled = stations.reduce((best, s) => (s.activeMs > best.activeMs ? s : best), stations[0])
    const share = activeMs > 0 ? Math.round((settled.activeMs / activeMs) * 100) : 0
    const noun = stations.length === 1 ? 'place' : 'places'
    const parts = [`${spent} across ${stations.length} ${noun} on the canvas.`]
    if (stations.length > 1 && share >= 40) {
      parts.push(`${share}% of it in one region (${humanMsBlock(settled.activeMs)}).`)
    }
    return parts.join(' ')
  }

  // Scroll: a document has an extent, so depth is the whole story. Reporting
  // where it *ended* only adds something when that differs from the deepest
  // point — otherwise it is the same number twice.
  const max = Math.round(where.max * 100)
  const end = where.end === undefined ? null : Math.round(where.end * 100)
  const parts = [`${spent}, reaching ${max}% of the document.`]
  if (end !== null && Math.abs(end - max) >= 5) parts.push(`Ended at ${end}%.`)
  return parts.join(' ')
}
