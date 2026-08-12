/**
 * Long-frame counter for canvas interaction.
 *
 * Exists because three canvas "optimizations" shipped in one day on reasoning
 * alone, and every regression was found by a human noticing dropped frames by
 * eye. That is a broken loop: the user should not be the instrument. This turns
 * "feels laggy" into p95 and a long-frame count, at both zoom extremes, before
 * and after a change.
 *
 * Records rAF deltas only while a recording is open, so it costs nothing at
 * rest — the energy contract forbids an unconditional rAF loop, and a frame
 * profiler that burns battery to watch for battery burn would be self-defeating.
 *
 * Usage: `beginFrameRecording('pan @ 0.25')`, drive the interaction, then
 * `endFrameRecording()`. Results also land in `listFrameRecordings()` for the
 * debug panel.
 */

export interface FrameRecordingBlock {
  label: string
  startedAt: number
  durationMs: number
  frames: number
  fps: number
  /** Frame deltas in ms, sorted, for percentile reads. */
  p50: number
  p95: number
  p99: number
  worst: number
  /** Frames slower than 20ms — a dropped frame at 60Hz (16.7ms budget). */
  longFrames: number
  /** Frames slower than 50ms — a visible hitch, not just a drop. */
  hitches: number
}

const LONG_FRAME_MS = 20
const HITCH_MS = 50
const MAX_RECORDINGS = 20
/** Hard stop so a recording someone forgot to end cannot run forever. */
const MAX_RECORDING_MS = 60_000

const recordings: FrameRecordingBlock[] = []

let activeLabel: string | null = null
let activeStart = 0
let activeDeltas: number[] = []
let lastFrameAt = 0
let rafId: number | null = null

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function tick(now: number): void {
  if (activeLabel === null) return

  if (lastFrameAt > 0) activeDeltas.push(now - lastFrameAt)
  lastFrameAt = now

  if (now - activeStart >= MAX_RECORDING_MS) {
    endFrameRecordingBlock()
    return
  }
  rafId = requestAnimationFrame(tick)
}

export function isFrameRecordingBlock(): boolean {
  return activeLabel !== null
}

export function beginFrameRecordingBlock(label: string): void {
  if (activeLabel !== null) endFrameRecordingBlock()
  activeLabel = label
  activeStart = performance.now()
  activeDeltas = []
  lastFrameAt = 0
  rafId = requestAnimationFrame(tick)
}

export function endFrameRecordingBlock(): FrameRecordingBlock | null {
  if (activeLabel === null) return null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }

  const label = activeLabel
  const deltas = activeDeltas
  const durationMs = performance.now() - activeStart
  activeLabel = null
  activeDeltas = []

  // A recording with one frame or fewer has no deltas to describe.
  if (deltas.length === 0) return null

  const sorted = [...deltas].sort((a, b) => a - b)
  const result: FrameRecordingBlock = {
    label,
    startedAt: activeStart,
    durationMs,
    frames: deltas.length,
    fps: (deltas.length / durationMs) * 1000,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    worst: sorted[sorted.length - 1],
    longFrames: deltas.filter(d => d > LONG_FRAME_MS).length,
    hitches: deltas.filter(d => d > HITCH_MS).length,
  }

  recordings.unshift(result)
  if (recordings.length > MAX_RECORDINGS) recordings.length = MAX_RECORDINGS
  return result
}

export function listFrameRecordingsBlock(): FrameRecordingBlock[] {
  return recordings
}

export function clearFrameRecordingsBlock(): void {
  recordings.length = 0
}

/**
 * Console handle. The whole point is measuring a *pointer interaction*, which
 * no automated harness can drive convincingly — so it has to be startable from
 * DevTools while a human pans the canvas:
 *
 *   __thinkspc_frames.start('pan @ 0.25')   // ...pan around...
 *   __thinkspc_frames.stop()
 */
declare global {
  interface Window {
    __thinkspc_frames?: {
      start: (label: string) => void
      stop: () => FrameRecordingBlock | null
      list: () => FrameRecordingBlock[]
      clear: () => void
    }
  }
}

if (typeof window !== 'undefined') {
  window.__thinkspc_frames = {
    start: beginFrameRecordingBlock,
    stop: () => {
      const r = endFrameRecordingBlock()
      if (r) console.log(formatFrameRecordingBlock(r))
      return r
    },
    list: listFrameRecordingsBlock,
    clear: clearFrameRecordingsBlock,
  }
}

export function formatFrameRecordingBlock(r: FrameRecordingBlock): string {
  return [
    `${r.label}`,
    `  ${r.frames} frames in ${r.durationMs.toFixed(0)}ms = ${r.fps.toFixed(1)} fps`,
    `  p50 ${r.p50.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  p99 ${r.p99.toFixed(1)}ms  worst ${r.worst.toFixed(1)}ms`,
    `  ${r.longFrames} long (>${LONG_FRAME_MS}ms)  ${r.hitches} hitches (>${HITCH_MS}ms)`,
  ].join('\n')
}
