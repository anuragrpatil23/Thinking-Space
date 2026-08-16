// In-memory ring buffer of recent intelligence requests. Powers the
// diagnostics UI (Settings → AI → Diagnostics). Never persisted to disk —
// this is debug info, not a permanent log.
//
// Also emits a browser event on each entry so the diagnostics panel can
// re-render live without polling.

import type { IntelligenceError } from './intelligenceErrorsBlock'
import type { IntelligenceFinishReason } from './intelligenceRequestBlock'

export interface TelemetryEntry {
  /** Monotonically increasing, stable across the tab's lifetime. */
  id: number
  ts: number
  taskId: string
  providerId: string
  model: string
  latencyMs: number
  status: 'ok' | 'cache-hit' | 'error'
  finishReason?: IntelligenceFinishReason
  usage?: { promptTokens: number; completionTokens: number }
  cacheHit?: boolean
  /** Whether hidden reasoning was left on for this run. Absent when the model
   *  has no reasoning mode to toggle. Recorded because it is invisible in the
   *  output yet changes both latency and how much of the token budget the
   *  answer actually gets. */
  reasoning?: 'on' | 'off'
  error?: IntelligenceError
  /** What the run was about, when the input said so. Same pair the queue and
   *  in-flight rows carry, so one job reads the same at every stage of its life
   *  instead of losing its identity the moment it finishes. */
  project?: string
  dateIso?: string
  /** Kept for the diagnostics "replay" button — trimmed to reasonable size. */
  requestPreview?: string
  responsePreview?: string
  /** The full exchange, for the debug panel's detail view. Dropped from older
   *  entries as new ones arrive (see PAYLOAD_ENTRIES) — a prompt carries vault
   *  text, and 100 of them held forever is a memory profile nobody asked for. */
  payload?: TelemetryPayload
}

/** What was actually sent and what came back. Every field is truncated: this is
 *  for reading, and a 200k-character prompt is not read, it is scrolled past. */
export interface TelemetryPayload {
  system?: string
  user?: string
  /** Hidden reasoning the model exposed, when it exposed any. The one part of a
   *  run that is otherwise unobservable — it costs tokens and time, shapes the
   *  answer, and never appears in the output. */
  reasoning?: string
  response?: string
  /** True when any field above was cut, so the panel can say so rather than
   *  letting a truncated prompt read as the whole prompt. */
  truncated?: boolean
}

const MAX_ENTRIES = 100
/** How many of the most recent entries keep their full payload. */
const PAYLOAD_ENTRIES = 25
/** Per-field cap. Generous enough for a real digest prompt, small enough that
 *  25 of them are a few MB rather than tens. */
const MAX_PAYLOAD_CHARS = 24_000

function trimField(v: string | undefined): { text?: string; cut: boolean } {
  if (!v) return { text: v, cut: false }
  if (v.length <= MAX_PAYLOAD_CHARS) return { text: v, cut: false }
  return { text: `${v.slice(0, MAX_PAYLOAD_CHARS)}\n\n… [truncated ${v.length - MAX_PAYLOAD_CHARS} chars]`, cut: true }
}

function trimPayload(p: TelemetryPayload | undefined): TelemetryPayload | undefined {
  if (!p) return undefined
  const system = trimField(p.system)
  const user = trimField(p.user)
  const reasoning = trimField(p.reasoning)
  const response = trimField(p.response)
  return {
    system: system.text,
    user: user.text,
    reasoning: reasoning.text,
    response: response.text,
    truncated: system.cut || user.cut || reasoning.cut || response.cut,
  }
}
const buffer: TelemetryEntry[] = []
let nextId = 1

const EVENT_NAME = 'intelligence:telemetry'

export function recordTelemetryBlock(
  entry: Omit<TelemetryEntry, 'id' | 'ts'>,
): TelemetryEntry {
  const full: TelemetryEntry = {
    ...entry,
    payload: trimPayload(entry.payload),
    id: nextId,
    ts: Date.now(),
  }
  nextId += 1
  buffer.push(full)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  // Age out payloads before entries: the row (task, model, tokens, latency) is
  // cheap and worth keeping for 100 runs; the prompt behind it is not.
  for (let i = 0; i < buffer.length - PAYLOAD_ENTRIES; i++) {
    if (buffer[i].payload) buffer[i] = { ...buffer[i], payload: undefined }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: full }))
    } catch {
      // Non-window environments (SSR, workers) — safe to ignore.
    }
  }
  return full
}

export function readTelemetryBlock(limit = MAX_ENTRIES): TelemetryEntry[] {
  if (limit >= buffer.length) return [...buffer].reverse()
  return buffer.slice(buffer.length - limit).reverse()
}

export function clearTelemetryBlock(): void {
  buffer.length = 0
}

export function subscribeTelemetryBlock(cb: (entry: TelemetryEntry) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (e: Event) => cb((e as CustomEvent<TelemetryEntry>).detail)
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}
