import { describe, expect, it } from 'vitest'
import {
  accentForBlock,
  fillFractionBlock,
  formatRemainingBlock,
  formatResetAtBlock,
  toneForWindowBlock,
  visibleProvidersBlock,
  type AiLimitsProviderBlock,
  type AiLimitWindowBlock,
} from '@/services/lego_blocks/units/aiLimitsModelBlock'

const NOW = new Date(2026, 8, 5, 12, 0, 0).getTime()

function reset(offsetMs: number): number {
  return Math.floor((NOW + offsetMs) / 1000)
}

function windowAt(usedPercent: number, minutesRemaining: number): AiLimitWindowBlock {
  return {
    usedPercent,
    resetsAt: Math.floor((NOW + minutesRemaining * 60_000) / 1000),
    windowMinutes: 300,
  }
}

function provider(patch: Partial<AiLimitsProviderBlock>): AiLimitsProviderBlock {
  return {
    id: 'codex',
    label: 'Codex',
    plan: 'Education',
    state: 'ready',
    detected: true,
    hasPlan: true,
    session: null,
    weekly: null,
    ...patch,
  }
}

describe('tone', () => {
  it('stays calm below the warning threshold', () => {
    expect(toneForWindowBlock(windowAt(50, 150))).toBe('calm')
    expect(toneForWindowBlock(windowAt(74, 10))).toBe('calm')
  })

  it('escalates on spend alone, so the figure on screen explains the colour', () => {
    expect(toneForWindowBlock(windowAt(75, 240))).toBe('watch')
    expect(toneForWindowBlock(windowAt(90, 240))).toBe('urgent')
  })

  it('treats overage as urgent rather than wrapping', () => {
    expect(toneForWindowBlock(windowAt(140, 10))).toBe('urgent')
    expect(fillFractionBlock(140)).toBe(1)
  })
})

describe('time remaining (left of the bar)', () => {
  it('counts a session down in hours and minutes', () => {
    expect(formatRemainingBlock(reset((3 * 60 + 18) * 60_000), 'session', NOW)).toBe('3h 18m')
    expect(formatRemainingBlock(reset(120 * 60_000), 'session', NOW)).toBe('2h')
    expect(formatRemainingBlock(reset(45 * 60_000), 'session', NOW)).toBe('45m')
  })

  it('counts a week down in days, the unit you plan against', () => {
    expect(formatRemainingBlock(reset(6.5 * 86_400_000), 'weekly', NOW)).toBe('6d')
    expect(formatRemainingBlock(reset(1 * 86_400_000), 'weekly', NOW)).toBe('1d')
  })

  it('falls back to hours once a week has under a day left', () => {
    expect(formatRemainingBlock(reset(18 * 3600_000), 'weekly', NOW)).toBe('18h')
  })

  it('says now while a window is turning over', () => {
    expect(formatRemainingBlock(reset(-60_000), 'session', NOW)).toBe('now')
  })
})

describe('reset moment (right of the bar)', () => {
  it('uses one date format for both windows, so the rows read alike', () => {
    // "Today" told the reader nothing on a 5h window and made the two rows look
    // like they measured different things.
    const session = formatResetAtBlock(reset(3 * 3600_000), 'session', NOW)
    expect(session).not.toMatch(/Today|Tomorrow/)
    expect(session).toMatch(/^[A-Za-z]{3} \d+, /)
  })

  it('names the date and time it comes back', () => {
    const out = formatResetAtBlock(
      Math.floor(new Date(2026, 8, 12, 11, 15).getTime() / 1000),
      'weekly',
      NOW,
    )
    expect(out).toContain('Sep 12')
  })

  it('has no opinion when the source omits the reset', () => {
    expect(formatResetAtBlock(null, 'weekly', NOW)).toBeNull()
    expect(formatRemainingBlock(null, 'session', NOW)).toBeNull()
  })
})

describe('accent', () => {
  it('gives each provider a hue tuned to the ground it sits on', () => {
    expect(accentForBlock('claude', false)).not.toBe(accentForBlock('claude', true))
    expect(accentForBlock('claude', false)).not.toBe(accentForBlock('codex', false))
  })
})

describe('visibility', () => {
  it('hides a provider that is not used on this machine', () => {
    expect(visibleProvidersBlock([provider({ detected: false })])).toHaveLength(0)
  })

  it('hides an API-key account once it has reported, since it has no windows', () => {
    expect(visibleProvidersBlock([provider({ state: 'ready', hasPlan: false })])).toHaveLength(0)
  })

  it('keeps a detected provider that has not been wired up yet, so the invite shows', () => {
    const out = visibleProvidersBlock([provider({ id: 'claude', state: 'unconfigured', hasPlan: false })])
    expect(out).toHaveLength(1)
  })

  it('renders nothing when neither tool is used', () => {
    expect(
      visibleProvidersBlock([
        provider({ id: 'claude', detected: false }),
        provider({ id: 'codex', detected: false }),
      ]),
    ).toHaveLength(0)
  })
})
