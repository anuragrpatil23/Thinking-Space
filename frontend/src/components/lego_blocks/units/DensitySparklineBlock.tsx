import { cn } from '@/lib/utils'
import type { DensityBucket } from '@/services/lego_blocks/units/aiActivityDensityBlock'

// One row-height density strip for an undertaking. Bars are active work per
// bucket (not wall-clock — see aiActivityDensityBlock), the buckets already
// span the index's shared window, so spikes line up down a column. Height is
// normalized within the strip: it shows each undertaking's own shape. The one
// case that must stay legible is the flat strip — an undertaking written down
// and never worked on — so an all-zero strip renders a faint baseline rather
// than nothing.

interface Props {
  buckets: DensityBucket[]
  /** Total height in px. */
  height?: number
  /** Width per bucket in px. */
  barWidth?: number
  className?: string
}

function humanMinutes(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

export default function DensitySparklineBlock({
  buckets,
  height = 16,
  barWidth = 4,
  className,
}: Props) {
  const gap = 1
  const width = Math.max(1, buckets.length) * barWidth
  const max = buckets.reduce((n, b) => Math.max(n, b.activeDurationMs), 0)
  const total = buckets.reduce((n, b) => n + b.activeDurationMs, 0)

  const title = max === 0
    ? 'No recorded work in this window'
    : `${humanMinutes(total)} of active work across the range`

  return (
    <svg
      className={cn('shrink-0 text-foreground/70', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {max === 0 ? (
        // The signal that exists nowhere else: written down, never worked on.
        <line
          x1={0}
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          stroke="currentColor"
          strokeWidth={1}
          className="text-foreground/15"
        />
      ) : (
        buckets.map((b, i) => {
          const h = b.activeDurationMs === 0 ? 0 : Math.max(1, (b.activeDurationMs / max) * height)
          return (
            <rect
              key={i}
              x={i * barWidth}
              y={height - h}
              width={Math.max(1, barWidth - gap)}
              height={h}
              rx={0.5}
              fill="currentColor"
            />
          )
        })
      )}
    </svg>
  )
}
