/**
 * How much of the plan's session and weekly limits one session used.
 *
 * Both providers only ever report an *account-wide* percentage — "the week is
 * at 57%" — as a whole number. Nothing says who spent it. This block turns a
 * stream of those readings into a ledger of "this session moved the meter by
 * this much", and it does so by MEASURING rather than estimating:
 *
 *   - The meter moved between two readings. If exactly one session spent
 *     anything in that interval, the movement is that session's. No rate, no
 *     model table, nothing to calibrate — and on real logs that is ~99% of
 *     intervals.
 *   - If several sessions spent in the interval, the movement is split between
 *     them by spend, weighted per model. That is the only place a rate appears,
 *     and those sessions are marked `approx`.
 *
 * A single dollars-per-percent rate was the first design and it is wrong: the
 * same dollar moved the 5-hour meter ~40% further on one Opus generation than
 * the next, measured on the author's own log. Rates here are therefore fitted
 * per model, from the single-spender intervals of the very data being split,
 * and used for nothing but dividing an overlap.
 *
 * Rounding does not accumulate. Summing a session's movements telescopes to
 * (last reading − first), so the error is under one point per limit window the
 * session touches, however many samples lie between.
 *
 * What this cannot see: spend that never reaches these logs — a chat on
 * claude.ai, a machine whose capture is not mirrored into the vault. Movement
 * with no local spender is filed as unattributed (`sid: null`) rather than
 * handed to whoever happened to report it; absence is not evidence.
 *
 * Pure: no I/O, no clock. Sources are parsed into `LimitSampleBlock` by the
 * functions at the bottom; everything else works on that one shape.
 */

export type LimitWindowKindBlock = 'session' | 'weekly'

/** One reading of the account-wide meters, taken while `sid` was running. */
export interface LimitSampleBlock {
  /** Epoch seconds. */
  t: number
  /** Base session id (no window suffix), lowercase. */
  sid: string
  /** Short-window used %, or null when the source had none to report. */
  session: number | null
  sessionResetsAt: number | null
  /** Long-window used %. */
  weekly: number | null
  weeklyResetsAt: number | null
  /**
   * The session's own cumulative spend at this moment, in whatever unit the
   * provider offers — list-price dollars for Claude, tokens for Codex. Only
   * ever compared within one provider, so the unit never has to agree.
   */
  spend: number | null
  model: string | null
}

export interface LimitLedgerEntryBlock {
  /** Epoch seconds of the reading that revealed the movement. */
  t: number
  /** The session it belongs to, or null when no local session spent. */
  sid: string | null
  kind: LimitWindowKindBlock
  /** Percentage points. Fractional only when an overlap was split. */
  pct: number
  /** True when this share came from dividing an overlap. */
  split: boolean
}

export interface LimitLedgerBlock {
  entries: LimitLedgerEntryBlock[]
  /** sid → times (epoch seconds, ascending) it reported a real meter value. */
  readingTimes: Map<string, number[]>
}

export interface SessionLimitShareBlock {
  /** Points of the short window. Exceeds 100 when a sitting spans several. */
  sessionPct: number
  /** Points of the weekly window. */
  weeklyPct: number
  /** True when any part was split from an overlap rather than measured. */
  approx: boolean
}

const WINDOW_SECONDS_BLOCK: Record<LimitWindowKindBlock, number> = {
  session: 5 * 60 * 60,
  weekly: 7 * 24 * 60 * 60,
}

/**
 * Two reset times this close are the same window. A real new window resets at
 * least a full window later, so ten minutes cannot merge two of them, and it
 * absorbs sources that derive the reset from "seconds remaining".
 */
const SAME_WINDOW_TOLERANCE_S_BLOCK = 10 * 60

/** A per-model rate needs this much observed movement before it is trusted. */
const MIN_RATE_EVIDENCE_PCT_BLOCK = 5

/**
 * Longest gap between two of a session's samples that is still read as steady
 * spending. The status line samples a working session at least every five
 * minutes, so a longer silence means it sat idle and the spend came at the end
 * — spreading it evenly across the gap would hand slivers of every other
 * session's movement to one that was not running.
 */
const STEADY_SPEND_GAP_S_BLOCK = 30 * 60

interface SpendPointBlock {
  t: number
  cum: number
}

interface SessionCurveBlock {
  sid: string
  points: SpendPointBlock[]
  /** Time of a first sample that arrived already carrying spend. */
  unknownStartAt: number | null
  models: Array<{ t: number; model: string }>
  firstT: number
  lastT: number
}

/**
 * Cumulative spend per session, made monotonic.
 *
 * A resumed session restarts its counter, so a drop is read as a restart and
 * the new figure is added on rather than subtracted.
 */
function buildCurvesBlock(samples: LimitSampleBlock[]): SessionCurveBlock[] {
  const bySid = new Map<string, SessionCurveBlock & { lastRaw: number }>()
  for (const s of samples) {
    let curve = bySid.get(s.sid)
    if (!curve) {
      curve = {
        sid: s.sid,
        points: [],
        unknownStartAt: null,
        models: [],
        firstT: s.t,
        lastT: s.t,
        lastRaw: 0,
      }
      bySid.set(s.sid, curve)
    }
    curve.lastT = s.t
    if (s.model) {
      const last = curve.models[curve.models.length - 1]
      if (!last || last.model !== s.model) curve.models.push({ t: s.t, model: s.model })
    }
    if (s.spend == null || !Number.isFinite(s.spend) || s.spend < 0) continue
    if (curve.points.length === 0) {
      // Spend that predates our first look at the session: we know how much,
      // not when. It lands in whichever interval contains this sample, and that
      // interval is kept out of rate fitting.
      if (s.spend > 0) curve.unknownStartAt = s.t
      curve.points.push({ t: s.t, cum: s.spend })
    } else {
      const prev = curve.points[curve.points.length - 1]
      const step = s.spend >= curve.lastRaw ? s.spend - curve.lastRaw : s.spend
      curve.points.push({ t: s.t, cum: prev.cum + step })
    }
    curve.lastRaw = s.spend
  }
  return Array.from(bySid.values()).sort((a, b) => a.firstT - b.firstT)
}

/**
 * Spend so far at `t`: zero before the first sample, linear between samples
 * that are close together, and a step at the later sample when they are not.
 */
function cumAtBlock(curve: SessionCurveBlock, t: number): number {
  const pts = curve.points
  if (pts.length === 0 || t < pts[0].t) return 0
  let lo = 0
  let hi = pts.length - 1
  if (t >= pts[hi].t) return pts[hi].cum
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  if (b.t - a.t > STEADY_SPEND_GAP_S_BLOCK) return a.cum
  return a.cum + ((b.cum - a.cum) * (t - a.t)) / (b.t - a.t)
}

function modelAtBlock(curve: SessionCurveBlock, t: number): string | null {
  let model: string | null = curve.models[0]?.model ?? null
  for (const m of curve.models) {
    if (m.t > t) break
    model = m.model
  }
  return model
}

interface IntervalBlock {
  t: number
  kind: LimitWindowKindBlock
  delta: number
  /** True when the reading opened a window we had not seen before. */
  fresh: boolean
  spenders: Array<{ sid: string; spend: number; model: string | null; uncertain: boolean }>
}

interface WindowInstanceBlock {
  resetsAt: number | null
  hwm: number
}

/**
 * Walk one meter's readings in time order and emit, for each, how far the
 * meter moved and which sessions spent while it did.
 */
function intervalsForKindBlock(
  samples: LimitSampleBlock[],
  curves: SessionCurveBlock[],
  kind: LimitWindowKindBlock,
): IntervalBlock[] {
  const out: IntervalBlock[] = []
  // Recently seen windows, newest last. A list rather than a single "previous"
  // because readings from two accounts can interleave in one timeline, and each
  // alternation would otherwise look like a brand-new window opening at its
  // full value.
  const instances: WindowInstanceBlock[] = []
  let prevT: number | null = null

  let nextCurve = 0
  let active: SessionCurveBlock[] = []

  for (const s of samples) {
    const value = kind === 'session' ? s.session : s.weekly
    if (value == null || !Number.isFinite(value)) continue
    const resetsAt = kind === 'session' ? s.sessionResetsAt : s.weeklyResetsAt

    if (prevT == null) {
      // The first reading has nothing before it to measure against.
      prevT = s.t
      instances.push({ resetsAt, hwm: value })
      continue
    }

    let instance = instances.find((w) =>
      resetsAt != null && w.resetsAt != null
        ? Math.abs(w.resetsAt - resetsAt) <= SAME_WINDOW_TOLERANCE_S_BLOCK
        : // No reset time to compare (a status line without jq): treat a clear
          // drop as a rollover and anything else as the same window.
          w === instances[instances.length - 1] && value >= w.hwm - 5,
    )

    let delta = 0
    let lower = prevT
    let fresh = false
    if (instance) {
      // High-water mark, so a meter that dips a point and recovers is not
      // counted twice.
      delta = Math.max(0, value - instance.hwm)
      instance.hwm = Math.max(instance.hwm, value)
    } else {
      fresh = true
      const startedAt = resetsAt != null ? resetsAt - WINDOW_SECONDS_BLOCK[kind] : null
      // One account's windows never overlap: the next opens only after the
      // last has reset. So a new window that began after every window we know
      // of had ended is a rollover, it started from zero, and its first value
      // is all movement. One that overlaps a window we were already tracking
      // is something else — a second account's meter, or a window that was
      // running before the log began — with a past we never saw, and it
      // contributes nothing until it moves again. Reset times are rounded by
      // the provider, hence the hour of slack; an empty window constrains
      // nothing, since movement from zero is new whoever's it is.
      const overlapsKnown =
        startedAt != null &&
        instances.some((w) => w.hwm > 0 && w.resetsAt != null && w.resetsAt > startedAt + 3600)
      if (!overlapsKnown) {
        delta = Math.max(0, value)
        // Clamped to now: a reset time that implies a start in the future
        // (a window of some other length) must not push the bound past the
        // reading itself.
        if (startedAt != null) lower = Math.min(s.t, Math.max(prevT, startedAt))
      }
      instance = { resetsAt, hwm: value }
      instances.push(instance)
      if (instances.length > 64) instances.shift()
    }

    while (nextCurve < curves.length && curves[nextCurve].firstT <= s.t) {
      active.push(curves[nextCurve])
      nextCurve += 1
    }
    active = active.filter((c) => c.lastT >= lower)

    const spenders: IntervalBlock['spenders'] = []
    for (const curve of active) {
      const spend = cumAtBlock(curve, s.t) - cumAtBlock(curve, lower)
      if (!(spend > 0)) continue
      spenders.push({
        sid: curve.sid,
        spend,
        model: modelAtBlock(curve, s.t),
        uncertain:
          curve.unknownStartAt != null && curve.unknownStartAt > lower && curve.unknownStartAt <= s.t,
      })
    }

    out.push({ t: s.t, kind, delta, fresh, spenders })
    prevT = s.t
  }
  return out
}

type RateTableBlock = Map<string, number>

const rateKeyBlock = (kind: LimitWindowKindBlock, model: string | null): string =>
  `${kind}|${model ?? ''}`

/** All models pooled — the fallback for one too new to have its own rate. */
const POOLED_MODEL_BLOCK = '*'

const rateForBlock = (
  rates: RateTableBlock,
  kind: LimitWindowKindBlock,
  model: string | null,
): number | undefined =>
  rates.get(rateKeyBlock(kind, model)) ?? rates.get(rateKeyBlock(kind, POOLED_MODEL_BLOCK))

/**
 * Points of meter per unit of spend, per model, from intervals where only one
 * session spent. Intervals with no movement count too — leaving them out would
 * fit the rate only to the moments the integer happened to tick over.
 */
function fitRatesBlock(intervals: IntervalBlock[], prior?: RateTableBlock): RateTableBlock {
  const sums = new Map<string, { pct: number; spend: number }>()
  for (const interval of intervals) {
    if (interval.fresh || interval.spenders.length !== 1) continue
    const [only] = interval.spenders
    if (only.uncertain) continue
    // Second pass: leave out intervals the first fit says were mostly someone
    // else's usage, so one overnight jump cannot inflate the rate it is then
    // judged against.
    const expected = prior ? rateForBlock(prior, interval.kind, only.model) : undefined
    if (expected !== undefined && isOutsideUsageBlock(interval.delta, only.spend * expected)) continue
    for (const model of [only.model, POOLED_MODEL_BLOCK]) {
      const key = rateKeyBlock(interval.kind, model)
      const sum = sums.get(key) ?? { pct: 0, spend: 0 }
      sum.pct += interval.delta
      sum.spend += only.spend
      sums.set(key, sum)
    }
  }
  const rates: RateTableBlock = new Map()
  for (const [key, sum] of sums) {
    if (sum.pct >= MIN_RATE_EVIDENCE_PCT_BLOCK && sum.spend > 0) rates.set(key, sum.pct / sum.spend)
  }
  return rates
}

/**
 * Whether a movement is far more than the local spend accounts for. Generous
 * on purpose — three times the expectation plus two points of rounding — so
 * ordinary variation in how a model meters never trips it.
 */
function isOutsideUsageBlock(delta: number, expectedPct: number): boolean {
  return delta > expectedPct * 3 + 2
}

/**
 * Build the ledger from every reading we have for ONE provider.
 *
 * Feed it one provider at a time: the meters are per account, and two
 * providers' readings in one timeline would be measured against each other.
 */
export function buildLimitLedgerBlock(input: LimitSampleBlock[]): LimitLedgerBlock {
  const samples = [...input].sort((a, b) => a.t - b.t)
  const curves = buildCurvesBlock(samples)

  const readingTimes = new Map<string, number[]>()
  for (const s of samples) {
    if (s.session == null && s.weekly == null) continue
    const times = readingTimes.get(s.sid)
    if (times) times.push(s.t)
    else readingTimes.set(s.sid, [s.t])
  }

  const intervals = [
    ...intervalsForKindBlock(samples, curves, 'session'),
    ...intervalsForKindBlock(samples, curves, 'weekly'),
  ]
  const rates = fitRatesBlock(intervals, fitRatesBlock(intervals))

  const entries: LimitLedgerEntryBlock[] = []
  for (const interval of intervals) {
    if (!(interval.delta > 0)) continue
    const { t, kind, spenders } = interval

    if (spenders.length === 0) {
      entries.push({ t, sid: null, kind, pct: interval.delta, split: false })
      continue
    }

    const spenderRates = spenders.map((s) => rateForBlock(rates, kind, s.model))
    const allRated = spenderRates.every((r) => r !== undefined)
    // Mixing rated and unrated spenders would compare points against raw spend,
    // so one missing rate drops the whole interval back to plain spend.
    const weights = spenders.map((s, i) => (allRated ? s.spend * (spenderRates[i] as number) : s.spend))
    const total = weights.reduce((a, b) => a + b, 0)

    // Movement far beyond what the local spend explains came from somewhere
    // these logs cannot see. Only judged when every spender has a rate —
    // otherwise there is no expectation to exceed. A spender whose start is
    // unknown still counts: its spend here is at most what we assumed, so the
    // expectation is an upper bound and the test only gets more lenient.
    let attributable = interval.delta
    if (allRated && isOutsideUsageBlock(interval.delta, total)) {
      attributable = total
      entries.push({ t, sid: null, kind, pct: interval.delta - total, split: false })
    }

    const split = spenders.length > 1 || attributable !== interval.delta
    spenders.forEach((s, i) => {
      const pct = total > 0 ? (attributable * weights[i]) / total : 0
      if (pct > 0) entries.push({ t, sid: s.sid, kind, pct, split })
    })
  }

  entries.sort((a, b) => a.t - b.t)
  return { entries, readingTimes }
}

/** A sitting to look up: its full id, the session it belongs to, when it began. */
export interface LimitShareWindowBlock {
  id: string
  baseSid: string
  startMs: number
}

/**
 * Per-sitting shares.
 *
 * One transcript can be several sittings (an idle gap splits it), all reporting
 * under the same session id, so a movement goes to the sitting that was running
 * when it was read — the last one to start at or before it.
 *
 * A sitting with no reading of its own is left OUT of the result rather than
 * given zeros: a session from before the capture existed did not use 0% of the
 * week, we simply never measured it.
 */
export function buildSessionShareIndexBlock(
  ledger: LimitLedgerBlock,
  windows: LimitShareWindowBlock[],
): Map<string, SessionLimitShareBlock> {
  const bySid = new Map<string, LimitShareWindowBlock[]>()
  for (const w of windows) {
    const list = bySid.get(w.baseSid)
    if (list) list.push(w)
    else bySid.set(w.baseSid, [w])
  }
  for (const list of bySid.values()) list.sort((a, b) => a.startMs - b.startMs)

  const windowAt = (sid: string, t: number): LimitShareWindowBlock | null => {
    const list = bySid.get(sid)
    if (!list) return null
    let found = list[0]
    for (const w of list) {
      if (w.startMs <= t * 1000) found = w
      else break
    }
    return found
  }

  const out = new Map<string, SessionLimitShareBlock>()
  for (const [sid, times] of ledger.readingTimes) {
    for (const t of times) {
      const w = windowAt(sid, t)
      if (w && !out.has(w.id)) out.set(w.id, { sessionPct: 0, weeklyPct: 0, approx: false })
    }
  }
  for (const entry of ledger.entries) {
    if (entry.sid == null) continue
    const w = windowAt(entry.sid, entry.t)
    if (!w) continue
    const share = out.get(w.id) ?? { sessionPct: 0, weeklyPct: 0, approx: false }
    if (entry.kind === 'session') share.sessionPct += entry.pct
    else share.weeklyPct += entry.pct
    if (entry.split) share.approx = true
    out.set(w.id, share)
  }
  return out
}

/** Sum of the shares that exist; null when none of them were measured. */
export function sumLimitSharesBlock(
  shares: Array<SessionLimitShareBlock | undefined>,
): SessionLimitShareBlock | null {
  let total: SessionLimitShareBlock | null = null
  for (const share of shares) {
    if (!share) continue
    total ??= { sessionPct: 0, weeklyPct: 0, approx: false }
    total.sessionPct += share.sessionPct
    total.weeklyPct += share.weeklyPct
    total.approx ||= share.approx
  }
  return total
}

function pctLabelBlock(pct: number): string {
  // The meter is whole points, so anything under half of one is "less than a
  // point", not zero — the session did run.
  return pct < 0.5 ? '<1%' : `${Math.round(pct)}%`
}

/**
 * The two phrases a row shows.
 *
 * The short window is phrased as "a session window" rather than as a share of
 * *the* limit because a long sitting crosses several of them: 150 points is one
 * and a half windows, not an impossible 150%.
 */
export function formatLimitShareBlock(share: SessionLimitShareBlock): {
  session: string
  weekly: string
} {
  return {
    session:
      share.sessionPct >= 100
        ? `${(share.sessionPct / 100).toFixed(1)} session windows`
        : `${pctLabelBlock(share.sessionPct)} of a session window`,
    weekly: `${pctLabelBlock(share.weeklyPct)} of the week`,
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const numberOrNullBlock = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Rows of the Claude usage log (`ai-usage-log/claude/<month>.jsonl`), as the
 * status line writes them.
 *
 * Three row shapes exist, matching the script's three ways of building one:
 * the jq projection, the no-jq projection (percentages only), and the raw
 * payload under a `payload` key. Rows that name no session are dropped — there
 * is nobody to attribute them to, and the next row that does will carry the
 * same account-wide value.
 */
export function parseClaudeUsageLogBlock(text: string): LimitSampleBlock[] {
  const out: LimitSampleBlock[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    if (!line) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const t = numberOrNullBlock(row.t)
    if (t == null) continue

    let sample: LimitSampleBlock
    const payload = row.payload as Record<string, unknown> | undefined
    if (payload && typeof payload === 'object') {
      const limits = (payload.rate_limits ?? {}) as Record<string, Record<string, unknown> | undefined>
      sample = {
        t,
        sid: typeof payload.session_id === 'string' ? payload.session_id : '',
        session: numberOrNullBlock(limits.five_hour?.used_percentage),
        sessionResetsAt: numberOrNullBlock(limits.five_hour?.resets_at),
        weekly: numberOrNullBlock(limits.seven_day?.used_percentage),
        weeklyResetsAt: numberOrNullBlock(limits.seven_day?.resets_at),
        spend: numberOrNullBlock((payload.cost as Record<string, unknown> | undefined)?.total_cost_usd),
        model:
          typeof (payload.model as Record<string, unknown> | undefined)?.id === 'string'
            ? ((payload.model as Record<string, unknown>).id as string)
            : null,
      }
    } else {
      sample = {
        t,
        sid: typeof row.sid === 'string' ? row.sid : '',
        session: numberOrNullBlock(row.fh),
        sessionResetsAt: numberOrNullBlock(row.fhr),
        weekly: numberOrNullBlock(row.sd),
        weeklyResetsAt: numberOrNullBlock(row.sdr),
        spend: numberOrNullBlock(row.cost),
        model: typeof row.model === 'string' ? row.model : null,
      }
    }
    if (!sample.sid) continue
    sample.sid = sample.sid.toLowerCase()

    // The same month reaches us from home and from the vault mirror, and a
    // mirror of this machine's own file repeats every row.
    const key = `${sample.t}|${sample.sid}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(sample)
  }
  return out
}

/**
 * A Codex limit reading as the parser stores it on a session:
 * `[t, session%, sessionResetsAt, weekly%, weeklyResetsAt, cumulativeTokens]`.
 *
 * A tuple because a busy transcript carries hundreds and they sit in the parse
 * cache; the names live here instead of on every row.
 */
export type CodexLimitReadingBlock = [
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number,
]

export function codexReadingsToSamplesBlock(
  baseSid: string,
  model: string | null,
  readings: CodexLimitReadingBlock[],
): LimitSampleBlock[] {
  return readings.map(([t, session, sessionResetsAt, weekly, weeklyResetsAt, tokens]) => ({
    t,
    sid: baseSid,
    session,
    sessionResetsAt,
    weekly,
    weeklyResetsAt,
    spend: tokens,
    model,
  }))
}

/**
 * Read one Codex `token_count` event's `rate_limits` into the two meters.
 *
 * Which slot is which is decided by window length, not by `primary` /
 * `secondary`: a plan with no short window reports the weekly one as primary.
 * Other limit families (`limit_id: "premium"`) meter something else entirely
 * and are skipped.
 */
export function readCodexRateLimitsBlock(raw: unknown): {
  session: number | null
  sessionResetsAt: number | null
  weekly: number | null
  weeklyResetsAt: number | null
} | null {
  if (!raw || typeof raw !== 'object') return null
  const limits = raw as Record<string, unknown>
  if (limits.limit_id != null && limits.limit_id !== 'codex') return null

  const result = {
    session: null as number | null,
    sessionResetsAt: null as number | null,
    weekly: null as number | null,
    weeklyResetsAt: null as number | null,
  }
  let any = false
  for (const slot of [limits.primary, limits.secondary]) {
    if (!slot || typeof slot !== 'object') continue
    const window = slot as Record<string, unknown>
    const used = numberOrNullBlock(window.used_percent)
    if (used == null) continue
    const minutes = numberOrNullBlock(window.window_minutes)
    const resetsAt = numberOrNullBlock(window.resets_at)
    if (minutes != null && minutes > 24 * 60) {
      result.weekly = used
      result.weeklyResetsAt = resetsAt
    } else {
      result.session = used
      result.sessionResetsAt = resetsAt
    }
    any = true
  }
  return any ? result : null
}
