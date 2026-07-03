import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, FileText, MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  WebullStudyCategoryOrch,
  WebullStudyRowOrch,
} from '../../../services/orchestrators/webullStudyOrch'
import type { WebullStudyCommentBlock } from '../../../services/lego_blocks/units/webullStudyRecordBlock'
import TickerLogoBlock from '../units/TickerLogoBlock'
import TickerChartBlock from '../units/TickerChartBlock'

interface WebullStudyTableBlockProps {
  rows: WebullStudyRowOrch[]
  executionRoot: string
  onOpenStudyFile: (filePath: string) => void
}

const CATEGORY_LABEL_BLOCK: Record<WebullStudyCategoryOrch, string> = {
  'in-range': 'In range',
  'approaching': 'Approaching',
  'above-range': 'Above range',
  'below-range': 'Below range',
  'restudy-soon': 'Restudy soon',
  'stale': 'Stale',
  'too-hard': 'Too hard',
  'no-range': 'No range',
  'no-study': 'No study yet',
}

const CATEGORY_DOT_BLOCK: Record<WebullStudyCategoryOrch, string> = {
  'in-range': 'bg-emerald-500',
  'approaching': 'bg-amber-500',
  'above-range': 'bg-muted-foreground/40',
  'below-range': 'bg-emerald-600',
  'restudy-soon': 'bg-amber-500',
  'stale': 'bg-destructive',
  'too-hard': 'bg-muted-foreground/30',
  'no-range': 'bg-muted-foreground/30',
  'no-study': 'bg-muted-foreground/30',
}

const CATEGORY_ORDER_BLOCK: WebullStudyCategoryOrch[] = [
  'below-range',
  'in-range',
  'approaching',
  'restudy-soon',
  'stale',
  'above-range',
  'too-hard',
  'no-range',
  'no-study',
]

function formatMoneyBlock(value: number | null, opts?: { sign?: boolean }): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (opts?.sign && value > 0) return `+$${formatted}`
  if (value < 0) return `-$${formatted}`
  return `$${formatted}`
}

function formatPctBlock(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value).toFixed(1)
  if (value > 0) return `+${abs}%`
  if (value < 0) return `-${abs}%`
  return '0.0%'
}

function deltaToneBlock(category: WebullStudyCategoryOrch): string {
  switch (category) {
    case 'below-range':
      return 'text-emerald-700 dark:text-emerald-300 font-semibold'
    case 'in-range':
      return 'text-emerald-700 dark:text-emerald-300 font-medium'
    case 'approaching':
    case 'restudy-soon':
      return 'text-amber-700 dark:text-amber-300'
    case 'stale':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}

function rangeDeltaDollarsBlock(row: WebullStudyRowOrch): number | null {
  const price = row.livePrice.value
  const range = row.record?.currentRange
  if (price === null || !Number.isFinite(price) || !range) return null
  // Always relative to the range midpoint so the dollar delta matches the
  // percentage delta (also midpoint-based) shown above it.
  return price - (range.low + range.high) / 2
}

function formatValidThroughBlock(row: WebullStudyRowOrch): string {
  if (!row.record?.validThrough) return '—'
  const days = row.daysToValidThrough
  if (days === null) return row.record.validThrough
  if (days < 0) return `${row.record.validThrough} (${Math.abs(days)}d past)`
  return `${row.record.validThrough} (${days}d)`
}

// Pick the comment to surface inline: the most recent dated one, else the last
// entry in the section (study files append newest comments at the bottom).
function pickHighlightCommentBlock(
  comments: WebullStudyCommentBlock[],
): WebullStudyCommentBlock | null {
  if (comments.length === 0) return null
  const dated = comments.filter((c) => c.date)
  if (dated.length > 0) {
    return dated.reduce((latest, c) => (c.date! > latest.date! ? c : latest))
  }
  return comments[comments.length - 1]
}

function HeldBadgeBlock({ row }: { row: WebullStudyRowOrch }) {
  if (!row.held) {
    return <span className="text-xs text-muted-foreground/70">—</span>
  }
  if (row.heldStock) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Stock
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden="true" />
      Options
    </span>
  )
}

function SortHeaderBlock({
  label,
  sortKey,
  sort,
  onToggle,
}: {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; dir: SortDir } | null
  onToggle: (key: SortKey) => void
}) {
  const active = sort?.key === sortKey
  const Icon = !active ? ArrowUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        'inline-flex items-center gap-1 text-left uppercase tracking-wide hover:text-foreground',
        active && 'text-foreground',
      )}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <Icon className={cn('h-3 w-3', !active && 'opacity-40')} />
    </button>
  )
}

function CategoryDotBlock({ category }: { category: WebullStudyCategoryOrch }) {
  return (
    <span
      className={cn('h-2 w-2 shrink-0 rounded-full', CATEGORY_DOT_BLOCK[category])}
      aria-hidden="true"
    />
  )
}

const COLUMN_TEMPLATE_BLOCK =
  'grid grid-cols-[24px_minmax(120px,1.2fr)_84px_minmax(120px,1fr)_minmax(110px,1fr)_80px_minmax(150px,1.2fr)_minmax(110px,1fr)] gap-3 items-center px-1'

type SortKey =
  | 'ticker'
  | 'held'
  | 'range'
  | 'price'
  | 'delta'
  | 'validThrough'
  | 'lastUpdated'

type SortDir = 'asc' | 'desc'

const HELD_RANK: Record<'stock' | 'options' | 'none', number> = {
  stock: 0,
  options: 1,
  none: 2,
}

function heldRankBlock(row: WebullStudyRowOrch): number {
  if (!row.held) return HELD_RANK.none
  return row.heldStock ? HELD_RANK.stock : HELD_RANK.options
}

function compareNullableBlock(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDir,
): number {
  const aMissing = a === null || a === undefined || !Number.isFinite(a)
  const bMissing = b === null || b === undefined || !Number.isFinite(b)
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  return dir === 'asc' ? (a as number) - (b as number) : (b as number) - (a as number)
}

function compareStringBlock(
  a: string | null | undefined,
  b: string | null | undefined,
  dir: SortDir,
): number {
  const aMissing = !a
  const bMissing = !b
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  const cmp = (a as string).localeCompare(b as string)
  return dir === 'asc' ? cmp : -cmp
}

export default function WebullStudyTableBlock({
  rows,
  executionRoot,
  onOpenStudyFile,
}: WebullStudyTableBlockProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const { key, dir } = sort
    const copy = [...rows]
    copy.sort((a, b) => {
      switch (key) {
        case 'ticker':
          return compareStringBlock(a.ticker, b.ticker, dir)
        case 'held': {
          const cmp = heldRankBlock(a) - heldRankBlock(b)
          return dir === 'asc' ? cmp : -cmp
        }
        case 'range':
          return compareNullableBlock(
            a.record?.currentRange?.low ?? null,
            b.record?.currentRange?.low ?? null,
            dir,
          )
        case 'price':
          return compareNullableBlock(a.livePrice.value, b.livePrice.value, dir)
        case 'delta':
          return compareNullableBlock(a.rangeDeltaPct, b.rangeDeltaPct, dir)
        case 'validThrough':
          return compareNullableBlock(a.daysToValidThrough, b.daysToValidThrough, dir)
        case 'lastUpdated':
          return compareStringBlock(
            a.record?.lastUpdated ?? null,
            b.record?.lastUpdated ?? null,
            dir,
          )
        default:
          return 0
      }
    })
    return copy
  }, [rows, sort])

  const toggleExpanded = (ticker: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  const groupedRows = useMemo(() => {
    const buckets = new Map<WebullStudyCategoryOrch, WebullStudyRowOrch[]>()
    for (const row of sortedRows) {
      const list = buckets.get(row.category) ?? []
      list.push(row)
      buckets.set(row.category, list)
    }
    return CATEGORY_ORDER_BLOCK
      .filter((cat) => buckets.has(cat))
      .map((cat) => ({ category: cat, rows: buckets.get(cat)! }))
  }, [sortedRows])

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        No study records found. Add one under <code>watchlist/</code> or as
        <code>{'<TICKER>/<ticker>-study.md'}</code> in the F9-execution folder.
      </div>
    )
  }

  return (
    <div>
      <div className={cn(COLUMN_TEMPLATE_BLOCK, 'py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70')}>
        <span aria-hidden="true" />
        <SortHeaderBlock label="Ticker" sortKey="ticker" sort={sort} onToggle={toggleSort} />
        <SortHeaderBlock label="Held" sortKey="held" sort={sort} onToggle={toggleSort} />
        <SortHeaderBlock label="Range" sortKey="range" sort={sort} onToggle={toggleSort} />
        <SortHeaderBlock label="Price" sortKey="price" sort={sort} onToggle={toggleSort} />
        <SortHeaderBlock label="Δ%" sortKey="delta" sort={sort} onToggle={toggleSort} />
        <SortHeaderBlock label="Valid through" sortKey="validThrough" sort={sort} onToggle={toggleSort} />
        <SortHeaderBlock label="Last updated" sortKey="lastUpdated" sort={sort} onToggle={toggleSort} />
      </div>

      {groupedRows.map((group) => (
        <div key={group.category} className="mt-4 first:mt-2">
          <div className="flex items-baseline gap-2 px-1 pb-1.5">
            <CategoryDotBlock category={group.category} />
            <span className="text-xs font-medium text-foreground/80">
              {CATEGORY_LABEL_BLOCK[group.category]}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground/60">
              {group.rows.length}
            </span>
          </div>
          <div className="divide-y divide-border/40">
            {group.rows.map((row) => {
          const isExpanded = expanded.has(row.ticker)
          const range = row.record?.currentRange
          const rangeLabel = range
            ? `$${range.low.toLocaleString()}–$${range.high.toLocaleString()}`
            : '—'
          const rangeMidpoint = range ? (range.low + range.high) / 2 : null
          const optionCount = row.options.length
          const impNote = row.record
            ? pickHighlightCommentBlock(row.record.impQuickNotes)
            : null
          const extraNoteCount = row.record
            ? Math.max(0, row.record.impQuickNotes.length - 1)
            : 0
          return (
            <div
              key={row.ticker}
              className={cn(
                'transition-colors',
                isExpanded ? 'bg-muted/20' : 'hover:bg-muted/30',
              )}
            >
              <div
                className={cn(COLUMN_TEMPLATE_BLOCK, 'cursor-pointer py-2.5 text-sm')}
                onClick={() => toggleExpanded(row.ticker)}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleExpanded(row.ticker)
                  }
                }}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center text-muted-foreground"
                  aria-hidden="true"
                >
                  <ChevronRight
                    className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')}
                  />
                </span>

                <div className="flex items-center gap-2">
                  <TickerLogoBlock ticker={row.ticker} executionRoot={executionRoot} />
                  <span className="text-base font-semibold tracking-tight">{row.ticker}</span>
                  {optionCount > 0 && (
                    <span className="text-[10px] font-medium text-muted-foreground/70">
                      +{optionCount} opt
                    </span>
                  )}
                </div>

                <div>
                  <HeldBadgeBlock row={row} />
                </div>

                <div className="tabular-nums">
                  <div className="text-sm">{rangeLabel}</div>
                  {rangeMidpoint !== null && (
                    <div className="text-[10px] text-muted-foreground">
                      mid {formatMoneyBlock(rangeMidpoint)}
                    </div>
                  )}
                </div>

                <div className="tabular-nums">
                  <div className="text-sm">{formatMoneyBlock(row.livePrice.value)}</div>
                  {row.livePrice.source !== 'unavailable' && (
                    <div className="text-[10px] text-muted-foreground">
                      {row.livePrice.source === 'webull-holding' ? 'Webull' : row.livePrice.source === 'yahoo-chart' ? 'Yahoo' : ''}
                    </div>
                  )}
                </div>

                <div className="tabular-nums">
                  <div className={cn('text-sm', deltaToneBlock(row.category))}>
                    {formatPctBlock(row.rangeDeltaPct)}
                  </div>
                  {(() => {
                    const deltaDollars = rangeDeltaDollarsBlock(row)
                    if (deltaDollars === null) return null
                    return (
                      <div className="text-[8.5px] text-muted-foreground">
                        {formatMoneyBlock(deltaDollars, { sign: true })}
                      </div>
                    )
                  })()}
                </div>

                <div className={cn('text-sm tabular-nums', row.category === 'stale' && 'text-destructive')}>
                  {formatValidThroughBlock(row)}
                </div>

                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span className="tabular-nums">{row.record?.lastUpdated ?? '—'}</span>
                  {row.record?.filePath && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenStudyFile(row.record!.filePath)
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Open study file"
                      aria-label="Open study file"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {impNote && !isExpanded && (
                <div
                  className="flex cursor-pointer items-start gap-1.5 px-1 pb-2 pl-9 text-xs"
                  onClick={() => toggleExpanded(row.ticker)}
                  title={impNote.raw}
                >
                  <span className="mt-px shrink-0 rounded bg-amber-500/15 dark:bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Imp
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {impNote.date && (
                      <span className="mr-1.5 tabular-nums opacity-70">
                        {impNote.date}
                      </span>
                    )}
                    <span className="italic text-foreground/80">
                      {impNote.text}
                    </span>
                    {extraNoteCount > 0 && (
                      <span className="ml-1.5 not-italic opacity-60">
                        +{extraNoteCount} more
                      </span>
                    )}
                  </span>
                </div>
              )}

              {isExpanded && (
                <div className="border-t border-border/40 py-4 pl-9 pr-1">
                  {!row.record ? (
                    <p className="text-sm text-muted-foreground">
                      No study record yet for this held ticker. Add one under
                      <code className="mx-1">{`${row.ticker}/${row.ticker.toLowerCase()}-study.md`}</code>
                      to capture your reasoning.
                    </p>
                  ) : (
                  <>
                  {row.record.impQuickNotes.length > 0 && (
                    <div className="mb-4">
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        <span className="rounded bg-amber-500/15 dark:bg-amber-500/25 px-1.5 py-0.5 text-[9px]">
                          Imp
                        </span>
                        Quick note
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {row.record.impQuickNotes.map((note, i) => (
                          <li
                            key={`${note.raw}-${i}`}
                            className="flex items-start gap-2 text-sm"
                          >
                            {note.date && (
                              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                                {note.date}
                              </span>
                            )}
                            <span>{note.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {row.record.comments.length > 0 && (
                    <div className="mb-4">
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <MessageSquareText className="h-3.5 w-3.5" />
                        Comments
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {row.record.comments.map((comment, i) => (
                          <li
                            key={`${comment.raw}-${i}`}
                            className="flex items-start gap-2 text-sm"
                          >
                            {comment.date && (
                              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                                {comment.date}
                              </span>
                            )}
                            <span>{comment.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {row.record.rangeHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No range history entries parsed from the study record body.
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-3">
                      {row.record.rangeHistory.map((entry, i) => (
                        <li
                          key={`${entry.heading}-${i}`}
                          className="rounded-xl border border-foreground/[0.06] bg-background/70 p-4 shadow-[0_6px_20px_-8px_rgba(20,20,24,0.12)] backdrop-blur-sm"
                        >
                          <div className="mb-2 flex items-baseline gap-3">
                            <span className="text-[10px] font-semibold uppercase tracking-wide tabular-nums text-muted-foreground">
                              {entry.date ?? 'undated'}
                            </span>
                            <span className="text-sm font-semibold">{entry.heading}</span>
                          </div>
                          {entry.body && (
                            <div className="prose prose-sm max-w-none text-sm dark:prose-invert prose-headings:my-2 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {entry.body}
                              </ReactMarkdown>
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="mt-4">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Chart
                    </div>
                    <TickerChartBlock ticker={row.ticker} executionRoot={executionRoot} />
                  </div>
                  </>
                  )}
                </div>
              )}
            </div>
          )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
