// The "AI read" box: what an AI took from something, set apart in violet so it
// is never mistaken for the source itself. One line closed; open, every point.
// The Feed article's summary box is the original; documents use this one.
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export default function AiReadBoxBlock({ lead, points = [], model, label = 'AI read', defaultOpen = false, className }: {
  /** The one line shown closed */
  lead: ReactNode
  /** Everything else, shown open */
  points?: ReactNode[]
  /** Who read it, for the label's tooltip */
  model?: string
  label?: string
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const more = points.length > 0
  return (
    <div className={cn('rounded-[10px] bg-violet-50/60 px-4 py-2.5 text-[12.5px] leading-snug text-zinc-700 dark:bg-violet-500/5 dark:text-zinc-200', className)}>
      <div className={cn('flex gap-2', open && more ? 'items-start' : 'items-center')}>
        <span className="shrink-0 rounded bg-violet-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title={model ? `Read by ${model}` : undefined}>{label}</span>
        <span className={cn('min-w-0 flex-1', !open && 'truncate')}>{lead}</span>
        {more && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setOpen(v => !v)}
            className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] leading-none text-violet-700 outline-none hover:bg-violet-100 focus-visible:ring-1 focus-visible:ring-violet-400 dark:text-violet-300 dark:hover:bg-violet-500/15"
          >
            {open ? 'Hide' : `+${points.length} more`}
          </button>
        )}
      </div>
      {open && more && (
        <ul className="mt-2 max-h-[45vh] list-disc space-y-1.5 overflow-y-auto pl-4 marker:text-violet-400">
          {points.map((point, i) => <li key={i}>{point}</li>)}
        </ul>
      )}
    </div>
  )
}
