import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useInfiniteCanvasBlock,
  type CanvasEdge,
} from '@/components/lego_blocks/hooks/shared/useInfiniteCanvasBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import {
  useCanvasTilesBlock,
  type CanvasTile,
} from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'
import Starfield from '@/components/lego_blocks/units/StarfieldBlock'
import CanvasBloomBlock from '@/components/lego_blocks/units/CanvasBloomBlock'
import CanvasTileBlock from '@/components/lego_blocks/units/CanvasTileBlock'
import CanvasTileToolbarBlock from '@/components/lego_blocks/units/CanvasTileToolbarBlock'
import CanvasSearchBarBlock from '@/components/lego_blocks/units/CanvasSearchBarBlock'
import CanvasContextMenuBlock from '@/components/lego_blocks/units/CanvasContextMenuBlock'
import CanvasWebWidgetPickerBlock from '@/components/lego_blocks/units/CanvasWebWidgetPickerBlock'
import CanvasMinimapBlock from '@/components/lego_blocks/units/CanvasMinimapBlock'
import ZoomIndicatorBlock from '@/components/lego_blocks/units/ZoomIndicatorBlock'
import type { CanvasStorageAdapter } from '@/services/lego_blocks/integrations/canvasStorageBlock'

const WRITE_DEBOUNCE_MS = 500

export interface CanvasSurfaceTilesApi {
  tiles: CanvasTile[]
  setAllTiles: (tiles: CanvasTile[]) => void
  loaded: boolean
}

export interface CanvasSurfaceOrchProps {
  /** Stable identifier for the surface (used as React key — keeps state isolated when multiple surfaces mount). */
  surfaceId: string
  storage: CanvasStorageAdapter
  /** Used when storage returns null (first-run / version mismatch). */
  seedTiles?: CanvasTile[]
  worldWidth?: number
  worldHeight?: number
  initialFocus?: {
    worldX: number
    worldY: number
    contentWidth: number
    contentHeight: number
  }
  /** When true, zoom-out is capped at the scale where the whole world fits the
   * viewport — no infinite sky outside the board. For bounded surfaces (F9). */
  clampMinScaleToFit?: boolean
  /** Rendered inside the transformed world *before* the tile layer (anchors, scenes, etc). */
  worldExtras?: ReactNode
  /** Optional hook bridge so callers can run effects against tile state (e.g. auto-spawn post-its). Render-prop component pattern. */
  tilesEffect?: React.ComponentType<CanvasSurfaceTilesApi>
}

const DEFAULT_WORLD_WIDTH = 4500
const DEFAULT_WORLD_HEIGHT = 3000

export default function CanvasSurfaceOrch({
  surfaceId,
  storage,
  seedTiles = [],
  worldWidth: worldWidthProp,
  worldHeight: worldHeightProp,
  initialFocus,
  clampMinScaleToFit,
  worldExtras,
  tilesEffect: TilesEffect,
}: CanvasSurfaceOrchProps) {
  const navigate = useNavigate()
  const theme = useCanvasThemeBlock()
  const { layout } = useUILayoutBlock()
  const isIos = layout.surface === 'capacitor-ios'

  const edgeTopRef = useRef<HTMLDivElement | null>(null)
  const edgeRightRef = useRef<HTMLDivElement | null>(null)
  const edgeBottomRef = useRef<HTMLDivElement | null>(null)
  const edgeLeftRef = useRef<HTMLDivElement | null>(null)
  const edgeTimersRef = useRef<Record<CanvasEdge, ReturnType<typeof setTimeout> | null>>({
    top: null, right: null, bottom: null, left: null,
  })

  const flashEdge = useCallback((edge: CanvasEdge) => {
    const el = (
      edge === 'top' ? edgeTopRef.current :
      edge === 'right' ? edgeRightRef.current :
      edge === 'bottom' ? edgeBottomRef.current :
      edgeLeftRef.current
    )
    if (!el) return
    el.dataset.active = 'true'
    const existing = edgeTimersRef.current[edge]
    if (existing) clearTimeout(existing)
    edgeTimersRef.current[edge] = setTimeout(() => {
      el.dataset.active = 'false'
      edgeTimersRef.current[edge] = null
    }, 160)
  }, [])

  useEffect(() => () => {
    for (const t of Object.values(edgeTimersRef.current)) {
      if (t) clearTimeout(t)
    }
  }, [])

  const {
    transform,
    containerRef,
    resetZoom,
    centerOnWorld,
    worldWidth,
    worldHeight,
    viewportWidth,
    viewportHeight,
  } = useInfiniteCanvasBlock({
    onEdgeHit: flashEdge,
    worldWidth: worldWidthProp ?? DEFAULT_WORLD_WIDTH,
    worldHeight: worldHeightProp ?? DEFAULT_WORLD_HEIGHT,
    initialFocus,
    clampMinScaleToFit,
  })

  const {
    tiles,
    focusedId,
    setAllTiles,
    spawnPostIt,
    spawnNote,
    spawnWebWidget,
    updateTileText,
    updateTileFontSize,
    setTileTextColor,
    setWidgetRefreshSec,
    updateTileColor,
    moveTile,
    resizeTile,
    duplicateTile,
    focusTile,
    removeTile,
  } = useCanvasTilesBlock(seedTiles)

  const handleOpenInPage = useCallback(
    (filePath: string) => {
      navigate(`/thinking-space?file=${encodeURIComponent(filePath)}`)
    },
    [navigate],
  )

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  type CanvasPopover =
    | { kind: 'menu'; screenX: number; screenY: number; worldX: number; worldY: number }
    | { kind: 'search'; screenX: number; screenY: number; worldX: number; worldY: number }
    | { kind: 'widget-picker'; worldX: number; worldY: number }
    | null
  const [popover, setPopover] = useState<CanvasPopover>(null)
  const [widgetReloadKeys, setWidgetReloadKeys] = useState<Record<string, number>>({})

  const refreshWidget = useCallback((id: string) => {
    setWidgetReloadKeys(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
  }, [])

  const transformRef = useRef(transform)
  transformRef.current = transform

  useEffect(() => {
    let cancelled = false
    void storage.read().then(saved => {
      if (cancelled) return
      if (saved && saved.length > 0) {
        setAllTiles(saved)
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [storage, setAllTiles])

  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!loaded) return
    if (writeTimerRef.current != null) clearTimeout(writeTimerRef.current)
    writeTimerRef.current = setTimeout(() => {
      void storage.write(tiles).catch(() => {
        // Storage errors are silent for now; future toolbar can surface them.
      })
    }, WRITE_DEBOUNCE_MS)
    return () => {
      if (writeTimerRef.current != null) clearTimeout(writeTimerRef.current)
    }
  }, [tiles, loaded, storage])

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      const t = transformRef.current
      return {
        x: (clientX - rect.left - t.x) / t.scale,
        y: (clientY - rect.top - t.y) / t.scale,
      }
    },
    [containerRef],
  )

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (
      e.target !== e.currentTarget &&
      !(e.target as HTMLElement).dataset.canvasBackdrop
    )
      return
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    spawnPostIt(x, y)
  }

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBackdrop) {
      if (focusedId !== null) focusTile(null)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedId) {
        const tile = tiles.find(t => t.id === focusedId)
        if (tile && tile.type === 'post-it' && tile.text.trim() === '') {
          removeTile(focusedId)
        } else {
          focusTile(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, tiles, focusTile, removeTile])

  // Auto-cleanup empty post-its when focus moves away from them.
  const prevFocusedRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevFocusedRef.current
    if (prev && prev !== focusedId) {
      const stale = tiles.find(t => t.id === prev)
      if (stale && stale.type === 'post-it' && stale.text.trim() === '') {
        removeTile(prev)
      }
    }
    prevFocusedRef.current = focusedId
  }, [focusedId, tiles, removeTile])

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target !== e.currentTarget && !target.dataset.canvasBackdrop) return
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const { x: worldX, y: worldY } = screenToWorld(e.clientX, e.clientY)
    setPopover({ kind: 'menu', screenX, screenY, worldX, worldY })
  }

  const handlePickNote = (filePath: string) => {
    if (popover?.kind !== 'search') return
    spawnNote(filePath, popover.worldX, popover.worldY)
    setPopover(null)
  }

  const handlePickWidget = (spec: {
    siteId: string
    region: { x: number; y: number; w: number; h: number }
    pageWidth: number
  }) => {
    if (popover?.kind !== 'widget-picker') return
    spawnWebWidget(spec, popover.worldX, popover.worldY)
    setPopover(null)
  }

  const focusedTile = focusedId ? tiles.find(t => t.id === focusedId) ?? null : null

  const viewportPad = 200
  const viewW = viewportWidth || window.innerWidth
  const viewH = viewportHeight || window.innerHeight
  const viewportRect = {
    x: -transform.x / transform.scale - viewportPad,
    y: -transform.y / transform.scale - viewportPad,
    w: viewW / transform.scale + viewportPad * 2,
    h: viewH / transform.scale + viewportPad * 2,
  }
  const isTileOffscreen = (tile: CanvasTile): boolean => {
    return (
      tile.x + tile.w < viewportRect.x ||
      tile.x > viewportRect.x + viewportRect.w ||
      tile.y + tile.h < viewportRect.y ||
      tile.y > viewportRect.y + viewportRect.h
    )
  }

  const toolbarPos = (() => {
    if (!focusedTile) return null
    const screenX = focusedTile.x * transform.scale + transform.x + (focusedTile.w * transform.scale) / 2
    const screenY = focusedTile.y * transform.scale + transform.y - 48
    return { x: screenX, y: Math.max(8, screenY) }
  })()
  const hudEdgeInset = 24
  const minimapWidth = 150
  const minimapHeight = Math.round((minimapWidth * worldHeight) / worldWidth)

  return (
    <div
      key={surfaceId}
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        background: theme.outerBg,
        ['--canvas-edge-blend' as string]: theme.edgeBlend,
      }}
    >
      <style>{`
        [data-canvas-tile], [data-canvas-tile] *, [data-canvas-anchor-element], [data-canvas-anchor-element] * {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        [data-canvas-tile]::-webkit-scrollbar, [data-canvas-tile] *::-webkit-scrollbar,
        [data-canvas-anchor-element]::-webkit-scrollbar, [data-canvas-anchor-element] *::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }
        [data-canvas-tile] .prose {
          font-size: var(--canvas-md-font-size, 12px);
          line-height: 1.5;
        }
        [data-canvas-tile] .prose h1 { font-size: 1.5em; margin: 0.6em 0 0.3em; }
        [data-canvas-tile] .prose h2 { font-size: 1.3em; margin: 0.6em 0 0.3em; }
        [data-canvas-tile] .prose h3 { font-size: 1.15em; margin: 0.5em 0 0.25em; }
        [data-canvas-tile] .prose h4,
        [data-canvas-tile] .prose h5,
        [data-canvas-tile] .prose h6 { font-size: 1em; margin: 0.5em 0 0.2em; }
        [data-canvas-tile] .prose p,
        [data-canvas-tile] .prose li { margin: 0.4em 0; }
        [data-canvas-tile] .prose pre,
        [data-canvas-tile] .prose code { font-size: 0.9em; }
        [data-canvas-tile] .prose ul,
        [data-canvas-tile] .prose ol { padding-left: 1.2em; margin: 0.4em 0; }

        [data-canvas-edge] {
          position: absolute;
          pointer-events: none;
          opacity: 0;
          transition: opacity 420ms ease-out;
          z-index: 5;
          mix-blend-mode: var(--canvas-edge-blend, screen);
          filter: blur(4px);
        }
        [data-canvas-edge][data-active="true"] {
          opacity: 1;
          transition: opacity 90ms ease-out;
        }

        [data-canvas-edge="top"], [data-canvas-edge="bottom"] {
          left: 0; right: 0; height: 70px;
          background: linear-gradient(90deg,
            rgba(125,211,252,0.65) 0%,
            rgba(94,234,212,0.7)   25%,
            rgba(134,239,172,0.7)  50%,
            rgba(94,234,212,0.7)   75%,
            rgba(125,211,252,0.65) 100%);
          background-size: 220% 100%;
          animation: canvas-aurora-h 9s linear infinite;
        }
        [data-canvas-edge="top"] {
          top: 0;
          -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
          mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
        }
        [data-canvas-edge="bottom"] {
          bottom: 0;
          -webkit-mask-image: linear-gradient(to top, black 0%, transparent 100%);
          mask-image: linear-gradient(to top, black 0%, transparent 100%);
        }

        [data-canvas-edge="left"], [data-canvas-edge="right"] {
          top: 0; bottom: 0; width: 70px;
          background: linear-gradient(180deg,
            rgba(125,211,252,0.65) 0%,
            rgba(94,234,212,0.7)   25%,
            rgba(134,239,172,0.7)  50%,
            rgba(94,234,212,0.7)   75%,
            rgba(125,211,252,0.65) 100%);
          background-size: 100% 220%;
          animation: canvas-aurora-v 9s linear infinite;
        }
        [data-canvas-edge="left"] {
          left: 0;
          -webkit-mask-image: linear-gradient(to right, black 0%, transparent 100%);
          mask-image: linear-gradient(to right, black 0%, transparent 100%);
        }
        [data-canvas-edge="right"] {
          right: 0;
          -webkit-mask-image: linear-gradient(to left, black 0%, transparent 100%);
          mask-image: linear-gradient(to left, black 0%, transparent 100%);
        }

        @keyframes canvas-aurora-h {
          from { background-position:   0% 0%; }
          to   { background-position: 220% 0%; }
        }
        @keyframes canvas-aurora-v {
          from { background-position: 0%   0%; }
          to   { background-position: 0% 220%; }
        }
      `}</style>
      <div style={{ position: 'absolute', inset: 0 }} aria-hidden>
        {theme.showNebula && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: theme.nebulaGradient,
            }}
          />
        )}
        {theme.showStars && <Starfield starColor={theme.starColor} />}
        {theme.vignetteGradient && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: theme.vignetteGradient,
            }}
          />
        )}
      </div>

      <CanvasBloomBlock
        intensified={hoveredId !== null}
        dotColor={theme.bloomDot}
        rect={{
          left: transform.x,
          top: transform.y,
          width: worldWidth * transform.scale,
          height: worldHeight * transform.scale,
        }}
      />

      <div
        data-canvas-backdrop="true"
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleBackdropMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: worldWidth,
          height: worldHeight,
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          transformOrigin: '0 0',
          willChange: 'transform',
          borderRadius: isIos ? 0 : 16,
          border: isIos ? 'none' : `1px solid ${theme.boardBorder}`,
          boxShadow: isIos ? 'none' : theme.boardGlow,
        }}
      >
        {worldExtras}
        {tiles.map(tile => (
          <CanvasTileBlock
            key={tile.id}
            tile={tile}
            focused={focusedId === tile.id}
            scale={transform.scale}
            offscreen={isTileOffscreen(tile)}
            reloadKey={widgetReloadKeys[tile.id] ?? 0}
            onFocus={focusTile}
            onBlur={() => focusTile(null)}
            onHoverChange={setHoveredId}
            onChange={updateTileText}
            onResize={resizeTile}
            onRemove={removeTile}
          />
        ))}
      </div>

      {focusedTile && toolbarPos && (
        <CanvasTileToolbarBlock
          tile={focusedTile}
          screenX={toolbarPos.x}
          screenY={toolbarPos.y}
          scale={transform.scale}
          onMove={moveTile}
          onSetColor={updateTileColor}
          onSetFontSize={updateTileFontSize}
          onSetTextColor={setTileTextColor}
          onDuplicate={duplicateTile}
          onRemove={removeTile}
          onOpenInPage={handleOpenInPage}
          onRefreshWidget={refreshWidget}
          onSetWidgetRefreshSec={setWidgetRefreshSec}
        />
      )}

      {popover?.kind === 'menu' && (
        <CanvasContextMenuBlock
          screenX={popover.screenX}
          screenY={popover.screenY}
          onAddNote={() =>
            setPopover({
              kind: 'search',
              screenX: popover.screenX,
              screenY: popover.screenY,
              worldX: popover.worldX,
              worldY: popover.worldY,
            })
          }
          onAddWidget={() =>
            setPopover({
              kind: 'widget-picker',
              worldX: popover.worldX,
              worldY: popover.worldY,
            })
          }
          onClose={() => setPopover(null)}
        />
      )}
      {popover?.kind === 'search' && (
        <CanvasSearchBarBlock
          screenX={popover.screenX}
          screenY={popover.screenY}
          onClose={() => setPopover(null)}
          onPick={handlePickNote}
        />
      )}
      {popover?.kind === 'widget-picker' && (
        <CanvasWebWidgetPickerBlock
          onPick={handlePickWidget}
          onClose={() => setPopover(null)}
        />
      )}

      <CanvasMinimapBlock
        tiles={tiles}
        worldWidth={worldWidth}
        worldHeight={worldHeight}
        transformX={transform.x}
        transformY={transform.y}
        scale={transform.scale}
        viewport={{ width: viewW, height: viewH }}
        onJump={centerOnWorld}
        width={minimapWidth}
        edgeInset={hudEdgeInset}
      />

      <ZoomIndicatorBlock
        scale={transform.scale}
        onReset={resetZoom}
        edgeInset={hudEdgeInset}
        minimapHeight={minimapHeight}
      />

      <div ref={edgeTopRef} data-canvas-edge="top" data-active="false" aria-hidden />
      <div ref={edgeRightRef} data-canvas-edge="right" data-active="false" aria-hidden />
      <div ref={edgeBottomRef} data-canvas-edge="bottom" data-active="false" aria-hidden />
      <div ref={edgeLeftRef} data-canvas-edge="left" data-active="false" aria-hidden />

      {TilesEffect && <TilesEffect tiles={tiles} setAllTiles={setAllTiles} loaded={loaded} />}
    </div>
  )
}
