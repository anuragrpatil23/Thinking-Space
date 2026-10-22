import { useMemo } from 'react'
import { F9PanelBlock } from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import TickerLogoBlock from '@/personal_extension/components/lego_blocks/units/TickerLogoBlock'
import type { WebullStudyRowOrch } from '@/personal_extension/services/orchestrators/webullStudyOrch'

// When each business was last studied, month by month: a column per month from
// the first study to now, the businesses stacked in it as their logos. Months
// with nothing stay as gaps in the row, which is the point.

const MONTHS_BLOCK = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthKeyBlock(day: string): string {
  return day.slice(0, 7)
}

export default function WebullStudyTimelineBlock({ rows, executionRoot, onOpenStudyFile }: {
  rows: WebullStudyRowOrch[]
  executionRoot: string
  onOpenStudyFile: (path: string) => void
}) {
  const months = useMemo(() => {
    const studied = rows
      .filter((row) => row.record?.lastUpdated && /^\d{4}-\d{2}-\d{2}/.test(row.record.lastUpdated))
      .map((row) => ({ ticker: row.ticker, day: row.record!.lastUpdated as string, path: row.record!.filePath }))
    if (studied.length === 0) return []
    const byMonth = new Map<string, typeof studied>()
    for (const s of studied) byMonth.set(monthKeyBlock(s.day), [...(byMonth.get(monthKeyBlock(s.day)) ?? []), s])
    // At least a year is shown, so a short history still reads as a year.
    const earliest = [...byMonth.keys()].sort()[0]
    const yearAgo = new Date()
    yearAgo.setMonth(yearAgo.getMonth() - 11)
    const yearAgoKey = `${yearAgo.getFullYear()}-${String(yearAgo.getMonth() + 1).padStart(2, '0')}`
    const first = earliest < yearAgoKey ? earliest : yearAgoKey
    const now = new Date()
    const last = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const out: Array<{ key: string; label: string; year: string | null; items: typeof studied }> = []
    let [y, m] = first.split('-').map(Number)
    for (let guard = 0; guard < 60; guard += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      out.push({
        key,
        label: MONTHS_BLOCK[m - 1],
        // The year under January and under the first month shown
        year: m === 1 || out.length === 0 ? String(y) : null,
        items: (byMonth.get(key) ?? []).sort((a, b) => b.day.localeCompare(a.day)),
      })
      if (key >= last) break
      m += 1
      if (m > 12) { m = 1; y += 1 }
    }
    return out
  }, [rows])

  if (months.length === 0) return null

  return (
    <F9PanelBlock className="flex flex-1 flex-col px-5 pb-3 pt-4 text-[13px]">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="font-semibold">When you studied them</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">by month, latest study of each</p>
      </div>
      {/* Months share the width on one baseline; a busy month wraps its logos into a
          low cluster rather than a tower. */}
      <div className="flex min-h-[200px] flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
        <div className="flex w-full items-stretch" style={{ minWidth: months.length * 64 }}>
          {months.map((month, index) => (
            <div key={month.key} className={index > 0 ? 'flex flex-1 flex-col border-l-[0.5px] border-[#F4F4F6] dark:border-zinc-800/60' : 'flex flex-1 flex-col'}>
              <div className="flex flex-1 flex-col items-center justify-end gap-1 px-2 pb-2 pt-1">
                {month.items.length > 0 && <span className="mb-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-100 px-1.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{month.items.length}</span>}
                <div className="flex flex-wrap items-end justify-center gap-1">
                {month.items.map((item) => (
                  <button
                    key={item.ticker}
                    type="button"
                    onClick={() => onOpenStudyFile(item.path)}
                    title={`${item.ticker} · studied ${new Date(`${item.day.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    className="rounded-full transition-transform hover:scale-110"
                  >
                    <TickerLogoBlock ticker={item.ticker} executionRoot={executionRoot} className="h-5 w-5 rounded-full" />
                  </button>
                ))}
                </div>
              </div>
              <div className="border-t-[0.5px] border-[#E5E5EA] pt-1.5 text-center dark:border-zinc-800">
                <span className={month.items.length > 0 ? 'text-[11px] text-zinc-700 dark:text-zinc-200' : 'text-[11px] text-zinc-300 dark:text-zinc-600'}>{month.label}</span>
                <span className="block h-3 text-[10px] tabular-nums text-zinc-400">{month.year ?? ''}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </F9PanelBlock>
  )
}
