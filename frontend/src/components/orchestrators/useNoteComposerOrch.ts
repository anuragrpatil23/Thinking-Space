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
import { useNoteDraftJournalBlock } from '@/components/lego_blocks/hooks/shared/useNoteDraftJournalBlock'
import { useNoteDraftRecoveryBlock } from '@/components/lego_blocks/hooks/shared/useNoteDraftRecoveryBlock'
import type { NoteDraftEntryBlock } from '@/services/lego_blocks/units/noteDraftJournalBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { isReapableNoteHuskBlock } from '@/services/lego_blocks/units/noteHuskBlock'
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
  bufferHasUnsavedTextBlock,
  saveRetryDelayBlock,
  shouldFlushOnTeardownBlock,
  shouldRequestSaveBlock,
  originCleanupActionBlock,
  noteEditorBodyBlock,
  applyEditorBodyBlock,
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
  changeFolder: (change: CascadingFolderPickerChange) => Promise<void>
  applyDestinationSegments: (segments: string[]) => Promise<void>
  applyDestinationPath: (path: string) => Promise<void>
  addCustomShortcut: (label: string, pathSuffix: string) => boolean
  deleteCustomShortcut: (shortcutId: string) => void
  /** Move the destination to a project's folder, keeping the note-type suffix.
   *  `null` means the vault root. */
  selectProject: (projectKey: string | null) => Promise<void>
  /** Record the current destination as an Explorer pick. Called when the browser
   *  closes, not on every click inside it. */
  rememberBrowsedDestination: () => void
  setAutoSaveEnabled: (enabled: boolean) => void
  /** Start a blank note in the *current* folder, on a filename nothing occupies. */
  startNewNote: () => Promise<void>
  /** False while `startNewNote` is looking for a free filename. */
  startingNewNote: boolean
  save: () => Promise<void>
  /** Explicit save (Cmd+S / Ctrl+S). Silent no-op when there is nothing to
   *  write; guarded against duplicating an appended todo list. */
  requestSave: () => Promise<void>

  /** A destination the user picked while text was on screen, held until they
   *  say whether the note moves there or a new one starts there. */
  pendingDestination: PendingDestinationBlock | null
  /** True while a move is in flight. */
  movingNote: boolean
  /** Move the note in the buffer to the pending destination. Never appends. */
  moveNoteToPendingDestination: () => Promise<void>
  /** Keep the current note where it is; open a blank one at the destination. */
  startNewNoteAtPendingDestination: () => Promise<void>
  /** Abandon the destination change entirely. */
  cancelPendingDestination: () => void

  /** Text from an earlier session that never reached a file. Empty in the
   *  normal case; non-empty means something crashed. */
  recoverableDrafts: NoteDraftEntryBlock[]
  /** Load a recovered draft into the composer, at its original destination. */
  recoverDraft: (entry: NoteDraftEntryBlock) => void
  /** Throw a recovered draft away. Only ever a person's explicit choice. */
  discardDraft: (id: string) => Promise<void>
}

/** A destination change the composer is holding until the user says what
 *  should happen to the note already in the buffer. */
export interface PendingDestinationBlock {
  /** Vault-relative base segments the user picked. */
  segments: string[]
  /** Human-readable name of where they picked, for the prompt. */
  label: string
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

  // Declared here rather than beside `save` so the callbacks defined above it
  // can flush without a use-before-declaration dance. Assigned on every render
  // further down.
  // Second copy of typed text, independent of whether the note file is being
  // written. See docs/contracts/DURABILITY.md.
  const journal = useNoteDraftJournalBlock()
  /** Did this session bring the target file into existence? Journaled rather
   *  than kept only in memory, because memory does not survive the crash the
   *  journal exists for — and after a crash an empty note we made is otherwise
   *  indistinguishable from a stub the user made deliberately. */
  const createdTargetRef = useRef(false)
  /** Content of the last successful `todos.create`. `todos.create` *appends*,
   *  so re-submitting the same list adds every task a second time — which is
   *  why auto-save skips todo mode entirely. An explicit Cmd+S has to carry the
   *  same guard, since a reflex keystroke repeats far more readily than a
   *  deliberate button press. */
  const lastTodoSubmitRef = useRef<string | null>(null)
  /** What was on disk at the target when this session first landed on it.
   *
   *  The move needs it to answer a question `loadedBaseContentRef` cannot:
   *  auto-save re-seeds that baseline on every write, so by the time you pick a
   *  project it says "everything here is mine", which would licence deleting a
   *  day note that existed before you arrived. This one does not move. */
  const sessionOriginContentRef = useRef('')
  const recovery = useNoteDraftRecoveryBlock(journal.draftId)

  const saveRef = useRef<() => Promise<void>>(async () => {})
  const makeThisTodoRef = useRef(makeThisTodo)
  makeThisTodoRef.current = makeThisTodo
  // Read through a ref by the stash below rather than closed over: the
  // destination-load effect *sets* this, so listing it as a dependency would
  // make the effect retrigger itself.
  const targetFileStateRef = useRef<TargetFileStateBlock | null>(null)

  // Prose held aside while the composer is in To Do mode.
  //
  // Todo mode reuses the one editor buffer for a different document — one task
  // per line — and the destination-load effect used to make room by calling
  // `setContent('')`. That destroyed whatever prose was on screen: outright,
  // with no disk copy at all when auto-save was off, and with no way back even
  // when there was one. Note kind is a *toggle*, and a toggle must not be
  // destructive. Both documents are now stashed rather than dropped, so
  // flipping back and forth returns you to exactly what you had.
  const stashedProseRef = useRef<{
    content: string
    base: string
    loadedPath: string | null
    fileState: TargetFileStateBlock | null
  } | null>(null)
  const stashedTodoRef = useRef('')

  // Count of consecutive failed saves, driving the retry backoff below. State
  // rather than a ref because the retry effect has to re-run when it changes.
  const [saveFailureCount, setSaveFailureCount] = useState(0)

  /** A destination change waiting on the question only a person can answer:
   *  does this note belong there, or do you want a fresh one there?
   *
   *  Raised only when the buffer holds text and the destination actually
   *  changes — at most once per note, at the moment you have stopped writing
   *  and reached for a picker. Without it the ordering ("new note first, then
   *  pick the project") is a rule nothing on screen teaches, and getting it
   *  backwards silently misfiles a note. */
  const [pendingDestination, setPendingDestination] = useState<PendingDestinationBlock | null>(null)
  const [movingNote, setMovingNote] = useState(false)

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
  const editorBody = useMemo(
    () => noteEditorBodyBlock(content, parseNoteCanvasBlock),
    [content],
  )

  const setEditorBody = useCallback((nextBody: string) => {
    setContent(applyEditorBodyBlock(canvasContentRef.current, nextBody, {
      parse: parseNoteCanvasBlock,
      apply: applyNoteCanvasToContent,
    }))
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
  /** First filename in `folderPath` that nothing occupies: `base`, then
   *  `base-2`, `base-3`. Extracted from `startNewNote` because the move needs
   *  exactly the same search — and because "no append, ever" means a move into
   *  a folder that already holds today's note must land beside it, not inside it. */
  const findFreeFilename = useCallback(async (folderPath: string, base: string): Promise<string | null> => {
    const fs = getVaultFS()
    for (let attempt = 1; attempt <= NEW_NOTE_NAME_ATTEMPTS_BLOCK; attempt += 1) {
      const candidate = numberedFilenameBlock(base, attempt)
      const candidatePath = buildTargetPathBlock(folderPath, candidate)
      if (!candidatePath) break
      // Serial on purpose: each answer decides whether the next name is even
      // worth asking about, and the loop almost always ends on the first.
      if (!(await fs.exists(candidatePath))) return candidate
    }
    return null
  }, [])

  const startNewNote = useCallback(async () => {
    if (!destinationPath.trim()) {
      setError('Pick a destination folder first.')
      return
    }
    // Never clear a buffer that isn't on disk. Below, this used to call
    // `setContent('')` unconditionally — correct for its stated purpose (stop
    // the old note being pasted into the new one) and silently destructive
    // whenever the text had not been written yet, which is every note in manual
    // mode and any note whose last auto-save failed.
    if (bufferHasUnsavedTextBlock(contentRef.current, loadedBaseContentRef.current)) {
      await saveRef.current()
      if (contentRef.current !== loadedBaseContentRef.current) {
        // `save` has already surfaced the reason. Say what was *not* done, which
        // is the part the user cares about.
        setMessage(null)
        setError(current => current
          ? `${current} — the current note was left open and nothing was cleared.`
          : 'Could not save the current note, so it was left open and nothing was cleared.')
        return
      }
    }
    setStartingNewNote(true)
    try {
      const chosen = await findFreeFilename(destinationPath, todayFilenameBlock())
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
      // Deliberately silent. The banner it used to raise sat full-width above
      // the editor and pushed the writing surface down to announce something
      // already written in two places — the title bar and the "Saving to" line
      // both now read the new name, and the page is blank. A confirmation that
      // repeats what the screen says is just something else to dismiss.
      setMessage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start a new note')
    } finally {
      setStartingNewNote(false)
    }
  }, [destinationPath, findFreeFilename])

  /** Adopt a recovered draft into the composer.
   *
   *  Ordering matters. The text is put in the buffer, journaled under *this*
   *  session's id and flushed synchronously, and only then is the old entry
   *  forgotten — so there is no instant where the recovered text exists in
   *  neither journal. The old entry is dropped from the list rather than
   *  deleted from disk: if this session then dies, the original is still there.
   */
  const recoverDraft = useCallback((entry: NoteDraftEntryBlock) => {
    if (entry.targetPath) {
      const segments = normalizeSegmentsBlock(entry.targetPath)
      const leaf = segments.pop()
      if (leaf) {
        setFilenameState(leaf)
        setFilenameTouched(true)
      }
      setPickerDefaultPath(segments)
      setPickerVersion(current => current + 1)
      setFolderBaseSegments(segments)
      setFolderBasePath(segments.join('/'))
      setActiveShortcutId('none')
      // The load effect must not treat the recovered text as a stale draft to
      // reconcile against a file it has never read.
      setLoadedTargetPath(entry.targetPath)
      setTargetFileState(null)
    }
    loadedBaseContentRef.current = ''
    contentRef.current = entry.content
    setContent(entry.content)
    journal.record({
      content: entry.content,
      targetPath: entry.targetPath,
      createdTarget: entry.createdTarget,
    })
    journal.flushHotSync()
    recovery.forgetDraft(entry.id)
    setError(null)
    setMessage('Recovered unsaved note.')
  }, [journal, recovery])

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

  /** Delete an empty, app-generated note left behind at `path`.
   *
   *  Safe by construction: `isReapableNoteHuskBlock` returns true only for a
   *  file whose frontmatter the app generated entirely by itself and whose body
   *  and canvas are both empty. Such a file contains, by definition, nothing a
   *  person typed — so even if the journal is holding unsaved text aimed at
   *  this path, that text is *not* in this file, and removing it makes the
   *  recovery sweep offer the draft rather than believe it landed.
   *
   *  Every failure path leaves the file alone. A stray empty note is a
   *  nuisance; a wrongly deleted one is not recoverable. */
  const reapHuskAtPath = useCallback(async (path: string | null) => {
    if (!path) return
    try {
      const fs = getVaultFS()
      if (!(await fs.exists(path))) return
      const existing = await fs.read(path)
      const filename = path.split('/').pop() ?? ''
      if (!isReapableNoteHuskBlock({ content: existing, filename })) return
      await fs.delete(path)
    } catch {
      // Unreadable, undeletable, or vault unavailable — leave it.
    }
  }, [])

  /** The transition chokepoint. See docs/contracts/DURABILITY.md.
   *
   *  Every path that clears or replaces `content` asks this first. It requires
   *  *durability*, not publication — it never writes the note file, so it is
   *  identical in manual mode, where the whole point is that nothing reaches
   *  the note until you say so.
   *
   *  Returns false only when **both** tiers failed, which is the one case where
   *  the buffer really is the only copy. Then the transition is cancelled and
   *  the text stays on screen. The transition loses, never the text.
   *
   *  `durable: false` is for browsing — the folder picker commits on every
   *  click inside the tree, and a vault write per click would churn an iCloud
   *  vault for a person who is still aiming. The hot tier is synchronous and
   *  free, so it always runs. */
  const ensureBufferDurable = useCallback(async (options?: { durable?: boolean }): Promise<boolean> => {
    if (!bufferHasUnsavedTextBlock(contentRef.current, loadedBaseContentRef.current)) return true
    journal.record({
      content: contentRef.current,
      targetPath,
      createdTarget: createdTargetRef.current,
    })
    const hotOk = journal.flushHotSync()
    const durableOk = options?.durable === false ? false : await journal.flushDurable()
    if (hotOk || durableOk) return true
    setError(
      'Could not put this note anywhere safe yet, so nothing was moved or cleared. '
      + 'Your text is still here — check that the vault is reachable.',
    )
    return false
  }, [journal, targetPath])

  const clearTransientStatus = useCallback(() => {
    setSavedPath(null)
    setError(null)
    setMessage(null)
  }, [])

  const changeFolder = useCallback(async (change: CascadingFolderPickerChange) => {
    // Hot tier only: every click inside the folder tree commits, so paying for
    // a vault write per click would churn an iCloud vault while the user is
    // still aiming. The durable write lands on its own debounce moments later.
    if (!(await ensureBufferDurable({ durable: false }))) return
    setFolderBaseSegments(change.baseSegments)
    setFolderBasePath(change.basePath)
    setItemsAdded(0)
    clearTransientStatus()
  }, [clearTransientStatus, ensureBufferDurable])

  const selectShortcut = useCallback((shortcutId: string) => {
    setActiveShortcutId(shortcutId)
    const shortcut = shortcutsById.get(shortcutId)
    if (!shortcut || folderBaseSegments.length === 0) return
    rememberDestinationUsage(withSuffixBlock(folderBaseSegments, shortcut.pathSegments))
  }, [folderBaseSegments, rememberDestinationUsage, shortcutsById])

  /** Move the base with no questions asked. The public actions below decide
   *  whether a question is owed first. */
  const applyBaseSegments = useCallback((normalized: string[], resetShortcut: boolean) => {
    setPickerDefaultPath(normalized)
    setPickerVersion(current => current + 1)
    setFolderBaseSegments(normalized)
    setFolderBasePath(normalized.join('/'))
    if (resetShortcut) setActiveShortcutId('none')
    clearTransientStatus()
  }, [clearTransientStatus])

  const applyDestinationSegments = useCallback(async (segments: string[]) => {
    const normalized = normalizeSegmentsBlock(segments)
    if (normalized.length === 0) return
    if (!(await ensureBufferDurable())) return
    // A destination change with text on screen is ambiguous, so ask.
    if (normalized.join('/') !== folderBaseSegments.join('/')
      && contentRef.current.trim().length > 0) {
      setPendingDestination({ segments: normalized, label: normalized.join('/') })
      return
    }
    applyBaseSegments(normalized, true)
    // Deliberately does NOT record usage. Selecting is browsing, not using:
    // recording here filled Recent with every folder you clicked through on the
    // way somewhere else, and — because both lists re-sort on write — made the
    // whole panel reshuffle under the cursor on every click (2026-07-31).
    // Usage is recorded on save, where it reflects an actual destination.
  }, [applyBaseSegments, ensureBufferDurable, folderBaseSegments])

  const applyDestinationPath = useCallback(async (path: string) => {
    await applyDestinationSegments(normalizeSegmentsBlock(path))
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
  const selectProject = useCallback(async (projectKey: string | null) => {
    if (!(await ensureBufferDurable())) return
    const project = projectKey
      ? projectDestinations.find(candidate => candidate.key === projectKey) ?? null
      : null
    const segments = project ? project.segments : []
    if (segments.join('/') !== folderBaseSegments.join('/')
      && contentRef.current.trim().length > 0) {
      setPendingDestination({ segments, label: project ? project.name : 'the vault root' })
      return
    }
    // Unlike `applyDestinationSegments` this does NOT force the `none`
    // shortcut: the whole point is that the suffix survives, so switching
    // projects keeps you in the same kind of folder.
    applyBaseSegments(segments, false)
  }, [applyBaseSegments, ensureBufferDurable, folderBaseSegments, projectDestinations])

  const cancelPendingDestination = useCallback(() => {
    // A real third answer — "wrong project, my mistake" — not a dismissal.
    setPendingDestination(null)
  }, [])

  /** Move the note in the buffer to the pending destination.
   *
   *  Ordered so no failure can destroy: journal, write the new file, verify it
   *  by read-back, and only then touch the origin. A failure before the last
   *  step leaves a duplicate, which a person fixes in seconds; the reverse
   *  order leaves nothing.
   *
   *  Never appends. A destination that already holds today's note gets a
   *  `-2` beside it, so one move is always one file. */
  const moveNoteToPendingDestination = useCallback(async () => {
    const pending = pendingDestination
    if (!pending || movingNote) return
    // Todo mode has no note to move — `todos.create` appends into a list, so
    // there is no single file that is "this note".
    if (makeThisTodo) {
      applyBaseSegments(pending.segments, false)
      setPendingDestination(null)
      return
    }
    setMovingNote(true)
    setError(null)
    setMessage(null)
    try {
      if (!(await ensureBufferDurable())) return

      const originPath = targetPath
      const originContent = contentRef.current
      const originLastWritten = loadedBaseContentRef.current
      const originSessionStart = sessionOriginContentRef.current
      const originCreatedHere = createdTargetRef.current

      const destinationSegmentsNext = withSuffixBlock(pending.segments, activeShortcut.pathSegments)
      const destinationFolder = destinationSegmentsNext.join('/')
      const chosen = await findFreeFilename(destinationFolder, normalizedFilename)
      if (!chosen) {
        setError(`Could not find a free file name in ${destinationFolder}.`)
        return
      }

      // The buffer holds generated frontmatter from earlier saves; the
      // capability generates its own, so only the body travels.
      const body = splitNoteFrontmatterBlock(originContent).body
      const created = await invokeCapabilityOrThrow({
        capability: 'thoughts.create',
        input: {
          folder_path: destinationFolder,
          filename: chosen,
          content: body,
          title: useCustomTitle ? (title.trim() || null) : null,
          // Already baked into the body by whichever save wrote it first;
          // asking for it again would stamp a second one.
          date_header: false,
          emotions,
          tags,
          // Narrowed by the todo early-return above.
          note_kind: noteKind,
        },
        actor: THOUGHTS_ACTOR,
      })
      const refreshed = await getThoughtForEdit(created.output_path)

      // Origin cleanup. Only ever touched when it still holds exactly what we
      // last wrote — if anything changed it underneath us, it is not ours.
      let originNote = ''
      if (originPath) {
        try {
          const fs = getVaultFS()
          if (await fs.exists(originPath)) {
            const action = originCleanupActionBlock({
              onDisk: await fs.read(originPath),
              lastWritten: originLastWritten,
              sessionStart: originSessionStart,
              createdHere: originCreatedHere,
            })
            if (action === 'delete') await fs.delete(originPath)
            else if (action === 'restore') await fs.write(originPath, originSessionStart)
            else if (action === 'changed-elsewhere') {
              originNote = ' The original was changed elsewhere, so it was left in place.'
            }
          }
        } catch {
          originNote = ' The original could not be cleaned up and is still there.'
        }
      }

      // Retarget onto the note's new home.
      applyBaseSegments(pending.segments, false)
      setFilenameState(chosen)
      setFilenameTouched(true)
      contentRef.current = refreshed.content
      loadedBaseContentRef.current = refreshed.content
      sessionOriginContentRef.current = refreshed.content
      createdTargetRef.current = true
      setContent(refreshed.content)
      setLoadedTargetPath(created.output_path)
      setTargetFileState({
        path: created.output_path,
        exists: true,
        baseMtime: refreshed.mtime,
        baseHash: refreshed.hash,
      })
      setSavedPath(created.output_path)
      setSaveFailureCount(0)
      journal.resolve()
      rememberDestinationUsage(destinationSegmentsNext)
      setPendingDestination(null)
      setMessage(`Moved to ${created.output_path}.${originNote}`)
      triggerSaveFeedback()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the note')
    } finally {
      setMovingNote(false)
    }
  }, [
    activeShortcut.pathSegments,
    applyBaseSegments,
    emotions,
    ensureBufferDurable,
    makeThisTodo,
    findFreeFilename,
    journal,
    movingNote,
    noteKind,
    normalizedFilename,
    pendingDestination,
    rememberDestinationUsage,
    tags,
    targetPath,
    title,
    triggerSaveFeedback,
    useCustomTitle,
  ])

  /** Leave the current note where it is and open a blank one at the pending
   *  destination. Saves first, and refuses to clear if that save fails. */
  const startNewNoteAtPendingDestination = useCallback(async () => {
    const pending = pendingDestination
    if (!pending || movingNote) return
    setMovingNote(true)
    setError(null)
    try {
      if (bufferHasUnsavedTextBlock(contentRef.current, loadedBaseContentRef.current)) {
        await saveRef.current()
        if (bufferHasUnsavedTextBlock(contentRef.current, loadedBaseContentRef.current)) {
          setError(current => current
            ? `${current} — nothing was moved or cleared.`
            : 'Could not save the current note, so nothing was moved or cleared.')
          return
        }
      }
      const destinationSegmentsNext = withSuffixBlock(pending.segments, activeShortcut.pathSegments)
      const chosen = await findFreeFilename(destinationSegmentsNext.join('/'), todayFilenameBlock())
      if (!chosen) {
        setError(`Could not find a free file name in ${destinationSegmentsNext.join('/')}.`)
        return
      }
      // Cleared before the path moves, so the destination-load effect finds no
      // draft to carry across into the new note.
      contentRef.current = ''
      loadedBaseContentRef.current = ''
      sessionOriginContentRef.current = ''
      setContent('')
      setUseCustomTitleState(false)
      setTitle('')
      setEmotions([])
      setTags([])
      setFilenameState(chosen)
      setFilenameTouched(true)
      setSavedPath(null)
      setItemsAdded(0)
      applyBaseSegments(pending.segments, false)
      setPendingDestination(null)
    } finally {
      setMovingNote(false)
    }
  }, [
    activeShortcut.pathSegments,
    applyBaseSegments,
    findFreeFilename,
    movingNote,
    pendingDestination,
  ])

  // --- destination note load -------------------------------------------------

  useEffect(() => {
    if (makeThisTodo) {
      // Only on the *transition* into todo mode. This branch also runs when the
      // destination changes while already in todo mode, and swapping the buffer
      // then would throw away the tasks being typed.
      if (stashedProseRef.current === null) {
        stashedProseRef.current = {
          content: contentRef.current,
          base: loadedBaseContentRef.current,
          loadedPath: loadedTargetPath,
          fileState: targetFileStateRef.current,
        }
        contentRef.current = stashedTodoRef.current
        loadedBaseContentRef.current = ''
        setContent(stashedTodoRef.current)
      }
      setLoadingTargetContent(false)
      setLoadedTargetPath(null)
      setTargetFileState(null)
      setSavedPath(null)
      return
    }
    // Leaving todo mode: hand the prose back, and stash the tasks in its place
    // so the return trip is symmetric.
    if (stashedProseRef.current) {
      const stash = stashedProseRef.current
      stashedProseRef.current = null
      stashedTodoRef.current = contentRef.current
      contentRef.current = stash.content
      loadedBaseContentRef.current = stash.base
      setContent(stash.content)
      setLoadedTargetPath(stash.loadedPath)
      setTargetFileState(stash.fileState)
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
          // Nothing there yet, so whatever this session writes brings the file
          // into existence — which is what makes it safe to reap later if it
          // ends up empty.
          createdTargetRef.current = true
          sessionOriginContentRef.current = ''
          loadedBaseContentRef.current = ''
          setContent(preservedDraft)
          setLoadedTargetPath(targetPath)
          setTargetFileState({ path: targetPath, exists: false, baseMtime: null, baseHash: null })
          return
        }
        const existing = await getThoughtForEdit(targetPath)
        if (cancelled || requestId !== loadTargetRequestRef.current) return
        createdTargetRef.current = false
        sessionOriginContentRef.current = existing.content
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

  targetFileStateRef.current = targetFileState

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
        setSaveFailureCount(0)
        lastTodoSubmitRef.current = contentRef.current
        journal.resolve()
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
      setSaveFailureCount(0)
      // The read-back above confirms the text is at its target, which is the
      // only condition under which a draft may be forgotten.
      journal.resolve()
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
      // Drives the retry below. Without it a failed save simply sat there: the
      // auto-save effect only re-fires on a `content` change, so stopping
      // typing after a failure left the text unsaved indefinitely, with an
      // error string as the only trace.
      setSaveFailureCount(count => count + 1)
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
    journal,
    targetFileState,
    targetPath,
    title,
    todoDateStr,
    triggerSaveFeedback,
    useCustomTitle,
  ])

  /** Explicit save — the Cmd+S / Ctrl+S path.
   *
   *  In manual mode this is the primary gesture. With auto-save on it still
   *  means something real: flush now rather than waiting out the debounce,
   *  which is the reflex most people already have.
   *
   *  Silent when there is nothing to do. A reflex keystroke that raises an
   *  error banner teaches people to stop pressing it. */
  const requestSave = useCallback(async () => {
    if (!shouldRequestSaveBlock({
      makeThisTodo,
      content: contentRef.current,
      base: loadedBaseContentRef.current,
      saving,
      loadingTargetContent,
      canSave,
      todoItemCount,
      lastTodoSubmit: lastTodoSubmitRef.current,
    })) return
    await saveRef.current()
  }, [canSave, loadingTargetContent, makeThisTodo, saving, todoItemCount])

  // --- auto-save -------------------------------------------------------------
  //
  // Mirrors the explorer's editing badge: the save state is ambient, so there
  // is no Save button in the normal path. Turning auto-save off brings one
  // back (see `saveState`/`autoSaveEnabled` consumers).
  //
  // Never runs in todo mode: `todos.create` *appends* the parsed items, so a
  // debounced re-fire would duplicate every task on each keystroke pause.
  saveRef.current = save

  useEffect(() => {
    if (!autoSaveEnabled || makeThisTodo) return
    if (!isDirty || !canSave) return
    const timer = window.setTimeout(() => { void saveRef.current() }, AUTO_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [autoSaveEnabled, canSave, isDirty, makeThisTodo, content])

  // Journal every keystroke that isn't on disk yet.
  //
  // Runs regardless of `autoSaveEnabled`, of whether a destination has been
  // chosen, and of whether the last save failed — those are precisely the gaps
  // where the buffer was previously the only copy. Todo mode is journaled too:
  // `todos.create` appends, so auto-save skips it entirely, which made it the
  // single least protected surface in the composer.
  useEffect(() => {
    if (!bufferHasUnsavedTextBlock(content, loadedBaseContentRef.current)) return
    journal.record({
      content,
      targetPath,
      createdTarget: createdTargetRef.current,
    })
  }, [content, journal, targetPath])

  // Retry a save that failed, with backoff, until the text is on disk.
  //
  // Deliberately not gated on `autoSaveEnabled`: this only ever retries an
  // attempt that already happened, so in manual mode it is finishing the save
  // the user asked for rather than starting one they didn't. Never runs in todo
  // mode — `todos.create` appends, so a retry after a *partial* success would
  // duplicate tasks.
  //
  // ENERGY contract: conditional, not periodic. The timer exists only while a
  // failure is outstanding and the buffer is still dirty, and it stops the
  // moment either clears.
  useEffect(() => {
    if (saveFailureCount === 0 || makeThisTodo) return
    if (!isDirty || !canSave || saving) return
    const delay = saveRetryDelayBlock(saveFailureCount)
    if (delay === 0) return
    const timer = window.setTimeout(() => { void saveRef.current() }, delay)
    return () => window.clearTimeout(timer)
  }, [canSave, isDirty, makeThisTodo, saveFailureCount, saving])

  // Reap the husk left behind when the destination moves.
  //
  // The frontmatter-only file that auto-save creates from a single character —
  // typed, then deleted — would otherwise sit in the vault forever, because
  // `canSave` goes false the moment the body empties and auto-save never fires
  // again to clean up after itself.
  const previousTargetRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousTargetRef.current
    previousTargetRef.current = targetPath
    if (!previous || previous === targetPath) return
    void reapHuskAtPath(previous)
  }, [reapHuskAtPath, targetPath])

  // Flush on the way out.
  //
  // Nothing here listened for teardown before, so the 1200ms auto-save debounce
  // was simply lost whenever you navigated away or quit mid-thought. Unmount is
  // the reliable half — the app is still running, so the write completes. The
  // window events are best-effort: neither `beforeunload` nor `pagehide` waits
  // on async work, which is exactly why the recovery journal exists rather than
  // this being the whole answer.
  useEffect(() => {
    const flush = () => {
      if (!shouldFlushOnTeardownBlock({
        makeThisTodo: makeThisTodoRef.current,
        content: contentRef.current,
        base: loadedBaseContentRef.current,
      })) return
      void saveRef.current()
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      flush()
      // Leaving the composer on an empty note it created: clean up rather than
      // leave a husk. `flush` above has already saved anything worth keeping,
      // and `reapHuskAtPath` re-reads the file and refuses anything that has
      // content, so the two cannot fight.
      void reapHuskAtPath(previousTargetRef.current)
    }
  }, [reapHuskAtPath])

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
    requestSave,

    pendingDestination,
    movingNote,
    moveNoteToPendingDestination,
    startNewNoteAtPendingDestination,
    cancelPendingDestination,

    recoverableDrafts: recovery.recoverableDrafts,
    recoverDraft,
    discardDraft: recovery.discardDraft,
  }
}
