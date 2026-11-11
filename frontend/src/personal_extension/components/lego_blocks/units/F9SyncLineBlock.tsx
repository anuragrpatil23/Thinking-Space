// The F9 sidebar's last line: how fresh your data is, in a sentence, and the one
// button that syncs yours. Clicking the line opens the sync sheet, the one place
// for everything about syncing:
//   Yours / Whole market  each kind of data with one mark per company of yours
//                         (fresh, due, failed, being fetched), what is coming in,
//                         and a way to run anything;
//   Webull account        the account sync behind the positions: its warnings,
//                         accounts, endpoints and log (handed in by the F9 page).
// Market data is read off F9 sync's ledger (f9SyncOrch). The sentence is about
// yours: the rest of the market catching up behind it is said quietly, in
// companies, never as a count of fetches.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
import type { F9SyncScopeBlock, F9SyncTallyBlock } from '@/personal_extension/services/lego_blocks/units/f9SyncPlanBlock'

type SheetTabBlock = F9SyncScopeBlock | 'account'

/** The Webull account's own sync, shown as the sheet's third tab. */
export interface F9SyncAccountBlock {
  details: ReactNode
  warnings: number
  fetchedAt: string | null
}

const OPEN_EVENT = 'ltm:f9-sync-open'
/** Open the sync sheet from anywhere on the F9 page (a header's warnings chip), on a given tab. */
export function openF9SyncPanelBlock(tab: SheetTabBlock = 'yours'): void {
  window.dispatchEvent(new CustomEvent<SheetTabBlock>(OPEN_EVENT, { detail: tab }))
}

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
  'six-hours': 'every six hours',
  weekly: 'once a week',
  monthly: 'once a month',
  'on-demand': 'only when you ask',
}

const companiesBlock = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'company' : 'companies'}`

/**
 * The state of yours in one sentence, for the line and the sheet's heading, and
 * a second line for what else is going on (the market catching up, when it last synced).
 */
function headlineBlock(snap: F9SyncSnapshotBlock): { text: string; tone: 'busy' | 'bad' | 'due' | 'good' | 'idle'; lastAt: string | null; sub: string } {
  const lastAt = snap.datasets.map(d => d.yours.lastAt).filter((x): x is string => Boolean(x)).sort().pop() ?? null
  if (snap.run && snap.left.yours > 0) return { text: 'Syncing your businesses', tone: 'busy', lastAt, sub: `${companiesBlock(snap.left.yours)} to go` }
  const sub = snap.run ? `The rest of the market is catching up in the background: ${companiesBlock(snap.left.others)} to go`
    : !snap.canSync ? 'Fetching happens in the desktop app'
      : lastAt ? `Last synced ${whenBlock(lastAt)}. Runs by itself after each trading day.` : 'Runs by itself after each trading day'
  const failed = snap.datasets.reduce((n, d) => n + d.yours.failed, 0)
  if (failed > 0) return { text: `${failed} didn't update`, tone: 'bad', lastAt, sub }
  const due = new Set(snap.datasets.flatMap(d => d.cells.filter(c => c.state === 'due').map(c => c.ticker))).size
  if (due > 0) return { text: lastAt ? `${companiesBlock(due)} to bring up to date` : 'Not synced yet', tone: 'due', lastAt, sub }
  return lastAt ? { text: 'Your businesses are up to date', tone: 'good', lastAt, sub } : { text: 'Nothing to sync yet', tone: 'idle', lastAt, sub }
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
function ShareBarBlock({ t }: { t: F9SyncTallyBlock }) {
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
  const waiting = scope === 'yours' ? v.waitingYours : v.waiting
  // On Yours, a company of someone else's being fetched is not this row's business
  const mine = v.working !== null && v.cells.some(c => c.ticker === v.working)
  const fetching = v.working !== null && (scope === 'everyone' || mine)
  const busy = fetching || waiting > 0
  const status = fetching ? (v.working ? `Fetching ${v.working}` : 'Running')
    : waiting > 0 ? `${waiting} waiting`
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
          title={canSync ? `Fetch ${v.label.toLowerCase()} now, for ${scope === 'yours' ? 'your businesses' : 'the whole market'}` : 'Fetching needs the desktop app'}
          className={cn(ACTION, 'shrink-0 self-center p-1 opacity-50 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30')}
        >
          <RefreshCw className={cn('h-3 w-3', fetching && 'animate-spin motion-reduce:animate-none')} />
        </button>
      </div>
      {scope === 'yours' ? v.cells.length > 0 && <CellsBlock cells={v.cells} /> : tally.total > 1 && <ShareBarBlock t={tally} />}
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

function SyncPanelBlock({ engine, snap, anchor, account, tab, onTab, onClose }: {
  engine: F9SyncEngineBlock
  snap: F9SyncSnapshotBlock
  anchor: DOMRect
  account?: F9SyncAccountBlock
  tab: SheetTabBlock
  onTab: (tab: SheetTabBlock) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [onClose])
  const head = headlineBlock(snap)
  const scope: F9SyncScopeBlock = tab === 'everyone' ? 'everyone' : 'yours'
  const rows = snap.datasets.filter(d => d.id !== 'webull-account' && (scope === 'yours' ? d.yours.total > 0 : d.everyone.total > d.yours.total))
  const webull = snap.datasets.find(d => d.id === 'webull-account')
  const webullFailure = webull?.failures[0] ?? null
  const webullBusy = Boolean(webull && (webull.working !== null || webull.waiting > 0))
  const labelOf = (id: string) => snap.datasets.find(d => d.id === id)?.label ?? id
  // What came in, one entry per company (newest first), each with its kinds of data in the panel's order.
  // My businesses lists only yours; Whole market lists everything, yours included.
  const order = new Map(snap.datasets.map((d, i) => [d.id, i]))
  const byCompany = new Map<string, { at: string; events: typeof snap.recent }>()
  for (const e of snap.recent) {
    if (scope === 'yours' && !e.yours) continue
    const group = byCompany.get(e.ticker) ?? { at: e.at, events: [] }
    // Newest first: a later result for the same kind of data replaces the earlier one
    if (!group.events.some(x => x.dataset === e.dataset)) group.events.push(e)
    byCompany.set(e.ticker, group)
  }
  const recent = [...byCompany.entries()].slice(0, 30)
    .map(([ticker, g]) => ({ ticker, at: g.at, events: [...g.events].sort((a, b) => (order.get(a.dataset) ?? 99) - (order.get(b.dataset) ?? 99)) }))
  const wordBlock = (e: (typeof snap.recent)[number]) =>
    e.state === 'failed' ? e.detail ?? 'Failed' : e.state === 'retrying' ? `Will try again${e.detail ? `: ${e.detail}` : ''}`
      : e.detail ?? (e.state === 'not-covered' ? 'Not covered' : e.state === 'no-new' ? 'Nothing new' : 'Saved')
  const share = snap.run && snap.run.total > 0 ? snap.run.done / snap.run.total : 0
  const tabs: Array<[SheetTabBlock, string]> = [
    ['yours', `My businesses ${snap.companies.yours}`],
    ['everyone', `Whole market ${snap.companies.everyone}`],
    ...(account ? [['account', 'Webull account'] as [SheetTabBlock, string]] : []),
  ]
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Sync"
      className="fixed z-[90] flex max-h-[min(760px,82vh)] min-h-[380px] w-[min(940px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_24px_70px_-12px_rgba(0,0,0,0.45)] dark:border-white/10 dark:bg-zinc-900"
      style={{ left: Math.max(16, Math.min(anchor.left + 8, window.innerWidth - 956)), bottom: window.innerHeight - anchor.top + 6 }}
    >
      <div className="relative px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[17px] font-semibold text-zinc-900 dark:text-zinc-50">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[head.tone])} />{head.text}
            </p>
            <p className="mt-0.5 truncate pl-4 text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{head.sub}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {snap.run && (
              <button type="button" onClick={() => engine.stop()} title="End this sync after the companies being fetched; the rest stays due" className={cn(ACTION, 'inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium')}>
                <Square className="h-2.5 w-2.5 fill-current" />Stop
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-500/10 hover:text-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50 dark:hover:text-zinc-200"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-zinc-500/10 p-0.5 text-[12px]" role="tablist">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => onTab(id)}
                className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 tabular-nums focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50',
                  tab === id ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200')}
              >
                {label}
                {id === 'account' && account && account.warnings > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300">{account.warnings}</span>}
              </button>
            ))}
          </div>
          {tab !== 'account' && (
            <button
              type="button"
              disabled={!snap.canSync}
              onClick={() => { void engine.syncNow(scope) }}
              title={scope === 'yours' ? 'What is due or failed for your businesses, and a fresh quote' : 'What is due or failed for every watched company, yours included'}
              className={cn(ACTION, 'ml-auto px-2 py-1 text-[12px] font-medium')}
            >
              {scope === 'yours' ? 'Sync my businesses' : 'Sync the whole market'}
            </button>
          )}
        </div>
        {/* The run's progress, along the heading's lower edge */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-zinc-200 dark:bg-zinc-800">
          {snap.run && <div className="h-full bg-[#3b6fb6] transition-[width] duration-300 dark:bg-sky-400" style={{ width: `${Math.round(share * 100)}%` }} />}
        </div>
      </div>

      {tab === 'account' && account ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1 text-[12px] leading-snug">
              <p className="text-zinc-700 dark:text-zinc-300">
                {webullBusy ? 'Pulling from Webull…' : account.fetchedAt ? `Positions last pulled from Webull ${whenBlock(account.fetchedAt)}.` : 'Positions have not been pulled from Webull yet.'}
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">Pulled every six hours in the background, and when Overall Positions opens after half an hour. It never asks Webull to sign in again on its own.</p>
              {webullFailure && !webullBusy && <p className="mt-1 text-red-600 dark:text-red-400">{webullFailure.error}</p>}
            </div>
            <button
              type="button"
              disabled={!webull?.available || webullBusy}
              onClick={() => { void engine.sync({ scope: 'everyone', mode: 'force', datasets: ['webull-account'] }) }}
              title="Pull positions and balances now. If the sign-in has run out, Webull sends a prompt to your phone."
              className={cn(ACTION, 'inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[12px] font-medium')}
            >
              <RefreshCw className={cn('h-3 w-3', webullBusy && 'animate-spin motion-reduce:animate-none')} />Pull from Webull
            </button>
          </div>
          {account.details}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {rows.map(v => (
              <DatasetRowBlock key={v.id} v={v} scope={scope} canSync={snap.canSync} onRun={() => { void engine.sync({ scope, mode: 'force', datasets: [v.id] }) }} />
            ))}
            {snap.notices.map(n => <p key={n} className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-300">{n}</p>)}
          </div>
          <div className="min-h-0 shrink-0 overflow-y-auto border-t border-zinc-200 px-5 py-3 md:w-[340px] md:border-l md:border-t-0 dark:border-zinc-800">
            <p className="mb-1.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">{snap.run ? 'Coming in' : 'Last came in'}</p>
            {recent.length === 0 && <p className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">Nothing yet. Each company shows here, with what was saved for it.</p>}
            <ul className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
              {recent.map(g => (
                <li key={g.ticker} className="py-2 first:pt-0.5">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-zinc-900 dark:text-zinc-100">{g.ticker || 'Value Line back issues'}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{whenBlock(g.at)}</span>
                  </p>
                  <dl className="mt-0.5 space-y-0.5">
                    {g.events.map(e => (
                      <div key={e.dataset} className="flex items-baseline gap-2 text-[11.5px] leading-snug">
                        <dt className="w-[104px] shrink-0 truncate text-zinc-500 dark:text-zinc-400" title={labelOf(e.dataset)}>{labelOf(e.dataset)}</dt>
                        <dd className={cn('min-w-0 flex-1 break-words', e.state === 'failed' ? 'text-red-600 dark:text-red-400' : e.state === 'retrying' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300')}>{wordBlock(e)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export function F9SyncLineBlock({ account }: { account?: F9SyncAccountBlock }) {
  const { engine, snap } = useF9SyncBlock()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<SheetTabBlock>('yours')
  useEffect(() => {
    const onOpen = (e: Event) => {
      setTab((e as CustomEvent<SheetTabBlock>).detail ?? 'yours')
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])
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
        title={`${head.sub}. Open for every kind of data.`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-zinc-600 hover:bg-zinc-500/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50 dark:text-zinc-300"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[head.tone])} />
        <span className="truncate">{head.text.replace(/^Your businesses are u/, 'U').replace(/ your businesses$/, '')}</span>
        {account && account.warnings > 0 && <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300" title={`${account.warnings} Webull ${account.warnings === 1 ? 'warning' : 'warnings'}`}>{account.warnings}</span>}
      </button>
      <button
        type="button"
        disabled={!snap.canSync || (Boolean(snap.run) && snap.left.yours > 0)}
        onClick={() => { void engine.syncNow('yours') }}
        title={snap.canSync ? `Bring your ${snap.companies.yours} businesses up to date, with a fresh quote. The whole market is in the sheet.` : 'Fetching needs the desktop app'}
        className={cn(ACTION, 'inline-flex shrink-0 items-center gap-1 px-1.5 py-1 font-medium')}
      >
        <RefreshCw className={cn('h-3 w-3', snap.run && snap.left.yours > 0 && 'animate-spin motion-reduce:animate-none')} />Sync mine
      </button>
      {open && anchor && createPortal(<SyncPanelBlock engine={engine} snap={snap} anchor={anchor} account={account} tab={tab} onTab={setTab} onClose={() => setOpen(false)} />, document.body)}
    </div>
  )
}
