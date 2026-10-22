import { cn } from '@/lib/utils'
import { f9SignedMoneyKBlock, type WebullTrackSummaryBlock } from '@/personal_extension/services/lego_blocks/units/webullTrackRecordBlock'

// Small parts for showing a track record (company page and Overall): signed
// money, a running-total sparkline, and one summary row.

/** The month-by-month running total as a tiny line, with the zero line for reference. */
export function F9TrackSparklineBlock({ running }: { running: WebullTrackSummaryBlock['running'] }) {
  if (running.length < 2) return null
  const values = running.map(point => point.total)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const width = 72
  const height = 20
  const x = (index: number) => (index / (running.length - 1)) * width
  const y = (value: number) => height - ((value - min) / span) * height
  const last = values[values.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" className="shrink-0 overflow-visible">
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="2 2" />
      <polyline
        points={values.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
        fill="none"
        stroke={last >= 0 ? '#059669' : '#dc2626'}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function F9TrackRowBlock({ label, summary }: { label: string; summary: WebullTrackSummaryBlock }) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="flex items-center gap-2">
          <F9TrackSparklineBlock running={summary.running} />
          <span className={cn('font-medium tabular-nums', summary.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
            {f9SignedMoneyKBlock(summary.net)}
          </span>
        </span>
      </div>
      <p className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        {summary.purchases} {summary.purchases === 1 ? 'purchase' : 'purchases'} · {Math.round(summary.madeMoney * 100)}% made money · {Math.round(summary.expiredAtZero * 100)}% expired at zero
      </p>
    </div>
  )
}
