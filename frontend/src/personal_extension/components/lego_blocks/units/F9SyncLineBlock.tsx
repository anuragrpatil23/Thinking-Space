// The F9 sidebar's last line: how fresh your data is, in a sentence, and the one
// button that syncs yours. Clicking the line opens the sync panel: each kind of
// data with one mark per company of yours (fresh, due, failed, being fetched),
// what is happening right now, and a way to run anything, for yours or for the
// whole market. Everything shown is read off F9 sync's ledger (f9SyncOrch).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, RefreshCw, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useF9SyncBlock } from '../hooks/useF9AppSyncBlock'
import type {
  F9SyncCellStateBlock,
  F9SyncDatasetViewBlock,
  F9SyncEngineBlock,
  F9SyncSnapshotBlock,
} from '@/personal_extension/services/orchestrators/f9SyncOrch'
import type { F9SyncScopeBlock } from '@/personal_extension/services/lego_blocks/units/f9SyncPlanBlock'

/** "5:12 PM" today, "Mon 5:12 PM" this week, else "Nov 3" */
function whenBlock(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const INK = 'text-[#3b6fb6] dark:text-sky-400'
// Blue while usable; grey when not, in both themes (dark: alone would win over disabled:)
const ACTION = cn(INK, 'rounded-md hover:bg-sky-500/10 disabled:text-zinc-400 disabled:hover:bg-transparent dark:disabled:text-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50')

const CADENCE: Record<F9SyncDatasetViewBlock['cadence'], string> = {
  daily: 'after each trading day',
  weekly: 'once a week',
  monthly: 'once a month',
  'on-demand': 'only when you ask',
}

/** The whole state in one sentence, for the line and the panel's heading. */
function headlineBlock(snap: F9SyncSnapshotBlock): { text: string; tone: 'busy' | 'bad' | 'due' | 'good' | 'idle'; lastAt: string | null } {
  const lastAt = snap.datasets.map(d => d.yours.lastAt).filter((x): x is string => Boolean(x)).sort().pop() ?? null
  if (snap.run) return { text: `Syncing ${snap.run.done} of ${snap.run.total}`, tone: 'busy', lastAt }
  const failed = snap.datasets.reduce((n, d) => n + d.yours.failed, 0)
  if (failed > 0) return { text: `${failed} didn't update`, tone: 'bad', lastAt }
  const due = snap.datasets.reduce((n, d) => n + d.yours.due, 0)
  if (due > 0) return { text: lastAt ? `${due} to bring up to date` : 'Not synced yet', tone: 'due', lastAt }
  return lastAt ? { text: 'Up to date', tone: 'good', lastAt } : { text: 'Nothing to sync yet', tone: 'idle', lastAt }
}

const DOT: Record<ReturnType<typeof headlineBlock>['tone'], string> = {
  busy: 'bg-[#3b6fb6] dark:bg-sky-400 animate-pulse motion-reduce:animate-none',
  bad: 'bg-red-500',
  due: 'bg-amber-500',
  good: 'bg-emerald-500',
  idle: 'bg-zinc-300 dark:bg-zinc-600',
}

const CELL: Record<F9SyncCellStateBlock, string> = {
  fresh: 'bg-zinc-700 dark:bg-zinc-300',
  due: 'bg-zinc-300 dark:bg-zinc-700',
  never: 'bg-zinc-200 dark:bg-zinc-800',
  failed: 'bg-red-500',
  waiting: 'bg-sky-300 dark:bg-sky-800',
  working: 'bg-[#3b6fb6] dark:bg-sky-400 animate-pulse motion-reduce:animate-none',
}
const CELL_WORD: Record<F9SyncCellStateBlock, string> = { fresh: 'up to date', due: 'due', never: 'not fetched yet', failed: 'failed', waiting: 'waiting', working: 'fetching now' }

/** One mark per company of yours: the dataset's state at a glance, and which company is behind. */
function CellsBlock({ cells }: { cells: F9SyncDatasetViewBlock['cells'] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-[2px]" role="img" aria-label={`${cells.filter(c => c.state === 'fresh').length} of ${cells.length} up to date`}>
      {cells.map(c => <span key={c.ticker} title={`${c.ticker}: ${CELL_WORD[c.state]}`} className={cn('h-[9px] w-[5px] rounded-[1.5px]', CELL[c.state])} />)}
    </div>
  )
}

/** The whole market is too many for a mark each: one bar, split by share. */
function ShareBarBlock({ v }: { v: F9SyncDatasetViewBlock }) {
  const t = v.everyone
  const pct = (n: number) => `${t.total > 0 ? (n / t.total) * 100 : 0}%`
  return (
    <div className="mt-1.5 flex h-[5px] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="img" aria-label={`${t.fresh} of ${t.total} up to date`}>
      <span className="bg-zinc-700 dark:bg-zinc-300" style={{ width: pct(t.fresh) }} />
      <span className="bg-red-500" style={{ width: pct(t.failed) }} />
    </div>
  )
}

function DatasetRowBlock({ v, scope, canSync, onRun }: { v: F9SyncDatasetViewBlock; scope: F9SyncScopeBlock; canSync: boolean; onRun: () => void }) {
  const [open, setOpen] = useState(false)
  const tally = scope === 'yours' ? v.yours : v.everyone
  const failures = scope === 'yours' ? v.failures.filter(f => f.yours) : v.failures
  const busy = v.working !== null || v.waiting > 0
  const status = v.working !== null ? (v.working ? `Fetching ${v.working}` : 'Running')
    : v.waiting > 0 ? `${v.waiting} waiting`
      : tally.lastAt ? whenBlock(tally.lastAt) : 'Not yet'
  return (
    <div className="group -mx-2 rounded-lg px-2 py-2 hover:bg-zinc-500/[0.06]">
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] text-zinc-900 dark:text-zinc-100" title={`${v.about}. Runs ${CADENCE[v.cadence]}.`}>{v.label}</p>
        {tally.failed > 0 && !busy && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex shrink-0 items-center text-[11px] text-red-600 hover:underline focus:outline-none focus-visible:underline dark:text-red-400">
            {tally.failed} failed<ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
          </button>
        )}
        <span className={cn('shrink-0 text-[11px] tabular-nums', busy ? INK : 'text-zinc-500 dark:text-zinc-400')}>{status}</span>
        <button
          type="button"
          onClick={onRun}
          disabled={!canSync || !v.available || busy}
          aria-label={`Fetch ${v.label} now`}
          title={canSync ? `Fetch ${v.label.toLowerCase()} now, for ${scope === 'yours' ? 'your companies' : 'every watched company'}` : 'Fetching needs the desktop app'}
          className={cn(ACTION, 'shrink-0 self-center p-1 opacity-50 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30')}
        >
          <RefreshCw className={cn('h-3 w-3', v.working !== null && 'animate-spin motion-reduce:animate-none')} />
        </button>
      </div>
      {scope === 'yours' ? v.cells.length > 0 && <CellsBlock cells={v.cells} /> : tally.total > 1 && <ShareBarBlock v={v} />}
      {open && failures.length > 0 && (
        <ul className="mt-2 space-y-1 border-l border-red-500/40 pl-2.5">
          {failures.map(f => (
            <li key={f.ticker} className="flex gap-2 text-[11px] leading-snug">
              <span className="w-12 shrink-0 font-medium text-zinc-800 dark:text-zinc-200">{f.ticker || 'Job'}</span>
              <span className="min-w-0 flex-1 break-words text-zinc-500 dark:text-zinc-400">{f.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SyncPanelBlock({ engine, snap, anchor, onClose }: { engine: F9SyncEngineBlock; snap: F9SyncSnapshotBlock; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scope, setScope] = useState<F9SyncScopeBlock>('yours')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [onClose])
  const head = headlineBlock(snap)
  const rows = snap.datasets.filter(d => (scope === 'yours' ? d.yours.total > 0 : d.everyone.total > d.yours.total || d.yours.total === 0))
  const labelOf = (id: string) => snap.datasets.find(d => d.id === id)?.label ?? id
  const recent = snap.recent.slice(0, 6)
  const share = snap.run && snap.run.total > 0 ? snap.run.done / snap.run.total : 0
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Sync"
      className="fixed z-[90] flex max-h-[78vh] w-[364px] flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.35)] dark:border-white/10 dark:bg-zinc-900"
      style={{ left: anchor.left + 8, bottom: window.innerHeight - anchor.top + 6 }}
    >
      <div className="relative px-4 pb-3 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[15px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[head.tone])} />{head.text}
            </p>
            <p className="mt-0.5 truncate pl-4 text-[12px] text-zinc-500 dark:text-zinc-400">
              {snap.run
                ? snap.working.map(w => `${w.ticker || labelOf(w.dataset)}${w.ticker ? ` ${labelOf(w.dataset).toLowerCase()}` : ''}`).join(', ') || 'Starting'
                : !snap.canSync ? 'Fetching happens in the desktop app'
                  : head.lastAt ? `Yours last synced ${whenBlock(head.lastAt)}` : 'Runs by itself after each trading day'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {snap.run && (
              <button type="button" onClick={() => engine.stop()} className={cn(ACTION, 'inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium')}>
                <Square className="h-2.5 w-2.5 fill-current" />Stop
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-500/10 hover:text-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50 dark:hover:text-zinc-200"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {/* The run's progress, along the heading's lower edge */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-zinc-200 dark:bg-zinc-800">
          {snap.run && <div className="h-full bg-[#3b6fb6] transition-[width] duration-300 dark:bg-sky-400" style={{ width: `${Math.round(share * 100)}%` }} />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
        <div className="mb-1 flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-zinc-500/10 p-0.5 text-[12px]" role="tablist">
            {([['yours', `Yours ${snap.companies.yours}`], ['everyone', `Whole market ${snap.companies.everyone}`]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={scope === id}
                onClick={() => setScope(id)}
                className={cn('rounded-md px-2.5 py-1 tabular-nums focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50',
                  scope === id ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200')}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!snap.canSync}
            onClick={() => { void engine.syncNow(scope) }}
            title={scope === 'yours' ? 'What is due or failed for your companies, and a fresh quote' : 'What is due or failed for every watched company'}
            className={cn(ACTION, 'ml-auto px-2 py-1 text-[12px] font-medium')}
          >
            {scope === 'yours' ? 'Sync yours' : 'Sync the market'}
          </button>
        </div>

        {rows.map(v => (
          <DatasetRowBlock key={v.id} v={v} scope={scope} canSync={snap.canSync} onRun={() => { void engine.sync({ scope, mode: 'force', datasets: [v.id] }) }} />
        ))}

        {snap.notices.map(n => <p key={n} className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-300">{n}</p>)}

        {recent.length > 0 && (
          <div className="mt-3 border-t border-zinc-200 pt-2.5 dark:border-zinc-800">
            <p className="mb-1 text-[11px] text-zinc-500 dark:text-zinc-400">{snap.run ? 'Coming in' : 'Last came in'}</p>
            <ul className="space-y-0.5">
              {recent.map((e, i) => (
                <li key={`${e.at}${e.dataset}${e.ticker}${i}`} className="flex gap-2 text-[11px] leading-snug" title={e.detail}>
                  <span className="w-12 shrink-0 font-medium text-zinc-800 dark:text-zinc-200">{e.ticker || 'Job'}</span>
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{labelOf(e.dataset)}</span>
                  <span className={cn('min-w-0 flex-1 truncate text-right', e.state === 'failed' ? 'text-red-600 dark:text-red-400' : e.state === 'retrying' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400')}>
                    {e.state === 'failed' ? e.detail ?? 'failed' : e.state === 'retrying' ? 'will try again' : e.detail ?? (e.state === 'not-covered' ? 'not covered' : e.state === 'no-new' ? 'nothing new' : 'saved')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export function F9SyncLineBlock() {
  const { engine, snap } = useF9SyncBlock()
  const [open, setOpen] = useState(false)
  const lineRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  useLayoutEffect(() => { if (open && lineRef.current) setAnchor(lineRef.current.getBoundingClientRect()) }, [open])

  if (!engine || !snap?.ready || snap.datasets.length === 0) return null
  const head = headlineBlock(snap)
  const share = snap.run && snap.run.total > 0 ? snap.run.done / snap.run.total : 0

  return (
    <div ref={lineRef} className="relative flex items-center gap-1 border-t border-border/60 px-2 py-1.5 text-[11.5px]">
      {snap.run && (
        <div className="absolute inset-x-0 top-[-1px] h-px">
          <div className="h-full bg-[#3b6fb6] transition-[width] duration-300 dark:bg-sky-400" style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        // The panel closes on a click outside it; this button toggles it instead
        onMouseDown={e => e.stopPropagation()}
        aria-expanded={open}
        title={head.lastAt ? `Yours last synced ${whenBlock(head.lastAt)}. Open for every kind of data.` : 'Open for every kind of data'}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-zinc-600 hover:bg-zinc-500/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50 dark:text-zinc-300"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[head.tone])} />
        <span className="truncate tabular-nums">{head.text}</span>
      </button>
      <button
        type="button"
        disabled={!snap.canSync || Boolean(snap.run)}
        onClick={() => { void engine.syncNow('yours') }}
        title={snap.canSync ? `Bring your ${snap.companies.yours} companies up to date, with a fresh quote. The whole market is in the panel.` : 'Fetching needs the desktop app'}
        className={cn(ACTION, 'inline-flex shrink-0 items-center gap-1 px-1.5 py-1 font-medium')}
      >
        <RefreshCw className={cn('h-3 w-3', snap.run && 'animate-spin motion-reduce:animate-none')} />Sync yours
      </button>
      {open && anchor && createPortal(<SyncPanelBlock engine={engine} snap={snap} anchor={anchor} onClose={() => setOpen(false)} />, document.body)}
    </div>
  )
}
