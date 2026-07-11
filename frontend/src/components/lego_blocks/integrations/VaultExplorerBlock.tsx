import { cloneElement, type ComponentType, type DragEvent as ReactDragEvent, isValidElement, type ReactElement, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import excalidrawLogo from '@/assets/excalidraw-logo.svg'

function ExcalidrawIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block ${className}`}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url(${excalidrawLogo})`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskImage: `url(${excalidrawLogo})`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}
import {
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Info,
  Link,
  Link2,
  Loader2,
} from 'lucide-react'
import UniversalSearchBlock from '@/components/lego_blocks/integrations/UniversalSearchBlock'
import NotebookTocBlock, { type NotebookTocViewMode } from '@/components/lego_blocks/integrations/NotebookTocBlock'
import {
  buildPathSearchCandidatesBlock,
  UNIVERSAL_SEARCH_INLINE_FILTER_PRESET_BLOCK,
} from '@/components/lego_blocks/integrations/universalSearchPresetBlock'
import {
  countNotebookPages,
  type NotebookEntry,
} from '@/components/lego_blocks/hooks/shared/useNotebookEntriesBlock'
import { isExcalidrawPathBlock } from '@/services/lego_blocks/units/excalidrawPathBlock'
import TagChipListBlock from '@/components/lego_blocks/units/TagChipListBlock'
import {
  EXPLORER_PERSISTENCE_PREFIX,
  getLeafName,
  getParentPath,
  hasNodeDragType,
  hasPathDragType,
  joinPath,
  normalizePersistedExpandedPaths,
  type PersistedExplorerState,
  readDroppedPath,
  readDroppedNodeId,
  readPersistedExplorerState,
} from '@/components/lego_blocks/units/VaultExplorerUtilsBlock'
import { rankFuzzyItemsBlock } from '@/services/lego_blocks/units/fuzzySearchBlock'
import { addGlobalSyncRefreshListenerBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import { cn } from '@/lib/utils'
import ContextMenuBlock, { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/lego_blocks/units/ui/select'
import { writeSortOrdersBlock } from '@/services/lego_blocks/units/notebookOrderBlock'
import { writeNotebookSidecarBlock } from '@/services/lego_blocks/units/notebookSidecarBlock'
import { getAbsolutePathForClipboardOrch } from '@/services/orchestrators/fileSystemOrch'

// Internal drop targets read the explicit application/x-ltm-path types; text/plain
// and text/uri-list carry the absolute path so dragging out of the app (Terminal,
// editors, chat inputs) drops the full filesystem path, like dragging from Finder.
function setPathDragDataBlock(event: ReactDragEvent, path: string, kind: 'file' | 'folder'): void {
  event.dataTransfer.setData('application/x-ltm-path', `ltm-path:${path}`)
  event.dataTransfer.setData('application/x-ltm-path-kind', kind)
  event.dataTransfer.setData('text/ltm-file-path', path)
  const absolute = getAbsolutePathForClipboardOrch(path)
  event.dataTransfer.setData('text/plain', absolute ?? path)
  if (absolute?.startsWith('/')) {
    event.dataTransfer.setData('text/uri-list', `file://${encodeURI(absolute)}`)
  }
  event.dataTransfer.effectAllowed = 'copyMove'
}

interface FolderMapEntryInfo {
  file: string
  description: string
  missing?: boolean
  duplicate?: boolean
}

interface FolderMapSectionInfo {
  title: string
  entries: FolderMapEntryInfo[]
}

interface FolderMapInfo {
  sections: FolderMapSectionInfo[]
  unmapped: string[]
  descriptions: Record<string, string>
}

interface FolderEntries {
  folders: string[]
  files: string[]
  map?: FolderMapInfo
}

interface NodeState extends FolderEntries {
  loaded: boolean
  loading: boolean
  error: string | null
}

const FOLDER_MAP_FILENAME = '_map.md'

const PINNED_MAP_TOOLTIP = 'Reading map for this folder — controls the display order below.'

/** Frontmatter facts shown in a row's hover tooltip (structurally matches the
 *  service's `FileTooltipMetaBlock`). */
interface FileTooltipMeta {
  summary?: string
  createdAt?: string
  updatedAt?: string
}

/** Compact date for the tooltip, e.g. "Jul 6, 2026". Returns null on unparseable. */
function formatTooltipDate(value?: string): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const TOOLTIP_SHOW_DELAY_MS = 400
const TOOLTIP_CURSOR_OFFSET = { x: 18, y: 32 }
const TOOLTIP_VIEWPORT_PAD = 8

/**
 * Hover tooltip for an explorer file row, anchored to the cursor (not the full-width
 * row, which would fling it far to the side). Combines several facts, all optional:
 *  - `Summary:` — the file's own frontmatter `summary:` (what the page is about),
 *    resolved lazily on first hover.
 *  - `Why here:` — the `_map.md` line's ` — ` text (why the page sits at this
 *    position in the sequence), passed in synchronously via `mapDescription`.
 *  - A tiny footer with the frontmatter created/updated dates for recency context.
 * A fixed `staticText` (the pinned `_map.md` row) overrides all. Renders nothing
 * when there's nothing to show, so files with none of these get no tooltip.
 */
function ExplorerRowTooltip({
  filePath,
  staticText,
  mapDescription,
  resolveMeta,
  children,
}: {
  filePath: string
  staticText?: string
  mapDescription?: string
  resolveMeta?: (path: string) => Promise<FileTooltipMeta | null>
  children: ReactElement
}) {
  const [meta, setMeta] = useState<FileTooltipMeta | null>(null)
  // staticText rows and rows with no resolver never need a fetch.
  const loadedRef = useRef<boolean>(staticText != null || !resolveMeta)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const cursorRef = useRef({ x: 0, y: 0 })
  const showTimerRef = useRef<number | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const clearShowTimer = () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }

  const load = useCallback(() => {
    if (loadedRef.current || !resolveMeta) return
    loadedRef.current = true
    resolveMeta(filePath)
      .then(setMeta)
      .catch(() => setMeta(null))
  }, [filePath, resolveMeta])

  const handleEnter = (event: React.MouseEvent) => {
    cursorRef.current = { x: event.clientX, y: event.clientY }
    clearShowTimer()
    showTimerRef.current = window.setTimeout(() => {
      load()
      setPos(cursorRef.current)
      setVisible(true)
    }, TOOLTIP_SHOW_DELAY_MS)
  }
  const handleMove = (event: React.MouseEvent) => {
    cursorRef.current = { x: event.clientX, y: event.clientY }
  }
  const handleLeave = () => {
    clearShowTimer()
    setVisible(false)
  }

  useEffect(() => () => clearShowTimer(), [])

  // Clamp into the viewport once measured, before paint (no flicker).
  useLayoutEffect(() => {
    if (!visible || !tipRef.current) return
    const rect = tipRef.current.getBoundingClientRect()
    const pad = TOOLTIP_VIEWPORT_PAD
    let x = pos.x + TOOLTIP_CURSOR_OFFSET.x
    let y = pos.y + TOOLTIP_CURSOR_OFFSET.y
    if (x + rect.width > window.innerWidth - pad) x = pos.x - rect.width - TOOLTIP_CURSOR_OFFSET.x
    if (x < pad) x = pad
    if (y + rect.height > window.innerHeight - pad) y = pos.y - rect.height - TOOLTIP_CURSOR_OFFSET.y
    if (y < pad) y = pad
    if (x !== pos.x + TOOLTIP_CURSOR_OFFSET.x || y !== pos.y + TOOLTIP_CURSOR_OFFSET.y) {
      tipRef.current.style.left = `${x}px`
      tipRef.current.style.top = `${y}px`
    }
  }, [visible, pos, meta, mapDescription, staticText])

  const summary = meta?.summary
  const createdLabel = formatTooltipDate(meta?.createdAt)
  const updatedLabel = formatTooltipDate(meta?.updatedAt)
  // Only surface "Updated" when it's a real, distinct date from creation.
  const showUpdated = !!updatedLabel && updatedLabel !== createdLabel
  const hasDates = !!createdLabel || showUpdated
  const hasContent = staticText != null || !!summary || !!mapDescription || hasDates

  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        onMouseEnter: handleEnter,
        onMouseMove: handleMove,
        onMouseLeave: handleLeave,
      })
    : children

  return (
    <>
      {trigger}
      {visible && hasContent
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              className="pointer-events-none fixed z-[70] max-w-[340px] space-y-2 rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-2.5 text-[12.5px] leading-relaxed text-zinc-100 shadow-xl shadow-black/40 backdrop-blur-sm"
              style={{
                left: pos.x + TOOLTIP_CURSOR_OFFSET.x,
                top: pos.y + TOOLTIP_CURSOR_OFFSET.y,
              }}
            >
              {staticText != null ? (
                <div className="text-zinc-300">{staticText}</div>
              ) : (
                <>
                  {summary ? (
                    <div>
                      <span className="font-semibold uppercase tracking-wide text-[10.5px] text-emerald-300">
                        Summary
                      </span>
                      <div className="mt-0.5 text-zinc-100">{summary}</div>
                    </div>
                  ) : null}
                  {summary && mapDescription ? (
                    <div className="border-t border-white/10" />
                  ) : null}
                  {mapDescription ? (
                    <div>
                      <span className="font-semibold uppercase tracking-wide text-[10.5px] text-amber-300">
                        Why here
                      </span>
                      <div className="mt-0.5 text-zinc-300">{mapDescription}</div>
                    </div>
                  ) : null}
                  {hasDates ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pt-0.5 text-[10px] text-zinc-500">
                      {createdLabel ? <span>Created {createdLabel}</span> : null}
                      {showUpdated ? <span>Updated {updatedLabel}</span> : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

type ExplorerPathKind = 'file' | 'folder'
type ExplorerActionResult = void | boolean | string | Promise<void | boolean | string>

interface PendingRenameState {
  path: string
  kind: ExplorerPathKind
}

interface InlineRenameState {
  path: string
  kind: ExplorerPathKind
  value: string
}

type ExplorerViewModeBlock = 'tree' | NotebookTocViewMode

interface VaultExplorerBlockProps {
  loadEntries: (path: string) => Promise<FolderEntries>
  onOpenFile: (path: string) => void
  onOpenFileAsRuledNotebook?: (path: string) => void
  onCreateFolder?: (parentPath: string) => ExplorerActionResult
  onCreateFile?: (parentPath: string) => ExplorerActionResult
  onCreateCsvFile?: (parentPath: string) => ExplorerActionResult
  onCreateDrawing?: (parentPath: string) => ExplorerActionResult
  onCreateLink?: (parentPath: string) => ExplorerActionResult
  onCopyAbsolutePath?: (path: string) => ExplorerActionResult
  onCopyRelativePath?: (path: string) => ExplorerActionResult
  onOpenInNewTab?: (path: string) => ExplorerActionResult
  onOpenInNewWindow?: (path: string) => ExplorerActionResult
  onDuplicateFile?: (path: string) => ExplorerActionResult
  onRenamePath?: (path: string, kind: ExplorerPathKind, nextName: string) => ExplorerActionResult
  onDeleteFile?: (path: string) => ExplorerActionResult
  onDeleteFolder?: (path: string) => ExplorerActionResult
  onOpenInFinder?: (path: string) => ExplorerActionResult
  loadFileTags?: (path: string) => Promise<string[]>
  /**
   * Resolve a file's frontmatter facts (summary + created/updated) for its hover
   * tooltip. Called lazily on hover (per the map-files spec, tooltips show the page's
   * own summary, not the map line). Return null → no tooltip. When omitted, file rows
   * have no frontmatter tooltip.
   */
  loadFileMeta?: (path: string) => Promise<FileTooltipMeta | null>
  selectedPath?: string | null
  onSelectFile?: (path: string) => void
  onDropNode?: (nodeUuid: string, targetPath: string) => Promise<void>
  onMovePath?: (sourcePath: string, sourceKind: ExplorerPathKind, targetFolderPath: string) => ExplorerActionResult
  draggableFiles?: boolean
  draggableFolders?: boolean
  title?: string
  persistenceKey?: string
  listenToGlobalSyncRefresh?: boolean
  className?: string
  onOpenFolderAsNotebook?: (path: string) => void
  belowToolbarSlot?: ReactNode
}

function getFileIcon(name: string) {
  const lower = name.toLowerCase()
  if (isExcalidrawPathBlock(lower)) return ExcalidrawIcon
  if (lower.endsWith('.md')) return FileText
  if (lower.endsWith('.url')) return Link2
  return File
}

function getFileIconColor(name: string, isSelected: boolean): string {
  if (isSelected) return 'text-white'
  const lower = name.toLowerCase()
  if (lower.endsWith('.url')) return 'text-blue-400'
  if (isExcalidrawPathBlock(lower)) return 'text-violet-400'
  if (lower.endsWith('.pdf')) return 'text-red-400'
  return 'text-muted-foreground'
}

function remapPathAfterMove(path: string, sourcePath: string, targetPath: string): string {
  if (path === sourcePath) return targetPath
  if (!path.startsWith(`${sourcePath}/`)) return path
  const suffix = path.slice(sourcePath.length + 1)
  return suffix ? `${targetPath}/${suffix}` : targetPath
}

function collectRefreshPaths(path: string): string[] {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const chain = new Set<string>([''])
  let current = trimmed
  while (current) {
    chain.add(current)
    current = getParentPath(current)
  }
  return [...chain]
}

function buildNotebookEntriesFromLoadedNodes(
  nodes: Record<string, NodeState>,
  expandedPaths: string[],
): NotebookEntry[] {
  const expandedPathSet = new Set(expandedPaths.filter((path) => path.length > 0))
  let position = 0

  function buildFolderEntries(path: string, depth: number): NotebookEntry[] {
    const node = nodes[path]
    if (!node?.loaded) return []

    const result: NotebookEntry[] = []

    for (const folderName of node.folders) {
      const folderPath = joinPath(path, folderName)
      if (!expandedPathSet.has(folderPath)) continue
      position += 1
      result.push({
        path: folderPath,
        name: folderName,
        kind: 'folder',
        depth,
        sortOrder: null,
        position,
        children: buildFolderEntries(folderPath, depth + 1),
      })
    }

    for (const fileName of node.files) {
      position += 1
      result.push({
        path: joinPath(path, fileName),
        name: fileName,
        kind: 'file',
        depth,
        sortOrder: null,
        position,
      })
    }

    return result
  }

  return buildFolderEntries('', 0)
}

export default function VaultExplorerBlock({
  loadEntries,
  onOpenFile,
  onOpenFileAsRuledNotebook,
  onCreateFolder,
  onCreateFile,
  onCreateCsvFile,
  onCreateDrawing,
  onCreateLink,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onOpenInNewTab,
  onOpenInNewWindow,
  onDuplicateFile,
  onRenamePath,
  onDeleteFile,
  onDeleteFolder,
  onOpenInFinder,
  loadFileTags,
  loadFileMeta,
  selectedPath = null,
  onSelectFile,
  onDropNode,
  onMovePath,
  draggableFiles = false,
  draggableFolders = false,
  title = 'Thinking Space Explorer',
  persistenceKey = 'global',
  listenToGlobalSyncRefresh = false,
  onOpenFolderAsNotebook,
  className,
  belowToolbarSlot = null,
}: VaultExplorerBlockProps) {
  const storageKey = `${EXPLORER_PERSISTENCE_PREFIX}:${persistenceKey}`

  // Per-session cache of file → frontmatter tooltip facts. Populated lazily on first
  // hover; null means "loaded, nothing to show" so we don't refetch.
  const tooltipMetaCacheRef = useRef<Map<string, FileTooltipMeta | null>>(new Map())
  const resolveFileMeta = useCallback(async (path: string): Promise<FileTooltipMeta | null> => {
    if (!loadFileMeta) return null
    const cache = tooltipMetaCacheRef.current
    if (cache.has(path)) return cache.get(path) ?? null
    let value: FileTooltipMeta | null = null
    try {
      value = await loadFileMeta(path)
    } catch {
      value = null
    }
    cache.set(path, value)
    return value
  }, [loadFileMeta])
  const initialPersistedState = useMemo(
    () => readPersistedExplorerState(storageKey),
    [storageKey],
  )
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [expandedPaths, setExpandedPaths] = useState<string[]>(
    () => normalizePersistedExpandedPaths(initialPersistedState?.expandedPaths),
  )
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(
    () => (typeof initialPersistedState?.selectedFolderPath === 'string'
      ? initialPersistedState.selectedFolderPath
      : null),
  )
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    () => (typeof initialPersistedState?.selectedFilePath === 'string'
      ? initialPersistedState.selectedFilePath
      : null),
  )
  const [viewMode, setViewMode] = useState<ExplorerViewModeBlock>(
    () => (initialPersistedState?.viewMode === 'list' || initialPersistedState?.viewMode === 'grid'
      ? initialPersistedState.viewMode
      : 'tree'),
  )
  const [query, setQuery] = useState('')
  const [dropOverPath, setDropOverPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; kind: ExplorerPathKind } | null>(null)
  const [pendingRename, setPendingRename] = useState<PendingRenameState | null>(null)
  const [inlineRename, setInlineRename] = useState<InlineRenameState | null>(null)
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  const [infoPanelTags, setInfoPanelTags] = useState<string[] | null>(null)
  const [infoPanelLoading, setInfoPanelLoading] = useState(false)

  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameSubmittingRef = useRef(false)
  // Prevents the Enter keydown that opened the rename from immediately committing it
  const renameJustOpenedRef = useRef(false)
  // Tracks the latest inlineRename state as a ref so commitInlineRename always
  // reads the current value even when called from onBlur after unmount (stale closure).
  const inlineRenameRef = useRef<InlineRenameState | null>(null)
  const queryMatchCacheRef = useRef<Map<string, boolean>>(new Map())
  const nodesRef = useRef<Record<string, NodeState>>({})
  nodesRef.current = nodes
  inlineRenameRef.current = inlineRename

  const getNode = useCallback(
    (path: string): NodeState =>
      nodes[path] ?? { folders: [], files: [], loaded: false, loading: false, error: null },
    [nodes],
  )

  const loadPath = useCallback(
    async (path: string, force = false) => {
      let shouldLoad = true

      setNodes(prev => {
        const existing = prev[path]
        if (!force && existing?.loaded) {
          shouldLoad = false
          return prev
        }

        return {
          ...prev,
          [path]: {
            ...(existing ?? { folders: [], files: [] }),
            // Keep `loaded: true` when re-fetching so existing data stays
            // visible (stale-while-revalidate). Only go to false on first load
            // when there is no data yet.
            loaded: existing?.loaded ?? false,
            loading: true,
            error: null,
          },
        }
      })

      if (!shouldLoad) return

      try {
        const entries = await loadEntries(path)
        setNodes(prev => ({
          ...prev,
          [path]: {
            ...entries,
            loaded: true,
            loading: false,
            error: null,
          },
        }))
      } catch (err) {
        setNodes(prev => ({
          ...prev,
          [path]: {
            ...(prev[path] ?? { folders: [], files: [] }),
            loaded: false,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load folder',
          },
        }))
      }
    },
    [loadEntries],
  )

  useEffect(() => {
    const persisted = readPersistedExplorerState(storageKey)
    setExpandedPaths(normalizePersistedExpandedPaths(persisted?.expandedPaths))
    setSelectedFolderPath(
      typeof persisted?.selectedFolderPath === 'string' ? persisted.selectedFolderPath : null,
    )
    setSelectedFilePath(
      typeof persisted?.selectedFilePath === 'string' ? persisted.selectedFilePath : null,
    )
    setViewMode(
      persisted?.viewMode === 'list' || persisted?.viewMode === 'grid'
        ? persisted.viewMode
        : 'tree',
    )
    setNodes({})
    void loadPath('', true)
  }, [loadPath, storageKey])

  useEffect(() => {
    if (!selectedPath) return
    setSelectedFilePath(selectedPath)
    setSelectedFolderPath(getParentPath(selectedPath))
  }, [selectedPath])

  useEffect(() => {
    for (const path of expandedPaths) {
      if (!path) continue
      const node = getNode(path)
      if (!node.loaded && !node.loading) {
        void loadPath(path)
      }
    }
  }, [expandedPaths, getNode, loadPath])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const payload: PersistedExplorerState = {
        expandedPaths: normalizePersistedExpandedPaths(expandedPaths),
        selectedFolderPath,
        selectedFilePath,
        viewMode,
      }
      window.localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      // Ignore persistence failures; explorer should still work in-memory.
    }
  }, [expandedPaths, selectedFilePath, selectedFolderPath, storageKey, viewMode])

  const activeFilePath = selectedFilePath ?? selectedPath ?? null

  useEffect(() => {
    if (!showInfoPanel || !activeFilePath || !loadFileTags) {
      setInfoPanelTags(null)
      return
    }
    let cancelled = false
    setInfoPanelLoading(true)
    void loadFileTags(activeFilePath).then(tags => {
      if (!cancelled) {
        setInfoPanelTags(tags)
        setInfoPanelLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setInfoPanelTags([])
        setInfoPanelLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [showInfoPanel, activeFilePath, loadFileTags])

  const normalizedQuery = query.trim().toLowerCase()
  const hasTitle = title.trim().length > 0
  const inlineRenameSession = inlineRename ? `${inlineRename.kind}:${inlineRename.path}` : null

  useEffect(() => {
    queryMatchCacheRef.current = new Map()
  }, [normalizedQuery])

  const pathMatchesSearch = useCallback((path: string): boolean => {
    if (!normalizedQuery) return true
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!normalizedPath) return false

    const cached = queryMatchCacheRef.current.get(normalizedPath)
    if (typeof cached === 'boolean') return cached

    const matched = rankFuzzyItemsBlock({
      items: [normalizedPath],
      query: normalizedQuery,
      limit: 1,
      getCandidates: item => buildPathSearchCandidatesBlock(item),
    }).length > 0

    queryMatchCacheRef.current.set(normalizedPath, matched)
    return matched
  }, [normalizedQuery])

  const pathMatchesQuery = useCallback(
    (path: string, visited: Set<string>): boolean => {
      if (!normalizedQuery) return true
      if (visited.has(path)) return false
      visited.add(path)

      if (pathMatchesSearch(path)) return true

      const node = getNode(path)

      for (const folderName of node.folders) {
        const full = joinPath(path, folderName)
        if (pathMatchesSearch(full)) return true
        if (pathMatchesQuery(full, visited)) return true
      }

      for (const fileName of node.files) {
        if (pathMatchesSearch(joinPath(path, fileName))) return true
      }

      return false
    },
    [getNode, normalizedQuery, pathMatchesSearch],
  )

  const toggleFolder = useCallback(
    (path: string) => {
      setExpandedPaths(prev => {
        if (prev.includes(path)) return prev.filter(p => p !== path)
        return [...prev, path]
      })
      if (!getNode(path).loaded) {
        void loadPath(path)
      }
    },
    [getNode, loadPath],
  )

  const refreshRoot = useCallback(() => {
    setNodes({})
    setExpandedPaths([''])
    setSelectedFolderPath(null)
    setSelectedFilePath(null)
    setPendingRename(null)
    void loadPath('', true)
  }, [loadPath])

  useEffect(() => {
    if (!listenToGlobalSyncRefresh) return undefined
    return addGlobalSyncRefreshListenerBlock(() => {
      // Reload all currently-loaded folder paths in-place so the tree stays
      // expanded and selected state is preserved.  refreshRoot() would reset
      // expandedPaths to [''] which collapses everything — avoid that here.
      const currentNodes = nodesRef.current
      void loadPath('', true)
      for (const path of Object.keys(currentNodes)) {
        if (path && currentNodes[path]?.loaded) {
          void loadPath(path, true)
        }
      }
    })
  }, [listenToGlobalSyncRefresh, loadPath])

  const canDropNodes = !!onDropNode
  const canDropPaths = !!onMovePath
  const canDropOnRows = canDropNodes || canDropPaths
  const canDragFiles = draggableFiles || canDropPaths
  const canDragFolders = draggableFolders

  const handleDragOverTarget = useCallback((event: React.DragEvent, dropTargetPath: string): boolean => {
    const nodeDrop = canDropNodes && hasNodeDragType(event)
    const pathDrop = canDropPaths && hasPathDragType(event)
    if (!nodeDrop && !pathDrop) return false
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = pathDrop ? 'move' : 'link'
    setDropOverPath(dropTargetPath)
    return true
  }, [canDropNodes, canDropPaths])

  const handleDropOnTarget = useCallback(async (
    event: React.DragEvent,
    moveTargetFolderPath: string,
    nodeDropTargetPath: string = moveTargetFolderPath,
  ): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setDropOverPath(null)

    const droppedPath = canDropPaths ? readDroppedPath(event) : null
    if (droppedPath && onMovePath) {
      const sourcePath = droppedPath.path
      const sourceKind = droppedPath.kind
      if (sourceKind === 'folder' && sourcePath === moveTargetFolderPath) return
      const sourceParentPath = getParentPath(sourcePath)
      try {
        const result = await onMovePath(sourcePath, sourceKind, moveTargetFolderPath)
        const movedPath = typeof result === 'string' ? result : sourcePath

        if (sourceKind === 'folder' && movedPath !== sourcePath) {
          setExpandedPaths(prev => normalizePersistedExpandedPaths(prev.map(path => remapPathAfterMove(path, sourcePath, movedPath))))
          setSelectedFolderPath(prev => (prev ? remapPathAfterMove(prev, sourcePath, movedPath) : prev))
          setSelectedFilePath(prev => (prev ? remapPathAfterMove(prev, sourcePath, movedPath) : prev))
        } else if (sourceKind === 'file') {
          setSelectedFilePath(prev => (prev === sourcePath ? movedPath : prev))
          setSelectedFolderPath(prev => {
            if (prev === sourceParentPath) return getParentPath(movedPath)
            return prev
          })
        }

        // Reload all currently-loaded folder paths so the tree reflects the
        // move without the user needing to manually refresh.  We always
        // include root, source parent, and target; then sweep every other
        // loaded node so nested/sibling folders stay consistent too.
        const currentNodes = nodesRef.current
        const pathsToRefresh = new Set<string>(['', sourceParentPath, moveTargetFolderPath])
        for (const path of Object.keys(currentNodes)) {
          if (currentNodes[path]?.loaded) pathsToRefresh.add(path)
        }
        for (const refreshPath of pathsToRefresh) {
          void loadPath(refreshPath, true)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Move failed'
        window.alert(message)
      }
      return
    }

    if (!canDropNodes || !onDropNode) return
    const nodeId = readDroppedNodeId(event)
    if (nodeId) {
      void onDropNode(nodeId, nodeDropTargetPath)
    }
  }, [canDropNodes, canDropPaths, loadPath, onDropNode, onMovePath])

  const isExpanded = useCallback((path: string) => expandedPaths.includes(path), [expandedPaths])

  const filteredNotebookEntries = useMemo(() => {
    const notebookEntries = buildNotebookEntriesFromLoadedNodes(nodes, expandedPaths)
    if (!normalizedQuery) return notebookEntries

    function filterEntries(items: NotebookEntry[]): NotebookEntry[] {
      const next: NotebookEntry[] = []

      for (const item of items) {
        if (item.kind === 'file') {
          if (pathMatchesSearch(item.path)) next.push(item)
          continue
        }

        const children = item.children ? filterEntries(item.children) : []
        if (pathMatchesSearch(item.path) || children.length > 0) {
          next.push({ ...item, children })
        }
      }

      return next
    }

    return filterEntries(notebookEntries)
  }, [expandedPaths, nodes, normalizedQuery, pathMatchesSearch])

  const handleNotebookReorderFiles = useCallback(async (folderPath: string, orderedPaths: string[]) => {
    try {
      await writeSortOrdersBlock(orderedPaths)
      await writeNotebookSidecarBlock(folderPath, orderedPaths)
      void loadPath(folderPath, true)
    } catch (err) {
      console.error('Failed to persist explorer notebook reorder:', err)
    }
  }, [loadPath])

  const handleNotebookSelectPage = useCallback((path: string) => {
    setSelectedFilePath(path)
    setSelectedFolderPath(getParentPath(path))
    onSelectFile?.(path)
    onOpenFile(path)
  }, [onOpenFile, onSelectFile])

  const handleNotebookSelectFolder = useCallback((path: string) => {
    setSelectedFilePath(null)
    setSelectedFolderPath(path)
  }, [])

  const handleNotebookEntryContextMenu = useCallback((entry: NotebookEntry, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (entry.kind === 'file') {
      setSelectedFilePath(entry.path)
      setSelectedFolderPath(getParentPath(entry.path))
    } else {
      setSelectedFolderPath(entry.path)
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      path: entry.path,
      kind: entry.kind,
    })
  }, [])

  const handleNotebookEntryContextMenuRequest = useCallback((entry: NotebookEntry, anchorRect: DOMRect) => {
    if (entry.kind === 'file') {
      setSelectedFilePath(entry.path)
      setSelectedFolderPath(getParentPath(entry.path))
    } else {
      setSelectedFilePath(null)
      setSelectedFolderPath(entry.path)
    }
    setContextMenu({
      x: anchorRect.left + Math.min(anchorRect.width / 2, 24),
      y: anchorRect.top + Math.min(anchorRect.height / 2, 16),
      path: entry.path,
      kind: entry.kind,
    })
  }, [])

  const rowRefKey = useCallback((kind: ExplorerPathKind, path: string) => `${kind}:${path}`, [])

  const bindRowRef = useCallback(
    (kind: ExplorerPathKind, path: string) => (node: HTMLButtonElement | null) => {
      const key = rowRefKey(kind, path)
      if (node) rowRefs.current.set(key, node)
      else rowRefs.current.delete(key)
    },
    [rowRefKey],
  )

  const beginInlineRename = useCallback((path: string, kind: ExplorerPathKind) => {
    setPendingRename(null)
    renameJustOpenedRef.current = true
    setInlineRename({
      path,
      kind,
      value: getLeafName(path),
    })
    if (kind === 'file') {
      setSelectedFilePath(path)
      setSelectedFolderPath(getParentPath(path))
    } else {
      setSelectedFolderPath(path)
    }
  }, [])

  const cancelInlineRename = useCallback(() => {
    if (!inlineRename) return
    const key = rowRefKey(inlineRename.kind, inlineRename.path)
    const row = rowRefs.current.get(key)
    setInlineRename(null)
    setPendingRename(null)
    if (row) {
      window.requestAnimationFrame(() => row.focus())
    }
  }, [inlineRename, rowRefKey])

  const commitInlineRename = useCallback(async () => {
    // Use inlineRenameRef.current (not inlineRename from closure) so that if onBlur
    // fires after a successful Enter-commit (when the input unmounts while focused),
    // we see the already-cleared null and bail out instead of double-committing.
    if (!inlineRenameRef.current || renameSubmittingRef.current) return
    const currentPath = inlineRenameRef.current.path
    const currentKind = inlineRenameRef.current.kind
    const trimmed = inlineRenameRef.current.value.trim()
    const original = getLeafName(currentPath)

    if (!trimmed || trimmed === original) {
      cancelInlineRename()
      return
    }

    if (!onRenamePath) {
      cancelInlineRename()
      return
    }

    renameSubmittingRef.current = true
    try {
      const result = await onRenamePath(currentPath, currentKind, trimmed)
      const nextPath = typeof result === 'string' ? result : currentPath
      const parentPath = getParentPath(nextPath)
      if (currentKind === 'file') {
        setSelectedFilePath(nextPath)
        setSelectedFolderPath(parentPath)
      } else {
        setSelectedFolderPath(nextPath)
      }
      setInlineRename(null)
      void loadPath(parentPath, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rename failed'
      window.alert(message)
    } finally {
      renameSubmittingRef.current = false
    }
  }, [cancelInlineRename, loadPath, onRenamePath])

  const runContextAction = useCallback(
    async (
      handler: (() => ExplorerActionResult) | undefined,
      options?: { refresh?: boolean; refreshPath?: string; armRenameOnEnterKind?: ExplorerPathKind },
    ) => {
      if (!handler) return
      try {
        const result = await handler()
        if (result !== false && typeof result === 'string' && options?.armRenameOnEnterKind) {
          const createdPath = result
          const createdParent = getParentPath(createdPath)
          setPendingRename({ path: createdPath, kind: options.armRenameOnEnterKind })
          if (options.armRenameOnEnterKind === 'file') {
            setSelectedFilePath(createdPath)
            setSelectedFolderPath(createdParent)
          } else {
            setSelectedFolderPath(createdPath)
          }
          // Ensure parent folder (and all its ancestors) are expanded so the
          // newly created item is immediately visible without manual clicking.
          const ancestorsToExpand = collectRefreshPaths(createdParent).filter(p => p !== '')
          if (ancestorsToExpand.length > 0) {
            setExpandedPaths(prev => {
              const set = new Set(prev)
              for (const p of ancestorsToExpand) set.add(p)
              return set.size === prev.length ? prev : [...set]
            })
          }
        } else if (result === false) {
          setPendingRename(null)
        }
        if (result !== false && typeof options?.refreshPath === 'string') {
          const refreshPaths = collectRefreshPaths(options.refreshPath)
          for (const refreshPath of refreshPaths) {
            void loadPath(refreshPath, true)
          }
        } else if (options?.refresh && result !== false) {
          refreshRoot()
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action failed'
        window.alert(message)
      } finally {
        setContextMenu(null)
      }
    },
    [loadPath, refreshRoot, setExpandedPaths],
  )

  const openContextMenu = useCallback(
    (event: React.MouseEvent, path: string, kind: ExplorerPathKind) => {
      event.preventDefault()
      event.stopPropagation()
      setPendingRename(null)
      if (kind === 'file') {
        setSelectedFilePath(path)
        setSelectedFolderPath(getParentPath(path))
      } else {
        setSelectedFolderPath(path)
      }
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        path,
        kind,
      })
    },
    [],
  )

  /* Long-press → context menu, primarily for iPad where there's no right-click.
     Pointer events let us cover touch + pen without breaking mouse behavior. */
  const longPressTimerRef = useRef<number | null>(null)
  const longPressTargetRef = useRef<{ path: string; kind: ExplorerPathKind; x: number; y: number } | null>(null)
  const longPressFiredRef = useRef(false)
  const suppressNextClickRef = useRef(false)

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressTargetRef.current = null
  }, [])

  useEffect(() => () => cancelLongPress(), [cancelLongPress])

  const handleRowPointerDown = useCallback(
    (event: React.PointerEvent, path: string, kind: ExplorerPathKind) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      longPressFiredRef.current = false
      longPressTargetRef.current = { path, kind, x: event.clientX, y: event.clientY }
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
      const startX = event.clientX
      const startY = event.clientY
      longPressTimerRef.current = window.setTimeout(() => {
        const target = longPressTargetRef.current
        if (!target) return
        longPressFiredRef.current = true
        suppressNextClickRef.current = true
        setPendingRename(null)
        if (target.kind === 'file') {
          setSelectedFilePath(target.path)
          setSelectedFolderPath(getParentPath(target.path))
        } else {
          setSelectedFolderPath(target.path)
        }
        setContextMenu({ x: startX, y: startY, path: target.path, kind: target.kind })
      }, 500)
    },
    [],
  )

  const handleRowPointerMove = useCallback((event: React.PointerEvent) => {
    const target = longPressTargetRef.current
    if (!target) return
    const dx = event.clientX - target.x
    const dy = event.clientY - target.y
    if (Math.hypot(dx, dy) > 10) cancelLongPress()
  }, [cancelLongPress])

  const handleRowClickCapture = useCallback((event: React.MouseEvent) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  useEffect(() => {
    if (!pendingRename) return
    const key = rowRefKey(pendingRename.kind, pendingRename.path)
    const node = rowRefs.current.get(key)
    if (!node) return
    // Auto-open the rename input immediately instead of just focusing the
    // button and waiting for the user to press Enter.
    const rafId = window.requestAnimationFrame(() => {
      beginInlineRename(pendingRename.path, pendingRename.kind)
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [nodes, pendingRename, rowRefKey, beginInlineRename])

  useEffect(() => {
    if (!inlineRenameSession) return
    const rafId = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
      renameJustOpenedRef.current = false
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [inlineRenameSession])


  const renderPath = useCallback(
    (path: string, depth: number): JSX.Element[] => {
      const node = getNode(path)
      const rows: JSX.Element[] = []

      const visibleFolders = node.folders.filter(folderName => {
        if (!normalizedQuery) return true
        const full = joinPath(path, folderName)
        if (pathMatchesSearch(full)) return true
        return pathMatchesQuery(full, new Set())
      })

      const visibleFiles = node.files.filter(fileName => {
        if (!normalizedQuery) return true
        return pathMatchesSearch(joinPath(path, fileName))
      })

      visibleFolders.forEach(folderName => {
        const folderPath = joinPath(path, folderName)
        const expanded = isExpanded(folderPath)
        const folderNode = getNode(folderPath)
        const isInlineEditing = inlineRename?.kind === 'folder' && inlineRename.path === folderPath
        const inSelectionTrail = selectedFolderPath === folderPath
          || (selectedFolderPath?.startsWith(`${folderPath}/`) ?? false)

        if (isInlineEditing) {
          rows.push(
            <div
              key={`folder-${folderPath}`}
              className={cn(
                'ltm-explorer-row ltm-explorer-folder-row flex w-full items-center gap-1 rounded-md border border-border/60 bg-muted/85 px-2 py-1.5 text-[13px] text-foreground',
                canDropOnRows && dropOverPath === folderPath && 'ring-2 ring-blue-500/60 bg-blue-500/5',
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              data-path={folderPath}
              data-selected={inSelectionTrail ? 'true' : undefined}
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform',
                  expanded && 'rotate-90',
                )}
              />
              {expanded ? (
                <FolderOpen className="ltm-explorer-glyph ltm-explorer-folder-icon h-3.5 w-3.5 text-foreground/85" />
              ) : (
                <Folder className="ltm-explorer-glyph ltm-explorer-folder-icon h-3.5 w-3.5 text-foreground/85" />
              )}
              <input
                ref={renameInputRef}
                autoFocus
                value={inlineRename.value}
                onChange={event => setInlineRename(prev => prev ? { ...prev, value: event.target.value } : prev)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (!renameJustOpenedRef.current) void commitInlineRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelInlineRename()
                  }
                }}
                onBlur={() => { void commitInlineRename() }}
                className="h-6 flex-1 appearance-none rounded border-0 bg-transparent px-1.5 text-xs shadow-none outline-none ring-0 focus:border-0 focus:bg-transparent focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                aria-label="Rename folder"
              />
            </div>,
          )
        } else {
          rows.push(
            <button
              key={`folder-${folderPath}`}
              type="button"
              draggable={canDragFolders}
              onDragStart={event => {
                if (!canDragFolders) return
                setPathDragDataBlock(event, folderPath, 'folder')
              }}
              onDragOver={canDropOnRows ? (event => {
                void handleDragOverTarget(event, folderPath)
              }) : undefined}
              onDragLeave={canDropOnRows ? (() => {
                setDropOverPath(prev => prev === folderPath ? null : prev)
              }) : undefined}
              onDrop={canDropOnRows ? (event => {
                void handleDropOnTarget(event, folderPath)
              }) : undefined}
              onKeyDown={event => {
                if (event.key === 'Enter' && selectedFolderPath === folderPath) {
                  event.preventDefault()
                  event.stopPropagation()
                  beginInlineRename(folderPath, 'folder')
                }
              }}
              onContextMenu={event => openContextMenu(event, folderPath, 'folder')}
              onPointerDown={event => handleRowPointerDown(event, folderPath, 'folder')}
              onPointerMove={handleRowPointerMove}
              onPointerUp={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onClickCapture={handleRowClickCapture}
              onClick={() => {
                setSelectedFolderPath(folderPath)
                setPendingRename(prev => (
                  prev?.kind === 'folder' && prev.path === folderPath ? prev : null
                ))
                toggleFolder(folderPath)
              }}
              ref={bindRowRef('folder', folderPath)}
              className={cn(
                'ltm-explorer-row ltm-explorer-folder-row ltm-touch-row group flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/90 transition-colors hover:bg-muted/70',
                inSelectionTrail && 'bg-[#e8eaee] text-foreground hover:bg-[#e8eaee] dark:bg-[#2a2d33] dark:text-foreground dark:hover:bg-[#2a2d33]',
                expanded && !inSelectionTrail && 'bg-muted/50',
                canDropOnRows && dropOverPath === folderPath && 'ring-2 ring-blue-500/60 bg-blue-500/5',
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              data-path={folderPath}
              data-selected={inSelectionTrail ? 'true' : undefined}
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform',
                  expanded && 'rotate-90',
                  inSelectionTrail && 'text-foreground/75',
                )}
              />
              {expanded ? (
                <FolderOpen className={cn('ltm-explorer-glyph ltm-explorer-folder-icon h-3.5 w-3.5 text-blue-500', inSelectionTrail && 'text-foreground/85')} />
              ) : (
                <Folder className={cn('ltm-explorer-glyph ltm-explorer-folder-icon h-3.5 w-3.5 text-blue-500', inSelectionTrail && 'text-foreground/85')} />
              )}
              <span className="truncate">{folderName}</span>
              {folderNode.loading && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </button>,
          )
        }

        if (expanded) {
          if (folderNode.error) {
            rows.push(
              <div
                key={`folder-error-${folderPath}`}
                className="px-2 py-1 text-xs text-destructive"
                style={{ paddingLeft: `${26 + depth * 14}px` }}
              >
                {folderNode.error}
              </div>,
            )
          }

          if (folderNode.loading && !folderNode.loaded) {
            rows.push(
              <div
                key={`folder-loading-${folderPath}`}
                className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
                style={{ paddingLeft: `${26 + depth * 14}px` }}
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </div>,
            )
          }

          if (folderNode.loaded) {
            rows.push(...renderPath(folderPath, depth + 1))
          }
        }
      })

      // Build a render plan that interleaves section headers, mapped files, and unmapped
      // files. When no _map.md is present, plan is a flat list of files — identical to the
      // pre-map behavior (Rule 2: degrade gracefully).
      type FilePlanRow =
        | { kind: 'header'; title: string; key: string }
        | {
            kind: 'file'
            name: string
            description?: string
            missing?: boolean
            unmapped?: boolean
            pinned?: boolean
            index?: number
          }

      const plan: FilePlanRow[] = []
      const map = node.map
      const visibleFileSet = new Set(visibleFiles)
      if (map) {
        // Pin _map.md at the top with a distinct visual (rule from spec: "pinning is
        // probably better than hiding — hiding things creates mystery").
        if (visibleFileSet.has(FOLDER_MAP_FILENAME)) {
          plan.push({ kind: 'file', name: FOLDER_MAP_FILENAME, pinned: true })
        }
        // Numbering restarts at 1 under each section heading.
        for (const section of map.sections) {
          const rendered = section.entries.filter(
            e => !e.missing && !e.duplicate && visibleFileSet.has(e.file),
          )
          if (rendered.length === 0) continue
          if (section.title) plan.push({ kind: 'header', title: section.title, key: `sec-${section.title}` })
          rendered.forEach((entry, idx) => {
            plan.push({
              kind: 'file',
              name: entry.file,
              description: entry.description || undefined,
              index: idx + 1,
            })
          })
        }
        const unmappedVisible = map.unmapped.filter(
          f => visibleFileSet.has(f) && f !== FOLDER_MAP_FILENAME,
        )
        if (unmappedVisible.length > 0) {
          plan.push({ kind: 'header', title: 'Unmapped', key: 'sec-unmapped' })
          for (const f of unmappedVisible) plan.push({ kind: 'file', name: f, unmapped: true })
        }
      } else {
        for (const f of visibleFiles) plan.push({ kind: 'file', name: f })
      }

      plan.forEach(row => {
        if (row.kind === 'header') {
          rows.push(
            <div
              key={`hdr-${path}-${row.key}`}
              className="ltm-explorer-row ltm-explorer-map-section-header px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80"
              style={{ paddingLeft: `${26 + depth * 14}px` }}
            >
              {row.title}
            </div>,
          )
          return
        }

        const fileName = row.name
        const filePath = joinPath(path, fileName)
        const Icon = row.pinned ? Info : getFileIcon(fileName)
        const isInlineEditing = inlineRename?.kind === 'file' && inlineRename.path === filePath
        const isSelected = selectedFilePath === filePath
        if (isInlineEditing) {
          rows.push(
            <div
              key={`file-${filePath}`}
              className={cn(
                'ltm-explorer-row ltm-explorer-file-row flex w-full items-center gap-2 rounded-md border border-[#c73773]/95 bg-[#c73773] px-2 py-1.5 text-[13px] text-white',
                canDropOnRows && dropOverPath === filePath && 'ring-2 ring-blue-500/60 bg-blue-500/10 dark:bg-blue-500/20',
              )}
              style={{ paddingLeft: `${26 + depth * 14}px` }}
              data-path={filePath}
              data-selected={isSelected ? 'true' : undefined}
            >
              <Icon className="ltm-explorer-glyph ltm-explorer-file-icon h-3.5 w-3.5 shrink-0 text-white" />
              <input
                ref={renameInputRef}
                autoFocus
                value={inlineRename.value}
                onChange={event => setInlineRename(prev => prev ? { ...prev, value: event.target.value } : prev)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (!renameJustOpenedRef.current) void commitInlineRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelInlineRename()
                  }
                }}
                onBlur={() => { void commitInlineRename() }}
                className="h-6 flex-1 appearance-none rounded border-0 bg-transparent px-1.5 text-xs text-white shadow-none outline-none ring-0 placeholder:text-white/70 focus:border-0 focus:bg-transparent focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                aria-label="Rename file"
              />
            </div>,
          )
        } else {
          rows.push(
            <ExplorerRowTooltip
              key={`file-${filePath}`}
              filePath={filePath}
              staticText={row.pinned ? PINNED_MAP_TOOLTIP : undefined}
              mapDescription={row.pinned ? undefined : (row.description ?? node.map?.descriptions[fileName])}
              resolveMeta={row.pinned ? undefined : resolveFileMeta}
            >
            <button
              type="button"
              draggable={canDragFiles}
              onDragStart={event => {
                if (!canDragFiles) return
                setPathDragDataBlock(event, filePath, 'file')
              }}
              onDragOver={canDropOnRows ? (event => {
                void handleDragOverTarget(event, filePath)
              }) : undefined}
              onDragLeave={canDropOnRows ? (() => {
                setDropOverPath(prev => prev === filePath ? null : prev)
              }) : undefined}
              onDrop={canDropOnRows ? (event => {
                void handleDropOnTarget(event, getParentPath(filePath), filePath)
              }) : undefined}
              onKeyDown={event => {
                if (event.key === 'Enter' && isSelected) {
                  event.preventDefault()
                  event.stopPropagation()
                  beginInlineRename(filePath, 'file')
                }
              }}
              onContextMenu={event => openContextMenu(event, filePath, 'file')}
              onPointerDown={event => handleRowPointerDown(event, filePath, 'file')}
              onPointerMove={handleRowPointerMove}
              onPointerUp={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onClickCapture={handleRowClickCapture}
              onClick={(event) => {
                setSelectedFilePath(filePath)
                setSelectedFolderPath(getParentPath(filePath))
                setPendingRename(prev => (
                  prev?.kind === 'file' && prev.path === filePath ? prev : null
                ))
                onSelectFile?.(filePath)
                if ((event.metaKey || event.ctrlKey) && onOpenInNewTab) {
                  void onOpenInNewTab(filePath)
                  return
                }
                onOpenFile(filePath)
              }}
              ref={bindRowRef('file', filePath)}
              className={cn(
                'ltm-explorer-row ltm-explorer-file-row ltm-touch-row group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-muted/70',
                isSelected && 'border border-[#c73773]/95 bg-[#c73773] text-white hover:bg-[#c73773]',
                canDropOnRows && dropOverPath === filePath && 'ring-2 ring-blue-500/60 bg-blue-500/5',
                row.unmapped && !isSelected && 'opacity-60',
                row.pinned && !isSelected && 'text-foreground/95',
              )}
              style={{ paddingLeft: `${26 + depth * 14}px` }}
              data-path={filePath}
              data-selected={isSelected ? 'true' : undefined}
              data-map-unmapped={row.unmapped ? 'true' : undefined}
              data-map-pinned={row.pinned ? 'true' : undefined}
            >
              {row.index != null ? (
                <span
                  className={cn(
                    'ltm-explorer-file-index inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] px-[3px] text-[9px] font-semibold leading-none tabular-nums',
                    isSelected
                      ? 'bg-white/20 text-white'
                      : 'bg-foreground/15 text-foreground/80',
                  )}
                >
                  {row.index}
                </span>
              ) : (
                <Icon className={cn(
                  'ltm-explorer-glyph ltm-explorer-file-icon h-3.5 w-3.5 shrink-0',
                  row.pinned && !isSelected ? 'text-amber-500' : getFileIconColor(fileName, isSelected),
                )} />
              )}
              <span className="truncate">{fileName}</span>
            </button>
            </ExplorerRowTooltip>,
          )
        }
      })

      return rows
    },
    [
      beginInlineRename,
      bindRowRef,
      canDragFiles,
      canDragFolders,
      canDropOnRows,
      cancelInlineRename,
      commitInlineRename,
      dropOverPath,
      getNode,
      handleDragOverTarget,
      handleDropOnTarget,
      inlineRename,
      isExpanded,
      normalizedQuery,
      onOpenFile,
      onOpenInNewTab,
      onSelectFile,
      openContextMenu,
      pathMatchesSearch,
      pathMatchesQuery,
      pendingRename,
      resolveFileMeta,
      selectedFilePath,
      selectedFolderPath,
      toggleFolder,
    ],
  )

  const rootNode = getNode('')

  const treeContent = useMemo(() => {
    if (rootNode.loading && !rootNode.loaded) {
      return (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading vault...
        </div>
      )
    }

    const rows = renderPath('', 0)
    if (rows.length === 0) {
      return (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          {normalizedQuery ? 'No matching files or folders.' : 'Vault appears to be empty.'}
        </div>
      )
    }

    return rows
  }, [normalizedQuery, renderPath, rootNode.loaded, rootNode.loading])

  const notebookContent = useMemo(() => {
    if (viewMode === 'tree') return null
    if (filteredNotebookEntries.length === 0) {
      return (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          {normalizedQuery
            ? 'No matching files in the expanded folders.'
            : 'Expand one or more folders to use notebook list or grid view.'}
        </div>
      )
    }

    return (
      <NotebookTocBlock
        entries={filteredNotebookEntries}
        activeEntryPath={selectedFilePath ?? selectedFolderPath}
        activePagePath={activeFilePath}
        onScrollToPage={() => {}}
        onSelectPage={handleNotebookSelectPage}
        onSelectFolder={handleNotebookSelectFolder}
        onToggleFolder={toggleFolder}
        onOpenFile={onOpenFile}
        onReorderFiles={handleNotebookReorderFiles}
        viewMode={viewMode}
        onViewModeChange={() => {}}
        totalPages={countNotebookPages(filteredNotebookEntries)}
        showHeader={false}
        onEntryContextMenu={handleNotebookEntryContextMenu}
        onEntryContextMenuRequest={handleNotebookEntryContextMenuRequest}
      />
    )
  }, [
    activeFilePath,
    filteredNotebookEntries,
    handleNotebookEntryContextMenu,
    handleNotebookEntryContextMenuRequest,
    handleNotebookReorderFiles,
    handleNotebookSelectPage,
    handleNotebookSelectFolder,
    normalizedQuery,
    onOpenFile,
    selectedFilePath,
    selectedFolderPath,
    toggleFolder,
    viewMode,
  ])


  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="ltm-vault-explorer-search-wrap px-3 py-2">
        {hasTitle && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </div>
          </div>
        )}

        <div className="flex w-full items-center">
          <UniversalSearchBlock
            {...UNIVERSAL_SEARCH_INLINE_FILTER_PRESET_BLOCK}
            items={[]}
            query={query}
            onQueryChange={setQuery}
            onSelect={() => {}}
            getItemKey={(value) => value}
            getItemLabel={(value) => value}
            placeholder="Filter files..."
            className="w-full"
          />
        </div>

        <div className="mt-2 flex items-center gap-1 px-1">
          {(() => {
            const parentPath = selectedFolderPath ?? (selectedFilePath ? getParentPath(selectedFilePath) : '')
            const ToolbarBtn = ({
              icon: Icon,
              label,
              onClick,
              disabled = false,
              active = false,
            }: {
              icon: ComponentType<{ className?: string }>
              label: string
              onClick: () => void
              disabled?: boolean
              active?: boolean
            }) => (
              <button
                type="button"
                title={label}
                disabled={disabled}
                onClick={onClick}
                className={cn(
                  'ltm-touch-target flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
                  !disabled && !active && 'hover:bg-muted hover:text-foreground',
                  !disabled && active && 'bg-muted text-foreground',
                  disabled && 'cursor-not-allowed opacity-40',
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            )
            return (
              <>
                <ToolbarBtn
                  icon={FolderPlus}
                  label="New Folder"
                  disabled={!onCreateFolder}
                  onClick={() => { void runContextAction(onCreateFolder ? () => onCreateFolder(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'folder' }) }}
                />
                <ToolbarBtn
                  icon={FilePlus}
                  label="New File"
                  disabled={!onCreateFile}
                  onClick={() => { void runContextAction(onCreateFile ? () => onCreateFile(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) }}
                />
                <ToolbarBtn
                  icon={Link}
                  label="Add Link Here"
                  disabled={!onCreateLink}
                  onClick={() => { void runContextAction(onCreateLink ? () => onCreateLink(parentPath) : undefined, { refreshPath: parentPath }) }}
                />
                <ToolbarBtn
                  icon={ExcalidrawIcon}
                  label="New Drawing"
                  disabled={!onCreateDrawing}
                  onClick={() => { void runContextAction(onCreateDrawing ? () => onCreateDrawing(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) }}
                />
                <div className="ml-auto flex items-center gap-1">
                  <Select value={viewMode} onValueChange={(value) => setViewMode(value as ExplorerViewModeBlock)}>
                    <SelectTrigger
                      className="h-8 w-auto min-w-0 gap-2 rounded-md border-0 bg-background/80 px-2 pr-1.5 text-xs font-normal text-muted-foreground shadow-none ring-0 focus:ring-0 focus:ring-offset-0 hover:text-foreground data-[state=open]:text-foreground [&>svg]:text-muted-foreground hover:[&>svg]:text-foreground data-[state=open]:[&>svg]:text-foreground"
                      title="Explorer view"
                    >
                      <SelectValue aria-label={viewMode}>
                        {viewMode === 'tree' ? 'Tree view' : viewMode === 'list' ? 'Numbered list' : 'Grid view'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tree">Tree view</SelectItem>
                      <SelectItem value="list">Numbered list</SelectItem>
                      <SelectItem value="grid">Grid view</SelectItem>
                    </SelectContent>
                  </Select>
                  <ToolbarBtn
                    icon={Info}
                    label="File info"
                    disabled={!loadFileTags || !activeFilePath}
                    active={showInfoPanel}
                    onClick={() => setShowInfoPanel(prev => !prev)}
                  />
                </div>
              </>
            )
          })()}
        </div>

        {showInfoPanel && loadFileTags && activeFilePath && (
          <div className="mt-1.5 min-h-[24px] rounded-md border border-border/60 bg-muted/40 px-2 py-1.5">
            {infoPanelLoading ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading tags…</span>
              </div>
            ) : (
              <TagChipListBlock
                tags={infoPanelTags ?? []}
                variant="solid"
                emptyMessage="No tags"
                keyPrefix={`explorer-info-${activeFilePath}`}
              />
            )}
          </div>
        )}

        {belowToolbarSlot ? (
          <div className="mt-2 px-1">
            {belowToolbarSlot}
          </div>
        ) : null}
      </div>


      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto px-1.5 py-2',
          viewMode !== 'tree' && 'px-0 py-0',
          canDropOnRows && dropOverPath === '' && 'ring-2 ring-blue-500/60 bg-blue-500/5',
        )}
        onDragOver={canDropOnRows ? (event) => {
          void handleDragOverTarget(event, '')
        } : undefined}
        onDragLeave={canDropOnRows ? (() => {
          setDropOverPath(prev => prev === '' ? null : prev)
        }) : undefined}
        onDrop={canDropOnRows ? (event) => {
          void handleDropOnTarget(event, '')
        } : undefined}
      >
        {viewMode === 'tree' ? treeContent : notebookContent}
      </div>
      {contextMenu && (() => {
        const parentPath = contextMenu.kind === 'folder' ? contextMenu.path : getParentPath(contextMenu.path)
        const filePath = contextMenu.path
        const showFileActions = contextMenu.kind === 'file'
        const canOpenFileAsRuledNotebook = filePath.toLowerCase().endsWith('.md') && !isExcalidrawPathBlock(filePath)
        const entries: ContextMenuEntryBlock[] = [
          { key: 'new-folder', label: 'New Folder', disabled: !onCreateFolder, onClick: () => { void runContextAction(onCreateFolder ? () => onCreateFolder(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'folder' }) } },
          { key: 'new-file', label: 'New File', disabled: !onCreateFile, onClick: () => { void runContextAction(onCreateFile ? () => onCreateFile(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) } },
          { key: 'new-csv', label: 'New CSV File', disabled: !onCreateCsvFile, onClick: () => { void runContextAction(onCreateCsvFile ? () => onCreateCsvFile(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) } },
          { key: 'new-drawing', label: 'New Drawing', disabled: !onCreateDrawing, onClick: () => { void runContextAction(onCreateDrawing ? () => onCreateDrawing(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) } },
          { key: 'add-link', label: 'Add Link Here', disabled: !onCreateLink, onClick: () => { void runContextAction(onCreateLink ? () => onCreateLink(parentPath) : undefined, { refreshPath: parentPath }) } },
          { key: 'copy-abs', label: 'Copy Absolute Path', disabled: !onCopyAbsolutePath, onClick: () => { void runContextAction(onCopyAbsolutePath ? () => onCopyAbsolutePath(filePath) : undefined) } },
          { key: 'copy-rel', label: 'Copy Relative Path', disabled: !onCopyRelativePath, onClick: () => { void runContextAction(onCopyRelativePath ? () => onCopyRelativePath(filePath) : undefined) } },
          { key: 'rename', label: 'Rename', disabled: !onRenamePath, onClick: () => { beginInlineRename(filePath, contextMenu.kind) } },
          ...(showFileActions ? [
            { key: 'sep1', kind: 'separator' as const },
            { key: 'open-tab', label: 'Open in New Tab', disabled: !onOpenInNewTab, onClick: () => { void runContextAction(onOpenInNewTab ? () => onOpenInNewTab(filePath) : undefined) } },
            { key: 'open-win', label: 'Open in New Window', disabled: !onOpenInNewWindow, onClick: () => { void runContextAction(onOpenInNewWindow ? () => onOpenInNewWindow(filePath) : undefined) } },
            { key: 'open-ruled-notebook', label: 'Open This Page as Ruled Notebook', disabled: !onOpenFileAsRuledNotebook || !canOpenFileAsRuledNotebook, onClick: () => { if (onOpenFileAsRuledNotebook && canOpenFileAsRuledNotebook) onOpenFileAsRuledNotebook(filePath) } },
            { key: 'duplicate', label: 'Duplicate', disabled: !onDuplicateFile, onClick: () => { void runContextAction(onDuplicateFile ? () => onDuplicateFile(filePath) : undefined, { refreshPath: parentPath }) } },
            { key: 'delete-file', label: 'Delete', disabled: !onDeleteFile, destructive: true, onClick: () => { void runContextAction(onDeleteFile ? () => onDeleteFile(filePath) : undefined, { refreshPath: parentPath }) } },
            { key: 'finder-file', label: 'Open in Finder', disabled: !onOpenInFinder, onClick: () => { void runContextAction(onOpenInFinder ? () => onOpenInFinder(filePath) : undefined) } },
          ] : [
            { key: 'sep1', kind: 'separator' as const },
            { key: 'open-notebook', label: 'Open as Notebook', disabled: !onOpenFolderAsNotebook, onClick: () => { if (onOpenFolderAsNotebook) onOpenFolderAsNotebook(filePath) } },
            { key: 'delete-folder', label: 'Delete Folder', disabled: !onDeleteFolder, destructive: true, onClick: () => { void runContextAction(onDeleteFolder ? () => onDeleteFolder(filePath) : undefined, { refreshPath: getParentPath(filePath) }) } },
            { key: 'finder-folder', label: 'Open in Finder', disabled: !onOpenInFinder, onClick: () => { void runContextAction(onOpenInFinder ? () => onOpenInFinder(filePath) : undefined) } },
          ]),
        ]
        return (
          <ContextMenuBlock
            entries={entries}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu(null)}
          />
        )
      })()}
    </div>
  )
}
