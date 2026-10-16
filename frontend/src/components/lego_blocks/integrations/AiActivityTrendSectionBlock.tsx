import { lazy, Suspense, useState } from 'react'
import type { ActivityDay, ActivityProject } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import type { ProjectKindBlock } from '@/services/lego_blocks/units/projectKindBlock'
import AiActivityTimeOfDayChartBlock from '@/components/lego_blocks/units/AiActivityTimeOfDayChartBlock'
import ContextMenuBlock from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import {
  getAiActivityTrendColorBy,
  getAiActivityTrendView,
  setAiActivityTrendColorBy,
  setAiActivityTrendView,
  type AiActivityTrendColorBy,
  type AiActivityTrendView,
} from '@/services/lego_blocks/units/storageKeyBlock'

// The Trend section body. Two views behind a right-click:
//   - Time of day (default): when the hours happened, one row per day.
//   - Hours per day: the stacked bars it used to be, for anyone who prefers them.
// Time of day can also colour by kind of work (thinking / building / …) instead
// of by project, once the user has set kinds in Settings ▸ Projects.
//
// The bar chart pulls in recharts, so it stays lazy; this whole block is itself
// lazy-imported by the panel, which is reachable from the startup entry.

const AiActivityTrendChartBlock = lazy(() => import('@/components/lego_blocks/units/AiActivityTrendChartBlock'))

interface Props {
  days: ActivityDay[]
  chains: ActivityChain[]
  projects: ActivityProject[]
  filterProject?: string | null
  kindByProject: Record<string, ProjectKindBlock>
  selectedDate?: string | null
  onSelectDate?: (date: string | null) => void
}

export default function AiActivityTrendSectionBlock({
  days,
  chains,
  projects,
  filterProject,
  kindByProject,
  selectedDate,
  onSelectDate,
}: Props) {
  const [view, setView] = useState<AiActivityTrendView>(getAiActivityTrendView)
  const [colorBy, setColorBy] = useState<AiActivityTrendColorBy>(getAiActivityTrendColorBy)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const hasKinds = Object.keys(kindByProject).length > 0
  const effectiveColorBy = hasKinds ? colorBy : 'project'

  const chooseView = (next: AiActivityTrendView) => {
    setView(next)
    setAiActivityTrendView(next)
  }
  const chooseColorBy = (next: AiActivityTrendColorBy) => {
    setColorBy(next)
    setAiActivityTrendColorBy(next)
  }

  return (
    <div
      onContextMenu={e => {
        e.preventDefault()
        // The canvas this panel can sit on has its own context menu.
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {view === 'time-of-day' ? (
        <AiActivityTimeOfDayChartBlock
          days={days.map(d => d.date)}
          chains={chains}
          filterProject={filterProject}
          colorBy={effectiveColorBy}
          kindByProject={kindByProject}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
        />
      ) : (
        <Suspense fallback={null}>
          <AiActivityTrendChartBlock
            days={days}
            chains={chains}
            projects={projects}
            filterProject={filterProject}
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
          />
        </Suspense>
      )}

      {menu && (
        <ContextMenuBlock
          position={menu}
          onClose={() => setMenu(null)}
          entries={[
            { key: 'tod', label: 'Time of day', checked: view === 'time-of-day', onClick: () => { chooseView('time-of-day'); setMenu(null) } },
            { key: 'hours', label: 'Hours per day', checked: view === 'hours', onClick: () => { chooseView('hours'); setMenu(null) } },
            ...(view === 'time-of-day'
              ? [
                  { key: 'sep', kind: 'separator' as const },
                  { key: 'by-project', label: 'Color by project', checked: effectiveColorBy === 'project', onClick: () => { chooseColorBy('project'); setMenu(null) } },
                  {
                    key: 'by-kind',
                    label: hasKinds ? 'Color by kind of work' : 'Color by kind of work (set kinds in Settings ▸ Projects)',
                    checked: effectiveColorBy === 'kind',
                    disabled: !hasKinds,
                    onClick: () => { chooseColorBy('kind'); setMenu(null) },
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  )
}
