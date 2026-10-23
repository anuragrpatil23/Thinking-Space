import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Area, AreaChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import TickerLogoBlock from '@/personal_extension/components/lego_blocks/units/TickerLogoBlock'
import { useWebullCompanyDossierBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullCompanyDossierBlock'
import { useValueLineCompanyBlock } from '@/personal_extension/components/lego_blocks/hooks/useValueLineCompanyBlock'
import { useWebullTrackRecordBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullTrackRecordBlock'
import { f9SignedMoneyKBlock, type WebullCompanyTrackRecordBlock } from '@/personal_extension/services/lego_blocks/units/webullTrackRecordBlock'
import { F9TrackRowBlock } from '@/personal_extension/components/lego_blocks/units/F9TrackRecordPartsBlock'
import {
  F9FactRowBlock,
  F9PanelBlock,
  F9SectionLabelBlock,
  F9SegmentedBlock,
  F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK,
  F9_CHART_TOOLTIP_STYLE_BLOCK,
} from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import { PrivateCompanyGapsBlock, PrivateCompanyNoticedBlock } from '@/personal_extension/components/lego_blocks/units/privateGapsBlock'
import { valueLineDueBlock, valueLineIssueLabelBlock, type WebullResearchFileBlock, type WebullResearchGroupBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'
import { cn } from '@/lib/utils'

const OBSERVATION_PREVIEW_BLOCK = 1

type PriceWindowBlock = '1m' | '1y' | '2y' | 'all'
const PRICE_WINDOW_DAYS_BLOCK: Record<PriceWindowBlock, number> = { '1m': 31, '1y': 365, '2y': 730, all: Number.POSITIVE_INFINITY }

/** The holding numbers, already formatted by the workspace that owns them. */
export interface WebullCompanyHoldingBlock {
  totalCost: string
  portfolioShare: string
  stockCost: string
  stockShare: string
  optionCost: string
  optionShare: string
  pl: string
  plReturn: string
  stockPl: string
  stockPlReturn: string
  optionPl: string
  optionPlReturn: string
  plTone: 'up' | 'down' | null
  stockPlTone: 'up' | 'down' | null
  optionPlTone: 'up' | 'down' | null
}

interface WebullCompanyPageBlockProps {
  ticker: string
  companyName: string | null
  executionRoot: string | null
  /** Share of portfolio cost basis; null when the company is watch-only. */
  costShare: number | null
  /** Last Webull price for the stock; falls back to prices.csv. */
  livePrice: number | null
  holding: WebullCompanyHoldingBlock | null
  positionCount: number
  /** The positions table and its controls, owned by the workspace; none for a company you don't hold. */
  positionsSlot?: ReactNode
  positionsActions?: ReactNode
  /** The quiet status line under the side panel: sync time, warnings, tags, diagnostics. */
  footer?: ReactNode
  onOpenFile: (path: string) => void
}

function formatPriceBlock(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDateBlock(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Research lives in the side panel: ValueLine opens the newest report (older
// ones fold out below it), and each research folder folds out its files. On
// the desktop the newest report is fetched from the library on open.
function ResearchPanelBlock({ reports, groups, valueLine, onOpenFile }: {
  reports: WebullResearchFileBlock[]
  groups: WebullResearchGroupBlock[]
  valueLine: { checking: boolean; notCovered: boolean }
  onOpenFile: (path: string) => void
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const toggle = (label: string) => setOpenGroup(prev => (prev === label ? null : label))
  const rows: Array<{ label: string; files: WebullResearchFileBlock[]; isReport: boolean }> = [
    ...(reports.length > 0 ? [{ label: 'Value Line', files: reports, isReport: true }] : []),
    ...groups.map(group => ({ label: group.label, files: group.files, isReport: false })),
  ]
  const valueLineNote = reports.length > 0 ? null : valueLine.checking ? 'Fetching…' : valueLine.notCovered ? 'Not covered' : null
  return (
    <F9PanelBlock id="webull-company-research" className="scroll-mt-4 overflow-hidden">
      {valueLineNote && (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200/70 px-4 py-2.5 text-[13px] last:border-b-0 dark:border-zinc-800">
          <span>Value Line</span>
          <span className="text-zinc-500 dark:text-zinc-400" title={valueLine.notCovered ? 'Value Line has no report for this ticker' : 'From the library'}>{valueLineNote}</span>
        </div>
      )}
      {rows.map(row => {
        const expanded = openGroup === row.label
        const single = row.isReport && row.files.length === 1
        return (
          <div key={row.label} className="border-b border-zinc-200/70 last:border-b-0 dark:border-zinc-800">
            <button
              type="button"
              aria-expanded={single ? undefined : expanded}
              onClick={() => (single ? onOpenFile(row.files[0].path) : toggle(row.label))}
              className="ltm-motion-fast flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <span className="truncate">{row.label}</span>
              <span className="flex shrink-0 items-center gap-1 text-zinc-500 dark:text-zinc-400">
                {row.isReport
                  ? (
                    <>
                      {valueLineDueBlock(row.files[0], new Date()) && <span className="text-[11px] text-amber-700 dark:text-amber-400" title="Older than one review cycle (about 13 weeks)">due ·</span>}
                      {valueLineIssueLabelBlock(row.files[0])}
                    </>
                  )
                  : row.files.length}
                <ChevronRight className={cn('h-3.5 w-3.5 opacity-60 transition-transform', expanded && 'rotate-90')} />
              </span>
            </button>
            {expanded && (
              <ul className="pb-1.5">
                {row.files.map(file => (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => onOpenFile(file.path)}
                      className="block w-full truncate px-4 py-1.5 pl-7 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                    >
                      {row.isReport ? valueLineIssueLabelBlock(file) : file.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </F9PanelBlock>
  )
}

// How this company's trades have actually turned out, from the Webull
// statements: short- and longer-dated options counted purchase by purchase,
// and shares as dollars in and out.
function TrackRecordPanelBlock({ record, reportPath, onOpenFile }: {
  record: WebullCompanyTrackRecordBlock
  reportPath: string | null
  onOpenFile: (path: string) => void
}) {
  const through = new Date(`${record.throughStatement}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <F9PanelBlock className="px-4 py-3.5 text-[13px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">Track record</span>
        <span className="text-xs text-zinc-400" title="From the Webull statements; re-run webull_statements_to_csv.py for newer ones">through {through}</span>
      </div>
      <div className="mt-1 divide-y divide-zinc-200/70 dark:divide-zinc-800">
        {record.shortDated && <F9TrackRowBlock label="Short-dated options" summary={record.shortDated} />}
        {record.longerDated && <F9TrackRowBlock label="Longer-dated options" summary={record.longerDated} />}
        {record.stock && (
          <div className="py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500 dark:text-zinc-400">Shares</span>
              <span className={cn('font-medium tabular-nums', record.stock.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {f9SignedMoneyKBlock(record.stock.net)}
              </span>
            </div>
            <p className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              bought ${Math.round(record.stock.bought).toLocaleString('en-US')} · sold ${Math.round(record.stock.sold).toLocaleString('en-US')} · held ${Math.round(record.stock.held).toLocaleString('en-US')}
            </p>
          </div>
        )}
      </div>
      {reportPath && (
        <button type="button" onClick={() => onOpenFile(reportPath)} className="mt-1.5 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400">
          Full history ›
        </button>
      )}
    </F9PanelBlock>
  )
}

export default function WebullCompanyPageBlock({
  ticker,
  companyName,
  executionRoot,
  costShare,
  livePrice,
  holding,
  positionCount,
  positionsSlot,
  positionsActions,
  footer,
  onOpenFile,
}: WebullCompanyPageBlockProps) {
  const valueLine = useValueLineCompanyBlock(executionRoot, ticker)
  const { dossier, loading, error } = useWebullCompanyDossierBlock(executionRoot, ticker, companyName, valueLine.fetchedCount)
  const { record: trackRecord, reportPath } = useWebullTrackRecordBlock(executionRoot, ticker)
  const [priceWindow, setPriceWindow] = useState<PriceWindowBlock>('2y')
  const [observationsExpanded, setObservationsExpanded] = useState(false)

  const study = dossier?.study ?? null
  const range = study?.currentRange ?? null
  const prices = useMemo(() => dossier?.prices ?? [], [dossier?.prices])
  const lastClose = prices.length > 0 ? prices[prices.length - 1] : null
  const price = livePrice ?? lastClose?.price ?? null
  const mid = range ? (range.low + range.high) / 2 : null
  const fromMid = price !== null && mid ? price - mid : null
  const rangeState = price !== null && range
    ? (price < range.low ? 'Below range' : price > range.high ? 'Above range' : 'In range')
    : null
  const rangePosition = price !== null && range && range.high > range.low
    ? Math.min(1, Math.max(0, (price - range.low) / (range.high - range.low)))
    : null
  const validThroughPassed = study?.validThrough ? study.validThrough < new Date().toISOString().slice(0, 10) : false
  const displayName = dossier?.companyName ?? study?.company ?? companyName ?? null

  const chartPoints = useMemo(() => {
    const days = PRICE_WINDOW_DAYS_BLOCK[priceWindow]
    if (!Number.isFinite(days)) return prices
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    return prices.filter(point => point.date >= cutoff)
  }, [priceWindow, prices])
  const chartDomain = useMemo((): [number, number] | null => {
    if (chartPoints.length === 0) return null
    const values = chartPoints.map(point => point.price)
    if (range) values.push(range.low, range.high)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min) * 0.06
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)]
  }, [chartPoints, range])

  const reports = dossier?.valueLineReports ?? []
  const observations = dossier?.observations ?? []
  const visibleObservations = observationsExpanded ? observations : observations.slice(0, OBSERVATION_PREVIEW_BLOCK)
  const sublineParts = [
    ticker ? displayName : null,
    costShare !== null ? `Held · ${(costShare * 100).toFixed(costShare >= 0.1 ? 0 : 1)}% of cost` : dossier && !study ? 'Not studied yet' : 'Watchlist',
    rangeState,
  ].filter(Boolean)

  return (
    <div className="grid gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(290px,340px)]">
      <div className="flex min-w-0 flex-col gap-5">
      <header id="webull-company-overview" className="scroll-mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {executionRoot && ticker && <TickerLogoBlock ticker={ticker} executionRoot={executionRoot} className="h-11 w-11 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]" />}
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">{ticker || displayName}</h1>
            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{sublineParts.join(' · ')}</p>
          </div>
        </div>
        {(price !== null || footer) && (
          <div className="flex flex-col items-end text-right tabular-nums">
            {footer && <div className="mb-1.5">{footer}</div>}
            {price !== null && (<>
            <p className="text-[26px] font-semibold leading-tight">{formatPriceBlock(price)}</p>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {fromMid !== null && mid ? (
                <span className={cn(fromMid >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  {fromMid >= 0 ? '+' : '−'}{Math.abs((fromMid / mid) * 100).toFixed(1)}% · {fromMid >= 0 ? '+' : '−'}{formatPriceBlock(Math.abs(fromMid))} from range mid
                </span>
              ) : null}
              {livePrice === null && lastClose && <span className="ml-1.5">as of {formatDateBlock(lastClose.date)}</span>}
            </p>
            </>)}
          </div>
        )}
      </header>

      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {loading && !dossier && <div className="h-1 w-full animate-pulse rounded-full bg-gradient-to-r from-transparent via-primary/40 to-transparent" />}

      <F9PanelBlock className="flex flex-1 flex-col p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">Price</span>
          <F9SegmentedBlock
            ariaLabel="Price window"
            value={priceWindow}
            onChange={setPriceWindow}
            options={[{ value: '1m', label: '1M' }, { value: '1y', label: '1Y' }, { value: '2y', label: '2Y' }, { value: 'all', label: 'All' }]}
          />
        </div>
        {chartPoints.length > 1 && chartDomain ? (
          <div className="min-h-[260px] flex-1 text-sky-500">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartPoints} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`webull-price-fill-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {range && <ReferenceArea y1={range.low} y2={range.high} fill="#34C759" fillOpacity={0.09} />}
                <XAxis dataKey="date" tickFormatter={(value: string) => formatDateBlock(value).replace(/ \d+,/, '')} minTickGap={56} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
                <YAxis domain={chartDomain} width={48} tick={{ fontSize: 11, fill: '#8E8E93' }} tickFormatter={(value: number) => `$${value}`} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value) => [formatPriceBlock(Number(value)), 'Price']}
                  labelFormatter={(label) => formatDateBlock(String(label))}
                  contentStyle={F9_CHART_TOOLTIP_STYLE_BLOCK}
                  labelStyle={F9_CHART_TOOLTIP_LABEL_STYLE_BLOCK}
                />
                <Area type="monotone" dataKey="price" stroke="currentColor" strokeWidth={2} fill={`url(#webull-price-fill-${ticker})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-zinc-500">{dossier ? 'No price history (prices.csv) for this company.' : 'Loading…'}</p>
        )}
      </F9PanelBlock>

      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:row-start-1 lg:col-start-2">
        {holding && (
          <F9PanelBlock className="flex-1 px-5 pb-3 pt-[18px] text-[13px]">
            <p className="font-semibold">Holding</p>
            <p className="mt-2.5 text-2xl font-semibold tabular-nums">{holding.totalCost}</p>
            <p className="mb-1.5 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Total cost · {holding.portfolioShare} of portfolio</p>
            <F9FactRowBlock divided label="Stock" value={holding.stockCost} sub={`${holding.stockShare} of cost`} />
            <F9FactRowBlock label="Options" value={holding.optionCost} sub={`${holding.optionShare} of cost`} />
            <F9FactRowBlock divided label="Open P/L" value={holding.pl} sub={holding.plReturn} tone={holding.plTone} />
            <F9FactRowBlock label="Stock P/L" value={holding.stockPl} sub={holding.stockPlReturn} tone={holding.stockPlTone} />
            <F9FactRowBlock label="Options P/L" value={holding.optionPl} sub={holding.optionPlReturn} tone={holding.optionPlTone} />
          </F9PanelBlock>
        )}
      </div>

      <div className="min-w-0 space-y-5">
      {PrivateCompanyGapsBlock && executionRoot && ticker && (
        <section id="webull-company-gaps" className="scroll-mt-4">
          <Suspense fallback={null}>
            <PrivateCompanyGapsBlock ticker={ticker} executionRoot={executionRoot} onOpenFile={onOpenFile} />
          </Suspense>
        </section>
      )}

      {PrivateCompanyNoticedBlock && executionRoot && ticker && (
        <section id="webull-company-noticed" className="scroll-mt-4">
          <Suspense fallback={null}>
            <PrivateCompanyNoticedBlock ticker={ticker} executionRoot={executionRoot} onOpenFile={onOpenFile} />
          </Suspense>
        </section>
      )}

      {positionsSlot && (
        <section id="webull-company-positions" className="scroll-mt-4">
          <F9SectionLabelBlock trailing={positionsActions}>Positions · {positionCount}</F9SectionLabelBlock>
          {positionsSlot}
        </section>
      )}


      </div>

      <aside aria-label={`${ticker} details`} className="flex min-w-0 flex-col gap-4 self-start">
        {trackRecord && <TrackRecordPanelBlock record={trackRecord} reportPath={reportPath} onOpenFile={onOpenFile} />}

        <F9PanelBlock id="webull-company-study" className="scroll-mt-4 px-4 py-3.5 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Study</span>
            {study && <button type="button" onClick={() => onOpenFile(study.filePath)} className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400">Open</button>}
          </div>
          {study ? (
            <>
              {study.statusRaw && <p className="mt-1 text-zinc-500 dark:text-zinc-400">“{study.statusRaw}”</p>}
              {range && rangePosition !== null && (
                <>
                  <div className="relative mt-3.5 h-1.5 rounded-full bg-emerald-500/15">
                    <span
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.2)]"
                      style={{ left: `${rangePosition * 100}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs text-zinc-500 tabular-nums">
                    <span>{formatPriceBlock(range.low)}</span>
                    <span>mid {formatPriceBlock((range.low + range.high) / 2)}</span>
                    <span>{formatPriceBlock(range.high)}</span>
                  </div>
                </>
              )}
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-zinc-500">Range set</dt><dd>{formatDateBlock(range?.setOn ?? null)}</dd>
                <dt className="text-zinc-500">Valid through</dt>
                <dd className={cn(validThroughPassed && 'font-medium text-amber-600 dark:text-amber-400')}>
                  {formatDateBlock(study.validThrough)}{validThroughPassed ? ' · due for review' : ''}
                </dd>
                <dt className="text-zinc-500">Last updated</dt><dd>{formatDateBlock(study.lastUpdated)}</dd>
              </dl>
              <button type="button" onClick={() => onOpenFile(study.filePath)} className="mt-2.5 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400">Read full study ›</button>
            </>
          ) : (
            <p className="mt-1 text-zinc-500">{dossier ? `No study record for ${ticker} yet.` : 'Loading…'}</p>
          )}
        </F9PanelBlock>

        <F9PanelBlock id="webull-company-observations" className="scroll-mt-4 px-4 py-3.5 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Observations</span>
            <span className="text-xs text-zinc-500 tabular-nums">{observations.length || ''}</span>
          </div>
          {visibleObservations.length > 0 ? (
            <div className="mt-1.5 space-y-3">
              {visibleObservations.map(entry => (
                <div key={entry.date}>
                  <p className="text-xs text-zinc-500">{formatDateBlock(entry.date)}</p>
                  <p className={cn('mt-0.5 whitespace-pre-line text-xs leading-relaxed', !observationsExpanded && 'line-clamp-4')}>{entry.body}</p>
                </div>
              ))}
              <div className="flex gap-4 text-xs">
                {observations.length > OBSERVATION_PREVIEW_BLOCK && (
                  <button type="button" onClick={() => setObservationsExpanded(prev => !prev)} className="text-sky-600 hover:text-sky-700 dark:text-sky-400">
                    {observationsExpanded ? 'Show latest only' : 'Show all ›'}
                  </button>
                )}
                {dossier?.observationsPath && (
                  <button type="button" onClick={() => onOpenFile(dossier.observationsPath!)} className="text-sky-600 hover:text-sky-700 dark:text-sky-400">Open file</button>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-zinc-500">{dossier ? 'No observations yet.' : 'Loading…'}</p>
          )}
        </F9PanelBlock>

        {dossier && (dossier.researchFolderPath || reports.length > 0 || valueLine.checking || valueLine.notCovered) && (
          <ResearchPanelBlock reports={reports} groups={dossier.researchGroups} valueLine={valueLine} onOpenFile={onOpenFile} />
        )}
      </aside>
    </div>
  )
}
