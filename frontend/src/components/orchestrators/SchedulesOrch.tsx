import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import SubNavTabsBlock from '@/components/lego_blocks/units/ui/SubNavTabsBlock'
import ScheduleListBlock from '@/components/lego_blocks/integrations/ScheduleListBlock'
import ScheduleFormBlock from '@/components/lego_blocks/integrations/ScheduleFormBlock'
import ScheduleRunControlsBlock from '@/components/lego_blocks/integrations/ScheduleRunControlsBlock'
import NotificationsConfigBlock from '@/components/lego_blocks/integrations/NotificationsConfigBlock'
import type { ScheduleSpecBlock } from '@/services/lego_blocks/integrations/schedulesBlock'

interface SchedulesOrchProps {
  active?: boolean
}

function parseRoute(pathname: string): { mode: 'list' | 'create' | 'edit'; editKey?: string } {
  if (pathname === '/ai/schedules/new') return { mode: 'create' }
  const editMatch = /^\/ai\/schedules\/([a-z0-9][a-z0-9-]{0,62})$/.exec(pathname)
  if (editMatch) return { mode: 'edit', editKey: editMatch[1] }
  return { mode: 'list' }
}

export default function SchedulesOrch(_props: SchedulesOrchProps) {
  const { pathname } = useLocation()
  const { mode, editKey } = parseRoute(pathname)
  const [activeSpec, setActiveSpec] = useState<ScheduleSpecBlock | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const bumpListRefresh = useCallback(() => setListRefreshKey((n) => n + 1), [])

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left sidebar: tab switcher + schedules list ── */}
      <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border/50">
        <p className="mb-2 mt-4 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          AI
        </p>
        <div className="flex shrink-0 items-center justify-between gap-1 px-2 pb-2">
          <SubNavTabsBlock
            ariaLabel="AI section"
            className="text-xs"
            tabs={[
              { to: '/ai/chat', label: 'Chat' },
              { to: '/ai/schedules', label: 'Schedules' },
            ]}
          />
        </div>
        <ScheduleListBlock key={listRefreshKey} />
      </aside>

      {/* ── Main: run controls (edit only) + form ── */}
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <header className="mb-4">
            <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Background tasks that run on a schedule — anchor pings, auto-commits, scheduled agent runs.
            </p>
          </header>

          <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/20 p-3 text-sm text-amber-900 dark:text-amber-200">
            <strong className="font-semibold">Heads up:</strong> Scheduled jobs run through Thinking Space itself, so the app needs to be running at the scheduled time. Quitting the app pauses your schedules.
          </div>

          {(mode === 'create' || mode === 'edit') && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {mode === 'create' ? 'New schedule' : (activeSpec?.title ?? 'Edit schedule')}
            </h2>
          )}

          {mode === 'list' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Pick a schedule from the left to edit it, or click <strong>New schedule</strong> to create one.
              </div>
              <NotificationsConfigBlock />
            </div>
          )}

          {mode === 'edit' && activeSpec && (
            <div className="mb-6">
              <ScheduleRunControlsBlock
                spec={activeSpec}
                onChanged={bumpListRefresh}
              />
            </div>
          )}

          {(mode === 'create' || mode === 'edit') && (
            <ScheduleFormBlock
              key={mode === 'edit' ? `edit-${editKey}` : 'create'}
              mode={mode}
              editKey={editKey}
              onLoaded={setActiveSpec}
              onSaved={(spec) => {
                setActiveSpec(spec)
                bumpListRefresh()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
