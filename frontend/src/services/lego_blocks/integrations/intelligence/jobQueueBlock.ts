// Global FIFO job queue with a concurrency cap and dedup-by-key. Shared
// across every consumer of the intelligence subsystem so opening a busy
// AI-activity day doesn't compete with, say, a background classifier.
//
// Dedup: if two callers enqueue with the same key while the first is still
// in-flight or queued, the second gets the same promise. Prevents fan-out
// when a re-render triggers duplicate hooks for the same input.

const MAX_CONCURRENT = 2

/** What a waiting job can say about itself. Without it the queue holds only an
 *  opaque key, so "three things are queued" was the most any UI could report —
 *  and which three is the part you actually want when a digest is slow. */
export interface QueuedJobBlock {
  key: string
  taskId: string
  model?: string
  providerId?: string
  /** When it joined the queue, so the panel can show how long it has waited. */
  queuedAt: number
}

interface QueueEntry<T> {
  key: string
  meta: QueuedJobBlock
  run: () => Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

let inFlight = 0
const pending: QueueEntry<unknown>[] = []
const dedup = new Map<string, Promise<unknown>>()

const EVENT_NAME = 'intelligence:queue'

function emit(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
  } catch {
    // Non-window environments (SSR, workers) — safe to ignore.
  }
}

function pump(): void {
  while (inFlight < MAX_CONCURRENT && pending.length > 0) {
    const next = pending.shift()!
    inFlight += 1
    next
      .run()
      .then(v => next.resolve(v))
      .catch(e => next.reject(e))
      .finally(() => {
        inFlight -= 1
        dedup.delete(next.key)
        emit()
        pump()
      })
  }
  emit()
}

export function enqueueIntelligenceJobBlock<T>(
  key: string,
  run: () => Promise<T>,
  meta?: Omit<QueuedJobBlock, 'key' | 'queuedAt'>,
): Promise<T> {
  const existing = dedup.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = new Promise<T>((resolve, reject) => {
    pending.push({
      key,
      meta: { key, taskId: meta?.taskId ?? key.split(':')[0], ...meta, queuedAt: Date.now() },
      run,
      resolve: resolve as (v: unknown) => void,
      reject,
    } as QueueEntry<unknown>)
  })
  dedup.set(key, p as Promise<unknown>)
  pump()
  return p
}

export function intelligenceQueueDepthBlock(): { inFlight: number; queued: number } {
  return { inFlight, queued: pending.length }
}

/** The waiting jobs, in the order they will run. */
export function listQueuedIntelligenceJobsBlock(): QueuedJobBlock[] {
  return pending.map(e => e.meta)
}

export function subscribeIntelligenceQueueBlock(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT_NAME, fn)
  return () => window.removeEventListener(EVENT_NAME, fn)
}
