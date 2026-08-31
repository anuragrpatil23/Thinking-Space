import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
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
  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-4xl border-l border-border shadow-2xl animate-slide-in">
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
