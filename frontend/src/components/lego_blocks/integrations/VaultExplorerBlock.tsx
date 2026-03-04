import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
} from 'lucide-react'
import UniversalSearchBlock from '@/components/lego_blocks/integrations/UniversalSearchBlock'
import {
  buildPathSearchCandidatesBlock,
  UNIVERSAL_SEARCH_INLINE_FILTER_PRESET_BLOCK,
} from '@/components/lego_blocks/integrations/universalSearchPresetBlock'
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
import { getSpaceStorageKeyBlock } from '@/services/orchestrators/storageOrch'
import { cn } from '@/lib/utils'

interface FolderEntries {
  folders: string[]
  files: string[]
}

interface NodeState extends FolderEntries {
  loaded: boolean
  loading: boolean
  error: string | null
}

type ExplorerPathKind = 'file' | 'folder'
type ExplorerActionResult = void | boolean | string | Promise<void | boolean | string>

interface ContextMenuState {
  x: number
  y: number
  path: string
  kind: ExplorerPathKind
}

interface PendingRenameState {
  path: string
  kind: ExplorerPathKind
}

interface InlineRenameState {
  path: string
  kind: ExplorerPathKind
  value: string
}

interface VaultExplorerBlockProps {
  loadEntries: (path: string) => Promise<FolderEntries>
  onOpenFile: (path: string) => void
  onCreateFolder?: (parentPath: string) => ExplorerActionResult
  onCreateFile?: (parentPath: string) => ExplorerActionResult
  onCreateCsvFile?: (parentPath: string) => ExplorerActionResult
  onCreateDrawing?: (parentPath: string) => ExplorerActionResult
  onCopyAbsolutePath?: (path: string) => ExplorerActionResult
  onCopyRelativePath?: (path: string) => ExplorerActionResult
  onOpenInNewTab?: (path: string) => ExplorerActionResult
  onOpenInNewWindow?: (path: string) => ExplorerActionResult
  onDuplicateFile?: (path: string) => ExplorerActionResult
  onRenamePath?: (path: string, kind: ExplorerPathKind, nextName: string) => ExplorerActionResult
  onDeleteFile?: (path: string) => ExplorerActionResult
  onDeleteFolder?: (path: string) => ExplorerActionResult
  onOpenInFinder?: (path: string) => ExplorerActionResult
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
}

function getFileIcon(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.md')) return FileText
  return File
}

function remapPathAfterMove(path: string, sourcePath: string, targetPath: string): string {
  if (path === sourcePath) return targetPath
  if (!path.startsWith(`${sourcePath}/`)) return path
  const suffix = path.slice(sourcePath.length + 1)
  return suffix ? `${targetPath}/${suffix}` : targetPath
}

export default function VaultExplorerBlock({
  loadEntries,
  onOpenFile,
  onCreateFolder,
  onCreateFile,
  onCreateCsvFile,
  onCreateDrawing,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onOpenInNewTab,
  onOpenInNewWindow,
  onDuplicateFile,
  onRenamePath,
  onDeleteFile,
  onDeleteFolder,
  onOpenInFinder,
  selectedPath = null,
  onSelectFile,
  onDropNode,
  onMovePath,
  draggableFiles = false,
  draggableFolders = false,
  title = 'Thinking Space Explorer',
  persistenceKey = 'global',
  listenToGlobalSyncRefresh = false,
  className,
}: VaultExplorerBlockProps) {
  const storageKey = getSpaceStorageKeyBlock(`${EXPLORER_PERSISTENCE_PREFIX}:${persistenceKey}`)
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
  const [query, setQuery] = useState('')
  const [dropOverPath, setDropOverPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [pendingRename, setPendingRename] = useState<PendingRenameState | null>(null)
  const [inlineRename, setInlineRename] = useState<InlineRenameState | null>(null)
  const iPhoneHandset = useMemo(
    () => typeof navigator !== 'undefined' && /iPhone/i.test(navigator.userAgent || ''),
    [],
  )
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameSubmittingRef = useRef(false)
  const queryMatchCacheRef = useRef<Map<string, boolean>>(new Map())

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
            loaded: false,
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
      }
      window.localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      // Ignore persistence failures; explorer should still work in-memory.
    }
  }, [expandedPaths, selectedFilePath, selectedFolderPath, storageKey])

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
      refreshRoot()
    })
  }, [listenToGlobalSyncRefresh, refreshRoot])

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

        const pathsToRefresh = new Set<string>(['', sourceParentPath, moveTargetFolderPath])
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
    if (row) {
      window.requestAnimationFrame(() => row.focus())
    }
  }, [inlineRename, rowRefKey])

  const commitInlineRename = useCallback(async () => {
    if (!inlineRename || renameSubmittingRef.current) return
    const currentPath = inlineRename.path
    const currentKind = inlineRename.kind
    const trimmed = inlineRename.value.trim()
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
  }, [cancelInlineRename, inlineRename, loadPath, onRenamePath])

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
        } else if (result === false) {
          setPendingRename(null)
        }
        if (result !== false && typeof options?.refreshPath === 'string') {
          void loadPath(options.refreshPath, true)
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
    [loadPath, refreshRoot],
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

  useEffect(() => {
    if (!pendingRename) return
    const key = rowRefKey(pendingRename.kind, pendingRename.path)
    const node = rowRefs.current.get(key)
    if (!node) return
    const rafId = window.requestAnimationFrame(() => node.focus())
    return () => window.cancelAnimationFrame(rafId)
  }, [nodes, pendingRename, rowRefKey])

  useEffect(() => {
    if (!inlineRenameSession) return
    const rafId = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [inlineRenameSession])

  useEffect(() => {
    if (!contextMenu) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        setContextMenu(null)
        return
      }
      if (!contextMenuRef.current?.contains(target)) {
        setContextMenu(null)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }

    const onScroll = () => setContextMenu(null)

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [contextMenu])

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
                value={inlineRename.value}
                onChange={event => setInlineRename(prev => prev ? { ...prev, value: event.target.value } : prev)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitInlineRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelInlineRename()
                  }
                }}
                onBlur={() => { void commitInlineRename() }}
                className="h-6 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:border-ring"
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
                event.dataTransfer.setData('application/x-ltm-path', `ltm-path:${folderPath}`)
                event.dataTransfer.setData('application/x-ltm-path-kind', 'folder')
                event.dataTransfer.setData('text/ltm-file-path', folderPath)
                event.dataTransfer.setData('text/plain', folderPath)
                event.dataTransfer.effectAllowed = 'move'
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
                inSelectionTrail && 'border border-border/60 bg-muted/85 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_8px_-6px_rgba(0,0,0,0.35)] hover:bg-muted/90',
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

      visibleFiles.forEach(fileName => {
        const filePath = joinPath(path, fileName)
        const Icon = getFileIcon(fileName)
        const isInlineEditing = inlineRename?.kind === 'file' && inlineRename.path === filePath

        if (isInlineEditing) {
          rows.push(
            <div
              key={`file-${filePath}`}
              className={cn(
                'ltm-explorer-row ltm-explorer-file-row flex w-full items-center gap-2 rounded-md border border-[#c73773]/95 bg-[#c73773] px-2 py-1.5 text-[13px] text-white',
                canDropOnRows && dropOverPath === filePath && 'ring-2 ring-blue-500/60 bg-blue-500/10',
              )}
              style={{ paddingLeft: `${26 + depth * 14}px` }}
              data-path={filePath}
              data-selected={selectedFilePath === filePath ? 'true' : undefined}
            >
              <Icon className="ltm-explorer-glyph ltm-explorer-file-icon h-3.5 w-3.5 shrink-0 text-white" />
              <input
                ref={renameInputRef}
                value={inlineRename.value}
                onChange={event => setInlineRename(prev => prev ? { ...prev, value: event.target.value } : prev)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitInlineRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelInlineRename()
                  }
                }}
                onBlur={() => { void commitInlineRename() }}
                className="h-6 flex-1 rounded border border-white/45 bg-black/20 px-1.5 text-xs text-white outline-none placeholder:text-white/70 focus:border-white"
                aria-label="Rename file"
              />
            </div>,
          )
        } else {
          rows.push(
            <button
              key={`file-${filePath}`}
              type="button"
              draggable={canDragFiles}
              onDragStart={event => {
                if (!canDragFiles) return
                event.dataTransfer.setData('application/x-ltm-path', `ltm-path:${filePath}`)
                event.dataTransfer.setData('application/x-ltm-path-kind', 'file')
                event.dataTransfer.setData('text/ltm-file-path', filePath)
                event.dataTransfer.setData('text/plain', filePath)
                event.dataTransfer.effectAllowed = 'move'
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
                if (event.key === 'Enter' && selectedFilePath === filePath) {
                  event.preventDefault()
                  event.stopPropagation()
                  beginInlineRename(filePath, 'file')
                }
              }}
              onContextMenu={event => openContextMenu(event, filePath, 'file')}
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
                selectedFilePath === filePath && 'border border-[#c73773]/95 bg-[#c73773] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_2px_8px_-6px_rgba(0,0,0,0.45)] hover:bg-[#c73773]',
                canDropOnRows && dropOverPath === filePath && 'ring-2 ring-blue-500/60 bg-blue-500/5',
              )}
              style={{ paddingLeft: `${26 + depth * 14}px` }}
              data-path={filePath}
              data-selected={selectedFilePath === filePath ? 'true' : undefined}
            >
              <Icon className={cn('ltm-explorer-glyph ltm-explorer-file-icon h-3.5 w-3.5 shrink-0 text-muted-foreground', selectedFilePath === filePath && 'text-white')} />
              <span className="truncate">{fileName}</span>
            </button>,
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
      selectedFilePath,
      selectedFolderPath,
      toggleFolder,
    ],
  )

  const rootNode = getNode('')

  const content = useMemo(() => {
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

  const contextMenuStyle = useMemo(() => {
    if (!contextMenu) return undefined
    const menuWidth = 228
    const menuHeight = contextMenu.kind === 'file'
      ? 452
      : onDeleteFolder
        ? 342
        : 304
    const maxX = Math.max(8, window.innerWidth - menuWidth - 8)
    const maxY = Math.max(8, window.innerHeight - menuHeight - 8)
    return {
      left: `${Math.min(contextMenu.x, maxX)}px`,
      top: `${Math.min(contextMenu.y, maxY)}px`,
    }
  }, [contextMenu, onDeleteFolder])

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
      </div>

      {iPhoneHandset && (onCreateFile || onCreateFolder) && (
        <div className="flex items-center gap-2 px-3 pb-2">
          {onCreateFile && (
            <button
              type="button"
              className="ltm-touch-target inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground"
              onClick={() => {
                const parentPath = selectedFolderPath ?? (selectedFilePath ? getParentPath(selectedFilePath) : '')
                void runContextAction(() => onCreateFile(parentPath), {
                  refreshPath: parentPath,
                  armRenameOnEnterKind: 'file',
                })
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Note
            </button>
          )}
          {onCreateFolder && (
            <button
              type="button"
              className="ltm-touch-target inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground"
              onClick={() => {
                const parentPath = selectedFolderPath ?? (selectedFilePath ? getParentPath(selectedFilePath) : '')
                void runContextAction(() => onCreateFolder(parentPath), {
                  refreshPath: parentPath,
                  armRenameOnEnterKind: 'folder',
                })
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Folder
            </button>
          )}
        </div>
      )}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto px-1.5 py-2',
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
        {content}
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[90] min-w-[220px] rounded-lg border border-border bg-background/95 p-1 shadow-2xl backdrop-blur-sm"
          style={contextMenuStyle}
          role="menu"
        >
          {(() => {
            const parentPath = contextMenu.kind === 'folder' ? contextMenu.path : getParentPath(contextMenu.path)
            const filePath = contextMenu.path
            const showFileActions = contextMenu.kind === 'file'

            const MenuItem = ({
              label,
              onClick,
              disabled = false,
              destructive = false,
            }: {
              label: string
              onClick: () => void
              disabled?: boolean
              destructive?: boolean
            }) => (
              <button
                type="button"
                className={cn(
                  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs',
                  disabled && 'cursor-not-allowed opacity-50',
                  !disabled && !destructive && 'text-foreground hover:bg-muted',
                  !disabled && destructive && 'text-destructive hover:bg-destructive/10',
                )}
                onClick={onClick}
                disabled={disabled}
                role="menuitem"
              >
                {label}
              </button>
            )

            return (
              <>
                <MenuItem
                  label="New Folder"
                  onClick={() => { void runContextAction(onCreateFolder ? () => onCreateFolder(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'folder' }) }}
                  disabled={!onCreateFolder}
                />
                <MenuItem
                  label="New File"
                  onClick={() => { void runContextAction(onCreateFile ? () => onCreateFile(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) }}
                  disabled={!onCreateFile}
                />
                <MenuItem
                  label="New CSV File"
                  onClick={() => { void runContextAction(onCreateCsvFile ? () => onCreateCsvFile(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) }}
                  disabled={!onCreateCsvFile}
                />
                <MenuItem
                  label="New Drawing"
                  onClick={() => { void runContextAction(onCreateDrawing ? () => onCreateDrawing(parentPath) : undefined, { refreshPath: parentPath, armRenameOnEnterKind: 'file' }) }}
                  disabled={!onCreateDrawing}
                />
                <MenuItem
                  label="Copy Absolute Path"
                  onClick={() => { void runContextAction(onCopyAbsolutePath ? () => onCopyAbsolutePath(filePath) : undefined) }}
                  disabled={!onCopyAbsolutePath}
                />
                <MenuItem
                  label="Copy Relative Path"
                  onClick={() => { void runContextAction(onCopyRelativePath ? () => onCopyRelativePath(filePath) : undefined) }}
                  disabled={!onCopyRelativePath}
                />
                <MenuItem
                  label="Rename"
                  onClick={() => {
                    setContextMenu(null)
                    beginInlineRename(filePath, contextMenu.kind)
                  }}
                  disabled={!onRenamePath}
                />
                {!showFileActions && (
                  <>
                    <div className="my-1 border-t border-border/70" />
                    <MenuItem
                      label="Delete Folder"
                      onClick={() => { void runContextAction(onDeleteFolder ? () => onDeleteFolder(filePath) : undefined, { refreshPath: parentPath }) }}
                      disabled={!onDeleteFolder}
                      destructive
                    />
                    <MenuItem
                      label="Open in Finder"
                      onClick={() => { void runContextAction(onOpenInFinder ? () => onOpenInFinder(filePath) : undefined) }}
                      disabled={!onOpenInFinder}
                    />
                  </>
                )}
                {showFileActions && (
                  <>
                    <div className="my-1 border-t border-border/70" />
                    <MenuItem
                      label="Open in New Tab"
                      onClick={() => { void runContextAction(onOpenInNewTab ? () => onOpenInNewTab(filePath) : undefined) }}
                      disabled={!onOpenInNewTab}
                    />
                    <MenuItem
                      label="Open in New Window"
                      onClick={() => { void runContextAction(onOpenInNewWindow ? () => onOpenInNewWindow(filePath) : undefined) }}
                      disabled={!onOpenInNewWindow}
                    />
                    <MenuItem
                      label="Duplicate"
                      onClick={() => { void runContextAction(onDuplicateFile ? () => onDuplicateFile(filePath) : undefined, { refreshPath: parentPath }) }}
                      disabled={!onDuplicateFile}
                    />
                    <MenuItem
                      label="Delete"
                      onClick={() => { void runContextAction(onDeleteFile ? () => onDeleteFile(filePath) : undefined, { refreshPath: parentPath }) }}
                      disabled={!onDeleteFile}
                      destructive
                    />
                    <MenuItem
                      label="Open in Finder"
                      onClick={() => { void runContextAction(onOpenInFinder ? () => onOpenInFinder(filePath) : undefined) }}
                      disabled={!onOpenInFinder}
                    />
                  </>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
