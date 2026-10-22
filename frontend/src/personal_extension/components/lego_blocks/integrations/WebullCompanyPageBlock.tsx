import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Area, AreaChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentBlock'
import PdfDocumentBlock from '@/components/lego_blocks/integrations/PdfDocumentBlock'
import { useWebullCompanyDossierBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullCompanyDossierBlock'
import {
  F9FactRowBlock,
  F9PanelBlock,
  F9SectionLabelBlock,
  F9SegmentedBlock,
} from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import { PrivateCompanyGapsBlock } from '@/personal_extension/components/lego_blocks/units/privateGapsBlock'
import type { WebullResearchGroupBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'
import { cn } from '@/lib/utils'

// Section anchors, shared with the sidebar's nested jump links.
export const WEBULL_COMPANY_SECTIONS_BLOCK = [
  { id: 'webull-company-overview', label: 'Overview' },
  { id: 'webull-company-gaps', label: 'Gaps' },
  { id: 'webull-company-positions', label: 'Positions' },
  { id: 'webull-company-observations', label: 'Observations' },
  { id: 'webull-company-study', label: 'Study' },
  { id: 'webull-company-research', label: 'Research' },
] as const

const RESEARCH_GROUP_PREVIEW_BLOCK = 6
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
  /** The positions table and its controls, owned by the workspace. */
  positionsSlot: ReactNode
  positionsActions?: ReactNode
  /** Inline the ValueLine PDF (desktop). The phone links to it instead — a PDF render is a memory spike there. */
  inlinePdf: boolean
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

function scrollToBlock(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function LinkRowBlock({ label, value, onClick }: { label: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ltm-motion-fast flex w-full items-center justify-between gap-3 border-b border-zinc-200/70 px-4 py-2.5 text-left text-[13px] transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
    >
      <span className="truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-1 text-zinc-500 dark:text-zinc-400">
        {value}
        <ChevronRight className="h-3.5 w-3.5 opacity-60" />
      </span>
    </button>
  )
}

function ResearchGroupBlock({ group, onOpenFile }: { group: WebullResearchGroupBlock; onOpenFile: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? group.files : group.files.slice(0, RESEARCH_GROUP_PREVIEW_BLOCK)
  return (
    <F9PanelBlock className="min-w-0 overflow-hidden">
      <p className="border-b border-zinc-200/70 px-4 py-2.5 text-[13px] font-semibold dark:border-zinc-800">
        {group.label} <span className="font-normal text-zinc-500">{group.files.length}</span>
      </p>
      {visible.map(file => <LinkRowBlock key={file.path} label={file.name} onClick={() => onOpenFile(file.path)} />)}
      {group.files.length > RESEARCH_GROUP_PREVIEW_BLOCK && (
        <button type="button" onClick={() => setExpanded(prev => !prev)} className="w-full px-4 py-2.5 text-left text-[13px] text-sky-600 hover:text-sky-700 dark:text-sky-400">
          {expanded ? 'Show less' : `Show ${group.files.length - RESEARCH_GROUP_PREVIEW_BLOCK} more`}
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
  inlinePdf,
  onOpenFile,
}: WebullCompanyPageBlockProps) {
  const { dossier, loading, error } = useWebullCompanyDossierBlock(executionRoot, ticker, companyName)
  const [priceWindow, setPriceWindow] = useState<PriceWindowBlock>('2y')
  const [studyExpanded, setStudyExpanded] = useState(false)
  const [reportPath, setReportPath] = useState<string | null>(null)
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
  const displayName = study?.company ?? companyName ?? ticker

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
  const activeReport = reports.find(report => report.path === reportPath) ?? reports[0] ?? null
  const observations = dossier?.observations ?? []
  const visibleObservations = observationsExpanded ? observations : observations.slice(0, OBSERVATION_PREVIEW_BLOCK)
  const sublineParts = [
    ticker,
    costShare !== null ? `Held · ${(costShare * 100).toFixed(costShare >= 0.1 ? 0 : 1)}% of cost` : 'Watching',
    rangeState,
  ].filter(Boolean)

  return (
    <div className="space-y-6">
      <header id="webull-company-overview" className="scroll-mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{displayName}</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{sublineParts.join(' · ')}</p>
        </div>
        {price !== null && (
          <div className="text-right tabular-nums">
            <p className="text-[26px] font-semibold leading-tight">{formatPriceBlock(price)}</p>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {fromMid !== null && mid ? (
                <span className={cn(fromMid >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  {fromMid >= 0 ? '+' : '−'}{Math.abs((fromMid / mid) * 100).toFixed(1)}% · {fromMid >= 0 ? '+' : '−'}{formatPriceBlock(Math.abs(fromMid))} from range mid
                </span>
              ) : null}
              {livePrice === null && lastClose && <span className="ml-1.5">as of {formatDateBlock(lastClose.date)}</span>}
            </p>
          </div>
        )}
      </header>

      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {loading && !dossier && <div className="h-1 w-full animate-pulse rounded-full bg-gradient-to-r from-transparent via-primary/40 to-transparent" />}

      <div className="flex flex-wrap items-start gap-5">
        <F9PanelBlock className="min-w-0 flex-[999_1_520px] p-4">
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
            <div className="h-[260px] text-sky-500">
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
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Area type="monotone" dataKey="price" stroke="currentColor" strokeWidth={2} fill={`url(#webull-price-fill-${ticker})`} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-zinc-500">{dossier ? 'No price history (prices.csv) for this company.' : 'Loading…'}</p>
          )}
        </F9PanelBlock>

        <aside aria-label={`${ticker} details`} className="flex min-w-0 flex-[1_1_290px] flex-col gap-4 lg:max-w-[340px]">
          {holding && (
            <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
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

          <F9PanelBlock className="px-4 py-3.5 text-[13px]">
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
                <button type="button" onClick={() => scrollToBlock('webull-company-study')} className="mt-2.5 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400">Read full study ›</button>
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
                    <p className={cn('mt-0.5 whitespace-pre-line text-xs leading-relaxed', !observationsExpanded && 'line-clamp-6')}>{entry.body}</p>
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

          {dossier?.researchFolderPath && (
            <F9PanelBlock className="overflow-hidden">
              {activeReport && <LinkRowBlock label="ValueLine" value={activeReport.name} onClick={() => scrollToBlock('webull-company-research')} />}
              {dossier.researchGroups.map(group => (
                <LinkRowBlock key={group.label} label={group.label} value={group.files.length} onClick={() => scrollToBlock('webull-company-research')} />
              ))}
            </F9PanelBlock>
          )}
        </aside>
      </div>

      {PrivateCompanyGapsBlock && executionRoot && (
        <section id="webull-company-gaps" className="scroll-mt-4">
          <Suspense fallback={null}>
            <PrivateCompanyGapsBlock ticker={ticker} executionRoot={executionRoot} onOpenFile={onOpenFile} />
          </Suspense>
        </section>
      )}

      <section id="webull-company-positions" className="scroll-mt-4">
        <F9SectionLabelBlock trailing={positionsActions}>Positions · {positionCount}</F9SectionLabelBlock>
        {positionsSlot}
      </section>

      <section id="webull-company-study" className="scroll-mt-4">
        <F9SectionLabelBlock trailing={study && <button type="button" onClick={() => onOpenFile(study.filePath)} className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400">Open</button>}>
          Study
        </F9SectionLabelBlock>
        <F9PanelBlock className="p-5">
          {study ? (
            <div className="relative">
              <div className={cn('overflow-hidden', !studyExpanded && 'max-h-[440px]')}>
                <MarkdownDocumentBlock path={study.filePath} initialMode="view" topBarHidden onOpenPath={onOpenFile} onOpenPathForEdit={onOpenFile} />
              </div>
              {!studyExpanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />}
              <div className="relative mt-2 flex justify-center">
                <button type="button" onClick={() => setStudyExpanded(prev => !prev)} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200">
                  {studyExpanded ? 'Collapse study' : 'Read full study'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">{dossier ? `No study record for ${ticker} yet.` : 'Loading…'}</p>
          )}
        </F9PanelBlock>
      </section>

      <section id="webull-company-research" className="scroll-mt-4">
        <F9SectionLabelBlock trailing={dossier?.researchFolderPath && <span className="truncate text-xs text-zinc-500">{dossier.researchFolderPath.split('/').slice(-2).join(' / ')}</span>}>
          Research
        </F9SectionLabelBlock>
        {!dossier ? (
          <p className="mx-1 text-sm text-zinc-500">Loading…</p>
        ) : !dossier.researchFolderPath ? (
          <p className="mx-1 text-sm text-zinc-500">No research folder found for {ticker}.</p>
        ) : (
          <div className="space-y-4">
            {activeReport && (
              <F9PanelBlock className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200/70 px-4 py-2.5 dark:border-zinc-800">
                  <span className="text-[13px] font-semibold">ValueLine</span>
                  {reports.length > 1 ? (
                    <select
                      value={activeReport.path}
                      onChange={(event) => setReportPath(event.target.value)}
                      aria-label="ValueLine report"
                      className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {reports.map(report => <option key={report.path} value={report.path}>{report.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-zinc-500">{activeReport.name}</span>
                  )}
                  <button type="button" onClick={() => onOpenFile(activeReport.path)} className="ml-auto text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400">Open</button>
                </div>
                {inlinePdf && (
                  <div className="h-[80vh]">
                    <PdfDocumentBlock key={activeReport.path} path={activeReport.path} className="h-full" />
                  </div>
                )}
              </F9PanelBlock>
            )}
            {dossier.researchGroups.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {dossier.researchGroups.map(group => <ResearchGroupBlock key={group.label} group={group} onOpenFile={onOpenFile} />)}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
