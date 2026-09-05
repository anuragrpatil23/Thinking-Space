/**
 * Pure model for the AI usage-limit strip.
 *
 * Both providers hand us the same three facts per window — how much is spent,
 * when the window resets, and how long the window is — so everything the strip
 * renders is derived here rather than in the components. Keeping it pure means
 * the pace maths and the tone thresholds are testable without a DOM.
 *
 * Sources (neither reads a credential; both are first-party local surfaces):
 *   - Claude: `rate_limits` on the Claude Code status-line JSON
 *   - Codex:  `account/rateLimits/read` on the local `codex app-server`
 */

export type AiLimitsProviderIdBlock = 'claude' | 'codex'

/** How urgently a window wants to be looked at. Drives colour, nothing else. */
export type AiLimitToneBlock = 'calm' | 'watch' | 'urgent'

export interface AiLimitWindowBlock {
  /** 0–100. Can exceed 100 when a plan allows overage. */
  usedPercent: number
  /** Epoch seconds when this window resets, or null when the source omits it. */
  resetsAt: number | null
  /** Window length in minutes (300 = 5h, 10080 = 7d), or null when unknown. */
  windowMinutes: number | null
}

/**
 * `unconfigured` is a first-class state, not an error: Claude only emits rate
 * limits once the user has a status line wired up, and that is the state every
 * user starts in. `waiting` means the source is connected but has not reported
 * yet (Claude publishes nothing until the first API response of a session).
 */
export type AiLimitsProviderStateBlock = 'ready' | 'waiting' | 'unconfigured'

export interface AiLimitsProviderBlock {
  id: AiLimitsProviderIdBlock
  label: string
  /** Plan name as the provider reports it ("Pro", "Education"), or null. */
  plan: string | null
  state: AiLimitsProviderStateBlock
  /**
   * Whether this provider is actually used on this machine. A provider the
   * person doesn't use has nothing to say to them, so it is hidden outright
   * rather than shown as an empty row.
   */
  detected: boolean
  /**
   * Whether the account has subscription-backed limits. API-key users have no
   * session or weekly windows at all, so a meter would be meaningless — but we
   * only know this once a provider has reported, hence the `state` interplay in
   * `visibleProvidersBlock`.
   */
  hasPlan: boolean
  /** Short rolling window — 5 hours on both providers today. */
  session: AiLimitWindowBlock | null
  /** Long window — 7 days on both providers today. */
  weekly: AiLimitWindowBlock | null
}

/**
 * Which providers earn a slot in the strip.
 *
 * Three rules, in order: a provider that isn't used here never shows; one that
 * has reported and turns out to have no plan never shows (API-key accounts have
 * no windows to meter); everything else shows, including a detected provider
 * that hasn't been wired up yet — that case is precisely when the connect
 * invitation is worth surfacing.
 *
 * An empty result means the strip renders nothing at all, which is the correct
 * outcome for someone who uses neither tool.
 */
export function visibleProvidersBlock(
  providers: AiLimitsProviderBlock[],
): AiLimitsProviderBlock[] {
  return providers.filter((provider) => {
    if (!provider.detected) return false
    if (provider.state === 'ready' && !provider.hasPlan) return false
    return true
  })
}

/**
 * Identity colour per provider, used only while a window is `calm`.
 *
 * Two values each because one hue can't serve both grounds: a blue that reads
 * as considered on warm cream goes muddy on the night backdrop, and a blue that
 * sings in the dark glares on paper.
 */
export const AI_LIMITS_ACCENT_BLOCK: Record<
  AiLimitsProviderIdBlock,
  { light: string; dark: string }
> = {
  // Claude's blue is sampled from Claude Code's own usage bar (#4177D0), so the
  // two surfaces agree. The dark value holds that hue and lifts lightness to
  // ~70% — the source blue is tuned for white and goes dim on the night
  // backdrop.
  claude: { light: '#4177D0', dark: '#83A7E2' },
  codex: { light: '#10A37F', dark: '#2BBF95' },
}

export function accentForBlock(id: AiLimitsProviderIdBlock, isDark: boolean): string {
  const accent = AI_LIMITS_ACCENT_BLOCK[id]
  return isDark ? accent.dark : accent.light
}

/**
 * Which of a provider's two windows a reading belongs to. Only affects how the
 * reset is phrased — the meters are otherwise identical.
 */
export type AiLimitWindowKindBlock = 'session' | 'weekly'

/**
 * Tone for a window, from spend alone.
 *
 * Thresholds are absolute on purpose: the percentage is on screen right next to
 * the colour, so the reader can always see why a bar turned amber. A cleverer
 * rule (escalating when spend runs ahead of the clock) was tried and dropped —
 * with no time marker on the track it produced colour changes nothing on screen
 * accounted for.
 */
export function toneForWindowBlock(window: AiLimitWindowBlock): AiLimitToneBlock {
  const used = window.usedPercent
  if (used >= 90) return 'urgent'
  if (used >= 75) return 'watch'
  return 'calm'
}

function clockBlock(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function startOfDayBlock(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * How much of the window is left — the left-hand figure on a row.
 *
 * Scaled to the window it describes. A session is lived in hours and minutes,
 * so it counts down in them; a week is lived in days, and "6d" is the unit you
 * actually plan against — "142h" would be arithmetic, not information.
 */
export function formatRemainingBlock(
  resetsAt: number | null,
  kind: AiLimitWindowKindBlock,
  nowMs: number = Date.now(),
): string | null {
  if (resetsAt == null) return null
  const remainingMs = resetsAt * 1000 - nowMs
  if (remainingMs <= 0) return 'now'

  const minutes = Math.floor(remainingMs / 60_000)
  const hours = Math.floor(minutes / 60)

  if (kind === 'weekly') {
    const days = Math.floor(hours / 24)
    // Under a day left the week is nearly over, so hours become the useful unit.
    return days >= 1 ? `${days}d` : `${Math.max(1, hours)}h`
  }

  if (minutes < 60) return `${Math.max(1, minutes)}m`
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

/**
 * When the window actually comes back — the right-hand figure on a row.
 *
 * A session window is at most a few hours long, so its reset always lands today
 * or tomorrow and those words read faster than a weekday name. A weekly reset
 * is far enough out that only a calendar date pins it down.
 */
export function formatResetAtBlock(
  resetsAt: number | null,
  kind: AiLimitWindowKindBlock,
  nowMs: number = Date.now(),
): string | null {
  if (resetsAt == null) return null
  const at = new Date(resetsAt * 1000)

  if (kind === 'weekly') {
    const date = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${date}, ${clockBlock(at)}`
  }

  const dayDelta = Math.round(
    (startOfDayBlock(at.getTime()) - startOfDayBlock(nowMs)) / 86_400_000,
  )
  if (dayDelta === 0) return `Today ${clockBlock(at)}`
  if (dayDelta === 1) return `Tomorrow ${clockBlock(at)}`
  const weekday = at.toLocaleDateString(undefined, { weekday: 'short' })
  return `${weekday} ${clockBlock(at)}`
}

/** Clamp for the meter fill. Overage still reads as a full bar. */
export function fillFractionBlock(usedPercent: number): number {
  return Math.min(1, Math.max(0, usedPercent / 100))
}
