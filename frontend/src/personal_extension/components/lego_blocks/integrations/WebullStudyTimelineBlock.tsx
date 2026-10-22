import { useMemo } from 'react'
import F9MonthTimelineBlock, { type F9TimelineItemBlock } from '@/personal_extension/components/lego_blocks/units/F9MonthTimelineBlock'
import TickerLogoBlock from '@/personal_extension/components/lego_blocks/units/TickerLogoBlock'
import type { WebullStudyRowOrch } from '@/personal_extension/services/orchestrators/webullStudyOrch'

// When each business was last studied, on F9's month strip.

export default function WebullStudyTimelineBlock({ rows, executionRoot, onOpenStudyFile }: {
  rows: WebullStudyRowOrch[]
  executionRoot: string
  onOpenStudyFile: (path: string) => void
}) {
  const items = useMemo<F9TimelineItemBlock[]>(() => rows
    .filter((row) => row.record?.lastUpdated)
    .map((row) => ({
      key: row.ticker,
      day: String(row.record!.lastUpdated),
      title: `${row.ticker} · studied`,
      mark: <TickerLogoBlock ticker={row.ticker} executionRoot={executionRoot} className="h-5 w-5 rounded-full" />,
      onOpen: () => onOpenStudyFile(row.record!.filePath),
    })), [executionRoot, onOpenStudyFile, rows])

  // Stretches to the summary cards' height beside it, like Allocation on Overall
  return <F9MonthTimelineBlock title="When you studied them" note="by month, latest study of each" items={items} className="flex-1" />
}
