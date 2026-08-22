import type { ParsedExcalidrawScene } from '@/services/lego_blocks/integrations/excalidrawFileBlock'

export interface ExcalidrawViewportStateBlock {
  scrollX: number
  scrollY: number
  zoom: number
}

export interface ExcalidrawCanvasApiBlock {
  getSceneElementsBlock(): readonly unknown[]
  getSceneElementsIncludingDeletedBlock(): readonly unknown[]
  getAppStateBlock(): Record<string, unknown>
  getFilesBlock(): Record<string, unknown>
  getViewportStateBlock(): ExcalidrawViewportStateBlock
  updateAppStateBlock(next: Record<string, unknown>): void
  /** Replace the scene's elements. Used by annotation recovery — see
   *  docs/contracts/DURABILITY.md. Returns false when the underlying editor
   *  does not expose `updateScene`, so a caller can say "could not restore"
   *  instead of silently doing nothing. */
  replaceSceneElementsBlock(elements: readonly unknown[]): boolean
  updateViewportBlock(next: Partial<ExcalidrawViewportStateBlock>): void
  fitViewportToContentBlock(elements: readonly unknown[]): void
  onViewportChangeBlock(listener: (viewport: ExcalidrawViewportStateBlock) => void): (() => void) | null
}

interface RawExcalidrawApi {
  getSceneElements?: () => readonly unknown[]
  getSceneElementsIncludingDeleted?: () => readonly unknown[]
  getAppState?: () => Record<string, unknown>
  getFiles?: () => Record<string, unknown>
  updateScene?: (scene: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => void
  scrollToContent?: (
    elements: readonly unknown[],
    options: {
      fitToViewport: boolean
      viewportZoomFactor: number
      animate: boolean
      minZoom: number
      maxZoom: number
    },
  ) => void
  onScrollChange?: (
    listener: (scrollX: number, scrollY: number, zoom: { value: number }) => void,
  ) => (() => void) | undefined
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readZoomValue(zoom: unknown): number {
  if (typeof zoom === 'number' && Number.isFinite(zoom)) return zoom
  if (zoom && typeof zoom === 'object') {
    const candidate = (zoom as { value?: unknown }).value
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return 1
}

function readViewportState(api: RawExcalidrawApi): ExcalidrawViewportStateBlock {
  const appState = api.getAppState?.() ?? {}
  return {
    scrollX: numberOr(appState.scrollX, 0),
    scrollY: numberOr(appState.scrollY, 0),
    zoom: readZoomValue(appState.zoom),
  }
}

function isCompatibleRawApi(value: unknown): value is RawExcalidrawApi {
  if (!value || typeof value !== 'object') return false
  const api = value as RawExcalidrawApi
  return typeof api.getSceneElements === 'function'
    && typeof api.getSceneElementsIncludingDeleted === 'function'
    && typeof api.getAppState === 'function'
    && typeof api.updateScene === 'function'
    && typeof api.scrollToContent === 'function'
}

export function createExcalidrawCanvasApiBlock(rawApi: unknown): ExcalidrawCanvasApiBlock | null {
  if (!isCompatibleRawApi(rawApi)) return null

  return {
    getSceneElementsBlock: () => rawApi.getSceneElements?.() ?? [],
    getSceneElementsIncludingDeletedBlock: () => rawApi.getSceneElementsIncludingDeleted?.() ?? [],
    getAppStateBlock: () => ({ ...(rawApi.getAppState?.() ?? {}) }),
    getFilesBlock: () => ({ ...(rawApi.getFiles?.() ?? {}) }),
    getViewportStateBlock: () => readViewportState(rawApi),
    replaceSceneElementsBlock: (elements) => {
      if (!rawApi.updateScene) return false
      rawApi.updateScene({ elements })
      return true
    },
    updateAppStateBlock: (next) => {
      const patch = Object.entries(next).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (value !== undefined) acc[key] = value
        return acc
      }, {})
      if (Object.keys(patch).length === 0) return
      const currentAppState = rawApi.getAppState?.() ?? {}
      const appState = {
        ...currentAppState,
        ...patch,
      }
      rawApi.updateScene?.({ appState })
    },
    updateViewportBlock: (next) => {
      const patch: Record<string, unknown> = {}
      if (typeof next.scrollX === 'number' && Number.isFinite(next.scrollX)) patch.scrollX = next.scrollX
      if (typeof next.scrollY === 'number' && Number.isFinite(next.scrollY)) patch.scrollY = next.scrollY
      if (typeof next.zoom === 'number' && Number.isFinite(next.zoom)) patch.zoom = { value: next.zoom }
      if (Object.keys(patch).length === 0) return
      const currentAppState = rawApi.getAppState?.() ?? {}
      const appState = {
        ...currentAppState,
        ...patch,
      }
      rawApi.updateScene?.({ appState })
    },
    fitViewportToContentBlock: (elements) => {
      rawApi.scrollToContent?.(elements, {
        fitToViewport: true,
        viewportZoomFactor: 0.9,
        animate: false,
        minZoom: 0.1,
        maxZoom: 4,
      })
    },
    onViewportChangeBlock: (listener) => {
      if (typeof rawApi.onScrollChange !== 'function') return null
      return rawApi.onScrollChange((scrollX, scrollY, zoom) => {
        listener({
          scrollX: numberOr(scrollX, 0),
          scrollY: numberOr(scrollY, 0),
          zoom: readZoomValue(zoom),
        })
      }) ?? null
    },
  }
}

export function buildExcalidrawInitialDataBlock(
  scene: ParsedExcalidrawScene,
  editable: boolean,
): ParsedExcalidrawScene {
  const baseAppState = (scene.appState ?? {}) as Record<string, unknown>
  return {
    elements: scene.elements,
    appState: {
      ...baseAppState,
      viewModeEnabled: !editable,
      ...(editable && {
        activeTool: { type: 'hand', customType: null, locked: false, fromSelection: false },
      }),
    },
    files: scene.files ?? {},
  }
}

export function cloneExcalidrawSceneChangeBlock(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
): ParsedExcalidrawScene {
  const sceneElements = Array.isArray(elements) ? elements as unknown[] : []
  return {
    // Avoid expensive deep/shallow cloning on every Excalidraw onChange tick.
    // Callers only need the latest scene snapshot reference for save serialization.
    elements: sceneElements,
    appState: appState ?? {},
    files: files ?? {},
  }
}
