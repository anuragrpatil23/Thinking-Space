// Anurag's confidence grid, compacted into one token.
//
// The old organizer's real vocabulary is a 2×2 grid over a claim — `for sure` |
// `maybe` × `for price` | `for value`, plus `bucket 1`/`bucket 2` and `worked`
// (defined in F9-KT-E-244). Rendered as three loose pills it wastes width and
// hides the fact that it *is* a grid. This pulls the grid facets out of a tag
// list and compacts them to a single label (`sure · price+value · b1`), leaving
// every non-grid tag untouched for the caller to render as an ordinary pill.
//
// It scans whatever list it's given because the grid tags are, today, misfiled
// into `proposed_tags` alongside Kai's placeholders (e.g. Microsoft carries
// `for sure for value` there) — so recognition has to be by vocabulary, not by
// which frontmatter field the tag happens to sit in.

export interface ConfidenceParse {
  /** Compact grid label, or null when the list carries no grid vocabulary. */
  label: string | null
  /** The exact original strings consumed into the label — so the caller can
   *  drop them from the ordinary-pill list without re-deriving the match. */
  consumed: Set<string>
}

export function parseConfidenceTagsBlock(tags: string[]): ConfidenceParse {
  const confidences = new Set<string>()
  const axes = new Set<string>()
  let bucket: string | null = null
  let worked = false
  const consumed = new Set<string>()

  for (const raw of tags) {
    const t = raw.toLowerCase().trim()

    const b = t.match(/^bucket\s*(\d)/)
    if (b) {
      bucket = `b${b[1]}`
      consumed.add(raw)
      continue
    }
    if (t === 'worked') {
      worked = true
      consumed.add(raw)
      continue
    }
    // `for sure for price`, `maybe for value`, or the bare `for price`.
    const m = t.match(/^(for sure|maybe)?\s*(?:for\s+)?(price|value)$/)
    if (m && (m[1] || m[2])) {
      if (m[1] === 'for sure') confidences.add('sure')
      else if (m[1] === 'maybe') confidences.add('maybe')
      if (m[2]) axes.add(m[2])
      consumed.add(raw)
      continue
    }
  }

  const parts: string[] = []
  // Order: price before value, so `price+value` reads consistently.
  if (confidences.size) parts.push([...confidences].join('/'))
  if (axes.size) parts.push(['price', 'value'].filter(a => axes.has(a)).join('+'))
  if (bucket) parts.push(bucket)
  if (worked) parts.push('worked')

  return { label: parts.length ? parts.join(' · ') : null, consumed }
}
