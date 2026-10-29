import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Folder, FolderOpen, FolderPlus, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  fetchFolderChildrenBlock,
  invalidateFolderChildrenBlock,
} from '@/services/lego_blocks/units/folderChildrenCacheBlock'

// A small vault explorer for picking a destination folder.
//
// Replaces the cascading dropdown stack (2026-07-31). That design needed a
// separate widget per job — one <select> per level, a "Go deeper" toggle, a
// free-text "add folder segment" field, and a "destination preview" line —
// because a dropdown cannot show a path. A tree shows the shape directly, so
// the selected node *is* the preview and the scaffolding disappears.
//
// Deliberately not `VaultExplorerBlock`: that renders files, drag-and-drop,
// context menus and previews at ~2k lines. Picking a folder needs folders.

export interface FolderTreePickerNodeBlock {
  /** Full vault path, e.g. `lifeblood_systems/sfdl`. Empty string = vault root. */
  path: string
  name: string
  depth: number
}

interface TreeState {
  expanded: Set<string>
  children: Map<string, string[]>
  loading: Set<string>
}

// Expansion lives outside the component on purpose. Something in the New Note
// panel remounts this picker on interaction (2026-07-31 — not yet root-caused),
// and component-local state meant every click collapsed the tree back to the
// selection, which read as "clicking is doing nothing". Module scope survives a
// remount and dies with the reload, which is the right lifetime for "which
// folders did I open" anyway.
const persistedTreeState: TreeState = {
  expanded: new Set<string>(),
  children: new Map<string, string[]>(),
  loading: new Set<string>(),
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/** Ancestors of a path, root-first: `a/b/c` -> ['a', 'a/b']. Used to open the
 *  tree down to the current selection on mount. */
function ancestorsOf(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  const result: string[] = []
  for (let index = 0; index < segments.length - 1; index += 1) {
    result.push(segments.slice(0, index + 1).join('/'))
  }
  return result
}

export interface FolderTreePickerBlockProps {
  /** Currently selected folder path. Empty string means nothing chosen yet. */
  value: string
  onChange: (path: string) => void
  /** Rows to render before any scrolling kicks in. */
  maxHeightClassName?: string
  className?: string
  /** Controlled filter. When given, the tree drops its own search field — the
   *  host has one search for everything it lists (the note settings panel
   *  filters its suggestions and this tree from one field). */
  filter?: string
  /** Flat, frameless rows with a quiet selection (tint + check), for hosts
   *  that are already a framed surface. The boxed default stays for the rest. */
  bare?: boolean
}

export default function FolderTreePickerBlock({
  value,
  onChange,
  maxHeightClassName = 'max-h-[46vh]',
  className,
  filter: controlledFilter,
  bare = false,
}: FolderTreePickerBlockProps) {
  const [state, setStateRaw] = useState<TreeState>(() => ({
    expanded: new Set(persistedTreeState.expanded),
    children: new Map(persistedTreeState.children),
    loading: new Set(persistedTreeState.loading),
  }))

  // Mirror every update into module scope so the next mount starts where this
  // one left off.
  const setState = useCallback((update: (previous: TreeState) => TreeState) => {
    setStateRaw((previous) => {
      const next = update(previous)
      persistedTreeState.expanded = next.expanded
      persistedTreeState.children = next.children
      persistedTreeState.loading = next.loading
      return next
    })
  }, [])
  const [ownFilter, setFilter] = useState('')
  const filter = controlledFilter ?? ownFilter
  const [creating, setCreating] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [createError, setCreateError] = useState('')
  const newFolderInputRef = useRef<HTMLInputElement | null>(null)

  const loadChildren = useCallback(async (path: string) => {
    setState(previous => {
      if (previous.children.has(path) || previous.loading.has(path)) return previous
      const loading = new Set(previous.loading)
      loading.add(path)
      return { ...previous, loading }
    })

    const folders = await fetchFolderChildrenBlock(path)

    setState(previous => {
      const children = new Map(previous.children)
      children.set(path, folders)
      const loading = new Set(previous.loading)
      loading.delete(path)
      return { ...previous, children, loading }
    })
  }, [])

  // Open the tree down to the current selection on mount, so reopening the
  // browser lands where you left off instead of at the vault root.
  const didSeedRef = useRef(false)
  useEffect(() => {
    if (didSeedRef.current) return
    didSeedRef.current = true

    const toOpen = ['', ...ancestorsOf(value), ...(value ? [value] : [])]
    // Union, not replace — anything already open from a previous mount stays
    // open, so remounting cannot collapse the tree under you.
    setState(previous => ({ ...previous, expanded: new Set([...previous.expanded, ...toOpen]) }))
    for (const path of toOpen) void loadChildren(path)
  }, [value, loadChildren])

  const toggleExpanded = useCallback((path: string) => {
    setState(previous => {
      const expanded = new Set(previous.expanded)
      if (expanded.has(path)) {
        expanded.delete(path)
      } else {
        expanded.add(path)
        if (!previous.children.has(path)) void loadChildren(path)
      }
      return { ...previous, expanded }
    })
  }, [loadChildren])

  const handleSelect = useCallback((path: string) => {
    onChange(path)
    // Selecting also opens: you almost always want to see what's inside the
    // folder you just picked, and it saves a second click on the chevron.
    setState(previous => {
      if (previous.expanded.has(path)) return previous
      const expanded = new Set(previous.expanded)
      expanded.add(path)
      if (!previous.children.has(path)) void loadChildren(path)
      return { ...previous, expanded }
    })
  }, [loadChildren, onChange])

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim().replace(/^\/+|\/+$/g, '')
    if (!name) return
    if (!value) {
      setCreateError('Pick a parent folder first.')
      return
    }

    const target = joinPath(value, name)
    try {
      await getVaultFS().mkdir(target)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create the folder.')
      return
    }

    // The parent's child list is cached; without this the folder we just made
    // would not appear until the TTL expired.
    invalidateFolderChildrenBlock(value)
    setState(previous => {
      const children = new Map(previous.children)
      children.delete(value)
      return { ...previous, children }
    })
    await loadChildren(value)

    setNewFolderName('')
    setCreateError('')
    setCreating(false)
    onChange(target)
  }, [loadChildren, newFolderName, onChange, value])

  const normalizedFilter = filter.trim().toLowerCase()

  // Flatten the open tree into rows. Filtering matches on the folder name and
  // keeps a row whose descendant matches, so typing never hides the path you
  // need to click through.
  const rows = useMemo(() => {
    const result: FolderTreePickerNodeBlock[] = []

    const walk = (parentPath: string, depth: number) => {
      const names = state.children.get(parentPath)
      if (!names) return
      for (const name of names) {
        const path = joinPath(parentPath, name)
        const selfMatches = !normalizedFilter || name.toLowerCase().includes(normalizedFilter)
        const isOpen = state.expanded.has(path)
        if (selfMatches) result.push({ path, name, depth })
        if (isOpen) walk(path, depth + 1)
      }
    }

    walk('', 0)
    return result
  }, [normalizedFilter, state])

  const rootLoading = state.loading.has('') && !state.children.has('')

  // Everything on the way down to the selection. Selecting deep in the tree was
  // hard to *see* — one dark row among many, with nothing tying it to the
  // folders above it, so clicking read as doing nothing. The ancestors get a
  // lighter treatment and the built path is spelled out above the tree.
  const ancestorSet = useMemo(() => new Set(ancestorsOf(value)), [value])

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      {controlledFilter === undefined && (
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter folders"
          aria-label="Filter folders"
          className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2.5 text-sm outline-none transition-colors focus:border-foreground/30"
        />
      </div>
      )}

      <div className={cn(
        'min-h-0 flex-1 overflow-auto',
        bare ? '' : 'rounded-lg border border-border/60 bg-background p-1',
        maxHeightClassName,
      )}>
        {rootLoading && (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reading the vault…
          </div>
        )}

        {!rootLoading && rows.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {normalizedFilter ? `No folder matches “${filter.trim()}”.` : 'No folders here.'}
          </div>
        )}

        {rows.map((row) => {
          const isSelected = row.path === value
          const isAncestor = ancestorSet.has(row.path)
          const isExpanded = state.expanded.has(row.path)
          const isLoading = state.loading.has(row.path)
          return (
            bare ? (
            // Explorer rows, not a look-alike (2026-10-29): the same classes and
            // `data-path` the vault explorer uses, so the app-wide folder colour
            // rules and the filled/outline icon preference (App.tsx,
            // index.css) apply here untouched, along with its indent, tints and
            // selection colour.
            <div
              key={row.path}
              data-path={row.path}
              data-selected={isSelected ? 'true' : undefined}
              className={cn(
                'ltm-explorer-row ltm-explorer-folder-row flex w-full items-center gap-1 rounded-md pr-2 text-sm text-foreground/90 transition-colors hover:bg-muted/70',
                isSelected
                  ? 'bg-[#e8eaee] text-foreground hover:bg-[#e8eaee] dark:bg-[#2a2d33] dark:hover:bg-[#2a2d33]'
                  : (isExpanded || isAncestor) && 'bg-muted/50',
              )}
              style={{ paddingLeft: `${4 + row.depth * 14}px` }}
            >
              <button
                type="button"
                onClick={() => toggleExpanded(row.path)}
                aria-label={isExpanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                className="shrink-0 rounded p-1"
              >
                {isLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  : <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />}
              </button>
              <button
                type="button"
                onClick={() => handleSelect(row.path)}
                title={row.path}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left"
              >
                {isExpanded
                  ? <FolderOpen className="ltm-explorer-glyph ltm-explorer-folder-icon h-4 w-4 shrink-0 text-blue-500" />
                  : <Folder className="ltm-explorer-glyph ltm-explorer-folder-icon h-4 w-4 shrink-0 text-blue-500" />}
                <span className="truncate pl-0.5">{row.name}</span>
                {isSelected && <Check className="ml-auto h-4 w-4 shrink-0 text-foreground/80" />}
              </button>
            </div>
            ) : (
            <div
              key={row.path}
              className={cn(
                'ltm-motion-fast flex items-center gap-1 rounded-md pr-1 transition-colors',
                isSelected
                  ? 'bg-foreground text-background'
                  // The trail down to the selection, lighter than the selection
                  // itself — it shows the path being built without competing
                  // with the folder actually chosen.
                  : isAncestor
                    ? 'bg-muted/70 font-medium text-foreground'
                    : 'hover:bg-muted',
              )}
              style={{ paddingLeft: `${row.depth * 0.85}rem` }}
            >
              <button
                type="button"
                onClick={() => toggleExpanded(row.path)}
                aria-label={isExpanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                className="shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
              >
                {isLoading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <ChevronRight className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />}
              </button>
              <button
                type="button"
                onClick={() => handleSelect(row.path)}
                title={row.path}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-sm"
              >
                {isExpanded
                  ? <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  : <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                <span className="truncate">{row.name}</span>
              </button>
            </div>
          )
            )
        })}
      </div>

      <div className="shrink-0 space-y-1.5">
        {creating ? (
          <div className="flex gap-1.5">
            <input
              ref={newFolderInputRef}
              value={newFolderName}
              onChange={(event) => { setNewFolderName(event.target.value); setCreateError('') }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void handleCreateFolder() }
                if (event.key === 'Escape') { setCreating(false); setNewFolderName(''); setCreateError('') }
              }}
              autoFocus
              placeholder={value ? `New folder in ${value.split('/').pop()}` : 'Pick a parent folder first'}
              aria-label="New folder name"
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs outline-none transition-colors focus:border-foreground/30"
            />
            <button
              type="button"
              onClick={() => void handleCreateFolder()}
              disabled={!newFolderName.trim() || !value}
              className="ltm-motion-fast inline-flex h-8 shrink-0 items-center rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewFolderName(''); setCreateError('') }}
              className="ltm-motion-fast inline-flex h-8 shrink-0 items-center rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ltm-motion-fast inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New folder{value ? ` in ${value.split('/').pop()}` : ''}
          </button>
        )}
        {createError && <p className="text-[11px] text-destructive">{createError}</p>}
      </div>
    </div>
  )
}
