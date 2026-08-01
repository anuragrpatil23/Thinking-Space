import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import CursorTooltipBlock from '@/components/lego_blocks/units/CursorTooltipBlock'
import type { DensityBucket } from '@/services/lego_blocks/units/aiActivityDensityBlock'

// One row-height density strip for an undertaking. Bars are active work per
// bucket (not wall-clock — see aiActivityDensityBlock), the buckets already
// span the index's shared window, so spikes line up down a column. Height is
// normalized within the strip: it shows each undertaking's own shape.
//
// The strip reads as a *track* with marks on it rather than bars floating over
// a rule: every bucket gets a faint tick, so an empty stretch is visibly empty
// window rather than absent chart, and the flat strip — an undertaking written
// down and never worked on — is legible as its own state.
//
// Hovering reads out the bucket under the cursor through the app's shared
// cursor tooltip, so the strip answers "when" precisely instead of only in
// outline. The whole strip is one trigger; the bucket is picked from the
// cursor's x, which keeps a 4px-wide bar hoverable.

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

/** `2026-07-14` → `Jul 14, 2026`. Falls back to the raw string if unparseable —
 *  a readable date is nicer, but a wrong one would be worse than the ISO form. */
function formatDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** A bucket's span, collapsed to one date when it covers a single day. */
function bucketRange(b: DensityBucket): string {
  return b.startDate === b.endDate
    ? formatDay(b.startDate)
    : `${formatDay(b.startDate)} – ${formatDay(b.endDate)}`
}

export default function DensitySparklineBlock({
  buckets,
  height = 16,
  barWidth = 4,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)

  const gap = 1
  const width = Math.max(1, buckets.length) * barWidth
  const max = buckets.reduce((n, b) => Math.max(n, b.activeDurationMs), 0)
  const total = buckets.reduce((n, b) => n + b.activeDurationMs, 0)
  const sessions = buckets.reduce((n, b) => n + b.chains, 0)

  const label = max === 0
    ? 'No recorded work in this window'
    : `${humanMinutes(total)} of active work across the range`

  const hoveredBucket = hovered != null ? buckets[hovered] : undefined

  const trackMinHeight = 1.5

  return (
    <CursorTooltipBlock
      instant
      onMove={event => {
        const rect = svgRef.current?.getBoundingClientRect()
        if (!rect || buckets.length === 0) return
        const i = Math.floor(((event.clientX - rect.left) / rect.width) * buckets.length)
        setHovered(Math.min(buckets.length - 1, Math.max(0, i)))
      }}
      content={
        buckets.length === 0 ? null : hoveredBucket ? (
          <div className="whitespace-nowrap">
            <div className="font-medium">{bucketRange(hoveredBucket)}</div>
            <div className="mt-0.5 text-[11px] text-zinc-400">
              {hoveredBucket.activeDurationMs > 0 ? (
                <>
                  {humanMinutes(hoveredBucket.activeDurationMs)} active
                  <span className="px-1 text-zinc-600">·</span>
                  {hoveredBucket.chains} session{hoveredBucket.chains === 1 ? '' : 's'}
                </>
              ) : (
                'No work in this slice'
              )}
            </div>
            <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[10.5px] text-zinc-500">
              {max === 0
                ? 'Nothing recorded across the whole range'
                : `${humanMinutes(total)} total · ${sessions} session${sessions === 1 ? '' : 's'} across the range`}
            </div>
          </div>
        ) : null
      }
    >
      <svg
        ref={svgRef}
        className={cn('shrink-0 text-foreground/70', className)}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        onMouseLeave={() => setHovered(null)}
      >
        <title>{label}</title>
        {buckets.map((b, i) => {
          // Every bucket draws something. A worked bucket is a bar scaled to
          // the strip's own max; an empty one is a floor tick — the track that
          // makes a lone spike read as a spike in a window rather than a stray
          // mark, and that makes the all-zero strip its own legible state.
          const h = b.activeDurationMs === 0 || max === 0
            ? trackMinHeight
            : Math.max(2, (b.activeDurationMs / max) * height)
          const empty = b.activeDurationMs === 0 || max === 0
          return (
            <rect
              key={i}
              x={i * barWidth}
              y={height - h}
              width={Math.max(1, barWidth - gap)}
              height={h}
              rx={Math.min(1, (barWidth - gap) / 2)}
              fill="currentColor"
              className={cn(
                'transition-opacity',
                empty ? 'opacity-[0.18]' : 'opacity-90',
                // The hovered bucket lifts and its neighbours recede, so the
                // tooltip's date is unambiguously about one mark.
                hovered != null && (hovered === i ? 'opacity-100' : empty ? 'opacity-[0.12]' : 'opacity-40'),
              )}
            />
          )
        })}
      </svg>
    </CursorTooltipBlock>
  )
}
