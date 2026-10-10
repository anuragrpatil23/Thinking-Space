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

/**
 * One template for every meter, so the two sit on one line with equal bars and
 * figures that line up. The countdown column is a fixed width rather than
 * `auto` for exactly that reason: sized to content, "3h 41m left" and "3d left"
 * measure differently, and the `1fr` bar silently absorbs the difference —
 * which is what once left the bars visibly unequal.
 */
const ROW_GRID_BLOCK = 'grid grid-cols-[3.25rem_1fr_2.25rem_4.75rem]'

const KIND_LABEL_BLOCK: Record<AiLimitWindowKindBlock, string> = {
  session: 'Session',
  weekly: 'Weekly',
}

/**
 * One usage window as a row: which window, spend, the figure, and how long is
 * left.
 *
 * The row used to carry two times — how long you have, and the date it comes
 * back — and no name, leaving the two windows to be told apart by hours against
 * days. Both times answer the same question, so the date moved to the hover
 * title and the freed column names the window instead.
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
  const label = (
    <span className="text-[11px]" style={{ color: mutedColor }}>
      {KIND_LABEL_BLOCK[kind]}
    </span>
  )

  // No data yet: hold the row's shape with an empty track so the strip doesn't
  // reflow when the first reading lands.
  if (!window) {
    return (
      <div className={`${ROW_GRID_BLOCK} items-center gap-x-2.5`}>
        {label}
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
  const remaining = formatRemainingBlock(window.resetsAt, kind, nowMs)
  const resetAt = formatResetAtBlock(window.resetsAt, kind, nowMs)
  const fillColor =
    tone === 'calm'
      ? accentForBlock(providerId, isDark)
      : TONE_COLOR_BLOCK[isDark ? 'dark' : 'light'][tone]

  return (
    <div
      className={`${ROW_GRID_BLOCK} items-center gap-x-2.5`}
      title={resetAt ? `Resets ${resetAt}` : undefined}
    >
      {label}

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
        {remaining ? `${remaining} left` : ''}
      </span>
    </div>
  )
}

export { TONE_COLOR_BLOCK }
