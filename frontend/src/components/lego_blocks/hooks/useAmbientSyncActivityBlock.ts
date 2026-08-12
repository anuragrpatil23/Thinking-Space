import { useEffect, useState } from 'react'
import {
  subscribeActivities,
  type BackgroundActivity,
} from '../../../services/lego_blocks/units/backgroundActivityBlock'
import { useVisibleIntervalBlock } from './shared/useVisibleIntervalBlock'

/**
 * Live view of ambient-channel background activities (vault syncs).
 *
 * `running` only turns true once a sync has been in flight for
 * `visibilityDelayMs` — sub-threshold syncs (the constant watcher churn)
 * never surface anywhere. Once past the threshold, `progress` is the
 * aggregate 0..1 fraction when every running sync reports totals, or null
 * for indeterminate. Consumed by SyncRefreshButtonBlock (desktop pill
 * animation) and App's native-chrome bridge (iOS syncActive flag), so the
 * threshold behaves identically on both platforms.
 */

const DEFAULT_VISIBILITY_DELAY_MS = 500

export interface AmbientSyncActivitySnapshot {
  running: boolean
  progress: number | null
  /** Aggregate processed/total file counts; null while indeterminate. */
  completedCount: number | null
  totalCount: number | null
}

export function useAmbientSyncActivityBlock(
  visibilityDelayMs: number = DEFAULT_VISIBILITY_DELAY_MS,
): AmbientSyncActivitySnapshot {
  const [ambient, setAmbient] = useState<BackgroundActivity[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => subscribeActivities(all => {
    setAmbient(all.filter(a => a.channel === 'ambient'))
  }), [])

  // While syncs are in flight AND the document is visible, tick so activities
  // can cross the threshold. Nothing renders while hidden, so the tick would
  // only be re-deriving a progress fraction nobody can see.
  useVisibleIntervalBlock(
    () => setNow(Date.now()),
    ambient.length === 0 ? null : 250,
  )

  const visible = ambient.filter(a => now - a.startedAt >= visibilityDelayMs)

  let total = 0
  let completed = 0
  let determinate = visible.length > 0
  for (const a of visible) {
    if (typeof a.total !== 'number' || a.total <= 0) {
      determinate = false
      break
    }
    total += a.total
    completed += a.completed ?? 0
  }

  const isDeterminate = determinate && total > 0
  return {
    running: visible.length > 0,
    progress: isDeterminate
      ? Math.min(1, Math.max(0, completed / total))
      : null,
    completedCount: isDeterminate ? Math.min(completed, total) : null,
    totalCount: isDeterminate ? total : null,
  }
}
