import { useRef } from 'react'
import type { CanvasTile } from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { POST_IT_PALETTE } from './postItPaletteBlock'

interface ScreenRect {
  width: number
  height: number
}

interface Props {
  tiles: CanvasTile[]
  worldWidth: number
  worldHeight: number
  transformX: number
  transformY: number
  scale: number
  viewport: ScreenRect
  onJump: (worldX: number, worldY: number) => void
  /** mini-map width in screen pixels; height derived from world aspect ratio */
  width?: number
  /** Inset from the visible canvas edge in screen pixels. */
  edgeInset?: number
}

export default function CanvasMinimapBlock({
  tiles,
  worldWidth,
  worldHeight,
  transformX,
  transformY,
  scale,
  viewport,
  onJump,
  width = 150,
  edgeInset = 24,
}: Props) {
  const theme = useCanvasThemeBlock()
  const ref = useRef<HTMLDivElement | null>(null)
  const height = Math.round((width * worldHeight) / worldWidth)
  const sx = width / worldWidth // world→minimap scale x
  const sy = height / worldHeight

  // Viewport rectangle in world coords (the visible window onto the board)
  const visWorldX = -transformX / scale
  const visWorldY = -transformY / scale
  const visWorldW = viewport.width / scale
  const visWorldH = viewport.height / scale

  // Clamp viewport rect to board so it doesn't draw outside the minimap
  const rectX = Math.max(0, visWorldX) * sx
  const rectY = Math.max(0, visWorldY) * sy
  const rectW = Math.min(worldWidth, visWorldX + visWorldW) * sx - rectX
  const rectH = Math.min(worldHeight, visWorldY + visWorldH) * sy - rectY

  const jumpFromMouse = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    onJump(localX / sx, localY / sy)
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    jumpFromMouse(e.clientX, e.clientY)
    const onMove = (ev: PointerEvent) => jumpFromMouse(ev.clientX, ev.clientY)
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      aria-label="Canvas minimap"
      style={{
        position: 'absolute',
        bottom: edgeInset,
        right: edgeInset,
        width,
        height,
        background: theme.minimapBg,
        border: `1px solid ${theme.minimapBorder}`,
        borderRadius: 6,
        boxShadow: theme.isDark ? '0 10px 30px rgba(0,0,0,0.55)' : '0 10px 30px rgba(20,20,24,0.12)',
        overflow: 'hidden',
        cursor: 'crosshair',
        zIndex: 90,
      }}
    >
      {tiles.map(tile => {
        const cx = (tile.x + tile.w / 2) * sx
        const cy = (tile.y + tile.h / 2) * sy
        const color =
          tile.type === 'post-it'
            ? POST_IT_PALETTE[tile.color].cornerMark
            : theme.isDark
              ? 'rgba(180, 200, 255, 0.85)'
              : 'rgba(80, 100, 200, 0.85)'
        return (
          <div
            key={tile.id}
            style={{
              position: 'absolute',
              left: cx - 2,
              top: cy - 2,
              width: 4,
              height: 4,
              borderRadius: 2,
              background: color,
              opacity: 0.85,
              pointerEvents: 'none',
            }}
          />
        )
      })}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: rectX,
          top: rectY,
          width: Math.max(2, rectW),
          height: Math.max(2, rectH),
          border: `1px solid ${theme.minimapViewport}`,
          background: theme.minimapViewportFill,
          borderRadius: 2,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
