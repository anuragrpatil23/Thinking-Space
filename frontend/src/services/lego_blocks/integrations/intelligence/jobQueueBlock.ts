// Global FIFO job queue with a concurrency cap and dedup-by-key. Shared
// across every consumer of the intelligence subsystem so opening a busy
// AI-activity day doesn't compete with, say, a background classifier.
//
// Dedup: if two callers enqueue with the same key while the first is still
// in-flight or queued, the second gets the same promise. Prevents fan-out
// when a re-render triggers duplicate hooks for the same input.

const MAX_CONCURRENT = 2

interface QueueEntry<T> {
  key: string
  run: () => Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

let inFlight = 0
const pending: QueueEntry<unknown>[] = []
const dedup = new Map<string, Promise<unknown>>()

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
        pump()
      })
  }
}

export function enqueueIntelligenceJobBlock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = dedup.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = new Promise<T>((resolve, reject) => {
    pending.push({ key, run, resolve: resolve as (v: unknown) => void, reject } as QueueEntry<unknown>)
  })
  dedup.set(key, p as Promise<unknown>)
  pump()
  return p
}

export function intelligenceQueueDepthBlock(): { inFlight: number; queued: number } {
  return { inFlight, queued: pending.length }
}
