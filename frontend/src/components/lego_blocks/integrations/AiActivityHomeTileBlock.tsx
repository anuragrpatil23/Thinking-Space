import { useMemo } from 'react'
import HomeTileBlock from '@/components/lego_blocks/units/HomeTileBlock'
import { useAiActivityBlock } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import { fmtDayMonthBlock } from '@/services/lego_blocks/units/aiActivityStripBlock'
import { fmtDurationMsBlock, mergedDurationMsBlock } from '@/services/lego_blocks/units/aiActivityStatsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'

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
  const { hostRef, isDark } = useDarkModeClassBlock()

  // The last seven days as bars: height is the day's tracked time, color is
  // the project that took most of it. The same two facts the full page's day
  // row carries, at a size that fits beside the date.
  const week = useMemo(() => {
    const byDate = new Map(activity.days.map(d => [d.date, d]))
    const end = new Date(activity.endIso + 'T00:00:00')
    const out: Array<{ date: string; ms: number; top: string | null }> = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end)
      d.setDate(d.getDate() - i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      let ms = 0
      let top: string | null = null
      let topMs = 0
      for (const [project, v] of Object.entries(byDate.get(iso)?.byChainProjectDurationMs ?? {})) {
        if (project.startsWith('[') && project.endsWith(']')) continue
        ms += v
        if (v > topMs) {
          topMs = v
          top = project
        }
      }
      out.push({ date: iso, ms, top })
    }
    const max = out.reduce((m, d) => Math.max(m, d.ms), 0)
    return out.map(d => ({ ...d, share: max > 0 ? d.ms / max : 0 }))
  }, [activity.days, activity.endIso])

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
    <div ref={hostRef} className="h-full">
      <HomeTileBlock label="AI activity" onOpen={onOpen}>
        <span className="mt-4 flex items-end justify-between gap-4">
          <span className="min-w-0">
            <span className="flex items-baseline gap-2 text-[28px] leading-none tracking-[-0.03em]">
              <span className="flex items-start text-foreground">
                <span className="font-semibold tabular-nums">{day}</span>
                <span className="ml-0.5 text-[13px] font-medium leading-none tracking-tight text-foreground/60">
                  {ordinal}
                </span>
              </span>
              <span className="font-normal text-foreground/40">{month}</span>
            </span>
            <span className="mt-2.5 block truncate text-[13px] text-muted-foreground">{line}</span>
          </span>
          <span aria-hidden className="flex h-[52px] shrink-0 items-end gap-[5px]">
            {week.map((d, i) => (
              <span
                key={d.date}
                className="w-[7px] rounded-full"
                style={{
                  // A stub for an empty day, so the week still reads as seven.
                  height: d.ms > 0 ? `${Math.max(12, d.share * 100)}%` : 4,
                  background: d.top ? getProjectColor(d.top, isDark).stroke : 'rgba(148,163,184,0.35)',
                  // Today at full strength, the days before it stepped back.
                  opacity: i === week.length - 1 ? 1 : 0.5,
                }}
              />
            ))}
          </span>
        </span>
      </HomeTileBlock>
    </div>
  )
}
