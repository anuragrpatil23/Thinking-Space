// Matching a paywalled feed item to the same article in the library (Gale),
// by headline, near its date. Ported from the vault's fetch-library-feeds.py
// (enrich), which proved the thresholds on real feeds.
//
// Which publications the library carries in full, checked in Gale OneFile
// (2026-10-02): NYT and the Washington Post (web editions, so headlines match),
// the Guardian, and WIRED (the monthly print issue: wide window, fewer
// matches). Not there in full: FT (citation only; print after 30 days), WSJ
// (citation only in Gale; full text is in Factiva), Bloomberg, Fortune, Forbes.

export interface LibrarySourceBlock {
  /** Shown in the status line */
  name: string
  /** Gale's publication name (PU) — must match the allowlist in main */
  publication: string
  /** Feed item links on these hosts belong to this publication */
  hosts: string[]
  db: 'STND' | 'ITOF'
  /** Days either side of the item's date to search */
  windowDays: number
}

export const LIBRARY_SOURCES_BLOCK: LibrarySourceBlock[] = [
  { name: 'NYT', publication: 'The New York Times (Digital Edition)', hosts: ['nytimes.com'], db: 'STND', windowDays: 1 },
  { name: 'Washington Post', publication: 'Washingtonpost.com', hosts: ['washingtonpost.com'], db: 'STND', windowDays: 1 },
  { name: 'WIRED', publication: 'WIRED', hosts: ['wired.com'], db: 'ITOF', windowDays: 45 },
]

/** Library articles shorter than this are a citation or a stub, not the article. */
export const LIBRARY_MIN_TEXT_CHARS_BLOCK = 400
/** A headline match below this is a different story. */
export const LIBRARY_MATCH_THRESHOLD_BLOCK = 0.8

const STOP_WORDS_BLOCK = new Set(`a an the and or but of to in on at for with from by as is are was were be been it its this that
these those how why what who when where will would can could should may might not no new says say after before over
into about than more most just your you our their his her they them we he she i`.split(/\s+/))

export function librarySourceForLinkBlock(link: string, sources = LIBRARY_SOURCES_BLOCK): LibrarySourceBlock | null {
  let host = ''
  try {
    host = new URL(link).hostname.toLowerCase()
  } catch {
    return null
  }
  return sources.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null
}

export function normTitleBlock(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// difflib's SequenceMatcher ratio, close enough for headlines: 2·LCS / (|a| + |b|) over characters
function sequenceRatioBlock(a: string, b: string): number {
  if (!a.length && !b.length) return 1
  const prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j]
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1])
      diag = up
    }
  }
  return (2 * prev[b.length]) / (a.length + b.length)
}

/** How alike two headlines are, 0..1: character overlap, or word overlap for headlines of four words or more. */
export function titleSimilarityBlock(a: string, b: string): number {
  const na = normTitleBlock(a)
  const nb = normTitleBlock(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = new Set(na.split(' '))
  const tb = new Set(nb.split(' '))
  const shared = [...ta].filter((w) => tb.has(w)).length
  const smaller = Math.min(ta.size, tb.size)
  const overlap = smaller >= 4 ? shared / Math.max(1, smaller) : 0
  return Math.max(sequenceRatioBlock(na, nb), overlap)
}

/** The longest distinctive words of a headline, for the search. */
export function queryWordsBlock(title: string, n = 4): string[] {
  const words = normTitleBlock(title).split(' ')
    .filter((w) => w.length >= 4 && !STOP_WORDS_BLOCK.has(w) && /^[a-z0-9]+$/.test(w))
  return [...new Set(words)].sort((x, y) => y.length - x.length).slice(0, n)
}

/** The best hit and its score, or null when nothing came back. */
export function bestLibraryHitBlock<T extends { title: string }>(title: string, hits: T[]): { hit: T; score: number } | null {
  let best: { hit: T; score: number } | null = null
  for (const hit of hits) {
    const score = titleSimilarityBlock(hit.title, title)
    if (!best || score > best.score) best = { hit, score }
  }
  return best
}
