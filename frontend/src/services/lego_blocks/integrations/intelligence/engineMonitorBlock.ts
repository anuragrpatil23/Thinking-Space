// Live engine state for the openai-compat provider, and the dispatch gate that
// keeps the job queue from sending work into a dead engine.
//
// While the engine is not ready, queued jobs wait — paused, not failed — and
// running jobs whose connection dropped wait here for it to come back before
// retrying. When it turns ready the gate opens and the queue resumes on its own.
//
// Polling is conditional (docs/contracts/ENERGY.md): every few seconds only
// while openai-compat work is queued or running, nothing at all when idle. The
// panel asks for a one-shot refresh when it opens; it never starts a loop.

import { getManualOpenSourceAiCredentialsBlock } from '@/services/lego_blocks/integrations/aiCredentialStoreBlock'
import {
  hasIntelligenceWorkForProviderBlock,
  pumpIntelligenceQueueBlock,
  setIntelligenceDispatchGateBlock,
  subscribeIntelligenceQueueBlock,
} from '@/services/lego_blocks/integrations/intelligence/jobQueueBlock'
import {
  isEngineDispatchableBlock,
  probeEngineStateBlock,
  type EngineStateBlock,
} from '@/services/lego_blocks/units/intelligence/engineStatusBlock'
import { invalidateServerProfileBlock } from '@/services/lego_blocks/units/intelligence/serverProfileBlock'

const PROVIDER_ID = 'openai-compat'
const POLL_MS = 3000
/** Ceiling on the poll interval when the supervisor says it will be a while —
 *  its estimate is honoured, but never so far that a recovery goes unseen. */
const MAX_POLL_MS = 30_000

let state: EngineStateBlock = { kind: 'unknown', source: 'none', checkedAt: 0 }
let supervisorSeen = false
let installed = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<EngineStateBlock> | null = null
const listeners = new Set<() => void>()
const readyWaiters = new Set<() => void>()

function baseUrlBlock(): string | null {
  return getManualOpenSourceAiCredentialsBlock()?.baseUrl ?? null
}

function setState(next: EngineStateBlock): void {
  const wasOpen = isEngineDispatchableBlock(state.kind)
  state = next
  if (next.source === 'supervisor' && next.kind !== 'down') supervisorSeen = true
  const isOpen = isEngineDispatchableBlock(next.kind)
  if (isOpen && !wasOpen) {
    // A restarted engine may be a different build, and a probe made while it
    // was down cached `null` — both make the cached profile wrong now.
    const baseUrl = baseUrlBlock()
    if (baseUrl) invalidateServerProfileBlock(baseUrl)
    for (const resolve of [...readyWaiters]) resolve()
    readyWaiters.clear()
    pumpIntelligenceQueueBlock()
  }
  for (const fn of listeners) fn()
}

export function getEngineStateBlock(): EngineStateBlock {
  return state
}

/** Whether a supervisor has answered for this engine this session. Only then
 *  does the engine being down mean "coming back" rather than "not there". */
export function isEngineSupervisedBlock(): boolean {
  return supervisorSeen
}

export function subscribeEngineStateBlock(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** One probe now, shared with any probe already running. */
export function refreshEngineStateBlock(): Promise<EngineStateBlock> {
  if (inflight) return inflight
  const baseUrl = baseUrlBlock()
  if (!baseUrl) return Promise.resolve(state)
  inflight = probeEngineStateBlock(baseUrl, supervisorSeen)
    .then(next => {
      setState(next)
      return next
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

function nextDelayBlock(): number {
  const retryAfterMs = (state.retryAfterS ?? 0) * 1000
  return Math.min(MAX_POLL_MS, Math.max(POLL_MS, retryAfterMs))
}

function schedulePoll(delayMs?: number): void {
  if (pollTimer || !hasIntelligenceWorkForProviderBlock(PROVIDER_ID)) return
  pollTimer = setTimeout(async () => {
    pollTimer = null
    await refreshEngineStateBlock().catch(() => undefined)
    schedulePoll()
  }, delayMs ?? (state.kind === 'unknown' ? 0 : nextDelayBlock()))
}

/** Install the gate and the work-driven poll. Idempotent; called before the
 *  first job is enqueued. */
export function ensureEngineMonitorBlock(): void {
  if (installed) return
  installed = true
  // Only a known bad state holds work. `unknown` (never probed, or no base URL
  // to probe) lets it through as before: a gate that waited on a probe that
  // can never happen would hold the queue shut forever.
  setIntelligenceDispatchGateBlock(providerId =>
    providerId !== PROVIDER_ID || state.kind === 'unknown' || isEngineDispatchableBlock(state.kind))
  subscribeIntelligenceQueueBlock(schedulePoll)
}

/**
 * Resolve once the engine is dispatchable again. Rejects with the signal's
 * reason if it aborts first, so a cancel during the wait unwinds like any other
 * cancel. The caller holds a running job, so the work-driven poll keeps going.
 */
export function waitForEngineReadyBlock(signal: AbortSignal): Promise<EngineStateBlock> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const done = () => {
      signal.removeEventListener('abort', onAbort)
      resolve(state)
    }
    const onAbort = () => {
      readyWaiters.delete(done)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    readyWaiters.add(done)
    // The death that sent us here has not been observed yet: the last probe
    // may still say ready, and a supervisor needs a moment to notice the exit.
    // Close the gate and look again after one poll interval, not at once — an
    // immediate probe can catch the dying engine still answering.
    state = { ...state, kind: 'restarting', reason: 'Connection to the engine dropped', retryAfterS: null, checkedAt: Date.now() }
    for (const fn of listeners) fn()
    schedulePoll(POLL_MS)
  })
}
