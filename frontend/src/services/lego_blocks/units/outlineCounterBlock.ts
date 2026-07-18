/* Heading outline counter format used by all Contents UIs.

   Convention is keyed off the heading's `#`-level (h1, h2, …), not its depth
   in the document tree, so the same heading level always renders with the
   same numeral system regardless of whether the doc skips levels.

     h1 → uppercase Roman (I, II, III)
     h2 → Arabic           (1, 2, 3)
     h3 → lowercase alpha  (a, b, c)
     h4 → lowercase Roman  (i, ii, iii)
     h5+ → Arabic fallback
*/

export function toRomanNumeralBlock(value: number): string {
  const pairs: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let remainder = Math.max(1, Math.floor(value))
  let out = ''
  for (const [n, sym] of pairs) {
    while (remainder >= n) {
      out += sym
      remainder -= n
    }
  }
  return out
}

export function toAlphabeticIndexBlock(value: number): string {
  let remainder = Math.max(1, Math.floor(value))
  let result = ''
  while (remainder > 0) {
    remainder -= 1
    result = String.fromCharCode(97 + (remainder % 26)) + result
    remainder = Math.floor(remainder / 26)
  }
  return result
}

export function formatOutlineCounterBlock(value: number, level: number): string {
  switch (level) {
    case 1:
      return toRomanNumeralBlock(value).toUpperCase()
    case 2:
      return String(value)
    case 3:
      return toAlphabeticIndexBlock(value)
    case 4:
      return toRomanNumeralBlock(value)
    default:
      return String(value)
  }
}

/* Assign an outline label to each heading in order, resetting child counters
   whenever a higher-level heading appears. Returns the label list aligned
   to the input headings. */
export function assignOutlineLabelsBlock(levels: number[]): string[] {
  const counters = [0, 0, 0, 0, 0, 0, 0]
  return levels.map((rawLevel) => {
    const level = Math.min(Math.max(rawLevel, 1), 6)
    counters[level] += 1
    for (let i = level + 1; i < counters.length; i += 1) counters[i] = 0
    return formatOutlineCounterBlock(counters[level], level)
  })
}

export interface SectionOutlineLabelsBlock {
  /** Index of the document-title heading (unnumbered), or null if none. */
  titleIndex: number | null
  /** Aligned to the input; '' at the title index. */
  labels: string[]
}

/* Title-aware variant: a document whose first heading is its only h1 uses
   that h1 as the file title, not a section — it gets no outline label and
   doesn't consume a counter. Docs with several h1s number all of them. */
export function assignSectionOutlineLabelsBlock(levels: number[]): SectionOutlineLabelsBlock {
  const soloLeadingH1 =
    levels.length > 0 && levels[0] === 1 && levels.filter((level) => level === 1).length === 1
  if (!soloLeadingH1) {
    return { titleIndex: null, labels: assignOutlineLabelsBlock(levels) }
  }
  return { titleIndex: 0, labels: ['', ...assignOutlineLabelsBlock(levels.slice(1))] }
}
