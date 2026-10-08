import { describe, expect, it } from 'vitest'
import {
  buildLimitLedgerBlock,
  buildSessionShareIndexBlock,
  codexReadingsToSamplesBlock,
  formatLimitShareBlock,
  parseClaudeUsageLogBlock,
  readCodexRateLimitsBlock,
  sumLimitSharesBlock,
  type LimitLedgerBlock,
  type LimitSampleBlock,
} from '@/services/lego_blocks/units/aiLimitShareBlock'

/**
 * Per-session share of the plan limits.
 *
 * The providers report one account-wide whole-number percentage and nothing
 * about who spent it, so every rule here is about not inventing an answer:
 * measure when one session was running, split only when several were, and
 * leave unexplained movement unattributed.
 */

const HOUR = 3600
const T0 = 1_790_000_000
/** Reset times for the windows the fixtures run in. */
const FH = T0 + 5 * HOUR
const WK = T0 + 6 * 24 * HOUR

function sample(
  minutes: number,
  sid: string,
  session: number | null,
  weekly: number | null,
  spend: number | null,
  extra: Partial<LimitSampleBlock> = {},
): LimitSampleBlock {
  return {
    t: T0 + minutes * 60,
    sid,
    session,
    sessionResetsAt: session == null ? null : FH,
    weekly,
    weeklyResetsAt: weekly == null ? null : WK,
    spend,
    model: 'opus',
    ...extra,
  }
}

function totals(ledger: LimitLedgerBlock): Record<string, { session: number; weekly: number }> {
  const out: Record<string, { session: number; weekly: number }> = {}
  for (const entry of ledger.entries) {
    const row = (out[entry.sid ?? '(none)'] ??= { session: 0, weekly: 0 })
    row[entry.kind] += entry.pct
  }
  return out
}

describe('buildLimitLedgerBlock', () => {
  it('gives a lone session exactly how far the meters moved, with no rate involved', () => {
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 10, 50, 0),
      sample(5, 'a', 14, 50, 2),
      sample(10, 'a', 19, 51, 4),
      sample(15, 'a', 25, 52, 7),
    ])
    expect(totals(ledger)).toEqual({ a: { session: 15, weekly: 2 } })
    expect(ledger.entries.every(entry => !entry.split)).toBe(true)
  })

  it('does not attribute the value the meters already held when the log began', () => {
    // The first reading says the week is at 50%. That is history, not this
    // session's doing.
    const ledger = buildLimitLedgerBlock([sample(0, 'a', 40, 50, 0), sample(5, 'a', 40, 50, 1)])
    expect(ledger.entries).toEqual([])
  })

  it('attributes back-to-back sessions separately', () => {
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 0, 10, 0),
      sample(5, 'a', 6, 11, 3),
      sample(60, 'b', 6, 11, 0),
      sample(65, 'b', 9, 11, 1.5),
    ])
    expect(totals(ledger)).toEqual({
      a: { session: 6, weekly: 1 },
      b: { session: 3, weekly: 0 },
    })
  })

  it('splits an overlap by spend and marks it, instead of crediting whoever reported', () => {
    // Both sessions spend across the same ten minutes; `a` happens to report
    // the movement. `b` spent three times as much.
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 10, 50, 0),
      sample(0, 'b', 10, 50, 0),
      sample(10, 'b', null, null, 6),
      sample(10, 'a', 18, 50, 2),
    ])
    const got = totals(ledger)
    expect(got.a.session).toBeCloseTo(2)
    expect(got.b.session).toBeCloseTo(6)
    expect(ledger.entries.every(entry => entry.split)).toBe(true)
  })

  it('weights an overlap per model, because a dollar does not move the meter equally', () => {
    // Solo history establishes that `fast` moves the meter 2 points per unit
    // and `slow` 0.5. In the overlap both spend 4 units; the 10 points must
    // split 8 : 2, not 5 : 5.
    const fast = { model: 'fast' }
    const slow = { model: 'slow' }
    const ledger = buildLimitLedgerBlock([
      sample(0, 'f', 0, 0, 0, fast),
      sample(5, 'f', 10, 0, 5, fast),
      sample(20, 's', 10, 0, 0, slow),
      sample(25, 's', 15, 0, 10, slow),
      // overlap
      sample(60, 'f', 15, 0, 5, fast),
      sample(60, 's', 15, 0, 10, slow),
      sample(70, 's', null, null, 14, slow),
      sample(70, 'f', 25, 0, 9, fast),
    ])
    const overlap = ledger.entries.filter(entry => entry.t === T0 + 70 * 60)
    expect(overlap.find(entry => entry.sid === 'f')?.pct).toBeCloseTo(8)
    expect(overlap.find(entry => entry.sid === 's')?.pct).toBeCloseTo(2)
  })

  it('files movement nobody here spent as unattributed', () => {
    // Overnight the week climbed 20 points and the reporting session had not
    // spent a cent: another machine, or a chat on the web.
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 10, 30, 0),
      sample(5, 'a', 12, 30, 1),
      sample(600, 'b', null, 50, 0, { weeklyResetsAt: WK }),
    ])
    expect(totals(ledger)['(none)']).toEqual({ session: 0, weekly: 20 })
    expect(totals(ledger).b).toBeUndefined()
  })

  it('caps a session at what its spend explains when outside usage lands on it', () => {
    // Rate from solo history: 2 points per unit. Then one unit of spend
    // coincides with a 30-point jump — 2 are this session's, 28 are not.
    const rows = [sample(0, 'a', 0, 0, 0)]
    for (let i = 1; i <= 6; i += 1) rows.push(sample(i * 5, 'a', i * 2, 0, i))
    rows.push(sample(35, 'a', 42, 0, 7))
    const got = totals(buildLimitLedgerBlock(rows))
    expect(got.a.session).toBeCloseTo(14)
    expect(got['(none)'].session).toBeCloseTo(28)
  })

  it('starts a new window from zero when it opened while we were watching', () => {
    const next = { sessionResetsAt: FH + 6 * HOUR }
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 80, 10, 0),
      sample(5, 'a', 90, 10, 3),
      // six hours later the short window has rolled over; 7% is all new
      sample(400, 'a', 7, 11, 5, next),
    ])
    expect(totals(ledger).a).toEqual({ session: 17, weekly: 1 })
  })

  it('does not double count a meter that dips and recovers', () => {
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 30, 10, 0),
      sample(5, 'a', 31, 10, 1),
      sample(10, 'a', 30, 10, 2),
      sample(15, 'a', 31, 10, 3),
    ])
    expect(totals(ledger).a.session).toBe(1)
  })

  it('reads a counter that restarts as a resumed session, not as negative spend', () => {
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 0, 0, 10),
      sample(5, 'a', 5, 0, 12),
      sample(10, 'a', 9, 0, 1), // resumed: cost counter back near zero
    ])
    expect(totals(ledger).a.session).toBe(9)
  })

  it('does not let two accounts interleaved in one timeline reopen each other\'s windows', () => {
    // A second account whose window opened two hours before the log began.
    const other = { sessionResetsAt: FH - 2 * HOUR }
    const ledger = buildLimitLedgerBlock([
      sample(0, 'a', 40, null, 0),
      sample(1, 'x', 70, null, 0, other),
      sample(5, 'a', 42, null, 1),
      sample(6, 'x', 71, null, 1, other),
      sample(10, 'a', 44, null, 2),
    ])
    const got = totals(ledger)
    expect(got.a.session + (got.x?.session ?? 0) + (got['(none)']?.session ?? 0)).toBeLessThanOrEqual(5)
  })

  it('does not spread a long idle gap\'s spend across everyone else\'s movement', () => {
    // `idle` has two samples ten hours apart. `busy` works in between, alone.
    const ledger = buildLimitLedgerBlock([
      sample(0, 'idle', 0, 10, 1),
      sample(60, 'busy', 0, 10, 0),
      sample(65, 'busy', 8, 11, 4),
      sample(600, 'idle', null, null, 2),
    ])
    expect(totals(ledger)).toEqual({ busy: { session: 8, weekly: 1 } })
    expect(ledger.entries.every(entry => !entry.split)).toBe(true)
  })
})

describe('buildSessionShareIndexBlock', () => {
  const ledger = buildLimitLedgerBlock([
    sample(0, 'a', 0, 10, 0),
    sample(5, 'a', 6, 11, 3),
    // same session id, a second sitting four hours later
    sample(240, 'a', 6, 11, 3),
    sample(245, 'a', 10, 11, 5),
  ])

  it('gives each sitting of one transcript the movement read while it ran', () => {
    const index = buildSessionShareIndexBlock(ledger, [
      { id: 'a', baseSid: 'a', startMs: T0 * 1000 },
      { id: 'a::later', baseSid: 'a', startMs: (T0 + 239 * 60) * 1000 },
    ])
    expect(index.get('a')).toEqual({ sessionPct: 6, weeklyPct: 1, approx: false })
    expect(index.get('a::later')).toEqual({ sessionPct: 4, weeklyPct: 0, approx: false })
  })

  it('leaves out a session that was never measured, rather than reporting zero', () => {
    const index = buildSessionShareIndexBlock(ledger, [
      { id: 'a', baseSid: 'a', startMs: T0 * 1000 },
      { id: 'before-capture', baseSid: 'before-capture', startMs: (T0 - 90 * 24 * HOUR) * 1000 },
    ])
    expect(index.has('before-capture')).toBe(false)
    expect(sumLimitSharesBlock([index.get('before-capture')])).toBeNull()
  })

  it('reports a measured session that moved nothing as present, at zero', () => {
    const quiet = buildLimitLedgerBlock([sample(0, 'q', 20, 30, 0), sample(5, 'q', 20, 30, 0.01)])
    const index = buildSessionShareIndexBlock(quiet, [{ id: 'q', baseSid: 'q', startMs: T0 * 1000 }])
    expect(index.get('q')).toEqual({ sessionPct: 0, weeklyPct: 0, approx: false })
  })
})

describe('formatLimitShareBlock', () => {
  it('says "less than a point" for a session too small to tick the meter', () => {
    expect(formatLimitShareBlock({ sessionPct: 0, weeklyPct: 0.2, approx: false })).toEqual({
      session: '<1% of a session window',
      weekly: '<1% of the week',
    })
  })

  it('counts windows once a sitting has used more than one', () => {
    expect(formatLimitShareBlock({ sessionPct: 150, weeklyPct: 21.4, approx: true })).toEqual({
      session: '1.5 session windows',
      weekly: '21% of the week',
    })
  })
})

describe('parseClaudeUsageLogBlock', () => {
  it('reads all three row shapes the status line can write, and drops repeats', () => {
    const jq = '{"t":100,"p":"claude","sid":"AAA","fh":3,"fhr":900,"sd":54,"sdr":9000,"cost":1.5,"ctx":10,"model":"m"}'
    const noJq = '{"t":200,"p":"claude","sid":"aaa","fh":4,"sd":54}'
    const raw =
      '{"t":300,"p":"claude","payload":{"session_id":"aaa","model":{"id":"m"},"cost":{"total_cost_usd":2},"rate_limits":{"five_hour":{"used_percentage":5,"resets_at":900},"seven_day":{"used_percentage":55,"resets_at":9000}}}}'
    const noSession = '{"t":400,"p":"claude","fh":9,"sd":60}'
    const rows = parseClaudeUsageLogBlock([jq, noJq, raw, noSession, jq, 'not json'].join('\n'))
    expect(rows.map(row => [row.t, row.sid, row.session, row.weekly, row.spend])).toEqual([
      [100, 'aaa', 3, 54, 1.5],
      [200, 'aaa', 4, 54, null],
      [300, 'aaa', 5, 55, 2],
    ])
  })
})

describe('Codex readings', () => {
  it('sorts the two slots by window length, not by primary / secondary', () => {
    // A plan with no short window reports the weekly one as primary.
    expect(
      readCodexRateLimitsBlock({
        limit_id: 'codex',
        primary: { used_percent: 9, window_minutes: 10080, resets_at: 700 },
        secondary: null,
      }),
    ).toEqual({ session: null, sessionResetsAt: null, weekly: 9, weeklyResetsAt: 700 })
  })

  it('ignores limit families that meter something else', () => {
    expect(
      readCodexRateLimitsBlock({ limit_id: 'premium', primary: { used_percent: 3, window_minutes: 300 } }),
    ).toBeNull()
  })

  it('turns a transcript\'s readings into samples the ledger can measure', () => {
    const ledger = buildLimitLedgerBlock(
      codexReadingsToSamplesBlock('c', 'gpt', [
        [T0, 24, FH, 4, WK, 1000],
        [T0 + 300, 36, FH, 6, WK, 9000],
      ]),
    )
    expect(totals(ledger)).toEqual({ c: { session: 12, weekly: 2 } })
  })
})
