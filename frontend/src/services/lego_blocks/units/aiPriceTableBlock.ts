// Token counts -> a dollar figure, using the rate table in
// `src/data/aiModelPrices.json`. Rates are data; this file is only the lookup
// and the arithmetic.
//
// Two things to hold onto:
//
// 1. THE NUMBER IS A LIST-PRICE EQUIVALENT, NOT A BILL. It is what these tokens
//    would have cost at public API rates. Subscription plans meter against
//    usage limits instead, so nobody is charged this. Every surface that
//    renders it has to say so — see COST_BASIS_LABEL below.
//
// 2. AN UNKNOWN MODEL HAS NO PRICE. `priceForModel` returns null rather than
//    guessing, and `estimateCostUsd` returns null if any part of the bundle is
//    unpriced. There used to be a FALLBACK_PRICE and a catch-all /opus/ rule;
//    together they meant `claude-opus-5` — which matched neither the
//    current-Opus pattern nor anything else specific — silently landed on
//    retired Opus 3 rates and reported 3x the real cost, for two model
//    generations, with no error anywhere. docs/contracts/DERIVATION.md:61: a
//    derived layer must fail loudly, never return a plausible-looking lesser
//    result unmarked. "Unpriced" is a worse-looking answer and a truer one.

import priceTable from '@/data/aiModelPrices.json'
import type { SessionTokens } from '@/services/lego_blocks/units/aiActivityParserBlock'

export interface PricePerMillion {
  /** Fresh (uncached) input tokens. */
  input: number
  /** Output tokens. */
  output: number
  /** Cache-read input tokens (10% of fresh on Anthropic). */
  cacheRead: number
  /** Cache-creation, 5-minute TTL (1.25x input on Anthropic). */
  cacheCreation5m: number
  /** Cache-creation, 1-hour TTL (2.0x input on Anthropic). Equal to the 5m
   *  figure where the provider has no TTL split. */
  cacheCreation1h: number
}

export interface PriceEntry extends PricePerMillion {
  /** Human name for the tier, for provenance in the UI. */
  label: string
  /** ISO date these rates took effect. */
  effectiveFrom: string
  /** Where the numbers came from. */
  source: string
  /** True when inherited from a sibling model rather than published for this
   *  id — the figure is an approximation even by list-price standards. */
  assumed: boolean
}

interface RawRate {
  match: string
  reason?: string
  label: string
  effective_from: string
  source: string
  assumed?: boolean
  input: number
  output: number
  cacheRead: number
  cacheCreation5m: number
  cacheCreation1h: number
}

/** How to describe the figure wherever it is rendered. It is not a bill. */
export const COST_BASIS_LABEL = 'list-price equivalent'

/** Exact-id tiers, lower-cased for case-insensitive lookup. Built once. */
function indexExact(
  src: Record<string, Partial<RawRate> & PricePerMillion>,
  fallbackSource: string,
): ReadonlyMap<string, PriceEntry> {
  const out = new Map<string, PriceEntry>()
  for (const [id, r] of Object.entries(src)) {
    out.set(id.toLowerCase(), {
      label: r.label ?? id,
      effectiveFrom: r.effective_from ?? '',
      source: r.source ?? fallbackSource,
      assumed: r.assumed === true,
      input: r.input,
      output: r.output,
      cacheRead: r.cacheRead,
      cacheCreation5m: r.cacheCreation5m,
      cacheCreation1h: r.cacheCreation1h,
    })
  }
  return out
}

/** Tier 1 — hand-written, wins over everything, never touched by a refresh. */
const OVERRIDES = indexExact(
  priceTable.overrides as Record<string, Partial<RawRate> & PricePerMillion>,
  'hand-set override',
)

/** Tier 2 — generated from the price feed, keyed by exact model id.
 *
 *  The feed publishes rates, not effective dates, so `effectiveFrom` here is
 *  the date we last OBSERVED the rate, not the date it took effect. Those are
 *  different claims and the label says which one it is: for a historical
 *  session it answers "this is what the rate was when we last looked", which is
 *  the honest limit of what a feed snapshot can tell you. Hand-written tiers
 *  carry real effective-from dates. */
const EXACT = indexExact(
  Object.fromEntries(
    Object.entries(priceTable.exact as Record<string, PricePerMillion>).map(([id, r]) => [
      id,
      {
        ...r,
        label: id,
        effective_from: priceTable.refreshed_at,
        source: `${priceTable.exact_source} (observed ${priceTable.refreshed_at})`,
      },
    ]),
  ),
  priceTable.exact_source,
)

/** Tier 3 — order sensitive fallback; first match wins, so the JSON keeps
 *  specific patterns ahead of general ones. Compiled once at module load. */
const PATTERNS: ReadonlyArray<{ match: RegExp; entry: PriceEntry }> = (
  priceTable.patterns as ReadonlyArray<RawRate>
).map((r) => ({
  match: new RegExp(r.match, 'i'),
  entry: {
    label: r.label,
    effectiveFrom: r.effective_from,
    source: r.source,
    assumed: r.assumed === true,
    input: r.input,
    output: r.output,
    cacheRead: r.cacheRead,
    cacheCreation5m: r.cacheCreation5m,
    cacheCreation1h: r.cacheCreation1h,
  },
}))

/**
 * The rate entry for a model id, or null when we have no published price for
 * it. Null is a real answer — callers must render it as unpriced rather than
 * substituting a default.
 */
export function priceForModel(model: string | undefined): PriceEntry | null {
  if (!model) return null
  const key = model.toLowerCase()
  // Exact id beats any pattern. Patterns are how the original bug happened —
  // a regex that quietly stopped matching a new id and let it fall through to
  // the wrong tier — so anything the feed knows by name is resolved by name,
  // and regexes are left to do only what they are actually good at: catching
  // dated snapshots and ids released between refreshes.
  return OVERRIDES.get(key) ?? EXACT.get(key) ?? matchPattern(model)
}

function matchPattern(model: string): PriceEntry | null {
  for (const { match, entry } of PATTERNS) {
    if (match.test(model)) return entry
  }
  return null
}

/** Which tier answered — for provenance in the UI and for tests that need to
 *  assert an id is resolved exactly rather than by a lucky regex. */
export function priceTierForModel(model: string | undefined): 'override' | 'exact' | 'pattern' | null {
  if (!model) return null
  const key = model.toLowerCase()
  if (OVERRIDES.has(key)) return 'override'
  if (EXACT.has(key)) return 'exact'
  return matchPattern(model) ? 'pattern' : null
}

/** Whether we can price this model at all. Sugar for readability at call sites. */
export function isPriced(model: string | undefined): boolean {
  return priceForModel(model) !== null
}

/**
 * Convert token counts to a dollar figure at list rates, or null if the model
 * is unpriced. Formatters live in the UI.
 */
export function estimateCostUsd(tokens: SessionTokens, model: string | undefined): number | null {
  const p = priceForModel(model)
  if (!p) return null
  const cache1h = Math.min(tokens.cacheCreation1h ?? 0, tokens.cacheCreation)
  const cache5m = Math.max(0, tokens.cacheCreation - cache1h)
  return (
    (tokens.input * p.input +
      tokens.output * p.output +
      tokens.cacheRead * p.cacheRead +
      cache5m * p.cacheCreation5m +
      cache1h * p.cacheCreation1h) /
    1_000_000
  )
}

/**
 * Cost of one session, summed over the models that actually spent the tokens.
 *
 * This is the entry point every caller should use. `estimateCostUsd` prices one
 * bundle at one model, which is only correct when a session used exactly one —
 * and 72 of 226 real transcripts here use two or more. A coordinator on Opus
 * delegating to Haiku subagents priced entirely at Opus is wrong in the
 * expensive direction, silently.
 *
 * Falls back to the single-model path when a source doesn't report per-turn
 * models (vault-markdown chains), so nothing regresses to "unpriced" merely for
 * lacking the finer data.
 *
 * Returns null only when NOTHING could be priced. A partially-priced session
 * returns the priced subtotal plus the model ids that were missing, so a caller
 * can render "~\$12.30+" rather than a total that quietly omits contributors.
 */
export function estimateSessionCostUsd(session: {
  tokens?: SessionTokens
  tokensByModel?: Record<string, SessionTokens>
  model?: string
}): { usd: number; unpricedModels: string[] } | null {
  const byModel = session.tokensByModel
  if (!byModel || Object.keys(byModel).length === 0) {
    if (!session.tokens) return null
    const usd = estimateCostUsd(session.tokens, session.model)
    return usd === null ? null : { usd, unpricedModels: [] }
  }
  let usd = 0
  let priced = 0
  const unpricedModels: string[] = []
  for (const [model, tokens] of Object.entries(byModel)) {
    const cost = estimateCostUsd(tokens, model)
    if (cost === null) unpricedModels.push(model)
    else {
      usd += cost
      priced += 1
    }
  }
  return priced > 0 ? { usd, unpricedModels } : null
}

/**
 * Sum costs across a mixed-model list. Returns the total *and* how many
 * entries had no price, so a caller can render "~$12.30 (2 sessions unpriced)"
 * instead of quietly reporting a total that is missing rows. A total that
 * silently omits contributors is the same failure this module exists to avoid.
 */
export function sumCostUsd(
  list: ReadonlyArray<{ tokens?: SessionTokens; model?: string }>,
): { usd: number; priced: number; unpriced: number } {
  let usd = 0
  let priced = 0
  let unpriced = 0
  for (const item of list) {
    if (!item.tokens) continue
    const cost = estimateCostUsd(item.tokens, item.model)
    if (cost === null) unpriced += 1
    else {
      usd += cost
      priced += 1
    }
  }
  return { usd, priced, unpriced }
}

/** Sum a list of token bundles. Caller groups by model if they want per-model
 *  cost; we just add the counts. */
export function sumTokens(list: ReadonlyArray<SessionTokens | undefined>): SessionTokens {
  const out: SessionTokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    cacheCreation1h: 0,
  }
  for (const t of list) {
    if (!t) continue
    out.input += t.input
    out.output += t.output
    out.cacheRead += t.cacheRead
    out.cacheCreation += t.cacheCreation
    out.cacheCreation1h = (out.cacheCreation1h ?? 0) + (t.cacheCreation1h ?? 0)
  }
  return out
}

/** Compact "1.2M" / "850K" / "342" formatter. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

/** "$0.42" / "$12.30" / "<$0.01" formatter. Null renders as "unpriced" — the
 *  honest rendering of a model we have no rate for. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'unpriced'
  if (n < 0.01) return '<$0.01'
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toFixed(0)}`
}
