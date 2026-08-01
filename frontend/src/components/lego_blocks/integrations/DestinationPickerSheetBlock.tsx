import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, FolderTree, Plus, Search, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import FolderTreePickerBlock from './FolderTreePickerBlock'
import { useVaultFolderPathsBlock } from '../hooks/useVaultFolderPathsBlock'

// Picking a destination, as its own sheet on phone.
//
// It used to be a section inside the Note settings sheet, laid out for desktop:
// `sm:grid-cols-[1.15fr_1fr]` put a folder tree beside two jump lists, which on
// a phone collapsed into chip cloud → tree → Most used → Recent → save-as-chip,
// all stacked inside a sheet already carrying file name, note type and three
// toggles (2026-08-01). Six scroll regions fighting over 75vh, with the thing
// you actually came to set rendered as a ragged chip cloud you had to aim at.
//
// So destination gets the whole screen, and the parts stop competing:
//   - typing is the fast path (search, pinned low where the thumb is),
//   - the tree is the browse path, full width and full height for once,
//   - saved/most-used/recent are rows, not chips — a row can show the path.
//
// The tree is deliberately kept rather than replaced by search: search only
// knows folders that already contain notes (see `useVaultFolderPathsBlock`), so
// dropping the tree would make brand-new empty folders unreachable.

export interface DestinationPickerSheetQuickBlock {
  id: string
  label: string
  pathSegments: string[]
}

export interface DestinationPickerSheetBlockProps {
  /** Current destination, vault-relative. Empty string = vault root. */
  value: string
  onChange: (path: string) => void
  onClose: () => void
  quickDestinations: DestinationPickerSheetQuickBlock[]
  mostUsedDestinations: Array<{ path: string; count: number }>
  recentDestinations: string[]
  onDeleteQuickDestination: (id: string) => void
  /** Returns false when the label/folder pair is incomplete. */
  onAddQuickDestination: (label: string, segments: string[]) => boolean
  /** Keyboard + safe-area inset, so the pinned search field rides above both. */
  bottomInsetPx?: number
  /** Top offset, leaving a sliver of the page visible above the sheet. */
  topOffsetPx?: number
}

/** Leaf name of a folder path, for the row's primary line. */
function folderLeafBlock(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? 'Vault root'
}

export default function DestinationPickerSheetBlock({
  value,
  onChange,
  onClose,
  quickDestinations,
  mostUsedDestinations,
  recentDestinations,
  onDeleteQuickDestination,
  onAddQuickDestination,
  bottomInsetPx = 0,
  topOffsetPx,
}: DestinationPickerSheetBlockProps) {
  const [query, setQuery] = useState('')
  const [savingChip, setSavingChip] = useState(false)
  const [chipLabel, setChipLabel] = useState('')
  const chipInputRef = useRef<HTMLInputElement | null>(null)

  const searching = query.trim().length > 0
  // Unconditional because the sheet is mounted only while open — the hook's
  // `enabled` flag is for callers that keep it alive behind a closed panel.
  const { folders } = useVaultFolderPathsBlock(true)

  useEffect(() => {
    if (savingChip) chipInputRef.current?.focus()
  }, [savingChip])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    // Shallower paths first, then alphabetical: when "thoughts" matches both
    // `sfdl/thoughts` and `sfdl/thoughts/archive/2024`, the parent is far more
    // often the one meant, and burying it under its own descendants is the
    // failure mode of every path search.
    return folders
      .filter(folder => folder.toLowerCase().includes(needle))
      .sort((a, b) => {
        const depthDelta = a.split('/').length - b.split('/').length
        return depthDelta !== 0 ? depthDelta : a.localeCompare(b)
      })
      .slice(0, 80)
  }, [folders, query])

  const handleSaveChip = () => {
    if (!onAddQuickDestination(chipLabel, value.split('/').filter(Boolean))) return
    setChipLabel('')
    setSavingChip(false)
  }

  const rowBlock = (
    path: string,
    options: { key: string; trailing?: React.ReactNode; onRemove?: () => void; label?: string },
  ) => {
    const active = path === value
    return (
      <div key={options.key} className="flex items-center">
        <button
          type="button"
          onClick={() => { onChange(path); onClose() }}
          // Two lines at py-2.5 clears 56pt without needing a fixed height,
          // which would clip the wrapped label on the longest names.
          className="ltm-motion-fast flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors hover:bg-muted"
        >
          <div className="min-w-0 flex-1">
            <div className={cn('truncate text-[15px]', active ? 'font-medium text-foreground' : 'text-foreground/90')}>
              {options.label ?? folderLeafBlock(path)}
            </div>
            {/* The full path is the point of a row over a chip — a chip could
                only ever show the leaf, and leaves collide constantly
                ("thoughts" lives under four different parents here). */}
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {path || 'Vault root'}
            </div>
          </div>
          {options.trailing}
          {active && <Check className="h-4 w-4 shrink-0 text-foreground" />}
        </button>
        {options.onRemove && (
          <button
            type="button"
            onClick={options.onRemove}
            aria-label="Remove saved destination"
            className="ltm-motion-fast mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  const sectionLabelBlock = (label: string) => (
    <div className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
  )

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-background/60" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[61] flex flex-col overflow-hidden rounded-t-[28px] border-t border-border bg-background shadow-2xl"
        // Leaves a sliver of the page above the sheet, below the status bar —
        // a flat `3rem` would have sat *under* the clock on a Dynamic Island
        // phone, where the safe inset alone is ~59px.
        style={{ top: topOffsetPx != null ? `${topOffsetPx}px` : 'calc(var(--ltm-safe-top) + 1.5rem)' }}
      >
        {/* --- header --- */}
        {/* Fixed, with the list scrolling under it. Cancel sits left because
            this sheet is pushed on top of Note settings: it goes back there,
            it does not dismiss the whole stack. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-2 py-2">
          <button
            type="button"
            onClick={onClose}
            className="ltm-motion-fast inline-flex h-11 items-center rounded-lg px-3 text-[15px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <div className="flex-1 text-center text-[15px] font-semibold">Destination</div>
          <button
            type="button"
            onClick={() => setSavingChip(open => !open)}
            disabled={!value}
            aria-label="Save this folder as a shortcut"
            className={cn(
              'ltm-motion-fast inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30',
              savingChip && 'bg-muted text-foreground',
            )}
          >
            <Plus className="h-[18px] w-[18px]" />
          </button>
        </div>

        {savingChip && (
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border/70 px-3 py-2">
            <input
              ref={chipInputRef}
              value={chipLabel}
              onChange={(event) => setChipLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); handleSaveChip() }
                if (event.key === 'Escape') { event.preventDefault(); setSavingChip(false) }
              }}
              placeholder={`Name this shortcut to ${folderLeafBlock(value)}…`}
              aria-label="Shortcut name"
              className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-foreground/30"
            />
            <button
              type="button"
              onClick={handleSaveChip}
              disabled={!chipLabel.trim()}
              className="ltm-motion-fast inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40"
            >
              <Star className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
        )}

        {/* --- list --- */}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {searching ? (
            matches.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No folder matches “{query.trim()}”.
              </div>
            ) : (
              <div className="pb-2">
                {sectionLabelBlock(`${matches.length} match${matches.length === 1 ? '' : 'es'}`)}
                {matches.map(path => rowBlock(path, { key: `match:${path}` }))}
              </div>
            )
          ) : (
            <div className="pb-2">
              {quickDestinations.length > 0 && (
                <>
                  {sectionLabelBlock('Saved')}
                  {quickDestinations.map(destination => rowBlock(
                    destination.pathSegments.join('/'),
                    {
                      key: `quick:${destination.id}`,
                      label: destination.label,
                      onRemove: () => onDeleteQuickDestination(destination.id),
                    },
                  ))}
                </>
              )}

              {mostUsedDestinations.length > 0 && (
                <>
                  {sectionLabelBlock('Most used')}
                  {mostUsedDestinations.map(entry => rowBlock(entry.path, {
                    key: `used:${entry.path}`,
                    trailing: (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {entry.count}
                      </span>
                    ),
                  }))}
                </>
              )}

              {recentDestinations.length > 0 && (
                <>
                  {sectionLabelBlock('Recent')}
                  {recentDestinations.map(path => rowBlock(path, { key: `recent:${path}` }))}
                </>
              )}

              {/* The browse path. Kept alongside search, not replaced by it:
                  search is built from folders that already contain notes, so a
                  freshly created empty folder is reachable only through here. */}
              <div className="px-4 pb-1 pt-4">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <FolderTree className="h-3 w-3" />
                  All folders
                </div>
              </div>
              <div className="px-2">
                <FolderTreePickerBlock
                  value={value}
                  onChange={onChange}
                  maxHeightClassName="max-h-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* --- search ---
            Pinned to the bottom, not the top: this is a phone, and the thumb
            lives down here. The inset keeps it above the keyboard it summons. */}
        <div
          className="shrink-0 border-t border-border/70 px-3 pt-2"
          style={{ paddingBottom: `${Math.max(bottomInsetPx, 8)}px` } as CSSProperties}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                // Escape clears the search before it closes the sheet — losing
                // the whole picker to a stray key would discard the query.
                if (query) setQuery('')
                else onClose()
              }}
              placeholder="Search folders"
              aria-label="Search folders"
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-[15px] outline-none transition-colors focus:border-foreground/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="ltm-motion-fast absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
