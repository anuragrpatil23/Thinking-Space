import { useMemo } from 'react'
import { Area, AreaChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WebullPricePointBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'
import type { PriceBandBlock } from '@/personal_extension/services/lego_blocks/units/priceBandsBlock'
import { F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK, F9_CHART_TOOLTIP_STYLE_BLOCK } from './F9NativeBlock'

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
export function F9PriceChartBlock({ points, range, bands = [], idKey, className = 'min-h-[260px] flex-1' }: {
  points: WebullPricePointBlock[]
  range?: { low: number; high: number } | null
  bands?: PriceBandBlock[]
  /** Unique per chart on the page (the gradient's id) */
  idKey: string
  className?: string
}) {
  const domain = useMemo((): [number, number] | null => {
    if (points.length === 0) return null
    const values = points.map(point => point.price)
    if (range) values.push(range.low, range.high)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min) * 0.06
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)]
  }, [points, range])
  const visibleBands = useMemo(
    () => (domain ? bands.filter(band => band.hi > domain[0] && band.lo < domain[1]) : []),
    [bands, domain],
  )
  if (points.length < 2 || !domain) return null

  return (
    <div className={`${className} text-sky-500`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
          {range && <ReferenceArea y1={range.low} y2={range.high} fill="#34C759" fillOpacity={0.09} />}
          <XAxis dataKey="date" tickFormatter={(value: string) => dateLabelBlock(value).replace(/ \d+,/, '')} minTickGap={56} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
          <YAxis domain={domain} width={48} tick={{ fontSize: 11, fill: '#8E8E93' }} tickFormatter={(value: number) => `$${value}`} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value) => [priceLabelBlock(Number(value)), 'Price']}
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
