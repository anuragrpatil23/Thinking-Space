import { useCallback, useState } from 'react'
import {
  DEFAULT_POST_IT_COLOR,
  type PostItColor,
} from '@/components/lego_blocks/units/postItPaletteBlock'

export type CanvasTileType = 'post-it' | 'note' | 'web-widget'

export interface CanvasTileBase {
  id: string
  x: number
  y: number
  w: number
  h: number
  locked: boolean
  /** Epoch ms the tile was created. Optional: tiles persisted before this field shipped won't have it. */
  createdAt?: number
  /** Epoch ms of the last edit (content, style, move, or resize). Absent until first edit. */
  updatedAt?: number
}

/**
 * 's' / 'm' / 'l' are preset shortcuts (resolved at render time to 11/13/17px
 * for post-its, 11/12/15px for note prose). A number overrides any preset
 * with an exact pixel value for fine-grained control.
 */
export type PostItFontSize = 's' | 'm' | 'l' | number

export interface AutoActivityState {
  /** ISO date (YYYY-MM-DD, local) this post-it owns. One auto post-it per day. */
  date: string
  /** Chain keys already rendered into the post-it body — used to append only the new ones. */
  seenChainKeys: string[]
}

export interface CanvasPostItTile extends CanvasTileBase {
  type: 'post-it'
  text: string
  color: PostItColor
  fontSize?: PostItFontSize
  /** Optional text color (any post-it color). Undefined = theme default. */
  textColor?: PostItColor
  /**
   * When set, this post-it is the auto-generated daily Claude activity skeleton
   * for the named date. Refreshes append-only: the orchestrator diffs current
   * chains against `seenChainKeys` and appends new ones to the bottom of `text`,
   * leaving anything the user wrote alone.
   */
  autoActivityState?: AutoActivityState
}

export interface CanvasNoteTile extends CanvasTileBase {
  type: 'note'
  filePath: string
  fontSize?: PostItFontSize
}

/**
 * Clipped live view onto a region of a Web tab site.
 * region.{x,y,w,h} are in page-pixel coords against the rendered webview width.
 */
export interface CanvasWebWidgetTile extends CanvasTileBase {
  type: 'web-widget'
  siteId: string
  region: { x: number; y: number; w: number; h: number }
  /** Rendered page width used during region capture (lets us reproduce layout). */
  pageWidth: number
  /** Auto-refresh interval in seconds. Undefined = off (live webview only). */
  refreshSec?: number
}

export type CanvasTile = CanvasPostItTile | CanvasNoteTile | CanvasWebWidgetTile

let tileSeq = 0
const nextTileId = () => `tile-${Date.now().toString(36)}-${(tileSeq++).toString(36)}`

const DEFAULT_TILE_W = 280
const DEFAULT_TILE_H = 280
export const MIN_TILE_W = 160
export const MIN_TILE_H = 120
// No maximum. Cards grow as large as the user drags them — a card holding a
// long note or a captured page is only useful at the size its content needs,
// and an 800px ceiling silently stopped the resize handle mid-drag with no
// explanation. Minimums stay: a zero-size card is unrecoverable, since there
// would be no handle left to grab.
//
// Nothing clamps on load (`setAllTiles` passes tiles through untouched), so
// removing the ceiling frees already-created cards too, not just new ones.

export interface UseCanvasTilesResult {
  tiles: CanvasTile[]
  focusedId: string | null
  setAllTiles: (tiles: CanvasTile[]) => void
  spawnPostIt: (worldX: number, worldY: number) => string
  spawnNote: (filePath: string, worldX: number, worldY: number) => string
  spawnWebWidget: (
    spec: { siteId: string; region: { x: number; y: number; w: number; h: number }; pageWidth: number },
    worldX: number,
    worldY: number,
  ) => string
  updateTileText: (id: string, text: string) => void
  updateTileColor: (id: string, color: PostItColor) => void
  updateTileFontSize: (id: string, fontSize: PostItFontSize) => void
  setTileTextColor: (id: string, textColor: PostItColor | undefined) => void
  setWidgetRefreshSec: (id: string, refreshSec: number | undefined) => void
  moveTile: (id: string, x: number, y: number) => void
  resizeTile: (id: string, w: number, h: number) => void
  toggleTileLock: (id: string) => void
  duplicateTile: (id: string) => void
  focusTile: (id: string | null) => void
  removeTile: (id: string) => void
}

export function useCanvasTilesBlock(initial: CanvasTile[] = []): UseCanvasTilesResult {
  const [tiles, setTiles] = useState<CanvasTile[]>(initial)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const setAllTiles = useCallback((next: CanvasTile[]) => {
    setTiles(next)
  }, [])

  const spawnPostIt = useCallback((worldX: number, worldY: number) => {
    const id = nextTileId()
    const tile: CanvasPostItTile = {
      id,
      type: 'post-it',
      x: Math.round(worldX - DEFAULT_TILE_W / 2),
      y: Math.round(worldY - DEFAULT_TILE_H / 2),
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
      text: '',
      color: DEFAULT_POST_IT_COLOR,
      locked: false, // newly spawned tiles are unlocked so you can place them; auto-lock on blur in orch
      createdAt: Date.now(),
    }
    setTiles(prev => [...prev, tile])
    setFocusedId(id)
    return id
  }, [])

  const spawnNote = useCallback((filePath: string, worldX: number, worldY: number) => {
    const id = nextTileId()
    const tile: CanvasNoteTile = {
      id,
      type: 'note',
      x: Math.round(worldX - DEFAULT_TILE_W / 2),
      y: Math.round(worldY - DEFAULT_TILE_H / 2),
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
      filePath,
      locked: true,
      createdAt: Date.now(),
    }
    setTiles(prev => [...prev, tile])
    setFocusedId(id)
    return id
  }, [])

  const spawnWebWidget = useCallback(
    (
      spec: { siteId: string; region: { x: number; y: number; w: number; h: number }; pageWidth: number },
      worldX: number,
      worldY: number,
    ) => {
      const id = nextTileId()
      // tile defaults to the size of the captured region, floored at the minimum
      const w = Math.max(MIN_TILE_W, spec.region.w)
      const h = Math.max(MIN_TILE_H, spec.region.h)
      const tile: CanvasWebWidgetTile = {
        id,
        type: 'web-widget',
        x: Math.round(worldX - w / 2),
        y: Math.round(worldY - h / 2),
        w,
        h,
        locked: true,
        siteId: spec.siteId,
        region: spec.region,
        pageWidth: spec.pageWidth,
        createdAt: Date.now(),
      }
      setTiles(prev => [...prev, tile])
      setFocusedId(id)
      return id
    },
    [],
  )

  const updateTileText = useCallback((id: string, text: string) => {
    setTiles(prev =>
      prev.map(t => (t.id === id && t.type === 'post-it' ? { ...t, text, updatedAt: Date.now() } : t)),
    )
  }, [])

  const updateTileColor = useCallback((id: string, color: PostItColor) => {
    setTiles(prev =>
      prev.map(t => (t.id === id && t.type === 'post-it' ? { ...t, color, updatedAt: Date.now() } : t)),
    )
  }, [])

  const updateTileFontSize = useCallback((id: string, fontSize: PostItFontSize) => {
    setTiles(prev =>
      prev.map(t => {
        if (t.id !== id) return t
        if (t.type === 'post-it' || t.type === 'note') return { ...t, fontSize, updatedAt: Date.now() }
        return t
      }),
    )
  }, [])

  const setTileTextColor = useCallback(
    (id: string, textColor: PostItColor | undefined) => {
      setTiles(prev =>
        prev.map(t =>
          t.id === id && t.type === 'post-it' ? { ...t, textColor, updatedAt: Date.now() } : t,
        ),
      )
    },
    [],
  )

  const setWidgetRefreshSec = useCallback(
    (id: string, refreshSec: number | undefined) => {
      setTiles(prev =>
        prev.map(t =>
          t.id === id && t.type === 'web-widget' ? { ...t, refreshSec, updatedAt: Date.now() } : t,
        ),
      )
    },
    [],
  )

  const moveTile = useCallback((id: string, x: number, y: number) => {
    setTiles(prev =>
      prev.map(t => (t.id === id ? { ...t, x: Math.round(x), y: Math.round(y), updatedAt: Date.now() } : t)),
    )
  }, [])

  const resizeTile = useCallback((id: string, w: number, h: number) => {
    const cw = Math.max(MIN_TILE_W, Math.round(w))
    const ch = Math.max(MIN_TILE_H, Math.round(h))
    setTiles(prev => prev.map(t => (t.id === id ? { ...t, w: cw, h: ch, updatedAt: Date.now() } : t)))
  }, [])

  const toggleTileLock = useCallback((id: string) => {
    setTiles(prev => prev.map(t => (t.id === id ? { ...t, locked: !t.locked } : t)))
  }, [])

  const duplicateTile = useCallback((id: string) => {
    setTiles(prev => {
      const src = prev.find(t => t.id === id)
      if (!src) return prev
      const newId = nextTileId()
      const now = Date.now()
      const dup: CanvasTile = { ...src, id: newId, x: src.x + 24, y: src.y + 24, locked: false, createdAt: now, updatedAt: now }
      return [...prev, dup]
    })
  }, [])

  const focusTile = useCallback((id: string | null) => {
    setFocusedId(id)
  }, [])

  const removeTile = useCallback((id: string) => {
    setTiles(prev => prev.filter(t => t.id !== id))
    setFocusedId(prev => (prev === id ? null : prev))
  }, [])

  return {
    tiles,
    focusedId,
    setAllTiles,
    spawnPostIt,
    spawnNote,
    spawnWebWidget,
    updateTileText,
    updateTileColor,
    updateTileFontSize,
    setTileTextColor,
    setWidgetRefreshSec,
    moveTile,
    resizeTile,
    toggleTileLock,
    duplicateTile,
    focusTile,
    removeTile,
  }
}
