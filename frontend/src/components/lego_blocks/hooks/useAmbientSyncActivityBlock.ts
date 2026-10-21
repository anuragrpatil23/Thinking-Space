import { useEffect, useState } from 'react'
import {
  subscribeActivities,
  type BackgroundActivity,
} from '../../../services/lego_blocks/units/backgroundActivityBlock'
import { useVisibleIntervalBlock } from './shared/useVisibleIntervalBlock'

/**
 * Live view of ambient-channel background activities (vault syncs, and
 * main-thread stalls, which spin the same pill instead of raising a banner).
 * Other ambient work (a feed reload) is labelled for stall attribution only
 * and never spins it.
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
    setAmbient(all.filter(a => a.channel === 'ambient' && (a.kind === 'sync' || a.kind === 'stall')))
  }), [])

  // While syncs are in flight AND the document is visible, tick so activities
  // can cross the threshold. Nothing renders while hidden, so the tick would
  // only be re-deriving a progress fraction nobody can see.
  useVisibleIntervalBlock(
    () => setNow(Date.now()),
    ambient.length === 0 ? null : 250,
  )

  // A stall has already waited out its own threshold, so it shows at once.
  const visible = ambient.filter(a => a.kind === 'stall' || now - a.startedAt >= visibilityDelayMs)
  const syncs = visible.filter(a => a.kind === 'sync')

  // Progress is the syncs' alone: a stall during a counted sync keeps the count.
  let total = 0
  let completed = 0
  let determinate = syncs.length > 0
  for (const a of syncs) {
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
