import {
  accentForBlock,
  fillFractionBlock,
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

/**
 * One template for every row, in every provider column.
 *
 * All four tracks share it so the bars are the same length and the figures line
 * up down the card. The reset column is a fixed width rather than `auto` for
 * exactly that reason: sized to content, "Sep 6, 6:27 AM" and "Sep 12, 11:15 AM"
 * measure differently, and the `1fr` bar silently absorbs the difference —
 * which is what left the two bars visibly unequal.
 */
const ROW_GRID_BLOCK = 'grid grid-cols-[1fr_2.25rem_6.75rem]'

const KIND_LABEL_BLOCK: Record<AiLimitWindowKindBlock, string> = {
  session: 'Session',
  weekly: 'Weekly',
}

/**
 * One usage window as a row: spend, the figure, and the moment it comes back.
 *
 * The time left used to lead the row in a fixed-width column. Fixed so the
 * bars stayed equal — but a short figure ("1h") then sat far from its bar with
 * dead space between, and no width suits both "3h 33m" and "1h". It moved up
 * into the caption the strip sets over each meter, so the bar starts on the
 * caption's own left edge and both bars are the same length by construction.
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

  // No data yet: hold the row's shape with an empty track so the strip doesn't
  // reflow when the first reading lands.
  if (!window) {
    return (
      <div className={`${ROW_GRID_BLOCK} items-center gap-x-2.5`}>
        <span className="h-[3px] rounded-full" style={{ background: trackColor }} />
        <span className="text-right text-[11px] tabular-nums" style={{ color: mutedColor }}>
          —
        </span>
        <span />
      </div>
    )
  }

  const tone = toneForWindowBlock(window)
  const fill = fillFractionBlock(window.usedPercent)
  const resetAt = formatResetAtBlock(window.resetsAt, kind, nowMs)
  const fillColor =
    tone === 'calm'
      ? accentForBlock(providerId, isDark)
      : TONE_COLOR_BLOCK[isDark ? 'dark' : 'light'][tone]

  return (
    <div className={`${ROW_GRID_BLOCK} items-center gap-x-2.5`}>
      <span
        className="relative h-[3px] overflow-hidden rounded-full"
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

      <span className="text-right text-[11px] tabular-nums" style={{ color: textColor }}>
        {Math.round(window.usedPercent)}%
      </span>

      <span
        className="text-right text-[11px] tabular-nums whitespace-nowrap"
        style={{ color: mutedColor }}
      >
        {resetAt ?? ''}
      </span>
    </div>
  )
}

export { TONE_COLOR_BLOCK }
