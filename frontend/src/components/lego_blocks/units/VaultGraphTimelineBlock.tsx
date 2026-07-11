// Timeline scrubber for the vault graph — two lanes on one canvas.
//
// Bottom lane: weekly histogram of note births, doubling as the scrub track.
// Weeks left of the playhead burn amber (already born); weeks right stay ash.
// Top lane: ember bars of AI touch activity (notes whose last modification
// fell in a vault AI session that week). Dragging on the top lane brushes a
// time window — the graph lights the notes AI touched inside it — so the
// activity chart is a control, not a decoration.

import { useEffect, useMemo, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'

const WEEK_MS = 7 * 86_400_000
const BORN_COLOR = '#E0A458'
const UNBORN_COLOR = 'rgba(139, 147, 166, 0.28)'
const PLAYHEAD_COLOR = 'rgba(224, 164, 88, 0.95)'
const EMBER_COLOR = 'rgba(255, 158, 61, 0.75)'
const EMBER_DIM_COLOR = 'rgba(255, 158, 61, 0.28)'
const BRUSH_FILL = 'rgba(255, 158, 61, 0.10)'
const BRUSH_EDGE = 'rgba(255, 158, 61, 0.85)'

/** Top lane height (AI activity + brush) within the canvas, css px. */
const AI_LANE_H = 18
const LANE_GAP = 3
/** Pointer drags under this many px count as a click (clears the brush). */
const CLICK_SLOP_PX = 4

function weeklyBins(minMs: number, maxMs: number, times: number[]) {
  const start = Math.floor(minMs / WEEK_MS) * WEEK_MS
  const count = Math.max(1, Math.ceil((maxMs - start) / WEEK_MS) + 1)
  const heights = new Array<number>(count).fill(0)
  for (const t of times) {
    const idx = Math.min(count - 1, Math.max(0, Math.floor((t - start) / WEEK_MS)))
    heights[idx]++
  }
  return { start, count, heights, max: Math.max(1, ...heights) }
}

interface VaultGraphTimelineBlockProps {
  minMs: number
  maxMs: number
  /** Sorted birth timestamps (ms) of every visible-container note. */
  birthsMs: number[]
  /** AI-touch timestamps (ms) of visible-container notes. */
  aiTouchesMs: number[]
  scrubMs: number
  playing: boolean
  /** Active AI-window brush, or null. */
  brush: [number, number] | null
  onScrub: (ms: number) => void
  onTogglePlay: () => void
  onBrush: (window: [number, number] | null) => void
}

export default function VaultGraphTimelineBlock({
  minMs,
  maxMs,
  birthsMs,
  aiTouchesMs,
  scrubMs,
  playing,
  brush,
  onScrub,
  onTogglePlay,
  onBrush,
}: VaultGraphTimelineBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerRef = useRef<{ mode: 'scrub' | 'brush'; startX: number; startMs: number } | null>(null)

  const birthBins = useMemo(() => weeklyBins(minMs, maxMs, birthsMs), [minMs, maxMs, birthsMs])
  const aiBins = useMemo(() => weeklyBins(minMs, maxMs, aiTouchesMs), [minMs, maxMs, aiTouchesMs])

  const range = Math.max(1, maxMs - minMs)
  const msAtX = (x: number, width: number) =>
    Math.min(maxMs, Math.max(minMs, minMs + (x / Math.max(1, width)) * range))

  // Redraw on any input change — a few hundred bars, well under a frame.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const cssWidth = parent.clientWidth
    const cssHeight = parent.clientHeight
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    const xOf = (ms: number) => ((ms - minMs) / range) * cssWidth
    const barWidth = Math.max(1, cssWidth / birthBins.count - 1)

    // ── Top lane: AI touch activity ──
    for (let i = 0; i < aiBins.count; i++) {
      if (aiBins.heights[i] === 0) continue
      const binStart = aiBins.start + i * WEEK_MS
      const binEnd = binStart + WEEK_MS
      const h = Math.max(1.5, Math.sqrt(aiBins.heights[i] / aiBins.max) * (AI_LANE_H - 2))
      const inBrush = brush !== null && binEnd > brush[0] && binStart < brush[1]
      ctx.fillStyle = brush === null || inBrush ? EMBER_COLOR : EMBER_DIM_COLOR
      ctx.fillRect(xOf(binStart), AI_LANE_H - h, barWidth, h)
    }

    // ── Bottom lane: birth histogram / scrub track ──
    const trackTop = AI_LANE_H + LANE_GAP
    const trackHeight = cssHeight - trackTop
    for (let i = 0; i < birthBins.count; i++) {
      const binStart = birthBins.start + i * WEEK_MS
      // sqrt scale keeps big synthesis bursts from flattening quiet weeks.
      const h = Math.max(1.5, Math.sqrt(birthBins.heights[i] / birthBins.max) * (trackHeight - 4))
      ctx.fillStyle = binStart <= scrubMs ? BORN_COLOR : UNBORN_COLOR
      ctx.globalAlpha = binStart <= scrubMs ? 0.85 : 1
      ctx.fillRect(xOf(binStart), cssHeight - h, barWidth, h)
    }
    ctx.globalAlpha = 1

    // ── Brush window overlay across both lanes ──
    if (brush !== null) {
      const x0 = xOf(brush[0])
      const x1 = xOf(brush[1])
      ctx.fillStyle = BRUSH_FILL
      ctx.fillRect(x0, 0, x1 - x0, cssHeight)
      ctx.fillStyle = BRUSH_EDGE
      ctx.fillRect(x0 - 0.5, 0, 1, cssHeight)
      ctx.fillRect(x1 - 0.5, 0, 1, cssHeight)
    }

    // ── Playhead ──
    const playheadX = xOf(scrubMs)
    ctx.fillStyle = PLAYHEAD_COLOR
    ctx.fillRect(playheadX - 0.75, trackTop, 1.5, cssHeight - trackTop)
    ctx.beginPath()
    ctx.arc(playheadX, trackTop + 3, 3, 0, 2 * Math.PI)
    ctx.fill()
  }, [birthBins, aiBins, minMs, maxMs, range, scrubMs, brush])

  const scrubDateLabel = new Date(scrubMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause replay' : 'Replay vault growth'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div
        className="relative h-[74px] min-w-0 flex-1 cursor-ew-resize touch-none select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="slider"
        tabIndex={0}
        aria-label="Vault growth timeline; top lane brushes an AI-activity window"
        aria-valuemin={minMs}
        aria-valuemax={maxMs}
        aria-valuenow={scrubMs}
        aria-valuetext={scrubDateLabel}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          const ms = msAtX(x, rect.width)
          if (y <= AI_LANE_H + LANE_GAP / 2) {
            pointerRef.current = { mode: 'brush', startX: x, startMs: ms }
          } else {
            pointerRef.current = { mode: 'scrub', startX: x, startMs: ms }
            onScrub(ms)
          }
        }}
        onPointerMove={e => {
          const state = pointerRef.current
          if (!state || e.buttons !== 1) return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          const ms = msAtX(x, rect.width)
          if (state.mode === 'scrub') {
            onScrub(ms)
          } else {
            onBrush(ms < state.startMs ? [ms, state.startMs] : [state.startMs, ms])
          }
        }}
        onPointerUp={e => {
          const state = pointerRef.current
          pointerRef.current = null
          if (!state || state.mode !== 'brush') return
          const rect = e.currentTarget.getBoundingClientRect()
          // A click (no real drag) on the AI lane clears the brush.
          if (Math.abs(e.clientX - rect.left - state.startX) < CLICK_SLOP_PX) onBrush(null)
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') onScrub(Math.max(minMs, scrubMs - WEEK_MS))
          else if (e.key === 'ArrowRight') onScrub(Math.min(maxMs, scrubMs + WEEK_MS))
          else if (e.key === 'Home') onScrub(minMs)
          else if (e.key === 'End') onScrub(maxMs)
          else if (e.key === 'Escape') onBrush(null)
          else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            onTogglePlay()
          }
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>

      <div className="w-28 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {scrubDateLabel}
      </div>
    </div>
  )
}
