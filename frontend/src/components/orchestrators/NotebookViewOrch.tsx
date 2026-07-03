import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  useNotebookEntriesBlock,
  flattenNotebookEntries,
  countNotebookPages,
  type NotebookEntry,
} from '@/components/lego_blocks/hooks/shared/useNotebookEntriesBlock'
import NotebookPageBlock from '@/components/lego_blocks/integrations/NotebookPageBlock'
import NotebookTocBlock, { type NotebookTocViewMode } from '@/components/lego_blocks/integrations/NotebookTocBlock'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'
import { writeSortOrdersBlock } from '@/services/lego_blocks/units/notebookOrderBlock'
import { writeNotebookSidecarBlock } from '@/services/lego_blocks/units/notebookSidecarBlock'

const TOC_MIN_WIDTH = 160
const TOC_MAX_WIDTH = 480
const TOC_DEFAULT_WIDTH = 224

interface NotebookViewOrchProps {
  folderPath: string
  onOpenFile: (path: string) => void
  onClose: () => void
  className?: string
  topBarHidden?: boolean
}

export default function NotebookViewOrch({
  folderPath,
  onOpenFile,
  onClose,
  className,
  topBarHidden = false,
}: NotebookViewOrchProps) {
  const { entries, loading, error, reload } = useNotebookEntriesBlock(folderPath)
  const [activePagePath, setActivePagePath] = useState<string | null>(null)
  const [selectedPagePath, setSelectedPagePath] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(true)
  const [tocViewMode, setTocViewMode] = useState<NotebookTocViewMode>('list')
  const [tocWidth, setTocWidth] = useState(TOC_DEFAULT_WIDTH)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const pageRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())

  // Resizable divider state
  const isDraggingDivider = useRef(false)
  const dividerStartX = useRef(0)
  const dividerStartWidth = useRef(0)

  const flatEntries = flattenNotebookEntries(entries)
  const fileEntries = flatEntries.filter((e) => e.kind === 'file')
  const totalPages = countNotebookPages(entries)
  const folderName = folderPath.includes('/') ? folderPath.slice(folderPath.lastIndexOf('/') + 1) : folderPath

  const showSinglePage = tocViewMode === 'grid' || selectedPagePath !== null
  const displayPath = selectedPagePath ?? activePagePath ?? fileEntries[0]?.path ?? null

  // Compute a window of pages to force-mount around the active page (for instant TOC click)
  const WINDOW_SIZE = 5
  const forceMountPaths = useMemo(() => {
    const set = new Set<string>()
    if (!activePagePath) return set
    const idx = fileEntries.findIndex((e) => e.path === activePagePath)
    if (idx === -1) return set
    const start = Math.max(0, idx - WINDOW_SIZE)
    const end = Math.min(fileEntries.length, idx + WINDOW_SIZE + 1)
    for (let i = start; i < end; i++) set.add(fileEntries[i].path)
    return set
  }, [activePagePath, fileEntries])

  // Track which page is visible via IntersectionObserver (scroll-all mode)
  useEffect(() => {
    if (showSinglePage) return
    const scrollArea = scrollAreaRef.current
    if (!scrollArea || fileEntries.length === 0) return

    const observer = new IntersectionObserver(
      (ioEntries) => {
        let topPath: string | null = null
        let topY = Infinity
        for (const ioEntry of ioEntries) {
          if (!ioEntry.isIntersecting) continue
          const path = ioEntry.target.getAttribute('data-notebook-path')
          if (!path) continue
          const y = ioEntry.boundingClientRect.top
          if (y < topY) {
            topY = y
            topPath = path
          }
        }
        if (topPath) setActivePagePath(topPath)
      },
      { root: scrollArea, threshold: 0.05 },
    )

    for (const [, el] of pageRefsMap.current) observer.observe(el)
    return () => observer.disconnect()
  }, [fileEntries.length, entries, showSinglePage])

  const scrollToPage = useCallback((path: string) => {
    const el = pageRefsMap.current.get(path)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleSelectPage = useCallback((path: string) => {
    if (tocViewMode === 'grid') {
      setSelectedPagePath(path)
      setActivePagePath(path)
    } else {
      // List mode: scroll to page in scroll-all view
      if (selectedPagePath === null) {
        // Set active so windowed rendering mounts pages around target
        setActivePagePath(path)
        // Scroll after a tick to let the window re-render around the target
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = pageRefsMap.current.get(path)
            if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
          }, 50)
        })
      } else {
        setSelectedPagePath(path)
        setActivePagePath(path)
      }
    }
  }, [tocViewMode, selectedPagePath])

  const handleViewModeChange = useCallback((mode: NotebookTocViewMode) => {
    setTocViewMode(mode)
    if (mode === 'grid' && !selectedPagePath && fileEntries.length > 0) {
      const initial = activePagePath ?? fileEntries[0]?.path
      if (initial) {
        setSelectedPagePath(initial)
        setActivePagePath(initial)
      }
    }
    if (mode === 'list') {
      setSelectedPagePath(null)
    }
  }, [activePagePath, fileEntries, selectedPagePath])

  const handleReorderFiles = useCallback(async (_folderPath: string, orderedPaths: string[]) => {
    try {
      await writeSortOrdersBlock(orderedPaths)
      await writeNotebookSidecarBlock(_folderPath, orderedPaths)
      await reload()
    } catch (err) {
      console.error('Failed to persist reorder:', err)
    }
  }, [reload])

  // Keyboard navigation
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea || fileEntries.length === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return
      e.preventDefault()

      const currentPath = displayPath
      const currentIdx = currentPath
        ? fileEntries.findIndex((f) => f.path === currentPath)
        : -1

      let nextIdx: number
      if (e.key === 'PageDown') {
        nextIdx = currentIdx < fileEntries.length - 1 ? currentIdx + 1 : currentIdx
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : 0
      }

      const nextPath = fileEntries[nextIdx]?.path
      if (nextPath) {
        if (showSinglePage) {
          setSelectedPagePath(nextPath)
          setActivePagePath(nextPath)
        } else {
          const el = pageRefsMap.current.get(nextPath)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    }

    scrollArea.addEventListener('keydown', handleKeyDown)
    return () => scrollArea.removeEventListener('keydown', handleKeyDown)
  }, [displayPath, fileEntries, showSinglePage])

  // Resizable divider handlers
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingDivider.current = true
    dividerStartX.current = e.clientX
    dividerStartWidth.current = tocWidth

    function onMouseMove(ev: MouseEvent) {
      if (!isDraggingDivider.current) return
      const delta = ev.clientX - dividerStartX.current
      const next = Math.max(TOC_MIN_WIDTH, Math.min(TOC_MAX_WIDTH, dividerStartWidth.current + delta))
      setTocWidth(next)
    }

    function onMouseUp() {
      isDraggingDivider.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [tocWidth])

  const bindPageRef = useCallback((path: string) => (el: HTMLDivElement | null) => {
    if (el) pageRefsMap.current.set(path, el)
    else pageRefsMap.current.delete(path)
  }, [])

  function renderEntries(items: NotebookEntry[], pageCounter: { value: number }) {
    return items.map((entry) => {
      if (entry.kind === 'folder') {
        const isCollapsed = collapsedFolders.has(entry.path)
        const childFileCount = entry.children ? countNotebookPages(entry.children) : 0
        return (
          <div key={entry.path} className="mt-8 first:mt-0">
            <button
              type="button"
              className="mb-4 flex w-full items-center gap-2 border-b border-border/40 pb-2 text-left"
              onClick={() => setCollapsedFolders((prev) => {
                const next = new Set(prev)
                if (next.has(entry.path)) next.delete(entry.path)
                else next.add(entry.path)
                return next
              })}
            >
              {isCollapsed
                ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              }
              <span className="text-sm font-semibold text-foreground">{entry.name}</span>
              <span className="text-xs text-muted-foreground">
                {childFileCount} {childFileCount === 1 ? 'page' : 'pages'}
              </span>
            </button>
            {!isCollapsed && entry.children && entry.children.length > 0 && (
              <div className="space-y-6 pl-0">
                {renderEntries(entry.children, pageCounter)}
              </div>
            )}
          </div>
        )
      }

      pageCounter.value += 1
      return (
        <div
          key={entry.path}
          ref={bindPageRef(entry.path)}
          data-notebook-path={entry.path}
          className="scroll-mt-4"
        >
          <NotebookPageBlock
            entry={entry}
            pageNumber={pageCounter.value}
            onOpenFile={onOpenFile}
            topBarHidden={topBarHidden}
            forceMount={forceMountPaths.has(entry.path)}
          />
        </div>
      )
    })
  }

  const handleDocumentOpenPath = useCallback((path: string) => {
    if (path.startsWith(folderPath)) {
      setSelectedPagePath(path)
      setActivePagePath(path)
    } else {
      onOpenFile(path)
    }
  }, [folderPath, onOpenFile])

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h2 className="min-w-0 truncate text-sm font-semibold">{folderName}</h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {totalPages} {totalPages === 1 ? 'page' : 'pages'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={tocOpen ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setTocOpen((prev) => !prev)}
          >
            Pages
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            title="Close notebook view"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* TOC sidebar */}
        {tocOpen && (
          <>
            <div
              className="shrink-0 bg-muted/20"
              style={{ width: tocWidth }}
            >
              <NotebookTocBlock
                entries={entries}
                activeEntryPath={showSinglePage ? displayPath : activePagePath}
                activePagePath={showSinglePage ? displayPath : activePagePath}
                onScrollToPage={scrollToPage}
                onSelectPage={handleSelectPage}
                onOpenFile={onOpenFile}
                onReorderFiles={handleReorderFiles}
                viewMode={tocViewMode}
                onViewModeChange={handleViewModeChange}
                totalPages={totalPages}
              />
            </div>

            {/* Resizable divider */}
            <div
              className="group relative w-1 shrink-0 cursor-col-resize bg-border/50 transition-colors hover:bg-primary/40 active:bg-primary/60"
              onMouseDown={handleDividerMouseDown}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          </>
        )}

        {/* Main content area */}
        <div
          ref={scrollAreaRef}
          className="min-h-0 flex-1 overflow-auto outline-none"
          tabIndex={0}
        >
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading notebook...
            </div>
          )}

          {!loading && error && (
            <div className="m-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && fileEntries.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
              <BookOpen className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">This folder is empty.</p>
            </div>
          )}

          {/* Single-page mode */}
          {!loading && !error && showSinglePage && displayPath && (
            <MarkdownDocumentBlock
              key={displayPath}
              path={displayPath}
              initialMode="view"
              onOpenPath={handleDocumentOpenPath}
              className="h-full min-h-0"
              topBarHidden={topBarHidden}
            />
          )}

          {/* Scroll-all mode */}
          {!loading && !error && !showSinglePage && entries.length > 0 && (
            <div className="mx-auto max-w-3xl space-y-6 p-6">
              {renderEntries(entries, { value: 0 })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
