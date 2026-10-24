// A company's price bands: <executionRoot>/<TICKER>/bands.yaml, drawn by hand
// (kai-workspace/F9/f9-band-drawing-guide.md): the ranges price has dwelt in,
// settled or still forming. The price chart shades them; nothing here
// predicts or scores.
//
//   ticker: AAPL
//   last_updated: 2026-06-10
//   bands:
//     - { id: R1, lo: 246, hi: 260, state: settled, duration_note: "4w spring band" }

import yaml from 'js-yaml'

export interface PriceBandBlock {
  id: string
  lo: number
  hi: number
  state: 'settled' | 'forming'
  note: string | null
}

export interface PriceBandsBlock {
  /** YYYY-MM-DD, when the bands were last drawn */
  lastUpdated: string | null
  bands: PriceBandBlock[]
}

/** The bands in a bands.yaml; null when it is missing or not readable. */
export function parsePriceBandsBlock(text: string | null): PriceBandsBlock | null {
  if (!text) return null
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch {
    return null
  }
  const record = doc as { last_updated?: unknown; bands?: unknown } | null
  if (!record || !Array.isArray(record.bands)) return null
  const bands = record.bands.flatMap((raw, index): PriceBandBlock[] => {
    const b = raw as { id?: unknown; lo?: unknown; hi?: unknown; state?: unknown; duration_note?: unknown }
    const lo = Number(b?.lo)
    const hi = Number(b?.hi)
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return []
    return [{
      id: typeof b.id === 'string' && b.id.trim() ? b.id.trim() : `B${index + 1}`,
      lo,
      hi,
      state: b.state === 'forming' ? 'forming' : 'settled',
      note: typeof b.duration_note === 'string' ? b.duration_note : null,
    }]
  })
  const updated = record.last_updated instanceof Date ? record.last_updated.toISOString().slice(0, 10) : typeof record.last_updated === 'string' ? record.last_updated : null
  return { lastUpdated: updated, bands }
}
