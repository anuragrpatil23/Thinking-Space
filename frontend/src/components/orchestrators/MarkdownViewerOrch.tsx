import { createContext, useCallback, useContext, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import MarkdownDocumentBlock, {
  type MarkdownViewerMode,
} from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'

type MarkdownSavedCallback = (result: { output_path: string; revision_path: string | null }) => void

interface OpenMarkdownOptions {
  mode?: MarkdownViewerMode
  onSaved?: MarkdownSavedCallback
}

interface MarkdownViewerCtx {
  openFile: (path: string, options?: OpenMarkdownOptions) => void
  openFileForEdit: (path: string, options?: Omit<OpenMarkdownOptions, 'mode'>) => void
  closeFile: () => void
  currentPath: string | null
  currentMode: MarkdownViewerMode
}

const Ctx = createContext<MarkdownViewerCtx>({
  openFile: () => {},
  openFileForEdit: () => {},
  closeFile: () => {},
  currentPath: null,
  currentMode: 'view',
})

export function useMarkdownViewer() {
  return useContext(Ctx)
}

// The sheet's width is the reader's to choose: drag its left edge, or
// double-click the edge to swap between the default and nearly full screen.
const SIDE_SHEET_DEFAULT_WIDTH_BLOCK = 896
const SIDE_SHEET_MIN_WIDTH_BLOCK = 420
const SIDE_SHEET_WIDE_FRACTION_BLOCK = 0.92

function clampSheetWidthBlock(width: number): number {
  const max = Math.max(SIDE_SHEET_MIN_WIDTH_BLOCK, window.innerWidth - 48)
  return Math.round(Math.min(max, Math.max(SIDE_SHEET_MIN_WIDTH_BLOCK, width)))
}

function MarkdownSideSheet({
  path,
  initialMode,
  onSaved,
  onOpenPath,
  onOpenPathForEdit,
  onClose,
}: {
  path: string
  initialMode: MarkdownViewerMode
  onSaved?: MarkdownSavedCallback
  onOpenPath: (path: string) => void
  onOpenPathForEdit: (path: string) => void
  onClose: () => void
}) {
  const [width, setWidth] = useState(() => {
    const stored = getJsonStorageItem<number>(STORAGE_KEYS.markdownSideSheetWidth, SIDE_SHEET_DEFAULT_WIDTH_BLOCK)
    return clampSheetWidthBlock(typeof stored === 'number' && Number.isFinite(stored) ? stored : SIDE_SHEET_DEFAULT_WIDTH_BLOCK)
  })
  const [resizing, setResizing] = useState(false)

  const commitWidth = useCallback((next: number) => {
    const clamped = clampSheetWidthBlock(next)
    setWidth(clamped)
    setJsonStorageItem(STORAGE_KEYS.markdownSideSheetWidth, clamped)
  }, [])

  const onResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setResizing(true)
    const onMove = (move: PointerEvent) => setWidth(clampSheetWidthBlock(window.innerWidth - move.clientX))
    const onUp = (up: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setResizing(false)
      commitWidth(window.innerWidth - up.clientX)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }, [commitWidth])

  const toggleWide = useCallback(() => {
    const wide = clampSheetWidthBlock(window.innerWidth * SIDE_SHEET_WIDE_FRACTION_BLOCK)
    commitWidth(width >= wide - 8 ? SIDE_SHEET_DEFAULT_WIDTH_BLOCK : wide)
  }, [commitWidth, width])

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className={cn('fixed inset-y-0 right-0 z-50 w-full border-l border-border shadow-2xl animate-slide-in', resizing && 'select-none')}
        style={{ maxWidth: width }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel (double-click to widen)"
          title="Drag to resize · double-click to widen"
          onPointerDown={onResizeStart}
          onDoubleClick={toggleWide}
          className={cn(
            'absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize sm:block',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-sky-500/60',
            resizing && 'after:bg-sky-500/80',
          )}
        />
        <MarkdownDocumentBlock
          key={path}
          path={path}
          countsAsReading
          initialMode={initialMode}
          onSaved={onSaved}
          onOpenPath={onOpenPath}
          onOpenPathForEdit={onOpenPathForEdit}
          onClose={onClose}
          showCloseButton
          className="h-full"
        />
      </div>
    </>
  )
}

export function MarkdownViewerProvider({ children }: { children: ReactNode }) {
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [currentMode, setCurrentMode] = useState<MarkdownViewerMode>('view')
  const [onSaved, setOnSaved] = useState<MarkdownSavedCallback | undefined>(undefined)

  const openFile = useCallback((path: string, options?: OpenMarkdownOptions) => {
    setCurrentPath(path)
    setCurrentMode(options?.mode ?? 'view')
    setOnSaved(() => options?.onSaved)
  }, [])

  const openFileForEdit = useCallback((path: string, options?: Omit<OpenMarkdownOptions, 'mode'>) => {
    setCurrentPath(path)
    setCurrentMode('edit')
    setOnSaved(() => options?.onSaved)
  }, [])

  const closeFile = useCallback(() => {
    setCurrentPath(null)
    setCurrentMode('view')
    setOnSaved(undefined)
  }, [])

  useEffect(() => {
    if (!currentPath) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target
      if (target instanceof Element && target.closest('[data-prevent-sheet-escape="true"]')) return
      closeFile()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [closeFile, currentPath])

  useEffect(() => {
    if (!currentPath) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [currentPath])

  return (
    <Ctx.Provider value={{ openFile, openFileForEdit, closeFile, currentPath, currentMode }}>
      {children}
      {currentPath && (
        <MarkdownSideSheet
          path={currentPath}
          initialMode={currentMode}
          onSaved={onSaved}
          onOpenPath={openFile}
          onOpenPathForEdit={openFileForEdit}
          onClose={closeFile}
        />
      )}
    </Ctx.Provider>
  )
}

export type { MarkdownViewerMode }
