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
  /** Kept for the diagnostics "replay" button — trimmed to reasonable size. */
  requestPreview?: string
  responsePreview?: string
}

const MAX_ENTRIES = 100
const buffer: TelemetryEntry[] = []
let nextId = 1

const EVENT_NAME = 'intelligence:telemetry'

export function recordTelemetryBlock(
  entry: Omit<TelemetryEntry, 'id' | 'ts'>,
): TelemetryEntry {
  const full: TelemetryEntry = { ...entry, id: nextId, ts: Date.now() }
  nextId += 1
  buffer.push(full)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
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
