import { describe, expect, it } from 'vitest'
import {
  buildWebullSimTimelineModelBlock,
  isSimNonRepFileNameBlock,
  momentDateToYearFractionBlock,
  parseWebullSimBenchBlock,
  parseWebullSimCaseBlock,
  parseWebullSimErasBlock,
} from '@/personal_extension/services/lego_blocks/units/webullSimRecordBlock'

const CASE_FIXTURE = `---
uuid: "4ee65218-8e75-437e-aa66-b527e2250c3a"
type: ai_synthesis
status: revealed
moment_date: 2016-02
era: late-zirp
rep_type: case
case_id: 001
company: Apple Inc. (AAPL)
moment: early February 2016
---

# Case 001 — Apple, early February 2016
Body text that must never be surfaced.
`

const QUARTER_WALK_FIXTURE = `---
status: case-staged
moment_date: "1961-10"
span_end: "1963-06"
era: go-go-years
rep_type: quarter-walk
company: Xerox Corporation (XRX)
moment: October 1961
---
body
`

const ERAS_FIXTURE = `eras:
  - slug: go-go-years
    label: Growth-stock run / go-go years
    start: 1961
    end: 1968
  - slug: ai-wave
    label: The AI wave
    start: 2022
    end: null
`

const BENCH_FIXTURE = `# Bench

Some intro prose.

| company | moment | era | why |
|---|---|---|---|
| intel | 1995-06 | pc-wave | The PC wave at full ramp, before the internet changed the question. |
| cisco | 2002-10 | dot-com-bust | Was it cheap yet — the right answer is genuinely unclear. |

Trailing prose after the table.
`

describe('momentDateToYearFractionBlock', () => {
  it('maps YYYY-MM to a fractional year', () => {
    expect(momentDateToYearFractionBlock('1961-10')).toBeCloseTo(1961 + 9 / 12, 5)
    expect(momentDateToYearFractionBlock('2016-02')).toBeCloseTo(2016 + 1 / 12, 5)
    expect(momentDateToYearFractionBlock(null)).toBeNull()
    expect(momentDateToYearFractionBlock('nope')).toBeNull()
  })
})

describe('parseWebullSimCaseBlock', () => {
  it('parses a point-in-time case (unquoted moment_date + case_id)', () => {
    const parsed = parseWebullSimCaseBlock({
      filePath: 'cases/apple/apple-feb-2016.md',
      companySlug: 'apple',
      content: CASE_FIXTURE,
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.companySlug).toBe('apple')
    expect(parsed?.company).toBe('Apple Inc. (AAPL)')
    expect(parsed?.status).toBe('revealed')
    expect(parsed?.momentDate).toBe('2016-02')
    expect(parsed?.repType).toBe('case')
    expect(parsed?.spanEnd).toBeNull()
    expect(parsed?.momentLabel).toBe('early February 2016')
  })

  it('parses a quarter-walk with a span end', () => {
    const parsed = parseWebullSimCaseBlock({
      filePath: 'cases/xerox/xerox-oct-1961.md',
      companySlug: 'xerox',
      content: QUARTER_WALK_FIXTURE,
    })
    expect(parsed?.repType).toBe('quarter-walk')
    expect(parsed?.spanEnd).toBe('1963-06')
    expect(parsed?.spanEndYear).toBeCloseTo(1963 + 5 / 12, 5)
  })

  it('returns null when moment_date is missing', () => {
    expect(parseWebullSimCaseBlock({
      filePath: 'x.md',
      companySlug: 'x',
      content: '---\nstatus: revealed\n---\nbody',
    })).toBeNull()
  })
})

describe('non-rep file filtering', () => {
  it('skips patterns and pair files', () => {
    expect(isSimNonRepFileNameBlock('apple-patterns.md')).toBe(true)
    expect(isSimNonRepFileNameBlock('pair-apple-vs-msft.md')).toBe(true)
    expect(isSimNonRepFileNameBlock('apple-feb-2016.md')).toBe(false)
    expect(isSimNonRepFileNameBlock('notes.txt')).toBe(true)
  })
})

describe('parseWebullSimErasBlock', () => {
  it('parses slug/label/start/end with null present', () => {
    const eras = parseWebullSimErasBlock(ERAS_FIXTURE)
    expect(eras).toHaveLength(2)
    expect(eras[0]).toMatchObject({ slug: 'go-go-years', start: 1961, end: 1968 })
    expect(eras[1]).toMatchObject({ slug: 'ai-wave', start: 2022, end: null })
  })
})

describe('parseWebullSimBenchBlock', () => {
  it('parses table rows, skipping header/separator and surrounding prose', () => {
    const bench = parseWebullSimBenchBlock(BENCH_FIXTURE)
    expect(bench).toHaveLength(2)
    expect(bench[0]).toMatchObject({ companySlug: 'intel', momentDate: '1995-06', era: 'pc-wave' })
    expect(bench[0].why).toContain('PC wave')
  })
})

describe('buildWebullSimTimelineModelBlock', () => {
  it('groups marks into lanes and counts statuses', () => {
    const appleCase = parseWebullSimCaseBlock({ filePath: 'cases/apple/a.md', companySlug: 'apple', content: CASE_FIXTURE })!
    const xeroxWalk = parseWebullSimCaseBlock({ filePath: 'cases/xerox/x.md', companySlug: 'xerox', content: QUARTER_WALK_FIXTURE })!
    const bench = parseWebullSimBenchBlock(BENCH_FIXTURE)
    const eras = parseWebullSimErasBlock(ERAS_FIXTURE)

    const model = buildWebullSimTimelineModelBlock({ cases: [appleCase, xeroxWalk], bench, eras })

    expect(model.totalReps).toBe(2)
    expect(model.benchSize).toBe(2)
    expect(model.counts.revealed).toBe(1)
    expect(model.counts.staged).toBe(1)
    // apple, cisco, intel, xerox — 4 distinct lanes, sorted by company name.
    expect(model.lanes.map((l) => l.companySlug)).toEqual(['apple', 'cisco', 'intel', 'xerox'])
    expect(model.minYear).toBeLessThanOrEqual(1961)
    expect(model.maxYear).toBeGreaterThanOrEqual(new Date().getFullYear())
  })
})
