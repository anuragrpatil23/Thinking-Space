import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { BacklogNodeRowBlock } from '@/components/lego_blocks/units/BacklogNodeRowBlock'
import { BacklogProgramRowBlock } from '@/components/lego_blocks/units/BacklogProgramRowBlock'
import { scaledWidthStyleFromClassBlock, type BacklogRowColumnBlock } from '@/components/lego_blocks/units/BacklogRowColumnsBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { BacklogInlineCreateBlock } from '@/components/lego_blocks/integrations/BacklogInlineCreateBlock'
import { BacklogInlineNotesEditorBlock } from '@/components/lego_blocks/integrations/BacklogInlineNotesEditorBlock'
import { ProgramGroupHeaderBlock } from '@/components/lego_blocks/integrations/ProgramGroupHeaderBlock'
import EpicTimelineStripBlock from '@/components/lego_blocks/units/EpicTimelineStripBlock'
import LinkedItemChipsBlock from '@/components/lego_blocks/units/LinkedItemChipsBlock'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import { tagLookupKeyBlock } from '@/services/lego_blocks/units/tagBlock'
import { cn } from '@/lib/utils'
import type { NodeStatus, NodeType, YAMLCommentEntry } from '@/services/lego_blocks/units/yamlNoteBlock'
import {
  allowedCreateTypes,
  type ChildStateBlock,
  compactTagList,
  copyTextToClipboard,
  EPIC_BORDER_PALETTE,
  EPIC_ICON_COLOR_BY_BORDER,
  getTaskStatusBadge,
  iconColorForNodeType,
  isTaskNode,
  NEW_ROW_HIGHLIGHT_MS,
  normalizePath,
  nodeDisplayTitle,
  ROOT_INPUT_KEY,
  selectedPresetTagsForNode,
  sortNodesForDisplay,
  type TaskStatusOption,
} from '@/components/lego_blocks/units/BacklogListDomainBlock'
import { useBacklogDragAndReorderBlock } from '@/components/lego_blocks/hooks/integrations/useBacklogDragAndReorderBlock'
import { useBacklogInlineNotesBlock } from '@/components/lego_blocks/hooks/integrations/useBacklogInlineNotesBlock'

interface ProgramGroupEntryBlock {
  id: string
  name: string
  collapsed?: boolean
}

interface BacklogRelatedNodeOptionBlock {
  path: string
  label: string
  summary?: string
}

interface PersistedBacklogListStateBlock {
  childrenByNode: Record<string, ChildStateBlock>
  expandedNodes: Record<string, boolean>
}

const BACKLOG_LIST_PERSISTENCE_PREFIX = 'ltm-backlog-list'

function readPersistedBacklogListStateBlock(storageKey: string): PersistedBacklogListStateBlock {
  if (!storageKey || typeof window === 'undefined') {
    return { childrenByNode: {}, expandedNodes: {} }
  }
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return { childrenByNode: {}, expandedNodes: {} }
    const parsed = JSON.parse(raw) as Partial<PersistedBacklogListStateBlock> | null
    return {
      childrenByNode: parsed?.childrenByNode && typeof parsed.childrenByNode === 'object' ? parsed.childrenByNode : {},
      expandedNodes: parsed?.expandedNodes && typeof parsed.expandedNodes === 'object' ? parsed.expandedNodes : {},
    }
  } catch {
    return { childrenByNode: {}, expandedNodes: {} }
  }
}

function writePersistedBacklogListStateBlock(
  storageKey: string,
  state: PersistedBacklogListStateBlock,
): void {
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    // Ignore session persistence failures; in-memory state still works.
  }
}

function normalizeRelatedNodePathsBlock(paths: string[] | undefined): string[] {
  if (!paths || paths.length === 0) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const path of paths) {
    const next = normalizePath(path)
    if (!next || seen.has(next)) continue
    seen.add(next)
    normalized.push(next)
  }
  return normalized
}

function fileNameFromPathBlock(path: string): string {
  const normalized = normalizePath(path)
  const base = normalized.split('/').pop() || normalized
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base
}

function toSentenceCaseLabelBlock(value: string, fallback: string): string {
  const trimmed = value.trim()
  return trimmed || fallback
}

function toTitleCaseLabelBlock(value: string, fallback: string): string {
  const next = toSentenceCaseLabelBlock(value, fallback)
  return next.charAt(0).toUpperCase() + next.slice(1)
}

export interface BacklogListBlockProps {
  programs: NodeRecord[]
  loadEpics: (program: NodeRecord) => Promise<NodeRecord[]>
  loadChildren: (node: NodeRecord) => Promise<NodeRecord[]>
  treeRevision?: number
  externallyUpdatedNode?: NodeRecord | null
  selectedNodeId: string | null
  readOnly?: boolean
  onSelectNode: (node: NodeRecord) => void
  onCreateChild?: (
    parent: NodeRecord | null,
    title: string,
    requestedType?: NodeType,
    details?: {
      description?: string
      comment?: string
    },
  ) => Promise<NodeRecord>
  onDropNodeToNode?: (sourceUuid: string, target: NodeRecord) => Promise<void>
  onReorderSiblings?: (params: { parentKey: string | null; orderedNodes: NodeRecord[] }) => Promise<NodeRecord[] | void>
  // Optional: resolve a per-row 1-based ordinal for display + the sort-order input.
  // Return null to fully suppress ordinal + reorder control on that row.
  // Return undefined to fall back to the default (row position in `programs`).
  resolveProgramOrdinal?: (program: NodeRecord, defaultOrdinal: number) => number | null | undefined
  // Optional: when set, called instead of the built-in program-index reorder when
  // the sort-order input changes. Consumers receive the 1-based value the user
  // typed, so they can translate it to whatever domain-level ordering they own
  // (e.g. company rank vs. flat program index).
  onSetProgramOrdinal?: (program: NodeRecord, nextOrdinal: number) => void | Promise<void>
  projectPresetTagsByRoot?: Record<string, string[]>
  projectTagColorsByRoot?: Record<string, Record<string, string>>
  programGroups?: ProgramGroupEntryBlock[]
  programGroupIdByProgram?: Record<string, string>
  onCreateProgramGroup?: (name: string) => void
  onDeleteProgramGroup?: (groupId: string) => void
  onToggleProgramGroupCollapsed?: (groupId: string) => void
  onAssignProgramToGroup?: (program: NodeRecord, groupId: string | null) => void
  onUpdateNodeStatus?: (node: NodeRecord, status: NodeStatus) => Promise<NodeRecord | void>
  onUpdateTaskStatus?: (node: NodeRecord, taskStatus: TaskStatusOption) => Promise<NodeRecord | void>
  onUpdateNodeNotes?: (node: NodeRecord, description: string, comments: YAMLCommentEntry[]) => Promise<NodeRecord | void>
  relatedNodeOptions?: BacklogRelatedNodeOptionBlock[]
  onOpenRelatedNode?: (path: string) => void
  onOpenNodeDetails?: (node: NodeRecord) => void
  canOpenNodeDetails?: (node: NodeRecord) => boolean
  rowColumns?: BacklogRowColumnBlock[]
  showRowColumnsOnCompact?: boolean
  rowPresetTagLimit?: number
  rowPresetTagsClassName?: string
  reserveTagsSlotWhenEmpty?: boolean
  linksColumnLabel?: string
  linksColumnWidthClassName?: string
  linksColumnAlign?: 'left' | 'center' | 'right'
  linksColumnPaddingClassName?: string
  linksBeforeTags?: boolean
  statusRightAligned?: boolean
  rowDetailsRenderer?: ((node: NodeRecord) => ReactNode) | null
  titleColumnClassName?: string
  wrapTitleText?: boolean
  actionsRightEdge?: boolean
  showProgramStatus?: boolean
  showProgramCopyButton?: boolean
  preferInlineDetailsButton?: boolean
  allowInlineNotesInReadOnly?: boolean
  allowStatusEditingInReadOnly?: boolean
  allowProgramLayoutEditingInReadOnly?: boolean
  showProgramLayoutToggle?: boolean
  programLayoutEditMode?: boolean
  onProgramLayoutEditModeChange?: (next: boolean) => void
  focusRootCreateRequestNonce?: number
  showRootInlineCreate?: boolean
  onRootInlineCreateCreated?: (created: NodeRecord) => void
  showExpandToggles?: boolean
  showNodeTypeIcons?: boolean
  showPriorityDots?: boolean
  programLabelSingular?: string
  programLabelPlural?: string
  /** Optional per-program slot rendered before the title text (e.g. a logo).
   * Keep the returned node stable across renders to avoid memo invalidation. */
  renderProgramTitlePrefix?: (program: NodeRecord) => ReactNode
  programGroupLabelSingular?: string
  persistenceKey?: string
  /** Completed epics scoped to the current project — rendered as a horizontal time strip atop each group card. */
  completedEpics?: NodeRecord[]
  programTitleByKey?: Record<string, string>
  onSelectEpic?: (epic: NodeRecord) => void
  /** When set, epics under the given program uuid use this `border-l-*` class
   *  for every sibling row, instead of rotating through the default palette. */
  epicBorderClassByProgramUuid?: Record<string, string>
}


function BacklogListBlockImpl({
  programs,
  loadEpics,
  loadChildren,
  treeRevision = 0,
  externallyUpdatedNode,
  selectedNodeId,
  readOnly = false,
  onSelectNode,
  onCreateChild,
  onDropNodeToNode,
  onReorderSiblings,
  resolveProgramOrdinal,
  onSetProgramOrdinal,
  projectPresetTagsByRoot = {},
  projectTagColorsByRoot = {},
  programGroups = [],
  programGroupIdByProgram = {},
  onCreateProgramGroup,
  onDeleteProgramGroup,
  onToggleProgramGroupCollapsed,
  onAssignProgramToGroup,
  onUpdateNodeStatus,
  onUpdateTaskStatus,
  onUpdateNodeNotes,
  relatedNodeOptions = [],
  onOpenRelatedNode,
  onOpenNodeDetails,
  canOpenNodeDetails,
  rowColumns = [],
  showRowColumnsOnCompact = false,
  rowPresetTagLimit = Infinity,
  rowPresetTagsClassName,
  reserveTagsSlotWhenEmpty = false,
  linksColumnLabel,
  linksColumnWidthClassName,
  linksColumnAlign = 'right',
  linksColumnPaddingClassName = 'px-2',
  linksBeforeTags = false,
  statusRightAligned = true,
  rowDetailsRenderer = null,
  titleColumnClassName,
  wrapTitleText = false,
  actionsRightEdge = false,
  showProgramStatus = true,
  showProgramCopyButton = true,
  preferInlineDetailsButton = false,
  allowInlineNotesInReadOnly = false,
  allowStatusEditingInReadOnly = false,
  allowProgramLayoutEditingInReadOnly = false,
  showProgramLayoutToggle = true,
  programLayoutEditMode,
  onProgramLayoutEditModeChange,
  focusRootCreateRequestNonce = 0,
  showRootInlineCreate = true,
  onRootInlineCreateCreated,
  showExpandToggles = true,
  showNodeTypeIcons = true,
  showPriorityDots = true,
  programLabelSingular = 'program',
  programLabelPlural = 'programs',
  renderProgramTitlePrefix,
  programGroupLabelSingular = 'group',
  persistenceKey,
  completedEpics = [],
  programTitleByKey,
  onSelectEpic,
  epicBorderClassByProgramUuid,
}: BacklogListBlockProps) {
  const normalizedPersistenceKey = persistenceKey?.trim() ?? ''
  const storageKey = normalizedPersistenceKey ? `${BACKLOG_LIST_PERSISTENCE_PREFIX}:${normalizedPersistenceKey}` : ''
  const [childrenByNode, setChildrenByNode] = useState<Record<string, ChildStateBlock>>(
    () => readPersistedBacklogListStateBlock(storageKey).childrenByNode,
  )
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(
    () => readPersistedBacklogListStateBlock(storageKey).expandedNodes,
  )
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [draftTypeByKey, setDraftTypeByKey] = useState<Record<string, NodeType>>({ [ROOT_INPUT_KEY]: 'program' })
  const [busyCreate, setBusyCreate] = useState<Record<string, boolean>>({})
  const [groupingInfoOpenByNode, setGroupingInfoOpenByNode] = useState<Record<string, boolean>>({})
  const [copiedRowNodeId, setCopiedRowNodeId] = useState<string | null>(null)
  const [statusBusyByNode, setStatusBusyByNode] = useState<Record<string, boolean>>({})
  const [newlyCreatedNodeIds, setNewlyCreatedNodeIds] = useState<Record<string, boolean>>({})
  const [rowDetailsNodeId, setRowDetailsNodeId] = useState<string | null>(null)
  const [internalProgramLayoutEditMode, setInternalProgramLayoutEditMode] = useState(false)
  const [programGroupDraft, setProgramGroupDraft] = useState('')
  const programFingerprint = programs.map(program => `${program.uuid}:${program.updatedAt}`).join('|')
  const newRowHighlightTimeoutByNodeRef = useRef<Record<string, number>>({})
  const previousProgramFingerprintRef = useRef(programFingerprint)
  const previousTreeRevisionRef = useRef(treeRevision)
  const rootCreateTitleInputRef = useRef<HTMLInputElement | null>(null)
  const prevFocusRootCreateRequestNonceRef = useRef(0)
  const [localError, setLocalError] = useState<string | null>(null)
  const controlledProgramLayoutEditMode = typeof programLayoutEditMode === 'boolean'
  const allowProgramLayoutModeToggle = !readOnly || allowProgramLayoutEditingInReadOnly
  const allowProgramLayoutEditing = allowProgramLayoutModeToggle && (
    controlledProgramLayoutEditMode ? programLayoutEditMode : internalProgramLayoutEditMode
  )
  const allowStatusEditing = !readOnly || allowStatusEditingInReadOnly
  const programNounSingular = toSentenceCaseLabelBlock(programLabelSingular, 'program')
  const programNounPlural = toSentenceCaseLabelBlock(programLabelPlural, 'programs')
  const programNounPluralTitle = toTitleCaseLabelBlock(programLabelPlural, 'programs')
  const programGroupNounSingular = toSentenceCaseLabelBlock(programGroupLabelSingular, 'group')

  const setProgramLayoutEditMode = useCallback((next: boolean) => {
    if (!controlledProgramLayoutEditMode) {
      setInternalProgramLayoutEditMode(next)
    }
    onProgramLayoutEditModeChange?.(next)
  }, [controlledProgramLayoutEditMode, onProgramLayoutEditModeChange])

  const lookupTagColor = useCallback((node: NodeRecord, tag: string): string | undefined => {
    const projectRoot = normalizePath(node.projectRoot ?? '')
    if (!projectRoot) return undefined
    const colorsByTag = projectTagColorsByRoot[projectRoot]
    if (!colorsByTag) return undefined
    return colorsByTag[tagLookupKeyBlock(tag)]
  }, [projectTagColorsByRoot])

  const validProgramGroupIds = useMemo(
    () => new Set(programGroups.map(group => group.id)),
    [programGroups],
  )
  const resolvedProgramGroupIdByProgram = useMemo(() => {
    const resolved: Record<string, string> = {}
    for (const [programId, groupId] of Object.entries(programGroupIdByProgram)) {
      if (!validProgramGroupIds.has(groupId)) continue
      resolved[programId] = groupId
    }
    return resolved
  }, [programGroupIdByProgram, validProgramGroupIds])
  const programIndexById = useMemo(() => new Map(programs.map((program, index) => [program.uuid, index])), [programs])
  const groupedProgramsByGroupId = useMemo(() => {
    const grouped = new Map<string, NodeRecord[]>(programGroups.map(group => [group.id, []]))
    const ungrouped: NodeRecord[] = []

    for (const program of programs) {
      const groupId = resolvedProgramGroupIdByProgram[program.uuid]
      const target = groupId ? grouped.get(groupId) : null
      if (target) target.push(program)
      else ungrouped.push(program)
    }

    return {
      grouped,
      ungrouped,
    }
  }, [programGroups, programs, resolvedProgramGroupIdByProgram])

  // Bucket completed epics by their program's group so each group card can
  // show only the epics it owns. Unmapped epics (program-less or program with
  // no group assignment) land in the ungrouped bucket alongside ungrouped
  // programs.
  const completedEpicsByGroupId = useMemo(() => {
    const programGroupByKey = new Map<string, string | null>()
    for (const program of programs) {
      const groupId = resolvedProgramGroupIdByProgram[program.uuid] ?? null
      programGroupByKey.set(program.key, groupId)
    }
    const grouped = new Map<string, NodeRecord[]>(programGroups.map(group => [group.id, []]))
    const ungrouped: NodeRecord[] = []
    for (const epic of completedEpics) {
      const parentKey = epic.parent
      const groupId = parentKey ? programGroupByKey.get(parentKey) ?? null : null
      if (groupId && grouped.has(groupId)) grouped.get(groupId)!.push(epic)
      else ungrouped.push(epic)
    }
    return { grouped, ungrouped }
  }, [completedEpics, programGroups, programs, resolvedProgramGroupIdByProgram])

  useEffect(() => {
    const persisted = readPersistedBacklogListStateBlock(storageKey)
    setChildrenByNode(persisted.childrenByNode)
    setExpandedNodes(persisted.expandedNodes)
  }, [storageKey])

  useEffect(() => {
    writePersistedBacklogListStateBlock(storageKey, { childrenByNode, expandedNodes })
  }, [childrenByNode, expandedNodes, storageKey])

  useEffect(() => {
    if (previousProgramFingerprintRef.current === programFingerprint) return
    previousProgramFingerprintRef.current = programFingerprint
    // Child lists are locally cached; clear them when upstream program data refreshes
    // so externally-created organizer nodes become visible without stale tree state.
    setChildrenByNode({})
    setExpandedNodes({})
  }, [programFingerprint])

  useEffect(() => {
    if (previousTreeRevisionRef.current === treeRevision) return
    previousTreeRevisionRef.current = treeRevision
    setChildrenByNode({})
  }, [treeRevision])

  useEffect(() => {
    if (allowProgramLayoutModeToggle) return
    setProgramLayoutEditMode(false)
  }, [allowProgramLayoutModeToggle, setProgramLayoutEditMode])

  useEffect(() => {
    if (rowDetailsRenderer) return
    setRowDetailsNodeId(null)
  }, [rowDetailsRenderer])

  useEffect(() => () => {
    for (const timeoutId of Object.values(newRowHighlightTimeoutByNodeRef.current)) {
      window.clearTimeout(timeoutId)
    }
    newRowHighlightTimeoutByNodeRef.current = {}
  }, [])

  const highlightNewlyCreatedRow = useCallback((nodeUuid: string) => {
    const normalizedNodeUuid = nodeUuid.trim()
    if (!normalizedNodeUuid) return

    const previousTimeoutId = newRowHighlightTimeoutByNodeRef.current[normalizedNodeUuid]
    if (previousTimeoutId) window.clearTimeout(previousTimeoutId)

    setNewlyCreatedNodeIds(prev => ({ ...prev, [normalizedNodeUuid]: true }))
    newRowHighlightTimeoutByNodeRef.current[normalizedNodeUuid] = window.setTimeout(() => {
      setNewlyCreatedNodeIds(prev => {
        if (!prev[normalizedNodeUuid]) return prev
        const next = { ...prev }
        delete next[normalizedNodeUuid]
        return next
      })
      delete newRowHighlightTimeoutByNodeRef.current[normalizedNodeUuid]
    }, NEW_ROW_HIGHLIGHT_MS)
  }, [])

  const ensureProgramLoaded = useCallback(async (program: NodeRecord) => {
    const existing = childrenByNode[program.uuid]
    if (existing?.loading || existing?.loaded) return

    setChildrenByNode(prev => ({
      ...prev,
      [program.uuid]: { loading: true, loaded: false, nodes: [], error: null },
    }))

    try {
      const epics = await loadEpics(program)
      setChildrenByNode(prev => ({
        ...prev,
        [program.uuid]: {
          loading: false,
          loaded: true,
          nodes: sortNodesForDisplay(epics),
          error: null,
        },
      }))
    } catch (err) {
      setChildrenByNode(prev => ({
        ...prev,
        [program.uuid]: {
          loading: false,
          loaded: false,
          nodes: [],
          error: err instanceof Error ? err.message : 'Failed to load epics',
        },
      }))
    }
  }, [childrenByNode, loadEpics])

  const ensureChildrenLoaded = useCallback(async (node: NodeRecord) => {
    const existing = childrenByNode[node.uuid]
    if (existing?.loading || existing?.loaded) return

    setChildrenByNode(prev => ({
      ...prev,
      [node.uuid]: { loading: true, loaded: false, nodes: [], error: null },
    }))

    try {
      const children = await loadChildren(node)
      setChildrenByNode(prev => ({
        ...prev,
        [node.uuid]: {
          loading: false,
          loaded: true,
          nodes: sortNodesForDisplay(children),
          error: null,
        },
      }))
    } catch (err) {
      setChildrenByNode(prev => ({
        ...prev,
        [node.uuid]: {
          loading: false,
          loaded: false,
          nodes: [],
          error: err instanceof Error ? err.message : 'Failed to load children',
        },
      }))
    }
  }, [childrenByNode, loadChildren])

  const toggleNode = useCallback((node: NodeRecord) => {
    setExpandedNodes(prev => {
      const willExpand = !prev[node.uuid]
      if (willExpand) {
        if (node.type === 'program') void ensureProgramLoaded(node)
        else void ensureChildrenLoaded(node)
      }
      return { ...prev, [node.uuid]: willExpand }
    })
  }, [ensureChildrenLoaded, ensureProgramLoaded])

  const setDraft = useCallback((key: string, value: string) => {
    setDrafts(prev => ({ ...prev, [key]: value }))
  }, [])

  const createUnder = useCallback(async (parent: NodeRecord | null, draftKey: string) => {
    if (!onCreateChild) return
    const title = (drafts[draftKey] ?? '').trim()
    if (!title) return
    const description = (descriptionDrafts[draftKey] ?? '').trim()
    const comment = (commentDrafts[draftKey] ?? '').trim()

    const allowedTypes = allowedCreateTypes(parent)
    const selectedType = draftTypeByKey[draftKey]
    const requestedType = selectedType && allowedTypes.includes(selectedType)
      ? selectedType
      : allowedTypes[0]

    setLocalError(null)
    setBusyCreate(prev => ({ ...prev, [draftKey]: true }))
    try {
      const created = await onCreateChild(parent, title, requestedType, {
        description: description || undefined,
        comment: comment || undefined,
      })
      setDrafts(prev => ({ ...prev, [draftKey]: '' }))
      setDescriptionDrafts(prev => ({ ...prev, [draftKey]: '' }))
      setCommentDrafts(prev => ({ ...prev, [draftKey]: '' }))

      if (parent) {
        setChildrenByNode(prev => {
          const existing = prev[parent.uuid]
          if (!existing?.loaded) return prev
          return {
            ...prev,
            [parent.uuid]: {
              ...existing,
              nodes: sortNodesForDisplay([...existing.nodes, created]),
            },
          }
        })
      }
      if (!parent) {
        onRootInlineCreateCreated?.(created)
      }
      highlightNewlyCreatedRow(created.uuid)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to create node')
    } finally {
      setBusyCreate(prev => ({ ...prev, [draftKey]: false }))
    }
  }, [commentDrafts, descriptionDrafts, draftTypeByKey, drafts, highlightNewlyCreatedRow, onCreateChild, onRootInlineCreateCreated])

  const {
    dragOverNodeId,
    dragOverEdge,
    makeDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    moveProgramByOffset,
    moveProgramToIndex,
  } = useBacklogDragAndReorderBlock({
    allowProgramLayoutEditing,
    programs,
    childrenByNode,
    setChildrenByNode,
    setExpandedNodes,
    onDropNodeToNode,
    onReorderSiblings,
    setLocalError,
  })

  const createProgramGroupFromDraft = useCallback(() => {
    if (!onCreateProgramGroup) return
    const nextName = programGroupDraft.trim()
    if (!nextName) return
    onCreateProgramGroup(nextName)
    setProgramGroupDraft('')
  }, [onCreateProgramGroup, programGroupDraft])

  useEffect(() => {
    if (!copiedRowNodeId) return
    const timeoutId = window.setTimeout(() => {
      setCopiedRowNodeId(current => (current === copiedRowNodeId ? null : current))
    }, 1400)
    return () => window.clearTimeout(timeoutId)
  }, [copiedRowNodeId])

  useEffect(() => {
    if (readOnly) return
    if (focusRootCreateRequestNonce <= 0) return
    if (prevFocusRootCreateRequestNonceRef.current === focusRootCreateRequestNonce) return
    prevFocusRootCreateRequestNonceRef.current = focusRootCreateRequestNonce
    window.requestAnimationFrame(() => {
      const input = rootCreateTitleInputRef.current
      if (!input) return
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      input.focus()
      input.select()
    })
  }, [focusRootCreateRequestNonce, readOnly])

  const copyRowLabelForNode = useCallback(async (node: NodeRecord, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const label = nodeDisplayTitle(node).trim() || node.title.trim() || 'Untitled'
    try {
      await copyTextToClipboard(label)
      setCopiedRowNodeId(node.uuid)
      setLocalError(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to copy row text')
    }
  }, [])

  const patchCachedNode = useCallback((updatedNode: NodeRecord) => {
    setChildrenByNode(prev => {
      let changed = false
      const next: Record<string, ChildStateBlock> = {}
      for (const [key, state] of Object.entries(prev)) {
        let stateChanged = false
        const nextNodes = state.nodes.map(node => {
          if (node.uuid !== updatedNode.uuid) return node
          stateChanged = true
          return updatedNode
        })
        if (stateChanged) {
          changed = true
          next[key] = { ...state, nodes: nextNodes }
        } else {
          next[key] = state
        }
      }
      return changed ? next : prev
    })
  }, [])

  useEffect(() => {
    if (!externallyUpdatedNode) return
    patchCachedNode(externallyUpdatedNode)
  }, [externallyUpdatedNode, patchCachedNode])

  const relatedNodeOptionsByPath = useMemo(() => {
    const map = new Map<string, BacklogRelatedNodeOptionBlock>()
    for (const option of relatedNodeOptions) {
      const normalizedPath = normalizePath(option.path)
      if (!normalizedPath) continue
      if (map.has(normalizedPath)) continue
      map.set(normalizedPath, {
        path: normalizedPath,
        label: option.label?.trim() || fileNameFromPathBlock(normalizedPath),
        summary: option.summary?.trim() || undefined,
      })
    }
    return map
  }, [relatedNodeOptions])

  const renderRelatedNodeLinksSlot = useCallback((node: NodeRecord) => {
    const normalizedLinks = normalizeRelatedNodePathsBlock(node.relatedNodes)
    const hasLinks = normalizedLinks.length > 0
    if (!hasLinks) return null

    const linkedItems = normalizedLinks.map((path) => {
      const option = relatedNodeOptionsByPath.get(path)
      return {
        path,
        label: option?.label || fileNameFromPathBlock(path),
        summary: option?.summary,
      }
    })

    return (
      <div className={cn(
        'flex min-w-0 shrink-0 self-center items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        actionsRightEdge && !statusRightAligned && 'ml-auto',
        linksColumnPaddingClassName,
        linksColumnWidthClassName ?? (actionsRightEdge ? 'max-w-[24rem] min-w-[10rem]' : 'max-w-[24rem]'),
      )} style={scaledWidthStyleFromClassBlock(
        linksColumnWidthClassName ?? (actionsRightEdge ? 'max-w-[24rem] min-w-[10rem]' : 'max-w-[24rem]'),
      )}>
        <LinkedItemChipsBlock
          items={linkedItems}
          className={cn(
            'min-w-0 w-full gap-1 flex-nowrap',
            linksColumnAlign === 'center'
              ? 'justify-center'
              : linksColumnAlign === 'left'
                ? 'justify-start'
                : 'justify-end',
          )}
          chipClassName="max-w-[12rem] px-1.5 py-0.5 text-[10px] leading-none"
          labelClassName="max-w-[12rem]"
          onOpenItem={(path, event) => {
            event.preventDefault()
            event.stopPropagation()
            onOpenRelatedNode?.(path)
          }}
        />
      </div>
    )
  }, [
    actionsRightEdge,
    linksColumnAlign,
    linksColumnPaddingClassName,
    linksColumnWidthClassName,
    statusRightAligned,
    onOpenRelatedNode,
    relatedNodeOptionsByPath,
  ])

  const handleInlineNodeStatusChange = useCallback(async (node: NodeRecord, nextStatus: NodeStatus) => {
    if (!allowStatusEditing || !onUpdateNodeStatus) return
    if (node.status === nextStatus) return

    setStatusBusyByNode(prev => ({ ...prev, [node.uuid]: true }))
    setLocalError(null)
    try {
      const updated = await onUpdateNodeStatus(node, nextStatus)
      patchCachedNode(updated ?? { ...node, status: nextStatus })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setStatusBusyByNode(prev => ({ ...prev, [node.uuid]: false }))
    }
  }, [allowStatusEditing, onUpdateNodeStatus, patchCachedNode])

  const handleInlineTaskStatusChange = useCallback(async (node: NodeRecord, nextTaskStatus: TaskStatusOption) => {
    if (readOnly || !onUpdateTaskStatus) return
    if (getTaskStatusBadge(node) === nextTaskStatus) return

    setStatusBusyByNode(prev => ({ ...prev, [node.uuid]: true }))
    setLocalError(null)
    try {
      const updated = await onUpdateTaskStatus(node, nextTaskStatus)
      patchCachedNode(updated ?? { ...node, taskStatus: nextTaskStatus })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update task status')
    } finally {
      setStatusBusyByNode(prev => ({ ...prev, [node.uuid]: false }))
    }
  }, [onUpdateTaskStatus, patchCachedNode, readOnly])

  const {
    inlineNotesNode,
    inlineNotesDescriptionDraft,
    inlineNotesCommentsDraft,
    inlineNotesCommentDraft,
    inlineNotesSaving,
    inlineNotesDirty,
    setInlineNotesDescriptionDraft,
    setInlineNotesCommentDraft,
    toggleInlineNotes,
    addInlineCommentDraft,
    removeInlineCommentDraft,
  } = useBacklogInlineNotesBlock({
    readOnly,
    allowInReadOnly: allowInlineNotesInReadOnly,
    onUpdateNodeNotes,
    patchCachedNode,
    setLocalError,
  })

  const renderTicketBadge = useCallback((node: NodeRecord) => {
    const ticket = node.ticket?.trim() ?? ''
    if (!ticket) return null

    return (
      <span className="hidden shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground sm:inline-flex">
        {ticket}
      </span>
    )
  }, [])

  const renderInlineNotesEditor = useCallback((node: NodeRecord, depthPadding: number) => (
    <BacklogInlineNotesEditorBlock
      node={node}
      depthPadding={depthPadding}
      isOpen={inlineNotesNode?.uuid === node.uuid}
      readOnly={readOnly}
      allowInReadOnly={allowInlineNotesInReadOnly}
      canEditNotes={!!onUpdateNodeNotes}
      descriptionDraft={inlineNotesDescriptionDraft}
      commentsDraft={inlineNotesCommentsDraft}
      commentDraft={inlineNotesCommentDraft}
      saving={inlineNotesSaving}
      dirty={inlineNotesDirty}
      lookupTagColor={lookupTagColor}
      onDescriptionDraftChange={setInlineNotesDescriptionDraft}
      onCommentDraftChange={setInlineNotesCommentDraft}
      onAddComment={addInlineCommentDraft}
      onRemoveComment={removeInlineCommentDraft}
    />
  ), [
    addInlineCommentDraft,
    allowInlineNotesInReadOnly,
    inlineNotesCommentDraft,
    inlineNotesCommentsDraft,
    inlineNotesDescriptionDraft,
    inlineNotesDirty,
    inlineNotesNode?.uuid,
    inlineNotesSaving,
    lookupTagColor,
    onUpdateNodeNotes,
    readOnly,
    removeInlineCommentDraft,
  ])

  const toggleRowDetails = useCallback((node: NodeRecord) => {
    const inlineRowDetailsAllowed = !!rowDetailsRenderer && (!canOpenNodeDetails || canOpenNodeDetails(node))
    const inlineNotesAllowed = (
      !!onUpdateNodeNotes
      && (!readOnly || allowInlineNotesInReadOnly)
      && (!canOpenNodeDetails || canOpenNodeDetails(node))
    )
    if (preferInlineDetailsButton) {
      if (inlineRowDetailsAllowed) {
        setRowDetailsNodeId(current => (current === node.uuid ? null : node.uuid))
      }
      if (inlineNotesAllowed) {
        void toggleInlineNotes(node)
      }
      return
    }
    if (onOpenNodeDetails && (!canOpenNodeDetails || canOpenNodeDetails(node))) {
      onOpenNodeDetails(node)
      return
    }
    if (inlineRowDetailsAllowed) {
      setRowDetailsNodeId(current => (current === node.uuid ? null : node.uuid))
      return
    }
    if (inlineNotesAllowed) {
      void toggleInlineNotes(node)
    }
  }, [allowInlineNotesInReadOnly, canOpenNodeDetails, onOpenNodeDetails, onUpdateNodeNotes, preferInlineDetailsButton, readOnly, rowDetailsRenderer, toggleInlineNotes])

  const renderInlineDetailsPanel = useCallback((node: NodeRecord, depthPadding: number) => {
    if (!rowDetailsRenderer) return null
    if (rowDetailsNodeId !== node.uuid) return null
    return (
      <div className="border-t border-border/60 bg-muted/10 px-3 py-2 text-xs" style={{ paddingLeft: `${depthPadding}px` }}>
        {rowDetailsRenderer(node)}
      </div>
    )
  }, [rowDetailsNodeId, rowDetailsRenderer])

  const renderInlineCreate = useCallback((parent: NodeRecord | null, draftKey: string, placeholder: string) => {
    if (readOnly) return null

    const allowedTypes = allowedCreateTypes(parent)
    const selectedType = draftTypeByKey[draftKey] && allowedTypes.includes(draftTypeByKey[draftKey])
      ? draftTypeByKey[draftKey]
      : allowedTypes[0]

    return (
      <BacklogInlineCreateBlock
        allowedTypes={allowedTypes}
        selectedType={selectedType}
        titleDraft={drafts[draftKey] ?? ''}
        descriptionDraft={descriptionDrafts[draftKey] ?? ''}
        commentDraft={commentDrafts[draftKey] ?? ''}
        busy={!!busyCreate[draftKey]}
        placeholder={placeholder}
        titleInputRef={draftKey === ROOT_INPUT_KEY ? rootCreateTitleInputRef : undefined}
        onTypeChange={(nextType) => {
          setDraftTypeByKey(prev => ({ ...prev, [draftKey]: nextType }))
        }}
        onTitleChange={(nextTitle) => setDraft(draftKey, nextTitle)}
        onDescriptionChange={(nextDescription) => {
          setDescriptionDrafts(prev => ({ ...prev, [draftKey]: nextDescription }))
        }}
        onCommentChange={(nextComment) => {
          setCommentDrafts(prev => ({ ...prev, [draftKey]: nextComment }))
        }}
        onSubmit={() => { void createUnder(parent, draftKey) }}
      />
    )
  }, [busyCreate, commentDrafts, createUnder, descriptionDrafts, draftTypeByKey, drafts, readOnly, setDraft])

  const renderNodeBranch = useCallback((
    node: NodeRecord,
    depth: number,
    siblingIndex: number,
    parentNode: NodeRecord | null,
    epicContext: NodeRecord | null,
  ) => {
    const isExpanded = !!expandedNodes[node.uuid]
    const childState = childrenByNode[node.uuid]
    if (isExpanded && !childState?.loading && !childState?.loaded) {
      void ensureChildrenLoaded(node)
    }
    const childCount = childState?.loaded ? childState.nodes.length : null
    const programOverrideBorderClass = depth === 0 && parentNode
      ? epicBorderClassByProgramUuid?.[parentNode.uuid]
      : undefined
    const borderColorClass = depth === 0
      ? (programOverrideBorderClass ?? EPIC_BORDER_PALETTE[siblingIndex % EPIC_BORDER_PALETTE.length])
      : 'border-l-zinc-300'
    const iconColorClass = node.type === 'epic' && depth === 0
      ? (EPIC_ICON_COLOR_BY_BORDER[borderColorClass]
        ?? (programOverrideBorderClass ? programOverrideBorderClass.replace('border-l-', 'text-').replace('-500', '-600') : iconColorForNodeType(node.type)))
      : iconColorForNodeType(node.type)

    const effectiveEpicContext = node.type === 'epic' ? node : epicContext
    const canShowGroupingInfo = isTaskNode(node) && !!effectiveEpicContext && !!parentNode
    const groupingInfoOpen = !!groupingInfoOpenByNode[node.uuid]
    const newlyCreated = !!newlyCreatedNodeIds[node.uuid]
    const rowPresetTags = compactTagList(
      selectedPresetTagsForNode(node, projectPresetTagsByRoot),
      rowPresetTagLimit,
    )
    const detailsOpen = rowDetailsRenderer
      ? rowDetailsNodeId === node.uuid
      : inlineNotesNode?.uuid === node.uuid
    const externalDetailsAllowed = !!onOpenNodeDetails && (!canOpenNodeDetails || canOpenNodeDetails(node))
    const inlineRowDetailsAllowed = !!rowDetailsRenderer && (!canOpenNodeDetails || canOpenNodeDetails(node))
    const inlineNotesAllowed = (
      !!onUpdateNodeNotes
      && (!readOnly || allowInlineNotesInReadOnly)
      && (!canOpenNodeDetails || canOpenNodeDetails(node))
    )
    const canToggleDetails = externalDetailsAllowed || inlineRowDetailsAllowed || inlineNotesAllowed
    const detailsBusy = rowDetailsRenderer ? false : inlineNotesSaving

    return (
      <div key={node.uuid} className="border-b border-border/70 last:border-b-0">
        <BacklogNodeRowBlock
          node={node}
          depth={depth}
          siblingIndex={siblingIndex}
          isExpanded={isExpanded}
          childCount={childCount}
          borderColorClass={borderColorClass}
          iconColorClass={iconColorClass}
          selected={selectedNodeId === node.uuid}
          dragOver={dragOverNodeId === node.uuid}
          dragOverEdge={dragOverNodeId === node.uuid ? dragOverEdge : null}
          newlyCreated={newlyCreated}
          allowProgramLayoutEditing={allowProgramLayoutEditing}
          readOnly={readOnly}
          rowPresetTags={rowPresetTags}
          copied={copiedRowNodeId === node.uuid}
          canShowGroupingInfo={canShowGroupingInfo}
          groupingInfoOpen={groupingInfoOpen}
          detailsOpen={detailsOpen}
          inlineNotesSaving={detailsBusy}
          statusBusy={!!statusBusyByNode[node.uuid]}
          allowStatusEditingInReadOnly={allowStatusEditingInReadOnly}
          canEditTaskStatus={!!onUpdateTaskStatus}
          canEditNodeStatus={!!onUpdateNodeStatus}
          canToggleDetails={canToggleDetails}
          linksSlot={renderRelatedNodeLinksSlot(node)}
          rowColumns={rowColumns}
          showRowColumnsOnCompact={showRowColumnsOnCompact}
          rowPresetTagsClassName={rowPresetTagsClassName}
          reserveTagsSlotWhenEmpty={reserveTagsSlotWhenEmpty}
          linksBeforeTags={linksBeforeTags}
          statusRightAligned={statusRightAligned}
          titleColumnClassName={titleColumnClassName}
          wrapTitleText={wrapTitleText}
          actionsRightEdge={actionsRightEdge}
          showExpandToggle={showExpandToggles}
          showNodeTypeIcon={showNodeTypeIcons}
          showPriorityDot={showPriorityDots}
          ticketBadge={renderTicketBadge(node)}
          lookupTagColor={lookupTagColor}
          onToggleNode={() => toggleNode(node)}
          onSelectNode={() => onSelectNode(node)}
          onDragStart={makeDragStart(node)}
          onDragEnd={handleDragEnd}
          onDragOver={event => handleDragOver(node, event)}
          onDragLeave={() => handleDragLeave(node.uuid)}
          onDrop={event => { void handleDrop(node, event) }}
          onToggleInlineNotes={() => { void toggleRowDetails(node) }}
          onCopyRowLabel={event => { void copyRowLabelForNode(node, event) }}
          onToggleGroupingInfo={() => setGroupingInfoOpenByNode(prev => ({ ...prev, [node.uuid]: !prev[node.uuid] }))}
          onTaskStatusChange={(nextStatus) => { void handleInlineTaskStatusChange(node, nextStatus) }}
          onNodeStatusChange={(nextStatus) => { void handleInlineNodeStatusChange(node, nextStatus) }}
        />
        {canShowGroupingInfo && groupingInfoOpen && (
          <div className="border-t border-border/60 bg-muted/25 px-3 py-1.5 text-[11px] text-muted-foreground" style={{ paddingLeft: `${36 + (depth * 16)}px` }}>
            Grouped under epic: <span className="text-foreground">{nodeDisplayTitle(effectiveEpicContext!)}</span>
            {' · '}
            Parent: <span className="text-foreground">{nodeDisplayTitle(parentNode!)}</span>
          </div>
        )}
        {renderInlineDetailsPanel(node, 36 + (depth * 16))}
        {renderInlineNotesEditor(node, 36 + (depth * 16))}

        {isExpanded && (
          <div className="bg-muted/15">
            {childState?.loading && (
              <div className="flex items-center gap-2 border-t border-border/70 px-6 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </div>
            )}
            {childState?.error && (
              <div className="border-t border-border/70 px-6 py-1 text-xs text-destructive">{childState.error}</div>
            )}
            {childState?.loaded && (
              <div>
                {childState.nodes.map((child, idx) => renderNodeBranch(
                  child,
                  depth + 1,
                  idx,
                  node,
                  effectiveEpicContext,
                ))}
                {childState.nodes.length === 0 && (
                  <div className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">No items yet.</div>
                )}
              </div>
            )}
            {renderInlineCreate(node, `node-${node.uuid}`, 'Add child...')}
          </div>
        )}
      </div>
    )
  }, [actionsRightEdge, allowInlineNotesInReadOnly, allowProgramLayoutEditing, canOpenNodeDetails, childrenByNode, copiedRowNodeId, copyRowLabelForNode, dragOverEdge, dragOverNodeId, ensureChildrenLoaded, epicBorderClassByProgramUuid, expandedNodes, groupingInfoOpenByNode, handleDragEnd, handleDragLeave, handleDragOver, handleDrop, handleInlineNodeStatusChange, handleInlineTaskStatusChange, inlineNotesNode?.uuid, inlineNotesSaving, linksBeforeTags, lookupTagColor, makeDragStart, newlyCreatedNodeIds, onOpenNodeDetails, onSelectNode, onUpdateNodeNotes, onUpdateNodeStatus, onUpdateTaskStatus, projectPresetTagsByRoot, readOnly, renderInlineCreate, renderInlineDetailsPanel, renderInlineNotesEditor, renderRelatedNodeLinksSlot, renderTicketBadge, reserveTagsSlotWhenEmpty, rowColumns, rowDetailsNodeId, rowDetailsRenderer, rowPresetTagLimit, rowPresetTagsClassName, selectedNodeId, showRowColumnsOnCompact, statusBusyByNode, statusRightAligned, titleColumnClassName, toggleNode, toggleRowDetails, wrapTitleText])

  const renderProgramSection = useCallback((program: NodeRecord, programIndex: number) => {
    // Programs with status='archived' are collapsed by default and gated by
    // the existing expandedNodes mechanism. Other programs stay eagerly
    // expanded as before so we don't regress existing callers.
    const isArchivedProgram = program.status === 'archived'
    const isProgramExpanded = !isArchivedProgram || !!expandedNodes[program.uuid]
    if (isProgramExpanded) {
      void ensureProgramLoaded(program)
    }
    const childState = childrenByNode[program.uuid]
    const newlyCreated = !!newlyCreatedNodeIds[program.uuid]
    const assignedGroupId = resolvedProgramGroupIdByProgram[program.uuid] ?? '__ungrouped__'
    const rowPresetTags = compactTagList(
      selectedPresetTagsForNode(program, projectPresetTagsByRoot),
      rowPresetTagLimit,
    )
    const detailsOpen = rowDetailsRenderer
      ? rowDetailsNodeId === program.uuid
      : inlineNotesNode?.uuid === program.uuid
    const externalDetailsAllowed = !!onOpenNodeDetails && (!canOpenNodeDetails || canOpenNodeDetails(program))
    const inlineRowDetailsAllowed = !!rowDetailsRenderer && (!canOpenNodeDetails || canOpenNodeDetails(program))
    const inlineNotesAllowed = (
      !!onUpdateNodeNotes
      && (!readOnly || allowInlineNotesInReadOnly)
      && (!canOpenNodeDetails || canOpenNodeDetails(program))
    )
    const canToggleDetails = externalDetailsAllowed || inlineRowDetailsAllowed || inlineNotesAllowed
    const detailsBusy = rowDetailsRenderer ? false : inlineNotesSaving

    return (
      <div key={program.uuid} className="overflow-hidden rounded-xl border border-border/70 bg-muted/25">
        <BacklogProgramRowBlock
          program={program}
          programIndex={programIndex}
          programCount={programs.length}
          selected={selectedNodeId === program.uuid}
          dragOver={dragOverNodeId === program.uuid}
          dragOverEdge={dragOverNodeId === program.uuid ? dragOverEdge : null}
          newlyCreated={newlyCreated}
          allowProgramLayoutEditing={allowProgramLayoutEditing && !!onReorderSiblings}
          readOnly={readOnly}
          rowPresetTags={rowPresetTags}
          copied={copiedRowNodeId === program.uuid}
          detailsOpen={detailsOpen}
          inlineNotesSaving={detailsBusy}
          statusBusy={!!statusBusyByNode[program.uuid]}
          canEditNodeStatus={!!onUpdateNodeStatus}
          canToggleDetails={canToggleDetails}
          linksSlot={renderRelatedNodeLinksSlot(program)}
          titlePrefixSlot={renderProgramTitlePrefix?.(program)}
          rowColumns={rowColumns}
          showRowColumnsOnCompact={showRowColumnsOnCompact}
          rowPresetTagsClassName={rowPresetTagsClassName}
          reserveTagsSlotWhenEmpty={reserveTagsSlotWhenEmpty}
          linksBeforeTags={linksBeforeTags}
          statusRightAligned={statusRightAligned}
          titleColumnClassName={titleColumnClassName}
          wrapTitleText={wrapTitleText}
          actionsRightEdge={actionsRightEdge}
          showProgramStatus={showProgramStatus}
          showProgramCopyButton={showProgramCopyButton}
          showNodeTypeIcon={showNodeTypeIcons}
          showPriorityDot={showPriorityDots}
          canAssignToGroup={allowProgramLayoutEditing && !!onAssignProgramToGroup && programGroups.length > 0}
          assignedGroupId={assignedGroupId}
          programGroups={programGroups}
          ticketBadge={renderTicketBadge(program)}
          lookupTagColor={lookupTagColor}
          onSelectProgram={() => {
            if (isArchivedProgram) toggleNode(program)
            else onSelectNode(program)
          }}
          onDragStart={makeDragStart(program)}
          onDragEnd={handleDragEnd}
          onDragOver={event => handleDragOver(program, event)}
          onDragLeave={() => handleDragLeave(program.uuid)}
          onDrop={event => { void handleDrop(program, event) }}
          onMoveProgramUp={() => { void moveProgramByOffset(program, -1) }}
          onMoveProgramDown={() => { void moveProgramByOffset(program, 1) }}
          onSetProgramIndex={(nextIndex) => {
            if (onSetProgramOrdinal) {
              void onSetProgramOrdinal(program, nextIndex + 1)
            } else {
              void moveProgramToIndex(program, nextIndex)
            }
          }}
          resolvedOrdinal={(() => {
            if (!resolveProgramOrdinal) return programIndex + 1
            const next = resolveProgramOrdinal(program, programIndex + 1)
            if (next === null) return null
            if (next === undefined) return programIndex + 1
            return next
          })()}
          onAssignProgramToGroup={(groupId) => onAssignProgramToGroup?.(program, groupId)}
          onToggleInlineNotes={() => { void toggleRowDetails(program) }}
          onCopyRowLabel={event => { void copyRowLabelForNode(program, event) }}
          onNodeStatusChange={(nextStatus) => { void handleInlineNodeStatusChange(program, nextStatus) }}
        />
        {renderInlineDetailsPanel(program, 36)}
        {renderInlineNotesEditor(program, 36)}

        {isProgramExpanded && (
          <div className="bg-muted/15">
            {childState?.loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading children...
              </div>
            )}
            {childState?.error && (
              <div className="px-3 py-1 text-xs text-destructive">{childState.error}</div>
            )}
            {childState?.loaded && (
              <>
                {childState.nodes.map((node, idx) => renderNodeBranch(node, 0, idx, program, node.type === 'epic' ? node : null))}
                {childState.nodes.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No items yet.</div>
                )}
              </>
            )}
            {renderInlineCreate(program, `program-${program.uuid}`, 'Add child...')}
          </div>
        )}
      </div>
    )
  }, [actionsRightEdge, allowInlineNotesInReadOnly, allowProgramLayoutEditing, canOpenNodeDetails, childrenByNode, copiedRowNodeId, copyRowLabelForNode, dragOverEdge, dragOverNodeId, ensureProgramLoaded, expandedNodes, handleDragEnd, handleDragLeave, handleDragOver, handleDrop, handleInlineNodeStatusChange, inlineNotesNode?.uuid, inlineNotesSaving, linksBeforeTags, lookupTagColor, makeDragStart, moveProgramByOffset, moveProgramToIndex, newlyCreatedNodeIds, onAssignProgramToGroup, onOpenNodeDetails, onReorderSiblings, onSelectNode, onSetProgramOrdinal, onUpdateNodeNotes, onUpdateNodeStatus, programGroups, programs.length, projectPresetTagsByRoot, readOnly, renderInlineCreate, renderInlineDetailsPanel, renderInlineNotesEditor, renderNodeBranch, renderProgramTitlePrefix, renderRelatedNodeLinksSlot, renderTicketBadge, reserveTagsSlotWhenEmpty, resolvedProgramGroupIdByProgram, resolveProgramOrdinal, rowColumns, rowDetailsNodeId, rowDetailsRenderer, rowPresetTagLimit, rowPresetTagsClassName, selectedNodeId, showProgramCopyButton, showProgramStatus, showRowColumnsOnCompact, statusBusyByNode, statusRightAligned, titleColumnClassName, toggleNode, toggleRowDetails, wrapTitleText])

  return (
    <div className="flex flex-col space-y-3">
      {showProgramLayoutToggle && allowProgramLayoutModeToggle && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant={allowProgramLayoutEditing ? 'default' : 'outline'}
            onClick={() => setProgramLayoutEditMode(!allowProgramLayoutEditing)}
          >
            {allowProgramLayoutEditing ? 'Done' : 'Edit'}
          </Button>
        </div>
      )}

      {!readOnly && showRootInlineCreate && renderInlineCreate(null, ROOT_INPUT_KEY, `Add ${programNounSingular}...`)}

      {rowColumns.length > 0 && (
        <div className={cn(
          'items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1',
          showRowColumnsOnCompact ? 'flex' : 'hidden xl:flex',
        )}>
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground',
            titleColumnClassName ? ['shrink-0', titleColumnClassName] : 'min-w-0 flex-1',
          )} style={scaledWidthStyleFromClassBlock(titleColumnClassName)}>
            Title
          </span>
          {rowColumns.map(column => (
            <span
              key={`column-header-${column.id}`}
              className={`shrink-0 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${column.widthClassName ?? 'w-24'} ${
                column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : ''
              }`}
              style={scaledWidthStyleFromClassBlock(column.widthClassName ?? 'w-24')}
            >
              {column.label}
            </span>
          ))}
          {linksColumnLabel && (
            <span className={cn(
              'hidden shrink-0 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:block',
              linksColumnWidthClassName ?? 'w-72',
              linksColumnAlign === 'center'
                ? 'text-center'
                : linksColumnAlign === 'left'
                  ? 'text-left'
                  : 'text-right',
            )} style={scaledWidthStyleFromClassBlock(linksColumnWidthClassName ?? 'w-72')}>
              {linksColumnLabel}
            </span>
          )}
        </div>
      )}

      {allowProgramLayoutEditing && onCreateProgramGroup && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
          <input
            value={programGroupDraft}
            onChange={event => setProgramGroupDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              createProgramGroupFromDraft()
            }}
            placeholder={`Add ${programNounSingular} ${programGroupNounSingular} (e.g. 2025)`}
            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={createProgramGroupFromDraft}
            disabled={!programGroupDraft.trim()}
          >
            Add Group
          </Button>
        </div>
      )}

      {programs.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          {`No ${programNounPlural} yet. Create one above to get started.`}
        </div>
      )}

      {programGroups.length > 0 && (
        <div className="space-y-3">
          {programGroups.map((group) => {
            const groupedPrograms = groupedProgramsByGroupId.grouped.get(group.id) ?? []
            const groupEpics = completedEpicsByGroupId.grouped.get(group.id) ?? []
            return (
              <div key={`program-group-${group.id}`} className="space-y-2">
                <ProgramGroupHeaderBlock
                  name={group.name}
                  collapsed={group.collapsed}
                  count={groupedPrograms.length}
                  allowEdit={allowProgramLayoutEditing}
                  onToggle={() => onToggleProgramGroupCollapsed?.(group.id)}
                  onDelete={allowProgramLayoutEditing && onDeleteProgramGroup ? () => onDeleteProgramGroup(group.id) : undefined}
                />
                {!group.collapsed && groupEpics.length > 0 && (
                  <div className="rounded-md border border-border/40 bg-card px-3 py-2">
                    <EpicTimelineStripBlock
                      epics={groupEpics}
                      programTitleByKey={programTitleByKey}
                      onSelectEpic={onSelectEpic}
                      watermarkLabel={group.name}
                    />
                  </div>
                )}
                {!group.collapsed && (
                  groupedPrograms.length > 0 ? (
                    <div className="space-y-2">
                      {groupedPrograms.map(program => renderProgramSection(program, programIndexById.get(program.uuid) ?? 0))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                      {`No ${programNounPlural} assigned to this ${programGroupNounSingular}.`}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}

      {groupedProgramsByGroupId.ungrouped.length > 0 && (
        <div className="space-y-2">
          {programGroups.length > 0 && (
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {`Ungrouped ${programNounPluralTitle}`}
            </p>
          )}
          {completedEpicsByGroupId.ungrouped.length > 0 && (
            <div className="rounded-md border border-border/40 bg-card px-3 py-2">
              <EpicTimelineStripBlock
                epics={completedEpicsByGroupId.ungrouped}
                programTitleByKey={programTitleByKey}
                onSelectEpic={onSelectEpic}
              />
            </div>
          )}
          {groupedProgramsByGroupId.ungrouped.map(program => renderProgramSection(program, programIndexById.get(program.uuid) ?? 0))}
        </div>
      )}

      {localError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {localError}
        </div>
      )}
    </div>
  )
}

// Memoize so unrelated re-renders of the parent orchestrator don't recompute
// the full hierarchy. Combined with stable callback props at the call site,
// this should kill the ~40-row re-render storm we were seeing on tab switch.
const BacklogListBlock = memo(BacklogListBlockImpl)
export default BacklogListBlock
