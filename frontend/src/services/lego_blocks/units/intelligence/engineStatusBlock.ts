// What state the local model engine is in, asked of whoever can actually tell.
//
// `GET /v1/models` answering 200 was the old definition of healthy, and it is
// wrong in exactly the case that matters: on Oct 25 and Oct 30 the generation
// thread died while the HTTP layer kept listing models and accepting requests
// into a queue nothing drained. Reachable is not alive.
//
// So the probe asks, in order of how much the answer can be trusted:
//   1. A supervisor status endpoint (loopback only). It answers even while the
//      engine is down, and says why and when it will be back.
//   2. The engine's own `GET /health`, which is 200 only while the generator is
//      alive and not stalled.
//   3. The legacy `/v1/models` check, for servers that offer neither (LM Studio,
//      Ollama, remote endpoints). Those stay `unmanaged`: reachable is all we
//      can know about them, so reachable is what we act on.
//
// Pure probing and parsing; the polling loop and dispatch gate live in
// engineMonitorBlock.

import { normalizeBaseUrlBlock } from '@/services/lego_blocks/units/intelligence/serverProfileBlock'

/** Where a supervisor managing a loopback engine reports. Only consulted when
 *  the configured base URL is itself loopback, and only trusted when the
 *  supervisor says it manages that same port. */
export const SUPERVISOR_STATUS_URL = 'http://127.0.0.1:1233/status'

const SUPERVISOR_TIMEOUT_MS = 1500
const HEALTH_TIMEOUT_MS = 3000

export type EngineStateKind =
  | 'unknown'     // Not probed yet
  | 'ready'       // Alive and accepting work
  | 'starting'    // Supervisor is bringing the engine up
  | 'restarting'  // Engine died or was recycled; supervisor is restarting it
  | 'paused'      // Supervisor is holding the engine down on purpose (battery, memory pressure)
  | 'failed'      // Supervisor's circuit breaker is open; it retries later on its own
  | 'unhealthy'   // Unsupervised engine reports itself not alive
  | 'down'        // Nothing answered
  | 'unmanaged'   // Reachable server with no health signal — treated as ready

export interface EngineInFlightBlock {
  requestId: string
  job?: string
  ageS?: number
}

/** The supervisor's record of the last engine death. Recycles (memory hygiene)
 *  are not failures and never appear here. */
export interface EngineFailureBlock {
  /** Unique per failure. `at` has one-second resolution, so two deaths in the
   *  same second would otherwise read as one. */
  id?: string
  at?: string
  reason?: string
  detail?: string
  inFlight: EngineInFlightBlock[]
}

export interface EngineStateBlock {
  kind: EngineStateKind
  source: 'supervisor' | 'health' | 'models' | 'none'
  /** One line a person can read: why it is not ready. */
  reason?: string
  /** Supervisor's own estimate of when to look again. */
  retryAfterS?: number | null
  /** When the current state began (ISO), when the supervisor says. */
  since?: string
  model?: string | null
  failuresLastHour?: number
  lastFailure?: EngineFailureBlock | null
  memoryPressure?: string
  checkedAt: number
}

/** States the dispatch gate lets work through. */
export function isEngineDispatchableBlock(kind: EngineStateKind): boolean {
  return kind === 'ready' || kind === 'unmanaged'
}

function isLoopbackUrlBlock(url: URL): boolean {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]'
}

function portOfBlock(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

async function fetchWithTimeoutBlock(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function parseEngineFailureBlock(raw: unknown): EngineFailureBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const inFlight = Array.isArray(r.in_flight)
    ? r.in_flight.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const i = item as Record<string, unknown>
      const requestId = asString(i.request_id)
      return requestId ? [{ requestId, job: asString(i.job), ageS: asNumber(i.age_s) }] : []
    })
    : []
  return { id: asString(r.id), at: asString(r.at), reason: asString(r.reason), detail: asString(r.detail), inFlight }
}

const SUPERVISOR_KINDS: Record<string, EngineStateKind> = {
  ready: 'ready',
  starting: 'starting',
  restarting: 'restarting',
  failed: 'failed',
  paused_on_battery: 'paused',
  paused_memory_pressure: 'paused',
}

const PAUSE_REASONS: Record<string, string> = {
  paused_on_battery: 'On battery',
  paused_memory_pressure: 'Memory pressure critical',
}

/** Parse a supervisor status body. Null when it is not managing this engine
 *  (`external`, an unknown state, or a different port) — the caller then falls
 *  through to asking the engine itself. */
export function parseSupervisorStatusBlock(body: unknown, engineUrl: URL, now = Date.now()): EngineStateBlock | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const state = asString(b.state)
  if (!state) return null
  const kind = SUPERVISOR_KINDS[state]
  if (!kind) return null
  const engine = (b.engine && typeof b.engine === 'object' ? b.engine : {}) as Record<string, unknown>
  const managedUrl = asString(engine.url)
  if (managedUrl) {
    try {
      if (portOfBlock(new URL(managedUrl)) !== portOfBlock(engineUrl)) return null
    } catch {
      // Unparseable engine URL — trust the supervisor rather than ignore it.
    }
  }
  const system = (b.system && typeof b.system === 'object' ? b.system : {}) as Record<string, unknown>
  // `ready` is the supervisor's own verdict; a state string that says ready
  // with ready:false is not ready.
  const resolvedKind: EngineStateKind = kind === 'ready' && b.ready === false ? 'starting' : kind
  return {
    kind: resolvedKind,
    source: 'supervisor',
    reason: PAUSE_REASONS[state] ?? asString(b.reason),
    retryAfterS: asNumber(b.retry_after_s) ?? null,
    since: asString(b.since),
    model: asString(engine.model) ?? null,
    failuresLastHour: asNumber(b.failures_last_hour),
    lastFailure: parseEngineFailureBlock(b.last_failure),
    memoryPressure: asString(system.memory_pressure),
    checkedAt: now,
  }
}

/** One probe, no caching. `supervisorSeen` is whether a supervisor has answered
 *  for this engine earlier in the session: only then is its silence evidence
 *  that the engine is unmanaged-and-down rather than simply unmanaged. */
export async function probeEngineStateBlock(
  baseUrlRaw: string,
  supervisorSeen: boolean,
): Promise<EngineStateBlock> {
  const baseUrl = normalizeBaseUrlBlock(baseUrlRaw)
  const now = Date.now()
  let engineUrl: URL
  try {
    engineUrl = new URL(baseUrl)
  } catch {
    return { kind: 'down', source: 'none', reason: 'Invalid base URL', checkedAt: now }
  }

  if (isLoopbackUrlBlock(engineUrl)) {
    try {
      const res = await fetchWithTimeoutBlock(SUPERVISOR_STATUS_URL, SUPERVISOR_TIMEOUT_MS)
      if (res.ok) {
        const parsed = parseSupervisorStatusBlock(await res.json().catch(() => null), engineUrl, now)
        if (parsed) return parsed
      }
    } catch {
      if (supervisorSeen) {
        return { kind: 'down', source: 'supervisor', reason: 'Model supervisor not responding', checkedAt: now }
      }
    }
  }

  try {
    const res = await fetchWithTimeoutBlock(`${engineUrl.origin}/health`, HEALTH_TIMEOUT_MS)
    if (res.ok) return { kind: 'ready', source: 'health', checkedAt: now }
    if (res.status === 503) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      const stalled = body?.stalled === true
      return {
        kind: 'unhealthy',
        source: 'health',
        reason: stalled ? 'Engine stalled' : 'Engine reports generator not alive',
        checkedAt: now,
      }
    }
    // Anything else (404 from servers without /health) — fall through to the
    // only signal those servers give.
  } catch {
    return { kind: 'down', source: 'health', reason: 'Server unreachable', checkedAt: now }
  }

  try {
    const res = await fetchWithTimeoutBlock(`${baseUrl}/models`, HEALTH_TIMEOUT_MS)
    if (res.ok) return { kind: 'unmanaged', source: 'models', checkedAt: now }
    return { kind: 'down', source: 'models', reason: `Server answered HTTP ${res.status}`, checkedAt: now }
  } catch {
    return { kind: 'down', source: 'models', reason: 'Server unreachable', checkedAt: now }
  }
}

export type EngineToneBlock = 'ok' | 'waiting' | 'paused' | 'down' | 'unknown'

/** Status-dot colour per tone, shared by the menu card and the ⋯ dot. */
export const ENGINE_DOT_CLASS: Record<EngineToneBlock, string> = {
  ok: 'bg-emerald-500',
  unknown: 'bg-muted-foreground/50',
  waiting: 'bg-amber-500',
  paused: 'bg-muted-foreground',
  down: 'bg-red-500',
}

/** The one line a person reads about the engine, shared by the AI Runs banner,
 *  the menu card and the ⋯ dot so all three say the same thing. */
export function describeEngineStateBlock(
  state: EngineStateBlock,
  now = Date.now(),
): { tone: EngineToneBlock; label: string; detail?: string } {
  const retryAt = state.retryAfterS != null ? state.checkedAt + state.retryAfterS * 1000 : null
  const retryIn = retryAt != null ? Math.max(0, Math.round((retryAt - now) / 1000)) : null
  const retryText = retryIn != null ? (retryIn > 0 ? `retry in ${formatSecondsBlock(retryIn)}` : 'retrying now') : undefined
  switch (state.kind) {
    case 'ready':
      return { tone: 'ok', label: 'Ready' }
    case 'unmanaged':
      return { tone: 'ok', label: 'Reachable', detail: 'No health signal from this server' }
    case 'unknown':
      return { tone: 'unknown', label: 'Checking…' }
    case 'starting':
      return { tone: 'waiting', label: 'Starting', detail: [state.reason, retryText].filter(Boolean).join(' · ') || undefined }
    case 'restarting':
      return { tone: 'waiting', label: 'Restarting', detail: [state.reason, retryText].filter(Boolean).join(' · ') || undefined }
    case 'paused':
      return { tone: 'paused', label: 'Paused', detail: state.reason ? `${state.reason} · resumes on its own` : undefined }
    case 'failed':
      return {
        tone: 'down',
        label: 'Down',
        detail: [
          state.failuresLastHour != null ? `${state.failuresLastHour} failures in the last hour` : state.reason,
          retryText,
        ].filter(Boolean).join(' · ') || undefined,
      }
    case 'unhealthy':
      return { tone: 'down', label: 'Unhealthy', detail: state.reason }
    case 'down':
      return { tone: 'down', label: 'Down', detail: state.reason }
  }
}

/** 45s, 4m 12s, 1h 15m — durations people read, not 3124.9s. */
export function formatSecondsBlock(totalS: number): string {
  const s = Math.max(0, Math.round(totalS))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
