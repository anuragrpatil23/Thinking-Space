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
import { useProjectsBlock } from '@/components/lego_blocks/hooks/shared/useProjectsBlock'
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
  BROWSED_DESTINATIONS_KEY_BLOCK,
  BROWSED_DESTINATIONS_LIMIT_BLOCK,
  NOTE_KIND_PREF_KEY_BLOCK,
  BUILT_IN_SHORTCUTS_BLOCK,
  DEFAULT_BASE_PATH_BLOCK,
  DESTINATION_RECENTS_KEY_BLOCK,
  buildFrontmatterPreviewBlock,
  buildTargetPathBlock,
  clearLegacyQuickDestinationsBlock,
  computeDraftRemainderBlock,
  computeNoteContentMetaBlock,
  createShortcutIdBlock,
  ensureMarkdownFilenameBlock,
  filenameFromTitleBlock,
  mergeDraftBlock,
  NEW_NOTE_NAME_ATTEMPTS_BLOCK,
  noteKindShortcutIdBlock,
  normalizeSegmentsBlock,
  numberedFilenameBlock,
  projectDestinationsBlock,
  projectForSegmentsBlock,
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
  unreachableQuickDestinationPathsBlock,
  withSuffixBlock,
  writeCustomShortcutsBlock,
  writeDestinationUsageCountsBlock,
  writeJsonStorageBlock,
  type DestinationShortcutBlock,
  type NoteContentMetaBlock,
  type NoteKindBlock,
  type NoteSaveStateBlock,
  type ProjectDestinationBlock,
} from '@/services/lego_blocks/units/noteComposerBlock'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'
import type { CascadingFolderPickerChange } from '@/components/lego_blocks/integrations/CascadingFolderPickerBlock'

/** Long enough that a normal typing pause doesn't write, short enough that
 *  stepping away for a moment leaves the note on disk. */
const AUTO_SAVE_DEBOUNCE_MS = 1200

/** Recents off storage as flat paths, newest first. Stored as segment arrays by
 *  `addRecent`, which is the shape the old cascading picker wanted. */
function readRecentDestinationsBlock(): string[] {
  return readJsonStorageBlock<string[][]>(DESTINATION_RECENTS_KEY_BLOCK, [])
    .map(segments => (Array.isArray(segments) ? segments.filter(Boolean).join('/') : ''))
    .filter(Boolean)
    .slice(0, 5)
}

/** Folders picked by hand in Explorer, newest first. Same storage shape as the
 *  save-recents above, different question: this one is "where did I go looking",
 *  which is what the settings panel offers now that the project is picked from
 *  the path itself. */
function readBrowsedDestinationsBlock(): string[] {
  return readJsonStorageBlock<string[][]>(BROWSED_DESTINATIONS_KEY_BLOCK, [])
    .map(segments => (Array.isArray(segments) ? segments.filter(Boolean).join('/') : ''))
    .filter(Boolean)
    .slice(0, BROWSED_DESTINATIONS_LIMIT_BLOCK)
}

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
  /** The user's projects that can hold notes, as destination bases. */
  projectDestinations: ProjectDestinationBlock[]
  /** Key of the project the current destination sits under, or null at the
   *  vault root / outside every project. */
  activeProjectKey: string | null
  mostUsedDestinations: Array<{ path: string; count: number }>
  /** Recently used destination folders, newest first — written on save. */
  recentDestinations: string[]
  /** Folders picked by hand in Explorer, newest first. */
  browsedDestinations: string[]
  destinationPath: string

  // --- identity ---
  filename: string
  useCustomTitle: boolean
  title: string
  targetPath: string | null

  // --- mode + settings ---
  noteKind: NoteKindBlock
  /** `noteKind === 'todo'` — kept because the todo save path branches on it. */
  makeThisTodo: boolean
  todoDateStr: string
  dateHeader: boolean
  emotions: string[]
  /** Freeform tags the user typed. Emotions end up in the same `tags` field on
   *  disk under an `emotion/` namespace — these are the un-namespaced ones. */
  tags: string[]

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
  setTags: (value: string[]) => void
  setTodoDateStr: (value: string) => void
  setNoteKind: (kind: NoteKindBlock) => void
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
  /** Move the destination to a project's folder, keeping the note-type suffix.
   *  `null` means the vault root. */
  selectProject: (projectKey: string | null) => void
  /** Record the current destination as an Explorer pick. Called when the browser
   *  closes, not on every click inside it. */
  rememberBrowsedDestination: () => void
  setAutoSaveEnabled: (enabled: boolean) => void
  /** Start a blank note in the *current* folder, on a filename nothing occupies. */
  startNewNote: () => Promise<void>
  /** False while `startNewNote` is looking for a free filename. */
  startingNewNote: boolean
  save: () => Promise<void>
}

export function useNoteComposerOrch(): NoteComposerOrch {
  // --- destination ---
  const [pickerDefaultPath, setPickerDefaultPath] = useState<string[]>(DEFAULT_BASE_PATH_BLOCK)
  const [pickerVersion, setPickerVersion] = useState(0)
  // Empty is the deliberate default now: no project chosen, so the `thought`
  // suffix composes to `thoughts/` at the vault root. It used to be seeded with
  // one user's project folder because an earlier bug left the base at `[]`
  // unintentionally (2026-07-31) — the fix was right, the value was not, and a
  // hardcoded `lifeblood_systems/sfdl` shipped to every vault that has no such
  // folder. Unset-by-default is a state the picker can now express.
  const [folderBaseSegments, setFolderBaseSegments] = useState<string[]>(DEFAULT_BASE_PATH_BLOCK)
  const [folderBasePath, setFolderBasePath] = useState(DEFAULT_BASE_PATH_BLOCK.join('/'))
  const [activeShortcutId, setActiveShortcutId] = useState('thoughts')
  const [customShortcuts, setCustomShortcuts] = useState<DestinationShortcutBlock[]>([])
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})
  // The destination base is a *project*, not a remembered path. The list is the
  // one the user already maintains in Settings (`.thinking-space/projects.json`),
  // which is why the composer no longer keeps a parallel list of its own.
  const { projects, loading: projectsLoading } = useProjectsBlock()
  const projectDestinations = useMemo(() => projectDestinationsBlock(projects), [projects])

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
  // Note kind supersedes the old boolean todo switch. `makeThisTodo` survives
  // as a derived value because a dozen branches below (and the whole todo save
  // path) read it, and rewriting them all would bury the actual change.
  const [noteKind, setNoteKindState] = useState<NoteKindBlock>(
    () => readJsonStorageBlock<NoteKindBlock>(NOTE_KIND_PREF_KEY_BLOCK, 'thought'),
  )
  const makeThisTodo = noteKind === 'todo'
  const [todoDateStr, setTodoDateStr] = useState(todayDateStrBlock())
  const [emotions, setEmotions] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])

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
  const [startingNewNote, setStartingNewNote] = useState(false)
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
  }, [])

  // One-time retirement of quick destinations (2026-08-19). They were flat
  // whole-path snapshots that set project and note-type folder at once, which is
  // the composition this orchestrator already had — most of them were the user
  // hand-rebuilding `<project>/<kind folder>` because the UI offered no way to
  // say it structurally. The picker reproduces those exactly, so they are simply
  // dropped. The ones it *cannot* reproduce — a sub-area inside a project, e.g.
  // `operations/sfw/airms/meetings` — become Explorer picks rather than vanishing:
  // that list is what the panel shows, and it is where a hand-found sub-area
  // belongs. The
  // retired list was a roamed vault preference, and silently deleting one is the
  // kind of loss noticed a week later with no way back.
  //
  // Waits for the project list: with it still loading, every path looks
  // unreachable and the whole list would be converted.
  const quickDestinationsMigratedRef = useRef(false)
  useEffect(() => {
    if (projectsLoading || quickDestinationsMigratedRef.current) return
    quickDestinationsMigratedRef.current = true

    let cancelled = false
    const migrate = async () => {
      let stored: Array<{ pathSegments: string[] }> = []
      try {
        stored = await readNewThoughtQuickDestinationsPreferenceOrch()
      } catch {
        // Vault preferences unavailable — the legacy key below is the fallback.
      }
      if (stored.length === 0) stored = readLegacyQuickDestinationsBlock()
      if (cancelled || stored.length === 0) return

      for (const path of unreachableQuickDestinationPathsBlock(stored, projectDestinations)) {
        addRecent(
          BROWSED_DESTINATIONS_KEY_BLOCK,
          normalizeSegmentsBlock(path),
          BROWSED_DESTINATIONS_LIMIT_BLOCK,
        )
      }
      if (cancelled) return
      setBrowsedDestinations(readBrowsedDestinationsBlock())

      clearLegacyQuickDestinationsBlock()
      try {
        await setNewThoughtQuickDestinationsPreferenceOrch([])
      } catch {
        // Leaving the roamed list in place is harmless — nothing reads it now,
        // and the ref guard stops this from running twice in one session.
      }
    }

    void migrate()
    return () => { cancelled = true }
  }, [projectDestinations, projectsLoading])

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
  // Derived from the path, never stored beside it — a base reached through
  // Explorer or a recent (`operations/sfw/airms/meetings`) still resolves to its
  // project by longest prefix, so the picker shows where you actually are rather
  // than only where it put you.
  const activeProjectKey = useMemo(
    () => projectForSegmentsBlock(projectDestinations, folderBaseSegments)?.key ?? null,
    [folderBaseSegments, projectDestinations],
  )
  const normalizedFilename = ensureMarkdownFilenameBlock(filename)
  const mostUsedDestinations = useMemo(() => topUsedDestinationsBlock(usageCounts, 5), [usageCounts])

  const targetPath = makeThisTodo
    ? buildTargetPathBlock(destinationPath, todoDateStr.trim() ? `${todoDateStr.trim()}.md` : '')
    : buildTargetPathBlock(destinationPath, filename.trim() ? normalizedFilename : '')

  // Recents are held in state, not read from storage at render time: the
  // browser needs the list to move the moment you pick something.
  const [recentDestinations, setRecentDestinations] = useState<string[]>(readRecentDestinationsBlock)
  const [browsedDestinations, setBrowsedDestinations] = useState<string[]>(readBrowsedDestinationsBlock)

  const rememberDestinationUsage = useCallback((segments: string[]) => {
    const normalized = normalizeSegmentsBlock(segments)
    if (normalized.length === 0) return
    addRecent(DESTINATION_RECENTS_KEY_BLOCK, normalized)
    setRecentDestinations(readRecentDestinationsBlock())
    setUsageCounts((previous) => {
      const key = normalized.join('/')
      const next = { ...previous, [key]: (previous[key] ?? 0) + 1 }
      writeDestinationUsageCountsBlock(next)
      return next
    })
  }, [])

  /** Deliberately *not* called from `applyDestinationSegments`. Clicking through
   *  a tree commits as you go, so recording every step filled the list with the
   *  folders you passed through and re-sorted it under the cursor while you were
   *  still aiming (2026-07-31). One record when the browser closes is the whole
   *  point of the pick, and nothing else. */
  const rememberBrowsedDestination = useCallback(() => {
    const normalized = normalizeSegmentsBlock(destinationSegments)
    if (normalized.length === 0) return
    addRecent(BROWSED_DESTINATIONS_KEY_BLOCK, normalized, BROWSED_DESTINATIONS_LIMIT_BLOCK)
    setBrowsedDestinations(readBrowsedDestinationsBlock())
  }, [destinationSegments])

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

  /** "New note" from inside the composer: same folder, same kind, blank page.
   *
   *  It has to look at the disk. The composer *opens* the note already at the
   *  target path — one note per day per folder, by design — so without a free
   *  name this button would silently drop you into today's existing note, which
   *  is the exact opposite of what it says. So: today's name if nothing holds
   *  it, `-2`, `-3` and so on if something does.
   *
   *  Content is cleared *before* the path changes, so the destination-load
   *  effect finds no draft to carry across (`computeDraftRemainderBlock`
   *  deliberately preserves typing when you re-target a note; here that would
   *  paste the old note into the new one). */
  const startNewNote = useCallback(async () => {
    if (!destinationPath.trim()) {
      setError('Pick a destination folder first.')
      return
    }
    setStartingNewNote(true)
    try {
      const fs = getVaultFS()
      const base = todayFilenameBlock()
      let chosen: string | null = null
      for (let attempt = 1; attempt <= NEW_NOTE_NAME_ATTEMPTS_BLOCK; attempt += 1) {
        const candidate = numberedFilenameBlock(base, attempt)
        const candidatePath = buildTargetPathBlock(destinationPath, candidate)
        if (!candidatePath) break
        // Serial on purpose: each answer decides whether the next name is even
        // worth asking about, and the loop almost always ends on the first.
        if (!(await fs.exists(candidatePath))) { chosen = candidate; break }
      }
      if (!chosen) {
        setError(`Could not find a free file name in ${destinationPath}.`)
        return
      }

      setContent('')
      contentRef.current = ''
      canvasContentRef.current = ''
      loadedBaseContentRef.current = ''
      setUseCustomTitleState(false)
      setTitle('')
      setEmotions([])
      setTags([])
      setFilenameState(chosen)
      // Touched, so the custom-title effect does not rename it back.
      setFilenameTouched(true)
      setSavedPath(null)
      setError(null)
      setItemsAdded(0)
      setMessage(`New note: ${chosen}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start a new note')
    } finally {
      setStartingNewNote(false)
    }
  }, [destinationPath])

  const setNoteKind = useCallback((kind: NoteKindBlock) => {
    setNoteKindState(kind)
    writeJsonStorageBlock(NOTE_KIND_PREF_KEY_BLOCK, kind)
    // Kind seeds the folder — Thought → `thoughts/`, Meeting → `meetings/`, To
    // Do → `todos/`, None → wherever you already were. It does not lock it: the
    // project picker and Explorer both write the folder afterwards and win,
    // until you touch this control again. Last action wins, in both directions,
    // which is what lets a note tagged `meeting` live under a sub-area folder
    // Explorer found (see `noteKindShortcutIdBlock`).
    const seeded = noteKindShortcutIdBlock(kind)
    if (seeded) setActiveShortcutId(seeded)
  }, [])

  const setMakeThisTodo = useCallback((checked: boolean) => {
    setNoteKind(checked ? 'todo' : 'thought')
  }, [setNoteKind])

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
    // Deliberately does NOT record usage. Selecting is browsing, not using:
    // recording here filled Recent with every folder you clicked through on the
    // way somewhere else, and — because both lists re-sort on write — made the
    // whole panel reshuffle under the cursor on every click (2026-07-31).
    // Usage is recorded on save, where it reflects an actual destination.
  }, [clearTransientStatus])

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

  /** Move the base to a project, leaving the note-type suffix alone: picking a
   *  project is half the address, not the whole one. `null` is the vault root,
   *  which is a real answer ("this note isn't project work"), not an absence. */
  const selectProject = useCallback((projectKey: string | null) => {
    const project = projectKey
      ? projectDestinations.find(candidate => candidate.key === projectKey) ?? null
      : null
    const segments = project ? project.segments : []
    setPickerDefaultPath(segments)
    setPickerVersion(current => current + 1)
    setFolderBaseSegments(segments)
    setFolderBasePath(segments.join('/'))
    // Unlike `applyDestinationSegments` this does NOT force the `none`
    // shortcut: the whole point is that the suffix survives, so switching
    // projects keeps you in the same kind of folder.
    clearTransientStatus()
  }, [clearTransientStatus, projectDestinations])

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
        // Guarded rather than returned out of: a `return` inside `finally`
        // discards whatever the block was completing with, including an
        // in-flight exception. Equivalent here — the catch above swallows
        // everything and the IIFE returns void — but the shape is a trap, and
        // the same shape one file over sits on a try with no catch at all.
        if (!cancelled && requestId === loadTargetRequestRef.current) {
          setLoadingTargetContent(false)
        }
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
      tags,
    }),
    [emotions, tags, normalizedFilename, title, useCustomTitle],
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
            tags,
            note_kind: noteKind,
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
    tags,
    filename,
    loadingTargetContent,
    noteKind,
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
    projectDestinations,
    activeProjectKey,
    mostUsedDestinations,
    recentDestinations,
    browsedDestinations,
    destinationPath,

    filename,
    useCustomTitle,
    title,
    targetPath,

    noteKind,
    makeThisTodo,
    todoDateStr,
    dateHeader,
    emotions,
    tags,

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
    setTags,
    setTodoDateStr,
    setNoteKind,
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
    selectProject,
    rememberBrowsedDestination,
    setAutoSaveEnabled,
    startNewNote,
    startingNewNote,
    save,
  }
}
