// Choose what a reading sitting shows the model.
//
// The point is colour, not coverage. A digest has to say what the sitting was
// *about*; it does not have to reproduce the reading. So the excerpt is a
// sample, budgeted, and weighted by where the attention actually went — the
// eleven minutes on page 14 earn most of the budget, the eight seconds spent
// passing page 20 earn none.
//
// That weighting is the whole reason this can work at all. Summarising a book
// needs the book; summarising a *sitting* needs only the parts that held
// someone, and the span already knows which those were.
//
// Pure: selection and budgeting only. Pulling the actual text out of a PDF or
// an Excalidraw scene is I/O and lives in readingExcerptOrch.

/** Total characters sent for one sitting. Small on purpose — this buys a
 *  sentence of colour, and a larger excerpt mostly buys a longer prompt. */
export const READING_EXCERPT_BUDGET_CHARS = 2_400

/** No single location may take more than this share of the budget, however
 *  dominant it was. One page must not crowd out the shape of the sitting. */
const MAX_SHARE_PER_LOCATION = 0.5

/** Below this, a location was passed through rather than read, and its text is
 *  noise that would invite the model to invent a theme. */
export const MIN_LOCATION_DWELL_MS = 20_000

/** A sitting with less genuine dwell than this has nothing worth summarising —
 *  flipping through forty pages at two seconds each is not reading, and a model
 *  handed that will confabulate confidently. Below it, the mechanical sentence
 *  stands alone and no call is made. */
export const MIN_SITTING_DWELL_MS = 90_000

export interface ReadingExcerptLocationBlock {
  /** How this location is named to the model — "p.14", "region 3". */
  label: string
  /** Attention credited here, ms. Drives both selection and budget share. */
  activeMs: number
  /** Text available at this location. May be far longer than its share. */
  text: string
}

export interface ReadingExcerptBlock {
  /** The prompt-ready excerpt, or '' when there was nothing worth sending. */
  text: string
  /** Locations that contributed, for the freshness hash and for debugging. */
  used: string[]
}

/** Trim to a length without cutting mid-word, and mark that it was cut. A
 *  clean break matters more than the last few characters: a fragment ending
 *  mid-word reads as corruption and invites the model to guess at it. */
function clipBlock(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Build the excerpt.
 *
 * Locations below the dwell floor are dropped outright. The rest split the
 * budget in proportion to attention, capped so no one of them dominates, and
 * each is labelled so the model can say *where* something came from rather
 * than blending the sitting into one anonymous paragraph.
 */
export function buildReadingExcerptBlock(
  locations: ReadingExcerptLocationBlock[],
  budgetChars: number = READING_EXCERPT_BUDGET_CHARS,
): ReadingExcerptBlock {
  const eligible = locations
    .filter(l => l.activeMs >= MIN_LOCATION_DWELL_MS && l.text.trim().length > 0)
    .sort((a, b) => b.activeMs - a.activeMs)
  if (eligible.length === 0) return { text: '', used: [] }

  const totalMs = eligible.reduce((sum, l) => sum + l.activeMs, 0)
  const parts: string[] = []
  const used: string[] = []
  let spent = 0

  for (const location of eligible) {
    const remaining = budgetChars - spent
    if (remaining < 120) break
    const share = totalMs > 0 ? location.activeMs / totalMs : 1 / eligible.length
    const allowance = Math.min(
      remaining,
      Math.max(160, Math.floor(budgetChars * Math.min(share, MAX_SHARE_PER_LOCATION))),
    )
    const clipped = clipBlock(location.text, allowance)
    if (!clipped) continue
    parts.push(`[${location.label}] ${clipped}`)
    used.push(location.label)
    spent += clipped.length + location.label.length + 4
  }

  return { text: parts.join('\n\n'), used }
}

/** Whether a sitting has enough genuine dwell to be worth a model call at all. */
export function isReadingWorthSummarisingBlock(
  locations: ReadingExcerptLocationBlock[],
  activeMs: number,
): boolean {
  if (activeMs < MIN_SITTING_DWELL_MS) return false
  return locations.some(l => l.activeMs >= MIN_LOCATION_DWELL_MS && l.text.trim().length > 0)
}
