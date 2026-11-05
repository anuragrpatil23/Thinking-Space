import { useMemo } from 'react'
import { Area, AreaChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WebullPricePointBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'
import type { PriceBandBlock } from '@/personal_extension/services/lego_blocks/units/priceBandsBlock'
import { F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK, F9_CHART_TOOLTIP_STYLE_BLOCK } from './F9NativeBlock'

/** A price band that holds over a stretch of time: from a day, until a day (or the chart's end). */
export interface TimedPriceBandBlock {
  id: string
  low: number
  high: number
  from: string
  until: string | null
  label: string
}

/** Weekly empty dates after the last price, so a band ending in the future has room on the axis. */
function extendToBlock(points: WebullPricePointBlock[], until: string | null): Array<{ date: string; price?: number }> {
  if (!until || points.length === 0) return points
  const last = points[points.length - 1].date.slice(0, 10)
  if (until <= last) return points
  const out: Array<{ date: string; price?: number }> = [...points]
  const cursor = new Date(`${last}T12:00:00Z`)
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 7)
    const iso = cursor.toISOString().slice(0, 10)
    if (iso >= until) break
    out.push({ date: iso })
  }
  out.push({ date: until })
  return out
}

/** The first axis date on or after `iso`, else the last one. */
function snapDateBlock(dates: string[], iso: string): string {
  return dates.find(date => date.slice(0, 10) >= iso) ?? dates[dates.length - 1]
}

function priceLabelBlock(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateLabelBlock(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * A company's price line (prices.csv), with the study's current range as a
 * green strip and the hand-drawn bands (bands.yaml) as labelled strips:
 * settled ones shaded, forming ones fainter with a dashed edge. Bands outside
 * the prices shown are left out rather than stretching the scale.
 */
export function F9PriceChartBlock({ points, range, bands = [], timedBands = [], idKey, className = 'min-h-[260px] flex-1' }: {
  points: WebullPricePointBlock[]
  range?: { low: number; high: number } | null
  bands?: PriceBandBlock[]
  /** Bands over a stretch of time; the axis runs on to the latest end day. */
  timedBands?: TimedPriceBandBlock[]
  /** Unique per chart on the page (the gradient's id) */
  idKey: string
  className?: string
}) {
  const domain = useMemo((): [number, number] | null => {
    if (points.length === 0) return null
    const values = points.map(point => point.price)
    if (range) values.push(range.low, range.high)
    for (const band of timedBands) values.push(band.low, band.high)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min) * 0.06
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)]
  }, [points, range, timedBands])
  const visibleBands = useMemo(
    () => (domain ? bands.filter(band => band.hi > domain[0] && band.lo < domain[1]) : []),
    [bands, domain],
  )
  const data = useMemo(() => {
    const latest = timedBands.reduce<string | null>((max, t) => (t.until && (!max || t.until > max) ? t.until : max), null)
    return extendToBlock(points, latest)
  }, [points, timedBands])
  const visibleTimedBands = useMemo(() => {
    if (data.length === 0) return []
    const dates = data.map(point => point.date)
    const first = dates[0].slice(0, 10)
    return timedBands
      .filter(t => !t.until || t.until >= first)
      .map(t => ({ ...t, x1: snapDateBlock(dates, t.from < first ? first : t.from), x2: t.until ? snapDateBlock(dates, t.until) : dates[dates.length - 1] }))
  }, [data, timedBands])
  if (points.length < 2 || !domain) return null

  return (
    <div className={`${className} text-sky-500`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`f9-price-fill-${idKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          {visibleBands.map(band => (
            <ReferenceArea
              key={band.id}
              y1={Math.max(band.lo, domain[0])}
              y2={Math.min(band.hi, domain[1])}
              ifOverflow="hidden"
              fill="#8B87E6"
              fillOpacity={band.state === 'settled' ? 0.13 : 0.06}
              stroke="#8B87E6"
              strokeOpacity={band.state === 'settled' ? 0.25 : 0.4}
              strokeDasharray={band.state === 'forming' ? '4 3' : undefined}
              label={{ value: band.id, position: 'insideTopLeft', fontSize: 10, fill: '#8B87E6' }}
            />
          ))}
          {visibleTimedBands.map(t => (
            <ReferenceArea
              key={`timed-${t.id}`}
              x1={t.x1}
              x2={t.x2}
              y1={t.low === t.high ? t.low * 0.995 : t.low}
              y2={t.low === t.high ? t.high * 1.005 : t.high}
              ifOverflow="extendDomain"
              fill="#FF9500"
              fillOpacity={0.14}
              stroke="#FF9500"
              strokeOpacity={0.5}
              label={{ value: t.label, position: 'insideTopRight', fontSize: 10, fill: '#C76E00' }}
            />
          ))}
          {range && <ReferenceArea y1={range.low} y2={range.high} fill="#34C759" fillOpacity={0.09} />}
          <XAxis dataKey="date" tickFormatter={(value: string) => dateLabelBlock(value).replace(/ \d+,/, '')} minTickGap={56} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
          <YAxis domain={domain} width={48} tick={{ fontSize: 11, fill: '#8E8E93' }} tickFormatter={(value: number) => `$${value}`} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value) => [Number.isFinite(Number(value)) ? priceLabelBlock(Number(value)) : '—', 'Price']}
            labelFormatter={(label) => dateLabelBlock(String(label))}
            contentStyle={F9_CHART_TOOLTIP_STYLE_BLOCK}
            labelStyle={F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK}
          />
          <Area type="monotone" dataKey="price" stroke="currentColor" strokeWidth={2} fill={`url(#f9-price-fill-${idKey})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
