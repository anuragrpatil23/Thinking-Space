// Dollars for a transcript's per-model token usage, at list rates.

import { estimateCostUsd } from '@/services/lego_blocks/units/aiPriceTableBlock'
import type { TranscriptUsageBlock } from '@/services/lego_blocks/units/parseTranscriptEventsBlock'

/** Priced subtotal over every model that spent tokens, plus the token total.
 *  Unpriced models add tokens but not dollars, and say so. */
export function usageCostBlock(usage: TranscriptUsageBlock | undefined): {
  usd: number | null
  tokens: number
  partial: boolean
} {
  let usd: number | null = null
  let tokens = 0
  let partial = false
  for (const [model, t] of Object.entries(usage ?? {})) {
    tokens += t.input + t.output + t.cacheRead + t.cacheCreation
    const c = estimateCostUsd(t, model)
    if (c === null) partial = true
    else usd = (usd ?? 0) + c
  }
  return { usd, tokens, partial }
}
