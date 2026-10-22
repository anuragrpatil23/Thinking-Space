import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { F9_PANEL_CLASS_BLOCK, F9FactRowBlock, F9PanelBlock } from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import { useWebullStudySnapshotBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullStudySnapshotBlock'
import WebullStudyTableBlock from './WebullStudyTableBlock'
import WebullStudyTimelineBlock from './WebullStudyTimelineBlock'

function formatLoadedAtBlock(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function WebullStudyBlock() {
  const { openFile } = useMarkdownViewer()
  const { snapshot, loading, error } = useWebullStudySnapshotBlock()

  const onOpenStudyFile = useCallback(
    (filePath: string) => openFile(filePath, { mode: 'view' }),
    [openFile],
  )

  const [showWarnings, setShowWarnings] = useState(false)
  const studiedCount = snapshot?.rows.filter((row) => row.record).length ?? 0
  // Under the title, what studying is for; the Studied card carries the numbers.
  const subline = snapshot ? 'Understand a business really well.' : (loading ? 'Loading study records…' : 'No snapshot loaded.')
  // The welcome numbers, as Overall opens with Value: how much has been studied,
  // how recently, and what is due for another look.
  const summary = (() => {
    if (!snapshot) return null
    const studied = snapshot.rows.filter((row) => row.record)
    const days = studied.map((row) => ({ ticker: row.ticker, day: String(row.record?.lastUpdated ?? '') })).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d.day))
    const latest = [...days].sort((a, b) => b.day.localeCompare(a.day))[0] ?? null
    const today = new Date()
    const since = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
    const count = (pred: (row: (typeof studied)[number]) => boolean) => studied.filter(pred).length
    return {
      latest,
      thisYear: days.filter((d) => d.day.startsWith(String(today.getFullYear()))).length,
      last90: days.filter((d) => d.day >= since(90)).length,
      pastValid: count((row) => row.daysToValidThrough !== null && row.daysToValidThrough < 0),
      validSoon: count((row) => row.daysToValidThrough !== null && row.daysToValidThrough >= 0 && row.daysToValidThrough <= 30),
      below: count((row) => row.category === 'below-range'),
      inRange: count((row) => row.category === 'in-range' || row.category === 'approaching'),
      above: count((row) => row.category === 'above-range'),
    }
  })()
  const dayWord = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const timeOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null)

  return (
    <div className="grid gap-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(290px,340px)]">
      <div className="flex min-w-0 flex-col gap-5">
      {/* Like the other F9 views: a bold title, one grey line, the warnings as a chip */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">Study</h1>
          {subline && <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{subline}</p>}
        </div>
        {/* The status line, as on Overall: when it was loaded, then the warnings chip */}
        {snapshot && (
          <p className="flex flex-wrap items-center justify-end gap-1.5 text-right text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            <span title={snapshot.overallFetchedAt ? `Prices from Webull, ${formatLoadedAtBlock(snapshot.overallFetchedAt)}` : undefined}>
              {[`Loaded ${timeOnly(snapshot.loadedAt) ?? '—'}`, snapshot.overallFetchedAt ? `Webull ${timeOnly(snapshot.overallFetchedAt)}` : null].filter(Boolean).join(' · ')}
            </span>
            {snapshot.warnings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowWarnings((v) => !v)}
                aria-expanded={showWarnings}
                className="inline-flex h-[22px] items-center rounded-full px-2 font-medium text-amber-800 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.45)] transition-colors hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-500/10"
              >
                {snapshot.warnings.length} {snapshot.warnings.length === 1 ? 'warning' : 'warnings'}
              </button>
            )}
          </p>
        )}
      </header>

      {showWarnings && snapshot && snapshot.warnings.length > 0 && (
        <div className={cn(F9_PANEL_CLASS_BLOCK, 'px-4 py-3')}>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-zinc-600 dark:text-zinc-300">
            {snapshot.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {snapshot && snapshot.errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {snapshot.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}


      {snapshot && (
        // Stretches to the summary cards' height beside it, like Allocation on Overall
        <WebullStudyTimelineBlock rows={snapshot.rows} executionRoot={snapshot.executionRoot} onOpenStudyFile={onOpenStudyFile} />
      )}
      </div>

      {summary && (
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
          <F9PanelBlock className="px-5 pb-3 pt-[18px] text-[13px]">
            <p className="font-semibold">Studied</p>
            <p className="mt-2.5 text-2xl font-semibold tabular-nums">{studiedCount} {studiedCount === 1 ? 'business' : 'businesses'}</p>
            <p className="mb-1.5 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {summary.latest ? `Latest: ${summary.latest.ticker}, ${dayWord(summary.latest.day)}` : 'No study dated yet'}
            </p>
            <F9FactRowBlock divided label="This year" value={summary.thisYear} />
            <F9FactRowBlock label="Last 90 days" value={summary.last90} />
            <F9FactRowBlock
              divided
              label={<span title="Its valid-through date has passed">Due for another look</span>}
              value={summary.pastValid}
              tone={summary.pastValid > 0 ? 'down' : null}
              sub={summary.validSoon > 0 ? `${summary.validSoon} more within 30 days` : undefined}
            />
          </F9PanelBlock>
          <F9PanelBlock className="px-4 py-3.5 text-[13px]">
            <p className="mb-1 font-semibold">Price against the range</p>
            <F9FactRowBlock label="Below range" value={summary.below} />
            <F9FactRowBlock divided label="In range" value={summary.inRange} />
            <F9FactRowBlock divided label="Above range" value={summary.above} />
          </F9PanelBlock>
        </div>
      )}

      <div className="min-w-0 lg:col-span-2">
      <WebullStudyTableBlock
        rows={snapshot?.rows ?? []}
        executionRoot={snapshot?.executionRoot ?? ''}
        onOpenStudyFile={onOpenStudyFile}
      />
      </div>
    </div>
  )
}
