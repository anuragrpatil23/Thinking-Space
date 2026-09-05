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

/** Shared so the empty row and the live row keep identical column widths. */
const ROW_GRID_BLOCK = 'grid grid-cols-[3.25rem_1fr_2.25rem_auto]'

const KIND_LABEL_BLOCK: Record<AiLimitWindowKindBlock, string> = {
  session: 'Session',
  weekly: 'Weekly',
}

/**
 * One usage window as a row: time left, spend, the figure, and the moment it
 * comes back.
 *
 * The two figures either side of the bar answer different questions — the left
 * is how long you have, the right is when to come back — so they're separated
 * rather than run together. The two rows in a provider column are told apart by
 * the scale of those figures (hours against days, a clock time against a date),
 * which is why neither needs a label.
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
        <span className="text-[11px] tabular-nums" style={{ color: mutedColor }}>
          —
        </span>
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
    <div className={`${ROW_GRID_BLOCK} items-center gap-x-2.5`}>
      <span className="text-[11px] tabular-nums" style={{ color: mutedColor }}>
        {remaining ?? ''}
      </span>

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
