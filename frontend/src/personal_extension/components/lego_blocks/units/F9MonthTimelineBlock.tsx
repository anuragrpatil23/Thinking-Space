import { useMemo, useState, type ReactNode } from 'react'
import { F9PanelBlock, F9SegmentedBlock } from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'

// F9's month strip: a column per month on one baseline, each thing that
// happened that month as its mark (a logo, a theme's dot), a light count above.
// Months with nothing stay as quiet slots, which is the point. Used by Study
// (when studied), Noticed (when noticed) and Gaps (when written).
// One calendar year at a time (Jan–Dec), with a year toggle once there is more
// than one; it opens on the latest year with anything in it.

const MONTHS_BLOCK = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_MIN_WIDTH_BLOCK = 64

export interface F9TimelineItemBlock {
  key: string
  /** YYYY-MM-DD */
  day: string
  /** Shown on hover, after the date. */
  title: string
  mark: ReactNode
  onOpen?: () => void
}

function monthKeyBlock(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export default function F9MonthTimelineBlock({ title, note, items, className }: {
  title: string
  note?: string
  items: F9TimelineItemBlock[]
  className?: string
}) {
  const dated = useMemo(() => items.filter((item) => /^\d{4}-\d{2}-\d{2}/.test(item.day)), [items])
  // One year at a time, Jan to Dec; the toggle shows only years with something in them.
  const years = useMemo(() => [...new Set(dated.map((item) => item.day.slice(0, 4)))].sort(), [dated])
  const [pickedYear, setPickedYear] = useState<string | null>(null)
  const year = pickedYear && years.includes(pickedYear) ? pickedYear : (years[years.length - 1] ?? String(new Date().getFullYear()))

  const months = useMemo(() => {
    const byMonth = new Map<string, F9TimelineItemBlock[]>()
    for (const item of dated) byMonth.set(item.day.slice(0, 7), [...(byMonth.get(item.day.slice(0, 7)) ?? []), item])
    const nowKey = monthKeyBlock(new Date())
    return MONTHS_BLOCK.map((label, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`
      return {
        key,
        label,
        future: key > nowKey,
        items: (byMonth.get(key) ?? []).sort((a, b) => b.day.localeCompare(a.day)),
      }
    })
  }, [dated, year])

  if (dated.length === 0) return null

  const dayWord = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <F9PanelBlock className={`flex flex-col px-5 pb-3 pt-4 text-[13px] ${className ?? ''}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">{title}</p>
        <div className="flex items-center gap-3">
          {note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{note}</p>}
          {years.length > 1 && (
            <F9SegmentedBlock ariaLabel="Year" value={year} onChange={setPickedYear} options={years.map((y) => ({ value: y, label: y }))} />
          )}
        </div>
      </div>
      <div className="flex min-h-[200px] flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
        <div className="flex w-full items-stretch" style={{ minWidth: months.length * MONTH_MIN_WIDTH_BLOCK }}>
          {months.map((month, index) => (
            <div key={month.key} className={index > 0 ? 'flex flex-1 flex-col border-l-[0.5px] border-[#F4F4F6] dark:border-zinc-800/60' : 'flex flex-1 flex-col'}>
              <div className="flex flex-1 flex-col items-center justify-end gap-1 px-2 pb-2 pt-1">
                {month.items.length > 0 && (
                  <span className="mb-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-100 px-1.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {month.items.length}
                  </span>
                )}
                <div className="flex flex-wrap items-end justify-center gap-1">
                  {month.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.onOpen}
                      disabled={!item.onOpen}
                      title={`${item.title} · ${dayWord(item.day)}`}
                      className="rounded-full transition-transform enabled:hover:scale-110"
                    >
                      {item.mark}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t-[0.5px] border-[#E5E5EA] py-1.5 text-center dark:border-zinc-800">
                <span className={month.items.length > 0 ? 'text-[11px] text-zinc-700 dark:text-zinc-200' : month.future ? 'text-[11px] text-zinc-200 dark:text-zinc-700' : 'text-[11px] text-zinc-300 dark:text-zinc-600'}>{month.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </F9PanelBlock>
  )
}
