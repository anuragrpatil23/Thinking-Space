import { memo, useEffect, useRef, useState } from 'react'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'
import type { NotebookEntry } from '@/components/lego_blocks/hooks/shared/useNotebookEntriesBlock'

const PLACEHOLDER_HEIGHT = 96

interface NotebookPageBlockProps {
  entry: NotebookEntry
  pageNumber: number
  onOpenFile: (path: string) => void
  topBarHidden?: boolean
  /** If true, force-mount content regardless of visibility (used for windowed rendering) */
  forceMount?: boolean
}

// ---------------------------------------------------------------------------
// Bidirectional lazy visibility — mounts when near viewport, unmounts when far
// ---------------------------------------------------------------------------
function useWindowedVisible(
  forceMount: boolean,
  mountMargin = '800px',
  unmountMargin = '2000px',
): [React.RefCallback<HTMLDivElement>, boolean] {
  const [visible, setVisible] = useState(forceMount)
  const elRef = useRef<HTMLDivElement | null>(null)
  const mountObserverRef = useRef<IntersectionObserver | null>(null)
  const unmountObserverRef = useRef<IntersectionObserver | null>(null)

  // Sync forceMount
  useEffect(() => {
    if (forceMount) setVisible(true)
  }, [forceMount])

  const refCallback = useRef<React.RefCallback<HTMLDivElement>>((el: HTMLDivElement | null) => {
    // Cleanup previous
    mountObserverRef.current?.disconnect()
    unmountObserverRef.current?.disconnect()
    elRef.current = el
    if (!el) return

    // Mount observer — smaller margin, triggers mount
    const mountObs = new IntersectionObserver(
      ([ioEntry]) => {
        if (ioEntry.isIntersecting) setVisible(true)
      },
      { rootMargin: mountMargin },
    )
    mountObs.observe(el)
    mountObserverRef.current = mountObs

    // Unmount observer — larger margin, triggers unmount when completely outside
    const unmountObs = new IntersectionObserver(
      ([ioEntry]) => {
        if (!ioEntry.isIntersecting) setVisible(false)
      },
      { rootMargin: unmountMargin },
    )
    unmountObs.observe(el)
    unmountObserverRef.current = unmountObs
  })

  return [refCallback.current, visible]
}

function PagePlaceholder({ pageNumber, name }: { pageNumber: number; name: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-border/20 bg-muted/10 text-sm text-muted-foreground"
      style={{ height: PLACEHOLDER_HEIGHT }}
    >
      <span className="opacity-50">Page {pageNumber} — {name}</span>
    </div>
  )
}

function NotebookPageBlock({
  entry,
  pageNumber,
  onOpenFile,
  topBarHidden = false,
  forceMount = false,
}: NotebookPageBlockProps) {
  const [lazyRef, visible] = useWindowedVisible(forceMount)

  return (
    <div className="notebook-page group" ref={lazyRef}>
      {topBarHidden && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground/70">
            {pageNumber}
          </span>
          <span className="truncate text-xs font-medium text-muted-foreground">
            {entry.name}
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-border/40 bg-white shadow-sm dark:bg-zinc-50">
        {visible ? (
          <MarkdownDocumentBlock
            path={entry.path}
            initialMode="view"
            onOpenPath={onOpenFile}
            topBarHidden={topBarHidden}
          />
        ) : (
          <PagePlaceholder pageNumber={pageNumber} name={entry.name} />
        )}
      </div>
    </div>
  )
}

export default memo(NotebookPageBlock)
