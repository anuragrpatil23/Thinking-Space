// Growth timeline scrubber for the vault graph — a single lane.
//
// Weekly histogram of note births that doubles as the scrub track: weeks left
// of the playhead burn amber (already born), weeks right stay ash. Drag or use
// the arrow keys to move the playhead; the graph reveals notes as they're born.

import { useEffect, useMemo, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'

const WEEK_MS = 7 * 86_400_000
const BORN_COLOR = '#E0A458'
const UNBORN_COLOR = 'rgba(139, 147, 166, 0.28)'
const PLAYHEAD_COLOR = 'rgba(224, 164, 88, 0.95)'

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
  scrubMs: number
  playing: boolean
  onScrub: (ms: number) => void
  onTogglePlay: () => void
}

export default function VaultGraphTimelineBlock({
  minMs,
  maxMs,
  birthsMs,
  scrubMs,
  playing,
  onScrub,
  onTogglePlay,
}: VaultGraphTimelineBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const draggingRef = useRef(false)

  const birthBins = useMemo(() => weeklyBins(minMs, maxMs, birthsMs), [minMs, maxMs, birthsMs])

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

    // Birth histogram / scrub track.
    for (let i = 0; i < birthBins.count; i++) {
      const binStart = birthBins.start + i * WEEK_MS
      // sqrt scale keeps big synthesis bursts from flattening quiet weeks.
      const h = Math.max(1.5, Math.sqrt(birthBins.heights[i] / birthBins.max) * (cssHeight - 4))
      ctx.fillStyle = binStart <= scrubMs ? BORN_COLOR : UNBORN_COLOR
      ctx.globalAlpha = binStart <= scrubMs ? 0.85 : 1
      ctx.fillRect(xOf(binStart), cssHeight - h, barWidth, h)
    }
    ctx.globalAlpha = 1

    // Playhead.
    const playheadX = xOf(scrubMs)
    ctx.fillStyle = PLAYHEAD_COLOR
    ctx.fillRect(playheadX - 0.75, 0, 1.5, cssHeight)
    ctx.beginPath()
    ctx.arc(playheadX, 3, 3, 0, 2 * Math.PI)
    ctx.fill()
  }, [birthBins, minMs, maxMs, range, scrubMs])

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
        className="relative h-[56px] min-w-0 flex-1 cursor-ew-resize touch-none select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="slider"
        tabIndex={0}
        aria-label="Vault growth timeline"
        aria-valuemin={minMs}
        aria-valuemax={maxMs}
        aria-valuenow={scrubMs}
        aria-valuetext={scrubDateLabel}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          draggingRef.current = true
          const rect = e.currentTarget.getBoundingClientRect()
          onScrub(msAtX(e.clientX - rect.left, rect.width))
        }}
        onPointerMove={e => {
          if (!draggingRef.current || e.buttons !== 1) return
          const rect = e.currentTarget.getBoundingClientRect()
          onScrub(msAtX(e.clientX - rect.left, rect.width))
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') onScrub(Math.max(minMs, scrubMs - WEEK_MS))
          else if (e.key === 'ArrowRight') onScrub(Math.min(maxMs, scrubMs + WEEK_MS))
          else if (e.key === 'Home') onScrub(minMs)
          else if (e.key === 'End') onScrub(maxMs)
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
