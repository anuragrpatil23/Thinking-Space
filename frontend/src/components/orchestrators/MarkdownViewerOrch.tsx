import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { STORAGE_KEYS } from '@/services/orchestrators/storageOrch'
import { useResizableSheetBlock } from '@/components/lego_blocks/hooks/useResizableSheetBlock'
import SheetResizeHandleBlock from '@/components/lego_blocks/units/SheetResizeHandleBlock'
import MarkdownDocumentBlock, {
  type MarkdownViewerMode,
} from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'

type MarkdownSavedCallback = (result: { output_path: string; revision_path: string | null }) => void

interface OpenMarkdownOptions {
  mode?: MarkdownViewerMode
  onSaved?: MarkdownSavedCallback
  /** Open the sheet for writing: New Note's editor surface (focus typography,
   *  phone keyboard inset) instead of the plain editor. */
  writing?: boolean
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

// The sheet is resizable like every slide-over (useResizableSheetBlock); it
// keeps the width key it has always had.
const SIDE_SHEET_DEFAULT_WIDTH_BLOCK = 896
const SIDE_SHEET_MIN_WIDTH_BLOCK = 420
const SIDE_SHEET_WRITING_FRACTION_BLOCK = 0.7

function MarkdownSideSheet({
  path,
  initialMode,
  writing = false,
  onSaved,
  onOpenPath,
  onOpenPathForEdit,
  onClose,
}: {
  path: string
  initialMode: MarkdownViewerMode
  writing?: boolean
  onSaved?: MarkdownSavedCallback
  onOpenPath: (path: string) => void
  onOpenPathForEdit: (path: string) => void
  onClose: () => void
}) {
  // A writing sheet keeps its own width, and opens wide: about 70% of the window.
  const { width, resizing, handle } = useResizableSheetBlock(
    writing ? 'markdown-writing' : 'markdown',
    writing ? Math.round(window.innerWidth * SIDE_SHEET_WRITING_FRACTION_BLOCK) : SIDE_SHEET_DEFAULT_WIDTH_BLOCK,
    writing ? { minWidth: SIDE_SHEET_MIN_WIDTH_BLOCK } : { storageKey: STORAGE_KEYS.markdownSideSheetWidth, minWidth: SIDE_SHEET_MIN_WIDTH_BLOCK },
  )

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className={cn('fixed inset-y-0 right-0 z-50 w-full border-l border-border shadow-2xl animate-slide-in', resizing && 'select-none')}
        data-ltm-sheet="" style={{ maxWidth: width }}
      >
        <SheetResizeHandleBlock {...handle} />
        <MarkdownDocumentBlock
          key={path}
          path={path}
          countsAsReading
          initialMode={initialMode}
          typographyProfile={writing ? 'focus' : undefined}
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
  const [writing, setWriting] = useState(false)

  const openFile = useCallback((path: string, options?: OpenMarkdownOptions) => {
    setCurrentPath(path)
    setCurrentMode(options?.mode ?? 'view')
    setOnSaved(() => options?.onSaved)
    setWriting(Boolean(options?.writing))
  }, [])

  const openFileForEdit = useCallback((path: string, options?: Omit<OpenMarkdownOptions, 'mode'>) => {
    setCurrentPath(path)
    setCurrentMode('edit')
    setOnSaved(() => options?.onSaved)
    setWriting(Boolean(options?.writing))
  }, [])

  const closeFile = useCallback(() => {
    setCurrentPath(null)
    setCurrentMode('view')
    setOnSaved(undefined)
    setWriting(false)
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
          // Writing and reading sheets size themselves differently: remount on a switch.
          key={writing ? 'writing' : 'reading'}
          path={currentPath}
          initialMode={currentMode}
          writing={writing}
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
