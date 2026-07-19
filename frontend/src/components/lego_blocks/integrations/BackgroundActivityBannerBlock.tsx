import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  subscribeActivities,
  type BackgroundActivity,
} from '../../../services/lego_blocks/units/backgroundActivityBlock'

/**
 * Right-corner notification box that surfaces in-flight background work.
 * Visual language matches RuntimeErrorSurfaceBlock and DebugToastBlock for a
 * unified notification feel.
 *
 * Activities shorter than `visibilityDelayMs` never render — prevents flicker
 * for fast reads. Click the row to expand and see all in-flight activities.
 */

interface Props {
  visibilityDelayMs?: number
}

export default function BackgroundActivityBannerBlock({ visibilityDelayMs = 300 }: Props) {
  const [activities, setActivities] = useState<BackgroundActivity[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => subscribeActivities(setActivities), [])

  useEffect(() => {
    if (activities.length === 0) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [activities.length])

  // Ambient-channel activities (vault syncs) render in the top-edge hairline
  // (SyncProgressHairlineBlock), never here — the banner is for alerts.
  const visible = activities.filter(
    a => a.channel !== 'ambient' && now - a.startedAt >= visibilityDelayMs,
  )

  // Collapse expanded state when nothing extra is around.
  useEffect(() => {
    if (visible.length <= 1 && expanded) setExpanded(false)
  }, [visible.length, expanded])

  if (visible.length === 0) return null

  return (
    <div
      className="pointer-events-auto fixed right-3 z-[95] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border/70 bg-background/95 shadow-lg shadow-black/5 ring-1 ring-black/5 backdrop-blur-xl"
      style={{ top: 'calc(var(--ltm-safe-top, 0px) + 0.5rem)' }}
      role="status"
      aria-live="polite"
    >
      <ActivityRow
        activity={visible[0]}
        extraCount={visible.length - 1}
        expanded={expanded}
        onToggle={visible.length > 1 ? () => setExpanded(e => !e) : undefined}
      />
      {expanded && visible.length > 1 && (
        <div className="border-t border-border/40">
          {visible.slice(1).map(activity => (
            <div key={activity.id} className="border-t border-border/30 first:border-t-0">
              <ActivityRow activity={activity} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface ActivityRowProps {
  activity: BackgroundActivity
  extraCount?: number
  expanded?: boolean
  onToggle?: () => void
}

function ActivityRow({ activity, extraCount = 0, expanded, onToggle }: ActivityRowProps) {
  const hasDeterminate =
    typeof activity.total === 'number' &&
    activity.total > 0 &&
    typeof activity.completed === 'number'
  const pct = hasDeterminate
    ? Math.min(100, Math.max(0, ((activity.completed ?? 0) / (activity.total ?? 1)) * 100))
    : null

  const inner = (
    <div className="flex items-start gap-2.5 px-3.5 py-3 pl-4">
      <span
        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground/90">
            {activity.label}
          </span>
          {extraCount > 0 && (
            <span className="rounded-md bg-muted/60 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
              +{extraCount} more
            </span>
          )}
        </div>
        {activity.detail && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {activity.detail}
          </p>
        )}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/60">
          {pct !== null ? (
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="h-full w-1/3 rounded-full bg-emerald-500/80 animate-[ltm-bg-shimmer_1.2s_ease-in-out_infinite]" />
          )}
        </div>
      </div>
      {onToggle && (
        <ChevronDown
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      )}
      <style>{`
        @keyframes ltm-bg-shimmer {
          0% { transform: translateX(-120%); }
          50% { transform: translateX(180%); }
          100% { transform: translateX(360%); }
        }
      `}</style>
    </div>
  )

  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="block w-full text-left transition-colors hover:bg-muted/40"
      >
        {inner}
      </button>
    )
  }
  return inner
}
