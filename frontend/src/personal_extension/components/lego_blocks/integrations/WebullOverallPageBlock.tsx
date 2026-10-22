import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type LabelProps } from 'recharts'
import { useWebullOverallTrackRecordBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullTrackRecordBlock'
import { F9TrackRowBlock, F9TrackShareBlock } from '@/personal_extension/components/lego_blocks/units/F9TrackRecordPartsBlock'
import { f9SignedMoneyKBlock, WEBULL_SHORT_DATED_DAYS_BLOCK, type WebullOverallTrackRecordBlock } from '@/personal_extension/services/lego_blocks/units/webullTrackRecordBlock'
import { F9FactRowBlock, F9PanelBlock, F9SectionLabelBlock, F9SegmentedBlock } from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import { cn } from '@/lib/utils'

// Overall Positions in F9's native layout: the header and allocation in the
// main column beside a Value panel, then the positions table, with accounts and
// the status line in the side panel. The workspace computes every number; this
// block only lays them out.

export interface WebullAllocationSliceBlock {
  key: string
  ticker: string
  kind: 'STOCK' | 'OPTION' | 'CASH' | 'OTHER'
  value: number
  color: string
  fillOpacity: number
  isFirstForTicker: boolean
}

export interface WebullAllocationEntryBlock {
  ticker: string
  color: string
  stock: number
  option: number
  total: number
  /** Percent of allocated cost. */
  share: number
  /** Open P/L as a percent of this business's cost. */
  plPercent: number | null
  /** Open P/L in dollars. */
  pl: number | null
}

export interface WebullOptionExpiryBlock {
  ticker: string
  color: string
  /** YYYY-MM-DD */
  expiry: string
  cost: number
}

export interface WebullOverallValueBlock {
  overallValue: string
  invested: string
  investedShare: number | null
  cash: string
  cashShare: number | null
  /** e.g. "incl. $856.12 JPST" */
  cashNote: string | null
}

interface WebullOverallPageBlockProps {
  executionRoot: string | null
  onOpenFile: (path: string) => void
  accountCount: number
  companyCount: number
  value: WebullOverallValueBlock
  accounts: Array<{ label: string; detail: string }>
  allocation: { slices: WebullAllocationSliceBlock[]; total: number; legend: WebullAllocationEntryBlock[]; optionExpiries: WebullOptionExpiryBlock[] } | null
  formatMoney: (value: number) => string
  formatMoneyK: (value: number) => string
  onSelectTicker: (ticker: string) => void
  positionsActions?: ReactNode
  positionsSlot: ReactNode
  positionCount: number
  footer?: ReactNode
}

type AllocationViewBlock = 'cost' | 'pl' | 'expiry'

const MONTHS_BLOCK = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Open P/L by business, losses to the left of zero and gains to the right,
// best to worst — where the open money is being made and lost.
/** Axis money: $0, $50K, −$1.2M. */
function axisMoneyBlock(value: number): string {
  if (value === 0) return '$0'
  const abs = Math.abs(value)
  const text = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `$${Math.round(abs / 1000)}K` : `$${Math.round(abs)}`
  return `${value < 0 ? '−' : ''}${text}`
}

function OpenPlViewBlock({ legend, formatMoneyK, onSelectTicker }: {
  legend: WebullAllocationEntryBlock[]
  formatMoneyK: (value: number) => string
  onSelectTicker: (ticker: string) => void
}) {
  const all = legend.filter(entry => entry.pl !== null && entry.pl !== 0)
  const max = Math.max(1, ...all.map(entry => Math.abs(entry.pl ?? 0)))
  // Businesses with next to no open P/L would only add slivers and tickers; they're counted, not drawn.
  const threshold = Math.max(500, max * 0.01)
  const rows = all.filter(entry => Math.abs(entry.pl ?? 0) >= threshold).sort((a, b) => (b.pl ?? 0) - (a.pl ?? 0))
  const hidden = all.length - rows.length
  const gains = all.reduce((sum, entry) => sum + Math.max(0, entry.pl ?? 0), 0)
  const losses = all.reduce((sum, entry) => sum + Math.min(0, entry.pl ?? 0), 0)
  const net = gains + losses
  const top = Math.max(0, ...rows.map(entry => entry.pl ?? 0))
  const bottom = Math.min(0, ...rows.map(entry => entry.pl ?? 0))
  const headroom = (top - bottom) * 0.14
  const data = rows.map(entry => ({ ticker: entry.ticker, pl: entry.pl ?? 0 }))
  // Value labels sit just outside each column's end: above a gain, below a loss.
  const renderValueLabel = (props: LabelProps) => {
    const x = Number(props.x ?? 0)
    const y = Number(props.y ?? 0)
    const width = Number(props.width ?? 0)
    const height = Number(props.height ?? 0)
    const value = Number(props.value ?? 0)
    const below = value < 0
    return (
      <text x={x + width / 2} y={below ? y + Math.abs(height) + 12 : y - 6} textAnchor="middle" fontSize={10} fill="#71717A">
        {`${value >= 0 ? '+' : '−'}${formatMoneyK(Math.abs(value))}`}
      </text>
    )
  }
  return (
    <div className="flex flex-1 flex-col">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Open P/L <span className={cn('font-medium', net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>{net >= 0 ? '+' : '−'}{formatMoneyK(Math.abs(net))}</span>
        {' '}· gains <span className="text-emerald-600 dark:text-emerald-400">+{formatMoneyK(gains)}</span>
        {' '}· losses <span className="text-red-600 dark:text-red-400">−{formatMoneyK(Math.abs(losses))}</span>
        {hidden > 0 && <span className="text-zinc-400">{' '}· {hidden} more within ±{formatMoneyK(threshold)}</span>}
      </p>
      {/* One column per business, best to worst: gains up from zero, losses down */}
      <div className="min-h-[240px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 0 }} barCategoryGap="28%">
            <XAxis dataKey="ticker" interval={0} tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} height={22} />
            <YAxis
              width={48}
              domain={[bottom - headroom, top + headroom]}
              tick={{ fontSize: 11, fill: '#A1A1AA' }}
              axisLine={false}
              tickLine={false}
              tickCount={5}
              tickFormatter={(value: number) => axisMoneyBlock(value)}
            />
            <ReferenceLine y={0} stroke="#D4D4D8" />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.1), 0 4px 12px rgba(0,0,0,0.08)' }}
              formatter={(value) => [`${Number(value) >= 0 ? '+' : '−'}${formatMoneyK(Math.abs(Number(value)))}`, 'Open P/L']}
            />
            <Bar
              dataKey="pl"
              maxBarSize={36}
              radius={[3, 3, 3, 3]}
              isAnimationActive={false}
              className="cursor-pointer"
              onClick={(bar) => {
                const ticker = (bar as { ticker?: string } | undefined)?.ticker
                if (ticker) onSelectTicker(ticker)
              }}
            >
              {data.map(entry => <Cell key={entry.ticker} fill={entry.pl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.85} />)}
              <LabelList dataKey="pl" content={renderValueLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// When the money in options has to be right: option cost by expiry month,
// stacked by business, soonest first.
function ExpiryViewBlock({ optionExpiries, total, formatMoneyK, onSelectTicker }: {
  optionExpiries: WebullOptionExpiryBlock[]
  total: number
  formatMoneyK: (value: number) => string
  onSelectTicker: (ticker: string) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  const byMonth = new Map<string, { total: number; earliest: string; parts: Map<string, { color: string; cost: number }> }>()
  for (const option of optionExpiries) {
    const month = option.expiry.slice(0, 7)
    const entry = byMonth.get(month) ?? { total: 0, earliest: option.expiry, parts: new Map() }
    entry.total += option.cost
    if (option.expiry < entry.earliest) entry.earliest = option.expiry
    const part = entry.parts.get(option.ticker) ?? { color: option.color, cost: 0 }
    part.cost += option.cost
    entry.parts.set(option.ticker, part)
    byMonth.set(month, entry)
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
  const optionTotal = optionExpiries.reduce((sum, option) => sum + option.cost, 0)
  const within = (days: number) => optionExpiries.filter(option => daysUntil(option.expiry) <= days).reduce((sum, option) => sum + option.cost, 0)
  const max = Math.max(1, ...months.map(([, entry]) => entry.total))
  const byBusiness = new Map<string, { color: string; cost: number }>()
  for (const option of optionExpiries) {
    const entry = byBusiness.get(option.ticker) ?? { color: option.color, cost: 0 }
    entry.cost += option.cost
    byBusiness.set(option.ticker, entry)
  }
  const businesses = [...byBusiness.entries()].sort((a, b) => b[1].cost - a[1].cost)
  if (months.length === 0) return <p className="py-10 text-center text-sm text-zinc-500">No open options.</p>
  return (
    <div className="flex flex-1 flex-col">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{formatMoneyK(optionTotal)}</span> in options ({Math.round((optionTotal / total) * 100)}% of cost)
        {' '}· {formatMoneyK(within(90))} expires within 90 days · {formatMoneyK(within(365))} within a year
      </p>
      <ol className="max-h-[260px] space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {months.map(([month, entry]) => {
          const [year, monthIndex] = month.split('-')
          const days = daysUntil(entry.earliest)
          const parts = [...entry.parts.entries()].sort((a, b) => b[1].cost - a[1].cost)
          return (
            <li key={month} className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.25rem_4rem] items-center gap-3 px-2 py-1 text-[12px] tabular-nums">
              <span className="font-medium">{MONTHS_BLOCK[Number(monthIndex) - 1]} {year.slice(2)}</span>
              <span className="flex h-2.5 overflow-hidden rounded-full" style={{ width: `${(entry.total / max) * 100}%` }}>
                {parts.map(([ticker, part]) => (
                  <button
                    key={ticker}
                    type="button"
                    onClick={() => onSelectTicker(ticker)}
                    title={`${ticker} · ${formatMoneyK(part.cost)}`}
                    aria-label={`${ticker}, ${formatMoneyK(part.cost)} expiring ${MONTHS_BLOCK[Number(monthIndex) - 1]} ${year}`}
                    className="h-full"
                    style={{ width: `${(part.cost / entry.total) * 100}%`, backgroundColor: part.color }}
                  />
                ))}
              </span>
              <span className="text-right">{formatMoneyK(entry.total)}</span>
              <span className={cn('text-right', days <= 30 ? 'font-medium text-red-600 dark:text-red-400' : days <= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400')}>
                {days < 0 ? 'past' : days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`}
              </span>
            </li>
          )
        })}
      </ol>
      {/* Which colour is which business, with what each has in options */}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-200/70 px-2 pt-3 text-[12px] dark:border-zinc-800">
        {businesses.map(([ticker, entry]) => (
          <button
            key={ticker}
            type="button"
            onClick={() => onSelectTicker(ticker)}
            className="flex items-center gap-1.5 rounded-md tabular-nums text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="font-medium">{ticker}</span>
            <span className="text-zinc-500 dark:text-zinc-400">{formatMoneyK(entry.cost)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function AllocationPanelBlock({ allocation, formatMoney, formatMoneyK, onSelectTicker }: {
  allocation: NonNullable<WebullOverallPageBlockProps['allocation']>
  formatMoney: (value: number) => string
  formatMoneyK: (value: number) => string
  onSelectTicker: (ticker: string) => void
}) {
  const [view, setView] = useState<AllocationViewBlock>('cost')
  return (
    <F9PanelBlock className="flex flex-1 flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold">Allocation</span>
          <span className="text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400" title="Total cost of what is held">{formatMoney(allocation.total)}</span>
        </span>
        <F9SegmentedBlock
          ariaLabel="Allocation view"
          value={view}
          onChange={setView}
          options={[{ value: 'cost', label: 'Cost' }, { value: 'pl', label: 'Open P/L' }, { value: 'expiry', label: 'Expiry' }]}
        />
      </div>
      {view === 'cost' && <CostViewBlock allocation={allocation} formatMoney={formatMoney} formatMoneyK={formatMoneyK} onSelectTicker={onSelectTicker} />}
      {view === 'pl' && <OpenPlViewBlock legend={allocation.legend} formatMoneyK={formatMoneyK} onSelectTicker={onSelectTicker} />}
      {view === 'expiry' && <ExpiryViewBlock optionExpiries={allocation.optionExpiries} total={allocation.total} formatMoneyK={formatMoneyK} onSelectTicker={onSelectTicker} />}
    </F9PanelBlock>
  )
}

// What the money is in: the donut by cost basis beside the ranked list.
function CostViewBlock({ allocation, formatMoney, formatMoneyK, onSelectTicker }: {
  allocation: NonNullable<WebullOverallPageBlockProps['allocation']>
  formatMoney: (value: number) => string
  formatMoneyK: (value: number) => string
  onSelectTicker: (ticker: string) => void
}) {
  const { slices, total, legend } = allocation
  // The list fills the panel's height; trim it to whole rows so none sits cut in half.
  const listRef = useRef<HTMLOListElement>(null)
  const [listHeight, setListHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    const frame = list?.parentElement
    if (!list || !frame) return
    const fit = () => {
      const row = list.firstElementChild?.getBoundingClientRect().height ?? 0
      const available = frame.getBoundingClientRect().height
      setListHeight(row > 0 && available > 0 ? Math.floor(available / row) * row : null)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [legend.length])
  // Each business's option cost split by time left, against the report's
  // 120-day line: short-dated (≤ 120 days) vs longer-dated, by today's date.
  const today = new Date().toISOString().slice(0, 10)
  const horizonByTicker = new Map<string, { shortDated: number; longerDated: number }>()
  for (const option of allocation.optionExpiries) {
    const days = Math.round((Date.parse(`${option.expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    const entry = horizonByTicker.get(option.ticker) ?? { shortDated: 0, longerDated: 0 }
    if (days <= WEBULL_SHORT_DATED_DAYS_BLOCK) entry.shortDated += option.cost
    else entry.longerDated += option.cost
    horizonByTicker.set(option.ticker, entry)
  }
  const sharesTotal = legend.reduce((sum, entry) => sum + entry.stock, 0)
  const optionsTotal = legend.reduce((sum, entry) => sum + entry.option, 0)
  const knownLonger = [...horizonByTicker.values()].reduce((sum, value) => sum + value.longerDated, 0)
  const knownShorter = [...horizonByTicker.values()].reduce((sum, value) => sum + value.shortDated, 0)
  // Scaled to the option cost the totals use, in case a leg had no readable expiry.
  const horizonScale = knownLonger + knownShorter > 0 ? optionsTotal / (knownLonger + knownShorter) : 0
  const summary = [
    { label: 'Shares', value: sharesTotal, opacity: 1 },
    { label: `Options > ${WEBULL_SHORT_DATED_DAYS_BLOCK} days`, value: knownLonger * horizonScale, opacity: 0.55 },
    { label: `Options ≤ ${WEBULL_SHORT_DATED_DAYS_BLOCK} days`, value: knownShorter * horizonScale, opacity: 0.22 },
  ]
  const largest = legend[0]?.share ?? 0
  const shareByTicker = new Map(legend.map(entry => [entry.ticker, entry.share]))
  // Concentration, not count: the fewest top businesses holding 90% of cost.
  const concentration = (() => {
    let cumulative = 0
    for (let index = 0; index < legend.length; index += 1) {
      cumulative += legend[index].share
      if (cumulative >= 90) return index + 1
    }
    return legend.length
  })()
  // Ticker and share beside each slice big enough to label (≥ 2.5%), in the slice's colour.
  const renderSliceLabel = (props: { cx?: number; cy?: number; midAngle?: number; outerRadius?: number; payload?: WebullAllocationSliceBlock }) => {
    const { cx, cy, midAngle, outerRadius, payload } = props
    if (cx === undefined || cy === undefined || midAngle === undefined || outerRadius === undefined || !payload || !payload.isFirstForTicker) return null
    const share = shareByTicker.get(payload.ticker) ?? 0
    if (share < 2.5) return null
    const radians = (-midAngle * Math.PI) / 180
    const x = cx + (outerRadius + 14) * Math.cos(radians)
    const y = cy + (outerRadius + 14) * Math.sin(radians)
    const anchor = Math.cos(radians) >= 0 ? 'start' : 'end'
    return (
      <g>
        <text x={x} y={y - 6} textAnchor={anchor} dominantBaseline="central" fontSize={11} fontWeight={600} fill={payload.color}>{payload.ticker}</text>
        <text x={x} y={y + 7} textAnchor={anchor} dominantBaseline="central" fontSize={10} fill="#8E8E93">{share.toFixed(1)}%</text>
      </g>
    )
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-5 md:flex-row md:items-stretch md:justify-center md:gap-12">
        <div className="relative mx-auto h-[260px] w-[320px] shrink-0 md:mx-0 md:self-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="key"
                innerRadius={66}
                outerRadius={100}
                label={renderSliceLabel}
                labelLine={false}
                paddingAngle={0}
                stroke="#ffffff"
                strokeWidth={1}
                isAnimationActive={false}
                onClick={(slice) => {
                  const ticker = (slice as { ticker?: string } | undefined)?.ticker
                  if (ticker) onSelectTicker(ticker)
                }}
              >
                {slices.map(slice => (
                  <Cell key={slice.key} fill={slice.color} fillOpacity={slice.fillOpacity} className="cursor-pointer outline-none" />
                ))}
              </Pie>
              <Tooltip
                cursor={false}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value, _name, item) => {
                  const numeric = typeof value === 'number' ? value : Number(value)
                  const share = total > 0 ? (numeric / total) * 100 : 0
                  const payload = (item as { payload?: WebullAllocationSliceBlock } | undefined)?.payload
                  return [`${formatMoney(numeric)} (${share.toFixed(1)}%)`, payload ? `${payload.ticker} · ${payload.kind.toLowerCase()}` : '']
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">90% of cost in</span>
            <span className="text-[15px] font-semibold tabular-nums">{concentration} {concentration === 1 ? 'business' : 'businesses'}</span>
            <span className="text-[11px] text-zinc-400">of {legend.length}</span>
          </div>
        </div>

        {/* The list fills the panel's height (set by the side column) and scrolls inside it,
            rather than leaving the panel half empty or stretching it. */}
        <div className="relative min-w-0 md:max-w-[34rem] md:flex-1">
        <ol ref={listRef} style={listHeight ? { height: listHeight } : undefined} className="max-h-[260px] overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin] md:absolute md:inset-x-0 md:top-0 md:max-h-none">
          {legend.map(entry => (
            <li key={entry.ticker}>
              <button
                type="button"
                onClick={() => onSelectTicker(entry.ticker)}
                className="ltm-motion-fast grid w-full grid-cols-[4.5rem_minmax(4rem,12rem)_3.25rem_4rem_4rem] items-center gap-3 rounded-md px-2 py-1.5 text-left text-[12px] tabular-nums transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                title={entry.option > 0 ? (entry.stock > 0 ? 'Stock and options' : 'Options only') : 'Stock'}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="truncate font-medium">{entry.ticker}</span>
                </span>
                {/* Stock part solid, options part lighter, against the largest holding */}
                <span className="flex h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span style={{ width: `${largest > 0 ? (entry.stock / entry.total) * (entry.share / largest) * 100 : 0}%`, backgroundColor: entry.color }} />
                  <span style={{ width: `${largest > 0 ? (entry.option / entry.total) * (entry.share / largest) * 100 : 0}%`, backgroundColor: entry.color, opacity: 0.45 }} />
                </span>
                <span className="text-right text-zinc-500 dark:text-zinc-400">{entry.share.toFixed(1)}%</span>
                <span className="text-right">{formatMoneyK(entry.total)}</span>
                <span className={cn(
                  'text-right',
                  entry.plPercent === null ? 'text-zinc-400' : entry.plPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                )}>
                  {entry.plPercent === null ? '—' : `${entry.plPercent >= 0 ? '+' : ''}${entry.plPercent.toFixed(1)}%`}
                </span>
              </button>
            </li>
          ))}
        </ol>
        </div>
        {/* What kind of money the allocation is: shares, and options by time left */}
        <dl className="w-full shrink-0 space-y-3 border-zinc-200/80 text-[12px] md:w-[12.5rem] md:self-center md:border-l md:pl-6 dark:border-zinc-800">
          {summary.map(item => (
            <div key={item.label}>
              <dt className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                <span className="h-2 w-3 rounded-sm bg-zinc-600 dark:bg-zinc-300" style={{ opacity: item.opacity }} />
                {item.label}
              </dt>
              <dd className="mt-0.5 flex items-baseline justify-between tabular-nums">
                <span className="text-[15px] font-semibold">{formatMoneyK(item.value)}</span>
                <span className="text-zinc-500 dark:text-zinc-400">{total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : '—'}</span>
              </dd>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-full rounded-full bg-zinc-600 dark:bg-zinc-300" style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%`, opacity: item.opacity }} />
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}


const TRACK_SHORT_COLOR_BLOCK = '#f59e0b'
const TRACK_LONG_COLOR_BLOCK = '#0A84FF'

// How every option purchase and share has actually turned out, from the Webull
// statements: short- and longer-dated side by side, and by year bought.
/** Whole-K chart money: +$531K, −$240K, $0, +$1.1M. */
function chartMoneyKBlock(value: number, signed: boolean): string {
  const abs = Math.abs(value)
  const text = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `$${Math.round(abs / 1000)}K` : `$${Math.round(abs)}`
  if (value < 0) return `−${text}`
  return signed && value > 0 ? `+${text}` : text
}

function TrackBusinessListBlock({ title, entries, total, onSelectTicker }: {
  title: string
  entries: Array<{ ticker: string; net: number }>
  total: number
  onSelectTicker: (ticker: string) => void
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">{title}</p>
      <ol>
        {entries.map(entry => (
          <li key={entry.ticker}>
            <button
              type="button"
              onClick={() => onSelectTicker(entry.ticker)}
              className="ltm-motion-fast flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[12px] tabular-nums transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <span className="font-medium">{entry.ticker}</span>
              <span className="flex items-baseline gap-2">
                {total > 0 && <span className="text-[11px] text-zinc-400">{Math.round((entry.net / total) * 100)}%</span>}
                <span className={entry.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{f9SignedMoneyKBlock(entry.net)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function TrackRecordSectionBlock({ record, reportPath, onOpenFile, onSelectTicker }: {
  record: WebullOverallTrackRecordBlock
  reportPath: string | null
  onOpenFile: (path: string) => void
  onSelectTicker: (ticker: string) => void
}) {
  // Room under the lowest and above the highest bar so value labels clear the axis.
  const values = record.byYear.flatMap(year => [year.shortDated, year.longerDated])
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  // Round ticks (multiples of a 1/2/2.5/5 step) with headroom so value labels clear the axis.
  const rawStep = (high - low) / 4 || 1
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = ([1, 2, 2.5, 5, 10].find(m => m * magnitude >= rawStep) ?? 10) * magnitude
  // Loss labels hang below the plot into the axis margin, so no extra step below.
  const domainLow = low < 0 ? Math.floor(low / step) * step : 0
  const domainHigh = Math.ceil((high + step * 0.3) / step) * step
  const ticks: number[] = []
  for (let tick = domainLow; tick <= domainHigh + step / 2; tick += step) ticks.push(tick)
  // Everything the record adds up to: options of both kinds plus shares.
  const grandTotal = (record.shortDated?.net ?? 0) + (record.longerDated?.net ?? 0) + record.stockNet
  const ranked = [...record.byTicker].sort((a, b) => b.net - a.net)
  const best = ranked.filter(entry => entry.net > 0).slice(0, 3)
  const worst = ranked.filter(entry => entry.net < 0).slice(-3).reverse()
  // Gains labelled above their bar, losses below theirs.
  const renderYearLabel = (props: LabelProps) => {
    const x = Number(props.x ?? 0)
    const y = Number(props.y ?? 0)
    const width = Number(props.width ?? 0)
    const height = Number(props.height ?? 0)
    const value = Number(props.value ?? 0)
    if (!value) return null
    const below = value < 0
    const bottom = height >= 0 ? y + height : y
    const top = height >= 0 ? y : y + height
    return (
      <text x={x + width / 2} y={below ? bottom + 12 : top - 5} textAnchor="middle" fontSize={10} fill="#71717A">
        {chartMoneyKBlock(value, true)}
      </text>
    )
  }
  const through = new Date(`${record.throughStatement}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <section className="min-w-0 lg:col-span-2">
      <F9SectionLabelBlock
        trailing={(
          <span className="flex items-center gap-3 text-xs">
            <span className="text-zinc-400" title="From the Webull statements; re-run webull_statements_to_csv.py for newer ones">through {through}</span>
            {reportPath && (
              <button type="button" onClick={() => onOpenFile(reportPath)} className="text-sky-600 hover:text-sky-700 dark:text-sky-400">Full history ›</button>
            )}
          </span>
        )}
      >
        Track record
      </F9SectionLabelBlock>
      <F9PanelBlock className="grid gap-6 p-5 text-[13px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-0">
        <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
          <div className="flex items-baseline justify-between gap-3 pb-2">
            <span className="font-semibold">Total</span>
            <span className={cn('font-semibold tabular-nums', grandTotal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>{f9SignedMoneyKBlock(grandTotal)}</span>
          </div>
          {record.shortDated && <F9TrackRowBlock label="Short-dated options" summary={record.shortDated} total={grandTotal} />}
          {record.longerDated && <F9TrackRowBlock label="Longer-dated options" summary={record.longerDated} total={grandTotal} />}
          <div className="py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500 dark:text-zinc-400">Shares</span>
              <span>
                <span className={cn('block text-right font-medium tabular-nums', record.stockNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  {f9SignedMoneyKBlock(record.stockNet)}
                </span>
                <F9TrackShareBlock net={record.stockNet} total={grandTotal} />
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">sold + still held − bought, across {record.stockCompanies} companies</p>
          </div>
          {(best.length > 0 || worst.length > 0) && (
            <div className="grid grid-cols-2 gap-4 pt-3">
              <TrackBusinessListBlock title="Made the most" entries={best} total={grandTotal} onSelectTicker={onSelectTicker} />
              <TrackBusinessListBlock title="Lost the most" entries={worst} total={grandTotal} onSelectTicker={onSelectTicker} />
            </div>
          )}
        </div>
        {/* A hairline and room between the figures and the chart; the chart fills the column's height. */}
        <div className="flex min-w-0 flex-col lg:ml-8 lg:border-l-[0.5px] lg:border-[#E5E5EA] lg:pl-8 dark:lg:border-zinc-800">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">Net by year bought</span>
            <span className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: TRACK_SHORT_COLOR_BLOCK }} />Short-dated</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: TRACK_LONG_COLOR_BLOCK }} />Longer-dated</span>
            </span>
          </div>
          <div className="h-[220px] lg:h-auto lg:min-h-[220px] lg:flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={record.byYear} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barGap={4}>
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} tickMargin={18} height={36} />
                <YAxis width={52} domain={[domainLow, domainHigh]} ticks={ticks} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} tickFormatter={(value: number) => chartMoneyKBlock(value, false)} />
                <ReferenceLine y={0} stroke="#D4D4D8" />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value, name) => [f9SignedMoneyKBlock(Number(value)), name === 'shortDated' ? 'Short-dated' : 'Longer-dated']}
                />
                <Bar dataKey="shortDated" fill={TRACK_SHORT_COLOR_BLOCK} radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  <LabelList dataKey="shortDated" content={renderYearLabel} />
                </Bar>
                <Bar dataKey="longerDated" fill={TRACK_LONG_COLOR_BLOCK} radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  <LabelList dataKey="longerDated" content={renderYearLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </F9PanelBlock>
    </section>
  )
}

export default function WebullOverallPageBlock({
  executionRoot,
  onOpenFile,
  accountCount,
  companyCount,
  value,
  accounts,
  allocation,
  formatMoney,
  formatMoneyK,
  onSelectTicker,
  positionsActions,
  positionsSlot,
  positionCount,
  footer,
}: WebullOverallPageBlockProps) {
  const { record: trackRecord, reportPath } = useWebullOverallTrackRecordBlock(executionRoot)
  const subline = [
    `${accountCount || '—'} ${accountCount === 1 ? 'account' : 'accounts'}`,
    companyCount > 0 ? `${companyCount} ${companyCount === 1 ? 'company' : 'companies'} indexed` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="grid gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(290px,340px)]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">Overall Positions</h1>
            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{subline}</p>
          </div>
          {footer}
        </header>
        {allocation
          ? <AllocationPanelBlock allocation={allocation} formatMoney={formatMoney} formatMoneyK={formatMoneyK} onSelectTicker={onSelectTicker} />
          : <F9PanelBlock className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">No allocation yet: nothing held at cost.</F9PanelBlock>}
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
        <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
          <p className="font-semibold">Value</p>
          <p className="mt-2.5 text-2xl font-semibold tabular-nums">{value.overallValue}</p>
          <p className="mb-1.5 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Overall value · across {accountCount || '—'} {accountCount === 1 ? 'account' : 'accounts'}</p>
          <F9FactRowBlock divided label="Invested" value={value.invested} sub={value.investedShare !== null ? `${value.investedShare.toFixed(1)}% of value` : undefined} />
          <F9FactRowBlock
            label="Cash & equivalents"
            value={value.cash}
            sub={[value.cashShare !== null ? `${value.cashShare.toFixed(1)}% of value` : null, value.cashNote].filter(Boolean).join(' · ') || undefined}
          />
          {allocation && <F9FactRowBlock divided label="Allocated at cost" value={formatMoney(allocation.total)} sub={`${allocation.legend.length} businesses`} />}
        </F9PanelBlock>
        {accounts.length > 0 && (
          <F9PanelBlock className="px-4 py-3.5 text-[13px]">
            <p className="mb-1 font-semibold">Accounts</p>
            {accounts.map((account, index) => (
              <F9FactRowBlock key={`${account.label}-${index}`} divided={index > 0} label={account.label} value={<span className="text-xs font-normal">{account.detail}</span>} />
            ))}
          </F9PanelBlock>
        )}
      </div>

      {trackRecord && <TrackRecordSectionBlock record={trackRecord} reportPath={reportPath} onOpenFile={onOpenFile} onSelectTicker={onSelectTicker} />}

      <section className="min-w-0 lg:col-span-2">
        <F9SectionLabelBlock trailing={positionsActions}>Positions · {positionCount}</F9SectionLabelBlock>
        {positionsSlot}
      </section>
    </div>
  )
}
