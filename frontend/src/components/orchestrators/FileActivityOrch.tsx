import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/lego_blocks/units/ui/card'
import MonthCalendar, { type DayData } from '@/components/lego_blocks/integrations/MonthCalendarBlock'
import SectionBreakdown, { sectionsToTagItems } from '@/components/lego_blocks/integrations/SectionBreakdownBlock'
import { buildFileTree, FileTreeView } from '@/components/lego_blocks/integrations/FileTreeBlock'
import MetricBlock from '@/components/lego_blocks/units/MetricBlock'
import { getMonthActivity, getDayActivity, getSectionMonthActivity } from '@/services/orchestrators/fileActivityOrch'
import type { DayDetail, MonthData, SectionMonthData } from '@/services/lego_blocks/units/typesBlock'

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatShortDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FileActivityOrch() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [monthData, setMonthData] = useState<MonthData | null>(null)
  const [monthLoading, setMonthLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [sectionMonthData, setSectionMonthData] = useState<SectionMonthData | null>(null)
  const [sectionMonthLoading, setSectionMonthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch month data
  useEffect(() => {
    setMonthLoading(true)
    setMonthData(null)
    setError(null)
    getMonthActivity(year, month)
      .then(data => setMonthData(data))
      .catch(err => {
        setMonthData(null)
        setError(err.message || 'Failed to load data')
      })
      .finally(() => setMonthLoading(false))
  }, [year, month])

  // Fetch day detail
  useEffect(() => {
    if (!selectedDate) {
      setDayDetail(null)
      return
    }
    setDayLoading(true)
    setDayDetail(null)
    getDayActivity(selectedDate)
      .then(data => setDayDetail(data))
      .catch(() => setDayDetail(null))
      .finally(() => setDayLoading(false))
  }, [selectedDate])

  // Fetch section-month detail (section selected, no day clicked)
  useEffect(() => {
    if (!selectedSection || selectedDate) {
      setSectionMonthData(null)
      return
    }
    setSectionMonthLoading(true)
    setSectionMonthData(null)
    getSectionMonthActivity(year, month, selectedSection)
      .then(data => setSectionMonthData(data))
      .catch(() => setSectionMonthData(null))
      .finally(() => setSectionMonthLoading(false))
  }, [selectedSection, selectedDate, year, month])

  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
    setSelectedDate(null)
    setSelectedSection(null)
  }, [])

  // Calendar days: filter by section if one is selected
  const calendarDays: DayData[] = useMemo(() => {
    if (!monthData) return []

    if (selectedSection && monthData.section_days[selectedSection]) {
      const sectionEntries = monthData.section_days[selectedSection]
      const sMap = new Map(sectionEntries.map(d => [d.date, d]))
      const maxTotal = Math.max(1, ...sectionEntries.map(d => d.created + d.modified))

      return monthData.days.map(d => {
        const sd = sMap.get(d.date)
        if (!sd) return { date: d.date, intensity: 0 }
        const total = sd.created + sd.modified
        const indicators: DayData['indicators'] = []
        if (sd.created > 0) indicators.push({ color: '#10b981', label: `${sd.created}` })
        if (sd.modified > 0) indicators.push({ color: '#3b82f6', label: `${sd.modified}` })
        return { date: d.date, intensity: total / maxTotal, indicators }
      })
    }

    const maxTotal = Math.max(1, ...monthData.days.map(d => d.created + d.modified))
    return monthData.days.map(d => {
      const total = d.created + d.modified
      const indicators: DayData['indicators'] = []
      if (d.created > 0) indicators.push({ color: '#10b981', label: `${d.created}` })
      if (d.modified > 0) indicators.push({ color: '#3b82f6', label: `${d.modified}` })
      return { date: d.date, intensity: total / maxTotal, indicators }
    })
  }, [monthData, selectedSection])

  const activeDays = useMemo(() => {
    if (!monthData) return 0
    if (selectedSection && monthData.section_days[selectedSection]) {
      return monthData.section_days[selectedSection].length
    }
    return monthData.days.filter(d => d.created + d.modified > 0).length
  }, [monthData, selectedSection])

  const mostActiveDay = useMemo(() => {
    if (!monthData) return null
    const source = selectedSection && monthData.section_days[selectedSection]
      ? monthData.section_days[selectedSection]
      : monthData.days
    let best = source[0]
    if (!best) return null
    for (const d of source) {
      if (d.created + d.modified > (best.created + best.modified)) best = d
    }
    if (best.created + best.modified === 0) return null
    return best
  }, [monthData, selectedSection])

  // Build trees for day detail
  const sectionTrees = useMemo(() => {
    if (!dayDetail) return []
    const entries = selectedSection
      ? Object.entries(dayDetail.sections).filter(([name]) => name === selectedSection)
      : Object.entries(dayDetail.sections)

    return entries
      .map(([name, data]) => ({
        name,
        tree: buildFileTree(data.created, data.modified, name),
        total: data.created.length + data.modified.length,
      }))
      .sort((a, b) => b.total - a.total)
  }, [dayDetail, selectedSection])

  // Build trees for section-month detail
  const sectionMonthTrees = useMemo(() => {
    if (!sectionMonthData) return []
    return sectionMonthData.days.map(day => ({
      date: day.date,
      tree: buildFileTree(day.created, day.modified, sectionMonthData.section),
      total: day.created.length + day.modified.length,
    }))
  }, [sectionMonthData])

  // Summary metrics
  const summaryCreated = useMemo(() => {
    if (!monthData) return 0
    if (selectedSection) {
      const s = monthData.sections.find(s => s.name === selectedSection)
      return s?.created ?? 0
    }
    return monthData.total_created
  }, [monthData, selectedSection])

  const summaryModified = useMemo(() => {
    if (!monthData) return 0
    if (selectedSection) {
      const s = monthData.sections.find(s => s.name === selectedSection)
      return s?.modified ?? 0
    }
    return monthData.total_modified
  }, [monthData, selectedSection])

  const tagItems = useMemo(() => {
    if (!monthData) return []
    return sectionsToTagItems(monthData.sections)
  }, [monthData])

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // What to show in the main content area
  const showDayDetail = !!selectedDate
  const showSectionMonth = !!selectedSection && !selectedDate

  return (
    <div className="flex gap-6 items-start">
      {/* ---- LEFT: Compact calendar sidebar ---- */}
      <div className="w-64 shrink-0 sticky top-24 space-y-4 hidden lg:block">
        <Card className="shadow-none border-border/30">
          <CardContent className="p-3">
            <MonthCalendar
              year={year}
              month={month}
              days={calendarDays}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onMonthChange={handleMonthChange}
              loading={monthLoading}
              colorScale="emerald"
              compact
            />
            {/* Legend */}
            <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/20 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
                Created
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-blue-500" />
                Modified
              </span>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* ---- RIGHT: Main content ---- */}
      <div className="flex-1 min-w-0 flex flex-col gap-5">
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        {/* Mobile calendar (hidden on lg+) */}
        <div className="lg:hidden">
          <Card>
            <CardContent className="pt-5 pb-4">
              <MonthCalendar
                year={year}
                month={month}
                days={calendarDays}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onMonthChange={handleMonthChange}
                loading={monthLoading}
                colorScale="emerald"
              />
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                  Created
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" />
                  Modified
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Month summary card */}
        {monthData && !monthLoading && (
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedSection
                  ? <>{selectedSection} <span className="text-sm font-normal text-muted-foreground">- month summary</span></>
                  : 'Month Summary'
                }
              </CardTitle>
              <CardDescription>
                File activity for {monthLabel}
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate(null)}
                    className="ml-2 text-primary hover:underline"
                  >
                    Clear day selection
                  </button>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <MetricBlock label="Files created" value={summaryCreated} className="text-emerald-600 dark:text-emerald-400" />
                <MetricBlock label="Files modified" value={summaryModified} className="text-blue-600 dark:text-blue-400" />
                <MetricBlock label="Active days" value={activeDays} />
                <MetricBlock
                  label="Most active day"
                  value={mostActiveDay ? formatShortDate(mostActiveDay.date) : '-'}
                />
              </div>
              {monthData.sections.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-muted-foreground">By section</h4>
                    {selectedSection && (
                      <button
                        onClick={() => setSelectedSection(null)}
                        className="text-xs text-primary hover:underline"
                      >
                        Clear filter
                      </button>
                    )}
                  </div>
                  <SectionBreakdown
                    items={tagItems}
                    selected={selectedSection}
                    onSelect={setSelectedSection}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ---- Section-month detail ---- */}
        {showSectionMonth && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {selectedSection} — {monthLabel}
              </CardTitle>
              {sectionMonthData && (
                <CardDescription>
                  {sectionMonthData.total_created} created, {sectionMonthData.total_modified} modified across {sectionMonthData.days.length} days
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {sectionMonthLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-5 animate-pulse rounded bg-muted/40" />
                  ))}
                </div>
              )}

              {sectionMonthData && !sectionMonthLoading && (
                <div className="space-y-4">
                  {sectionMonthTrees.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No {selectedSection} activity this month.
                    </p>
                  )}

                  {sectionMonthTrees.map(({ date, tree, total }) => (
                    <div key={date} className="rounded-xl border border-border/40 bg-muted/10 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => setSelectedDate(date)}
                          className="text-sm font-semibold hover:text-primary transition-colors"
                        >
                          {formatDate(date)}
                        </button>
                        <span className="text-xs text-muted-foreground">{total} files</span>
                      </div>
                      <FileTreeView node={tree} depth={0} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ---- Day detail ---- */}
        {showDayDetail && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{formatDate(selectedDate!)}</CardTitle>
              {dayDetail && (
                <CardDescription>
                  {selectedSection
                    ? `${selectedSection}: ${sectionTrees.reduce((n, s) => n + s.total, 0)} files`
                    : `${dayDetail.created_count} created, ${dayDetail.modified_count} modified`
                  }
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {dayLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-5 animate-pulse rounded bg-muted/40" />
                  ))}
                </div>
              )}

              {dayDetail && !dayLoading && (
                <div className="space-y-3">
                  {sectionTrees.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {selectedSection
                        ? `No ${selectedSection} activity on this day.`
                        : 'No file activity on this day.'
                      }
                    </p>
                  )}

                  {sectionTrees.map(({ name, tree, total }) => (
                    <div
                      key={name}
                      className="rounded-xl border border-border/40 bg-muted/10 p-3"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold">{name}</span>
                        <span className="text-xs text-muted-foreground">{total} files</span>
                      </div>
                      <FileTreeView node={tree} depth={0} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
