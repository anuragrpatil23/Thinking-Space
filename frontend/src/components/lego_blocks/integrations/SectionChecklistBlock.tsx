import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import MonthCalendar, { type DayData } from '@/components/lego_blocks/integrations/MonthCalendarBlock'
import SectionBreakdown, { type TagSelectorItem } from '@/components/lego_blocks/integrations/SectionBreakdownBlock'
import { useFileStats } from '@/components/lego_blocks/hooks/shared/useFileStatsBlock'
import MetricBlock from '@/components/lego_blocks/units/MetricBlock'
import TodoListPanelBlock, { type TodoDayGroup, type TodoDisplayItem } from '@/components/lego_blocks/integrations/TodoListPanelBlock'

interface ChecklistItem {
  text: string
  checked: boolean
  line: number
  file: string
  section: string
}

interface ChecklistMonthDay {
  date: string
  total: number
  done: number
  pending: number
}

interface ChecklistSection {
  name: string
  total: number
  done: number
  pending: number
}

interface ChecklistMonthData {
  year: number
  month: number
  days: ChecklistMonthDay[]
  total: number
  done: number
  pending: number
  sections: ChecklistSection[]
  section_days: Record<string, ChecklistMonthDay[]>
}

interface ChecklistSectionMonthDay {
  date: string
  items: ChecklistItem[]
}

interface ChecklistSectionMonthData {
  sections: string[]
  days: ChecklistSectionMonthDay[]
}

interface SectionCardGroup {
  section: string
  days: TodoDayGroup[]
}

interface SectionChecklistBlockProps {
  subjectTitle: string
  subjectPluralLower: string
  fetchMonthData: (year: number, month: number) => Promise<ChecklistMonthData>
  fetchSectionMonthData: (
    year: number,
    month: number,
    sections: string[],
  ) => Promise<ChecklistSectionMonthData>
  onToggleItem?: (item: ChecklistItem) => Promise<void>
  renderItemTextClassName?: (item: ChecklistItem) => string
}

function toTagItems(sections: ChecklistSection[]): TagSelectorItem[] {
  return sections.map((section) => ({
    name: section.name,
    metrics: [
      { label: `${section.done} done`, value: section.done, color: 'text-violet-600 dark:text-violet-400' },
      { label: `${section.pending} todo`, value: section.pending, color: 'text-orange-600 dark:text-orange-400' },
    ],
  }))
}

function buildCalendarDays(
  monthData: ChecklistMonthData | null,
  selectedSections: string[],
): DayData[] {
  if (!monthData) return []

  if (selectedSections.length > 0 && selectedSections.length < monthData.sections.length) {
    const merged: Record<string, { total: number; done: number; pending: number }> = {}
    for (const section of selectedSections) {
      const entries = monthData.section_days[section]
      if (!entries) continue
      for (const entry of entries) {
        if (!merged[entry.date]) merged[entry.date] = { total: 0, done: 0, pending: 0 }
        merged[entry.date].total += entry.total
        merged[entry.date].done += entry.done
        merged[entry.date].pending += entry.pending
      }
    }
    const maxTotal = Math.max(1, ...Object.values(merged).map((day) => day.total))
    return monthData.days.map((day) => {
      const mergedDay = merged[day.date]
      if (!mergedDay) return { date: day.date, intensity: 0 }
      const indicators: DayData['indicators'] = []
      if (mergedDay.done > 0) indicators.push({ color: '#8b5cf6', label: `${mergedDay.done}` })
      if (mergedDay.pending > 0) indicators.push({ color: '#f97316', label: `${mergedDay.pending}` })
      return { date: day.date, intensity: mergedDay.total / maxTotal, indicators }
    })
  }

  const maxTotal = Math.max(1, ...monthData.days.map((day) => day.total))
  return monthData.days.map((day) => {
    const indicators: DayData['indicators'] = []
    if (day.done > 0) indicators.push({ color: '#8b5cf6', label: `${day.done}` })
    if (day.pending > 0) indicators.push({ color: '#f97316', label: `${day.pending}` })
    return { date: day.date, intensity: day.total / maxTotal, indicators }
  })
}

function groupCards(
  sectionData: ChecklistSectionMonthData | null,
  selectedDate: string | null,
): SectionCardGroup[] {
  if (!sectionData) return []

  const bySection: Record<string, Array<{ date: string; items: TodoDayGroup['items'] }>> = {}
  for (const day of sectionData.days) {
    if (selectedDate && day.date !== selectedDate) continue
    for (const item of day.items) {
      if (!bySection[item.section]) bySection[item.section] = []
      let dateGroup = bySection[item.section].find((group) => group.date === day.date)
      if (!dateGroup) {
        dateGroup = { date: day.date, items: [] }
        bySection[item.section].push(dateGroup)
      }
      dateGroup.items.push(item)
    }
  }

  return Object.entries(bySection)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, days]) => ({ section, days }))
}

function toggleItemState(
  data: ChecklistSectionMonthData | null,
  target: TodoDisplayItem,
): ChecklistSectionMonthData | null {
  if (!data) return data
  return {
    ...data,
    days: data.days.map((day) => ({
      ...day,
      items: day.items.map((item) =>
        item.file === target.file && item.line === target.line
          ? { ...item, checked: !item.checked }
          : item,
      ),
    })),
  }
}

export default function SectionChecklistBlock({
  subjectTitle,
  subjectPluralLower,
  fetchMonthData,
  fetchSectionMonthData,
  onToggleItem,
}: SectionChecklistBlockProps) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const [monthData, setMonthData] = useState<ChecklistMonthData | null>(null)
  const [monthLoading, setMonthLoading] = useState(true)

  const [selectedSections, setSelectedSections] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const [sectionData, setSectionData] = useState<ChecklistSectionMonthData | null>(null)
  const [sectionLoading, setSectionLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [showStats, setShowStats] = useState(false)

  useEffect(() => {
    setMonthLoading(true)
    setMonthData(null)
    setError(null)
    fetchMonthData(year, month)
      .then((data) => {
        setMonthData(data)
        setSelectedSections(data.sections.map((section) => section.name))
      })
      .catch((err) => setError((err as Error).message || 'Failed to load data'))
      .finally(() => setMonthLoading(false))
  }, [fetchMonthData, month, year])

  useEffect(() => {
    if (selectedSections.length === 0) {
      setSectionData(null)
      return
    }
    setSectionLoading(true)
    setSectionData(null)
    fetchSectionMonthData(year, month, selectedSections)
      .then((data) => setSectionData(data))
      .catch(() => setSectionData(null))
      .finally(() => setSectionLoading(false))
  }, [fetchSectionMonthData, month, selectedSections, year])

  const handleMonthChange = useCallback((nextYear: number, nextMonth: number) => {
    setYear(nextYear)
    setMonth(nextMonth)
    setSelectedSections([])
    setSelectedDate(null)
  }, [])

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate((prev) => (prev === date ? null : date))
  }, [])

  const calendarDays = useMemo(
    () => buildCalendarDays(monthData, selectedSections),
    [monthData, selectedSections],
  )

  const activeDays = useMemo(() => {
    if (!monthData) return 0
    return monthData.days.filter((day) => day.total > 0).length
  }, [monthData])

  const tagItems = useMemo(() => {
    if (!monthData) return []
    return toTagItems(monthData.sections)
  }, [monthData])

  const monthLabel = useMemo(
    () => new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    [month, year],
  )

  const sectionCards = useMemo(
    () => groupCards(sectionData, selectedDate),
    [sectionData, selectedDate],
  )

  const filePaths = useMemo(() => {
    if (!sectionData) return []
    const unique = new Set<string>()
    for (const day of sectionData.days) {
      for (const item of day.items) unique.add(item.file)
    }
    return Array.from(unique)
  }, [sectionData])

  const fileStats = useFileStats(filePaths)

  const handleToggle = useCallback(
    async (item: TodoDisplayItem) => {
      if (!onToggleItem) return
      setSectionData((prev) => toggleItemState(prev, item))
      try {
        // ChecklistItem is a superset of TodoDisplayItem; safe cast since section is not needed for toggle
        await onToggleItem(item as ChecklistItem)
      } catch {
        setSectionData((prev) => toggleItemState(prev, item))
      }
    },
    [onToggleItem],
  )

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  return (
    <div className="flex gap-6 items-start">
      <div className="w-64 shrink-0 sticky top-24 space-y-4 hidden lg:block">
        <Card className="shadow-none border-border/30">
          <CardContent className="p-3">
            <MonthCalendar
              year={year}
              month={month}
              days={calendarDays}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              onMonthChange={handleMonthChange}
              loading={monthLoading}
              colorScale="violet"
              compact
            />
            <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/20 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-violet-500" />
                Done
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-orange-500" />
                Pending
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-5">
        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="lg:hidden">
          <Card>
            <CardContent className="pt-5 pb-4">
              <MonthCalendar
                year={year}
                month={month}
                days={calendarDays}
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                onMonthChange={handleMonthChange}
                loading={monthLoading}
                colorScale="violet"
              />
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" />
                  Done
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-500" />
                  Pending
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {monthData && !monthLoading && (
          <Card>
            <CardHeader>
              <CardTitle>Month Summary</CardTitle>
              <CardDescription>
                {subjectTitle} for {monthLabel}
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate(null)}
                    className="ml-2 text-primary hover:underline"
                  >
                    Clear date filter
                  </button>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <MetricBlock label="Total items" value={monthData.total} />
                <MetricBlock label="Done" value={monthData.done} className="text-violet-600 dark:text-violet-400" />
                <MetricBlock label="Pending" value={monthData.pending} className="text-orange-600 dark:text-orange-400" />
                <MetricBlock label="Active days" value={activeDays} />
              </div>

              {monthData.sections.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-muted-foreground">By section</h4>
                    {selectedSections.length > 0 && selectedSections.length < monthData.sections.length && (
                      <button
                        onClick={() => setSelectedSections(monthData.sections.map((section) => section.name))}
                        className="text-xs text-primary hover:underline"
                      >
                        Select all
                      </button>
                    )}
                  </div>
                  <SectionBreakdown
                    items={tagItems}
                    multiSelect
                    selected={selectedSections}
                    onSelect={setSelectedSections}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(sectionLoading || (sectionData && !sectionLoading && sectionCards.length > 0)) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {selectedDate && (
                <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                  Showing: {formatDate(selectedDate)}
                </span>
              )}
              <button
                onClick={() => setShowStats((prev) => !prev)}
                className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  showStats
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border/40 bg-muted/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                <Info className="h-3 w-3" />
                Stats
              </button>
            </div>

            {sectionLoading && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="pt-5 space-y-2">
                      <div className="h-5 w-24 animate-pulse rounded bg-muted/40" />
                      <div className="h-4 w-full animate-pulse rounded bg-muted/30" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-muted/30" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {sectionData && !sectionLoading && sectionCards.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {sectionCards.map(({ section, days }) => (
                  <Card key={section} className="overflow-hidden">
                    <CardContent className="pt-4 pb-4">
                      <TodoListPanelBlock
                        section={section}
                        days={days}
                        onToggle={onToggleItem ? handleToggle : undefined}
                        showStats={showStats}
                        fileStats={fileStats}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {sectionData && !sectionLoading && sectionCards.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {selectedDate
                ? `No ${subjectPluralLower} found for ${formatDate(selectedDate)}.`
                : `No ${subjectPluralLower} found for the selected sections this month.`}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
