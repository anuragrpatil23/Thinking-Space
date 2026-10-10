import {
  accentForBlock,
  fillFractionBlock,
  formatRemainingBlock,
  formatResetAtBlock,
  toneForWindowBlock,
  type AiLimitsProviderIdBlock,
  type AiLimitWindowBlock,
  type AiLimitWindowKindBlock,
} from '@/services/lego_blocks/units/aiLimitsModelBlock'

interface AiLimitsMeterBlockProps {
  providerId: AiLimitsProviderIdBlock
  kind: AiLimitWindowKindBlock
  window: AiLimitWindowBlock | null
  isDark: boolean
  mutedColor: string
  textColor: string
  /** Frozen clock so every meter in a render agrees on "now". */
  nowMs: number
}

const TONE_COLOR_BLOCK = {
  light: { watch: '#C68A2E', urgent: '#C4453C' },
  dark: { watch: '#DDA43F', urgent: '#E0625A' },
} as const

const KIND_LABEL_BLOCK: Record<AiLimitWindowKindBlock, string> = {
  session: 'Current session',
  weekly: 'Current week',
}

/** The bar: a fixed short length, the same for every meter. */
const BAR_CLASS_BLOCK = 'h-[3px] w-28 shrink-0'

/**
 * One usage window, compact: its name, then one short row under it — time
 * left, the bar, the figure, and the moment it comes back.
 *
 * Nothing in the row stretches. Three layouts before this one each got that
 * wrong in a different way: fixed-width columns around a `1fr` bar left a short
 * figure ("1h") adrift from its bar; moving the time into the caption kept the
 * other columns and their gaps; and text over a full-width bar made two
 * hairlines span the whole card for two numbers — the heaviest thing in the
 * section. Here every figure is as wide as its own text and the bar is a fixed
 * short length, so the figures sit against the bar and the two bars are equal
 * by construction.
 *
 * "Current" is the word doing the work in the name — it is what sets these
 * apart from the chart shown under them, the same weekly limit as history.
 */
export default function AiLimitsMeterBlock({
  providerId,
  kind,
  window,
  isDark,
  mutedColor,
  textColor,
  nowMs,
}: AiLimitsMeterBlockProps) {
  const trackColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(28,25,23,0.08)'
  const name = (
    <p className="mb-2 text-[10.5px] leading-none" style={{ color: mutedColor }}>
      {KIND_LABEL_BLOCK[kind]}
    </p>
  )

  // No data yet: hold the meter's shape with an empty track so the strip
  // doesn't reflow when the first reading lands.
  if (!window) {
    return (
      <div>
        {name}
        <div className="flex items-center gap-x-2.5 leading-none">
          <span className={`${BAR_CLASS_BLOCK} rounded-full`} style={{ background: trackColor }} />
          <span className="text-[11px] tabular-nums" style={{ color: mutedColor }}>
            —
          </span>
        </div>
      </div>
    )
  }

  const tone = toneForWindowBlock(window)
  const fill = fillFractionBlock(window.usedPercent)
  const remaining = formatRemainingBlock(window.resetsAt, kind, nowMs)
  const resetAt = formatResetAtBlock(window.resetsAt, kind, nowMs)
  const fillColor =
    tone === 'calm'
      ? accentForBlock(providerId, isDark)
      : TONE_COLOR_BLOCK[isDark ? 'dark' : 'light'][tone]

  return (
    <div>
      {name}
      <div className="flex items-center gap-x-2.5 leading-none">
        {remaining && (
          <span className="text-[11px] tabular-nums whitespace-nowrap" style={{ color: mutedColor }}>
            {remaining}
          </span>
        )}

        <span
          className={`${BAR_CLASS_BLOCK} relative overflow-hidden rounded-full`}
          style={{ background: trackColor }}
          role="img"
          aria-label={`${KIND_LABEL_BLOCK[kind]} limit, ${Math.round(
            window.usedPercent,
          )} percent used${resetAt ? `, resets ${resetAt}` : ''}`}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${fill * 100}%`,
              background: fillColor,
              // Fill grows on data change, not on mount, so the strip settles
              // quietly instead of animating on every page load.
              transition: 'width 420ms cubic-bezier(0.22, 1, 0.36, 1), background-color 420ms ease',
            }}
          />
        </span>

        <span className="text-[11px] tabular-nums" style={{ color: textColor }}>
          {Math.round(window.usedPercent)}%
        </span>

        {resetAt && (
          <span
            className="ml-1 text-[11px] tabular-nums whitespace-nowrap"
            style={{ color: mutedColor }}
          >
            {resetAt}
          </span>
        )}
      </div>
    </div>
  )
}

export { TONE_COLOR_BLOCK }
