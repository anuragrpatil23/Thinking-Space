import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  computeMiniMapProjection,
  type MiniMapBounds,
} from '@/services/lego_blocks/integrations/excalidrawSceneAnalysisBlock'
import type { ExcalidrawCanvasApiBlock } from '@/services/lego_blocks/integrations/excalidrawIntegrationBlock'
import { resolveViewportWorldSize } from '@/services/lego_blocks/integrations/excalidrawViewportBlock'

export const MINIMAP_BOX_WIDTH = 100
export const MINIMAP_BOX_HEIGHT = 72

const IDLE_FADE_DELAY_MS = 1500

interface MiniMapRect {
  x: number
  y: number
  width: number
  height: number
  key: string
  color: string | null
}

interface ExcalidrawMiniMapBlockProps {
  bounds: MiniMapBounds
  rects: MiniMapRect[]
  scrollState: { scrollX: number; scrollY: number; zoom: number }
  excalidrawApi: ExcalidrawCanvasApiBlock | null
  containerSize: { width: number; height: number }
  isIosSurface: boolean
}

export type { MiniMapRect }

export default function ExcalidrawMiniMapBlock({
  bounds,
  rects,
  scrollState,
  excalidrawApi,
  containerSize,
  isIosSurface,
}: ExcalidrawMiniMapBlockProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [panActive, setPanActive] = useState(false)
  const panIdleTimerRef = useRef<number | null>(null)
  const mountedAtRef = useRef(Date.now())

  // Pulse to full opacity while the canvas viewport is moving, then fade.
  useEffect(() => {
    if (Date.now() - mountedAtRef.current < 250) return
    setPanActive(true)
    if (panIdleTimerRef.current !== null) window.clearTimeout(panIdleTimerRef.current)
    panIdleTimerRef.current = window.setTimeout(() => {
      panIdleTimerRef.current = null
      setPanActive(false)
    }, IDLE_FADE_DELAY_MS)
  }, [scrollState.scrollX, scrollState.scrollY, scrollState.zoom])

  useEffect(() => () => {
    if (panIdleTimerRef.current !== null) window.clearTimeout(panIdleTimerRef.current)
  }, [])

  const projection = computeMiniMapProjection(bounds, MINIMAP_BOX_WIDTH, MINIMAP_BOX_HEIGHT)

  const panToPointer = useCallback((clientX: number, clientY: number) => {
    if (!excalidrawApi || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const boxX = ((clientX - rect.left) / Math.max(rect.width, 1)) * MINIMAP_BOX_WIDTH
    const boxY = ((clientY - rect.top) / Math.max(rect.height, 1)) * MINIMAP_BOX_HEIGHT

    const worldX = bounds.minX + (boxX - projection.offsetX) / projection.scale
    const worldY = bounds.minY + (boxY - projection.offsetY) / projection.scale

    const zoom = Math.max(excalidrawApi.getViewportStateBlock().zoom, 0.01)
    const { viewportWorldW, viewportWorldH } = resolveViewportWorldSize({
      excalidrawApi,
      zoom,
      fallbackWidth: containerSize.width,
      fallbackHeight: containerSize.height,
    })
    excalidrawApi.updateViewportBlock({
      scrollX: -worldX + viewportWorldW / 2,
      scrollY: -worldY + viewportWorldH / 2,
    })
  }, [bounds.minX, bounds.minY, containerSize.height, containerSize.width, excalidrawApi, projection.offsetX, projection.offsetY, projection.scale])

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    panToPointer(event.clientX, event.clientY)
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    panToPointer(event.clientX, event.clientY)
  }

  const endDrag = () => setDragging(false)

  const viewportZoom = Math.max(scrollState.zoom, 0.01)
  const leftWorld = -scrollState.scrollX
  const topWorld = -scrollState.scrollY
  const { viewportWorldW, viewportWorldH } = resolveViewportWorldSize({
    excalidrawApi,
    zoom: viewportZoom,
    fallbackWidth: containerSize.width,
    fallbackHeight: containerSize.height,
  })
  const vxRaw = (leftWorld - bounds.minX) * projection.scale + projection.offsetX
  const vyRaw = (topWorld - bounds.minY) * projection.scale + projection.offsetY
  const vwRaw = viewportWorldW * projection.scale
  const vhRaw = viewportWorldH * projection.scale
  // Clamp to the box so a zoomed-out viewport doesn't paint outside the minimap.
  const vx = Math.max(0, Math.min(vxRaw, MINIMAP_BOX_WIDTH))
  const vy = Math.max(0, Math.min(vyRaw, MINIMAP_BOX_HEIGHT))
  const vw = Math.max(Math.min(vxRaw + vwRaw, MINIMAP_BOX_WIDTH) - vx, 0)
  const vh = Math.max(Math.min(vyRaw + vhRaw, MINIMAP_BOX_HEIGHT) - vy, 0)

  const engaged = hovering || dragging || panActive

  return (
    <div
      className={cn(
        'absolute right-3 z-30 rounded-lg border border-border/60 bg-background/90 p-1 shadow-sm backdrop-blur transition-opacity duration-300',
        engaged ? 'opacity-100' : 'opacity-40',
        dragging ? 'cursor-grabbing' : 'cursor-pointer',
      )}
      style={{ bottom: isIosSurface ? 'calc(var(--ltm-safe-bottom, 0px) + 0.5rem)' : '0.75rem' }}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHovering(true) }}
      onPointerLeave={() => setHovering(false)}
      role="button"
      aria-label="Mini map — click or drag to move the viewport"
    >
      <svg
        ref={svgRef}
        data-navmap-track
        viewBox={`0 0 ${MINIMAP_BOX_WIDTH} ${MINIMAP_BOX_HEIGHT}`}
        className="h-16 w-24 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect x="0" y="0" width={MINIMAP_BOX_WIDTH} height={MINIMAP_BOX_HEIGHT} rx="4" fill="hsl(var(--muted) / 0.45)" />
        {/* Mirror Excalidraw's dark-theme canvas filter so authored colors stay legible. */}
        <g className="dark:[filter:invert(0.93)_hue-rotate(180deg)]">
          {rects.map((r) => (
            <rect
              key={r.key}
              x={r.x}
              y={r.y}
              width={r.width}
              height={r.height}
              rx="0.75"
              fill={r.color ?? 'hsl(var(--foreground) / 0.2)'}
              fillOpacity={r.color ? 0.5 : 1}
            />
          ))}
        </g>
        {vw > 0 && vh > 0 && (
          <rect x={vx} y={vy} width={vw} height={vh} rx="1" fill="hsl(var(--primary) / 0.08)" stroke="hsl(var(--primary))" strokeWidth="1" />
        )}
      </svg>
    </div>
  )
}
