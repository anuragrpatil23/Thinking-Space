import { useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Folder, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import FolderTreePickerBlock from '@/components/lego_blocks/integrations/FolderTreePickerBlock'
import SegmentedToggleBlock from '@/components/lego_blocks/units/ui/SegmentedToggleBlock'
import { NOTE_KINDS_BLOCK, type NoteKindBlock } from '@/services/lego_blocks/units/noteComposerBlock'

// What this note is and where it lives — the breadcrumb, opened up and made
// editable (2026-10-29). It replaced a five-section form whose first row
// repeated the breadcrumb it hung from, whose File name field repeated it a
// third time, and whose folder picking was spread over four overlapping lists.
//
// Two views, pushed like an iOS settings pane: the note (Name / Folder / Type)
// and the folder picker. Rows are an inspector, label left and value right, so
// the panel reads as three facts rather than a form to fill in. New note is
// not here: it is an action, not a property, and lives in the title bar.

export interface NoteSettingsPanelBlockProps {
  isTodo: boolean
  /** File name, with or without `.md` — shown without it. */
  filename: string
  onFilenameChange: (value: string) => void
  todoDate: string
  onTodoDateChange: (value: string) => void
  todoItemCount: number
  noteKind: NoteKindBlock
  onNoteKindChange: (kind: NoteKindBlock) => void
  folder: string
  suggestedFolders: string[]
  onPickFolder: (path: string) => void
  loadingTarget: boolean
  /** Phone: finger-sized rows, and Folder opens the host's sheet instead of
   *  pushing the in-panel picker (a sheet already has the whole screen). */
  touch?: boolean
  onOpenFolderSheet?: () => void
}

function splitFolderBlock(path: string): { leaf: string; parent: string } {
  const at = path.lastIndexOf('/')
  return at < 0 ? { leaf: path, parent: '' } : { leaf: path.slice(at + 1), parent: path.slice(0, at) }
}

const SECTION_LABEL_CLASS = 'px-3 pb-1.5 pt-4 text-xs font-medium text-muted-foreground/70'

export function NoteSettingsPanelBlock(props: NoteSettingsPanelBlockProps) {
  const [view, setView] = useState<'note' | 'folder'>('note')
  // Which way the last change went, so returning slides from the left.
  const [entered, setEntered] = useState<'push' | 'pop' | null>(null)

  const openFolder = () => {
    if (props.onOpenFolderSheet) { props.onOpenFolderSheet(); return }
    setEntered('push')
    setView('folder')
  }
  const backToNote = () => {
    setEntered('pop')
    setView('note')
  }

  return view === 'folder'
    ? (
      <FolderPickerViewBlock
        key="folder"
        folder={props.folder}
        suggested={props.suggestedFolders}
        onBack={backToNote}
        onPick={(path) => {
          props.onPickFolder(path)
          backToNote()
        }}
      />
    )
    : (
      <div key="note" className={cn(props.touch ? 'px-3 py-3' : 'px-4 py-4', entered === 'pop' && 'ltm-panel-pop')}>
        <NoteViewBlock {...props} onOpenFolder={openFolder} />
      </div>
    )
}

function RowBlock({ label, touch, children }: { label: string; touch?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex items-center gap-4 rounded-lg px-3', touch ? 'min-h-14' : 'min-h-12')}>
      <span className={cn('w-16 shrink-0 text-muted-foreground', touch ? 'text-base' : 'text-sm')}>{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  )
}

function NoteViewBlock(props: NoteSettingsPanelBlockProps & { onOpenFolder: () => void }) {
  // 16px on touch: iOS zooms the page into any focused field smaller than that.
  const textSize = props.touch ? 'text-base' : 'text-sm'
  const { leaf, parent } = splitFolderBlock(props.folder)
  // Hover/focus tint instead of a box: the value reads as text until you
  // reach for it, which is what makes the rows an inspector and not a form.
  const fieldClass = cn(
    '-mx-2 min-w-0 flex-1 rounded-md bg-transparent px-2 outline-none transition-colors hover:bg-muted/60 focus:bg-muted/80',
    props.touch ? 'h-11' : 'h-9',
    textSize,
  )

  return (
    <>
      {props.isTodo ? (
        <RowBlock label="Date" touch={props.touch}>
          <input
            type="date"
            value={props.todoDate}
            onChange={(event) => props.onTodoDateChange(event.target.value)}
            aria-label="To do date"
            className={fieldClass}
          />
        </RowBlock>
      ) : (
        <RowBlock label="Name" touch={props.touch}>
          <input
            value={props.filename.replace(/\.md$/i, '')}
            onChange={(event) => props.onFilenameChange(event.target.value)}
            spellCheck={false}
            aria-label="Note name"
            className={fieldClass}
          />
          <span className={cn('shrink-0 pl-1 text-muted-foreground/50', textSize)}>.md</span>
        </RowBlock>
      )}

      <button
        type="button"
        onClick={props.onOpenFolder}
        className={cn(
          'ltm-motion-fast flex w-full items-center gap-4 rounded-lg px-3 text-left transition-colors hover:bg-muted/60',
          props.touch ? 'min-h-14' : 'min-h-12',
        )}
      >
        <span className={cn('w-16 shrink-0 text-muted-foreground', textSize)}>Folder</span>
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="ltm-explorer-folder-row contents" data-path={props.folder}>
            <Folder className="ltm-explorer-glyph ltm-explorer-folder-icon h-4 w-4 shrink-0 text-blue-500" />
          </span>
          {props.folder ? (
            <span className={cn('flex min-w-0 items-baseline gap-2', textSize)}>
              <span className="shrink-0 text-foreground">{leaf}</span>
              {parent && <span className="truncate text-[13px] text-muted-foreground/60">{parent}</span>}
            </span>
          ) : (
            <span className={cn('text-muted-foreground', textSize)}>Choose a folder…</span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      </button>

      <RowBlock label="Type" touch={props.touch}>
        {/* The app's own segmented control, at row scale — a bespoke one here
            was the only switch in the app shaped like it (2026-10-29). */}
        <SegmentedToggleBlock
          value={props.noteKind}
          onChange={props.onNoteKindChange}
          options={NOTE_KINDS_BLOCK.map(kind => ({ value: kind.id, label: kind.label }))}
          ariaLabel="Note type"
          size={props.touch ? 'lg' : 'md'}
        />
      </RowBlock>

      {(props.isTodo || props.loadingTarget) && (
        <p className="px-3 pb-2 pt-1 text-[13px] leading-relaxed text-muted-foreground">
          {props.loadingTarget
            ? 'Opening the note already in this folder…'
            : `Each line becomes a task — ${props.todoItemCount} so far.`}
        </p>
      )}
    </>
  )
}

function FolderPickerViewBlock({
  folder,
  suggested,
  onBack,
  onPick,
}: {
  folder: string
  suggested: string[]
  onBack: () => void
  onPick: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shownSuggestions = needle
    ? suggested.filter(path => path.toLowerCase().includes(needle))
    : suggested

  return (
    <div className="ltm-panel-push flex max-h-[min(56rem,78vh)] flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-4 pt-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to note settings"
          className="ltm-motion-fast inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-foreground">Choose a folder</span>
      </div>

      <div className="shrink-0 px-5 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape clears the search first; the panel closes on the next.
              if (event.key === 'Escape' && query) { event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); setQuery('') }
            }}
            autoFocus
            placeholder="Search folders"
            aria-label="Search folders"
            className="h-10 w-full rounded-lg bg-muted/60 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-muted"
          />
        </div>
      </div>

      {/* Inset scroll region: the rows keep a gutter on both sides and the
          last one stops short of the edge. The explorer's quiet scrollbar —
          thin, and faint until you reach for it — not the app default, which
          read as a grey slab beside the rows (2026-10-29). */}
      <div className="ltm-quiet-scrollbar min-h-0 flex-1 overflow-auto px-4 pb-4">
        {shownSuggestions.length > 0 && (
          <>
            <div className={SECTION_LABEL_CLASS}>Suggested</div>
            {shownSuggestions.map((path) => {
              const { leaf, parent } = splitFolderBlock(path)
              const current = path === folder
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => onPick(path)}
                  title={path}
                  // Explorer row classes + `data-path`: folder colours and the
                  // icon style follow the vault explorer (see FolderTreePickerBlock).
                  data-path={path}
                  className={cn(
                    'ltm-explorer-row ltm-explorer-folder-row flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-foreground/90 transition-colors hover:bg-muted/70',
                    current && 'bg-[#e8eaee] text-foreground hover:bg-[#e8eaee] dark:bg-[#2a2d33] dark:hover:bg-[#2a2d33]',
                  )}
                >
                  <Folder className="ltm-explorer-glyph ltm-explorer-folder-icon h-4 w-4 shrink-0 text-blue-500" />
                  <span className="shrink-0">{leaf}</span>
                  {parent && <span className="min-w-0 truncate text-[13px] text-muted-foreground/60">{parent}</span>}
                  {current && <Check className="ml-auto h-4 w-4 shrink-0 text-foreground/80" />}
                </button>
              )
            })}
          </>
        )}

        <div className={SECTION_LABEL_CLASS}>All folders</div>
        <FolderTreePickerBlock
          bare
          filter={query}
          value={folder}
          onChange={onPick}
          maxHeightClassName=""
        />
      </div>
    </div>
  )
}
