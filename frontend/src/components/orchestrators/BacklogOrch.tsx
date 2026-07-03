import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import BacklogListBlock from '@/components/lego_blocks/integrations/BacklogListBlock'
import BacklogCanvasAnchorBlock from '@/components/lego_blocks/integrations/BacklogCanvasAnchorBlock'
import BacklogCanvasMissionBlock from '@/components/lego_blocks/integrations/BacklogCanvasMissionBlock'
import CanvasSurfaceOrch from '@/components/orchestrators/CanvasSurfaceOrch'
import ScrollableZoomSurfaceBlock from '@/components/lego_blocks/integrations/ScrollableZoomSurfaceBlock'
import ExecutionProgressBlock from '@/components/lego_blocks/units/ExecutionProgressBlock'
import { thinkingOrgCanvasStorage } from '@/services/lego_blocks/integrations/thinkingOrgCanvasStorageBlock'
import NodeDetailPanelBlock from '@/components/lego_blocks/integrations/NodeDetailPanelBlock'
import {
  TagDisclosureButtonBlock,
  TagListEditorBlock,
} from '@/components/lego_blocks/integrations/TagManagerBlock'
import CascadingFolderPicker, {
  addRecent,
  type CascadingFolderPickerChange,
} from '@/components/lego_blocks/integrations/CascadingFolderPickerBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import type { NodeStatus, NodeType, YAMLCommentEntry, YAMLFrontmatter } from '@/services/lego_blocks/units/yamlNoteBlock'
import {
  THINKING_ORGANIZER_DIR,
  getVaultFsOrch,
  hierarchyToExcalidrawMdOrch,
} from '@/services/orchestrators/backlogProjectOrch'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import { defaultNodeKindLabel } from '@/components/lego_blocks/integrations/HierarchyTreeBlock'
import {
  invokeCapabilityOrThrow,
} from '@/services/orchestrators/capabilityRouterOrch'
import { listInProgressExecutionTasksOrch } from '@/services/orchestrators/executionProgressOrch'
import { smartSync } from '@/services/orchestrators/vaultSyncOrch'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'
import {
  STORAGE_KEYS,
  getJsonStorageItem,
  setJsonStorageItem,
} from '@/services/orchestrators/storageOrch'
import {
  normalizeHexColorBlock,
  normalizeTagBlock,
  normalizeTagListBlock,
  splitTagInputBlock,
  tagLookupKeyBlock,
} from '@/services/lego_blocks/units/tagBlock'
import { getUserCommentAuthorBlock } from '@/services/lego_blocks/units/userProfileBlock'
import {
  readOrganizerUiStateOrch,
  writeOrganizerUiStateOrch,
  type OrganizerProgramGroupEntryOrch,
  type OrganizerUiStateOrch,
} from '@/services/orchestrators/organizerUiStateOrch'
import { addGlobalSyncRefreshListenerBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'

interface ProjectEntry {
  name: string
  root: string
}
type ProjectPresetTagsByRoot = Record<string, string[]>
type ProjectTagColorsByRoot = Record<string, Record<string, string>>
interface ProgramGroupEntry extends OrganizerProgramGroupEntryOrch {
  id: string
  name: string
  programIds: string[]
  collapsed?: boolean
}
type ProjectProgramGroupsByRoot = Record<string, ProgramGroupEntry[]>

const BACKLOG_ACTOR: CapabilityActor = {
  kind: 'human',
  id: 'ui.backlog',
}
const PROJECT_DESTINATION_RECENTS_KEY = 'ltm-thinking-organizer-project-destination-recents'
const PROJECT_ROOT_QUERY_PARAM = 'projectRoot'
const SELECTED_NODE_QUERY_PARAM = 'selectedNode'
export const ORGANIZER_OPEN_CREATE_PROJECT_EVENT = 'ltm:organizer:open-create-project'
export const ORGANIZER_PROJECTS_UPDATED_EVENT = 'ltm:organizer:projects-updated'
export interface OrganizerProjectsUpdatedDetail { projects: Array<{ name: string; root: string }> }
function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return fallback
}

function toDateInputValue(value: string | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function timelineSortTimestamp(node: Pick<NodeRecord, 'epicCompletedAt' | 'updatedAt' | 'createdAt'>): number {
  const epicCompletedDate = toDateInputValue(node.epicCompletedAt)
  if (epicCompletedDate) {
    const completionTime = new Date(`${epicCompletedDate}T00:00:00Z`).getTime()
    if (!Number.isNaN(completionTime)) return completionTime
  }
  const updatedTime = new Date(node.updatedAt).getTime()
  if (!Number.isNaN(updatedTime)) return updatedTime
  const createdTime = new Date(node.createdAt).getTime()
  if (!Number.isNaN(createdTime)) return createdTime
  return 0
}

function sortTimelineEpics(nodes: NodeRecord[]): NodeRecord[] {
  return [...nodes].sort((a, b) => {
    const byCompletion = timelineSortTimestamp(b) - timelineSortTimestamp(a)
    if (byCompletion !== 0) return byCompletion
    return (a.title ?? '').localeCompare(b.title ?? '')
  })
}

function displaySortOrder(node: Pick<NodeRecord, 'sortOrder'>): number {
  return typeof node.sortOrder === 'number' && Number.isFinite(node.sortOrder)
    ? node.sortOrder
    : Number.POSITIVE_INFINITY
}

function sortBacklogNodes(nodes: NodeRecord[]): NodeRecord[] {
  return [...nodes].sort((a, b) => {
    const byOrder = displaySortOrder(a) - displaySortOrder(b)
    if (byOrder !== 0) return byOrder
    const byTitle = (a.title ?? '').localeCompare(b.title ?? '')
    if (byTitle !== 0) return byTitle
    return (a.key ?? '').localeCompare(b.key ?? '')
  })
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function makeProgramGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `program-group-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function dedupeProgramIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const id of ids) {
    const normalized = id.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(normalized)
  }
  return deduped
}

function normalizeProgramGroups(groups: ProgramGroupEntry[]): ProgramGroupEntry[] {
  const seenGroupIds = new Set<string>()
  const assignedPrograms = new Set<string>()
  const normalized: ProgramGroupEntry[] = []

  for (const group of groups) {
    const id = group.id?.trim()
    const name = group.name?.trim()
    if (!id || seenGroupIds.has(id)) continue
    seenGroupIds.add(id)

    const nextProgramIds: string[] = []
    for (const programId of dedupeProgramIds(group.programIds ?? [])) {
      if (assignedPrograms.has(programId)) continue
      assignedPrograms.add(programId)
      nextProgramIds.push(programId)
    }

    normalized.push({
      id,
      name: name || 'Group',
      programIds: nextProgramIds,
      collapsed: !!group.collapsed,
    })
  }

  return normalized
}

function normalizeTagColorMap(colors: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [tag, color] of Object.entries(colors)) {
    const tagKey = tagLookupKeyBlock(tag)
    const normalizedColor = normalizeHexColorBlock(color)
    if (!tagKey || !normalizedColor) continue
    normalized[tagKey] = normalizedColor
  }
  return normalized
}

function projectUiStateSignature(state: OrganizerUiStateOrch): string {
  return JSON.stringify({
    projectName: state.projectName ?? null,
    presetTags: normalizeTagListBlock(state.presetTags ?? []),
    tagColors: normalizeTagColorMap(state.tagColors ?? {}),
    programGroups: normalizeProgramGroups(state.programGroups ?? []),
  })
}

function hasProjectUiStateData(state: OrganizerUiStateOrch): boolean {
  return Boolean(
    (state.projectName && state.projectName.trim())
    || state.presetTags.length > 0
    || Object.keys(state.tagColors).length > 0
    || state.programGroups.length > 0,
  )
}

function readProgramGroupFromNode(node: NodeRecord): string | null {
  const metadata = node.metadata as Record<string, unknown> | undefined
  const value = metadata?.program_group
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function mergeProgramGroupsWithYamlAssignments(
  groups: ProgramGroupEntry[],
  projectPrograms: NodeRecord[],
): ProgramGroupEntry[] {
  const normalizedGroups = normalizeProgramGroups(groups)
  const groupOrder = normalizedGroups.map(group => group.id)
  const groupMeta = new Map<string, Pick<ProgramGroupEntry, 'name' | 'collapsed'>>(
    normalizedGroups.map(group => [group.id, { name: group.name, collapsed: group.collapsed }]),
  )
  const existingAssignmentByProgram = new Map<string, string>()
  for (const group of normalizedGroups) {
    for (const programId of group.programIds) {
      existingAssignmentByProgram.set(programId, group.id)
    }
  }

  const programIdsByGroup = new Map<string, string[]>()
  const seenProgramIdsByGroup = new Map<string, Set<string>>()
  const pushProgram = (groupId: string, programId: string) => {
    const normalizedGroupId = groupId.trim()
    const normalizedProgramId = programId.trim()
    if (!normalizedGroupId || !normalizedProgramId) return
    if (!programIdsByGroup.has(normalizedGroupId)) {
      programIdsByGroup.set(normalizedGroupId, [])
      seenProgramIdsByGroup.set(normalizedGroupId, new Set())
    }
    const seen = seenProgramIdsByGroup.get(normalizedGroupId)!
    if (seen.has(normalizedProgramId)) return
    seen.add(normalizedProgramId)
    programIdsByGroup.get(normalizedGroupId)!.push(normalizedProgramId)
  }

  for (const program of projectPrograms) {
    const yamlGroupId = readProgramGroupFromNode(program)
    const groupId = yamlGroupId ?? existingAssignmentByProgram.get(program.uuid)
    if (!groupId) continue
    if (!groupMeta.has(groupId)) {
      groupMeta.set(groupId, { name: humanizeKey(groupId), collapsed: false })
      groupOrder.push(groupId)
    }
    pushProgram(groupId, program.uuid)
  }

  return groupOrder.map((groupId) => {
    const meta = groupMeta.get(groupId) ?? { name: 'Group', collapsed: false }
    return {
      id: groupId,
      name: meta.name?.trim() || 'Group',
      collapsed: !!meta.collapsed,
      programIds: programIdsByGroup.get(groupId) ?? [],
    }
  })
}

function normalizeStoredSegments(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap(segment => (typeof segment === 'string' ? segment.split('/') : []))
      .map(segment => segment.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean)
  }
  return []
}

function readStoredProjectRoot(): string {
  const saved = normalizeStoredSegments(
    getJsonStorageItem<unknown>(STORAGE_KEYS.thinkingOrganizerSelectedProjectRoot, []),
  )
  return normalizePath(saved.join('/'))
}

function humanizeKey(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'Project'
}

function allowedChildTypes(parentType: NodeType | null): NodeType[] {
  if (!parentType) return ['program']
  const all: NodeType[] = ['epic', 'idea_bucket', 'idea', 'thought_bucket', 'thought', 'task', 'run', 'handoff']
  const preferred: NodeType =
    parentType === 'program' ? 'epic'
      : parentType === 'epic' ? 'epic'
        : parentType === 'idea_bucket' ? 'idea'
          : parentType === 'idea' ? 'thought_bucket'
            : parentType === 'thought_bucket' ? 'thought'
              : 'thought'
  return [preferred, ...all.filter(type => type !== preferred)]
}

function isTaskLikeNode(node: Pick<NodeRecord, 'type' | 'recordKind' | 'taskStatus'>): boolean {
  return node.type === 'task' || node.recordKind === 'task' || !!node.taskStatus
}

type BacklogNodeStatus = NodeStatus
type BacklogTaskStatus = 'ready' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
export type BacklogView = 'list' | 'canvas'

export function parseBacklogView(raw: string | null, fallback: BacklogView = 'list'): BacklogView {
  if (raw === 'canvas') return 'canvas'
  if (raw === 'list') return 'list'
  return fallback
}

// Bounded canvas world for the Backlog board view. Mirrors the Webull F9
// pattern: fixed-width content with side breathing room, mission text above,
// then stacked anchor cards (execution progress + backlog list), each with a
// ResizeObserver-driven height that grows the world.
const BACKLOG_CANVAS_CONTENT_WIDTH = 1400
const BACKLOG_CANVAS_SIDE_BREATHING = 1600
const BACKLOG_CANVAS_WORLD_WIDTH = BACKLOG_CANVAS_CONTENT_WIDTH + BACKLOG_CANVAS_SIDE_BREATHING * 2
const BACKLOG_CANVAS_ANCHOR_CENTER_X = BACKLOG_CANVAS_WORLD_WIDTH / 2
const BACKLOG_CANVAS_TOP_BREATHING = 400
const BACKLOG_CANVAS_MISSION_HEIGHT = 160
const BACKLOG_CANVAS_MISSION_GAP = 32
const BACKLOG_CANVAS_CARD_GAP = 28
const BACKLOG_CANVAS_BOTTOM_BREATHING = 320
const BACKLOG_CANVAS_EXECUTION_INITIAL_HEIGHT = 280
const BACKLOG_CANVAS_BACKLOG_INITIAL_HEIGHT = 800

interface BacklogOrchProps {
  view: BacklogView
  /** Project name shown above the canvas anchor (canvas view only). */
  canvasProjectName?: string
  /** Mission statement shown under the project name in canvas view. */
  canvasMissionStatement?: string
}

export default function BacklogOrch({
  view: backlogView,
  canvasProjectName,
  canvasMissionStatement,
}: BacklogOrchProps) {
  const { openFile } = useMarkdownViewer()
  const [searchParams, setSearchParams] = useSearchParams()
  const [programs, setPrograms] = useState<NodeRecord[]>([])
  const programsRef = useRef<NodeRecord[]>([])
  const [selectedNode, setSelectedNode] = useState<NodeRecord | null>(null)
  const [urlHydrated, setUrlHydrated] = useState(false)
  const [selectedFrontmatter, setSelectedFrontmatter] = useState<YAMLFrontmatter | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [treeRevision, setTreeRevision] = useState(0)
  const [lastExternallyUpdatedNode, setLastExternallyUpdatedNode] = useState<NodeRecord | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentOperation, setCurrentOperation] = useState<string | null>(null)
  const [activeExecutionTasks, setActiveExecutionTasks] = useState<NodeRecord[]>([])
  const [activeExecutionTasksLoading, setActiveExecutionTasksLoading] = useState(false)
  const [activeExecutionTasksError, setActiveExecutionTasksError] = useState<string | null>(null)
  const [programLayoutEditMode, setProgramLayoutEditMode] = useState(false)
  const [backlogCanvasAnchorHeight, setBacklogCanvasAnchorHeight] = useState(
    BACKLOG_CANVAS_BACKLOG_INITIAL_HEIGHT,
  )
  const handleBacklogCanvasAnchorHeightChange = useCallback((next: number) => {
    setBacklogCanvasAnchorHeight(prev => (Math.abs(prev - next) < 1 ? prev : next))
  }, [])
  const [executionCanvasAnchorHeight, setExecutionCanvasAnchorHeight] = useState(
    BACKLOG_CANVAS_EXECUTION_INITIAL_HEIGHT,
  )
  const handleExecutionCanvasAnchorHeightChange = useCallback((next: number) => {
    setExecutionCanvasAnchorHeight(prev => (Math.abs(prev - next) < 1 ? prev : next))
  }, [])
  const [showRootProgramCreate, setShowRootProgramCreate] = useState(false)
  const [focusRootCreateRequestNonce, setFocusRootCreateRequestNonce] = useState(0)
  const [completedEpicTimeline, setCompletedEpicTimeline] = useState<NodeRecord[]>([])

  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>(
    () => getJsonStorageItem<ProjectEntry[]>(STORAGE_KEYS.thinkingOrganizerProjects, []),
  )
  const [projectPresetTagsByRoot, setProjectPresetTagsByRoot] = useState<ProjectPresetTagsByRoot>(
    () => getJsonStorageItem<ProjectPresetTagsByRoot>(STORAGE_KEYS.thinkingOrganizerProjectPresetTags, {}),
  )
  const [projectTagColorsByRoot, setProjectTagColorsByRoot] = useState<ProjectTagColorsByRoot>(
    () => getJsonStorageItem<ProjectTagColorsByRoot>(STORAGE_KEYS.thinkingOrganizerProjectTagColors, {}),
  )
  const [projectProgramGroupsByRoot, setProjectProgramGroupsByRoot] = useState<ProjectProgramGroupsByRoot>(
    () => getJsonStorageItem<ProjectProgramGroupsByRoot>(STORAGE_KEYS.thinkingOrganizerProjectProgramGroups, {}),
  )
  const projectUiStateHydratedRootsRef = useRef<Set<string>>(new Set())
  const projectUiStatePersistedSignatureByRootRef = useRef<Record<string, string>>({})
  const [initialProjectLoadResolved, setInitialProjectLoadResolved] = useState(false)
  const [storedProjectRootPreference, setStoredProjectRootPreference] = useState(() => readStoredProjectRoot())
  const activeProjectRoot = useMemo(
    () => normalizePath(searchParams.get(PROJECT_ROOT_QUERY_PARAM) ?? ''),
    [searchParams],
  )

  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [projectPresetTagDraft, setProjectPresetTagDraft] = useState('')
  const [projectTagsExpanded, setProjectTagsExpanded] = useState(false)
  const [destinationSegments, setDestinationSegments] = useState<string[]>(
    () => normalizeStoredSegments(
      getJsonStorageItem<unknown>(STORAGE_KEYS.thinkingOrganizerProjectCreateDestination, []),
    ),
  )
  const [destinationBasePath, setDestinationBasePath] = useState(() => destinationSegments.join('/'))
  const [destinationPath, setDestinationPath] = useState(() => {
    const root = destinationSegments.join('/')
    return normalizePath(root) ? normalizePath(`${root}/${THINKING_ORGANIZER_DIR}`) : ''
  })
  const [creatingProject, setCreatingProject] = useState(false)

  const buildProjectUiState = useCallback((projectRoot: string): OrganizerUiStateOrch => {
    const normalizedRoot = normalizePath(projectRoot)
    const projectEntry = projectEntries.find(entry => normalizePath(entry.root) === normalizedRoot)
    const projectPrograms = programs.filter(
      program => normalizePath(program.projectRoot ?? '') === normalizedRoot && program.type === 'program',
    )
    const mergedProgramGroups = mergeProgramGroupsWithYamlAssignments(
      normalizeProgramGroups(projectProgramGroupsByRoot[normalizedRoot] ?? []),
      projectPrograms,
    )
    return {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      projectName: projectEntry?.name?.trim() || undefined,
      presetTags: normalizeTagListBlock(projectPresetTagsByRoot[normalizedRoot] ?? []),
      tagColors: normalizeTagColorMap(projectTagColorsByRoot[normalizedRoot] ?? {}),
      programGroups: mergedProgramGroups,
    }
  }, [programs, projectEntries, projectPresetTagsByRoot, projectProgramGroupsByRoot, projectTagColorsByRoot])

  const persistProjectUiState = useCallback(async (
    projectRoot: string,
    snapshot: OrganizerUiStateOrch,
  ): Promise<OrganizerUiStateOrch> => {
    const normalizedRoot = normalizePath(projectRoot)
    const current = normalizedRoot ? await readOrganizerUiStateOrch(normalizedRoot) : null
    return writeOrganizerUiStateOrch(normalizedRoot, {
      ...(current ?? {}),
      ...snapshot,
      missionStatement: snapshot.missionStatement ?? current?.missionStatement,
    })
  }, [])

  const applyProjectUiStateToCache = useCallback((projectRoot: string, state: OrganizerUiStateOrch) => {
    const normalizedRoot = normalizePath(projectRoot)
    if (!normalizedRoot) return
    const normalizedState: OrganizerUiStateOrch = {
      ...state,
      presetTags: normalizeTagListBlock(state.presetTags ?? []),
      tagColors: normalizeTagColorMap(state.tagColors ?? {}),
      programGroups: normalizeProgramGroups(state.programGroups ?? []),
    }

    if (normalizedState.projectName?.trim()) {
      setProjectEntries((prev) => {
        const next = [...prev]
        const idx = next.findIndex(project => normalizePath(project.root) === normalizedRoot)
        if (idx >= 0) next[idx] = { root: normalizedRoot, name: normalizedState.projectName! }
        else next.push({ root: normalizedRoot, name: normalizedState.projectName! })
        next.sort((a, b) => a.name.localeCompare(b.name))
        setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjects, next)
        return next
      })
    }

    setProjectPresetTagsByRoot((prev) => {
      const next: ProjectPresetTagsByRoot = { ...prev }
      if (normalizedState.presetTags.length > 0) next[normalizedRoot] = normalizedState.presetTags
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectPresetTags, next)
      return next
    })

    setProjectTagColorsByRoot((prev) => {
      const next: ProjectTagColorsByRoot = { ...prev }
      if (Object.keys(normalizedState.tagColors).length > 0) next[normalizedRoot] = normalizedState.tagColors
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectTagColors, next)
      return next
    })

    setProjectProgramGroupsByRoot((prev) => {
      const next: ProjectProgramGroupsByRoot = { ...prev }
      if (normalizedState.programGroups.length > 0) next[normalizedRoot] = normalizedState.programGroups
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectProgramGroups, next)
      return next
    })

    projectUiStatePersistedSignatureByRootRef.current[normalizedRoot] = projectUiStateSignature(normalizedState)
    projectUiStateHydratedRootsRef.current.add(normalizedRoot)
  }, [])

  useEffect(() => {
    if (!activeProjectRoot) return
    const normalizedRoot = normalizePath(activeProjectRoot)
    if (!normalizedRoot) return
    if (projectUiStateHydratedRootsRef.current.has(normalizedRoot)) return

    let cancelled = false
    void (async () => {
      try {
        const fromVault = await readOrganizerUiStateOrch(normalizedRoot)
        if (cancelled) return
        if (fromVault) {
          applyProjectUiStateToCache(normalizedRoot, fromVault)
          return
        }

        const cachedState = buildProjectUiState(normalizedRoot)
        if (hasProjectUiStateData(cachedState)) {
          const persisted = await persistProjectUiState(normalizedRoot, cachedState)
          if (cancelled) return
          applyProjectUiStateToCache(normalizedRoot, persisted)
          return
        }

        projectUiStatePersistedSignatureByRootRef.current[normalizedRoot] = projectUiStateSignature(cachedState)
        projectUiStateHydratedRootsRef.current.add(normalizedRoot)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Failed to load project organizer UI settings'))
        projectUiStateHydratedRootsRef.current.add(normalizedRoot)
      }
    })()

    return () => { cancelled = true }
  }, [activeProjectRoot, applyProjectUiStateToCache, buildProjectUiState, persistProjectUiState])

  useEffect(() => {
    if (!activeProjectRoot) return
    const normalizedRoot = normalizePath(activeProjectRoot)
    if (!normalizedRoot) return
    if (!projectUiStateHydratedRootsRef.current.has(normalizedRoot)) return

    const snapshot = buildProjectUiState(normalizedRoot)
    const signature = projectUiStateSignature(snapshot)
    if (projectUiStatePersistedSignatureByRootRef.current[normalizedRoot] === signature) return

    let cancelled = false
    void (async () => {
      try {
        const persisted = await persistProjectUiState(normalizedRoot, snapshot)
        if (cancelled) return
        projectUiStatePersistedSignatureByRootRef.current[normalizedRoot] = projectUiStateSignature(persisted)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Failed to persist project organizer UI settings'))
      }
    })()

    return () => { cancelled = true }
  }, [activeProjectRoot, buildProjectUiState, persistProjectUiState])

  const loadPrograms = useCallback(async (syncVault = false): Promise<boolean> => {
    // Only show the loading spinner on first load when there's no data yet.
    // On background refreshes, keep existing programs visible (stale-while-revalidate).
    const isFirstLoad = programsRef.current.length === 0
    if (isFirstLoad) setLoading(true)
    setError(null)
    try {
      if (syncVault) {
        setSyncing(true)
        await smartSync()
      }
      const { nodes: roots } = await invokeCapabilityOrThrow({
        capability: 'organizer.nodes.list_roots',
        input: { typeFilter: 'program' },
        actor: BACKLOG_ACTOR,
      })
      const sorted = sortBacklogNodes(roots)
      programsRef.current = sorted
      setPrograms(sorted)
      return true
    } catch (err) {
      setError(errorMessage(err, 'Failed to load programs'))
      return false
    } finally {
      setSyncing(false)
      if (isFirstLoad) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Avoid implicit vault sync on every remount/reopen.
      // Global app startup sync + explicit Sync Tools actions handle cache refresh.
      await loadPrograms(false)
      if (!cancelled) setInitialProjectLoadResolved(true)
    })()
    return () => { cancelled = true }
  }, [loadPrograms])

  const selectProject = useCallback((root: string) => {
    const normalized = normalizePath(root)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (normalized) next.set(PROJECT_ROOT_QUERY_PARAM, normalized)
      else next.delete(PROJECT_ROOT_QUERY_PARAM)
      return next
    }, { replace: true })
    setJsonStorageItem(
      STORAGE_KEYS.thinkingOrganizerSelectedProjectRoot,
      normalized ? normalized.split('/') : [],
    )
    setStoredProjectRootPreference(normalized)
  }, [setSearchParams])

  const updateProjectTagColor = useCallback((projectRoot: string, tag: string, color: string | null) => {
    const normalizedRoot = normalizePath(projectRoot)
    if (!normalizedRoot) return
    const tagKey = tagLookupKeyBlock(tag)
    if (!tagKey) return
    const normalizedColor = normalizeHexColorBlock(color)
    setProjectTagColorsByRoot((prev) => {
      const next: ProjectTagColorsByRoot = { ...prev }
      const existing = { ...(next[normalizedRoot] ?? {}) }
      if (normalizedColor) existing[tagKey] = normalizedColor
      else delete existing[tagKey]
      if (Object.keys(existing).length > 0) next[normalizedRoot] = existing
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectTagColors, next)
      return next
    })
  }, [])

  const updateProjectPresetTags = useCallback((projectRoot: string, tags: string[]) => {
    const normalizedRoot = normalizePath(projectRoot)
    if (!normalizedRoot) return
    const normalizedTags = normalizeTagListBlock(tags)
    setProjectPresetTagsByRoot((prev) => {
      const next: ProjectPresetTagsByRoot = { ...prev }
      if (normalizedTags.length > 0) next[normalizedRoot] = normalizedTags
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectPresetTags, next)
      return next
    })
    setProjectTagColorsByRoot((prev) => {
      const existing = prev[normalizedRoot]
      if (!existing) return prev
      const allowedTagKeys = new Set(normalizedTags.map(tagLookupKeyBlock))
      const pruned = Object.fromEntries(
        Object.entries(existing).filter(([tagKey]) => allowedTagKeys.has(tagKey)),
      )
      const next: ProjectTagColorsByRoot = { ...prev }
      if (Object.keys(pruned).length > 0) next[normalizedRoot] = pruned
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectTagColors, next)
      return next
    })
  }, [])

  const selectedProjectPresetTags = useMemo(() => {
    const projectRoot = normalizePath(selectedNode?.projectRoot ?? activeProjectRoot)
    if (!projectRoot) return []
    return normalizeTagListBlock(projectPresetTagsByRoot[projectRoot] ?? [])
  }, [activeProjectRoot, projectPresetTagsByRoot, selectedNode?.projectRoot])
  const activeProjectPresetTags = useMemo(() => {
    if (!activeProjectRoot) return []
    return normalizeTagListBlock(projectPresetTagsByRoot[activeProjectRoot] ?? [])
  }, [activeProjectRoot, projectPresetTagsByRoot])
  const selectedProjectTagColors = useMemo(() => {
    const projectRoot = normalizePath(selectedNode?.projectRoot ?? activeProjectRoot)
    if (!projectRoot) return {}
    return projectTagColorsByRoot[projectRoot] ?? {}
  }, [activeProjectRoot, projectTagColorsByRoot, selectedNode?.projectRoot])
  const activeProjectTagColors = useMemo(() => {
    if (!activeProjectRoot) return {}
    return projectTagColorsByRoot[activeProjectRoot] ?? {}
  }, [activeProjectRoot, projectTagColorsByRoot])

  const addActiveProjectPresetTags = useCallback(() => {
    if (!activeProjectRoot) return
    const additions = splitTagInputBlock(projectPresetTagDraft)
    if (additions.length === 0) return
    updateProjectPresetTags(activeProjectRoot, [...activeProjectPresetTags, ...additions])
    setProjectPresetTagDraft('')
  }, [activeProjectPresetTags, activeProjectRoot, projectPresetTagDraft, updateProjectPresetTags])

  const removeActiveProjectPresetTag = useCallback((tag: string) => {
    if (!activeProjectRoot) return
    const normalizedTarget = normalizeTagBlock(tag).toLowerCase()
    if (!normalizedTarget) return
    const next = activeProjectPresetTags.filter(
      existing => normalizeTagBlock(existing).toLowerCase() !== normalizedTarget,
    )
    updateProjectPresetTags(activeProjectRoot, next)
  }, [activeProjectPresetTags, activeProjectRoot, updateProjectPresetTags])

  const setActiveProjectTagColor = useCallback((tag: string, color: string | null) => {
    if (!activeProjectRoot) return
    updateProjectTagColor(activeProjectRoot, tag, color)
  }, [activeProjectRoot, updateProjectTagColor])

  const updateProjectProgramGroups = useCallback((
    projectRoot: string,
    updater: (groups: ProgramGroupEntry[]) => ProgramGroupEntry[],
  ) => {
    const normalizedRoot = normalizePath(projectRoot)
    if (!normalizedRoot) return
    setProjectProgramGroupsByRoot((prev) => {
      const current = normalizeProgramGroups(prev[normalizedRoot] ?? [])
      const nextGroups = normalizeProgramGroups(updater(current))
      const next: ProjectProgramGroupsByRoot = { ...prev }
      if (nextGroups.length > 0) next[normalizedRoot] = nextGroups
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectProgramGroups, next)
      return next
    })
  }, [])

  const activeProjectProgramGroups = useMemo(() => {
    if (!activeProjectRoot) return []
    const projectPrograms = programs.filter(
      program => normalizePath(program.projectRoot ?? '') === activeProjectRoot && program.type === 'program',
    )
    return mergeProgramGroupsWithYamlAssignments(
      normalizeProgramGroups(projectProgramGroupsByRoot[activeProjectRoot] ?? []),
      projectPrograms,
    )
  }, [activeProjectRoot, programs, projectProgramGroupsByRoot])

  const activeProjectProgramGroupIdByProgram = useMemo(() => {
    const byProgram: Record<string, string> = {}
    for (const group of activeProjectProgramGroups) {
      for (const programId of group.programIds) {
        byProgram[programId] = group.id
      }
    }
    return byProgram
  }, [activeProjectProgramGroups])

  const persistProgramGroupAssignmentInYaml = useCallback(async (
    programUuid: string,
    groupId: string | null,
  ) => {
    const normalizedProgramUuid = programUuid.trim()
    if (!normalizedProgramUuid) return
    const normalizedGroupId = groupId?.trim() || null
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.update',
        input: {
          uuid: normalizedProgramUuid,
          updates: {
            extraFields: {
              program_group: normalizedGroupId,
            },
          },
        },
        actor: BACKLOG_ACTOR,
      })
      setPrograms(prev => prev.map(program => (program.uuid === updated.uuid ? updated : program)))
    } catch (err) {
      setError(errorMessage(err, 'Failed to persist program group in YAML frontmatter'))
    }
  }, [])

  const createActiveProjectProgramGroup = useCallback((name: string) => {
    if (!activeProjectRoot) return
    const trimmed = name.trim()
    if (!trimmed) return
    updateProjectProgramGroups(activeProjectRoot, (groups) => [
      ...groups,
      {
        id: makeProgramGroupId(),
        name: trimmed,
        programIds: [],
        collapsed: false,
      },
    ])
  }, [activeProjectRoot, updateProjectProgramGroups])

  const deleteActiveProjectProgramGroup = useCallback((groupId: string) => {
    if (!activeProjectRoot) return
    const normalizedGroupId = groupId.trim()
    if (!normalizedGroupId) return
    const removedProgramIds = activeProjectProgramGroups.find(group => group.id === normalizedGroupId)?.programIds ?? []
    updateProjectProgramGroups(activeProjectRoot, groups =>
      groups.filter(group => group.id !== normalizedGroupId),
    )
    for (const programId of removedProgramIds) {
      void persistProgramGroupAssignmentInYaml(programId, null)
    }
  }, [activeProjectProgramGroups, activeProjectRoot, persistProgramGroupAssignmentInYaml, updateProjectProgramGroups])

  const toggleActiveProjectProgramGroupCollapsed = useCallback((groupId: string) => {
    if (!activeProjectRoot) return
    const normalizedGroupId = groupId.trim()
    if (!normalizedGroupId) return
    updateProjectProgramGroups(activeProjectRoot, groups =>
      groups.map(group => (
        group.id === normalizedGroupId
          ? { ...group, collapsed: !group.collapsed }
          : group
      )),
    )
  }, [activeProjectRoot, updateProjectProgramGroups])

  const assignProgramToActiveProjectGroup = useCallback((programUuid: string, nextGroupId: string | null) => {
    if (!activeProjectRoot) return
    const normalizedProgramUuid = programUuid.trim()
    if (!normalizedProgramUuid) return
    const normalizedGroupId = nextGroupId?.trim() || null
    updateProjectProgramGroups(activeProjectRoot, (groups) => {
      const stripped = groups.map(group => ({
        ...group,
        programIds: group.programIds.filter(existing => existing !== normalizedProgramUuid),
      }))
      if (!normalizedGroupId) return stripped
      return stripped.map(group => (
        group.id === normalizedGroupId
          ? { ...group, programIds: dedupeProgramIds([...group.programIds, normalizedProgramUuid]) }
          : group
      ))
    })
    void persistProgramGroupAssignmentInYaml(normalizedProgramUuid, normalizedGroupId)
  }, [activeProjectRoot, persistProgramGroupAssignmentInYaml, updateProjectProgramGroups])

  useEffect(() => {
    if (urlHydrated) return
    const selectedNodeUuid = searchParams.get(SELECTED_NODE_QUERY_PARAM)?.trim() ?? ''
    let cancelled = false
    void (async () => {
      if (selectedNodeUuid) {
        try {
          const { node } = await invokeCapabilityOrThrow({
            capability: 'organizer.node.get',
            input: { uuid: selectedNodeUuid },
            actor: BACKLOG_ACTOR,
          })
          if (!cancelled) setSelectedNode(node ?? null)
        } catch {
          if (!cancelled) setSelectedNode(null)
        } finally {
          if (!cancelled) setUrlHydrated(true)
        }
        return
      }
      if (!cancelled) setUrlHydrated(true)
    })()
    return () => { cancelled = true }
  }, [searchParams, urlHydrated])

  useEffect(() => {
    if (!urlHydrated) return
    const currentSelectedNode = searchParams.get(SELECTED_NODE_QUERY_PARAM)?.trim() ?? ''
    const nextSelectedNode = selectedNode?.uuid ?? ''
    if (currentSelectedNode === nextSelectedNode) return
    const next = new URLSearchParams(searchParams)
    if (nextSelectedNode) next.set(SELECTED_NODE_QUERY_PARAM, nextSelectedNode)
    else next.delete(SELECTED_NODE_QUERY_PARAM)
    setSearchParams(next, { replace: true })
  }, [searchParams, selectedNode?.uuid, setSearchParams, urlHydrated])

  useEffect(() => {
    if (!urlHydrated) return
    if (activeProjectRoot) return
    if (!storedProjectRootPreference) return
    selectProject(storedProjectRootPreference)
  }, [activeProjectRoot, selectProject, storedProjectRootPreference, urlHydrated])

  const refreshExecutionProgress = useCallback(async () => {
    setActiveExecutionTasksLoading(true)
    setActiveExecutionTasksError(null)
    try {
      const tasks = await listInProgressExecutionTasksOrch({
        actor: BACKLOG_ACTOR,
        projectRoot: activeProjectRoot || undefined,
        limit: 8,
      })
      setActiveExecutionTasks(tasks)
    } catch (err) {
      setActiveExecutionTasksError(errorMessage(err, 'Failed to load execution progress'))
    } finally {
      setActiveExecutionTasksLoading(false)
    }
  }, [activeProjectRoot])

  const refreshEpicTimeline = useCallback(async () => {
    try {
      const { nodes } = await invokeCapabilityOrThrow({
        capability: 'organizer.nodes.list_all',
        input: {},
        actor: BACKLOG_ACTOR,
      })
      const epics = nodes
        .filter(node => node.type === 'epic')
        .filter(node => {
          if (!activeProjectRoot) return true
          return normalizePath(node.projectRoot ?? '') === activeProjectRoot
        })
      setCompletedEpicTimeline(sortTimelineEpics(epics))
    } catch (err) {
      console.warn('[BacklogOrch] failed to refresh epic timeline', err)
    }
  }, [activeProjectRoot])

  useEffect(() => {
    void refreshExecutionProgress()
  }, [refreshExecutionProgress])

  useEffect(() => {
    const handler = () => setProjectModalOpen(true)
    window.addEventListener(ORGANIZER_OPEN_CREATE_PROJECT_EVENT, handler)
    return () => window.removeEventListener(ORGANIZER_OPEN_CREATE_PROJECT_EVENT, handler)
  }, [])

  useEffect(() => {
    void refreshEpicTimeline()
  }, [refreshEpicTimeline])

  useEffect(() => {
    const onFocus = () => {
      void loadPrograms(false)
      void refreshEpicTimeline()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadPrograms, refreshEpicTimeline])

  useEffect(() => {
    return addGlobalSyncRefreshListenerBlock((detail) => {
      setMessage(null)
      setError(null)
      setCurrentOperation('Refreshing organizer views')
      // Invalidate BacklogListBlock's local children cache so expanded epics
      // re-fetch their children. Without this, renames inside an epic stay
      // stale and newly-created siblings stay invisible until the user
      // collapses + re-expands the parent.
      setTreeRevision(prev => prev + 1)
      void loadPrograms(false)
        .then((ok) => {
          if (!ok) return
          if (detail.vaultSyncAttempted) {
            setMessage(
              detail.vaultSyncSucceeded
                ? 'Vault synced and organizer cache refreshed.'
                : 'Organizer cache refreshed (vault sync reported an issue).',
            )
          } else {
            setMessage('Views refreshed.')
          }
        })
        .finally(() => {
          setCurrentOperation(null)
          void refreshExecutionProgress()
          void refreshEpicTimeline()
        })
    })
  }, [loadPrograms, refreshEpicTimeline, refreshExecutionProgress])

  useEffect(() => {
    if (!selectedNode) {
      setSelectedFrontmatter(null)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const { frontmatter } = await invokeCapabilityOrThrow({
          capability: 'organizer.node.read_frontmatter',
          input: { filePath: selectedNode.filePath },
          actor: BACKLOG_ACTOR,
        })
        if (!cancelled) setSelectedFrontmatter(frontmatter)
      } catch {
        if (!cancelled) setSelectedFrontmatter(null)
      }
    })()

    return () => { cancelled = true }
  }, [selectedNode])

  const availableProjects = useMemo(() => {
    const byRoot = new Map<string, ProjectEntry>()

    for (const project of projectEntries) {
      const root = normalizePath(project.root)
      if (!root) continue
      byRoot.set(root, {
        name: project.name?.trim() || humanizeKey(root.split('/')[root.split('/').length - 1] || ''),
        root,
      })
    }

    for (const program of programs) {
      const root = normalizePath(program.projectRoot ?? '')
      if (!root) continue
      if (!byRoot.has(root)) {
        byRoot.set(root, {
          name: humanizeKey(root.split('/')[root.split('/').length - 1] || ''),
          root,
        })
      }
    }

    return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [projectEntries, programs])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent<OrganizerProjectsUpdatedDetail>(
      ORGANIZER_PROJECTS_UPDATED_EVENT,
      { detail: { projects: availableProjects } },
    ))
  }, [availableProjects])

  useEffect(() => {
    if (!initialProjectLoadResolved) return
    if (availableProjects.length === 0) return

    const exists = availableProjects.some(project => project.root === activeProjectRoot)
    if (exists) return

    const fallbackFromStored = availableProjects.find(
      project => project.root === storedProjectRootPreference,
    )?.root
    const fallback = fallbackFromStored ?? availableProjects[0].root
    selectProject(fallback)
  }, [activeProjectRoot, availableProjects, initialProjectLoadResolved, selectProject, storedProjectRootPreference])

  const visiblePrograms = useMemo(() => {
    if (!activeProjectRoot) return programs
    return programs.filter(program => normalizePath(program.projectRoot ?? '') === activeProjectRoot)
  }, [activeProjectRoot, programs])

  const programTitleByKey = useMemo(() => {
    const out: Record<string, string> = {}
    for (const program of programs) {
      const title = program.title ?? ''
      const ticket = program.ticket?.trim()
      // Frontmatter often stores titles as "TICKET - description"; the row
      // chrome already renders the ticket as its own chip, so the timeline
      // label should show just the human title.
      const cleaned = ticket && title.startsWith(`${ticket} - `)
        ? title.slice(ticket.length + 3).trim()
        : title
      out[program.key] = cleaned || program.title
    }
    return out
  }, [programs])

  const handleDestinationChange = useCallback((change: CascadingFolderPickerChange) => {
    setDestinationSegments(change.baseSegments)
    setDestinationBasePath(change.basePath)
    setDestinationPath(change.destinationPath)
    setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectCreateDestination, change.baseSegments)
    setError(null)
  }, [])

  const createProject = useCallback(async () => {
    const trimmedName = newProjectName.trim()
    const normalizedProjectRoot = normalizePath(destinationBasePath)

    if (!trimmedName) {
      setError('Project name is required.')
      return
    }
    if (!normalizedProjectRoot) {
      setError('Project destination is required.')
      return
    }

    const projectRoot = normalizedProjectRoot

    setCreatingProject(true)
    setCurrentOperation(`Creating project ${trimmedName}`)
    setError(null)
    setMessage(null)

    try {
      const fs = getVaultFsOrch()
      await fs.mkdir(projectRoot)
      await fs.mkdir(`${projectRoot}/${THINKING_ORGANIZER_DIR}`)

      const nextEntries = [...projectEntries]
      const existingIdx = nextEntries.findIndex(project => normalizePath(project.root) === projectRoot)
      if (existingIdx >= 0) {
        nextEntries[existingIdx] = { name: trimmedName, root: projectRoot }
      } else {
        nextEntries.push({ name: trimmedName, root: projectRoot })
      }
      nextEntries.sort((a, b) => a.name.localeCompare(b.name))

      setProjectEntries(nextEntries)
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjects, nextEntries)
      selectProject(projectRoot)
      addRecent(PROJECT_DESTINATION_RECENTS_KEY, destinationSegments)

      setProjectModalOpen(false)
      setNewProjectName('')
      setMessage(`Created project: ${trimmedName}`)
    } catch (err) {
      setError(errorMessage(err, 'Failed to create project'))
    } finally {
      setCreatingProject(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
    }
  }, [destinationBasePath, destinationSegments, newProjectName, projectEntries, refreshExecutionProgress, selectProject])

  const createChildNode = useCallback(async (
    parent: NodeRecord | null,
    title: string,
    requestedType?: NodeType,
    details?: {
      description?: string
      comment?: string
    },
  ) => {
    const allowedTypes = allowedChildTypes(parent?.type ?? null)
    const nextType = requestedType && allowedTypes.includes(requestedType)
      ? requestedType
      : allowedTypes[0]

    if (!parent && !activeProjectRoot) {
      throw new Error('Create or select a project first.')
    }

    setCurrentOperation(`Creating ${defaultNodeKindLabel(nextType)}`)
    try {
      const { node: created } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.create',
        input: {
          type: nextType,
          title,
          parentKey: parent?.key,
          parentUuid: parent?.uuid,
          parentType: parent?.type,
          projectRoot: parent ? undefined : activeProjectRoot,
          description: details?.description,
          comments: details?.comment ? [{
            text: details.comment,
            added_at: new Date().toISOString(),
            added_by: getUserCommentAuthorBlock(),
          }] : undefined,
        },
        actor: BACKLOG_ACTOR,
      })
      if (!parent) {
        setPrograms(prev => sortBacklogNodes([...prev, created]))
      }
      setMessage(`Created ${defaultNodeKindLabel(created.type)}: ${created.title}`)
      return created
    } finally {
      setCurrentOperation(null)
      void refreshExecutionProgress()
      void refreshEpicTimeline()
    }
  }, [activeProjectRoot, refreshEpicTimeline, refreshExecutionProgress])

  const deleteNodeRecursive = useCallback(async (node: NodeRecord, removedIds: Set<string>): Promise<void> => {
    const { nodes: children } = await invokeCapabilityOrThrow({
      capability: 'organizer.nodes.list_children',
      input: { parentKey: node.key },
      actor: BACKLOG_ACTOR,
    })
    for (const child of children) {
      await deleteNodeRecursive(child, removedIds)
    }
    await invokeCapabilityOrThrow({
      capability: 'organizer.node.delete',
      input: { uuid: node.uuid },
      actor: BACKLOG_ACTOR,
    })
    removedIds.add(node.uuid)
  }, [])

  const deleteAnyNode = useCallback(async (node: NodeRecord) => {
    setWorking(true)
    setCurrentOperation(`Deleting ${node.title}`)
    setError(null)
    setMessage(null)
    try {
      const removed = new Set<string>()
      await deleteNodeRecursive(node, removed)
      await loadPrograms()
      if (selectedNode && removed.has(selectedNode.uuid)) setSelectedNode(null)
      setMessage(`Deleted: ${node.title}`)
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete node'))
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
      void refreshEpicTimeline()
    }
  }, [deleteNodeRecursive, loadPrograms, refreshEpicTimeline, refreshExecutionProgress, selectedNode])

  const renameNode = useCallback(async (newTitle: string) => {
    if (!selectedNode) return
    setWorking(true)
    setCurrentOperation(`Renaming ${selectedNode.title}`)
    setError(null)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.rename',
        input: {
          uuid: selectedNode.uuid,
          newTitle,
        },
        actor: BACKLOG_ACTOR,
      })
      if (updated.type === 'program') {
        setPrograms(prev => sortBacklogNodes(prev.map(p => p.uuid === updated.uuid ? updated : p)))
      }
      setSelectedNode(updated)
      setMessage(`Renamed to: ${updated.title}`)
    } catch (err) {
      setError(errorMessage(err, 'Failed to rename'))
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
      void refreshEpicTimeline()
    }
  }, [refreshEpicTimeline, refreshExecutionProgress, selectedNode])

  const applyUpdatedNode = useCallback((updated: NodeRecord) => {
    if (updated.type === 'program') {
      setPrograms(prev => sortBacklogNodes(prev.map(p => p.uuid === updated.uuid ? updated : p)))
    } else {
      // Propagate the update into BacklogListBlock's internal child cache
      setLastExternallyUpdatedNode(updated)
    }
    setSelectedNode(prev => (prev?.uuid === updated.uuid ? updated : prev))
  }, [])

  const updateNodeStatusFor = useCallback(async (node: NodeRecord, status: BacklogNodeStatus): Promise<NodeRecord> => {
    setWorking(true)
    setCurrentOperation(`Updating status for ${node.title}`)
    setError(null)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.update',
        input: {
          uuid: node.uuid,
          updates: { status },
        },
        actor: BACKLOG_ACTOR,
      })
      applyUpdatedNode(updated)
      return updated
    } catch (err) {
      setError(errorMessage(err, 'Failed to update status'))
      throw err
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
      void refreshEpicTimeline()
    }
  }, [applyUpdatedNode, refreshEpicTimeline, refreshExecutionProgress])

  const updateEpicCompletionDateFor = useCallback(async (
    node: NodeRecord,
    completionDate: string | null,
  ): Promise<NodeRecord> => {
    if (node.type !== 'epic') throw new Error('Completion date is only available for epics.')

    const normalizedDate = completionDate?.trim() ?? ''
    setError(null)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.update',
        input: {
          uuid: node.uuid,
          updates: {
            extraFields: {
              epic_completed_at: normalizedDate || null,
            },
          },
        },
        actor: BACKLOG_ACTOR,
      })
      applyUpdatedNode(updated)
      setCompletedEpicTimeline(prev => {
        const withoutCurrent = prev.filter(item => item.uuid !== updated.uuid)
        const inScope = !activeProjectRoot || normalizePath(updated.projectRoot ?? '') === activeProjectRoot
        if (updated.type === 'epic' && inScope) {
          return sortTimelineEpics([...withoutCurrent, updated])
        }
        return withoutCurrent
      })
      return updated
    } catch (err) {
      setError(errorMessage(err, 'Failed to update epic completion date'))
      throw err
    } finally {
      void refreshEpicTimeline()
    }
  }, [activeProjectRoot, applyUpdatedNode, refreshEpicTimeline])

  const updateStatus = useCallback(async (status: string) => {
    if (!selectedNode) return
    await updateNodeStatusFor(selectedNode, status as BacklogNodeStatus)
  }, [selectedNode, updateNodeStatusFor])

  const updateTaskStatusFor = useCallback(async (node: NodeRecord, taskStatus: BacklogTaskStatus): Promise<NodeRecord> => {
    if (!isTaskLikeNode(node)) throw new Error('Task status can only be updated for task-like nodes.')
    setWorking(true)
    setCurrentOperation(`Updating task state for ${node.title}`)
    setError(null)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'task.update_status',
        input: {
          uuid: node.uuid,
          taskStatus,
        },
        actor: BACKLOG_ACTOR,
      })
      applyUpdatedNode(updated)
      setTreeRevision(prev => prev + 1)
      return updated
    } catch (err) {
      setError(errorMessage(err, 'Failed to update task state'))
      throw err
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
      void refreshEpicTimeline()
    }
  }, [applyUpdatedNode, refreshEpicTimeline, refreshExecutionProgress])

  const updateTaskStatus = useCallback(async (taskStatus: string) => {
    if (!selectedNode) return
    if (!isTaskLikeNode(selectedNode)) return
    await updateTaskStatusFor(selectedNode, taskStatus as BacklogTaskStatus)
  }, [selectedNode, updateTaskStatusFor])

  const updatePriority = useCallback(async (priority: string) => {
    if (!selectedNode) return
    setWorking(true)
    setCurrentOperation(`Updating priority for ${selectedNode.title}`)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.update',
        input: {
          uuid: selectedNode.uuid,
          updates: { priority: priority as 'low' | 'medium' | 'high' | 'critical' },
        },
        actor: BACKLOG_ACTOR,
      })
      setSelectedNode(updated)
    } catch (err) {
      setError(errorMessage(err, 'Failed to update priority'))
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
    }
  }, [refreshExecutionProgress, selectedNode])

  const updateNodeTagsFor = useCallback(async (node: NodeRecord, tags: string[]): Promise<NodeRecord> => {
    setWorking(true)
    setCurrentOperation(`Updating tags for ${node.title}`)
    setError(null)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.update',
        input: {
          uuid: node.uuid,
          updates: {
            tags: normalizeTagListBlock(tags),
          },
        },
        actor: BACKLOG_ACTOR,
      })
      applyUpdatedNode(updated)
      return updated
    } catch (err) {
      setError(errorMessage(err, 'Failed to update tags'))
      throw err
    } finally {
      setWorking(false)
      setCurrentOperation(null)
    }
  }, [applyUpdatedNode])

  const updateNodeTags = useCallback(async (tags: string[]) => {
    if (!selectedNode) return
    await updateNodeTagsFor(selectedNode, tags)
  }, [selectedNode, updateNodeTagsFor])

  const updateNodeProjectPresetTagsFor = useCallback(async (node: NodeRecord, tags: string[]): Promise<NodeRecord> => {
    setWorking(true)
    setCurrentOperation(`Updating project tags for ${node.title}`)
    setError(null)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.update',
        input: {
          uuid: node.uuid,
          updates: {
            projectPresetTags: normalizeTagListBlock(tags),
          },
        },
        actor: BACKLOG_ACTOR,
      })
      applyUpdatedNode(updated)
      return updated
    } catch (err) {
      setError(errorMessage(err, 'Failed to update project tags'))
      throw err
    } finally {
      setWorking(false)
      setCurrentOperation(null)
    }
  }, [applyUpdatedNode])

  const updateNodeProjectPresetTags = useCallback(async (tags: string[]) => {
    if (!selectedNode) return
    await updateNodeProjectPresetTagsFor(selectedNode, tags)
  }, [selectedNode, updateNodeProjectPresetTagsFor])

  const updateNodeNotesFor = useCallback(async (
    node: NodeRecord,
    description: string,
    comments: YAMLCommentEntry[],
  ): Promise<NodeRecord> => {
    setWorking(true)
    setCurrentOperation(`Updating notes for ${node.title}`)
    setError(null)
    try {
      const { node: updated } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.update',
        input: {
          uuid: node.uuid,
          updates: {
            description,
            comments,
          },
        },
        actor: BACKLOG_ACTOR,
      })
      applyUpdatedNode(updated)
      return updated
    } catch (err) {
      setError(errorMessage(err, 'Failed to update description/comments'))
      throw err
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
    }
  }, [applyUpdatedNode, refreshExecutionProgress])

  const updateNodeNotes = useCallback(async (description: string, comments: YAMLCommentEntry[]) => {
    if (!selectedNode) return
    await updateNodeNotesFor(selectedNode, description, comments)
  }, [selectedNode, updateNodeNotesFor])

  const dropNodeToNode = useCallback(async (sourceUuid: string, targetNode: NodeRecord) => {
    setWorking(true)
    setCurrentOperation(`Moving node under ${targetNode.title}`)
    setError(null)
    setMessage(null)
    try {
      const { node: sourceNode } = await invokeCapabilityOrThrow({
        capability: 'organizer.node.get',
        input: { uuid: sourceUuid },
        actor: BACKLOG_ACTOR,
      })
      if (!sourceNode) throw new Error('Source node not found')
      if (sourceNode.uuid === targetNode.uuid) throw new Error('Cannot move a node onto itself.')
      if (!allowedChildTypes(targetNode.type).includes(sourceNode.type)) {
        throw new Error(`${defaultNodeKindLabel(sourceNode.type)} cannot be grouped under ${defaultNodeKindLabel(targetNode.type)}.`)
      }

      let cursor: NodeRecord | null = targetNode
      const seenKeys = new Set<string>()
      while (cursor && !seenKeys.has(cursor.key)) {
        seenKeys.add(cursor.key)
        if (cursor.key === sourceNode.key) {
          throw new Error('Cannot move a node under its own descendant.')
        }
        if (!cursor.parent) break
        cursor = (await invokeCapabilityOrThrow<'organizer.node.get_by_key'>({
          capability: 'organizer.node.get_by_key',
          input: { key: cursor.parent },
          actor: BACKLOG_ACTOR,
        })).node
      }

      await invokeCapabilityOrThrow({
        capability: 'organizer.node.move',
        input: {
          uuid: sourceNode.uuid,
          newParentKey: targetNode.key,
        },
        actor: BACKLOG_ACTOR,
      })
      await loadPrograms()
      setTreeRevision(prev => prev + 1)
      setMessage(`Moved ${sourceNode.title} under ${targetNode.title}`)
    } catch (err) {
      setError(errorMessage(err, 'Failed to move node'))
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
      void refreshEpicTimeline()
    }
  }, [loadPrograms, refreshEpicTimeline, refreshExecutionProgress])

  const reorderSiblingRows = useCallback(async (params: {
    parentKey: string | null
    orderedNodes: NodeRecord[]
  }): Promise<NodeRecord[]> => {
    setWorking(true)
    setCurrentOperation('Reordering rows')
    setError(null)

    const updatedById = new Map<string, NodeRecord>()

    try {
      for (let index = 0; index < params.orderedNodes.length; index += 1) {
        const node = params.orderedNodes[index]
        const nextSortOrder = index + 1
        if (node.sortOrder === nextSortOrder) continue

        const { node: updated } = await invokeCapabilityOrThrow({
          capability: 'organizer.node.update',
          input: {
            uuid: node.uuid,
            updates: {
              extraFields: {
                sort_order: nextSortOrder,
              },
            },
          },
          actor: BACKLOG_ACTOR,
        })
        updatedById.set(updated.uuid, updated)
      }

      if (updatedById.size > 0) {
        setPrograms(prev => sortBacklogNodes(
          prev.map(node => updatedById.get(node.uuid) ?? node),
        ))
        setSelectedNode(prev => (prev ? (updatedById.get(prev.uuid) ?? prev) : prev))
      }

      return params.orderedNodes.map(node => updatedById.get(node.uuid) ?? node)
    } catch (err) {
      setError(errorMessage(err, 'Failed to reorder rows'))
      throw err
    } finally {
      setWorking(false)
      setCurrentOperation(null)
    }
  }, [])

  const exportToExcalidraw = useCallback(async () => {
    setWorking(true)
    setCurrentOperation('Exporting hierarchy to Excalidraw')
    setError(null)
    setMessage(null)
    try {
      const { nodes: allNodes } = await invokeCapabilityOrThrow({
        capability: 'organizer.nodes.list_all',
        input: {},
        actor: BACKLOG_ACTOR,
      })
      if (allNodes.length === 0) { setError('No nodes to export.'); return }
      const mdContent = hierarchyToExcalidrawMdOrch(allNodes)
      const fs = getVaultFsOrch()
      const filePath = 'hierarchy-mindmap.excalidraw.md'
      await fs.write(filePath, mdContent)
      setMessage(`Exported hierarchy to ${filePath}`)
      openFile(filePath)
    } catch (err) {
      setError(errorMessage(err, 'Failed to export'))
    } finally {
      setWorking(false)
      setCurrentOperation(null)
      void refreshExecutionProgress()
    }
  }, [openFile, refreshExecutionProgress])

  const toggleProgramLayoutEditMode = useCallback(() => {
    setProgramLayoutEditMode(prev => !prev)
  }, [])

  // Stable callbacks for BacklogListBlock. These were previously defined
  // inline at the call site, which created fresh function references on
  // every render of BacklogOrch — defeating React.memo on BacklogListBlock
  // and forcing the full hierarchy list to re-render whenever any state in
  // this orchestrator changed (which it does, often).
  const handleLoadEpics = useCallback(async (program: NodeRecord) => {
    const { nodes } = await invokeCapabilityOrThrow({
      capability: 'organizer.nodes.list_children',
      input: { parentKey: program.key },
      actor: BACKLOG_ACTOR,
    })
    return nodes
  }, [])
  const handleLoadChildren = useCallback(async (node: NodeRecord) => {
    const { nodes } = await invokeCapabilityOrThrow({
      capability: 'organizer.nodes.list_children',
      input: { parentKey: node.key },
      actor: BACKLOG_ACTOR,
    })
    return nodes
  }, [])
  const handleSelectNode = useCallback((node: NodeRecord) => {
    setSelectedNode(node)
  }, [])
  const handleAssignProgramToGroup = useCallback((program: NodeRecord, groupId: string | null) => {
    assignProgramToActiveProjectGroup(program.uuid, groupId)
  }, [assignProgramToActiveProjectGroup])
  const handleRootInlineCreateCreated = useCallback(() => {
    setShowRootProgramCreate(false)
  }, [])

  const renderExecutionProgressElement = (bare: boolean) => (
    <ExecutionProgressBlock
      currentOperation={currentOperation}
      tasks={activeExecutionTasks}
      tasksLoading={activeExecutionTasksLoading}
      tasksError={activeExecutionTasksError}
      onSelectTask={(task) => {
        setSelectedNode(task)
        setMessage(`Focused task: ${task.ticket || task.title}`)
      }}
      bare={bare}
    />
  )
  const executionProgressElement = renderExecutionProgressElement(false)

  const backlogListElement = (
    <BacklogListBlock
      programs={visiblePrograms}
      loadEpics={handleLoadEpics}
      loadChildren={handleLoadChildren}
      treeRevision={treeRevision}
      externallyUpdatedNode={lastExternallyUpdatedNode}
      selectedNodeId={selectedNode?.uuid ?? null}
      onSelectNode={handleSelectNode}
      onCreateChild={createChildNode}
      onDropNodeToNode={dropNodeToNode}
      onReorderSiblings={reorderSiblingRows}
      projectPresetTagsByRoot={projectPresetTagsByRoot}
      projectTagColorsByRoot={projectTagColorsByRoot}
      programGroups={activeProjectProgramGroups}
      programGroupIdByProgram={activeProjectProgramGroupIdByProgram}
      persistenceKey={activeProjectRoot || 'all-projects'}
      onCreateProgramGroup={createActiveProjectProgramGroup}
      onDeleteProgramGroup={deleteActiveProjectProgramGroup}
      onToggleProgramGroupCollapsed={toggleActiveProjectProgramGroupCollapsed}
      onAssignProgramToGroup={handleAssignProgramToGroup}
      showProgramLayoutToggle={false}
      programLayoutEditMode={programLayoutEditMode}
      onProgramLayoutEditModeChange={setProgramLayoutEditMode}
      focusRootCreateRequestNonce={focusRootCreateRequestNonce}
      showRootInlineCreate={showRootProgramCreate}
      onRootInlineCreateCreated={handleRootInlineCreateCreated}
      onUpdateNodeStatus={updateNodeStatusFor}
      onUpdateTaskStatus={updateTaskStatusFor}
      onUpdateNodeNotes={updateNodeNotesFor}
      completedEpics={completedEpicTimeline}
      programTitleByKey={programTitleByKey}
      onSelectEpic={setSelectedNode}
    />
  )

  const projectModalBlock = (
    <>
      <div className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm" onClick={() => setProjectModalOpen(false)} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-xl border-border/80 shadow-2xl">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Create Project</CardTitle>
                <CardDescription>
                  Choose project name and destination. We will create a <code>{THINKING_ORGANIZER_DIR}</code> folder inside it.
                </CardDescription>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={() => setProjectModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Project name</label>
              <input
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                placeholder="Data Ingestion"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Project root folder</label>
              <CascadingFolderPicker
                defaultPath={destinationSegments}
                onChange={handleDestinationChange}
                requiredSuffixSegments={[THINKING_ORGANIZER_DIR]}
                previewLabel="Organizer folder preview"
                storageKey={PROJECT_DESTINATION_RECENTS_KEY}
                maxRecents={12}
              />
            </div>

            <div className="rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              Project root:{' '}
              <span className="font-mono text-foreground">
                {destinationBasePath.trim()
                  ? normalizePath(destinationBasePath)
                  : '(choose destination folder)'}
              </span>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              Organizer storage folder:{' '}
              <span className="font-mono text-foreground">
                {destinationPath.trim()
                  ? normalizePath(destinationPath)
                  : '(choose destination folder)'}
              </span>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setProjectModalOpen(false)} disabled={creatingProject}>
                Cancel
              </Button>
              <Button onClick={() => { void createProject() }} disabled={creatingProject}>
                {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Project'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )

  const bannersBlock = (message || error) ? (
    <div className="space-y-2">
      {message && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  ) : null

  const overlaysBlock = (
    <>
      {selectedNode && (
        <NodeDetailPanelBlock
          node={selectedNode}
          frontmatter={selectedFrontmatter}
          onClose={() => setSelectedNode(null)}
          onRename={renameNode}
          onUpdateStatus={updateStatus}
          onUpdateTaskStatus={updateTaskStatus}
          onUpdatePriority={updatePriority}
          onUpdateTags={updateNodeTags}
          onUpdateProjectPresetTags={updateNodeProjectPresetTags}
          presetTags={selectedProjectPresetTags}
          projectTagColors={selectedProjectTagColors}
          onUpdateNotes={updateNodeNotes}
          onUpdateEpicCompletedAt={async (completionDate) => {
            await updateEpicCompletionDateFor(selectedNode, completionDate)
          }}
          onOpenFile={() => openFile(selectedNode.filePath)}
          onDelete={() => deleteAnyNode(selectedNode)}
        />
      )}
      {projectModalOpen && projectModalBlock}
    </>
  )

  if (backlogView === 'canvas') {
    const canvasMissionTopY = BACKLOG_CANVAS_TOP_BREATHING
    const canvasExecutionTopY = canvasMissionTopY + BACKLOG_CANVAS_MISSION_HEIGHT + BACKLOG_CANVAS_MISSION_GAP
    const canvasBacklogTopY = canvasExecutionTopY + executionCanvasAnchorHeight + BACKLOG_CANVAS_CARD_GAP
    const canvasWorldHeight = canvasBacklogTopY + backlogCanvasAnchorHeight + BACKLOG_CANVAS_BOTTOM_BREATHING
    return (
      <div className="absolute inset-0">
        <CanvasSurfaceOrch
          surfaceId="thinking-org-board"
          storage={thinkingOrgCanvasStorage}
          worldWidth={BACKLOG_CANVAS_WORLD_WIDTH}
          worldHeight={canvasWorldHeight}
          clampMinScaleToFit
          initialFocus={{
            worldX: BACKLOG_CANVAS_ANCHOR_CENTER_X,
            worldY: canvasBacklogTopY + backlogCanvasAnchorHeight / 2,
            contentWidth: BACKLOG_CANVAS_CONTENT_WIDTH,
            contentHeight: backlogCanvasAnchorHeight + executionCanvasAnchorHeight + BACKLOG_CANVAS_CARD_GAP,
          }}
          worldExtras={
            <>
              <BacklogCanvasMissionBlock
                centerX={BACKLOG_CANVAS_ANCHOR_CENTER_X}
                topY={canvasMissionTopY}
                width={BACKLOG_CANVAS_CONTENT_WIDTH}
                height={BACKLOG_CANVAS_MISSION_HEIGHT}
                projectName={canvasProjectName}
                missionStatement={canvasMissionStatement}
              />
              <BacklogCanvasAnchorBlock
                centerX={BACKLOG_CANVAS_ANCHOR_CENTER_X}
                topY={canvasExecutionTopY}
                width={BACKLOG_CANVAS_CONTENT_WIDTH}
                onHeightChange={handleExecutionCanvasAnchorHeightChange}
              >
                {renderExecutionProgressElement(true)}
              </BacklogCanvasAnchorBlock>
              <BacklogCanvasAnchorBlock
                centerX={BACKLOG_CANVAS_ANCHOR_CENTER_X}
                topY={canvasBacklogTopY}
                width={BACKLOG_CANVAS_CONTENT_WIDTH}
                onHeightChange={handleBacklogCanvasAnchorHeightChange}
              >
                {backlogListElement}
              </BacklogCanvasAnchorBlock>
            </>
          }
        />
        {bannersBlock && (
          <div className="pointer-events-none absolute left-3 top-3 z-40 max-w-md space-y-2 [&>*]:pointer-events-auto">
            {bannersBlock}
          </div>
        )}
        {overlaysBlock}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {bannersBlock}

      {executionProgressElement}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-[11px]"
          onClick={() => {
            if (!showRootProgramCreate) {
              setFocusRootCreateRequestNonce(prev => prev + 1)
            }
            setShowRootProgramCreate(prev => !prev)
          }}
          disabled={loading || creatingProject}
        >
          Add New Program
        </Button>
        <div className="ml-auto flex max-w-full items-center justify-start gap-2 overflow-x-auto pb-1 whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:justify-end">
          {(working || syncing) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button
            size="sm"
            variant={programLayoutEditMode ? 'default' : 'outline'}
            className="h-7 px-2 text-[11px]"
            onClick={toggleProgramLayoutEditMode}
            disabled={loading}
          >
            {programLayoutEditMode ? 'Done Editing Layout' : 'Edit Layout'}
          </Button>
          {activeProjectRoot && (
            <TagDisclosureButtonBlock
              label="Project Tags"
              expanded={projectTagsExpanded}
              onToggle={() => setProjectTagsExpanded(prev => !prev)}
              count={activeProjectPresetTags.length}
              className="h-7 px-2 text-[11px]"
            />
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => { void exportToExcalidraw() }}
            disabled={working}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Export Excalidraw
          </Button>
        </div>
      </div>

      {activeProjectRoot && projectTagsExpanded && (
        <div className="rounded-md border border-border/70 bg-card p-3">
          <TagListEditorBlock
            heading="Project Tags"
            tags={activeProjectPresetTags}
            tagColors={activeProjectTagColors}
            emptyMessage="No project tags yet."
            draftValue={projectPresetTagDraft}
            onDraftValueChange={setProjectPresetTagDraft}
            onAddTag={addActiveProjectPresetTags}
            addPlaceholder="Add project tags (comma separated)"
            addDisabled={splitTagInputBlock(projectPresetTagDraft).length === 0}
            onRemoveTag={removeActiveProjectPresetTag}
            onChangeTagColor={setActiveProjectTagColor}
            chipTone="sky"
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading hierarchy...
        </div>
      ) : (
        <ScrollableZoomSurfaceBlock controlsLabel="Table zoom">
          {backlogListElement}
        </ScrollableZoomSurfaceBlock>
      )}

      {overlaysBlock}
    </div>
  )
}
