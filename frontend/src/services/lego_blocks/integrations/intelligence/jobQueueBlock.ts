// Global job queue with a concurrency cap and dedup-by-key. Shared across every
// consumer of the intelligence subsystem so opening a busy AI-activity day
// doesn't compete with, say, a background classifier.
//
// Dedup: if two callers enqueue with the same key while the first is still
// in-flight or queued, the second gets the same promise. Prevents fan-out
// when a re-render triggers duplicate hooks for the same input.
//
// Order is by subject date, newest first — NOT arrival order.
//
// Callers sorting their own work is not enough and cannot be: the weekly digest
// mounts one range-summary per project, each correctly ordering its own chains,
// and seven of those interleaving into one FIFO produces a queue that jumps
// between Aug 12, Aug 10 and Aug 11 with no caller having done anything wrong.
// Global order is only decidable where the jobs meet, which is here.
//
// Jobs with no subject date (chain stitches, range narrations) sort last. That
// is also their dependency order — they compose the digests ahead of them in the
// queue — so waiting is correct rather than merely tolerable.

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
  /**
   * The contract input this job will be built from, as text.
   *
   * Not the prompt: a queued job has not run `buildRequest` yet, so no prompt
   * exists to show. This is the material the prompt will be assembled from,
   * which is the honest answer to "what is this job about" before it starts.
   */
  inputPreview?: string
  /** What the job is about, when the input says so: the project it belongs to
   *  and the day it covers. Twelve identical `session-digest` rows are a wall of
   *  noise; twelve rows naming a project and a date are a work list. */
  project?: string
  dateIso?: string
}

/** Options a caller can attach when enqueuing. */
export interface EnqueueOptionsBlock<T> {
  taskId?: string
  model?: string
  providerId?: string
  inputPreview?: string
  project?: string
  dateIso?: string
  /**
   * Value to settle with if the job is cancelled while still waiting.
   *
   * Callers supply this so cancellation stays inside their own result type — a
   * rejected promise here would surface as a thrown error at call sites that
   * only ever check an `ok` flag, turning a deliberate cancel into an unhandled
   * rejection.
   */
  onCancel?: () => T
}

interface QueueEntry<T> {
  key: string
  meta: QueuedJobBlock
  run: () => Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
  onCancel?: () => T
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

/** Newest subject date first; undated last; ties broken by arrival so equal work
 *  still runs in the order it was asked for. */
function comparePriorityBlock(a: QueueEntry<unknown>, b: QueueEntry<unknown>): number {
  const da = a.meta.dateIso ? Date.parse(a.meta.dateIso) : NaN
  const db = b.meta.dateIso ? Date.parse(b.meta.dateIso) : NaN
  const aHas = Number.isFinite(da)
  const bHas = Number.isFinite(db)
  if (aHas && bHas && da !== db) return db - da
  if (aHas !== bHas) return aHas ? -1 : 1
  return a.meta.queuedAt - b.meta.queuedAt
}

/** Index of the next job to run. Selected at dequeue rather than by keeping the
 *  array sorted, so a job enqueued mid-drain is considered on its merits instead
 *  of inheriting a position from when it happened to arrive. */
function nextIndexBlock(): number {
  let best = 0
  for (let i = 1; i < pending.length; i++) {
    if (comparePriorityBlock(pending[i], pending[best]) < 0) best = i
  }
  return best
}

function pump(): void {
  while (inFlight < MAX_CONCURRENT && pending.length > 0) {
    const next = pending.splice(nextIndexBlock(), 1)[0]
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
  options?: EnqueueOptionsBlock<T>,
): Promise<T> {
  const existing = dedup.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = new Promise<T>((resolve, reject) => {
    pending.push({
      key,
      meta: {
        key,
        taskId: options?.taskId ?? key.split(':')[0],
        model: options?.model,
        providerId: options?.providerId,
        inputPreview: options?.inputPreview,
        project: options?.project,
        dateIso: options?.dateIso,
        queuedAt: Date.now(),
      },
      run,
      resolve: resolve as (v: unknown) => void,
      reject,
      onCancel: options?.onCancel as (() => unknown) | undefined,
    } as QueueEntry<unknown>)
  })
  dedup.set(key, p as Promise<unknown>)
  pump()
  return p
}

/**
 * Drop a job that is still waiting. Returns false if it already started — a
 * running job is cancelled through `runningJobsBlock`, which can abort the
 * request in flight; this one only ever removes something that has not begun.
 */
export function cancelQueuedIntelligenceJobBlock(key: string): boolean {
  const index = pending.findIndex(e => e.key === key)
  if (index < 0) return false
  const [entry] = pending.splice(index, 1)
  dedup.delete(entry.key)
  if (entry.onCancel) entry.resolve(entry.onCancel())
  else entry.reject(new DOMException('cancelled while queued', 'AbortError'))
  emit()
  return true
}

export function intelligenceQueueDepthBlock(): { inFlight: number; queued: number } {
  return { inFlight, queued: pending.length }
}

/** The waiting jobs, in the order they will actually run — the panel showing a
 *  different order than the queue uses would be a lie about the queue. */
export function listQueuedIntelligenceJobsBlock(): QueuedJobBlock[] {
  return [...pending].sort(comparePriorityBlock).map(e => e.meta)
}

export function subscribeIntelligenceQueueBlock(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT_NAME, fn)
  return () => window.removeEventListener(EVENT_NAME, fn)
}
