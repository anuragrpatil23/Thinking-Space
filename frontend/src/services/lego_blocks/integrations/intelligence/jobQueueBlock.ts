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
//
// Lanes come before dates: an interactive job (someone is looking at the screen
// waiting for it) takes the next free slot ahead of all background work. Without
// this the Settings "Test" button sat 12 minutes behind a backlog of digests.
//
// Big jobs and small jobs are kept from overlapping where it hurts. An engine
// reads a long prompt as one uninterrupted step, and every job decoding beside
// it freezes until that finishes — a 20k-token digest froze a 22-token label
// for most of a minute. So, for one provider at a time: a big job does not
// start beside a running small one (that one finishes in seconds), and a small
// job does not start while a big one is still reading its prompt. Interactive
// work ignores both rules. Reordering is safe: every queued job already holds
// its full input, so none waits on another queued job's output.
//
// Dispatch is gated per provider. A job whose provider's engine is not ready
// stays queued — paused, not failed — and the gate's owner calls
// `pumpIntelligenceQueueBlock` when it opens. The queue knows nothing about
// engines; engineMonitorBlock installs the gate.

const MAX_CONCURRENT = 2
/** Small jobs batch harder: their caches are small and their prompt reads
 *  short, and the engine's combined rate climbs ~30% from one request to
 *  three or four. Once a big job is running or next to start, the cap is
 *  MAX_CONCURRENT again. */
const MAX_SMALL_CONCURRENT = 4

/** `interactive`: a person is waiting on screen. `background`: everything else. */
export type JobPriorityBlock = 'interactive' | 'background'

/** A prompt this long (estimated tokens) makes a job "big". At the ~300 tok/s
 *  a local engine reads prompts, that is over ten seconds of frozen neighbours. */
export const HEAVY_PROMPT_TOKENS = 4000
/** Conservative prompt-reading rate for the prefill window: erring slow keeps
 *  small jobs out a little longer rather than letting them in to freeze. */
const PREFILL_TOK_S = 300
const PREFILL_MARGIN_MS = 2000

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
  title?: string
  priority: JobPriorityBlock
  /** Estimated prompt size in tokens, when the caller knew it. */
  promptTokens?: number
}

/** Options a caller can attach when enqueuing. */
export interface EnqueueOptionsBlock<T> {
  taskId?: string
  model?: string
  providerId?: string
  inputPreview?: string
  project?: string
  dateIso?: string
  /** One item's name (an article headline), when the job is about one. */
  title?: string
  /** Defaults to `background`. Re-enqueueing a waiting key as `interactive`
   *  promotes it — the dedup that hands back the existing promise would
   *  otherwise leave the job wherever it first landed. */
  priority?: JobPriorityBlock
  /** Estimated prompt size in tokens — decides whether this is a big job. */
  promptTokens?: number
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
/** The jobs running now, as much as dispatch needs: whose engine, whether big,
 *  and until when a big one is still reading its prompt. */
interface RunningSlotBlock {
  providerId?: string
  heavy: boolean
  prefillUntil: number
}
const runningSlots: RunningSlotBlock[] = []
let prefillTimer: ReturnType<typeof setTimeout> | null = null

function isHeavyBlock(meta: QueuedJobBlock): boolean {
  return (meta.promptTokens ?? 0) >= HEAVY_PROMPT_TOKENS
}

/** Whether this job may start beside what is running now on its provider. */
function fitsBesideRunningBlock(meta: QueuedJobBlock, now: number): boolean {
  if (meta.priority === 'interactive') return true
  const neighbours = runningSlots.filter(r => r.providerId === meta.providerId)
  if (isHeavyBlock(meta)) return neighbours.every(r => r.heavy)
  return !neighbours.some(r => r.heavy && r.prefillUntil > now)
}

/** When a small job is held only by a big neighbour's prefill window, look
 *  again once the window closes — one timer, only while something waits. */
function schedulePrefillRecheck(now: number): void {
  if (prefillTimer) return
  const next = Math.min(...runningSlots.filter(r => r.heavy && r.prefillUntil > now).map(r => r.prefillUntil))
  if (!Number.isFinite(next)) return
  prefillTimer = setTimeout(() => {
    prefillTimer = null
    pump()
  }, next - now)
}

/** Whether a job for this provider may start now. Open by default. */
let dispatchGate: (providerId: string | undefined) => boolean = () => true

export function setIntelligenceDispatchGateBlock(gate: (providerId: string | undefined) => boolean): void {
  dispatchGate = gate
  pump()
}

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
  if (a.meta.priority !== b.meta.priority) return a.meta.priority === 'interactive' ? -1 : 1
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
function nextIndexBlock(now: number): number {
  // The job that would run next with no pairing rules at all.
  let top = -1
  for (let i = 0; i < pending.length; i++) {
    if (!dispatchGate(pending[i].meta.providerId)) continue
    if (top < 0 || comparePriorityBlock(pending[i], pending[top]) < 0) top = i
  }
  if (top < 0) return -1
  if (fitsBesideRunningBlock(pending[top].meta, now)) return top
  // A big job next in line holds the free slot until its small neighbour
  // finishes (seconds). Filling the slot with more small jobs instead would
  // let a steady trickle of labels starve a digest indefinitely.
  if (isHeavyBlock(pending[top].meta)) return -1
  // A small job held by a big neighbour's prefill: anything that does fit may
  // go meanwhile, and the queue looks again when the window closes.
  let best = -1
  for (let i = 0; i < pending.length; i++) {
    if (!dispatchGate(pending[i].meta.providerId) || !fitsBesideRunningBlock(pending[i].meta, now)) continue
    if (best < 0 || comparePriorityBlock(pending[i], pending[best]) < 0) best = i
  }
  if (best < 0) schedulePrefillRecheck(now)
  return best
}

/** How many may run at once if this job starts: four while everything is
 *  small, two the moment a big job is involved. */
function capacityForBlock(meta: QueuedJobBlock): number {
  return !isHeavyBlock(meta) && runningSlots.every(r => !r.heavy) ? MAX_SMALL_CONCURRENT : MAX_CONCURRENT
}

function pump(): void {
  while (inFlight < MAX_SMALL_CONCURRENT && pending.length > 0) {
    const now = Date.now()
    const index = nextIndexBlock(now)
    if (index < 0 || inFlight >= capacityForBlock(pending[index].meta)) break
    const next = pending.splice(index, 1)[0]
    inFlight += 1
    const heavy = isHeavyBlock(next.meta)
    const slot: RunningSlotBlock = {
      providerId: next.meta.providerId,
      heavy,
      prefillUntil: heavy ? now + ((next.meta.promptTokens ?? 0) / PREFILL_TOK_S) * 1000 + PREFILL_MARGIN_MS : now,
    }
    runningSlots.push(slot)
    next
      .run()
      .then(v => next.resolve(v))
      .catch(e => next.reject(e))
      .finally(() => {
        inFlight -= 1
        runningSlots.splice(runningSlots.indexOf(slot), 1)
        dedup.delete(next.key)
        emit()
        pump()
      })
  }
  emit()
}

/** Re-check the gate — called by the gate's owner when it opens. */
export function pumpIntelligenceQueueBlock(): void {
  pump()
}

/** Whether any queued or running job targets this provider. */
export function hasIntelligenceWorkForProviderBlock(providerId: string): boolean {
  return runningSlots.some(r => r.providerId === providerId) || pending.some(e => e.meta.providerId === providerId)
}

export function enqueueIntelligenceJobBlock<T>(
  key: string,
  run: () => Promise<T>,
  options?: EnqueueOptionsBlock<T>,
): Promise<T> {
  const existing = dedup.get(key) as Promise<T> | undefined
  if (existing) {
    if (options?.priority === 'interactive') {
      const waiting = pending.find(e => e.key === key)
      if (waiting && waiting.meta.priority !== 'interactive') {
        waiting.meta = { ...waiting.meta, priority: 'interactive' }
        pump()
      }
    }
    return existing
  }
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
        title: options?.title,
        priority: options?.priority ?? 'background',
        promptTokens: options?.promptTokens,
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
