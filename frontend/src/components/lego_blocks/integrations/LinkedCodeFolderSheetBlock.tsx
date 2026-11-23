import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useResizableSheetBlock } from '@/components/lego_blocks/hooks/useResizableSheetBlock'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'
import ReadOnlyFileTreeBlock from '@/components/lego_blocks/units/ReadOnlyFileTreeBlock'
import SheetResizeHandleBlock from '@/components/lego_blocks/units/SheetResizeHandleBlock'
import { linkedDocumentPathBlock } from '@/services/lego_blocks/units/linkedDocumentPathBlock'
import { fileSizeWordBlock, folderFileRankBlock, sortFolderFilesBlock } from '@/services/lego_blocks/units/linkedFolderFilesBlock'
import { describeLinkedCodePathOrch } from '@/services/orchestrators/linkedFoldersOrch'

// A side sheet on a linked code folder for any page: the Explorer's tree beside
// the app's document reader. Read only. It starts at the path it is given and
// can't go above it.

const SHEET_DEFAULT_WIDTH_BLOCK = 1040
const SHEET_MIN_WIDTH_BLOCK = 560

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export default function LinkedCodeFolderSheetBlock({ folderId, name, start, initialFile, onClose }: {
  folderId: string
  name: string
  start: string
  initialFile?: string | null
  onClose: () => void
}) {
  const { width, resizing, handle } = useResizableSheetBlock('linked-code-folder', SHEET_DEFAULT_WIDTH_BLOCK, { minWidth: SHEET_MIN_WIDTH_BLOCK })
  const [top, setTop] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(initialFile ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    describeLinkedCodePathOrch(folderId, start).then((entry) => {
      if (!live) return
      if (entry.type === 'file') {
        setTop(parentOf(start))
        setFile(start)
        return
      }
      setTop(start)
      // Open on what explains the folder, so the sheet is never blank.
      const lead = sortFolderFilesBlock(entry.files)[0]
      if (lead && folderFileRankBlock(lead.name) <= 1) setFile(current => current ?? (start ? `${start}/${lead.name}` : lead.name))
    }).catch((err: Error) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [folderId, start])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const load = useCallback(async (path: string) => {
    const entry = await describeLinkedCodePathOrch(folderId, path)
    if (entry.type !== 'folder') throw new Error('That is not a folder.')
    return { folders: entry.folders, files: sortFolderFilesBlock(entry.files) }
  }, [folderId])

  // Stops at the sheet: through the portal, React would otherwise pass these to a canvas behind it.
  return createPortal(
    <div onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
      <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label={`${name} files`} data-ltm-sheet="" style={{ maxWidth: width }} className={cn('fixed inset-y-0 right-0 z-50 flex w-full animate-slide-in border-l border-border bg-background shadow-2xl', resizing && 'select-none')}>
        <SheetResizeHandleBlock {...handle} />
        <nav aria-label="Files" className="flex w-[280px] shrink-0 flex-col border-r border-border/60">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 px-3">
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={`${name}/${start}`}>{name}</p>
            <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {error
              ? <p className="p-2 text-[13px] text-muted-foreground">{error}</p>
              : top !== null && <ReadOnlyFileTreeBlock root={top} load={load} selected={file} onSelect={setFile} formatSize={fileSizeWordBlock} />}
          </div>
        </nav>
        <section className="min-w-0 flex-1">
          {file
            ? <MarkdownDocumentBlock key={file} path={linkedDocumentPathBlock(folderId, file, 'code')} initialMode="view" className="h-full" />
            : <p className="p-5 text-[13px] text-muted-foreground">Choose a file to read it.</p>}
        </section>
      </div>
    </div>,
    document.body,
  )
}
