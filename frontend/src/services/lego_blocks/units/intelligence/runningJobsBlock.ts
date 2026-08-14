// Registry of intelligence requests that are in flight right now.
//
// Exists because the request timeout is deliberately long (reasoning is
// unbounded by design, and local inference is slow), which means a genuinely
// stuck job would otherwise occupy one of the job queue's two concurrency
// slots for the whole timeout with no way out but restarting the app. Being
// able to cancel from Settings is what makes a long timeout safe.
//
// In-memory only: a page reload drops every in-flight request anyway.

export interface RunningJob {
  id: number
  taskId: string
  model: string
  providerId: string
  startedAt: number
  /** Aborts the underlying request; the run resolves as an `aborted` error. */
  cancel: () => void
}

const running = new Map<number, RunningJob>()
let nextId = 1

const EVENT_NAME = 'intelligence:running'

function emit(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
  } catch {
    // Non-window environments (SSR, workers) — safe to ignore.
  }
}

/** Register an in-flight run. Returns a disposer the caller MUST invoke in a
 *  finally block, or the panel will show ghosts that can never be cancelled. */
export function registerRunningJobBlock(job: Omit<RunningJob, 'id' | 'startedAt'>): () => void {
  const id = nextId
  nextId += 1
  running.set(id, { ...job, id, startedAt: Date.now() })
  emit()
  return () => {
    running.delete(id)
    emit()
  }
}

export function listRunningJobsBlock(): RunningJob[] {
  return [...running.values()].sort((a, b) => a.startedAt - b.startedAt)
}

export function cancelRunningJobBlock(id: number): boolean {
  const job = running.get(id)
  if (!job) return false
  job.cancel()
  // Deliberately not deleted here — the run's own finally block disposes it,
  // so the entry survives until the request actually unwinds.
  return true
}

export function cancelAllRunningJobsBlock(): number {
  const jobs = listRunningJobsBlock()
  for (const job of jobs) job.cancel()
  return jobs.length
}

export function subscribeRunningJobsBlock(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT_NAME, fn)
  return () => window.removeEventListener(EVENT_NAME, fn)
}
