import { useAppWorkAttentionBlock } from '@/components/lego_blocks/hooks/shared/useAppWorkAttentionBlock'
import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { F9PriceChartBlock } from '../units/F9PriceChartBlock'
import FileCopyMenuHostBlock, { openFileCopyMenuBlock } from '@/components/lego_blocks/integrations/FileCopyMenuBlock'
import { ChevronRight, Download, Loader2 } from 'lucide-react'
import TickerLogoBlock from '@/personal_extension/components/lego_blocks/units/TickerLogoBlock'
import { useWebullCompanyDossierBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullCompanyDossierBlock'
import { useValueLineCompanyBlock } from '@/personal_extension/components/lego_blocks/hooks/useValueLineCompanyBlock'
import { useEarningsCallsCompanyBlock } from '@/personal_extension/components/lego_blocks/hooks/useEarningsCallsCompanyBlock'
import { useWebullTrackRecordBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullTrackRecordBlock'
import { f9SignedMoneyKBlock, type WebullCompanyTrackRecordBlock } from '@/personal_extension/services/lego_blocks/units/webullTrackRecordBlock'
import { F9TrackRowBlock } from '@/personal_extension/components/lego_blocks/units/F9TrackRecordPartsBlock'
import {
  F9FactRowBlock,
  F9PanelBlock,
  F9SectionLabelBlock,
  F9SegmentedBlock,
} from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import { PrivateCompanyGapsBlock, PrivateCompanyNoticedBlock } from '@/personal_extension/components/lego_blocks/units/privatePersonalBlock'
import { valueLineDueBlock, valueLineIssueLabelBlock, valueLineIssueRowsBlock, type ValueLineIssueRowBlock, type WebullResearchFileBlock, type WebullResearchGroupBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyDossierBlock'
import type { WebullClosedPositionBlock } from '@/personal_extension/services/lego_blocks/units/webullClosedPositionsBlock'
import { useWebullClosedPositionsBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullClosedPositionsBlock'
import { useGapPositionLinksBlock } from '@/personal_extension/components/lego_blocks/hooks/useGapPositionLinksBlock'
import { gapsForPositionBlock, type GapPositionLinkBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'
import { GapChipsBlock } from '@/personal_extension/components/lego_blocks/units/GapChipsBlock'
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
  /** The name an account goes by, for the closed positions table under the open ones. */
  accountLabel?: (accountId: string | null, accountNumber: string | null) => string | null
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

function moneyBlock(value: number | null): string {
  if (value === null) return '—'
  return `$${Math.round(value).toLocaleString('en-US')}`
}

/**
 * Closed positions, latest first: what each cost and what it was worth the
 * last time a sync saw it open. That is the last value before it closed, not
 * the sale price; the track record has what the statements say it came back with.
 */
function ClosedPositionsTableBlock({ rows, gapLinks, accountLabel, filePath, onOpenFile }: {
  rows: WebullClosedPositionBlock[]
  gapLinks: GapPositionLinkBlock[]
  accountLabel?: (accountId: string | null, accountNumber: string | null) => string | null
  filePath: ((row: WebullClosedPositionBlock) => string) | null
  onOpenFile: (path: string) => void
}) {
  const total = rows.reduce((sum, row) => sum + (row.result ?? 0), 0)
  const counted = rows.filter(row => row.result !== null).length
  return (
    <F9PanelBlock className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px] tabular-nums">
        <thead className="[&_th]:whitespace-nowrap [&_th]:border-b-[0.5px] [&_th]:border-[#E5E5EA] [&_th]:px-3 [&_th]:py-2 [&_th]:text-[11px] [&_th]:font-medium [&_th]:text-zinc-500 dark:[&_th]:border-zinc-800">
          <tr>
            <th className="!pl-4">Position</th>
            <th>Account</th>
            <th>Gap</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Cost</th>
            <th className="text-right" title="Its value the last time a sync saw it open">Last value</th>
            <th className="text-right">Result</th>
            <th className="!pr-4 text-right" title="About when it closed: the last time a sync saw it">Closed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.fileName}
              onClick={filePath ? () => onOpenFile(filePath(row)) : undefined}
              className={cn('[&>td]:border-b-[0.5px] [&>td]:border-[#EFEFF2] [&>td]:px-3 [&>td]:py-2 last:[&>td]:border-b-0 dark:[&>td]:border-zinc-800/70', filePath && 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50')}
            >
              <td className="!pl-4">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {row.kind === 'stock' ? row.symbol : `${row.symbol} ${row.strike ?? ''} ${row.kind}`}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {row.kind === 'stock' ? 'Stock' : `Expires ${formatDateBlock(row.expiry)}`}
                </div>
              </td>
              <td className="text-zinc-500 dark:text-zinc-400">{accountLabel?.(row.accountId, row.accountNumber) ?? '—'}</td>
              <td>
                <GapChipsBlock
                  onOpen={onOpenFile}
                  gaps={gapsForPositionBlock(gapLinks, {
                    id: row.webullId,
                    symbol: row.symbol,
                    instrumentType: row.kind === 'stock' ? 'STOCK' : 'OPTION',
                    optionType: row.kind === 'stock' ? null : row.kind,
                    optionExpireDate: row.expiry,
                    optionExercisePrice: row.strike,
                  })}
                />
              </td>
              <td className="text-right">{row.quantity ?? '—'}</td>
              <td className="text-right">{moneyBlock(row.cost)}</td>
              <td className="text-right">{moneyBlock(row.lastValue)}</td>
              <td className={cn('text-right', row.result !== null && (row.result >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'))}>
                {row.result === null ? '—' : `${row.result >= 0 ? '+' : '−'}${moneyBlock(Math.abs(row.result))}`}
              </td>
              <td className="!pr-4 text-right text-zinc-500 dark:text-zinc-400">{formatDateBlock(row.closedOn)}</td>
            </tr>
          ))}
        </tbody>
        {counted > 1 && (
          <tfoot>
            <tr className="[&>td]:border-t-[0.5px] [&>td]:border-[#E5E5EA] [&>td]:px-3 [&>td]:py-2 dark:[&>td]:border-zinc-800">
              <td colSpan={6} className="!pl-4 text-[12px] text-zinc-500 dark:text-zinc-400">Together, {counted} with a known cost</td>
              <td className={cn('text-right font-medium', total >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                {`${total >= 0 ? '+' : '−'}${moneyBlock(Math.abs(total))}`}
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </F9PanelBlock>
  )
}

type ValueLinePanelStateBlock = ReturnType<typeof useValueLineCompanyBlock>

// Value Line in the research panel: the newest issue on the row; opening it
// lists every issue — saved ones open, and on the desktop the library's older
// ones download on click (one at a time, so the library sees a reader).
/** The folder a file sits in, for "Copy folder path". */
const folderOfBlock = (path: string) => path.replace(/\/[^/]+$/, '')

function ValueLineRowBlock({ reports, valueLine, expanded, onToggle, onOpenFile }: {
  reports: WebullResearchFileBlock[]
  valueLine: ValueLinePanelStateBlock
  expanded: boolean
  onToggle: () => void
  onOpenFile: (path: string) => void
}) {
  const rows = useMemo(() => valueLineIssueRowsBlock(reports, valueLine.available ? valueLine.issues : null), [reports, valueLine.available, valueLine.issues])
  const latest = reports[0] ?? null
  const status = latest
    ? null
    : valueLine.checking ? 'Fetching…' : valueLine.notCovered ? 'Not covered' : null
  const savedCount = rows.filter(row => row.path).length
  // On the phone, or with one saved issue and nothing more listed, the row opens the report
  const opensDirectly = rows.length === 1 && rows[0].path !== null && !valueLine.available
  const toggle = () => {
    if (!expanded && valueLine.available) valueLine.loadIssues()
    onToggle()
  }
  const open = async (row: ValueLineIssueRowBlock) => {
    if (row.path) {
      onOpenFile(row.path)
      return
    }
    if (!row.issueDate || valueLine.fetchingIssue) return
    const path = await valueLine.fetchIssue(row.issueDate)
    if (path) onOpenFile(path)
  }
  if (!latest && !status && !valueLine.available) return null
  return (
    <div className="border-b border-zinc-200/70 last:border-b-0 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={opensDirectly ? undefined : expanded}
        onClick={() => (opensDirectly ? onOpenFile(rows[0].path!) : toggle())}
        onContextMenu={(event) => {
          const saved = rows.find(row => row.path)?.path
          if (saved) openFileCopyMenuBlock(event, opensDirectly ? { kind: 'file', path: saved } : { kind: 'folder', path: folderOfBlock(saved) })
        }}
        className="ltm-motion-fast flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      >
        <span className="truncate">Value Line</span>
        <span className="flex shrink-0 items-center gap-1 text-zinc-500 dark:text-zinc-400">
          {latest
            ? (
              <>
                {valueLineDueBlock(latest, new Date()) && <span className="text-[11px] text-amber-700 dark:text-amber-400" title="Older than one review cycle (about 13 weeks)">due ·</span>}
                {valueLineIssueLabelBlock(latest)}
              </>
            )
            : status ?? 'None saved'}
          {!opensDirectly && <ChevronRight className={cn('h-3.5 w-3.5 opacity-60 transition-transform', expanded && 'rotate-90')} />}
        </span>
      </button>
      {expanded && (
        <div className="pb-1.5">
          {valueLine.available && (
            <p className="px-4 pb-1 pl-7 text-[11px] text-zinc-500 dark:text-zinc-400">
              {valueLine.issueError
                ? (
                  <>
                    <span className="text-red-600 dark:text-red-400">{valueLine.issueError}</span>
                    <button type="button" onClick={() => valueLine.loadIssues()} className="ml-2 text-sky-600 hover:text-sky-700 dark:text-sky-400">Try again</button>
                  </>
                )
                : valueLine.issues === null
                  ? 'Listing issues from the library…'
                  : `${valueLine.issues.length} ${valueLine.issues.length === 1 ? 'issue' : 'issues'} in the library · ${savedCount} saved`}
            </p>
          )}
          <ul className="max-h-80 overflow-y-auto">
            {rows.map(row => {
              const fetching = valueLine.fetchingIssue !== null && valueLine.fetchingIssue === row.issueDate
              return (
                <li key={row.path ?? row.issueDate ?? row.label}>
                  <button
                    type="button"
                    onClick={() => { void open(row) }}
                    onContextMenu={(event) => {
                      if (row.path) openFileCopyMenuBlock(event, { kind: 'file', path: row.path })
                      else if (row.issueDate && !valueLine.fetchingIssue) {
                        const issueDate = row.issueDate
                        openFileCopyMenuBlock(event, { kind: 'fetch', label: 'Download, then copy file path', fetch: () => valueLine.fetchIssue(issueDate) })
                      }
                    }}
                    disabled={!row.path && Boolean(valueLine.fetchingIssue)}
                    title={row.path ? 'Open' : 'Download from the library and open'}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-4 py-1.5 pl-7 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
                      row.path ? 'text-zinc-700 hover:text-zinc-900 dark:text-zinc-200' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
                    )}
                  >
                    <span className="truncate">{row.label}</span>
                    {fetching
                      ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                      : row.path
                        ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="Saved" />
                        : <Download className="h-3 w-3 shrink-0 opacity-60" aria-label="Download" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

// Earnings calls, the newest on the row and the rest folded below it by month
function EarningsCallsRowBlock({ calls, sync, expanded, onToggle, onOpenFile }: {
  calls: WebullResearchFileBlock[]
  sync: { checking: boolean; notCovered: boolean }
  expanded: boolean
  onToggle: () => void
  onOpenFile: (path: string) => void
}) {
  if (calls.length === 0) {
    const note = sync.checking ? 'Fetching…' : sync.notCovered ? 'Not covered' : null
    return note ? (
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/70 px-4 py-2.5 text-[13px] last:border-b-0 dark:border-zinc-800">
        <span>Earnings calls</span>
        <span className="text-zinc-500 dark:text-zinc-400">{note}</span>
      </div>
    ) : null
  }
  return (
    <div className="border-b border-zinc-200/70 last:border-b-0 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={calls.length > 1 ? expanded : undefined}
        onClick={() => (calls.length === 1 ? onOpenFile(calls[0].path) : onToggle())}
        onContextMenu={(event) => openFileCopyMenuBlock(event, calls.length === 1 ? { kind: 'file', path: calls[0].path } : { kind: 'folder', path: folderOfBlock(calls[0].path) })}
        className="ltm-motion-fast flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      >
        <span className="truncate">Earnings calls</span>
        <span className="flex shrink-0 items-center gap-1 text-zinc-500 dark:text-zinc-400">
          {valueLineIssueLabelBlock(calls[0])}
          {calls.length > 1 && <span className="tabular-nums text-zinc-400"> · {calls.length}</span>}
          {calls.length > 1 && <ChevronRight className={cn('h-3.5 w-3.5 opacity-60 transition-transform', expanded && 'rotate-90')} />}
        </span>
      </button>
      {expanded && (
        <ul className="max-h-80 overflow-y-auto pb-1.5">
          {calls.map(call => (
            <li key={call.path}>
              <button
                type="button"
                onClick={() => onOpenFile(call.path)}
                onContextMenu={(event) => openFileCopyMenuBlock(event, { kind: 'file', path: call.path })}
                className="block w-full truncate px-4 py-1.5 pl-7 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
              >
                {valueLineIssueLabelBlock(call)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Research lives in the side panel: Value Line and the earnings calls first,
// then each research folder folds out its files.
function ResearchPanelBlock({ reports, calls, callsSync, groups, valueLine, onOpenFile }: {
  reports: WebullResearchFileBlock[]
  calls: WebullResearchFileBlock[]
  callsSync: { checking: boolean; notCovered: boolean }
  groups: WebullResearchGroupBlock[]
  valueLine: ValueLinePanelStateBlock
  onOpenFile: (path: string) => void
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const toggle = (label: string) => setOpenGroup(prev => (prev === label ? null : label))
  return (
    <F9PanelBlock id="webull-company-research" className="scroll-mt-4 overflow-hidden">
      <ValueLineRowBlock
        reports={reports}
        valueLine={valueLine}
        expanded={openGroup === 'Value Line'}
        onToggle={() => toggle('Value Line')}
        onOpenFile={onOpenFile}
      />
      <EarningsCallsRowBlock
        calls={calls}
        sync={callsSync}
        expanded={openGroup === 'Earnings calls'}
        onToggle={() => toggle('Earnings calls')}
        onOpenFile={onOpenFile}
      />
      {groups.map(group => {
        const expanded = openGroup === group.label
        return (
          <div key={group.label} className="border-b border-zinc-200/70 last:border-b-0 dark:border-zinc-800">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(group.label)}
              onContextMenu={(event) => { if (group.files[0]) openFileCopyMenuBlock(event, { kind: 'folder', path: folderOfBlock(group.files[0].path) }) }}
              className="ltm-motion-fast flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <span className="truncate">{group.label}</span>
              <span className="flex shrink-0 items-center gap-1 text-zinc-500 dark:text-zinc-400">
                {group.files.length}
                <ChevronRight className={cn('h-3.5 w-3.5 opacity-60 transition-transform', expanded && 'rotate-90')} />
              </span>
            </button>
            {expanded && (
              <ul className="pb-1.5">
                {group.files.map(file => (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => onOpenFile(file.path)}
                      onContextMenu={(event) => openFileCopyMenuBlock(event, { kind: 'file', path: file.path })}
                      className="block w-full truncate px-4 py-1.5 pl-7 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                    >
                      {file.name}
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
  accountLabel,
  footer,
  onOpenFile,
}: WebullCompanyPageBlockProps) {
  const valueLine = useValueLineCompanyBlock(executionRoot, ticker)
  const callsSync = useEarningsCallsCompanyBlock(executionRoot, ticker)
  const { dossier, loading, error } = useWebullCompanyDossierBlock(executionRoot, ticker, companyName, valueLine.fetchedCount + callsSync.fetchedCount)
  const { record: trackRecord, reportPath } = useWebullTrackRecordBlock(executionRoot, ticker)
  const closedPositions = useWebullClosedPositionsBlock(executionRoot, ticker)
  // Time studying the company is filed in its folder.
  const workRef = useAppWorkAttentionBlock(executionRoot ? `${executionRoot}/${ticker.toUpperCase()}/company` : null, `${ticker.toUpperCase()} company page`)
  const gapLinks = useGapPositionLinksBlock(executionRoot)
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

  const reports = dossier?.valueLineReports ?? []
  const observations = dossier?.observations ?? []
  const visibleObservations = observationsExpanded ? observations : observations.slice(0, OBSERVATION_PREVIEW_BLOCK)
  const sublineParts = [
    ticker ? displayName : null,
    costShare !== null ? `Held · ${(costShare * 100).toFixed(costShare >= 0.1 ? 0 : 1)}% of cost` : dossier && !study ? 'Not studied yet' : 'Watchlist',
    rangeState,
  ].filter(Boolean)

  return (
    <div ref={workRef} className="grid gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(290px,340px)]">
      <FileCopyMenuHostBlock />
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
        {chartPoints.length > 1 ? (
          <div
            className="flex min-h-[260px] flex-1"
            onContextMenu={(event) => { if (executionRoot && ticker) openFileCopyMenuBlock(event, { kind: 'file', path: `${executionRoot.replace(/\/+$/, '')}/${ticker}/prices.csv` }) }}
          >
            <F9PriceChartBlock points={chartPoints} range={range} bands={dossier?.bands?.bands ?? []} idKey={ticker || 'company'} />
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-zinc-500">{dossier ? 'No prices yet: they fill in with the next daily pass (Feed → Sources → Prices).' : 'Loading…'}</p>
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

      {closedPositions.length > 0 && (
        <section id="webull-company-closed-positions" className="scroll-mt-4">
          <F9SectionLabelBlock>Closed · {closedPositions.length}</F9SectionLabelBlock>
          <ClosedPositionsTableBlock
            rows={closedPositions}
            gapLinks={gapLinks}
            accountLabel={accountLabel}
            filePath={executionRoot ? (row) => `${executionRoot}/${ticker.toUpperCase()}/archived_positions/${row.fileName}` : null}
            onOpenFile={onOpenFile}
          />
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

        {dossier && (dossier.researchFolderPath || reports.length > 0 || dossier.earningsCalls.length > 0 || valueLine.available) && (
          <ResearchPanelBlock reports={reports} calls={dossier.earningsCalls} callsSync={callsSync} groups={dossier.researchGroups} valueLine={valueLine} onOpenFile={onOpenFile} />
        )}
      </aside>
    </div>
  )
}
