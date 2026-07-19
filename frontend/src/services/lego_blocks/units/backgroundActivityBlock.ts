/**
 * Background activity bus — long-running work (vault sync, capability calls,
 * rebuilds, etc.) reports start/update/end here so the UI can show a banner.
 *
 * Activities below DEFAULT_VISIBILITY_DELAY_MS don't cause flicker because the
 * banner waits before rendering them.
 */

export type BackgroundActivityKind =
  | 'sync'
  | 'capability'
  | 'rebuild'
  | 'extension'
  | 'ai'
  | 'stall'
  | 'generic'

/**
 * Which surface renders the activity: 'alert' (default) goes to the
 * right-corner banner; 'ambient' goes to the top-edge progress hairline
 * (routine background work like vault syncs — present but quiet).
 */
export type BackgroundActivityChannel = 'ambient' | 'alert'

export interface BackgroundActivity {
  id: string
  kind: BackgroundActivityKind
  channel: BackgroundActivityChannel
  label: string
  detail?: string
  startedAt: number
  /** Total units of work, if known. Omit for indeterminate progress. */
  total?: number
  /** Completed units of work. */
  completed?: number
}

export interface BackgroundActivityHandle {
  id: string
  update(patch: { label?: string; detail?: string; total?: number; completed?: number }): void
  end(): void
}

type Listener = (activities: BackgroundActivity[]) => void

const activities = new Map<string, BackgroundActivity>()
const listeners = new Set<Listener>()
let counter = 0

function snapshot(): BackgroundActivity[] {
  return Array.from(activities.values()).sort((a, b) => a.startedAt - b.startedAt)
}

function emit(): void {
  const list = snapshot()
  listeners.forEach(l => {
    try { l(list) } catch { /* noop */ }
  })
}

export function startActivity(input: {
  id?: string
  kind: BackgroundActivityKind
  channel?: BackgroundActivityChannel
  label: string
  detail?: string
  total?: number
}): BackgroundActivityHandle {
  const id = input.id ?? `act-${++counter}-${Date.now()}`
  const activity: BackgroundActivity = {
    id,
    kind: input.kind,
    channel: input.channel ?? 'alert',
    label: input.label,
    detail: input.detail,
    total: input.total,
    completed: input.total !== undefined ? 0 : undefined,
    startedAt: Date.now(),
  }
  activities.set(id, activity)
  emit()
  return {
    id,
    update(patch) {
      const cur = activities.get(id)
      if (!cur) return
      activities.set(id, { ...cur, ...patch })
      emit()
    },
    end() {
      if (activities.delete(id)) emit()
    },
  }
}

export function getActivities(): BackgroundActivity[] {
  return snapshot()
}

export function subscribeActivities(listener: Listener): () => void {
  listeners.add(listener)
  listener(snapshot())
  return () => { listeners.delete(listener) }
}

/**
 * Convenience: run an async fn while reporting an activity. Always ends, even
 * on throw. Returns the fn's result.
 */
export async function withActivity<T>(
  input: { kind: BackgroundActivityKind; channel?: BackgroundActivityChannel; label: string; detail?: string; total?: number },
  fn: (handle: BackgroundActivityHandle) => Promise<T>,
): Promise<T> {
  const handle = startActivity(input)
  try {
    return await fn(handle)
  } finally {
    handle.end()
  }
}
