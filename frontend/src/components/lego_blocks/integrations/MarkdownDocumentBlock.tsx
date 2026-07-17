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
import TikzDiagramBlock from '@/components/lego_blocks/units/TikzDiagramBlock'
import { X, FileText, ExternalLink, Pencil, Save, FolderOpen, Workflow, List, LayoutDashboard } from 'lucide-react'
import {
  MarkdownDocumentConflictError,
  readMarkdownDocument,
  saveMarkdownDocument,
} from '@/services/orchestrators/markdownDocumentsOrch'
import {
  serializeExcalidrawSceneOrch,
  type ParsedExcalidrawScene,
} from '@/services/orchestrators/excalidrawSceneOrch'
import type { ExcalidrawCanvasApiOrch } from '@/services/orchestrators/excalidrawIntegrationOrch'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
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
import { isTableDocumentPathBlock } from '@/services/lego_blocks/units/tableDocumentPathBlock'
import { isPdfDocumentPathBlock } from '@/services/lego_blocks/units/pdfDocumentPathBlock'
import { isGoogleDocDocumentPathBlock } from '@/services/lego_blocks/units/googleDocDocumentPathBlock'
import { isImageDocumentPathBlock } from '@/services/lego_blocks/units/imageDocumentPathBlock'
import { isExcalidrawPathBlock } from '@/services/lego_blocks/units/excalidrawPathBlock'
import { isHtmlDocumentPathBlock } from '@/services/lego_blocks/units/htmlDocumentPathBlock'
import { readImageDocumentOrch } from '@/services/orchestrators/imageDocumentsOrch'
import {
  clearExcalidrawCrashMarkerBlock,
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
  initialMode?: MarkdownViewerMode
  onSaved?: (result: { output_path: string; revision_path: string | null }) => void
  onOpenPath?: (path: string) => void
  onOpenPathForEdit?: (path: string) => void
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
        const blob = new Blob([Uint8Array.from(doc.bytes)], { type: doc.mime })
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
  initialMode = 'view',
  onSaved,
  onOpenPath,
  onOpenPathForEdit,
  onClose,
  showCloseButton = false,
  className,
  topBarHidden: topBarHiddenProp,
}: MarkdownDocumentBlockProps) {
  const { layout } = useUILayoutBlock()
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
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const lastScrollTopRef = useRef(0)
  const [isHeaderHidden, setIsHeaderHidden] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(0)
  const headerRenameInputRef = useRef<HTMLInputElement | null>(null)
  const manualSaveFeedbackTimeoutRef = useRef<number | null>(null)
  const excalidrawSceneRef = useRef<ParsedExcalidrawScene | null>(null)
  const excalidrawApiRef = useRef<ExcalidrawCanvasApiOrch | null>(null)
  const ignoreInitialExcalidrawChangeRef = useRef(true)
  const [hasExcalidrawChanges, setHasExcalidrawChanges] = useState(false)
  const [excalidrawImmersive, setExcalidrawImmersive] = useState(false)
  const markdownSaveInFlightRef = useRef(false)
  const markdownSavePromiseRef = useRef<Promise<boolean> | null>(null)
  const markdownEditBaselineRef = useRef<MarkdownEditBaselineState | null>(null)
  const markdownCancelRevertInFlightRef = useRef(false)
  const excalidrawCrashMarkerClearTimeoutRef = useRef<number | null>(null)
  const preserveExcalidrawCrashMarkerOnUnmountRef = useRef(false)
  const handleSaveRef = useRef<() => Promise<void>>(async () => {})

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
  // Live preview makes the view/edit split mostly ceremonial for text docs:
  // clicking the document body starts editing, so the pencil disappears.
  // Excalidraw/HTML docs keep the explicit pencil (their edit mode is heavier).
  const clickToEditActive = editorSettings.livePreviewSyntaxHiding && !isExcalidrawDoc && !isHtmlDocumentPathBlock(path)

  const pendingEditCaretHintRef = useRef<{ before: string; after: string } | null>(null)

  const handleViewClickToEdit = (event: React.MouseEvent<HTMLElement>) => {
    if (!clickToEditActive || loading || !!error) return
    const target = event.target as HTMLElement
    if (target.closest('a,button,input,textarea,select,summary,[role="button"],img,video,audio')) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    // Capture the rendered text around the click so the editor can drop the
    // caret at the same spot (best-effort snippet search in the source).
    pendingEditCaretHintRef.current = null
    const doc = event.currentTarget.ownerDocument as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY)
    const node = range?.startContainer
    if (range && node && node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      const offset = range.startOffset
      pendingEditCaretHintRef.current = {
        before: text.slice(Math.max(0, offset - 24), offset),
        after: text.slice(offset, offset + 32),
      }
    }
    startEditing()
  }
  const isHtmlDoc = isHtmlDocumentPathBlock(path)
  const supportsMindmap = !isExcalidrawDoc
    && !isHtmlDoc
    && /\.md$/i.test(path)
    && !/\.excalidraw\.md$/i.test(path)
  const effectiveTopBarHidden = topBarHiddenProp !== undefined ? topBarHiddenProp : topBarHiddenInViewMode
  const hideTopBarInView = !isEditing && effectiveTopBarHidden

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
  const showMiniNavRail = layout.mode === 'desktop' && !layout.isCapacitorNative && !isHtmlDoc
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
  const markdownRehypePlugins = useMemo(() => [...markdownMathRehypePluginsBlock], [])
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
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
  }, [isIosSurface])

  const handleExcalidrawApiChange = useCallback((api: ExcalidrawCanvasApiOrch | null) => {
    excalidrawApiRef.current = api
    if (!isExcalidrawDoc) return
    preserveExcalidrawCrashMarkerOnUnmountRef.current = true
    if (excalidrawCrashMarkerClearTimeoutRef.current !== null) {
      window.clearTimeout(excalidrawCrashMarkerClearTimeoutRef.current)
      excalidrawCrashMarkerClearTimeoutRef.current = null
    }
    if (!api) {
      markExcalidrawCrashStageBlock(path, 'editor_mounting')
      return
    }
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

  const handleSave = async () => {
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

    const timeoutId = window.setTimeout(() => {
      void handleSaveRef.current()
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    autoSaveEnabled,
    baseMtime,
    conflict,
    error,
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
      className={cn('flex h-full min-h-0 flex-col bg-card p-2', className)}
      data-prevent-sheet-escape={isEditing ? 'true' : undefined}
    >
      <div className="relative min-h-0 flex-1">
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
            isExcalidrawDoc && !isEditing ? 'flex flex-col overflow-hidden' : (isExcalidrawDoc ? 'overflow-hidden' : 'overflow-y-auto'),
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
            <div className={cn(
              'ts-md-header ts-doc-header flex items-start justify-between gap-3 border-b border-border/50',
              isIosPhone ? 'flex-col items-stretch px-4 py-3.5' : 'px-6 py-5',
            )}>
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
                <InfoPanelToggleButtonBlock active={showMeta} onToggle={() => setShowMeta(v => !v)} />

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

                {!isEditing && !clickToEditActive && (
                  <button
                    onClick={() => startEditing()}
                    disabled={loading || !!error}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    title="Edit file"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
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
                    {autoSaveEnabled ? (
                      <button
                        type="button"
                        onClick={() => { void finishEditing() }}
                        disabled={saving || baseMtime === null}
                        className={saveButtonClassName}
                      >
                        Done
                      </button>
                    ) : (
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
                    <button
                      type="button"
                      onClick={() => setAutoSaveEnabled(v => !v)}
                      className={cn(
                        'font-medium transition-colors',
                        isIosPhone ? 'h-7 rounded-md px-2 text-[11px]' : 'rounded-lg px-2 py-1 text-xs',
                        autoSaveEnabled ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      title="Toggle auto save"
                    >
                      {autoSaveEnabled ? 'Auto-save On' : 'Auto-save Off'}
                    </button>
                    <span className="hidden px-1 text-xs text-muted-foreground md:inline">
                      {hasChanges ? 'Unsaved changes' : 'No changes'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExcalidrawImmersive(v => !v)}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    >
                      {excalidrawImmersive ? 'Exit Focus' : 'Focus Canvas'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleSave() }}
                      disabled={!hasChanges || saving || baseMtime === null}
                      className={saveButtonClassName}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saveButtonLabel}
                    </button>
                  </>
                )}

                <OverflowMenuButtonBlock entries={headerMenuEntries} title="More actions" />

                {showCloseButton && onClose && (
                  <button
                    onClick={() => {
                      // While editing, ✕ means "leave editing", not "close the
                      // document" — one exit affordance instead of a separate
                      // Cancel button.
                      if (isEditing) {
                        cancelEditing()
                        return
                      }
                      onClose()
                    }}
                    className={cn(
                      'transition-colors hover:bg-muted',
                      isIosPhone ? 'rounded-md p-1.5' : 'rounded-lg p-1.5',
                    )}
                    title={isEditing ? 'Stop editing' : 'Close'}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
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
            <ExcalidrawDocumentBlock content={content} filePath={path} onOpenPath={openLinkedPath} className="flex-1 min-h-0" />
          )}

          {!loading && !error && content !== null && !isEditing && !isExcalidrawDoc && isHtmlDoc && (
            <div className={cn('h-full min-h-0', isIosPhone ? 'px-5 py-5' : 'px-6 py-5')}>
              <HtmlDocumentBlock html={displayContent} className="h-full min-h-[60vh]" />
            </div>
          )}

          {!loading && !error && content !== null && !isEditing && !isExcalidrawDoc && !isHtmlDoc && viewSurface === 'canvas' && (
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

          {!loading && !error && content !== null && !isEditing && !isExcalidrawDoc && !isHtmlDoc && viewSurface === 'doc' && (
            <div>
              <div
                className="sticky z-30 flex flex-wrap items-center gap-1 border-b border-border/20 bg-background p-2"
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
                className={cn('space-y-2', isIosPhone ? 'px-5 py-5' : 'px-8 py-7', clickToEditActive && 'cursor-text')}
                onClick={handleViewClickToEdit}
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
              className="h-[52vh] sm:h-[60vh] lg:h-[72vh]"
            />
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
              className="relative z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur"
              style={{
                paddingTop: isElectronSurface ? '2.25rem' : isIosSurface ? 'calc(var(--ltm-safe-top, 0px) + 0.5rem)' : '0.5rem',
                ...isElectronSurface && { WebkitAppRegion: 'drag' } as React.CSSProperties,
              }}
            >
              <div
                className="min-w-0 flex items-center gap-2"
              >
                <span className="truncate text-sm font-medium text-foreground">
                  {filename}
                </span>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Excalidraw Focus Mode
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                  {hasChanges ? 'Unsaved changes' : 'Saved'}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5" style={isElectronSurface ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}>
                <button
                  type="button"
                  onClick={() => setAutoSaveEnabled(v => !v)}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    autoSaveEnabled ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  title="Toggle auto save"
                >
                  {autoSaveEnabled ? 'Auto-save On' : 'Auto-save Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setExcalidrawImmersive(false)}
                  className="rounded-md border border-border/70 px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                >
                  Exit Focus
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="rounded-md border border-border/70 px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSave() }}
                  disabled={!hasChanges || saving || baseMtime === null}
                  className="rounded-md border border-border/70 px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveButtonLabel}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ExcalidrawDocumentBlock
                content={excalidrawEditorContent}
                editable
                onSceneChange={handleExcalidrawSceneChange}
                onApiChange={handleExcalidrawApiChange}
                filePath={path}
                onOpenPath={openLinkedPath}
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
            className="fixed right-3 top-32 z-30 select-none rounded-lg border border-border/70 bg-background/90 p-1 shadow-sm backdrop-blur"
          />
        )}
      </div>
    </div>
  )
}

function PdfDocumentRuntimeBlock({
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

      <div className="min-h-0 flex-1">
        <PdfDocumentBlock path={path} className="h-full" />
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
