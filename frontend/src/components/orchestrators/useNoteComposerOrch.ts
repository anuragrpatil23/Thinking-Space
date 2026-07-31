// Note composer orchestrator — the headless half of New Note.
//
// Owns every piece of composer state that used to live inline in
// `pages/NewThought.tsx`: destination selection, filename/title, todo mode,
// note settings, content + canvas fence round-tripping, destination-note
// load, and save. Extracted 2026-07-31.
//
// Why it exists:
//  1. The architecture contract wants flow/state wiring in an orchestrator and
//     domain logic in blocks. The page had ~25 `useState` calls braided
//     through JSX, which is neither.
//  2. It gives the composer a real *interface* — plain state + actions, no
//     JSX — so the surface can be re-rendered by something that isn't React.
//     That is the precondition for a native iOS composer view: Swift would
//     call these same actions over the Capacitor bridge instead of a
//     React component calling them directly.
//
// What deliberately stays in the view: anything that is purely presentational
// and has no bearing on what gets written to disk — doc/canvas surface choice,
// which config panel is revealed, sheet/pill open state, the AI panel toggle,
// and the *draft* fields of the quick-destination modal. A native view would
// own its own equivalents. The boundary is "does it affect the saved note".
//
// Pure helpers live in `services/lego_blocks/units/noteComposerBlock`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addRecent } from '@/components/lego_blocks/integrations/CascadingFolderPickerBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { createNoteFenceCanvasStorage } from '@/services/lego_blocks/integrations/noteFenceCanvasStorageBlock'
import { applyNoteCanvasToContent, parseNoteCanvasBlock } from '@/services/lego_blocks/units/noteCanvasBlock'
import { invokeCapabilityOrThrow } from '@/services/orchestrators/capabilityRouterOrch'
import {
  getThoughtForEdit,
  saveThoughtEdit,
  ThoughtConflictError,
} from '@/services/orchestrators/thoughtsOrch'
import {
  readNewThoughtQuickDestinationsPreferenceOrch,
  setNewThoughtQuickDestinationsPreferenceOrch,
} from '@/services/orchestrators/vaultUiPreferencesOrch'
import {
  AUTO_SAVE_PREF_KEY_BLOCK,
  BUILT_IN_SHORTCUTS_BLOCK,
  DEFAULT_BASE_PATH_BLOCK,
  DESTINATION_RECENTS_KEY_BLOCK,
  LEGACY_QUICK_DESTINATIONS_KEY_BLOCK,
  buildFrontmatterPreviewBlock,
  buildTargetPathBlock,
  clearLegacyQuickDestinationsBlock,
  computeDraftRemainderBlock,
  computeNoteContentMetaBlock,
  createShortcutIdBlock,
  ensureMarkdownFilenameBlock,
  filenameFromTitleBlock,
  mergeDraftBlock,
  normalizeSegmentsBlock,
  readCustomShortcutsBlock,
  readDestinationUsageCountsBlock,
  readJsonStorageBlock,
  readLegacyQuickDestinationsBlock,
  resolveNoteTitleBlock,
  splitNoteFrontmatterBlock,
  splitTodoItemsBlock,
  todayDateStrBlock,
  todayFilenameBlock,
  topUsedDestinationsBlock,
  withSuffixBlock,
  writeCustomShortcutsBlock,
  writeDestinationUsageCountsBlock,
  writeJsonStorageBlock,
  type DestinationShortcutBlock,
  type NoteContentMetaBlock,
  type NoteSaveStateBlock,
  type QuickDestinationBlock,
} from '@/services/lego_blocks/units/noteComposerBlock'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'
import type { CascadingFolderPickerChange } from '@/components/lego_blocks/integrations/CascadingFolderPickerBlock'

/** Long enough that a normal typing pause doesn't write, short enough that
 *  stepping away for a moment leaves the note on disk. */
const AUTO_SAVE_DEBOUNCE_MS = 1200

const THOUGHTS_ACTOR: CapabilityActor = { kind: 'human', id: 'ui.new-note' }
const TODO_ACTOR: CapabilityActor = { kind: 'human', id: 'ui.new-note.todos' }

interface TargetFileStateBlock {
  path: string
  exists: boolean
  baseMtime: number | null
  baseHash: string | null
}

export interface NoteComposerOrch {
  // --- destination ---
  pickerDefaultPath: string[]
  /** Bump-on-change key so the folder picker remounts when set programmatically. */
  pickerVersion: number
  folderBasePath: string
  activeShortcutId: string
  allShortcuts: DestinationShortcutBlock[]
  quickDestinations: QuickDestinationBlock[]
  mostUsedDestinations: Array<{ path: string; count: number }>
  destinationPath: string

  // --- identity ---
  filename: string
  useCustomTitle: boolean
  title: string
  targetPath: string | null

  // --- mode + settings ---
  makeThisTodo: boolean
  todoDateStr: string
  dateHeader: boolean
  emotions: string[]

  // --- content ---
  content: string
  /** Markdown body with the canvas fence stripped — what the editor shows. */
  editorBody: string
  canvasStorage: ReturnType<typeof createNoteFenceCanvasStorage>
  contentMeta: NoteContentMetaBlock
  frontmatterPreview: string
  todoItemCount: number

  // --- status ---
  saving: boolean
  loadingTargetContent: boolean
  error: string | null
  message: string | null
  savedPath: string | null
  itemsAdded: number
  canSave: boolean
  saveFeedbackVisible: boolean
  /** Typed content that isn't on disk yet. */
  isDirty: boolean
  /** Drives the ambient editing badge in place of a Save button. */
  saveState: NoteSaveStateBlock
  autoSaveEnabled: boolean

  // --- actions ---
  setFilename: (value: string) => void
  setTitle: (value: string) => void
  setUseCustomTitle: (enabled: boolean) => void
  setDateHeader: (enabled: boolean) => void
  setEmotions: (value: string[]) => void
  setTodoDateStr: (value: string) => void
  setMakeThisTodo: (checked: boolean) => void
  setContent: (value: string) => void
  setEditorBody: (nextBody: string) => void
  setMessage: (value: string | null) => void
  selectShortcut: (shortcutId: string) => void
  changeFolder: (change: CascadingFolderPickerChange) => void
  applyDestinationSegments: (segments: string[]) => void
  applyDestinationPath: (path: string) => void
  addCustomShortcut: (label: string, pathSuffix: string) => boolean
  deleteCustomShortcut: (shortcutId: string) => void
  addQuickDestination: (label: string, segments: string[]) => boolean
  deleteQuickDestination: (id: string) => void
  setAutoSaveEnabled: (enabled: boolean) => void
  save: () => Promise<void>
}

export function useNoteComposerOrch(): NoteComposerOrch {
  // --- destination ---
  const [pickerDefaultPath, setPickerDefaultPath] = useState<string[]>(DEFAULT_BASE_PATH_BLOCK)
  const [pickerVersion, setPickerVersion] = useState(0)
  const [folderBaseSegments, setFolderBaseSegments] = useState<string[]>([])
  const [folderBasePath, setFolderBasePath] = useState('')
  const [activeShortcutId, setActiveShortcutId] = useState('thoughts')
  const [shortcutBeforeTodoMode, setShortcutBeforeTodoMode] = useState('thoughts')
  const [customShortcuts, setCustomShortcuts] = useState<DestinationShortcutBlock[]>([])
  const [quickDestinations, setQuickDestinations] = useState<QuickDestinationBlock[]>([])
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})

  // --- identity ---
  const [filename, setFilenameState] = useState(todayFilenameBlock())
  const [filenameTouched, setFilenameTouched] = useState(false)
  const [useCustomTitle, setUseCustomTitleState] = useState(false)
  const [title, setTitle] = useState('')

  // --- mode + settings ---
  // Default off since the iA layout (2026-07-31): `thoughts.create` injects
  // `*Friday, July 31, 2026*` into the body, so with auto-save it appears above
  // the caret seconds after you start typing. The date is already in the
  // frontmatter and the filename. Still a switch in the settings panel.
  const [dateHeader, setDateHeader] = useState(false)
  const [makeThisTodo, setMakeThisTodoState] = useState(false)
  const [todoDateStr, setTodoDateStr] = useState(todayDateStrBlock())
  const [emotions, setEmotions] = useState<string[]>([])

  // --- content ---
  const [content, setContent] = useState('')

  // --- status ---
  const [saving, setSaving] = useState(false)
  const [autoSaveEnabled, setAutoSaveEnabledState] = useState<boolean>(
    () => readJsonStorageBlock(AUTO_SAVE_PREF_KEY_BLOCK, true),
  )
  const [loadingTargetContent, setLoadingTargetContent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [itemsAdded, setItemsAdded] = useState(0)
  const [saveFeedbackVisible, setSaveFeedbackVisible] = useState(false)
  const [loadedTargetPath, setLoadedTargetPath] = useState<string | null>(null)
  const [targetFileState, setTargetFileState] = useState<TargetFileStateBlock | null>(null)

  const saveFeedbackTimeoutRef = useRef<number | null>(null)
  const loadTargetRequestRef = useRef(0)
  const contentRef = useRef('')
  const loadedBaseContentRef = useRef('')
  useEffect(() => { contentRef.current = content }, [content])

  // Refs let the canvas adapter (created once) always see the latest content
  // without remounting CanvasSurfaceOrch (which would reset pan/zoom).
  const canvasContentRef = useRef(content)
  canvasContentRef.current = content
  const canvasStorage = useMemo(
    () => createNoteFenceCanvasStorage({
      getValue: () => canvasContentRef.current,
      onWrite: (next) => setContent(next),
    }),
    [],
  )

  // The rich editor only ever sees the prose body. Two things are stripped:
  //  - the canvas fence, so nobody stares at raw JSON in doc mode;
  //  - the YAML frontmatter, which the *capability* generates on save. Before
  //    auto-save existed, the post-save re-read only landed on an explicit
  //    click; now it lands mid-sentence, and having ten lines of uuid/key/tags
  //    appear above the caret while you type is unusable.
  // `content` still holds the full on-disk text — that is what gets written.
  const editorBody = useMemo(() => {
    const { body } = splitNoteFrontmatterBlock(content)
    return parseNoteCanvasBlock(body).bodyWithoutCanvas
  }, [content])

  const setEditorBody = useCallback((nextBody: string) => {
    const current = canvasContentRef.current
    const { frontmatter } = splitNoteFrontmatterBlock(current)
    const { tiles, hadFence } = parseNoteCanvasBlock(current)
    const nextWithCanvas = hadFence ? applyNoteCanvasToContent(nextBody, tiles) : nextBody
    setContent(frontmatter ? frontmatter + nextWithCanvas : nextWithCanvas)
  }, [])

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

  useEffect(() => () => {
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current)
    }
  }, [])

  // --- persisted destination prefs ------------------------------------------

  useEffect(() => {
    setCustomShortcuts(readCustomShortcutsBlock())
    setUsageCounts(readDestinationUsageCountsBlock())

    let cancelled = false
    const loadQuickDestinations = async () => {
      try {
        const persisted = await readNewThoughtQuickDestinationsPreferenceOrch()
        if (cancelled) return
        if (persisted.length > 0) {
          setQuickDestinations(persisted)
          clearLegacyQuickDestinationsBlock()
          return
        }
      } catch {
        // Fall back to legacy storage.
      }

      const legacy = readLegacyQuickDestinationsBlock()
      if (cancelled) return
      setQuickDestinations(legacy)

      if (legacy.length === 0) return
      try {
        await setNewThoughtQuickDestinationsPreferenceOrch(legacy)
        if (cancelled) return
        clearLegacyQuickDestinationsBlock()
      } catch {
        // Keep legacy storage as fallback if vault preference write fails.
      }
    }

    void loadQuickDestinations()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (activeShortcutId !== 'todo') setShortcutBeforeTodoMode(activeShortcutId)
  }, [activeShortcutId])

  // --- derived destination ---------------------------------------------------

  const allShortcuts = useMemo(
    () => [...BUILT_IN_SHORTCUTS_BLOCK, ...customShortcuts],
    [customShortcuts],
  )
  const shortcutsById = useMemo(() => {
    const map = new Map<string, DestinationShortcutBlock>()
    for (const shortcut of allShortcuts) map.set(shortcut.id, shortcut)
    return map
  }, [allShortcuts])
  const activeShortcut = shortcutsById.get(activeShortcutId) ?? BUILT_IN_SHORTCUTS_BLOCK[0]
  const destinationSegments = useMemo(
    () => withSuffixBlock(folderBaseSegments, activeShortcut.pathSegments),
    [activeShortcut.pathSegments, folderBaseSegments],
  )
  const destinationPath = destinationSegments.join('/')
  const normalizedFilename = ensureMarkdownFilenameBlock(filename)
  const mostUsedDestinations = useMemo(() => topUsedDestinationsBlock(usageCounts, 5), [usageCounts])

  const targetPath = makeThisTodo
    ? buildTargetPathBlock(destinationPath, todoDateStr.trim() ? `${todoDateStr.trim()}.md` : '')
    : buildTargetPathBlock(destinationPath, filename.trim() ? normalizedFilename : '')

  const rememberDestinationUsage = useCallback((segments: string[]) => {
    const normalized = normalizeSegmentsBlock(segments)
    if (normalized.length === 0) return
    addRecent(DESTINATION_RECENTS_KEY_BLOCK, normalized)
    setUsageCounts((previous) => {
      const key = normalized.join('/')
      const next = { ...previous, [key]: (previous[key] ?? 0) + 1 }
      writeDestinationUsageCountsBlock(next)
      return next
    })
  }, [])

  const persistQuickDestinations = useCallback(async (next: QuickDestinationBlock[]) => {
    setQuickDestinations(next)
    try {
      await setNewThoughtQuickDestinationsPreferenceOrch(next)
      clearLegacyQuickDestinationsBlock()
    } catch {
      writeJsonStorageBlock(LEGACY_QUICK_DESTINATIONS_KEY_BLOCK, next)
    }
  }, [])

  // --- identity actions ------------------------------------------------------

  const setFilename = useCallback((value: string) => {
    setFilenameState(value)
    setFilenameTouched(true)
  }, [])

  useEffect(() => {
    if (!useCustomTitle || filenameTouched) return
    setFilenameState(filenameFromTitleBlock(title))
  }, [filenameTouched, title, useCustomTitle])

  const setUseCustomTitle = useCallback((enabled: boolean) => {
    setUseCustomTitleState(enabled)
    setFilenameTouched(false)
    if (!enabled) {
      setTitle('')
      setFilenameState(todayFilenameBlock())
      return
    }
    setFilenameState(filenameFromTitleBlock(title))
  }, [title])

  const setMakeThisTodo = useCallback((checked: boolean) => {
    setMakeThisTodoState(checked)
    setActiveShortcutId((current) => {
      if (checked) return current === 'todo' ? current : 'todo'
      return current === 'todo' ? (shortcutBeforeTodoMode || 'thoughts') : current
    })
  }, [shortcutBeforeTodoMode])

  // --- destination actions ---------------------------------------------------

  const clearTransientStatus = useCallback(() => {
    setSavedPath(null)
    setError(null)
    setMessage(null)
  }, [])

  const changeFolder = useCallback((change: CascadingFolderPickerChange) => {
    setFolderBaseSegments(change.baseSegments)
    setFolderBasePath(change.basePath)
    setItemsAdded(0)
    clearTransientStatus()
  }, [clearTransientStatus])

  const selectShortcut = useCallback((shortcutId: string) => {
    setActiveShortcutId(shortcutId)
    const shortcut = shortcutsById.get(shortcutId)
    if (!shortcut || folderBaseSegments.length === 0) return
    rememberDestinationUsage(withSuffixBlock(folderBaseSegments, shortcut.pathSegments))
  }, [folderBaseSegments, rememberDestinationUsage, shortcutsById])

  const applyDestinationSegments = useCallback((segments: string[]) => {
    const normalized = normalizeSegmentsBlock(segments)
    if (normalized.length === 0) return
    setPickerDefaultPath(normalized)
    setPickerVersion(current => current + 1)
    setFolderBaseSegments(normalized)
    setFolderBasePath(normalized.join('/'))
    setActiveShortcutId('none')
    clearTransientStatus()
    rememberDestinationUsage(normalized)
  }, [clearTransientStatus, rememberDestinationUsage])

  const applyDestinationPath = useCallback((path: string) => {
    applyDestinationSegments(normalizeSegmentsBlock(path))
  }, [applyDestinationSegments])

  /** Returns false (and sets `error`) when the input is incomplete. */
  const addCustomShortcut = useCallback((label: string, pathSuffix: string) => {
    const cleanLabel = label.trim()
    const pathSegments = normalizeSegmentsBlock(pathSuffix)
    if (!cleanLabel || pathSegments.length === 0) {
      setError('Custom shortcut needs both a label and path suffix.')
      return false
    }
    setCustomShortcuts((previous) => {
      const next = [...previous, {
        id: createShortcutIdBlock('custom'),
        label: cleanLabel,
        pathSegments,
        builtIn: false,
      }]
      writeCustomShortcutsBlock(next)
      return next
    })
    setError(null)
    setMessage(`Added shortcut "${cleanLabel}".`)
    return true
  }, [])

  const deleteCustomShortcut = useCallback((shortcutId: string) => {
    setCustomShortcuts((previous) => {
      const next = previous.filter(shortcut => shortcut.id !== shortcutId)
      writeCustomShortcutsBlock(next)
      return next
    })
    setActiveShortcutId(current => (current === shortcutId ? 'thoughts' : current))
    setMessage('Removed custom shortcut.')
  }, [])

  /** Returns false (and sets `error`) when the input is incomplete. */
  const addQuickDestination = useCallback((label: string, segments: string[]) => {
    const cleanLabel = label.trim()
    const pathSegments = normalizeSegmentsBlock(segments)
    if (!cleanLabel || pathSegments.length === 0) {
      setError('Quick destination needs both a label and destination folder.')
      return false
    }
    void persistQuickDestinations([
      ...quickDestinations,
      { id: createShortcutIdBlock('quick'), label: cleanLabel, pathSegments },
    ])
    setError(null)
    setMessage(`Added quick destination "${cleanLabel}".`)
    return true
  }, [persistQuickDestinations, quickDestinations])

  const deleteQuickDestination = useCallback((id: string) => {
    void persistQuickDestinations(quickDestinations.filter(destination => destination.id !== id))
    setMessage('Removed quick destination.')
  }, [persistQuickDestinations, quickDestinations])

  // --- destination note load -------------------------------------------------

  useEffect(() => {
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

    const preservedDraft = computeDraftRemainderBlock(contentRef.current, loadedBaseContentRef.current)

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
          setTargetFileState({ path: targetPath, exists: false, baseMtime: null, baseHash: null })
          return
        }
        const existing = await getThoughtForEdit(targetPath)
        if (cancelled || requestId !== loadTargetRequestRef.current) return
        loadedBaseContentRef.current = existing.content
        setContent(mergeDraftBlock(existing.content, preservedDraft))
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

    return () => { cancelled = true }
  }, [loadedTargetPath, makeThisTodo, targetPath])

  // --- derived content -------------------------------------------------------

  // Counts and todo items describe what the *user wrote*, so they run on
  // `editorBody` — counting generated frontmatter lines as the note's words
  // would be wrong, and in todo mode each frontmatter line would become a task.
  const contentMeta = useMemo(() => computeNoteContentMetaBlock(editorBody), [editorBody])
  const todoItemCount = useMemo(() => splitTodoItemsBlock(editorBody).length, [editorBody])
  const frontmatterPreview = useMemo(
    () => buildFrontmatterPreviewBlock({
      title: resolveNoteTitleBlock({ useCustomTitle, title, normalizedFilename }),
      emotions,
    }),
    [emotions, normalizedFilename, title, useCustomTitle],
  )

  const canSave = makeThisTodo
    ? Boolean(destinationPath.trim() && todoDateStr.trim() && todoItemCount > 0 && !saving)
    : Boolean(destinationPath.trim() && filename.trim() && editorBody.trim() && !saving && !loadingTargetContent)

  // Content the user has typed that isn't on disk yet. `loadedBaseContentRef`
  // is re-seeded after every successful save and every destination load, so
  // this goes false the moment a write lands.
  const isDirty = !makeThisTodo && content.trim().length > 0 && content !== loadedBaseContentRef.current

  const saveState: NoteSaveStateBlock = saving
    ? 'saving'
    : isDirty
      ? 'dirty'
      : (savedPath || loadedBaseContentRef.current) ? 'saved' : 'idle'

  // --- save ------------------------------------------------------------------

  const save = useCallback(async () => {
    if (!makeThisTodo && loadingTargetContent) return
    if (makeThisTodo) {
      const items = splitTodoItemsBlock(editorBody)
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
        const data = await invokeCapabilityOrThrow({
          capability: 'todos.create',
          input: {
            folderPath: destinationPath,
            date: todoDateStr,
            items: splitTodoItemsBlock(editorBody),
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

      const outputPath = canSaveExistingFile
        ? (await saveThoughtEdit({
          path: targetPath!,
          content,
          baseMtime: targetFileState!.baseMtime!,
          baseHash: targetFileState!.baseHash!,
        })).output_path
        : (await invokeCapabilityOrThrow({
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
        })).output_path

      // Re-read so the editor holds exactly what is on disk (frontmatter is
      // generated on save) and the next conflict check has a fresh baseline.
      const refreshed = await getThoughtForEdit(outputPath)
      loadedBaseContentRef.current = refreshed.content
      setContent(refreshed.content)
      setLoadedTargetPath(outputPath)
      setTargetFileState({
        path: outputPath,
        exists: true,
        baseMtime: refreshed.mtime,
        baseHash: refreshed.hash,
      })
      setSavedPath(outputPath)
      rememberDestinationUsage(destinationSegments)
      // Deliberately no success message: auto-save fires while you type, and a
      // banner announcing each write would shove the writing surface down every
      // couple of seconds. The title-bar badge already reports "Saved".
      // (Todo mode still messages — the item count is information you can't
      // get from the badge — and errors always surface.)
      triggerSaveFeedback()
    } catch (err) {
      // A conflict means someone else wrote the file — adopt their content as
      // the new baseline so the user can merge instead of losing the save.
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

  // --- auto-save -------------------------------------------------------------
  //
  // Mirrors the explorer's editing badge: the save state is ambient, so there
  // is no Save button in the normal path. Turning auto-save off brings one
  // back (see `saveState`/`autoSaveEnabled` consumers).
  //
  // Never runs in todo mode: `todos.create` *appends* the parsed items, so a
  // debounced re-fire would duplicate every task on each keystroke pause.
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (!autoSaveEnabled || makeThisTodo) return
    if (!isDirty || !canSave) return
    const timer = window.setTimeout(() => { void saveRef.current() }, AUTO_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [autoSaveEnabled, canSave, isDirty, makeThisTodo, content])

  const setAutoSaveEnabled = useCallback((enabled: boolean) => {
    setAutoSaveEnabledState(enabled)
    writeJsonStorageBlock(AUTO_SAVE_PREF_KEY_BLOCK, enabled)
  }, [])

  return {
    pickerDefaultPath,
    pickerVersion,
    folderBasePath,
    activeShortcutId,
    allShortcuts,
    quickDestinations,
    mostUsedDestinations,
    destinationPath,

    filename,
    useCustomTitle,
    title,
    targetPath,

    makeThisTodo,
    todoDateStr,
    dateHeader,
    emotions,

    content,
    editorBody,
    canvasStorage,
    contentMeta,
    frontmatterPreview,
    todoItemCount,

    saving,
    loadingTargetContent,
    error,
    message,
    savedPath,
    itemsAdded,
    canSave,
    saveFeedbackVisible,
    isDirty,
    saveState,
    autoSaveEnabled,

    setFilename,
    setTitle,
    setUseCustomTitle,
    setDateHeader,
    setEmotions,
    setTodoDateStr,
    setMakeThisTodo,
    setContent,
    setEditorBody,
    setMessage,
    selectShortcut,
    changeFolder,
    applyDestinationSegments,
    applyDestinationPath,
    addCustomShortcut,
    deleteCustomShortcut,
    addQuickDestination,
    deleteQuickDestination,
    setAutoSaveEnabled,
    save,
  }
}
