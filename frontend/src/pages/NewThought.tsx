import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, CheckCircle2, LayoutList, Eye, CheckSquare, X, Plus, FolderTree, Heart, Settings2, List, LayoutDashboard } from 'lucide-react'
import {
  dispatchNewThoughtSidebarChromeStateBlock,
  NEW_THOUGHT_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK,
} from '@/services/lego_blocks/units/webSidebarChromeBlock'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import CascadingFolderPicker, {
  addRecent,
  type CascadingFolderPickerChange,
} from '@/components/lego_blocks/integrations/CascadingFolderPickerBlock'
import EmotionTagger from '@/components/lego_blocks/integrations/EmotionTaggerBlock'
import InfoPanelToggleButtonBlock from '@/components/lego_blocks/units/InfoPanelToggleButtonBlock'
import MarkdownRichEditorBlock from '@/components/lego_blocks/integrations/MarkdownRichEditorLazyBlock'
import SegmentedToggleBlock from '@/components/lego_blocks/units/ui/SegmentedToggleBlock'
import CanvasSurfaceOrch from '@/components/orchestrators/CanvasSurfaceOrch'
import BacklogCanvasAnchorBlock from '@/components/lego_blocks/integrations/BacklogCanvasAnchorBlock'
import CanvasAnchorPanelBlock from '@/components/lego_blocks/units/CanvasAnchorPanelBlock'
import { createNoteFenceCanvasStorage } from '@/services/lego_blocks/integrations/noteFenceCanvasStorageBlock'
import { applyNoteCanvasToContent, parseNoteCanvasBlock } from '@/services/lego_blocks/units/noteCanvasBlock'
import ThoughtsCalendarOrch from '@/components/orchestrators/ThoughtsCalendarOrch'
import TodoCalendarOrch from '@/components/orchestrators/TodoCalendarOrch'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { openFileInNewTabOrch } from '@/services/orchestrators/fileSystemOrch'
import { invokeCapabilityOrThrow } from '@/services/orchestrators/capabilityRouterOrch'
import {
  getThoughtForEdit,
  saveThoughtEdit,
  ThoughtConflictError,
} from '@/services/orchestrators/thoughtsOrch'
import {
  readNewThoughtQuickDestinationsPreferenceOrch,
  setNewThoughtQuickDestinationsPreferenceOrch,
  type NewThoughtQuickDestinationPreferenceBlock,
} from '@/services/orchestrators/vaultUiPreferencesOrch'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'

const DESTINATION_RECENTS_KEY = 'ltm-new-note-destination-recents'
const CUSTOM_SHORTCUTS_KEY = 'ltm-new-note-custom-shortcuts'
const LEGACY_QUICK_DESTINATIONS_KEY = 'ltm-new-note-quick-destinations'
const DESTINATION_USAGE_COUNTS_KEY = 'ltm-new-note-destination-usage-counts'
const LEFT_PANEL_HIDDEN_KEY = 'ltm-new-note-left-panel-hidden'
const DEFAULT_BASE_PATH = ['lifeblood_systems', 'sfdl']

const NEW_THOUGHT_CANVAS_WORLD_WIDTH = 4500
const NEW_THOUGHT_CANVAS_ANCHOR_WIDTH = 1024
const NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X = NEW_THOUGHT_CANVAS_WORLD_WIDTH / 2
const NEW_THOUGHT_CANVAS_HEADING_TOP_Y = 320
const NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y = 500
const NEW_THOUGHT_CANVAS_BOTTOM_BREATHING = 800
const THOUGHTS_ACTOR: CapabilityActor = { kind: 'human', id: 'ui.new-note' }
const TODO_ACTOR: CapabilityActor = { kind: 'human', id: 'ui.new-note.todos' }

type Tab = 'create' | 'view' | 'view_todos'

interface DestinationShortcut {
  id: string
  label: string
  pathSegments: string[]
  builtIn?: boolean
}

type QuickDestination = NewThoughtQuickDestinationPreferenceBlock

const BUILT_IN_SHORTCUTS: DestinationShortcut[] = [
  { id: 'thoughts', label: 'Thoughts', pathSegments: ['thoughts'], builtIn: true },
  { id: 'meetings', label: 'Meetings', pathSegments: ['meetings'], builtIn: true },
  { id: 'todo', label: 'To Do', pathSegments: ['todos'], builtIn: true },
  { id: 'none', label: 'None', pathSegments: [], builtIn: true },
]

function todayFilename() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}.md`
}

function todayDateStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function normalizeSegments(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.flatMap(segment => (typeof segment === 'string' ? segment.split('/') : []))
    : (typeof value === 'string' ? value.split('/') : [])
  return parts
    .map(segment => segment.trim())
    .filter(Boolean)
}

function endsWithSegments(path: string[], suffix: string[]): boolean {
  if (suffix.length === 0) return true
  if (path.length < suffix.length) return false
  const offset = path.length - suffix.length
  for (let index = 0; index < suffix.length; index += 1) {
    if (path[offset + index] !== suffix[index]) return false
  }
  return true
}

function withSuffix(path: string[], suffix: string[]): string[] {
  return endsWithSegments(path, suffix)
    ? [...path]
    : [...path, ...suffix]
}

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJsonStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}

function readCustomShortcuts(): DestinationShortcut[] {
  const parsed = readJsonStorage<Array<{ id: string; label: string; pathSegments: string[] }>>(CUSTOM_SHORTCUTS_KEY, [])
  return parsed
    .map(shortcut => ({
      id: shortcut.id,
      label: shortcut.label.trim(),
      pathSegments: normalizeSegments(shortcut.pathSegments),
      builtIn: false,
    }))
    .filter(shortcut => shortcut.id && shortcut.label && shortcut.pathSegments.length > 0)
}

function writeCustomShortcuts(shortcuts: DestinationShortcut[]): void {
  const stored = shortcuts
    .filter(shortcut => !shortcut.builtIn)
    .map(shortcut => ({
      id: shortcut.id,
      label: shortcut.label,
      pathSegments: shortcut.pathSegments,
    }))
  writeJsonStorage(CUSTOM_SHORTCUTS_KEY, stored)
}

function readLegacyQuickDestinations(): QuickDestination[] {
  const parsed = readJsonStorage<Array<{ id: string; label: string; pathSegments: string[] }>>(LEGACY_QUICK_DESTINATIONS_KEY, [])
  return parsed
    .map((destination) => ({
      id: destination.id,
      label: destination.label.trim(),
      pathSegments: normalizeSegments(destination.pathSegments),
    }))
    .filter((destination) => destination.id && destination.label && destination.pathSegments.length > 0)
}

function clearLegacyQuickDestinations(): void {
  try {
    localStorage.removeItem(LEGACY_QUICK_DESTINATIONS_KEY)
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}

function readDestinationUsageCounts(): Record<string, number> {
  const parsed = readJsonStorage<Record<string, number>>(DESTINATION_USAGE_COUNTS_KEY, {})
  const normalized: Record<string, number> = {}
  for (const [path, count] of Object.entries(parsed)) {
    const cleanedPath = normalizeSegments(path).join('/')
    if (!cleanedPath) continue
    if (!Number.isFinite(count) || count <= 0) continue
    normalized[cleanedPath] = Math.round(count)
  }
  return normalized
}

function writeDestinationUsageCounts(counts: Record<string, number>): void {
  writeJsonStorage(DESTINATION_USAGE_COUNTS_KEY, counts)
}

function topUsedDestinations(counts: Record<string, number>, limit = 5): Array<{ path: string; count: number }> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, count]) => ({ path, count }))
}

function filenameFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `${slug}.md` : todayFilename()
}

function ensureMarkdownFilename(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return todayFilename()
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

interface TargetFileState {
  path: string
  exists: boolean
  baseMtime: number | null
  baseHash: string | null
}

function CreateTab() {
  const [tab, setTab] = useState<Tab>('create')
  const [pickerDefaultPath, setPickerDefaultPath] = useState<string[]>(DEFAULT_BASE_PATH)
  const [pickerVersion, setPickerVersion] = useState(0)
  const [folderBaseSegments, setFolderBaseSegments] = useState<string[]>([])
  const [folderBasePath, setFolderBasePath] = useState('')
  const [activeShortcutId, setActiveShortcutId] = useState<string>('thoughts')
  const [customShortcuts, setCustomShortcuts] = useState<DestinationShortcut[]>([])
  const [quickDestinations, setQuickDestinations] = useState<QuickDestination[]>([])
  const [customShortcutLabel, setCustomShortcutLabel] = useState('')
  const [customShortcutPath, setCustomShortcutPath] = useState('')
  const [quickDestinationModalOpen, setQuickDestinationModalOpen] = useState(false)
  const [quickDestinationLabel, setQuickDestinationLabel] = useState('')
  const [quickDestinationPickerDefaultPath, setQuickDestinationPickerDefaultPath] = useState<string[]>(DEFAULT_BASE_PATH)
  const [quickDestinationPickerVersion, setQuickDestinationPickerVersion] = useState(0)
  const [quickDestinationBaseSegments, setQuickDestinationBaseSegments] = useState<string[]>([])
  const [quickDestinationBasePath, setQuickDestinationBasePath] = useState('')
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})
  const [filename, setFilename] = useState(todayFilename())
  const [filenameTouched, setFilenameTouched] = useState(false)
  const [useCustomTitle, setUseCustomTitle] = useState(false)
  const [title, setTitle] = useState('')
  const [dateHeader, setDateHeader] = useState(true)
  const [makeThisTodo, setMakeThisTodo] = useState(false)
  const [shortcutBeforeTodoMode, setShortcutBeforeTodoMode] = useState('thoughts')
  const [todoDateStr, setTodoDateStr] = useState(todayDateStr())
  const [itemsAdded, setItemsAdded] = useState(0)
  const [content, setContent] = useState('')
  const [viewSurface, setViewSurface] = useState<'doc' | 'canvas'>('doc')
  const [canvasAnchorHeight, setCanvasAnchorHeight] = useState(800)
  // Refs let the canvas adapter (created once) always see the latest content
  // without remounting CanvasSurfaceOrch (which would reset pan/zoom).
  const canvasContentRef = useRef(content)
  canvasContentRef.current = content
  const canvasStorage = useMemo(
    () =>
      createNoteFenceCanvasStorage({
        getValue: () => canvasContentRef.current,
        onWrite: (next) => setContent(next),
      }),
    [],
  )
  // The rich editor only sees the markdown body — the canvas fence is hidden
  // so users don't stare at raw JSON in doc mode. On editor edits we re-apply
  // any existing canvas tiles back into the body before storing.
  const editorBody = useMemo(() => parseNoteCanvasBlock(content).bodyWithoutCanvas, [content])
  const handleEditorBodyChange = useCallback((nextBody: string) => {
    const { tiles, hadFence } = parseNoteCanvasBlock(canvasContentRef.current)
    setContent(hadFence ? applyNoteCanvasToContent(nextBody, tiles) : nextBody)
  }, [])
  const [emotions, setEmotions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loadingTargetContent, setLoadingTargetContent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [showMetaPanel, setShowMetaPanel] = useState(false)
  const [revealedPanel, setRevealedPanel] = useState<'destination' | 'emotions' | 'note-settings' | null>(null)
  const [showAiAssist, setShowAiAssist] = useState(false)
  const [saveFeedbackVisible, setSaveFeedbackVisible] = useState(false)
  const [loadedTargetPath, setLoadedTargetPath] = useState<string | null>(null)
  const [targetFileState, setTargetFileState] = useState<TargetFileState | null>(null)
  const saveFeedbackTimeoutRef = useRef<number | null>(null)
  const loadTargetRequestRef = useRef(0)
  const contentRef = useRef('')
  const loadedBaseContentRef = useRef('')
  useEffect(() => { contentRef.current = content }, [content])
  const [leftPanelHidden, setLeftPanelHidden] = useState(
    () => readJsonStorage<boolean>(LEFT_PANEL_HIDDEN_KEY, false),
  )

  const triggerSaveFeedback = useCallback(() => {
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current)
    }
    setSaveFeedbackVisible(true)
    saveFeedbackTimeoutRef.current = window.setTimeout(() => {
      setSaveFeedbackVisible(false)
      saveFeedbackTimeoutRef.current = null
    }, 1600)
  }, [])

  useEffect(() => {
    setCustomShortcuts(readCustomShortcuts())
    setUsageCounts(readDestinationUsageCounts())

    let cancelled = false
    const loadQuickDestinations = async () => {
      try {
        const persisted = await readNewThoughtQuickDestinationsPreferenceOrch()
        if (cancelled) return
        if (persisted.length > 0) {
          setQuickDestinations(persisted)
          clearLegacyQuickDestinations()
          return
        }
      } catch {
        // Fall back to legacy storage.
      }

      const legacy = readLegacyQuickDestinations()
      if (cancelled) return
      setQuickDestinations(legacy)

      if (legacy.length === 0) return
      try {
        await setNewThoughtQuickDestinationsPreferenceOrch(legacy)
        if (cancelled) return
        clearLegacyQuickDestinations()
      } catch {
        // Keep legacy storage as fallback if vault preference write fails.
      }
    }

    void loadQuickDestinations()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    writeJsonStorage(LEFT_PANEL_HIDDEN_KEY, leftPanelHidden)
  }, [leftPanelHidden])

  useEffect(() => {
    dispatchNewThoughtSidebarChromeStateBlock({ enabled: true, collapsed: leftPanelHidden })
  }, [leftPanelHidden])

  useEffect(() => {
    return () => {
      dispatchNewThoughtSidebarChromeStateBlock({ enabled: false, collapsed: false })
    }
  }, [])

  useEffect(() => {
    const handler = () => setLeftPanelHidden(prev => !prev)
    window.addEventListener(NEW_THOUGHT_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
    return () => window.removeEventListener(NEW_THOUGHT_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
  }, [])

  useEffect(() => {
    return () => {
      if (saveFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(saveFeedbackTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (activeShortcutId !== 'todo') {
      setShortcutBeforeTodoMode(activeShortcutId)
    }
  }, [activeShortcutId])

  const allShortcuts = useMemo(
    () => [...BUILT_IN_SHORTCUTS, ...customShortcuts],
    [customShortcuts],
  )

  const shortcutsById = useMemo(() => {
    const map = new Map<string, DestinationShortcut>()
    for (const shortcut of allShortcuts) map.set(shortcut.id, shortcut)
    return map
  }, [allShortcuts])

  const activeShortcut = shortcutsById.get(activeShortcutId) ?? BUILT_IN_SHORTCUTS[0]
  const destinationSegments = useMemo(
    () => withSuffix(folderBaseSegments, activeShortcut.pathSegments),
    [activeShortcut.pathSegments, folderBaseSegments],
  )
  const destinationPath = destinationSegments.join('/')
  const normalizedFilename = ensureMarkdownFilename(filename)

  const rememberDestinationUsage = useCallback((segments: string[]) => {
    const normalized = normalizeSegments(segments)
    if (normalized.length === 0) return
    addRecent(DESTINATION_RECENTS_KEY, normalized)
    setUsageCounts((previous) => {
      const key = normalized.join('/')
      const next = {
        ...previous,
        [key]: (previous[key] ?? 0) + 1,
      }
      writeDestinationUsageCounts(next)
      return next
    })
  }, [])

  const persistQuickDestinations = useCallback(async (next: QuickDestination[]) => {
    setQuickDestinations(next)
    try {
      await setNewThoughtQuickDestinationsPreferenceOrch(next)
      clearLegacyQuickDestinations()
    } catch {
      writeJsonStorage(LEGACY_QUICK_DESTINATIONS_KEY, next)
    }
  }, [])

  useEffect(() => {
    if (!useCustomTitle) return
    if (filenameTouched) return
    setFilename(filenameFromTitle(title))
  }, [filenameTouched, title, useCustomTitle])

  // Stable so MarkdownRichEditorBlock's memo isn't broken by an inline arrow.
  // Without this, the editor re-renders on every NewThought render, which
  // triggers CodeMirror's measure→paint→remeasure cascade (~600ms).
  const handleRelatedThoughtOpenPath = useCallback((relatedPath: string) => {
    openFileInNewTabOrch(relatedPath)
    setMessage(`Opened ${relatedPath} in a new tab.`)
  }, [])

  const handleFolderChange = (change: CascadingFolderPickerChange) => {
    setFolderBaseSegments(change.baseSegments)
    setFolderBasePath(change.basePath)
    setSavedPath(null)
    setItemsAdded(0)
    setError(null)
    setMessage(null)
  }

  const handleShortcutSelect = (shortcutId: string) => {
    setActiveShortcutId(shortcutId)
    const shortcut = shortcutsById.get(shortcutId)
    if (!shortcut || folderBaseSegments.length === 0) return
    rememberDestinationUsage(withSuffix(folderBaseSegments, shortcut.pathSegments))
  }

  const handleMakeThisTodoChange = (checked: boolean) => {
    setMakeThisTodo(checked)
    if (checked) {
      if (activeShortcutId !== 'todo') {
        setShortcutBeforeTodoMode(activeShortcutId)
        setActiveShortcutId('todo')
      }
      return
    }
    if (activeShortcutId === 'todo') {
      setActiveShortcutId(shortcutBeforeTodoMode || 'thoughts')
    }
  }

  const applyDestinationSegments = useCallback((segments: string[]) => {
    const normalized = normalizeSegments(segments)
    if (normalized.length === 0) return
    setPickerDefaultPath(normalized)
    setPickerVersion(current => current + 1)
    setFolderBaseSegments(normalized)
    setFolderBasePath(normalized.join('/'))
    setActiveShortcutId('none')
    setSavedPath(null)
    setError(null)
    setMessage(null)
    rememberDestinationUsage(normalized)
  }, [rememberDestinationUsage])

  const handleApplyDestinationPath = (path: string) => {
    applyDestinationSegments(normalizeSegments(path))
  }

  const handleAddCustomShortcut = () => {
    const label = customShortcutLabel.trim()
    const pathSegments = normalizeSegments(customShortcutPath)
    if (!label || pathSegments.length === 0) {
      setError('Custom shortcut needs both a label and path suffix.')
      return
    }
    const shortcut: DestinationShortcut = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      pathSegments,
      builtIn: false,
    }
    const next = [...customShortcuts, shortcut]
    setCustomShortcuts(next)
    writeCustomShortcuts(next)
    setCustomShortcutLabel('')
    setCustomShortcutPath('')
    setError(null)
    setMessage(`Added shortcut "${label}".`)
  }

  const handleDeleteCustomShortcut = (shortcutId: string) => {
    const next = customShortcuts.filter(shortcut => shortcut.id !== shortcutId)
    setCustomShortcuts(next)
    writeCustomShortcuts(next)
    if (activeShortcutId === shortcutId) setActiveShortcutId('thoughts')
    setMessage('Removed custom shortcut.')
  }

  const openQuickDestinationModal = () => {
    const seedSegments = destinationSegments.length > 0 ? destinationSegments : folderBaseSegments
    const nextSeed = seedSegments.length > 0 ? seedSegments : DEFAULT_BASE_PATH
    setQuickDestinationLabel('')
    setQuickDestinationPickerDefaultPath(nextSeed)
    setQuickDestinationPickerVersion(current => current + 1)
    setQuickDestinationBaseSegments(nextSeed)
    setQuickDestinationBasePath(nextSeed.join('/'))
    setQuickDestinationModalOpen(true)
  }

  const handleQuickDestinationFolderChange = (change: CascadingFolderPickerChange) => {
    setQuickDestinationBaseSegments(change.baseSegments)
    setQuickDestinationBasePath(change.basePath)
  }

  const handleAddQuickDestination = () => {
    const label = quickDestinationLabel.trim()
    const pathSegments = normalizeSegments(quickDestinationBaseSegments)
    if (!label || pathSegments.length === 0) {
      setError('Quick destination needs both a label and destination folder.')
      return
    }
    const destination: QuickDestination = {
      id: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      pathSegments,
    }
    const next = [...quickDestinations, destination]
    void persistQuickDestinations(next)
    setQuickDestinationModalOpen(false)
    setQuickDestinationLabel('')
    setQuickDestinationBaseSegments([])
    setQuickDestinationBasePath('')
    setError(null)
    setMessage(`Added quick destination "${label}".`)
  }

  const handleDeleteQuickDestination = (id: string) => {
    const next = quickDestinations.filter(destination => destination.id !== id)
    void persistQuickDestinations(next)
    setMessage('Removed quick destination.')
  }

  const handleCustomTitleToggle = (enabled: boolean) => {
    setUseCustomTitle(enabled)
    if (!enabled) {
      setTitle('')
      setFilename(todayFilename())
      setFilenameTouched(false)
      return
    }
    setFilenameTouched(false)
    setFilename(filenameFromTitle(title))
  }

  const targetPath = makeThisTodo
    ? (
      destinationPath.trim() && todoDateStr.trim()
        ? `${destinationPath.replace(/\/$/, '')}/${todoDateStr.trim()}.md`
        : null
    )
    : (
      destinationPath.trim() && filename.trim()
        ? `${destinationPath.replace(/\/$/, '')}/${normalizedFilename}`
        : null
    )

  const handleSave = useCallback(async () => {
    if (!makeThisTodo && loadingTargetContent) return
    if (makeThisTodo) {
      const items = content
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
      if (!destinationPath.trim() || !todoDateStr.trim() || items.length === 0) return
    } else if (!destinationPath.trim() || !filename.trim() || !content.trim()) {
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    setSavedPath(null)
    setItemsAdded(0)

    try {
      if (makeThisTodo) {
        const items = content
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
        const data = await invokeCapabilityOrThrow({
          capability: 'todos.create',
          input: {
            folderPath: destinationPath,
            date: todoDateStr,
            items,
          },
          actor: TODO_ACTOR,
        })

        setSavedPath(data.output_path)
        setItemsAdded(data.items_added)
        rememberDestinationUsage(destinationSegments)
        setMessage(`${data.items_added} task${data.items_added !== 1 ? 's' : ''} saved to ${data.output_path}.`)
        triggerSaveFeedback()
        return
      }

      const canSaveExistingFile = Boolean(
        targetPath
        && targetFileState?.path === targetPath
        && targetFileState.exists
        && targetFileState.baseMtime !== null
        && targetFileState.baseHash,
      )

      if (canSaveExistingFile) {
        const data = await saveThoughtEdit({
          path: targetPath!,
          content,
          baseMtime: targetFileState!.baseMtime!,
          baseHash: targetFileState!.baseHash!,
        })
        const refreshed = await getThoughtForEdit(targetPath!)
        loadedBaseContentRef.current = refreshed.content
        setContent(refreshed.content)
        setLoadedTargetPath(targetPath!)
        setTargetFileState({
          path: targetPath!,
          exists: true,
          baseMtime: refreshed.mtime,
          baseHash: refreshed.hash,
        })
        setSavedPath(data.output_path)
        rememberDestinationUsage(destinationSegments)
        setMessage(`Saved ${data.output_path}.`)
        triggerSaveFeedback()
        return
      }

      const data = await invokeCapabilityOrThrow({
        capability: 'thoughts.create',
        input: {
          folder_path: destinationPath,
          filename: normalizedFilename,
          content,
          title: useCustomTitle ? (title.trim() || null) : null,
          date_header: dateHeader,
          emotions,
        },
        actor: THOUGHTS_ACTOR,
      })

      const refreshed = await getThoughtForEdit(data.output_path)
      loadedBaseContentRef.current = refreshed.content
      setContent(refreshed.content)
      setLoadedTargetPath(data.output_path)
      setTargetFileState({
        path: data.output_path,
        exists: true,
        baseMtime: refreshed.mtime,
        baseHash: refreshed.hash,
      })
      setSavedPath(data.output_path)
      rememberDestinationUsage(destinationSegments)
      setMessage(`Saved ${data.output_path}.`)
      triggerSaveFeedback()
    } catch (err) {
      if (!makeThisTodo && err instanceof ThoughtConflictError && targetPath) {
        loadedBaseContentRef.current = err.currentContent
        setContent(err.currentContent)
        setLoadedTargetPath(targetPath)
        setTargetFileState({
          path: targetPath,
          exists: true,
          baseMtime: err.currentMtime,
          baseHash: err.currentHash,
        })
      }
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }, [
    content,
    dateHeader,
    destinationPath,
    destinationSegments,
    emotions,
    filename,
    loadingTargetContent,
    makeThisTodo,
    normalizedFilename,
    rememberDestinationUsage,
    targetFileState,
    targetPath,
    title,
    todoDateStr,
    triggerSaveFeedback,
    useCustomTitle,
  ])

  useEffect(() => {
    const computeDraft = () => {
      const current = contentRef.current
      const base = loadedBaseContentRef.current
      if (!current) return ''
      if (!base) return current
      if (current.startsWith(base)) return current.slice(base.length)
      return current
    }
    const mergeDraft = (base: string, draft: string) => {
      if (!draft) return base
      if (!base) return draft
      return base.endsWith('\n') || draft.startsWith('\n') ? base + draft : base + '\n' + draft
    }

    if (makeThisTodo) {
      setLoadingTargetContent(false)
      setLoadedTargetPath(null)
      setTargetFileState(null)
      setSavedPath(null)
      setContent('')
      loadedBaseContentRef.current = ''
      return
    }
    if (!targetPath) {
      setLoadedTargetPath(null)
      setTargetFileState(null)
      setSavedPath(null)
      loadedBaseContentRef.current = ''
      return
    }
    if (targetPath === loadedTargetPath) return

    const preservedDraft = computeDraft()

    const requestId = loadTargetRequestRef.current + 1
    loadTargetRequestRef.current = requestId
    let cancelled = false
    setLoadingTargetContent(true)
    setSavedPath(null)
    setError(null)

    void (async () => {
      try {
        const fs = getVaultFS()
        const exists = await fs.exists(targetPath)
        if (cancelled || requestId !== loadTargetRequestRef.current) return
        if (!exists) {
          loadedBaseContentRef.current = ''
          setContent(preservedDraft)
          setLoadedTargetPath(targetPath)
          setTargetFileState({
            path: targetPath,
            exists: false,
            baseMtime: null,
            baseHash: null,
          })
          return
        }
        const existing = await getThoughtForEdit(targetPath)
        if (cancelled || requestId !== loadTargetRequestRef.current) return
        loadedBaseContentRef.current = existing.content
        setContent(mergeDraft(existing.content, preservedDraft))
        setLoadedTargetPath(targetPath)
        setTargetFileState({
          path: targetPath,
          exists: true,
          baseMtime: existing.mtime,
          baseHash: existing.hash,
        })
      } catch (err) {
        if (cancelled || requestId !== loadTargetRequestRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load destination note')
      } finally {
        if (cancelled || requestId !== loadTargetRequestRef.current) return
        setLoadingTargetContent(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadedTargetPath, makeThisTodo, targetPath])

  const contentMeta = useMemo(() => {
    const normalized = content.replace(/\r\n/g, '\n')
    const trimmed = normalized.trim()
    return {
      lines: trimmed ? normalized.split('\n').length : 0,
      words: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
      headings: (normalized.match(/^#{1,6}\s/gm) || []).length,
      size: formatBytes(new TextEncoder().encode(normalized).length),
    }
  }, [content])
  const titleForPreview = useMemo(() => {
    if (useCustomTitle && title.trim()) return title.trim()
    return normalizedFilename.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim() || 'untitled'
  }, [normalizedFilename, title, useCustomTitle])
  const frontmatterPreview = useMemo(() => {
    const lines = [
      `title: ${JSON.stringify(titleForPreview)}`,
      'type: thought',
      'status: active',
    ]
    if (emotions.length > 0) {
      lines.push('emotions:')
      for (const emotion of emotions) lines.push(`  - ${JSON.stringify(emotion)}`)
    }
    lines.push('created_at: <generated on save>')
    lines.push('updated_at: <generated on save>')
    return lines.join('\n')
  }, [emotions, titleForPreview])

  const todoItemCount = useMemo(
    () => content.split('\n').map(line => line.trim()).filter(Boolean).length,
    [content],
  )
  const canSave = makeThisTodo
    ? Boolean(destinationPath.trim() && todoDateStr.trim() && todoItemCount > 0 && !saving)
    : Boolean(destinationPath.trim() && filename.trim() && content.trim() && !saving && !loadingTargetContent)
  const mostUsedDestinations = useMemo(() => topUsedDestinations(usageCounts, 5), [usageCounts])

  const destinationPanel = (
        <Card>
          <CardContent className="pt-4">
            <div className="space-y-2 pb-1">
              <label className="text-xs text-muted-foreground">Base folder path</label>
              <p className="text-[11px] text-muted-foreground/70 break-all">
                {folderBasePath || '(choose a folder)'}
              </p>
            </div>
            <CascadingFolderPicker
              key={`new-note-picker-${pickerVersion}`}
              defaultPath={pickerDefaultPath}
              onChange={handleFolderChange}
              previewLabel="Destination preview"
              storageKey={DESTINATION_RECENTS_KEY}
            />

            <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
              <label className="text-xs text-muted-foreground">Shortcuts</label>
              <div className="flex flex-wrap gap-2">
                {allShortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className={`inline-flex items-center rounded-full border px-1 py-1 ${
                      activeShortcutId === shortcut.id
                        ? 'border-primary/80 bg-primary text-primary-foreground'
                        : 'border-border/60 bg-muted/20 text-muted-foreground'
                    }`}
                  >
                    <button
                      type="button"
                      className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90"
                      onClick={() => handleShortcutSelect(shortcut.id)}
                    >
                      {shortcut.label}
                    </button>
                    {!shortcut.builtIn && (
                      <button
                        type="button"
                        className={`rounded-full p-1 transition-colors ${
                          activeShortcutId === shortcut.id
                            ? 'text-primary-foreground/90 hover:bg-primary-foreground/20'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                        onClick={() => handleDeleteCustomShortcut(shortcut.id)}
                        title={`Remove shortcut ${shortcut.label}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="grid gap-2">
                <input
                  value={customShortcutLabel}
                  onChange={(event) => setCustomShortcutLabel(event.target.value)}
                  placeholder="Shortcut name"
                  className="h-8 rounded-full border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <input
                    value={customShortcutPath}
                    onChange={(event) => setCustomShortcutPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleAddCustomShortcut()
                      }
                    }}
                    placeholder="Path suffix (example: clients/acme/notes)"
                    className="h-8 flex-1 rounded-full border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-full border border-border/70 bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    onClick={handleAddCustomShortcut}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {mostUsedDestinations.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
                <label className="text-xs text-muted-foreground">Most used (top 5)</label>
                <div className="space-y-1.5">
                  {mostUsedDestinations.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => handleApplyDestinationPath(entry.path)}
                      className="flex w-full items-center justify-between rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span className="min-w-0 break-all">{entry.path}</span>
                      <span className="ml-2 shrink-0 tabular-nums">{entry.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 border-t border-border/40 pt-3">
              <p className="text-[11px] text-muted-foreground/70 break-all">
                Active destination: {destinationPath || '(choose a folder)'}
              </p>
            </div>
          </CardContent>
        </Card>
  )

  const emotionsPanel = (
    <Card>
      <CardContent className="pt-4">
        <EmotionTagger selected={emotions} onChange={setEmotions} />
      </CardContent>
    </Card>
  )

  const noteSettingsPanel = (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center gap-3">
          <Switch checked={dateHeader} onCheckedChange={setDateHeader} id="date-header" />
          <label htmlFor="date-header" className="text-sm text-muted-foreground cursor-pointer">
            Add date header
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={useCustomTitle} onCheckedChange={handleCustomTitleToggle} id="custom-title" />
          <label htmlFor="custom-title" className="text-sm text-muted-foreground cursor-pointer">
            Use custom title
          </label>
        </div>
      </CardContent>
    </Card>
  )

  const revealButtons: Array<{ id: 'destination' | 'emotions' | 'note-settings'; label: string; icon: typeof FolderTree; disabled?: boolean }> = [
    { id: 'destination', label: 'Destination', icon: FolderTree },
    { id: 'emotions', label: 'Emotions', icon: Heart, disabled: makeThisTodo },
    { id: 'note-settings', label: 'Note Settings', icon: Settings2, disabled: makeThisTodo },
  ]

  return (
    <div className="ltm-newthought-shell flex h-full min-h-0 w-full">
      {!leftPanelHidden && (
        <aside className="w-[220px] shrink-0 border-r border-border/60 bg-background/40 px-3 py-4">
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            New Note
          </p>
          <nav className="space-y-1">
            {([
              { id: 'create', label: 'Create', icon: LayoutList },
              { id: 'view', label: 'View Notes', icon: Eye },
              { id: 'view_todos', label: 'View To Dos', icon: CheckSquare },
            ] as const).map(item => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'ltm-motion-fast flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>
      )}

      <div className={cn(
        'relative min-w-0 flex-1',
        tab === 'create' && viewSurface === 'canvas' ? 'overflow-hidden' : 'overflow-auto px-6 pb-5 pt-14',
      )}>
        {tab === 'create' && (
          <div className="absolute right-3 top-3 z-40">
            <SegmentedToggleBlock
              value={viewSurface}
              onChange={setViewSurface}
              ariaLabel="Note view"
              options={[
                { value: 'doc', label: 'Doc', icon: List, title: 'Document view' },
                { value: 'canvas', label: 'Canvas', icon: LayoutDashboard, title: 'Canvas view' },
              ]}
            />
          </div>
        )}
        {tab === 'view' && <ThoughtsCalendarOrch />}
        {tab === 'view_todos' && <TodoCalendarOrch />}
        {tab === 'create' && (() => {
          const createTabBlock = (
          <div className="space-y-4">
            {(message || error) && (
              <div className="space-y-2">
                {message && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                    {message}
                  </div>
                )}
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-hidden">
              <MarkdownRichEditorBlock
                value={editorBody}
                onChange={handleEditorBodyChange}
                currentPath={targetPath ?? ''}
                placeholder={makeThisTodo ? 'One task per line...' : "What's on your mind?"}
                toolbarAlwaysVisible
                aiPanelOpen={showAiAssist}
                onAiPanelOpenChange={setShowAiAssist}
                aiAssistScope="new_thought"
                aiAssistUseCase="new_thought.assist"
                aiAssistDisabled={saving || loadingTargetContent}
                aiAssistHelperText="Suggestions apply inline. Configure provider/model in AI Settings."
                onRelatedThoughtOpenPath={handleRelatedThoughtOpenPath}
                className="min-h-[520px] rounded-none border-0 border-b border-border/40 md:min-h-[620px]"
              />

              <div className="space-y-3 p-4">
                {makeThisTodo && (
                  <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Each non-empty line is saved as a checklist item in the selected todo note.
                  </div>
                )}

                {showMetaPanel && (
                  <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span><strong className="text-foreground/70">{contentMeta.lines}</strong> lines</span>
                      <span><strong className="text-foreground/70">{contentMeta.words}</strong> words</span>
                      <span><strong className="text-foreground/70">{contentMeta.headings}</strong> headings</span>
                      <span>{contentMeta.size}</span>
                    </div>
                    <div className="space-y-1.5 border-t border-border/30 pt-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        YAML Metadata
                      </div>
                      <textarea
                        value={frontmatterPreview}
                        readOnly
                        spellCheck={false}
                        className="min-h-[8rem] w-full rounded-md border border-border/60 bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none"
                        aria-label="YAML metadata preview"
                      />
                      <div className="text-[11px] text-muted-foreground">
                        Preview only. Final metadata is generated on save.
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">{makeThisTodo ? 'Date' : 'Filename'}</label>
                  <InfoPanelToggleButtonBlock active={showMetaPanel} onToggle={() => setShowMetaPanel(v => !v)} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
                  <div className="space-y-2">
                    {makeThisTodo ? (
                      <input
                        type="date"
                        value={todoDateStr}
                        onChange={(event) => setTodoDateStr(event.target.value)}
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      />
                    ) : (
                      <input
                        value={filename}
                        onChange={(event) => {
                          setFilename(event.target.value)
                          setFilenameTouched(true)
                        }}
                        placeholder="2026-02-26.md"
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      />
                    )}
                  </div>

                  <div className="sm:justify-self-end sm:self-end">
                    <label
                      htmlFor="compose-make-this-todo"
                      className="inline-flex h-10 cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground"
                    >
                      <input
                        id="compose-make-this-todo"
                        type="checkbox"
                        checked={makeThisTodo}
                        onChange={(event) => handleMakeThisTodoChange(event.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary focus:ring-2 focus:ring-ring"
                      />
                      <span>Make this a todo</span>
                    </label>
                  </div>
                </div>

                {!makeThisTodo && (
                  <p className="text-[11px] text-muted-foreground/70">
                    Saved as: {normalizedFilename}
                  </p>
                )}

                {makeThisTodo ? (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Detected items</label>
                    <div className="h-10 rounded-lg border border-input bg-background px-3 text-sm flex items-center">
                      {todoItemCount} item{todoItemCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                ) : (
                  <>
                    {useCustomTitle && (
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Custom title</label>
                        <input
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder="Becomes the note title + heading"
                          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        />
                      </div>
                    )}
                  </>
                )}

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Quick destinations</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {quickDestinations.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No quick destinations yet.
                      </span>
                    ) : (
                      quickDestinations.map((destination) => {
                        const destinationPathValue = destination.pathSegments.join('/')
                        const active = destinationPathValue === destinationPath
                        return (
                          <div
                            key={destination.id}
                            className={`inline-flex items-center rounded-full border px-1 py-1 ${
                              active
                                ? 'border-primary/80 bg-primary text-primary-foreground'
                                : 'border-border/60 bg-background text-foreground'
                            }`}
                          >
                            <button
                              type="button"
                              className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90"
                              title={destinationPathValue}
                              onClick={() => applyDestinationSegments(destination.pathSegments)}
                            >
                              {destination.label}
                            </button>
                            <button
                              type="button"
                              className={`rounded-full p-1 transition-colors ${
                                active
                                  ? 'text-primary-foreground/90 hover:bg-primary-foreground/20'
                                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                              }`}
                              title={`Remove quick destination ${destination.label}`}
                              onClick={() => handleDeleteQuickDestination(destination.id)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      })
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 rounded-full"
                      onClick={openQuickDestinationModal}
                      title="Add quick destination"
                      aria-label="Add quick destination"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                    {makeThisTodo ? 'Destination todo file' : 'Destination file'}:{' '}
                    {targetPath ? (
                      <button
                        type="button"
                        onClick={() => openFileInNewTabOrch(targetPath)}
                        className="font-mono text-foreground break-all underline decoration-dotted underline-offset-2 hover:text-primary"
                        title="Open in Thinking Space explorer (new tab)"
                      >
                        {targetPath}
                      </button>
                    ) : (
                      <span className="font-mono text-foreground break-all">
                        {makeThisTodo ? '(select destination + date)' : '(select destination + filename)'}
                      </span>
                    )}
                  </div>
                  <Button
                    onClick={handleSave}
                    disabled={!canSave}
                    className={saveFeedbackVisible && !saving
                      ? 'ltm-animate-fade-in bg-emerald-600 text-white hover:bg-emerald-600'
                      : undefined}
                  >
                    {saving
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : (saveFeedbackVisible ? 'Saved' : 'Save')}
                  </Button>
                </div>

                {!makeThisTodo && loadingTargetContent && (
                  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Loading destination note...
                  </div>
                )}

                {savedPath && (
                  <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <span>
                      {makeThisTodo
                        ? (
                          <>
                            {itemsAdded} task{itemsAdded !== 1 ? 's' : ''} saved to <span className="font-medium text-foreground">{savedPath}</span>
                          </>
                        )
                        : (
                          <>
                            Saved to <span className="font-medium text-foreground">{savedPath}</span>
                          </>
                        )}
                    </span>
                  </div>
                )}

              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {revealButtons.map(({ id, label, icon: Icon, disabled }) => {
                const active = revealedPanel === id
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setRevealedPanel(active ? null : id)}
                    className={cn(
                      'ltm-motion-fast inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                      disabled && 'opacity-40 cursor-not-allowed hover:bg-background hover:text-muted-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                )
              })}
            </div>

            {revealedPanel === 'destination' && destinationPanel}
            {revealedPanel === 'emotions' && !makeThisTodo && emotionsPanel}
            {revealedPanel === 'note-settings' && !makeThisTodo && noteSettingsPanel}
          </div>
          )
          return viewSurface === 'canvas' ? (
            <div className="absolute inset-0">
              <CanvasSurfaceOrch
                surfaceId={`new-thought:${targetPath ?? 'draft'}`}
                storage={canvasStorage}
                worldWidth={NEW_THOUGHT_CANVAS_WORLD_WIDTH}
                worldHeight={NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y + canvasAnchorHeight + NEW_THOUGHT_CANVAS_BOTTOM_BREATHING}
                clampMinScaleToFit
                initialFocus={{
                  worldX: NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X,
                  worldY: NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y + canvasAnchorHeight / 2,
                  contentWidth: NEW_THOUGHT_CANVAS_ANCHOR_WIDTH,
                  contentHeight: canvasAnchorHeight,
                }}
                worldExtras={
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        left: NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X - NEW_THOUGHT_CANVAS_ANCHOR_WIDTH / 2,
                        top: NEW_THOUGHT_CANVAS_HEADING_TOP_Y,
                        width: NEW_THOUGHT_CANVAS_ANCHOR_WIDTH,
                        textAlign: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <div className="text-3xl font-semibold tracking-tight text-foreground/90">
                        What's on your mind today?
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        Compose below. Right-click anywhere on the canvas to drop a sticky.
                      </div>
                    </div>
                    <BacklogCanvasAnchorBlock
                      centerX={NEW_THOUGHT_CANVAS_ANCHOR_CENTER_X}
                      topY={NEW_THOUGHT_CANVAS_ANCHOR_TOP_Y}
                      width={NEW_THOUGHT_CANVAS_ANCHOR_WIDTH}
                      onHeightChange={setCanvasAnchorHeight}
                    >
                      {createTabBlock}
                    </BacklogCanvasAnchorBlock>
                  </>
                }
              />
            </div>
          ) : (
            <CanvasAnchorPanelBlock>
              {createTabBlock}
            </CanvasAnchorPanelBlock>
          )
        })()}
      </div>

      {quickDestinationModalOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm"
            onClick={() => setQuickDestinationModalOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl border-border/80 shadow-2xl">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Add Quick Destination</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Create a top-panel destination button (for example, Webull Thoughts).
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    onClick={() => setQuickDestinationModalOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Button label</label>
                  <input
                    value={quickDestinationLabel}
                    onChange={(event) => setQuickDestinationLabel(event.target.value)}
                    placeholder="Webull Thoughts"
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Destination folder</label>
                  <p className="text-[11px] text-muted-foreground/70 break-all">
                    {quickDestinationBasePath || '(choose a folder)'}
                  </p>
                  <CascadingFolderPicker
                    key={`quick-destination-picker-${quickDestinationPickerVersion}`}
                    defaultPath={quickDestinationPickerDefaultPath}
                    onChange={handleQuickDestinationFolderChange}
                    previewLabel="Destination preview"
                    storageKey={DESTINATION_RECENTS_KEY}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setQuickDestinationModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddQuickDestination}
                    disabled={!quickDestinationLabel.trim() || quickDestinationBaseSegments.length === 0}
                  >
                    Add Destination
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

// memo: persistent surface — skip re-renders caused by unrelated App shell state.
export default memo(function NewThought() {
  return (
    <div className="ltm-page h-full">
      <CreateTab />
    </div>
  )
})
