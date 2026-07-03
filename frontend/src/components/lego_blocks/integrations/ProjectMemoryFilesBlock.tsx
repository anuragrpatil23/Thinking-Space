import { useMemo, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import FileSelectionViewerBlock, { type FileSelectionOptionBlock } from '@/components/lego_blocks/integrations/FileSelectionViewerBlock'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { cn } from '@/lib/utils'

export type ProjectMemoryFileOptionBlock = FileSelectionOptionBlock

interface ProjectMemoryFilesBlockProps {
  markdownOptions: ProjectMemoryFileOptionBlock[]
  pinnedNotesPaths: (string | null)[]
  onSetPinnedNotePath: (index: number, path: string | null) => void
  onAddPinnedNote: () => void
  onRemovePinnedNote: (index: number) => void
  onOpenFile: (path: string) => void
  disabled?: boolean
  className?: string
  viewerHeightClassName?: string
}

function normalizeRelativePathBlock(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function labelFromPathBlock(path: string): string {
  const normalized = normalizeRelativePathBlock(path)
  if (!normalized) return ''
  const fileName = normalized.split('/').pop() ?? normalized
  return fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -3) : fileName
}

export default function ProjectMemoryFilesBlock({
  markdownOptions,
  pinnedNotesPaths,
  onSetPinnedNotePath,
  onAddPinnedNote,
  onRemovePinnedNote,
  onOpenFile,
  disabled = false,
  className,
  viewerHeightClassName = 'h-[700px]',
}: ProjectMemoryFilesBlockProps) {
  // Per-panel UI state stored in refs (picker open, query, viewer nonce, controls hidden)
  const pickerOpenRef = useRef<boolean[]>([])
  const queryRef = useRef<string[]>([])
  const viewerNonceRef = useRef<number[]>([])
  const controlsHiddenRef = useRef<boolean[]>([])

  const optionByPath = useMemo(
    () => new Map(markdownOptions.map(option => [normalizeRelativePathBlock(option.path), option] as const)),
    [markdownOptions],
  )

  // Ensure at least one panel slot
  const panels = pinnedNotesPaths.length > 0 ? pinnedNotesPaths : [null]

  return (
    <div className={cn('p-0', className)}>
      <div className="grid gap-4">
        {panels.map((rawPath, index) => {
          const selectedPath = normalizeRelativePathBlock(rawPath ?? '') || null
          const selectedLabel = selectedPath
            ? (optionByPath.get(selectedPath)?.label ?? labelFromPathBlock(selectedPath))
            : ''

          return (
            <div key={index} className="relative">
              {panels.length > 1 && (
                <button
                  type="button"
                  aria-label="Remove pinned notes panel"
                  className="absolute right-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
                  onClick={() => onRemovePinnedNote(index)}
                  disabled={disabled}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <FileSelectionViewerBlock
                className="rounded-xl border border-border/80 bg-muted/25 p-3"
                heading="Pinned Notes"
                summary="Pin a markdown file to keep it always accessible for this project."
                selectedPath={selectedPath}
                selectedLabel={selectedLabel}
                emptySelectionMessage="No file selected."
                options={markdownOptions}
                query={queryRef.current[index] ?? ''}
                onQueryChange={(q) => { queryRef.current[index] = q }}
                pickerOpen={pickerOpenRef.current[index] ?? false}
                onPickerOpenChange={(open) => { pickerOpenRef.current[index] = open }}
                controlsHidden={controlsHiddenRef.current[index] ?? false}
                onControlsHiddenChange={(hidden) => { controlsHiddenRef.current[index] = hidden }}
                onSelectPath={(path) => {
                  const normalized = normalizeRelativePathBlock(path ?? '') || null
                  onSetPinnedNotePath(index, normalized)
                  viewerNonceRef.current[index] = (viewerNonceRef.current[index] ?? 0) + 1
                }}
                onOpenPath={onOpenFile}
                disabled={disabled}
                searchPlaceholder="Search pinned notes file"
                searchEmptyMessage="No markdown files found"
                allowCustomValue
                emptyViewerMessage="Select a file to render it here."
                renderSelectedContent={() => (
                  <div className={cn('overflow-hidden rounded-lg border', viewerHeightClassName)}>
                    <MarkdownDocumentBlock
                      key={`pinned-notes::${index}::${selectedPath}::${viewerNonceRef.current[index] ?? 0}`}
                      path={selectedPath ?? ''}
                      initialMode="view"
                      onOpenPath={(path) => onOpenFile(path)}
                      onOpenPathForEdit={(path) => onOpenFile(path)}
                      className="h-full"
                    />
                  </div>
                )}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={onAddPinnedNote}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Panel
        </Button>
      </div>
    </div>
  )
}
