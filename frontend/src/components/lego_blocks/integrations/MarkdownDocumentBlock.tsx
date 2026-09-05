import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  markdownMathRehypePluginsBlock,
  markdownMathRemarkPluginsBlock,
} from '@/services/lego_blocks/integrations/markdownMathPluginsBlock'
import { markdownCodeHighlightRehypePluginsBlock } from '@/services/lego_blocks/integrations/markdownCodeHighlightPluginBlock'
import TikzDiagramBlock from '@/components/lego_blocks/units/TikzDiagramBlock'
import { X, FileText, ExternalLink, Pencil, Save, FolderOpen, Workflow, List, LayoutDashboard, BookOpenText, Minimize2, Maximize2 } from 'lucide-react'
import {
  MarkdownDocumentConflictError,
  readMarkdownDocument,
  saveMarkdownDocument,
} from '@/services/orchestrators/markdownDocumentsOrch'
import {
  serializeExcalidrawSceneOrch,
  parseExcalidrawSceneRawOrch,
  type ParsedExcalidrawScene,
} from '@/services/orchestrators/excalidrawSceneOrch'
import {
  excalidrawSaveGuardBlock,
  excalidrawTextCharsBlock,
  type ExcalidrawSaveTriggerBlock,
} from '@/services/lego_blocks/units/excalidrawSaveGuardBlock'
import { useExcalidrawDraftJournalBlock } from '@/components/lego_blocks/hooks/shared/useExcalidrawDraftJournalBlock'
import {
  applyExcalidrawDeltaBlock,
  type ExcalidrawElementLikeBlock,
  type ExcalidrawSceneDeltaBlock,
} from '@/services/lego_blocks/units/excalidrawSceneDeltaBlock'
import {
  readAllDraftsBlock,
  resolveDraftBlock,
} from '@/services/lego_blocks/integrations/noteDraftJournalStoreBlock'
import type { ExcalidrawCanvasApiOrch } from '@/services/orchestrators/excalidrawIntegrationOrch'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useNativeChromeImmersionBlock } from '@/components/lego_blocks/hooks/shared/useNativeChromeImmersionBlock'
import {
  buildObsidianOpenUrlOrch,
  isThinkingSpaceWikilinkHrefOrch,
  parseThinkingSpaceWikilinkHrefOrch,
  resolveWikilinkAssetTargetOrch,
  remarkObsidianWikilinksOrch,
  resolveWikilinkTargetOrch,
} from '@/services/orchestrators/obsidianLinkOrch'
import {
  getAbsolutePathForClipboardOrch,
  getOpenInSystemLabelOrch,
  getRelativePathForClipboardOrch,
  openFileInNewTabOrch,
  openFileInNewWindowOrch,
  openVaultPathWithDefaultAppOrch,
  openVaultPathInSystemOrch,
  renameVaultPathOrch,
} from '@/services/orchestrators/fileSystemOrch'
import ExcalidrawDocumentBlock from '@/components/lego_blocks/integrations/ExcalidrawDocumentBlock'
import UrlDocumentBlock from '@/components/lego_blocks/integrations/UrlDocumentBlock'
import { isUrlShortcutPathBlock } from '@/services/lego_blocks/units/urlShortcutBlock'
import TableDocumentBlock from '@/components/lego_blocks/integrations/TableDocumentBlock'
import PdfDocumentBlock from '@/components/lego_blocks/integrations/PdfDocumentBlock'
import GoogleDocDocumentBlock from '@/components/lego_blocks/integrations/GoogleDocDocumentBlock'
import ImageDocumentBlock from '@/components/lego_blocks/integrations/ImageDocumentBlock'
import HtmlDocumentBlock from '@/components/lego_blocks/integrations/HtmlDocumentBlock'
import MarkdownMindmapPanelBlock from '@/components/lego_blocks/integrations/MarkdownMindmapPanelBlock'
import MarkdownMiniNavBlock from '@/components/lego_blocks/integrations/MarkdownMiniNavBlock'
import MarkdownTableOfContentsBlock from '@/components/lego_blocks/integrations/MarkdownTableOfContentsBlock'
import MarkdownRichEditorBlock from '@/components/lego_blocks/integrations/MarkdownRichEditorBlock'
import NoteCanvasBlock from '@/components/lego_blocks/integrations/NoteCanvasBlock'
import SegmentedToggleBlock from '@/components/lego_blocks/units/ui/SegmentedToggleBlock'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/lego_blocks/units/ui/tooltip'
import { resolveEditorLanguageBlock } from '@/components/lego_blocks/units/editorLanguageBlock'
import CodeDocumentViewBlock from '@/components/lego_blocks/integrations/CodeDocumentViewBlock'
import { useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import { parseNoteCanvasBlock } from '@/services/lego_blocks/units/noteCanvasBlock'
import InfoPanelToggleButtonBlock from '@/components/lego_blocks/units/InfoPanelToggleButtonBlock'
import OverflowMenuButtonBlock from '@/components/lego_blocks/units/ui/OverflowMenuButtonBlock'
import { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import { resolveFrontmatterDatesBlock } from '@/services/lego_blocks/units/frontmatterDatesBlock'
import { cn } from '@/lib/utils'
import { thinkingSpaceMarkdownUrlTransformBlock } from '@/services/lego_blocks/integrations/markdownUrlTransformBlock'
import {
  readMarkdownEditorSettingsOrch,
  type MarkdownEditorSettingsBlock,
} from '@/services/orchestrators/markdownEditorSettingsOrch'
import { DOCUMENT_FONT_STACKS_BLOCK } from '@/services/lego_blocks/integrations/markdownEditorSettingsBlock'
import { STORAGE_KEYS, getStorageItem } from '@/services/orchestrators/storageOrch'
import {
  addGlobalSyncRefreshListenerBlock,
  dispatchGlobalSyncRefreshBlock,
} from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import { type StewardMetadataSuggestion } from '@/services/orchestrators/stewardMetadataOrch'
import {
  DEFERRED_RENDER_CHARS,
  buildFrontmatterMetaState,
  extractTextFromNode,
  formatUnixTimestampForMeta,
  formatBytes,
  frontmatterObjectToBlock,
  isBlankLineMarkerText,
  parseFrontmatterObject,
  preserveExtraBlankLinesInMarkdown,
  scheduleDeferredWork,
  splitFrontmatter,
  stripFrontmatter,
  type MarkdownMeta,
  yamlTextToFrontmatterBlock,
  yieldToNextFrame,
} from '@/components/lego_blocks/units/MarkdownDocumentContentBlock'
import { readMemorizedSessions } from '@/services/lego_blocks/units/memorizedSessionsBlock'
import DocumentFindBarBlock from '@/components/lego_blocks/integrations/DocumentFindBarBlock'
import { useInDocumentFindBlock } from '@/components/lego_blocks/hooks/units/useInDocumentFindBlock'
import { useSessionTelemetryBlock } from '@/components/lego_blocks/hooks/units/useSessionTelemetryBlock'
import { isTableDocumentPathBlock } from '@/services/lego_blocks/units/tableDocumentPathBlock'
import { isPdfDocumentPathBlock } from '@/services/lego_blocks/units/pdfDocumentPathBlock'
import { isGoogleDocDocumentPathBlock } from '@/services/lego_blocks/units/googleDocDocumentPathBlock'
import { isImageDocumentPathBlock } from '@/services/lego_blocks/units/imageDocumentPathBlock'
import { isExcalidrawPathBlock } from '@/services/lego_blocks/units/excalidrawPathBlock'
import { dispatchPageTopInsetBlock } from '@/services/lego_blocks/units/pageTopInsetBlock'
import { isHtmlDocumentPathBlock } from '@/services/lego_blocks/units/htmlDocumentPathBlock'
import { readImageDocumentOrch } from '@/services/orchestrators/imageDocumentsOrch'
import { useRouteActivityBlock } from '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
import { useScreenWakeLockBlock } from '@/components/lego_blocks/hooks/useScreenWakeLockBlock'
import {
  useReadingAttentionBlock,
  type CanvasSamplersBlock,
} from '@/components/lego_blocks/hooks/shared/useReadingAttentionBlock'
import {
  clearExcalidrawCrashMarkerBlock,
  excalidrawMarkerActionBlock,
  markExcalidrawCrashStageBlock,
} from '@/services/lego_blocks/units/excalidrawCrashMarkerBlock'
import {
  parseMarkdownTableOfContentsBlock,
  type MarkdownTableOfContentsItemBlock,
} from '@/services/lego_blocks/units/markdownTableOfContentsBlock'

function formatMemorizedTimeRange(startedIso: string, endedIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${fmt(startedIso)}–${fmt(endedIso)}`
}

export type MarkdownViewerMode = 'view' | 'edit'

interface MarkdownDocumentBlockProps {
  path: string
  active?: boolean
  /** Whether time on this document counts as reading. Opt-in, because this
   *  block also renders inside canvas tiles, memory-file lists and previews —
   *  all of which mount with `active` and would each accrue attention in
   *  parallel for documents nobody is reading. Only real reading surfaces
   *  (the workspace, the slide-over viewer) pass true. */
  countsAsReading?: boolean
  initialMode?: MarkdownViewerMode
  onSaved?: (result: { output_path: string; revision_path: string | null }) => void
  onOpenPath?: (path: string) => void
  onOpenPathForEdit?: (path: string) => void
  onOpenAsNotebook?: (path: string) => void
  onClose?: () => void
  showCloseButton?: boolean
  className?: string
  topBarHidden?: boolean
}

interface MarkdownEditBaselineState {
  content: string
}

const SUPPORTED_TEXT_EXTENSIONS_BLOCK = new Set([
  'md', 'markdown', 'txt', 'text', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'kts', 'go', 'rs',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'cs', 'swift', 'rb', 'php', 'scala', 'lua', 'r',
  'sql', 'graphql', 'gql', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'svg', 'tex',
  'log', 'csv', 'tsv',
])

function isUnsupportedFilePathBlock(path: string): boolean {
  const filename = path.split('/').pop()?.toLowerCase() ?? ''
  if (!filename) return false
  if (!filename.includes('.')) return false
  if (filename.startsWith('.')) return false
  const extension = filename.slice(filename.lastIndexOf('.') + 1).trim()
  if (!extension) return false
  return !SUPPORTED_TEXT_EXTENSIONS_BLOCK.has(extension)
}

interface MarkdownWikilinkImageBlockProps {
  src: string | undefined
  alt: string | undefined
  currentPath: string
}

function MarkdownWikilinkImageBlock({
  src,
  alt,
  currentPath,
}: MarkdownWikilinkImageBlockProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!src || !isThinkingSpaceWikilinkHrefOrch(src)) {
      setImageUrl(null)
      setError(null)
      return
    }

    const parsed = parseThinkingSpaceWikilinkHrefOrch(src)
    if (!parsed?.target) {
      setImageUrl(null)
      setError('Invalid embedded image target.')
      return
    }

    let cancelled = false
    let objectUrl: string | null = null

    const load = async () => {
      setImageUrl(null)
      setError(null)
      try {
        const resolvedPath = await resolveWikilinkAssetTargetOrch({
          currentPath,
          target: parsed.target,
        })
        if (!resolvedPath) {
          if (!cancelled) setError(`Embedded file not found: [[${parsed.target}]]`)
          return
        }
        const doc = await readImageDocumentOrch(resolvedPath)
        // Already a Uint8Array — `Uint8Array.from` takes the element-wise path
        // and doubles peak memory, which matters on iOS for large photos.
        const blob = new Blob([doc.bytes as BlobPart], { type: doc.mime })
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setImageUrl(objectUrl)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load embedded image.')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [currentPath, src])

  if (!src || !isThinkingSpaceWikilinkHrefOrch(src)) {
    return <img src={src} alt={alt ?? ''} />
  }

  if (error) {
    return (
      <span className="inline-flex rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
        {error}
      </span>
    )
  }

  if (!imageUrl) {
    return (
      <span className="inline-flex rounded border border-border/50 bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
        Loading image...
      </span>
    )
  }

  return (
    <img
      src={imageUrl}
      alt={alt ?? ''}
      className="max-w-full rounded-md border border-border/40"
      loading="lazy"
    />
  )
}

function MarkdownTextDocumentRuntimeBlock({
  path,
  active = true,
  countsAsReading = false,
  initialMode = 'view',
  onSaved,
  onOpenPath,
  onOpenPathForEdit,
  onOpenAsNotebook,
  onClose,
  showCloseButton = false,
  className,
  topBarHidden: topBarHiddenProp,
}: MarkdownDocumentBlockProps) {
  const { layout } = useUILayoutBlock()
  const { resolvedColorMode } = useUIThemeBlock()
  const isIosSurface = layout.surface === 'capacitor-ios'
  const isElectronSurface = layout.surface === 'electron'
  const isIosPhone = isIosSurface && layout.mode === 'phone'
  const [mode, setMode] = useState<MarkdownViewerMode>(initialMode)
  const [viewSurface, setViewSurface] = useState<'doc' | 'canvas'>('doc')
  const [canvasSaveError, setCanvasSaveError] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [baseMtime, setBaseMtime] = useState<number | null>(null)
  const [baseCtime, setBaseCtime] = useState<number | null>(null)
  const [baseHash, setBaseHash] = useState<string | null>(null)

  const [sizeBytes, setSizeBytes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)
  const [manualSaveFeedbackVisible, setManualSaveFeedbackVisible] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<MarkdownDocumentConflictError | null>(null)
  const [showMeta, setShowMeta] = useState(false)
  const [topBarHiddenInViewMode] = useState<boolean>(
    () => getStorageItem(STORAGE_KEYS.markdownDocumentTopBarHidden) === '1',
  )
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [viewMindmapPanelOpen, setViewMindmapPanelOpen] = useState(false)
  const [editorSettings] = useState<MarkdownEditorSettingsBlock>(
    () => readMarkdownEditorSettingsOrch(),
  )
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [meta, setMeta] = useState<MarkdownMeta | null>(null)
  const [viewMarkdown, setViewMarkdown] = useState('')
  const [pendingFullRender, setPendingFullRender] = useState(false)
  const [filenameDraft, setFilenameDraft] = useState('')
  const [isHeaderRenameActive, setIsHeaderRenameActive] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const isExcalidrawDoc = isExcalidrawPathBlock(path)
  const chromeContainerRef = useRef<HTMLDivElement | null>(null)
  const readingSurfaceRef = useRef<HTMLDivElement | null>(null)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const lastScrollTopRef = useRef(0)
  const [isHeaderHidden, setIsHeaderHidden] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(0)
  const headerRenameInputRef = useRef<HTMLInputElement | null>(null)
  // iPhone: this pane is card-white, so the shell's reserved status-bar inset
  // shows as a grey band above it. Ask for a paper-colored inset while we're
  // the active pane — and release it on unmount/deactivate, since document
  // panes stay mounted behind `hidden` when you switch files.
  useEffect(() => {
    if (!isIosPhone || !active) return
    dispatchPageTopInsetBlock({ mode: 'paper' })
    return () => dispatchPageTopInsetBlock({ mode: 'default' })
  }, [isIosPhone, active])
  const manualSaveFeedbackTimeoutRef = useRef<number | null>(null)
  const excalidrawSceneRef = useRef<ParsedExcalidrawScene | null>(null)
  const excalidrawApiRef = useRef<ExcalidrawCanvasApiOrch | null>(null)
  const ignoreInitialExcalidrawChangeRef = useRef(true)
  const [hasExcalidrawChanges, setHasExcalidrawChanges] = useState(false)
  /** Set when the shrink guard refuses an auto-save. Auto-save must not simply
   *  retry on its timer — the scene has not changed, so it would fail again
   *  every 2 seconds forever, burning a wakeup each time (ENERGY contract) and
   *  re-raising the same banner. Cleared by the next real scene change, which
   *  is new information and worth one more attempt. */
  const [excalidrawAutoSaveBlocked, setExcalidrawAutoSaveBlocked] = useState(false)
  const [excalidrawImmersive, setExcalidrawImmersive] = useState(false)
  // While focus mode is up, the native iOS chrome hides so the fullscreen
  // overlay owns the screen (it's a web-layer div — the native bar would
  // cover its header otherwise).
  useNativeChromeImmersionBlock(excalidrawImmersive)
  const markdownSaveInFlightRef = useRef(false)
  const markdownSavePromiseRef = useRef<Promise<boolean> | null>(null)
  const markdownEditBaselineRef = useRef<MarkdownEditBaselineState | null>(null)
  const markdownCancelRevertInFlightRef = useRef(false)
  const excalidrawCrashMarkerClearTimeoutRef = useRef<number | null>(null)
  const preserveExcalidrawCrashMarkerOnUnmountRef = useRef(false)
  const handleSaveRef = useRef<(trigger?: ExcalidrawSaveTriggerBlock) => Promise<void>>(async () => {})
  /** Elements in the drawing as it stands on disk, for the shrink guard.
   *
   *  `null` means "not counted yet"; the save path fills it lazily and then
   *  carries it forward from its own writes, so a document is parsed for this
   *  at most once per open. Reset when the document changes.
   *
   *  Staleness after an *external* edit is deliberate and harmless: a stale
   *  count only makes the guard more or less strict, and a genuine external
   *  edit is caught by the mtime/hash conflict check regardless. */
  const excalidrawBaselineCountRef = useRef<number | null>(null)
  /** Has the Excalidraw API attached for the document currently open?
   *
   *  The crash marker's whole meaning depends on this: a teardown after a
   *  successful attach is a normal close, a teardown before one is a mount that
   *  never finished. */
  const excalidrawApiEverAttachedRef = useRef(false)
  /** Text characters in the drawing as it stands on disk. Counted alongside the
   *  element count and carried forward the same way. */
  const excalidrawBaselineTextCharsRef = useRef<number | null>(null)

  // Annotations are never only in the canvas. See docs/contracts/DURABILITY.md.
  // Runs regardless of `autoSaveEnabled` — that setting decides when the *file*
  // is written, not whether a second copy of the work exists.
  const excalidrawJournal = useExcalidrawDraftJournalBlock(useCallback(() => {
    const api = excalidrawApiRef.current
    if (!api) return null
    return api.getSceneElementsBlock() as unknown as ExcalidrawElementLikeBlock[]
  }, []))

  const loadDocument = useCallback(async (seedDraft = false) => {
    setLoading(true)
    setError(null)
    setSaveError(null)
    setNavigationError(null)
    setConflict(null)
    setHasExcalidrawChanges(false)
    setExcalidrawImmersive(false)
    markdownEditBaselineRef.current = null
    markdownCancelRevertInFlightRef.current = false
    excalidrawSceneRef.current = null
    excalidrawApiRef.current = null
    ignoreInitialExcalidrawChangeRef.current = true
    try {
      const data = await readMarkdownDocument(path, { includeHash: false })
      setContent(data.content)
      setDraft(seedDraft && !isExcalidrawDoc ? data.content : '')
      setBaseMtime(data.mtime)
      setBaseCtime(data.ctime)
      setBaseHash(data.hash)
      setSizeBytes(data.size)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
      setContent(null)
      setDraft('')
      setBaseMtime(null)
      setBaseCtime(null)
      setBaseHash(null)
      setSizeBytes(0)
    } finally {
      setLoading(false)
    }
  }, [isExcalidrawDoc, path])

  useEffect(() => {
    setMode(initialMode)
    void loadDocument(initialMode === 'edit')
  }, [initialMode, loadDocument, path])

  const externalReloadStateRef = useRef({
    isEditing: false,
    hasChanges: false,
    baseMtime: null as number | null,
    baseHash: null as string | null,
    draft: '',
    content: null as string | null,
    loading: false,
    saving: false,
    autoSaving: false,
    hasConflict: false,
    isExcalidrawDoc: false,
  })

  useEffect(() => {
    return addGlobalSyncRefreshListenerBlock(() => {
      const snap = externalReloadStateRef.current
      if (snap.loading || snap.saving || snap.autoSaving || snap.hasConflict) return

      if (!snap.isEditing) {
        void loadDocument(false)
        return
      }

      if (!snap.hasChanges) {
        void loadDocument(true)
        return
      }

      if (snap.isExcalidrawDoc) return
      const baseMtime = snap.baseMtime
      const baseHash = snap.baseHash
      if (baseMtime === null) return

      void (async () => {
        try {
          const current = await readMarkdownDocument(path)
          const mtimeChanged = current.mtime !== baseMtime
          const hashChanged = baseHash !== null && current.hash !== baseHash
          if (!mtimeChanged && !hashChanged) return
          setConflict(new MarkdownDocumentConflictError(
            'This file changed on disk while you were editing.',
            {
              currentMtime: current.mtime,
              currentHash: current.hash,
              currentContent: current.content,
            },
          ))
          setSaveError('This file changed on disk while you were editing.')
        } catch {
          // ignore — surface on next save attempt
        }
      })()
    })
  }, [loadDocument, path])

  useEffect(() => {
    if (!excalidrawImmersive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExcalidrawImmersive(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [excalidrawImmersive])

  useEffect(() => {
    if (mode !== 'edit' || !isExcalidrawDoc) return
    markExcalidrawCrashStageBlock(path, 'editor_mounting')
  }, [isExcalidrawDoc, mode, path])

  const triggerManualSaveFeedback = useCallback(() => {
    if (manualSaveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(manualSaveFeedbackTimeoutRef.current)
    }
    setManualSaveFeedbackVisible(true)
    manualSaveFeedbackTimeoutRef.current = window.setTimeout(() => {
      setManualSaveFeedbackVisible(false)
      manualSaveFeedbackTimeoutRef.current = null
    }, 1600)
  }, [])

  useEffect(() => {
    return () => {
      if (manualSaveFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(manualSaveFeedbackTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (excalidrawCrashMarkerClearTimeoutRef.current !== null) {
        window.clearTimeout(excalidrawCrashMarkerClearTimeoutRef.current)
        excalidrawCrashMarkerClearTimeoutRef.current = null
      }
      if (!preserveExcalidrawCrashMarkerOnUnmountRef.current) {
        clearExcalidrawCrashMarkerBlock()
      }
    }
  }, [])

  const filename = path.split('/').pop() || path
  const breadcrumb = path.split('/').slice(0, -1).join(' / ')
  const canRenameInHeader = !!(onOpenPathForEdit || onOpenPath)
  const obsidianUrl = buildObsidianOpenUrlOrch(path)
  const openInSystemLabel = getOpenInSystemLabelOrch()
  const canOpenInSystem = openInSystemLabel !== null
  const openInSystemButtonLabel = openInSystemLabel ?? 'System'
  const openLinkedPath = onOpenPath ?? onOpenPathForEdit
  const openRelatedThoughtPath = onOpenPathForEdit ?? onOpenPath
  const normalizePathForCompare = useCallback((candidate: string): string => (
    candidate
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .toLowerCase()
  ), [])

  const isEditing = mode === 'edit'

  // Reading holds the display awake. Scoped to the *active*
  // document in *view* mode: editing already produces a steady stream of taps
  // that keep the idle timer happy, and an inactive/background tab isn't being
  // read. Users can turn this off in Settings ▸ Theme.
  //
  // Excalidraw is the exception to the editing rule. A canvas in edit mode is
  // still mostly *looked at* — a diagram or a page of handwritten notes you sit
  // with and think about — and on iPad the Pencil hovering above the glass is
  // not a touch, so the idle timer fires mid-thought exactly as it would while
  // reading. The canvas therefore holds the lease in both modes.
  //
  // This predicate is also what "reading" means for time accounting, so the
  // two consumers below share one expression rather than each deriving their
  // own — a wake lock held while nothing is being counted (or the reverse)
  // would be a silent disagreement about the same question.
  // `active` is pane selection *within* a surface — it stays true for a
  // document in a workspace tab you navigated away from, because every tab
  // stays mounted behind `visibility: hidden`. A document nobody can see is
  // not being read and must not hold the screen awake, so surface visibility
  // is part of the same predicate. RouteActivityContextBlock defaults to true,
  // so surfaces outside a provider (the slide-over, which is always on top)
  // are unaffected.
  const surfaceVisible = useRouteActivityBlock()
  const attending = surfaceVisible && active && (!isEditing || isExcalidrawDoc)
    && !loading && error === null
  useScreenWakeLockBlock(attending)

  // A reading span is filed against the document's uuid when it has one, so a
  // rename doesn't split its history. Read off the saved content rather than
  // the draft: an in-flight edit to the frontmatter should not retarget the
  // sitting that is already underway.
  const documentUuid = useMemo(() => {
    const { frontmatter } = splitFrontmatter(content ?? '')
    if (!frontmatter) return null
    const raw = parseFrontmatterObject(frontmatter).uuid
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null
  }, [content])

  // The canvas publishes a viewport reader; reading attention pulls it to
  // record *where* on the canvas the time went. Held as state so mounting the
  // canvas restarts the sitting with stations enabled rather than silently
  // measuring a canvas with no `where`.
  const [canvasSamplers, setCanvasSamplers] = useState<CanvasSamplersBlock | null>(null)
  const handleCanvasViewportSampler = useCallback(
    (samplers: CanvasSamplersBlock | null) => setCanvasSamplers(samplers),
    [],
  )

  useReadingAttentionBlock(countsAsReading ? path : null, attending, {
    surfaceRef: readingSurfaceRef,
    scrollRef: contentScrollRef,
    uuid: documentUuid,
    canvasSamplers,
  })

  // Live preview makes the view/edit split mostly ceremonial for text docs.
  // Entering editing is a long-press on EVERY surface (mouse and touch alike):
  // a plain click stays reading, holding ~450ms drops you into the editor at
  // the press point. Uniform "hold to edit" kills accidental-edit clicks on
  // desktop/Electron and matches the touch gesture, while the pencil stays as
  // the discoverable primary. Excalidraw/HTML docs keep explicit edit only.
  const livePreviewTextDoc = editorSettings.livePreviewSyntaxHiding && !isExcalidrawDoc && !isHtmlDocumentPathBlock(path)
  const longPressToEditActive = livePreviewTextDoc

  const pendingEditCaretHintRef = useRef<{ before: string; after: string } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null)

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressStartRef.current = null
  }

  const captureCaretHintAtPoint = (ownerDocument: Document, x: number, y: number) => {
    pendingEditCaretHintRef.current = null
    const doc = ownerDocument as Document & {
      caretRangeFromPoint?: (px: number, py: number) => Range | null
    }
    const range = doc.caretRangeFromPoint?.(x, y)
    const node = range?.startContainer
    if (range && node && node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      const offset = range.startOffset
      pendingEditCaretHintRef.current = {
        before: text.slice(Math.max(0, offset - 24), offset),
        after: text.slice(offset, offset + 32),
      }
    }
  }

  const handleViewPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!longPressToEditActive || loading || !!error) return
    // Primary button / touch / pen only — never right-click or secondary.
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('a,button,input,textarea,select,summary,[role="button"],img,video,audio')) return
    const ownerDocument = event.currentTarget.ownerDocument
    const { clientX, clientY } = event
    longPressStartRef.current = { x: clientX, y: clientY }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      // If the hold turned into a text selection, respect that — don't hijack.
      const selection = ownerDocument.getSelection?.()
      if (selection && !selection.isCollapsed) { longPressStartRef.current = null; return }
      captureCaretHintAtPoint(ownerDocument, clientX, clientY)
      startEditing()
    }, 450)
  }

  const handleViewPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = longPressStartRef.current
    if (!start) return
    // Any real movement means scrolling or selecting, not a long-press.
    if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10) {
      clearLongPressTimer()
    }
  }
  const isHtmlDoc = isHtmlDocumentPathBlock(path)
  // Code files (.ts/.py/.json/…) are read/edited as code, never as markdown —
  // the prose renderer wraps comments/imports as paragraphs. In view mode they
  // get a read-only syntax-highlighted CM6 surface instead of ReactMarkdown.
  const isCodeDoc = !isExcalidrawDoc && !isHtmlDoc && resolveEditorLanguageBlock(path).kind === 'code'
  const supportsMindmap = !isExcalidrawDoc
    && !isHtmlDoc
    && /\.md$/i.test(path)
    && !/\.excalidraw\.md$/i.test(path)
  const effectiveTopBarHidden = topBarHiddenProp !== undefined ? topBarHiddenProp : topBarHiddenInViewMode
  const hideTopBarInView = !isEditing && effectiveTopBarHidden

  // In-document find (Cmd/Ctrl+F) for the rendered reading view. Edit mode has
  // CodeMirror's own find, so we only intercept the shortcut in view mode.
  const findEligible = active && !isEditing && !isExcalidrawDoc && !isHtmlDoc && !isCodeDoc
  const find = useInDocumentFindBlock(contentScrollRef, { active: findOpen && findEligible })
  useEffect(() => {
    if (!findEligible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [findEligible])

  useEffect(() => {
    const el = chromeContainerRef.current
    if (!el) {
      setHeaderHeight(0)
      return
    }
    if (hideTopBarInView) {
      setHeaderHeight(0)
      return
    }
    const measure = () => setHeaderHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hideTopBarInView, showMeta, isEditing, isIosPhone])
  const hasTextChanges = isEditing && content !== null && draft !== content
  const hasChanges = isExcalidrawDoc ? (isEditing && hasExcalidrawChanges) : hasTextChanges

  externalReloadStateRef.current = {
    isEditing,
    hasChanges,
    baseMtime,
    baseHash,
    draft,
    content,
    loading,
    saving,
    autoSaving,
    hasConflict: conflict !== null,
    isExcalidrawDoc,
  }
  const saveButtonLabel = saving ? 'Saving...' : manualSaveFeedbackVisible ? 'Saved' : 'Save'
  const saveButtonClassName = cn(
    'inline-flex items-center gap-1 border border-border/70 font-medium text-foreground transition-colors duration-200 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
    isIosPhone ? 'h-7 rounded-md px-2 text-[11px]' : 'rounded-lg px-2.5 py-1 text-xs',
    manualSaveFeedbackVisible && !saving
      ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600'
      : 'bg-transparent',
  )
  const shouldPadViewerContent = !isEditing && !isExcalidrawDoc && !isHtmlDoc
  // Exclude only true mobile Capacitor surfaces — NOT Electron. Capacitor's
  // isNativePlatform() returns true on Electron, so `!isCapacitorNative` wrongly
  // hid the rail there; gate on the resolved surface (which is 'electron' first).
  const isMobileNativeSurface = layout.surface === 'capacitor-ios' || layout.surface === 'capacitor-android'
  const showMiniNavRail = layout.mode === 'desktop' && !isMobileNativeSurface && !isHtmlDoc
  const sessionTelemetry = useSessionTelemetryBlock(showMiniNavRail)
  const miniNavAiTouch = useMemo(() => {
    if (!sessionTelemetry) return null
    const rel = path.replace(/^\.?\//, '')
    const kind = sessionTelemetry.files.get(rel) ?? sessionTelemetry.files.get(path)
    return kind ? { kind, topic: sessionTelemetry.topic } : null
  }, [path, sessionTelemetry])
  const displayContent = useMemo(
    () => {
      if (content === null) return ''
      const stripped = stripFrontmatter(content)
      // Hide the raw canvas fence in doc-mode rendering so users don't see
      // the JSON payload backing canvas mode.
      return parseNoteCanvasBlock(stripped).bodyWithoutCanvas
    },
    [content],
  )
  const displayDraft = useMemo(
    () => stripFrontmatter(draft),
    [draft],
  )
  const viewerTableOfContents = useMemo(
    () => (isHtmlDoc ? [] : parseMarkdownTableOfContentsBlock(displayContent)),
    [displayContent, isHtmlDoc],
  )
  const frontmatterMetaSource = isEditing ? draft : (content ?? '')
  const frontmatterMeta = useMemo(
    () => buildFrontmatterMetaState(frontmatterMetaSource),
    [frontmatterMetaSource],
  )
  const memorizedSessions = useMemo(
    () => readMemorizedSessions(frontmatterMetaSource),
    [frontmatterMetaSource],
  )
  const draftFrontmatter = useMemo(
    () => splitFrontmatter(draft).frontmatter,
    [draft],
  )
  const excalidrawEditorContent = useMemo(
    () => (draft || content || ''),
    [content, draft],
  )
  const setDraftFrontmatterYaml = useCallback((nextYamlText: string) => {
    setDraft((current) => {
      const { body } = splitFrontmatter(current)
      const nextFrontmatter = yamlTextToFrontmatterBlock(nextYamlText)
      return `${nextFrontmatter}${body}`
    })
  }, [])

  useEffect(() => {
    setFilenameDraft(filename)
    setRenameError(null)
    setRenaming(false)
    setIsHeaderRenameActive(false)
  }, [filename])

  useEffect(() => {
    if (isEditing) return
    setIsHeaderRenameActive(false)
  }, [isEditing])

  useEffect(() => {
    if (!isHeaderRenameActive) return
    const input = headerRenameInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [isHeaderRenameActive])
  const applyStewardSuggestionToDraft = useCallback((suggestion: StewardMetadataSuggestion) => {
    setDraft((current) => {
      const { frontmatter, body } = splitFrontmatter(current)
      const next = parseFrontmatterObject(frontmatter)
      const now = new Date().toISOString()
      const summary = suggestion.summary.trim()
      const suggestionParent = suggestion.suggestedIdeaKey || suggestion.suggestedEpicKey
      const tags = suggestion.tags.map(tag => tag.trim()).filter(Boolean)

      next.tags = tags
      next.ai_summary = summary
      next.ai_generated = true
      next.last_ai_update = now
      next.updated_at = now
      const existingDescription = typeof next.description === 'string' ? next.description.trim() : ''
      if (!existingDescription && summary) next.description = summary

      const rawAiSuggestions = next.ai_suggestions
      const aiSuggestions = (
        rawAiSuggestions && typeof rawAiSuggestions === 'object' && !Array.isArray(rawAiSuggestions)
          ? { ...(rawAiSuggestions as Record<string, unknown>) }
          : {}
      )
      const related = Array.isArray(aiSuggestions.related)
        ? [...aiSuggestions.related]
        : []
      const relatedMap = new Map<string, { key: string; reason: string; score: number }>()
      for (const entry of related) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const key = typeof (entry as Record<string, unknown>).key === 'string'
          ? String((entry as Record<string, unknown>).key).trim()
          : ''
        if (!key) continue
        const reason = typeof (entry as Record<string, unknown>).reason === 'string'
          ? String((entry as Record<string, unknown>).reason)
          : 'Suggested related context'
        const scoreRaw = (entry as Record<string, unknown>).score
        const score = typeof scoreRaw === 'number' ? scoreRaw : 0.5
        relatedMap.set(key, { key, reason, score })
      }
      if (suggestion.suggestedEpicKey) {
        relatedMap.set(suggestion.suggestedEpicKey, {
          key: suggestion.suggestedEpicKey,
          reason: 'Suggested epic context',
          score: 0.6,
        })
      }
      if (suggestion.suggestedIdeaKey) {
        relatedMap.set(suggestion.suggestedIdeaKey, {
          key: suggestion.suggestedIdeaKey,
          reason: 'Suggested idea context',
          score: 0.8,
        })
      }

      aiSuggestions.related = [...relatedMap.values()]
      if (suggestionParent) {
        aiSuggestions.suggested_move = { parent: suggestionParent }
      } else {
        delete aiSuggestions.suggested_move
      }
      next.ai_suggestions = aiSuggestions

      return `${frontmatterObjectToBlock(next)}${body}`
    })
  }, [])
  const handleApplyStewardSuggestion = useCallback(async (suggestion: StewardMetadataSuggestion) => {
    if (frontmatterMeta.parseError) {
      throw new Error('Fix YAML parse errors before accepting this purpose proposal.')
    }
    applyStewardSuggestionToDraft(suggestion)
  }, [applyStewardSuggestionToDraft, frontmatterMeta.parseError])
  const markdownRemarkPlugins = useMemo(
    () => [remarkGfm, ...markdownMathRemarkPluginsBlock, remarkObsidianWikilinksOrch],
    [],
  )
  const markdownRehypePlugins = useMemo(
    () => [...markdownMathRehypePluginsBlock, ...markdownCodeHighlightRehypePluginsBlock],
    [],
  )
  const renderedViewMarkdown = useMemo(
    () => (
      editorSettings.preserveNewlinesInViewMode
        ? preserveExtraBlankLinesInMarkdown(viewMarkdown)
        : viewMarkdown
    ),
    [editorSettings.preserveNewlinesInViewMode, viewMarkdown],
  )
  const shouldRelaxWhitespacePreservation = useMemo(
    () => /```tikz\b|(^|[^\\])\$\$|(^|[^\\])\$[^$\n]+\$/m.test(renderedViewMarkdown),
    [renderedViewMarkdown],
  )

  type MarkdownAnchorProps = ComponentPropsWithoutRef<'a'> & { node?: unknown }
  type MarkdownHeadingProps = ComponentPropsWithoutRef<'h1'> & { node?: unknown }
  type MarkdownParagraphProps = ComponentPropsWithoutRef<'p'> & { node?: unknown }
  type MarkdownImageProps = ComponentPropsWithoutRef<'img'> & { node?: unknown }
  const markdownComponents = useMemo(() => {
    let headingIndex = 0
    const renderHeading = (tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => (
      { children, ...props }: MarkdownHeadingProps,
    ) => {
      const HeadingTag = tag
      const tocItem = viewerTableOfContents[headingIndex++] ?? null
      return (
        <HeadingTag
          {...props}
          data-markdown-heading-id={tocItem?.id}
        >
          {children}
        </HeadingTag>
      )
    }

    return {
      a: ({ href, children, ...props }: MarkdownAnchorProps) => {
        const isWikilink = isThinkingSpaceWikilinkHrefOrch(href)

        const onClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
          if (!isWikilink || !href) {
            props.onClick?.(event)
            return
          }
          event.preventDefault()
          setNavigationError(null)
          const openInNewTab = event.metaKey || event.ctrlKey

          const parsed = parseThinkingSpaceWikilinkHrefOrch(href)
          if (!parsed) {
            setNavigationError('Invalid wikilink target.')
            return
          }

          void (async () => {
            try {
              const resolved = await resolveWikilinkTargetOrch({
                currentPath: path,
                target: parsed.target,
              })

              const resolvedPath = resolved.path ?? await resolveWikilinkAssetTargetOrch({
                currentPath: path,
                target: parsed.target,
              })

              if (!resolvedPath) {
                setNavigationError(`Linked file not found: [[${parsed.target}]]`)
                return
              }

              if (resolvedPath === path) return
              if (openInNewTab) {
                openFileInNewTabOrch(resolvedPath)
                setNavigationError(null)
                return
              }

              if (!openLinkedPath) {
                setNavigationError('Linked file navigation is unavailable in this view.')
                return
              }

              openLinkedPath(resolvedPath)
              setNavigationError(null)
            } catch (err) {
              setNavigationError(err instanceof Error ? err.message : 'Failed to open linked file')
            }
          })()
        }

        return (
          <a
            {...props}
            href={href}
            onClick={onClick}
            className={cn(props.className, isWikilink && 'cursor-pointer')}
          >
            {children}
          </a>
        )
      },
      h1: renderHeading('h1'),
      h2: renderHeading('h2'),
      h3: renderHeading('h3'),
      h4: renderHeading('h4'),
      h5: renderHeading('h5'),
      h6: renderHeading('h6'),
      p: ({ children, ...props }: MarkdownParagraphProps) => {
        const text = extractTextFromNode(children).replace(/\u00a0/g, ' ').trim()
        if (isBlankLineMarkerText(text)) {
          return <div className="ltm-markdown-blank-line" aria-hidden="true" />
        }
        return <p {...props}>{children}</p>
      },
      img: ({ src, alt }: MarkdownImageProps) => (
        <MarkdownWikilinkImageBlock
          src={src}
          alt={alt}
          currentPath={path}
        />
      ),
      code: ({ className, children, ...props }: any) => {
        const lang = /language-(\w+)/.exec(className || '')?.[1]
        if (lang === 'tikz') {
          const source = Array.isArray(children) ? children.join('') : String(children ?? '')
          return <TikzDiagramBlock source={source.replace(/\n$/, '')} />
        }
        return <code className={className} {...props}>{children}</code>
      },
    }
  }, [openLinkedPath, path, viewerTableOfContents])

  const scrollViewToHeading = useCallback(async (heading: MarkdownTableOfContentsItemBlock) => {
    if (pendingFullRender) {
      setViewMarkdown(displayContent)
      setPendingFullRender(false)
      await yieldToNextFrame()
      await yieldToNextFrame()
    }

    const container = contentScrollRef.current
    const headingElements = container
      ? Array.from(container.querySelectorAll<HTMLElement>('[data-markdown-heading-id]'))
      : Array.from(document.querySelectorAll<HTMLElement>('[data-markdown-heading-id]'))
    const target = headingElements.find((element) => element.dataset.markdownHeadingId === heading.id)
    if (!target) return
    // Land the heading ~1/3 down the viewport (near-center, slightly high) to
    // match the mini-nav rail's landing so the two outline panels behave alike.
    if (container) {
      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const offsetTop = targetRect.top - containerRect.top + container.scrollTop
      const max = Math.max(container.scrollHeight - container.clientHeight, 0)
      const top = Math.max(0, Math.min(max, offsetTop - container.clientHeight / 3))
      container.scrollTo({ top, behavior: 'smooth' })
    } else {
      const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - window.innerHeight / 3)
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }, [displayContent, pendingFullRender])

  useEffect(() => {
    if (!hasChanges || !manualSaveFeedbackVisible) return
    setManualSaveFeedbackVisible(false)
  }, [hasChanges, manualSaveFeedbackVisible])

  useEffect(() => {
    if (content === null) {
      setMeta(null)
      return
    }

    // Prefer YAML frontmatter dates (e.g. obsidian `created_at`/`updated_at`) over
    // fs stats — on iCloud/cloud-mirrored vaults birthtime and mtime are often equal.
    const resolved = resolveFrontmatterDatesBlock(content, {
      ctimeSeconds: baseCtime,
      mtimeSeconds: baseMtime,
    })
    const createdLabel = resolved.created ? resolved.created.toLocaleString() : formatUnixTimestampForMeta(baseCtime)
    const updatedLabel = resolved.updated ? resolved.updated.toLocaleString() : formatUnixTimestampForMeta(baseMtime)

    setMeta({
      lines: null,
      words: null,
      headings: null,
      size: formatBytes(sizeBytes),
      createdAt: createdLabel,
      updatedAt: updatedLabel,
    })

    if (!showMeta) return

    let cancelled = false
    const cancelDeferred = scheduleDeferredWork(() => {
      if (cancelled) return
      setMeta({
        lines: content.split('\n').length,
        words: content.split(/\s+/).filter(Boolean).length,
        headings: (content.match(/^#{1,6}\s/gm) || []).length,
        size: formatBytes(sizeBytes),
        createdAt: createdLabel,
        updatedAt: updatedLabel,
      })
    })

    return () => {
      cancelled = true
      cancelDeferred()
    }
  }, [baseCtime, baseMtime, content, showMeta, sizeBytes])

  useEffect(() => {
    if (content === null || isEditing || isExcalidrawDoc || isHtmlDoc) {
      setPendingFullRender(false)
      setViewMarkdown(displayContent)
      return
    }

    if (displayContent.length <= DEFERRED_RENDER_CHARS) {
      setPendingFullRender(false)
      setViewMarkdown(displayContent)
      return
    }

    let cancelled = false
    setViewMarkdown(displayContent.slice(0, DEFERRED_RENDER_CHARS))
    setPendingFullRender(true)
    const cancelDeferred = scheduleDeferredWork(() => {
      if (cancelled) return
      setViewMarkdown(displayContent)
      setPendingFullRender(false)
    })

    return () => {
      cancelled = true
      cancelDeferred()
    }
  }, [content, displayContent, isEditing, isExcalidrawDoc, isHtmlDoc, path])

  const handleExcalidrawSceneChange = useCallback((scene: ParsedExcalidrawScene) => {
    if (!isIosSurface) {
      excalidrawSceneRef.current = scene
    }

    if (ignoreInitialExcalidrawChangeRef.current) {
      ignoreInitialExcalidrawChangeRef.current = false
      return
    }

    setHasExcalidrawChanges(true)
    // New information: worth one more attempt if the guard refused the last one.
    setExcalidrawAutoSaveBlocked(false)
    // Trailing debounce inside — a stroke in progress keeps resetting it, so
    // this never runs mid-stroke.
    excalidrawJournal.noteSceneChanged()
  }, [excalidrawJournal, isIosSurface])

  // A different document means a different baseline.
  useEffect(() => {
    excalidrawBaselineCountRef.current = null
    excalidrawBaselineTextCharsRef.current = null
    excalidrawApiEverAttachedRef.current = false
  }, [path])

  // Annotations from a session that ended badly. Looked for once per document,
  // and only offered — never applied on its own. Silently mutating someone's
  // drawing on open would be its own kind of loss.
  const [recoverableAnnotations, setRecoverableAnnotations] = useState<
    { id: string; delta: ExcalidrawSceneDeltaBlock; updatedAt: string } | null
  >(null)

  useEffect(() => {
    if (!isExcalidrawDoc) { setRecoverableAnnotations(null); return }
    let cancelled = false
    void (async () => {
      const drafts = await readAllDraftsBlock().catch(() => [])
      if (cancelled) return
      const mine = drafts
        .filter(d => d.kind === 'excalidraw-delta' && d.targetPath === path)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (!mine) { setRecoverableAnnotations(null); return }
      try {
        setRecoverableAnnotations({
          id: mine.id,
          delta: JSON.parse(mine.content) as ExcalidrawSceneDeltaBlock,
          updatedAt: mine.updatedAt,
        })
      } catch {
        // Unparseable delta — nothing to offer, and nothing to be gained by
        // putting a broken banner in front of the drawing.
        setRecoverableAnnotations(null)
      }
    })()
    return () => { cancelled = true }
  }, [isExcalidrawDoc, path])

  const restoreAnnotations = useCallback(() => {
    const recovery = recoverableAnnotations
    const api = excalidrawApiRef.current
    if (!recovery || !api) return
    const baseline = api.getSceneElementsBlock() as unknown as ExcalidrawElementLikeBlock[]
    const restored = applyExcalidrawDeltaBlock(baseline, recovery.delta)
    if (!api.replaceSceneElementsBlock(restored)) {
      setSaveError('Could not restore the annotations into this canvas.')
      return
    }
    setHasExcalidrawChanges(true)
    setExcalidrawAutoSaveBlocked(false)
    setRecoverableAnnotations(null)
  }, [recoverableAnnotations])

  const discardAnnotations = useCallback(() => {
    const recovery = recoverableAnnotations
    if (!recovery) return
    setRecoverableAnnotations(null)
    void resolveDraftBlock(recovery.id)
  }, [recoverableAnnotations])


  const annotationRecoveryBlock = recoverableAnnotations ? (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
      <div className="font-medium">Unsaved annotations recovered</div>
      <div className="mt-0.5 text-xs opacity-80">
        {recoverableAnnotations.delta.changed.length} element
        {recoverableAnnotations.delta.changed.length === 1 ? '' : 's'} from a session that ended
        before saving.
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={restoreAnnotations}
          className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          Restore them
        </button>
        <button
          type="button"
          onClick={discardAnnotations}
          className="rounded-md px-2.5 py-1 text-xs font-medium hover:bg-amber-500/20"
        >
          Discard
        </button>
      </div>
    </div>
  ) : null

  // Point the journal at this drawing as it stands on disk. Everything the
  // journal stores is measured against these elements, so recovery is "the
  // file, plus what you did to it".
  useEffect(() => {
    if (!isExcalidrawDoc || content === null) return
    const elements = parseExcalidrawSceneRawOrch(content)?.elements
    if (!elements) return
    excalidrawJournal.setBaseline(path, elements as unknown as ExcalidrawElementLikeBlock[])
  }, [content, excalidrawJournal, isExcalidrawDoc, path])

  const handleExcalidrawApiChange = useCallback((api: ExcalidrawCanvasApiOrch | null) => {
    excalidrawApiRef.current = api
    if (!isExcalidrawDoc) return
    preserveExcalidrawCrashMarkerOnUnmountRef.current = true
    if (excalidrawCrashMarkerClearTimeoutRef.current !== null) {
      window.clearTimeout(excalidrawCrashMarkerClearTimeoutRef.current)
      excalidrawCrashMarkerClearTimeoutRef.current = null
    }
    if (!api) {
      // A null arrives from two very different events, and this used to treat
      // them as one: the editor mounting before its API exists, and the editor
      // *unmounting* because the document was closed. `ExcalidrawDocumentBlock`
      // fires `onApiChange(null)` from an effect cleanup, so every clean exit
      // planted a fresh `editor_mounting` marker that nothing ever cleared —
      // and the next launch reported a crash that never happened.
      //
      // Whether the API ever attached is what separates them. Attached then
      // gone means the editor stabilised and is now closing normally; never
      // attached means we really are mid-mount, which is the state worth
      // recording. Confirmed against a session on 2026-08-22 that reported a
      // crash with no jetsam kill and a cleanly saved file.
      const decision = excalidrawMarkerActionBlock({
        hasApi: false,
        everAttached: excalidrawApiEverAttachedRef.current,
      })
      if (decision.action === 'clear') {
        excalidrawApiEverAttachedRef.current = false
        preserveExcalidrawCrashMarkerOnUnmountRef.current = false
        clearExcalidrawCrashMarkerBlock()
        return
      }
      markExcalidrawCrashStageBlock(path, decision.stage)
      return
    }
    excalidrawApiEverAttachedRef.current = true
    markExcalidrawCrashStageBlock(path, 'api_attached')
    excalidrawCrashMarkerClearTimeoutRef.current = window.setTimeout(() => {
      preserveExcalidrawCrashMarkerOnUnmountRef.current = false
      clearExcalidrawCrashMarkerBlock()
      excalidrawCrashMarkerClearTimeoutRef.current = null
    }, 2500)
  }, [isExcalidrawDoc, path])

  const revertMarkdownToEditBaseline = useCallback(async () => {
    if (markdownCancelRevertInFlightRef.current) return
    const baseline = markdownEditBaselineRef.current
    if (!baseline || isExcalidrawDoc) return

    markdownCancelRevertInFlightRef.current = true
    try {
      let attempts = 0
      while (markdownSaveInFlightRef.current && attempts < 800) {
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), 25)
        })
        attempts += 1
      }

      const latestBaseline = markdownEditBaselineRef.current
      if (!latestBaseline) return

      const current = await readMarkdownDocument(path)
      if (current.content === latestBaseline.content) {
        setContent(current.content)
        setBaseMtime(current.mtime)
        setBaseCtime(current.ctime)
        setBaseHash(current.hash)
        setSizeBytes(current.size)
        setDraft('')
        return
      }

      const result = await saveMarkdownDocument({
        path,
        content: latestBaseline.content,
        baseMtime: current.mtime,
        baseHash: current.hash,
        baseContent: current.content,
      })
      setContent(latestBaseline.content)
      setBaseMtime(result.mtime)
      setBaseCtime(result.ctime)
      setBaseHash(result.hash)
      setSizeBytes(result.size)
      setDraft('')
      setNavigationError(null)
      setSaveError(null)
      setConflict(null)
    } catch (err) {
      setNavigationError(err instanceof Error ? `Cancel restore failed: ${err.message}` : 'Cancel restore failed.')
    } finally {
      markdownCancelRevertInFlightRef.current = false
    }
  }, [isExcalidrawDoc, path])

  const startEditing = () => {
    if (loading || error) return
    setFindOpen(false)
    if (isExcalidrawDoc) {
      preserveExcalidrawCrashMarkerOnUnmountRef.current = true
      markExcalidrawCrashStageBlock(path, 'edit_requested')
    }
    setViewMindmapPanelOpen(false)
    setMode('edit')
    setDraft(isExcalidrawDoc ? '' : (content ?? ''))
    markdownEditBaselineRef.current = isExcalidrawDoc
      ? null
      : { content: content ?? '' }
    setShowAiPanel(false)
    setSaveError(null)
    setNavigationError(null)
    setConflict(null)
    setHasExcalidrawChanges(false)
    setExcalidrawImmersive(isExcalidrawDoc)
    excalidrawSceneRef.current = null
    excalidrawApiRef.current = null
    ignoreInitialExcalidrawChangeRef.current = true
  }

  const cancelEditing = () => {
    if (excalidrawCrashMarkerClearTimeoutRef.current !== null) {
      window.clearTimeout(excalidrawCrashMarkerClearTimeoutRef.current)
      excalidrawCrashMarkerClearTimeoutRef.current = null
    }
    preserveExcalidrawCrashMarkerOnUnmountRef.current = false
    clearExcalidrawCrashMarkerBlock()
    setMode('view')
    setSaveError(null)
    setConflict(null)
    setShowAiPanel(false)
    setAutoSaving(false)
    setNavigationError(null)
    setHasExcalidrawChanges(false)
    setExcalidrawImmersive(false)
    excalidrawSceneRef.current = null
    ignoreInitialExcalidrawChangeRef.current = true
    if (!isExcalidrawDoc) {
      void revertMarkdownToEditBaseline()
    }
  }

  const useLatestConflictVersion = () => {
    if (!conflict) return
    preserveExcalidrawCrashMarkerOnUnmountRef.current = false
    clearExcalidrawCrashMarkerBlock()
    setContent(conflict.currentContent)
    setDraft(isExcalidrawDoc ? '' : conflict.currentContent)
    setBaseMtime(conflict.currentMtime)
    setBaseHash(conflict.currentHash)
    setSaveError(null)
    setConflict(null)
    setHasExcalidrawChanges(false)
    setExcalidrawImmersive(false)
    excalidrawSceneRef.current = null
    ignoreInitialExcalidrawChangeRef.current = true
  }

  const saveMarkdownDraft = useCallback(async (_reason: 'auto' | 'manual' = 'manual'): Promise<boolean> => {
    if (markdownSaveInFlightRef.current) return markdownSavePromiseRef.current ?? false
    if (isExcalidrawDoc || content === null || baseMtime === null) return false
    if (draft === content) return true

    const draftToSave = draft
    const savePromise = (async () => {
      markdownSaveInFlightRef.current = true
      setSaveError(null)
      setConflict(null)
      try {
        const result = await saveMarkdownDocument({
          path,
          content: draftToSave,
          baseMtime,
          baseHash,
          baseContent: content,
        })
        setContent(draftToSave)
        setBaseMtime(result.mtime)
        setBaseCtime(result.ctime)
        setBaseHash(result.hash)
        setSizeBytes(result.size)
        // Keep cancel baseline aligned with the latest persisted draft, including auto-saves.
        markdownEditBaselineRef.current = { content: draftToSave }
        onSaved?.(result)
        return true
      } catch (err) {
        if (err instanceof MarkdownDocumentConflictError) {
          setConflict(err)
          setSaveError(err.message)
        } else {
          setSaveError(err instanceof Error ? err.message : 'Failed to save file')
        }
        return false
      } finally {
        markdownSaveInFlightRef.current = false
        markdownSavePromiseRef.current = null
      }
    })()

    markdownSavePromiseRef.current = savePromise
    return savePromise
  }, [baseHash, baseMtime, content, draft, isExcalidrawDoc, onSaved, path])

  // Done = flush the draft (no-op when clean) and return to the document.
  const finishEditing = async () => {
    if (baseMtime === null) return
    setSaving(true)
    const didSave = await saveMarkdownDraft('manual')
    setSaving(false)
    if (didSave) cancelEditing()
  }

  // Escape leaves editing (flushes the draft first, so no work is lost). We
  // defer to any handler that already consumed the key — notably CodeMirror's
  // own Escape that closes its find panel (marks the event defaultPrevented).
  const finishEditingRef = useRef(finishEditing)
  finishEditingRef.current = finishEditing
  useEffect(() => {
    if (!active || mode !== 'edit' || isExcalidrawDoc) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      void finishEditingRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, mode, isExcalidrawDoc])

  const handleSave = async (trigger: ExcalidrawSaveTriggerBlock = 'explicit') => {
    if (baseMtime === null) return
    if (!isExcalidrawDoc) {
      setSaving(true)
      const didSave = await saveMarkdownDraft('manual')
      setSaving(false)
      if (didSave) triggerManualSaveFeedback()
      return
    }
    if (!hasChanges) return

    let didSave = false
    setSaving(true)
    setSaveError(null)
    setConflict(null)

    try {
      if (content === null) return
      const sceneForSave = excalidrawSceneRef.current ?? (() => {
        const api = excalidrawApiRef.current
        if (!api) return null
        return {
          elements: api.getSceneElementsBlock() as unknown[],
          appState: api.getAppStateBlock(),
          files: api.getFilesBlock(),
        } satisfies ParsedExcalidrawScene
      })()
      if (!sceneForSave) return

      // Refuse to write a drawing that lost most of itself. The elements above
      // can come from `api.getSceneElementsBlock()`, and `api_attached` is
      // exactly the stage the app has been observed dying at on iPad — API
      // attached, scene not necessarily populated. See
      // docs/contracts/DURABILITY.md.
      //
      // Counted once per document open, then carried forward from our own
      // writes. Re-parsing here would put a multi-megabyte `JSON.parse` on
      // every auto-save — 4.59M characters for the drawing this guard was
      // written for — on the device that is already running out of memory.
      if (excalidrawBaselineCountRef.current === null) {
        const parsed = parseExcalidrawSceneRawOrch(content)
        excalidrawBaselineCountRef.current = parsed?.elements.length ?? 0
        excalidrawBaselineTextCharsRef.current = excalidrawTextCharsBlock(
          (parsed?.elements ?? []) as ReadonlyArray<{ type?: unknown; text?: unknown }>,
        )
      }
      const baselineElementCount = excalidrawBaselineCountRef.current
      const nextTextChars = excalidrawTextCharsBlock(
        sceneForSave.elements as ReadonlyArray<{ type?: unknown; text?: unknown }>,
      )
      const verdict = excalidrawSaveGuardBlock({
        baselineElementCount,
        nextElementCount: sceneForSave.elements.length,
        baselineTextChars: excalidrawBaselineTextCharsRef.current ?? undefined,
        nextTextChars,
        trigger,
      })
      if (!verdict.allow) {
        setSaveError(verdict.reason)
        if (trigger === 'auto') setExcalidrawAutoSaveBlocked(true)
        // Deliberately leaves `hasExcalidrawChanges` set: the scene in memory
        // still differs from disk, and clearing the flag here would mean a
        // later, correct save never fires.
        return
      }

      await yieldToNextFrame()
      const contentToSave = serializeExcalidrawSceneOrch(content, sceneForSave)
      if (contentToSave === content) {
        setHasExcalidrawChanges(false)
        return
      }

      const result = await saveMarkdownDocument({
        path,
        content: contentToSave,
        baseMtime,
        baseHash,
        baseContent: content,
      })
      excalidrawBaselineCountRef.current = sceneForSave.elements.length
      excalidrawBaselineTextCharsRef.current = nextTextChars
      // The write landed, so the journalled delta is accounted for.
      excalidrawJournal.resolve()
      const reloaded = await readMarkdownDocument(path, { includeHash: false })
      setContent(reloaded.content)
      setDraft('')
      setBaseMtime(reloaded.mtime)
      setBaseCtime(reloaded.ctime)
      setBaseHash(reloaded.hash)
      setSizeBytes(reloaded.size)
      setHasExcalidrawChanges(false)
      excalidrawSceneRef.current = null
      preserveExcalidrawCrashMarkerOnUnmountRef.current = false
      clearExcalidrawCrashMarkerBlock()
      ignoreInitialExcalidrawChangeRef.current = true
      onSaved?.(result)
      didSave = true
    } catch (err) {
      if (err instanceof MarkdownDocumentConflictError) {
        setConflict(err)
        setSaveError(err.message)
      } else {
        setSaveError(err instanceof Error ? err.message : 'Failed to save file')
      }
    } finally {
      setSaving(false)
    }
    if (didSave) triggerManualSaveFeedback()
  }
  handleSaveRef.current = handleSave

  const handleCanvasChange = useCallback(async (nextContent: string) => {
    if (baseMtime === null || content === null) return
    if (nextContent === content) return
    try {
      const result = await saveMarkdownDocument({
        path,
        content: nextContent,
        baseMtime,
        baseHash,
        baseContent: content,
      })
      setContent(nextContent)
      setBaseMtime(result.mtime)
      setBaseCtime(result.ctime)
      setBaseHash(result.hash)
      setSizeBytes(result.size)
      setCanvasSaveError(null)
      onSaved?.(result)
    } catch (err) {
      setCanvasSaveError(err instanceof Error ? err.message : 'Failed to save canvas')
    }
  }, [baseHash, baseMtime, content, onSaved, path])

  const commitHeaderRename = useCallback(async () => {
    if (!isEditing || !canRenameInHeader || renaming) return
    const nextName = filenameDraft.trim()
    if (!nextName || nextName === filename) {
      setFilenameDraft(filename)
      setIsHeaderRenameActive(false)
      return
    }

    setRenaming(true)
    setRenameError(null)
    try {
      const nextPath = await renameVaultPathOrch(path, nextName)
      setFilenameDraft(nextPath.split('/').pop() || nextPath)
      setIsHeaderRenameActive(false)
      dispatchGlobalSyncRefreshBlock({ source: 'unknown', requestedAt: Date.now(), vaultSyncAttempted: false, vaultSyncSucceeded: false })
      if (onOpenPathForEdit) onOpenPathForEdit(nextPath)
      else if (onOpenPath) onOpenPath(nextPath)
    } catch (err) {
      setFilenameDraft(filename)
      setRenameError(err instanceof Error ? err.message : 'Failed to rename file')
    } finally {
      setRenaming(false)
    }
  }, [canRenameInHeader, filename, filenameDraft, isEditing, onOpenPath, onOpenPathForEdit, path, renaming])

  const startHeaderRename = useCallback(() => {
    if (!isEditing || !canRenameInHeader || renaming) return
    setFilenameDraft(filename)
    setRenameError(null)
    setIsHeaderRenameActive(true)
  }, [canRenameInHeader, filename, isEditing, renaming])

  useEffect(() => {
    if (!autoSaveEnabled) return
    if (!isEditing || isExcalidrawDoc || loading || error || baseMtime === null) return
    if (!hasTextChanges || saving || autoSaving || conflict) return

    const timeoutId = window.setTimeout(() => {
      setAutoSaving(true)
      void saveMarkdownDraft('auto').finally(() => {
        setAutoSaving(false)
      })
    }, 900)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    autoSaveEnabled,
    baseMtime,
    conflict,
    error,
    hasTextChanges,
    isEditing,
    isExcalidrawDoc,
    loading,
    saveMarkdownDraft,
    saving,
    autoSaving,
  ])

  useEffect(() => {
    if (!autoSaveEnabled) return
    if (!isEditing || !isExcalidrawDoc || loading || error || baseMtime === null) return
    if (!hasExcalidrawChanges || saving || conflict) return
    if (excalidrawAutoSaveBlocked) return

    const timeoutId = window.setTimeout(() => {
      void handleSaveRef.current('auto')
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    autoSaveEnabled,
    baseMtime,
    conflict,
    error,
    excalidrawAutoSaveBlocked,
    hasExcalidrawChanges,
    isEditing,
    isExcalidrawDoc,
    loading,
    saving,
  ])


  const handleOpenInSystem = useCallback(() => {
    if (!canOpenInSystem) return
    setNavigationError(null)
    void openVaultPathInSystemOrch(path).catch((err) => {
      setNavigationError(err instanceof Error ? err.message : 'Failed to open file in system file manager')
    })
  }, [canOpenInSystem, path])

  const headerMenuEntries = useMemo<ContextMenuEntryBlock[]>(() => [
    {
      key: 'open-obsidian',
      label: 'Open in Obsidian',
      onClick: () => { window.location.assign(obsidianUrl) },
    },
    {
      key: 'open-system',
      label: `Open in ${openInSystemButtonLabel}`,
      disabled: !canOpenInSystem,
      onClick: handleOpenInSystem,
    },
    {
      key: 'open-default-app',
      label: 'Open With Default App',
      disabled: !canOpenInSystem,
      onClick: () => {
        setNavigationError(null)
        void openVaultPathWithDefaultAppOrch(path).catch((err) => {
          setNavigationError(err instanceof Error ? err.message : 'Failed to open file in default app')
        })
      },
    },
    { key: 'sep-open', kind: 'separator' },
    {
      key: 'open-tab',
      label: 'Open in New Tab',
      onClick: () => { openFileInNewTabOrch(path) },
    },
    {
      key: 'open-window',
      label: 'Open in New Window',
      onClick: () => { openFileInNewWindowOrch(path) },
    },
    { key: 'sep-copy', kind: 'separator' },
    {
      key: 'copy-abs',
      label: 'Copy Absolute Path',
      disabled: getAbsolutePathForClipboardOrch(path) === null,
      onClick: () => {
        const absolute = getAbsolutePathForClipboardOrch(path)
        if (absolute) void navigator.clipboard.writeText(absolute)
      },
    },
    {
      key: 'copy-rel',
      label: 'Copy Relative Path',
      onClick: () => { void navigator.clipboard.writeText(getRelativePathForClipboardOrch(path)) },
    },
  ], [obsidianUrl, openInSystemButtonLabel, canOpenInSystem, handleOpenInSystem, path])

  if (!active) {
    return <div className={cn('h-full min-h-0 bg-card', className)} aria-hidden="true" />
  }

  return (
    <div
      ref={readingSurfaceRef}
      className={cn(
        // ts-md-viewer-root: a stable hook for surface-level padding
        // overrides from index.css.
        'ts-md-viewer-root flex h-full min-h-0 flex-col bg-card p-2',
        className,
      )}
      data-prevent-sheet-escape={isEditing ? 'true' : undefined}
    >
      <div className="relative min-h-0 flex-1">
        {findOpen && findEligible && (
          <div className="absolute right-3 top-3 z-50">
            <DocumentFindBarBlock find={find} onClose={() => setFindOpen(false)} />
          </div>
        )}
        <div
          ref={contentScrollRef}
          onScroll={(e) => {
            const top = (e.target as HTMLDivElement).scrollTop
            const prev = lastScrollTopRef.current
            const delta = top - prev
            if (Math.abs(delta) < 4) return
            if (top <= 4) setIsHeaderHidden(false)
            else if (delta > 0) setIsHeaderHidden(true)
            else setIsHeaderHidden(false)
            lastScrollTopRef.current = top
          }}
          className={cn(
            'relative h-full min-h-0 p-0',
            // overflow-x must be pinned: overflow-y-auto alone computes
            // overflow-x from visible to auto, making the pane horizontally
            // pannable on iOS (elastic "website wiggle") the moment any
            // content overflows by a pixel. touch-action pan-y drops
            // horizontal touch pans at this level entirely; inner scrollers
            // (code blocks, tables, CM6) still pan-x fine — touch-action on
            // an ancestor above the scroller doesn't constrain it.
            isExcalidrawDoc && !isEditing ? 'flex flex-col overflow-hidden' : (isExcalidrawDoc ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden [touch-action:pan-y]'),
          )}
        >
          <div
            ref={chromeContainerRef}
            className={cn(
              'sticky top-0 z-40 bg-card transition-transform duration-200 ease-out',
              isHeaderHidden && '-translate-y-full',
              hideTopBarInView && 'hidden',
            )}
          >
            <div
              className={cn(
                'ts-md-header ts-doc-header flex items-start justify-between gap-3 border-b border-border/50',
                isIosPhone ? 'flex-col items-stretch px-4 py-3.5' : 'px-6 py-5',
              )}
            >
              <div className={cn('min-w-0 flex-1', isIosPhone && 'w-full')}>
                <div className="flex w-full min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {isEditing && canRenameInHeader && isHeaderRenameActive ? (
                    <input
                      ref={headerRenameInputRef}
                      type="text"
                      value={filenameDraft}
                      onChange={(event) => {
                        setFilenameDraft(event.target.value)
                        if (renameError) setRenameError(null)
                      }}
                      onBlur={() => { void commitHeaderRename() }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void commitHeaderRename()
                          return
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setFilenameDraft(filename)
                          setRenameError(null)
                          setIsHeaderRenameActive(false)
                        }
                      }}
                      disabled={renaming || saving}
                      className="h-8 min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 text-sm font-medium shadow-none outline-none ring-0 focus:border-0 focus:bg-transparent focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:opacity-60"
                      aria-label="File name"
                    />
                  ) : isEditing && canRenameInHeader ? (
                    <button
                      type="button"
                      onClick={startHeaderRename}
                      className="min-w-0 flex-1 truncate text-left font-medium"
                      title="Rename file"
                    >
                      {filename}
                    </button>
                  ) : (
                    <span className="truncate font-medium">{filename}</span>
                  )}
                </div>
                {breadcrumb && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{breadcrumb}</div>
                )}
                {renameError && (
                  <div className="mt-1 truncate text-xs text-destructive">{renameError}</div>
                )}
              </div>

              <div className={cn(
                'flex shrink-0 items-center gap-1',
                isIosPhone && 'w-full min-w-0 flex-wrap justify-start gap-1.5',
              )}>
                <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <InfoPanelToggleButtonBlock active={showMeta} onToggle={() => setShowMeta(v => !v)} title="Metadata" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Metadata</TooltipContent>
                </Tooltip>

                {/* Doc/Canvas toggle temporarily disabled in the explorer
                    viewer until the canvas mode is fully wired here. The
                    NewThought compose page still surfaces it. */}
                {false && !isEditing && !isExcalidrawDoc && !isHtmlDoc && (
                  <SegmentedToggleBlock
                    value={viewSurface}
                    onChange={setViewSurface}
                    ariaLabel="Note view"
                    options={[
                      { value: 'doc', label: 'Doc', icon: List, title: 'Document view' },
                      { value: 'canvas', label: 'Canvas', icon: LayoutDashboard, title: 'Canvas view' },
                    ]}
                  />
                )}

                {!isEditing && onOpenAsNotebook && path.toLowerCase().endsWith('.md') && !isExcalidrawDoc && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onOpenAsNotebook(path)}
                        disabled={loading || !!error}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Notebook view"
                      >
                        <BookOpenText className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Notebook view</TooltipContent>
                  </Tooltip>
                )}

                {!isEditing && (
                  longPressToEditActive ? (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => startEditing()}
                            disabled={loading || !!error}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label="Edit file"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[15rem] text-center leading-snug">
                          Click to edit — or press &amp; hold anywhere on the page to edit right where you tap.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => startEditing()}
                          disabled={loading || !!error}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Edit file"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Edit file</TooltipContent>
                    </Tooltip>
                  )
                )}

                {isEditing && !isExcalidrawDoc && (
                  <>
                    {/* Editing badge — live save state; click toggles auto-save. */}
                    <button
                      type="button"
                      onClick={() => setAutoSaveEnabled(v => !v)}
                      className={cn(
                        'inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
                        isIosPhone ? 'h-7 rounded-md px-2 text-[11px]' : 'rounded-lg px-2 py-1 text-xs',
                      )}
                      title={autoSaveEnabled ? 'Auto-save is on — click to switch to manual saving' : 'Auto-save is off — click to turn it on'}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          (saving || autoSaving)
                            ? 'animate-pulse bg-amber-500'
                            : autoSaveEnabled
                              ? 'bg-emerald-500'
                              : 'bg-muted-foreground/50',
                        )}
                      />
                      {(saving || autoSaving) ? 'Saving…' : autoSaveEnabled ? 'Editing' : 'Editing · manual'}
                    </button>
                    {!autoSaveEnabled && (
                      <button
                        type="button"
                        onClick={() => { void handleSave() }}
                        disabled={saving || baseMtime === null}
                        className={saveButtonClassName}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {saveButtonLabel}
                      </button>
                    )}
                  </>
                )}

                {isEditing && isExcalidrawDoc && (
                  <>
                    {/* Editing badge — same live save state the text editor shows. */}
                    <button
                      type="button"
                      onClick={() => setAutoSaveEnabled(v => !v)}
                      className={cn(
                        'inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
                        isIosPhone ? 'h-7 rounded-md px-2 text-[11px]' : 'rounded-lg px-2 py-1 text-xs',
                      )}
                      title={autoSaveEnabled ? 'Auto-save is on — click to switch to manual saving' : 'Auto-save is off — click to turn it on'}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          (saving || autoSaving)
                            ? 'animate-pulse bg-amber-500'
                            : autoSaveEnabled
                              ? 'bg-emerald-500'
                              : 'bg-muted-foreground/50',
                        )}
                      />
                      {(saving || autoSaving) ? 'Saving…' : autoSaveEnabled ? 'Editing' : 'Editing · manual'}
                    </button>
                    {!autoSaveEnabled && (
                      <button
                        type="button"
                        onClick={() => { void handleSave() }}
                        disabled={saving || baseMtime === null}
                        className={saveButtonClassName}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {saveButtonLabel}
                      </button>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setExcalidrawImmersive(true)}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label="Focus canvas"
                        >
                          <Maximize2 className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Focus canvas</TooltipContent>
                    </Tooltip>
                  </>
                )}

                <OverflowMenuButtonBlock entries={headerMenuEntries} title="More actions" />

                {showCloseButton && onClose && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          // While editing, ✕ means "leave editing", not "close the
                          // document" — one exit affordance instead of a separate
                          // Cancel button.
                          if (isEditing) {
                            if (autoSaveEnabled && !isExcalidrawDoc) {
                              void finishEditing()
                            } else {
                              cancelEditing()
                            }
                            return
                          }
                          onClose()
                        }}
                        className={cn(
                          'transition-colors hover:bg-muted',
                          isIosPhone ? 'rounded-md p-1.5' : 'rounded-lg p-1.5',
                        )}
                        aria-label={isEditing ? 'Stop editing' : 'Close'}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{isEditing ? 'Stop editing' : 'Close'}</TooltipContent>
                  </Tooltip>
                )}
                </TooltipProvider>
              </div>
            </div>

            {showMeta && meta && (
              <div className={cn(
                'space-y-2 border-b border-border/30 bg-muted/30 py-4 text-xs text-muted-foreground',
                isIosPhone ? 'px-5' : 'px-7',
              )}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span><strong className="text-foreground/70">{meta.lines ?? '…'}</strong> lines</span>
                  <span><strong className="text-foreground/70">{meta.words ?? '…'}</strong> words</span>
                  <span><strong className="text-foreground/70">{meta.headings ?? '…'}</strong> headings</span>
                  <span>{meta.size}</span>
                  <span>Created: <strong className="text-foreground/70">{meta.createdAt ?? '—'}</strong></span>
                  <span>Updated: <strong className="text-foreground/70">{meta.updatedAt ?? '—'}</strong></span>
                </div>

                {memorizedSessions.length > 0 && (
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Memorized
                    </span>
                    <span className="flex flex-wrap gap-x-2 gap-y-1">
                      {memorizedSessions.map((session, i) => (
                        <strong key={`${session.date}-${session.startedAt ?? i}`} className="text-foreground/70">
                          {session.date}
                          {session.startedAt && session.endedAt && (
                            <span className="font-normal text-muted-foreground">
                              {' '}
                              {formatMemorizedTimeRange(session.startedAt, session.endedAt)}
                            </span>
                          )}
                        </strong>
                      ))}
                    </span>
                  </div>
                )}

                {!isExcalidrawDoc && (
                  <div className="space-y-1.5 border-t border-border/30 pt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      YAML Metadata
                    </div>

                    {isEditing ? (
                      <div className="space-y-1.5">
                        <MarkdownRichEditorBlock
                          value={frontmatterMeta.yamlText}
                          onChange={setDraftFrontmatterYaml}
                          currentPath={path}
                          enableFormattingToolbar={false}
                          className="h-44 w-full"
                          editorClassName="rounded-md border border-border/60 bg-background"
                          placeholder={'title: My note\ntype: thought\nparent: project-root'}
                          compactMobile={isIosPhone}
                        />
                        {frontmatterMeta.parseError ? (
                          <div className="text-[11px] text-destructive">
                            YAML parse error: {frontmatterMeta.parseError}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground">
                            {frontmatterMeta.hasFrontmatter ? 'Frontmatter is valid YAML.' : 'Add YAML above to create frontmatter.'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {frontmatterMeta.parseError && (
                          <div className="text-[11px] text-destructive">
                            YAML parse error: {frontmatterMeta.parseError}
                          </div>
                        )}
                        {!frontmatterMeta.hasFrontmatter && (
                          <div className="text-[11px] text-muted-foreground">No YAML frontmatter.</div>
                        )}
                        {frontmatterMeta.hasFrontmatter && !frontmatterMeta.parseError && frontmatterMeta.entries.length === 0 && (
                          <div className="text-[11px] text-muted-foreground">YAML frontmatter is empty.</div>
                        )}
                        {frontmatterMeta.entries.length > 0 && (
                          <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-[11px]">
                            {frontmatterMeta.entries.map((entry) => (
                              <div key={entry.key} className="contents">
                                <dt className="font-medium text-foreground/80">{entry.key}</dt>
                                <dd className="break-all text-muted-foreground">{entry.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {loading && (
            <div className={cn('space-y-3', shouldPadViewerContent && 'px-6 py-5')}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-muted/40" style={{ width: `${60 + Math.random() * 40}%` }} />
              ))}
            </div>
          )}

          {error && (
            <div className={cn('text-sm text-destructive', shouldPadViewerContent && 'px-6 py-5')}>{error}</div>
          )}

          {!loading && !error && navigationError && (
            <div className={cn(isIosPhone ? 'px-3 pt-2.5' : 'px-6 pt-4')}>
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {navigationError}
              </div>
            </div>
          )}

          {!loading && !error && content !== null && !isEditing && isExcalidrawDoc && (
            <ExcalidrawDocumentBlock content={content} filePath={path} onOpenPath={openLinkedPath} onViewportSamplerChange={handleCanvasViewportSampler} className="flex-1 min-h-0" />
          )}

          {!loading && !error && content !== null && !isEditing && !isExcalidrawDoc && isHtmlDoc && (
            <div className={cn('h-full min-h-0', isIosPhone ? 'px-5 py-5' : 'px-6 py-5')}>
              <HtmlDocumentBlock html={displayContent} className="h-full min-h-[60vh]" />
            </div>
          )}

          {!loading && !error && content !== null && !isEditing && !isExcalidrawDoc && !isHtmlDoc && isCodeDoc && (
            <div
              className={cn(isIosPhone ? 'px-2 py-3' : 'px-4 py-5')}
              onPointerDown={handleViewPointerDown}
              onPointerMove={handleViewPointerMove}
              onPointerUp={clearLongPressTimer}
              onPointerCancel={clearLongPressTimer}
              onPointerLeave={clearLongPressTimer}
            >
              <CodeDocumentViewBlock content={content} path={path} colorMode={resolvedColorMode === 'dark' ? 'dark' : 'light'} />
            </div>
          )}

          {!loading && !error && content !== null && !isEditing && !isExcalidrawDoc && !isHtmlDoc && !isCodeDoc && viewSurface === 'canvas' && (
            <div className="flex h-full min-h-[60vh] flex-col">
              {canvasSaveError && (
                <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {canvasSaveError}
                </div>
              )}
              <div className="min-h-[60vh] flex-1">
                <NoteCanvasBlock
                  surfaceId={`note:${path}`}
                  value={content}
                  onChange={(next) => { void handleCanvasChange(next) }}
                />
              </div>
            </div>
          )}

          {!loading && !error && content !== null && !isEditing && !isExcalidrawDoc && !isHtmlDoc && !isCodeDoc && viewSurface === 'doc' && (
            <div>
              <div
                className={cn(
                  'sticky z-30 flex flex-wrap items-center gap-1 border-b border-border/20 bg-background p-2',
                  // iPhone: the document is one sheet of paper from the top
                  // edge down, so this strip is card-white too — shell grey
                  // between the header and the body reads as a seam.
                  isIosPhone && 'bg-card',
                )}
                style={{ top: isHeaderHidden ? 0 : headerHeight }}
              >
                <MarkdownTableOfContentsBlock
                  content={displayContent}
                  currentLine={0}
                  compact={isIosPhone}
                  onSelectHeading={scrollViewToHeading}
                />
                {supportsMindmap && (
                  <button
                    type="button"
                    onClick={() => setViewMindmapPanelOpen(prev => !prev)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
                      viewMindmapPanelOpen && 'bg-muted text-foreground',
                    )}
                    title={viewMindmapPanelOpen ? 'Hide mindmap preview' : 'Show mindmap preview'}
                  >
                    <Workflow className="h-3.5 w-3.5" />
                    Mindmap
                  </button>
                )}
              </div>
              <MarkdownMindmapPanelBlock
                inputPath={path}
                content={displayContent}
                open={supportsMindmap && viewMindmapPanelOpen}
              />

              <div
                className={cn('space-y-2', isIosPhone ? 'px-5 py-5' : 'px-8 py-7')}
                onPointerDown={handleViewPointerDown}
                onPointerMove={handleViewPointerMove}
                onPointerUp={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
              >
                {pendingFullRender && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Rendering full document...
                  </div>
                )}
                <div
                  className={cn(
                    'prose',
                    editorSettings.preserveSpacesInViewMode && !shouldRelaxWhitespacePreservation && 'ltm-markdown-preserve-spaces',
                    editorSettings.preserveNewlinesInViewMode && !shouldRelaxWhitespacePreservation && 'ltm-markdown-preserve-newlines',
                  )}
                  style={{
                    fontFamily: DOCUMENT_FONT_STACKS_BLOCK[editorSettings.documentFontFamily],
                    fontSize: `${editorSettings.documentFontSizePx}px`,
                  }}
                  data-markdown-nav-root
                >
                  <ReactMarkdown
                    remarkPlugins={markdownRemarkPlugins}
                    rehypePlugins={markdownRehypePlugins as any}
                    components={markdownComponents}
                    urlTransform={thinkingSpaceMarkdownUrlTransformBlock}
                  >
                    {renderedViewMarkdown}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

        {!loading && !error && content !== null && isEditing && isExcalidrawDoc && !excalidrawImmersive && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Full Excalidraw tool surface is enabled in edit mode.
            </div>
            <ExcalidrawDocumentBlock
              content={excalidrawEditorContent}
              editable
              onSceneChange={handleExcalidrawSceneChange}
              onApiChange={handleExcalidrawApiChange}
              filePath={path}
              onOpenPath={openLinkedPath}
              onViewportSamplerChange={handleCanvasViewportSampler}
              className="h-[52vh] sm:h-[60vh] lg:h-[72vh]"
            />
            {annotationRecoveryBlock}
            {saveError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {saveError}
              </div>
            )}

            {conflict && (
              <button
                onClick={useLatestConflictVersion}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                Load latest file version
              </button>
            )}
          </div>
        )}

        {!loading && !error && content !== null && isEditing && isExcalidrawDoc && excalidrawImmersive && (
          <div className="fixed inset-0 z-[70] flex flex-col bg-background">
            <div
              className="relative z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-background/95 px-3 py-2 backdrop-blur"
              style={{
                paddingTop: isElectronSurface ? '2.25rem' : isIosSurface ? 'calc(var(--ltm-safe-top, 0px) + 0.5rem)' : '0.5rem',
                ...isElectronSurface && { WebkitAppRegion: 'drag' } as React.CSSProperties,
              }}
            >
              <div className="min-w-0 flex flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground" title={filename}>
                  {filename}
                </span>
              </div>
              <TooltipProvider delayDuration={200}>
                <div className="flex shrink-0 items-center gap-1" style={isElectronSurface ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}>
                  {/* Save state — same dot badge the inline editor uses; click toggles auto-save. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setAutoSaveEnabled(v => !v)}
                        className={cn(
                          'inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
                          isIosPhone ? 'h-7 rounded-md px-2 text-[11px]' : 'rounded-lg px-2 py-1 text-xs',
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            (saving || autoSaving)
                              ? 'animate-pulse bg-amber-500'
                              : autoSaveEnabled
                                ? 'bg-emerald-500'
                                : 'bg-muted-foreground/50',
                          )}
                        />
                        {(saving || autoSaving) ? 'Saving…' : autoSaveEnabled ? 'Editing' : 'Editing · manual'}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {autoSaveEnabled ? 'Auto-save is on — click to switch to manual saving' : 'Auto-save is off — click to turn it on'}
                    </TooltipContent>
                  </Tooltip>

                  {!autoSaveEnabled && (
                    <button
                      type="button"
                      onClick={() => { void handleSave() }}
                      disabled={saving || baseMtime === null}
                      className={saveButtonClassName}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saveButtonLabel}
                    </button>
                  )}

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setExcalidrawImmersive(false)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Exit focus mode"
                      >
                        <Minimize2 className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Exit focus mode</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Close editor"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Close editor</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
            {annotationRecoveryBlock && (
              <div className="shrink-0 px-3 pb-2">{annotationRecoveryBlock}</div>
            )}
            <div className="min-h-0 flex-1">
              <ExcalidrawDocumentBlock
                content={excalidrawEditorContent}
                editable
                onSceneChange={handleExcalidrawSceneChange}
                onApiChange={handleExcalidrawApiChange}
                filePath={path}
                onOpenPath={openLinkedPath}
                onViewportSamplerChange={handleCanvasViewportSampler}
                className="h-full"
              />
            </div>
          </div>
        )}

        {!loading && !error && content !== null && isEditing && !isExcalidrawDoc && (
          <div className={cn('space-y-4', isIosPhone && 'px-3 pb-[calc(var(--ltm-safe-bottom,0px)+0.4rem)]')}>
            <div data-ltm-edge-swipe-ignore="true">
              <MarkdownRichEditorBlock
                initialCursorHint={pendingEditCaretHintRef.current}
                onOpenWikilink={(target, openInNewTab) => {
                  void (async () => {
                    try {
                      const resolved = await resolveWikilinkTargetOrch({ currentPath: path, target })
                      const resolvedPath = resolved.path ?? await resolveWikilinkAssetTargetOrch({ currentPath: path, target })
                      if (!resolvedPath || resolvedPath === path) return
                      if (openInNewTab) {
                        openFileInNewTabOrch(resolvedPath)
                        return
                      }
                      openLinkedPath?.(resolvedPath)
                    } catch {
                      // Unresolvable target — ignore; the raw text stays editable.
                    }
                  })()
                }}
                value={displayDraft}
                currentPath={path}
                compactMobile={isIosPhone}
                toolbarAlwaysVisible
                aiPanelOpen={showAiPanel}
                onAiPanelOpenChange={setShowAiPanel}
                aiAssistDisabled={loading || isExcalidrawDoc}
                aiAssistScope="markdown_editor"
                aiAssistUseCase="markdown.assist"
                aiAssistHelperText="Suggestions apply inline. Auto-save is enabled by default; use Save for immediate commit. Configure provider/model in AI Settings."
                onAiStewardApplySuggestion={handleApplyStewardSuggestion}
                onRelatedThoughtOpenPath={(relatedPath) => {
                  if (!openRelatedThoughtPath) return
                  if (normalizePathForCompare(relatedPath) === normalizePathForCompare(path)) return
                  openRelatedThoughtPath(relatedPath)
                }}
                onRelatedThoughtOpenPathInNewTab={(relatedPath) => {
                  if (normalizePathForCompare(relatedPath) === normalizePathForCompare(path)) return
                  openFileInNewTabOrch(relatedPath)
                }}
                onChange={(next) => {
                  setDraft(`${draftFrontmatter}${next}`)
                }}
                className={cn(
                  'min-h-[44vh] sm:min-h-[52vh] lg:min-h-[62vh]',
                  isIosPhone && 'min-h-0 h-full',
                )}
              />
            </div>

            {autoSaving && !saving && (
              <div className="text-xs text-muted-foreground">Auto-saving…</div>
            )}

            {saveError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {saveError}
              </div>
            )}

            {conflict && (
              <button
                onClick={useLatestConflictVersion}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                Load latest file version
              </button>
            )}
          </div>
        )}

        </div>

        {!loading && !error && content !== null && !isExcalidrawDoc && !pendingFullRender && showMiniNavRail && (
          <MarkdownMiniNavBlock
            content={isEditing ? displayDraft : viewMarkdown}
            container={contentScrollRef.current}
            useRenderedHeadings={!isEditing}
            renderRootSelector="[data-markdown-nav-root]"
            aiTouch={miniNavAiTouch}
            className="fixed right-4 top-1/2 z-30 h-[42vh] max-h-[480px] min-h-[180px] -translate-y-1/2"
          />
        )}
      </div>
    </div>
  )
}

function PdfDocumentRuntimeBlock({
  path,
  active = true,
  countsAsReading = false,
  onOpenPath,
  onClose,
  showCloseButton = false,
  className,
}: MarkdownDocumentBlockProps) {
  const filename = path.split('/').pop() || path
  const breadcrumb = path.split('/').slice(0, -1).join(' / ')
  const openInSystemLabel = getOpenInSystemLabelOrch()
  const canOpenInSystem = openInSystemLabel !== null
  const openInSystemButtonLabel = openInSystemLabel ?? 'System'
  const [openInSystemError, setOpenInSystemError] = useState<string | null>(null)

  const handleOpenInSystem = useCallback(() => {
    if (!canOpenInSystem) return
    setOpenInSystemError(null)
    void openVaultPathInSystemOrch(path).catch((err) => {
      setOpenInSystemError(err instanceof Error ? err.message : 'Failed to open file in system file manager')
    })
  }, [canOpenInSystem, path])

  const pdfHeaderMenuEntries = useMemo<ContextMenuEntryBlock[]>(() => [
    {
      key: 'open-system',
      label: `Open in ${openInSystemButtonLabel}`,
      disabled: !canOpenInSystem,
      onClick: handleOpenInSystem,
    },
    {
      key: 'open-default-app',
      label: 'Open With Default App',
      disabled: !canOpenInSystem,
      onClick: () => {
        setOpenInSystemError(null)
        void openVaultPathWithDefaultAppOrch(path).catch((err) => {
          setOpenInSystemError(err instanceof Error ? err.message : 'Failed to open file in default app')
        })
      },
    },
    ...(onOpenPath ? [{ key: 'sep-open', kind: 'separator' as const }, {
      key: 'reveal',
      label: 'Reveal in Explorer',
      onClick: () => { onOpenPath(path) },
    }] : []),
    { key: 'sep-copy', kind: 'separator' },
    {
      key: 'copy-abs',
      label: 'Copy Absolute Path',
      disabled: getAbsolutePathForClipboardOrch(path) === null,
      onClick: () => {
        const absolute = getAbsolutePathForClipboardOrch(path)
        if (absolute) void navigator.clipboard.writeText(absolute)
      },
    },
    {
      key: 'copy-rel',
      label: 'Copy Relative Path',
      onClick: () => { void navigator.clipboard.writeText(getRelativePathForClipboardOrch(path)) },
    },
  ], [canOpenInSystem, handleOpenInSystem, onOpenPath, openInSystemButtonLabel, path])

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-card p-2', className)}>
      <div className="ts-doc-header border-b border-border/50 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{filename}</span>
            </div>
            {breadcrumb && <div className="mt-0.5 truncate text-xs text-muted-foreground">{breadcrumb}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* One overflow menu, exactly as the markdown header does it. A row
                of individually surfaced file actions is a different vocabulary
                from every other document surface in the app, and none of these
                is used often enough to earn a permanent button. */}
            <OverflowMenuButtonBlock entries={pdfHeaderMenuEntries} title="File actions" />
            {showCloseButton && onClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 transition-colors hover:bg-muted"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
      {openInSystemError && (
        <div className="mx-6 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {openInSystemError}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <PdfDocumentBlock
          path={path}
          active={active}
          countsAsReading={countsAsReading}
          className="h-full"
        />
      </div>
    </div>
  )
}

function ImageDocumentRuntimeBlock({
  path,
  onOpenPath,
  onClose,
  showCloseButton = false,
  className,
}: MarkdownDocumentBlockProps) {
  const filename = path.split('/').pop() || path
  const breadcrumb = path.split('/').slice(0, -1).join(' / ')
  const openInSystemLabel = getOpenInSystemLabelOrch()
  const canOpenInSystem = openInSystemLabel !== null
  const openInSystemButtonLabel = openInSystemLabel ?? 'System'
  const [openInSystemError, setOpenInSystemError] = useState<string | null>(null)

  const handleOpenInSystem = useCallback(() => {
    if (!canOpenInSystem) return
    setOpenInSystemError(null)
    void openVaultPathInSystemOrch(path).catch((err) => {
      setOpenInSystemError(err instanceof Error ? err.message : 'Failed to open file in system file manager')
    })
  }, [canOpenInSystem, path])

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-card p-2', className)}>
      <div className="ts-doc-header border-b border-border/50 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{filename}</span>
            </div>
            {breadcrumb && <div className="mt-0.5 truncate text-xs text-muted-foreground">{breadcrumb}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleOpenInSystem}
              disabled={!canOpenInSystem}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              title={canOpenInSystem ? `Open file in ${openInSystemButtonLabel}` : 'Open in system file manager is unavailable on web'}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{openInSystemButtonLabel}</span>
            </button>
            {onOpenPath && (
              <button
                type="button"
                onClick={() => onOpenPath(path)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Open in Thinking Space explorer"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
            {showCloseButton && onClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 transition-colors hover:bg-muted"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
      {openInSystemError && (
        <div className="mx-6 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {openInSystemError}
        </div>
      )}

      <div className="min-h-0 flex-1 px-6 py-5">
        <ImageDocumentBlock path={path} className="h-full" />
      </div>
    </div>
  )
}

function UnsupportedFileDocumentRuntimeBlock({
  path,
  onOpenPath,
  onClose,
  showCloseButton = false,
  className,
}: MarkdownDocumentBlockProps) {
  const filename = path.split('/').pop() || path
  const breadcrumb = path.split('/').slice(0, -1).join(' / ')
  const openInSystemLabel = getOpenInSystemLabelOrch()
  const canOpenInSystem = openInSystemLabel !== null
  const [openInSystemError, setOpenInSystemError] = useState<string | null>(null)

  const handleOpenInDefaultApp = useCallback(() => {
    if (!canOpenInSystem) return
    setOpenInSystemError(null)
    void openVaultPathWithDefaultAppOrch(path).catch((err) => {
      setOpenInSystemError(err instanceof Error ? err.message : 'Failed to open file in default app')
    })
  }, [canOpenInSystem, path])

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-card p-2', className)}>
      <div className="ts-doc-header border-b border-border/50 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{filename}</span>
            </div>
            {breadcrumb && <div className="mt-0.5 truncate text-xs text-muted-foreground">{breadcrumb}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onOpenPath && (
              <button
                type="button"
                onClick={() => onOpenPath(path)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Open in Thinking Space explorer"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
            {showCloseButton && onClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 transition-colors hover:bg-muted"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {openInSystemError && (
        <div className="mx-6 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {openInSystemError}
        </div>
      )}

      <div className="min-h-0 flex-1 px-6 py-5">
        <div className="flex h-full min-h-[220px] items-center justify-center">
          <div className="w-full max-w-xl rounded-2xl border border-border/60 bg-muted/20 p-8 text-center">
            <button
              type="button"
              onClick={handleOpenInDefaultApp}
              disabled={!canOpenInSystem}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border/70 bg-background/95 px-5 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-background"
              title={canOpenInSystem ? 'Open file in default app' : 'Opening files directly is unavailable on web'}
            >
              <ExternalLink className="h-4 w-4" />
              Open in Default App
            </button>
            <p className="mt-4 text-sm text-muted-foreground">
              This file type is not supported in-app right now. Please open it in your default app.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function MarkdownDocumentBlock(props: MarkdownDocumentBlockProps) {
  if (isUrlShortcutPathBlock(props.path)) {
    return (
      <UrlDocumentBlock
        path={props.path}
        suspended={props.active === false}
        onClose={props.onClose}
        showCloseButton={props.showCloseButton}
        className={props.className}
      />
    )
  }
  if (isTableDocumentPathBlock(props.path)) {
    return (
      <TableDocumentBlock
        path={props.path}
        initialMode={props.initialMode}
        onSaved={props.onSaved}
        onOpenPath={props.onOpenPath}
        onOpenPathForEdit={props.onOpenPathForEdit}
        onClose={props.onClose}
        showCloseButton={props.showCloseButton}
        className={props.className}
      />
    )
  }
  if (isGoogleDocDocumentPathBlock(props.path)) {
    return (
      <GoogleDocDocumentBlock
        path={props.path}
        initialMode={props.initialMode}
        onSaved={props.onSaved}
        onClose={props.onClose}
        showCloseButton={props.showCloseButton}
        className={props.className}
      />
    )
  }
  if (isImageDocumentPathBlock(props.path)) {
    return (
      <ImageDocumentRuntimeBlock
        path={props.path}
        initialMode={props.initialMode}
        onSaved={props.onSaved}
        onOpenPath={props.onOpenPath}
        onOpenPathForEdit={props.onOpenPathForEdit}
        onClose={props.onClose}
        showCloseButton={props.showCloseButton}
        className={props.className}
      />
    )
  }
  if (isPdfDocumentPathBlock(props.path)) {
    return (
      <PdfDocumentRuntimeBlock
        path={props.path}
        active={props.active}
        countsAsReading={props.countsAsReading}
        initialMode={props.initialMode}
        onSaved={props.onSaved}
        onOpenPath={props.onOpenPath}
        onOpenPathForEdit={props.onOpenPathForEdit}
        onClose={props.onClose}
        showCloseButton={props.showCloseButton}
        className={props.className}
      />
    )
  }
  if (isUnsupportedFilePathBlock(props.path)) {
    return (
      <UnsupportedFileDocumentRuntimeBlock
        path={props.path}
        initialMode={props.initialMode}
        onSaved={props.onSaved}
        onOpenPath={props.onOpenPath}
        onOpenPathForEdit={props.onOpenPathForEdit}
        onClose={props.onClose}
        showCloseButton={props.showCloseButton}
        className={props.className}
      />
    )
  }
  return <MarkdownTextDocumentRuntimeBlock {...props} />
}

export default memo(MarkdownDocumentBlock)
