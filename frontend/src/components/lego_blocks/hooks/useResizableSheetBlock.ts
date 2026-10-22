import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem, type StorageKey } from '@/services/orchestrators/storageOrch'

// Every slide-over's width is the reader's to choose: drag its left edge, or
// double-click the edge to swap between the default and nearly full screen.
// Each sheet remembers its own width; it never grows past the window.

const SHEET_MIN_WIDTH_BLOCK = 360
const SHEET_WIDE_FRACTION_BLOCK = 0.92

export function clampSheetWidthBlock(width: number, minWidth = SHEET_MIN_WIDTH_BLOCK): number {
  const max = Math.max(minWidth, window.innerWidth - 48)
  return Math.round(Math.min(max, Math.max(minWidth, width)))
}

export interface ResizableSheetBlock {
  /** The sheet's width in px; use as `maxWidth` on a `w-full` panel so phones stay full width. */
  width: number
  resizing: boolean
  /** Spread onto <SheetResizeHandleBlock />. */
  handle: {
    width: number
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onDoubleClick: () => void
    resizing: boolean
  }
}

export function useResizableSheetBlock(
  sheetId: string,
  defaultWidth: number,
  options: { storageKey?: StorageKey; minWidth?: number } = {},
): ResizableSheetBlock {
  // A per-sheet key under the registered prefix (the registry can't list every sheet id).
  const storageKey = options.storageKey ?? (`${STORAGE_KEYS.sheetWidthPrefix}${sheetId}` as StorageKey)
  const minWidth = options.minWidth ?? SHEET_MIN_WIDTH_BLOCK
  const [width, setWidth] = useState(() => {
    const stored = getJsonStorageItem<number>(storageKey, defaultWidth)
    return clampSheetWidthBlock(typeof stored === 'number' && Number.isFinite(stored) ? stored : defaultWidth, minWidth)
  })
  const [resizing, setResizing] = useState(false)

  const commitWidth = useCallback((next: number) => {
    const clamped = clampSheetWidthBlock(next, minWidth)
    setWidth(clamped)
    setJsonStorageItem(storageKey, clamped)
  }, [minWidth, storageKey])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    setResizing(true)
    const onMove = (move: PointerEvent) => setWidth(clampSheetWidthBlock(window.innerWidth - move.clientX, minWidth))
    const onUp = (up: PointerEvent) => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      setResizing(false)
      commitWidth(window.innerWidth - up.clientX)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }, [commitWidth, minWidth])

  const onDoubleClick = useCallback(() => {
    const wide = clampSheetWidthBlock(window.innerWidth * SHEET_WIDE_FRACTION_BLOCK, minWidth)
    commitWidth(width >= wide - 8 ? defaultWidth : wide)
  }, [commitWidth, defaultWidth, minWidth, width])

  return { width, resizing, handle: { width, onPointerDown, onDoubleClick, resizing } }
}
