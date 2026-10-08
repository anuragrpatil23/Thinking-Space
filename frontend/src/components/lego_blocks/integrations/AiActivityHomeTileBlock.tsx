import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAiActivityBlock } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import { fmtDayMonthBlock } from '@/services/lego_blocks/units/aiActivityStripBlock'
import { fmtDurationMsBlock, mergedDurationMsBlock } from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'

/**
 * Home's stand-in for the AI activity card on a phone: today's date and one
 * line about the day, the whole thing a button that opens the full page.
 *
 * Home on a phone is a column of things to glance at; the full card there was
 * several screens of tables inside it. The tile says what the card's first
 * screen said — which day, how much, mostly what — and leaves the rest a tap
 * away.
 */
export default function AiActivityHomeTileBlock({ onOpen }: { onOpen: () => void }) {
  const activity = useAiActivityBlock('90d')
  const { day, ordinal, month } = fmtDayMonthBlock(activity.endIso)

  const line = useMemo(() => {
    const chains = activity.todayChains
    if (activity.loading) return 'Loading…'
    if (chains.length === 0) return 'No sessions yet today'
    const byProject = new Map<string, typeof chains>()
    for (const c of chains) {
      const list = byProject.get(c.project)
      if (list) list.push(c)
      else byProject.set(c.project, [c])
    }
    let top: string | null = null
    let topMs = 0
    for (const [project, list] of byProject) {
      // Bracketed names are noise buckets, never "what today was about".
      if (project.startsWith('[') && project.endsWith(']')) continue
      const ms = mergedDurationMsBlock(list)
      if (ms > topMs) {
        topMs = ms
        top = project
      }
    }
    const total = fmtDurationMsBlock(mergedDurationMsBlock(chains))
    return top && byProject.size > 1
      ? `${total} today · mostly ${projectLabelBlock(top)}`
      : top
        ? `${total} today · ${projectLabelBlock(top)}`
        : `${total} today`
  }, [activity.todayChains, activity.loading])

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-foreground/40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
          AI activity
        </span>
        <span className="mt-2 flex items-baseline gap-2 text-[30px] leading-none tracking-[-0.03em]">
          <span className="flex items-start text-foreground">
            <span className="font-semibold tabular-nums">{day}</span>
            <span className="ml-0.5 text-[13px] font-medium leading-none tracking-tight text-foreground/60">
              {ordinal}
            </span>
          </span>
          <span className="font-normal text-foreground/40">{month}</span>
        </span>
        <span className="mt-2 block truncate text-[13px] text-muted-foreground">{line}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" aria-hidden />
    </button>
  )
}
