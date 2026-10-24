import { cn } from '@/lib/utils'
import { PASS_ITEM_LABELS_BLOCK, type PassItemBlock, type PassItemStateBlock } from '@/services/lego_blocks/units/passQueueBlock'

// What is happening first: the company being fetched, then failures, then
// what was saved; the quiet outcomes after.
const ORDER_BLOCK: PassItemStateBlock[] = ['working', 'failed', 'retrying', 'fetched', 'waiting', 'no-new', 'not-covered', 'skipped']

const TONE_BLOCK: Record<PassItemStateBlock, string> = {
  working: 'text-sky-600 dark:text-sky-400',
  failed: 'text-red-600 dark:text-red-400',
  retrying: 'text-amber-700 dark:text-amber-400',
  fetched: 'text-emerald-600 dark:text-emerald-400',
  waiting: 'text-zinc-400',
  'no-new': 'text-zinc-500 dark:text-zinc-400',
  'not-covered': 'text-zinc-400',
  skipped: 'text-zinc-400',
}

/** One pass's queue: each company (or article), where it stands, and what came of it. */
export function PassQueueListBlock({ items }: { items: PassItemBlock[] }) {
  // Articles need the width for their headline; companies fit three to a row
  const wide = items.some(item => item.label)
  if (items.length === 0) return <p className="mt-1.5 text-[11px] text-zinc-400">Nothing in this pass.</p>
  const sorted = [...items].sort((a, b) => ORDER_BLOCK.indexOf(a.state) - ORDER_BLOCK.indexOf(b.state))
  return (
    <div className={cn('mt-2 grid max-h-64 gap-x-6 gap-y-1 overflow-y-auto rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/40', wide ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {sorted.map(item => (
        <div key={item.ticker} className="flex min-w-0 items-baseline gap-2 text-[12px]" title={item.detail}>
          <span className={cn('shrink-0 font-medium tabular-nums text-zinc-800 dark:text-zinc-100', item.label ? 'min-w-0 max-w-[60%] truncate' : 'w-12')} title={item.label}>{item.label ?? item.ticker}</span>
          <span className={cn('shrink-0', TONE_BLOCK[item.state], item.state === 'working' && 'animate-pulse')}>{PASS_ITEM_LABELS_BLOCK[item.state]}</span>
          {item.detail && <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">{item.detail}</span>}
        </div>
      ))}
    </div>
  )
}
