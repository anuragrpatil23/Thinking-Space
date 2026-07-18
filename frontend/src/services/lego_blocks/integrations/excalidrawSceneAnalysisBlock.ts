import type { ParsedExcalidrawScene } from '@/services/lego_blocks/integrations/excalidrawFileBlock'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LARGE_SCENE_ELEMENT_THRESHOLD = 1200
export const MEDIAN_SORT_THRESHOLD = 2000
export const PERF_EVENTS_LIMIT = 400
export const MINIMAP_MAX_RECTS = 400
export const PARSED_SCENE_CACHE_MAX_ENTRIES = 4
const MINIMAP_HIDDEN_ELEMENT_TYPES = new Set(['line', 'arrow', 'freedraw'])

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SceneDrawableCenter {
  x: number
  y: number
  isAnchor: boolean
}

export interface SceneAnalysis {
  sceneBounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
    width: number
    height: number
    medianCenterX: number
    medianCenterY: number
    anchorCount: number
    medianAnchorCenterX: number
    medianAnchorCenterY: number
  } | null
  drawableCenters: SceneDrawableCenter[]
  durationMs: number
}

export interface MiniMapBounds {
  minX: number
  minY: number
  width: number
  height: number
}

export interface SceneElementRect {
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
  type: string
  strokeColor: string | null
  backgroundColor: string | null
}

/**
 * Uniform-scale (letterbox) projection of scene bounds into a fixed minimap
 * box, so tall/wide scenes keep their true aspect ratio instead of stretching.
 * world → box: x' = (wx - minX) * scale + offsetX
 */
export interface MiniMapProjection {
  scale: number
  offsetX: number
  offsetY: number
}

export function computeMiniMapProjection(
  bounds: MiniMapBounds,
  boxWidth: number,
  boxHeight: number,
): MiniMapProjection {
  const scale = Math.min(boxWidth / bounds.width, boxHeight / bounds.height)
  return {
    scale,
    offsetX: (boxWidth - bounds.width * scale) / 2,
    offsetY: (boxHeight - bounds.height * scale) / 2,
  }
}

export interface ExcalidrawPerfEvent {
  name: string
  durationMs: number
  elementCount: number
  ts: string
  meta?: Record<string, unknown>
}

export const EMPTY_SCENE_ANALYSIS: SceneAnalysis = {
  sceneBounds: null,
  drawableCenters: [],
  durationMs: 0,
}

// ---------------------------------------------------------------------------
// Scene element parsing
// ---------------------------------------------------------------------------

export function readSceneElementRect(item: unknown): SceneElementRect | null {
  if (!item || typeof item !== 'object') return null
  const element = item as Record<string, unknown>
  if (element.isDeleted === true) return null

  const x = Number(element.x)
  const y = Number(element.y)
  const widthRaw = Number(element.width)
  const heightRaw = Number(element.height)
  const type = typeof element.type === 'string' ? element.type : ''
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(widthRaw) || !Number.isFinite(heightRaw)) {
    return null
  }

  const x2 = x + widthRaw
  const y2 = y + heightRaw
  const left = Math.min(x, x2)
  const right = Math.max(x, x2)
  const top = Math.min(y, y2)
  const bottom = Math.max(y, y2)
  const width = Math.max(right - left, 1)
  const height = Math.max(bottom - top, 1)

  const strokeColorRaw = typeof element.strokeColor === 'string' ? element.strokeColor : null
  const backgroundColorRaw = typeof element.backgroundColor === 'string' ? element.backgroundColor : null
  const strokeColor = strokeColorRaw && strokeColorRaw !== 'transparent' ? strokeColorRaw : null
  const backgroundColor = backgroundColorRaw && backgroundColorRaw !== 'transparent' ? backgroundColorRaw : null

  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    type,
    strokeColor,
    backgroundColor,
  }
}

export function readMiniMapSceneElementRect(item: unknown): SceneElementRect | null {
  const rect = readSceneElementRect(item)
  if (!rect) return null
  if (MINIMAP_HIDDEN_ELEMENT_TYPES.has(rect.type)) return null
  return rect
}

// ---------------------------------------------------------------------------
// MiniMap bounds
// ---------------------------------------------------------------------------

export function computeMiniMapBounds(elements: readonly unknown[]): MiniMapBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let found = false

  for (const item of elements) {
    const rect = readMiniMapSceneElementRect(item)
    if (!rect) continue
    minX = Math.min(minX, rect.left)
    minY = Math.min(minY, rect.top)
    maxX = Math.max(maxX, rect.left + rect.width)
    maxY = Math.max(maxY, rect.top + rect.height)
    found = true
  }

  if (!found) return null
  return { minX, minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) }
}

// ---------------------------------------------------------------------------
// Performance event tracking
// ---------------------------------------------------------------------------

export function pushGlobalExcalidrawPerfEvent(event: ExcalidrawPerfEvent): void {
  const state = globalThis as {
    __ltmExcalidrawPerfEvents?: ExcalidrawPerfEvent[]
    __ltmExcalidrawPerfLast?: ExcalidrawPerfEvent
  }
  const events = Array.isArray(state.__ltmExcalidrawPerfEvents)
    ? state.__ltmExcalidrawPerfEvents
    : []
  events.push(event)
  if (events.length > PERF_EVENTS_LIMIT) events.shift()
  state.__ltmExcalidrawPerfEvents = events
  state.__ltmExcalidrawPerfLast = event
}

// ---------------------------------------------------------------------------
// Scene analysis
// ---------------------------------------------------------------------------

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function analyzeScene(parsedScene: ParsedExcalidrawScene | null): SceneAnalysis {
  const started = nowMs()
  if (!parsedScene || parsedScene.elements.length === 0) {
    return { sceneBounds: null, drawableCenters: [], durationMs: nowMs() - started }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let found = false
  let centerSumX = 0
  let centerSumY = 0
  let anchorCenterSumX = 0
  let anchorCenterSumY = 0
  let anchorCount = 0
  let centerCount = 0
  const centersX: number[] = []
  const centersY: number[] = []
  const anchorCentersX: number[] = []
  const anchorCentersY: number[] = []
  const drawableCenters: SceneDrawableCenter[] = []

  for (const item of parsedScene.elements) {
    const rect = readSceneElementRect(item)
    if (!rect) continue
    minX = Math.min(minX, rect.left)
    minY = Math.min(minY, rect.top)
    maxX = Math.max(maxX, rect.left + rect.width)
    maxY = Math.max(maxY, rect.top + rect.height)
    const cx = rect.centerX
    const cy = rect.centerY
    centerCount += 1
    centerSumX += cx
    centerSumY += cy
    drawableCenters.push({ x: cx, y: cy, isAnchor: rect.type !== 'freedraw' })
    if (centerCount <= MEDIAN_SORT_THRESHOLD) {
      centersX.push(cx)
      centersY.push(cy)
    }
    if (rect.type !== 'freedraw') {
      anchorCount += 1
      anchorCenterSumX += cx
      anchorCenterSumY += cy
      if (anchorCount <= MEDIAN_SORT_THRESHOLD) {
        anchorCentersX.push(cx)
        anchorCentersY.push(cy)
      }
    }
    found = true
  }

  if (!found || centerCount === 0) {
    return { sceneBounds: null, drawableCenters, durationMs: nowMs() - started }
  }

  const useAveragesForCenter = centerCount > MEDIAN_SORT_THRESHOLD
  let medianCenterX = minX + (maxX - minX) / 2
  let medianCenterY = minY + (maxY - minY) / 2
  let medianAnchorCenterX = medianCenterX
  let medianAnchorCenterY = medianCenterY

  if (useAveragesForCenter) {
    medianCenterX = centerSumX / centerCount
    medianCenterY = centerSumY / centerCount
    if (anchorCount > 0) {
      medianAnchorCenterX = anchorCenterSumX / anchorCount
      medianAnchorCenterY = anchorCenterSumY / anchorCount
    }
  } else {
    centersX.sort((a, b) => a - b)
    centersY.sort((a, b) => a - b)
    anchorCentersX.sort((a, b) => a - b)
    anchorCentersY.sort((a, b) => a - b)
    const mid = Math.floor(centersX.length / 2)
    medianCenterX = centersX[mid] ?? medianCenterX
    medianCenterY = centersY[mid] ?? medianCenterY
    const anchorMid = Math.floor(anchorCentersX.length / 2)
    medianAnchorCenterX = anchorCentersX[anchorMid] ?? medianCenterX
    medianAnchorCenterY = anchorCentersY[anchorMid] ?? medianCenterY
  }

  return {
    sceneBounds: {
      minX, minY, maxX, maxY,
      width: Math.max(maxX - minX, 1),
      height: Math.max(maxY - minY, 1),
      medianCenterX, medianCenterY,
      anchorCount, medianAnchorCenterX, medianAnchorCenterY,
    },
    drawableCenters,
    durationMs: nowMs() - started,
  }
}

// ---------------------------------------------------------------------------
// Parsed scene cache
// ---------------------------------------------------------------------------

const parsedSceneCache = new Map<string, ParsedExcalidrawScene | null>()

export function parseSceneWithCache(
  content: string,
  parseFn: (c: string) => ParsedExcalidrawScene | null,
): ParsedExcalidrawScene | null {
  const cached = parsedSceneCache.get(content)
  if (cached !== undefined) return cached

  const parsed = parseFn(content)
  parsedSceneCache.set(content, parsed)
  if (parsedSceneCache.size > PARSED_SCENE_CACHE_MAX_ENTRIES) {
    const oldestKey = parsedSceneCache.keys().next().value
    if (typeof oldestKey === 'string') {
      parsedSceneCache.delete(oldestKey)
    }
  }
  return parsed
}
