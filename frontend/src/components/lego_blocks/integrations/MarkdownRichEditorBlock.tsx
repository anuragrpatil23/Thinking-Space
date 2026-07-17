import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { redo, undo } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import {
  Bold,
  Code,
  Heading1,
  Italic,
  Link2,
  List,
  ListOrdered,
  PenLine,
  Quote,
  RotateCcw,
  RotateCw,
  Sparkles,
  Table,
  Workflow,
} from 'lucide-react'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import type { AiSettingsScope } from '@/services/lego_blocks/integrations/aiSettingsBlock'
import type { AiProvider } from '@/services/orchestrators/chatOrch'
import AiAssistControlsBlock from '@/components/lego_blocks/integrations/AiAssistControlsBlock'
import AiAssistReviewBlock from '@/components/lego_blocks/integrations/AiAssistReviewBlock'
import AiStewardPanelBlock from '@/components/lego_blocks/integrations/AiStewardPanelBlock'
import MarkdownMindmapPanelBlock from '@/components/lego_blocks/integrations/MarkdownMindmapPanelBlock'
import RelatedThoughtsPanelBlock from '@/components/lego_blocks/integrations/RelatedThoughtsPanelBlock'
import MarkdownTableOfContentsBlock from '@/components/lego_blocks/integrations/MarkdownTableOfContentsBlock'
import { useAiAssistRuntimeBlock } from '@/components/lego_blocks/hooks/integrations/useAiAssistRuntimeBlock'
import type { StewardMetadataSuggestion } from '@/services/orchestrators/stewardMetadataOrch'
import {
  getWikilinkSuggestionsOrch,
  toObsidianWikilinkTargetOrch,
} from '@/services/orchestrators/obsidianLinkOrch'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import ContextMenuBlock, { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import {
  buildMarkdownTableFromRowsBlock,
  buildMarkdownTableTemplateBlock,
  detectAndParseDelimitedTableBlock,
  formatMarkdownTableAtSelectionBlock,
} from '@/services/orchestrators/markdownTableOrch'
import UniversalSearchBlock from '@/components/lego_blocks/integrations/UniversalSearchBlock'
import { UNIVERSAL_SEARCH_DROPDOWN_PRESET_BLOCK } from '@/components/lego_blocks/integrations/universalSearchPresetBlock'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/lego_blocks/units/ui/select'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import { createMarkdownInlineImageExtensionBlock } from '@/components/lego_blocks/units/markdownInlineImageExtensionBlock'
import { createMarkdownSyntaxHidingExtensionBlock } from '@/components/lego_blocks/units/markdownSyntaxHidingExtensionBlock'
import { createMarkdownTaskCheckboxExtensionBlock } from '@/components/lego_blocks/units/markdownTaskCheckboxExtensionBlock'
import { resolveEditorLanguageBlock } from '@/components/lego_blocks/units/editorLanguageBlock'
import { readMarkdownEditorSettingsBlock } from '@/services/lego_blocks/integrations/markdownEditorSettingsBlock'
import {
  deriveWikilinkLabelBlock,
  type WikilinkSuggestionBlock,
} from '@/services/lego_blocks/integrations/obsidianWikilinkBlock'
import {
  buildInlineTextDiffSessionBlock,
  renderInlineTextDiffBlock,
  type InlineTextDiffDecisionBlock,
  type InlineTextDiffRenderedHunkBlock,
  type InlineTextDiffSessionBlock,
} from '@/services/lego_blocks/units/inlineTextDiffBlock'
import { cn } from '@/lib/utils'

interface MarkdownRichEditorBlockProps {
  value: string
  onChange: (next: string) => void
  currentPath?: string
  className?: string
  editorClassName?: string
  toolbarClassName?: string
  placeholder?: string
  compactMobile?: boolean
  /** When true the toolbar is always visible (legacy behavior). When false a toggle button is shown. Default: false. */
  toolbarAlwaysVisible?: boolean
  /** Rendered-text snippets around a view-mode click; used to place the caret
   *  at the clicked spot when the editor mounts (best-effort text search). */
  initialCursorHint?: { before: string; after: string } | null
  /** When false, hide formatting toolbar controls entirely (useful for non-markdown text editing). Default: true. */
  enableFormattingToolbar?: boolean
  /** Enables built-in AI assist controls in the editor toolbar and panel. Default: true. */
  enableAiAssist?: boolean
  /** Optional controlled AI panel state. */
  aiPanelOpen?: boolean
  /** Initial AI panel open state for uncontrolled mode. Default: false. */
  defaultAiPanelOpen?: boolean
  /** Called whenever the AI panel open state changes. */
  onAiPanelOpenChange?: (open: boolean) => void
  /** AI settings scope used to resolve provider/model. Default: markdown_editor. */
  aiAssistScope?: AiSettingsScope
  /** AI telemetry/use-case identifier. Default: markdown.assist. */
  aiAssistUseCase?: string
  /** Optional helper text shown under AI assist actions. */
  aiAssistHelperText?: string
  /** Disables AI action buttons when true. */
  aiAssistDisabled?: boolean
  /** Enables AI steward section in AI panel. Default: true. */
  aiStewardEnabled?: boolean
  /** Source file path for steward proposal generation. Defaults to currentPath. */
  aiStewardFilePath?: string
  /** Optional apply handler used by AI steward Accept action. */
  onAiStewardApplySuggestion?: (suggestion: StewardMetadataSuggestion) => void | Promise<void>
  /** Enables related thoughts section in AI panel. Default: true. */
  relatedThoughtsEnabled?: boolean
  /** Optional source file path for related-thought matching. Defaults to aiStewardFilePath/currentPath. */
  relatedThoughtsSourceFilePath?: string
  /** Related-thought result limit. Default: 6. */
  relatedThoughtsLimit?: number
  /** Minimum characters before related-thought lookup runs. Default: 24. */
  relatedThoughtsMinChars?: number
  /** Called when user opens a related-thought result. */
  onRelatedThoughtOpenPath?: (path: string) => void
  /** Called when user opens a related-thought result in a new app tab. */
  onRelatedThoughtOpenPathInNewTab?: (path: string) => void
}

export interface MarkdownRichEditorBlockHandle {
  undo: () => void
  redo: () => void
  focus: () => void
}

function wrapSelection(
  source: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string,
): { value: string; start: number; end: number } {
  const selected = source.slice(start, end)
  const text = selected || placeholder
  const value = `${source.slice(0, start)}${prefix}${text}${suffix}${source.slice(end)}`
  const nextStart = start + prefix.length
  const nextEnd = nextStart + text.length
  return { value, start: nextStart, end: nextEnd }
}

function prefixSelectionLines(
  source: string,
  start: number,
  end: number,
  formatter: (line: string, index: number) => string,
): { value: string; start: number; end: number } {
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEndRaw = source.indexOf('\n', end)
  const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw
  const lines = source.slice(lineStart, lineEnd).split('\n')
  const patched = lines.map((line, index) => formatter(line, index)).join('\n')
  const value = `${source.slice(0, lineStart)}${patched}${source.slice(lineEnd)}`
  return { value, start: lineStart, end: lineStart + patched.length }
}

function insertWikilink(
  source: string,
  start: number,
  end: number,
): { value: string; start: number; end: number } {
  const selected = source.slice(start, end).trim()
  const rawTarget = selected || 'linked note'
  const target = toObsidianWikilinkTargetOrch(rawTarget) || rawTarget
  const wrapped = `[[${target}]]`
  const value = `${source.slice(0, start)}${wrapped}${source.slice(end)}`
  return {
    value,
    start: start + 2,
    end: start + 2 + target.length,
  }
}

function insertTextAtSelectionBlock(
  source: string,
  start: number,
  end: number,
  insert: string,
): { value: string; start: number; end: number } {
  const value = `${source.slice(0, start)}${insert}${source.slice(end)}`
  const next = start + insert.length
  return { value, start: next, end: next }
}

function getWikilinkCompletionQueryFromState(
  state: EditorState,
): { from: number; to: number; query: string } | null {
  const selection = state.selection.main
  if (!selection.empty) return null

  const cursor = selection.from
  const line = state.doc.lineAt(cursor)
  const beforeCursor = state.sliceDoc(line.from, cursor)
  const match = beforeCursor.match(/\[\[[^[\]\n]*$/)
  if (!match) return null

  const raw = match[0].slice(2)
  if (raw.includes('|')) return null

  const leadingWhitespace = raw.length - raw.trimStart().length
  return {
    from: cursor - raw.length + leadingWhitespace,
    to: cursor,
    query: raw.trim(),
  }
}

const TOOLBAR_BTN = 'rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground'
interface InlineDiffWidgetActionsBlock {
  onAccept: (hunkId: string) => void
  onReject: (hunkId: string) => void
  onReset: (hunkId: string) => void
  onUpdateAfterLines: (hunkId: string, nextAfterLines: string[]) => void
}

type InlineDiffWordOpBlock = { kind: 'equal' | 'added' | 'removed'; text: string }

function tokenizeInlineDiffWordOpsBlock(value: string): string[] {
  if (!value) return []
  return value.split(/(\s+)/).filter((token) => token.length > 0)
}

function buildInlineDiffWordOpsBlock(before: string, after: string): InlineDiffWordOpBlock[] {
  const a = tokenizeInlineDiffWordOpsBlock(before)
  const b = tokenizeInlineDiffWordOpsBlock(after)
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []

  const matrixCellLimit = 12_000
  if (n * m > matrixCellLimit) {
    return [
      ...(before ? [{ kind: 'removed' as const, text: before }] : []),
      ...(after ? [{ kind: 'added' as const, text: after }] : []),
    ]
  }

  const width = m + 1
  const lcs = new Uint16Array((n + 1) * (m + 1))
  const idx = (i: number, j: number) => i * width + j

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        lcs[idx(i, j)] = lcs[idx(i + 1, j + 1)] + 1
      } else {
        const down = lcs[idx(i + 1, j)]
        const right = lcs[idx(i, j + 1)]
        lcs[idx(i, j)] = down >= right ? down : right
      }
    }
  }

  const ops: InlineDiffWordOpBlock[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', text: a[i] })
      i += 1
      j += 1
      continue
    }
    const down = lcs[idx(i + 1, j)]
    const right = lcs[idx(i, j + 1)]
    if (down >= right) {
      ops.push({ kind: 'removed', text: a[i] })
      i += 1
    } else {
      ops.push({ kind: 'added', text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ kind: 'removed', text: a[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ kind: 'added', text: b[j] })
    j += 1
  }
  return ops
}

function appendInlineDiffWordPreviewBlock(
  container: HTMLElement,
  ops: InlineDiffWordOpBlock[],
  side: 'before' | 'after',
): void {
  const visible = ops.filter((op) => (
    op.kind === 'equal'
    || (side === 'before' && op.kind === 'removed')
    || (side === 'after' && op.kind === 'added')
  ))
  if (visible.length === 0) {
    container.textContent = '\u00a0'
    return
  }
  for (const op of visible) {
    const span = document.createElement('span')
    span.textContent = op.text
    if (side === 'before' && op.kind === 'removed') {
      span.className = 'ts-ai-inline-diff-word-removed'
    } else if (side === 'after' && op.kind === 'added') {
      span.className = 'ts-ai-inline-diff-word-added'
    }
    container.append(span)
  }
}

function buildLineStartOffsetsBlock(content: string): number[] {
  const offsets = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') offsets.push(index + 1)
  }
  return offsets
}

function lineStartFromOffsetsBlock(offsets: number[], line: number, fallback: number): number {
  if (line <= 0) return 0
  if (line >= offsets.length) return fallback
  return offsets[line]
}

function hunkLabelBlock(hunk: InlineTextDiffRenderedHunkBlock): string {
  if (hunk.kind === 'added') return 'Insert suggestion'
  if (hunk.kind === 'removed') return 'Delete suggestion'
  return 'Change suggestion'
}

class InlineDiffWidgetBlock extends WidgetType {
  constructor(
    private readonly hunk: InlineTextDiffRenderedHunkBlock,
    private readonly actions: InlineDiffWidgetActionsBlock,
  ) {
    super()
  }

  eq(other: InlineDiffWidgetBlock): boolean {
    return other.hunk.id === this.hunk.id
      && other.hunk.decision === this.hunk.decision
      && other.hunk.startLine === this.hunk.startLine
      && other.hunk.endLine === this.hunk.endLine
      && other.hunk.afterLines.join('\n') === this.hunk.afterLines.join('\n')
  }

  toDOM(): HTMLElement {
    const root = document.createElement('div')
    root.className = 'ts-ai-inline-diff-widget'

    const heading = document.createElement('div')
    heading.className = 'ts-ai-inline-diff-widget-heading'
    heading.textContent = `${hunkLabelBlock(this.hunk)} • ${this.hunk.decision}`
    root.append(heading)

    if (this.hunk.decision === 'pending') {
      const preview = document.createElement('div')
      preview.className = 'ts-ai-inline-diff-widget-preview'

      if (this.hunk.kind === 'changed' && this.hunk.beforeLines.length === 1 && this.hunk.afterLines.length === 1) {
        const wordDiffPreview = document.createElement('div')
        wordDiffPreview.className = 'ts-ai-inline-diff-widget-word-preview'
        const beforeWordLine = document.createElement('div')
        beforeWordLine.className = 'ts-ai-inline-diff-widget-word-before'
        const afterWordLine = document.createElement('div')
        afterWordLine.className = 'ts-ai-inline-diff-widget-word-after'
        const wordOps = buildInlineDiffWordOpsBlock(this.hunk.beforeLines[0], this.hunk.afterLines[0])
        appendInlineDiffWordPreviewBlock(beforeWordLine, wordOps, 'before')
        appendInlineDiffWordPreviewBlock(afterWordLine, wordOps, 'after')
        wordDiffPreview.append(beforeWordLine, afterWordLine)
        preview.append(wordDiffPreview)
      }

      const afterInput = document.createElement('textarea')
      afterInput.className = 'ts-ai-inline-diff-widget-after-input'
      afterInput.value = this.hunk.afterLines.join('\n')
      afterInput.rows = 1
      afterInput.placeholder = '(empty)'
      const maxHeightPx = 448
      const autoResizeAfterInput = () => {
        afterInput.style.height = '0px'
        const nextHeight = Math.min(afterInput.scrollHeight, maxHeightPx)
        afterInput.style.height = `${nextHeight}px`
        afterInput.style.overflowY = afterInput.scrollHeight > maxHeightPx ? 'auto' : 'hidden'
      }
      const stopBubbling = (event: Event) => {
        event.stopPropagation()
      }
      afterInput.addEventListener('click', stopBubbling)
      afterInput.addEventListener('mousedown', stopBubbling)
      afterInput.addEventListener('keydown', stopBubbling)
      afterInput.addEventListener('input', () => {
        const nextValue = afterInput.value
        const nextAfterLines = nextValue.length === 0 ? [] : nextValue.split('\n')
        this.actions.onUpdateAfterLines(this.hunk.id, nextAfterLines)
        autoResizeAfterInput()
      })
      requestAnimationFrame(autoResizeAfterInput)
      preview.append(afterInput)
      root.append(preview)
    } else {
      const note = document.createElement('div')
      note.className = 'ts-ai-inline-diff-widget-note'
      note.textContent = this.hunk.decision === 'accepted'
        ? 'Accepted. Editor body shows applied text.'
        : 'Rejected. Editor body keeps original text.'
      root.append(note)
    }

    const actions = document.createElement('div')
    actions.className = 'ts-ai-inline-diff-widget-actions'

    if (this.hunk.decision === 'pending') {
      const acceptButton = document.createElement('button')
      acceptButton.type = 'button'
      acceptButton.textContent = 'Accept'
      acceptButton.className = 'ts-ai-inline-diff-widget-btn ts-ai-inline-diff-widget-btn-accept'
      acceptButton.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.actions.onAccept(this.hunk.id)
      })

      const rejectButton = document.createElement('button')
      rejectButton.type = 'button'
      rejectButton.textContent = 'Reject'
      rejectButton.className = 'ts-ai-inline-diff-widget-btn ts-ai-inline-diff-widget-btn-reject'
      rejectButton.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.actions.onReject(this.hunk.id)
      })
      actions.append(acceptButton, rejectButton)
    } else {
      const resetButton = document.createElement('button')
      resetButton.type = 'button'
      resetButton.textContent = 'Reset'
      resetButton.className = 'ts-ai-inline-diff-widget-btn ts-ai-inline-diff-widget-btn-reset'
      resetButton.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.actions.onReset(this.hunk.id)
      })
      actions.append(resetButton)
    }

    root.append(actions)
    return root
  }

  ignoreEvent(): boolean {
    return false
  }
}

const MarkdownRichEditorBlockInner = forwardRef<MarkdownRichEditorBlockHandle, MarkdownRichEditorBlockProps>(function MarkdownRichEditorBlock({
  value,
  onChange,
  currentPath = '',
  className,
  editorClassName,
  toolbarClassName,
  placeholder = 'Write markdown...',
  compactMobile = false,
  toolbarAlwaysVisible = false,
  initialCursorHint = null,
  enableFormattingToolbar = true,
  enableAiAssist = true,
  aiPanelOpen: controlledAiPanelOpen,
  defaultAiPanelOpen = false,
  onAiPanelOpenChange,
  aiAssistScope = 'markdown_editor',
  aiAssistUseCase = 'markdown.assist',
  aiAssistHelperText,
  aiAssistDisabled = false,
  aiStewardEnabled = true,
  aiStewardFilePath,
  onAiStewardApplySuggestion,
  relatedThoughtsEnabled = true,
  relatedThoughtsSourceFilePath,
  relatedThoughtsLimit = 6,
  relatedThoughtsMinChars = 24,
  onRelatedThoughtOpenPath,
  onRelatedThoughtOpenPathInNewTab,
}, ref) {
  const { layout } = useUILayoutBlock()
  const { resolvedColorMode } = useUIThemeBlock()
  const editorCanvasClassName = resolvedColorMode === 'dark' ? 'bg-background' : 'bg-white'
  const isIphoneRuntime = useMemo(() => {
    const isIosPhoneSurface = layout.surface === 'capacitor-ios' && layout.mode === 'phone'
    if (isIosPhoneSurface) return true
    if (typeof navigator === 'undefined') return false
    return /iPhone/i.test(navigator.userAgent)
  }, [layout.mode, layout.surface])
  const editorViewRef = useRef<EditorView | null>(null)
  const currentPathRef = useRef(currentPath)
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath])
  // One editor engine, per-file-type grammar: markdown files get the markdown
  // grammar + live-preview decorations, code files get real highlighting.
  const editorLanguage = useMemo(() => resolveEditorLanguageBlock(currentPath), [currentPath])
  // Live-preview markdown should LOOK like the document, not a code editor:
  // prose font + view-mode spacing, no gutters. Code files keep the editor feel.
  const proseEditing = editorLanguage.kind === 'markdown'
    && readMarkdownEditorSettingsBlock().livePreviewSyntaxHiding
  const handleImagePasteRef = useRef<((file: File, view: EditorView) => Promise<void>) | null>(null)
  handleImagePasteRef.current = async (file: File, view: EditorView) => {
    const path = currentPathRef.current
    if (!path) return
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/avif': 'avif',
      'image/svg+xml': 'svg',
    }
    const ext = mimeToExt[file.type] ?? 'png'
    const noteDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const filename = `pasted-image-${Date.now()}.${ext}`
    const storagePath = noteDir ? `${noteDir}/assets/${filename}` : `assets/${filename}`
    const wikilinkTarget = `assets/${filename}`
    const buffer = await file.arrayBuffer()
    await getVaultFS().writeBytes(storagePath, new Uint8Array(buffer))
    const { from, to } = view.state.selection.main
    const insert = `![[${wikilinkTarget}]]`
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    })
    view.focus()
  }
  const [contextMenuState, setContextMenuState] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [toolbarOpen, setToolbarOpen] = useState(false)
  const [currentCursorLine, setCurrentCursorLine] = useState(1)
  const [internalAiPanelOpen, setInternalAiPanelOpen] = useState(defaultAiPanelOpen)
  const [wikilinkPickerOpen, setWikilinkPickerOpen] = useState(false)
  const [wikilinkQuery, setWikilinkQuery] = useState('')
  const [wikilinkSuggestions, setWikilinkSuggestions] = useState<WikilinkSuggestionBlock[]>([])
  const [wikilinkLoading, setWikilinkLoading] = useState(false)
  const [relatedThoughtsOpen, setRelatedThoughtsOpen] = useState(false)
  const [stewardRunning, setStewardRunning] = useState(false)
  const [mindmapPanelOpen, setMindmapPanelOpen] = useState(false)
  const pendingInlineWidgetScrollRestoreRef = useRef<{ top: number; left: number } | null>(null)
  const [inlineDiffSession, setInlineDiffSession] = useState<InlineTextDiffSessionBlock | null>(null)
  const [inlineDiffDecisions, setInlineDiffDecisions] = useState<Record<string, InlineTextDiffDecisionBlock>>({})
  const {
    aiSelectionLoading,
    selectedProvider,
    selectedModel,
    providerOptions,
    setSelectedProvider,
    showThinkToggle,
    thinkEnabled,
    setThinkEnabled,
    assistRunningAction,
    assistError,
    assistResultPill,
    assistSuggestion,
    customPromptHistory,
    runAssistAction,
    applyAssistSuggestion,
    dismissAssistSuggestion,
    clearAssistState,
  } = useAiAssistRuntimeBlock({
    scope: aiAssistScope,
    useCase: aiAssistUseCase,
    syncedModelScopes: aiStewardEnabled ? ['steward_metadata'] : undefined,
    syncedProviderScopes: aiStewardEnabled ? ['steward_metadata'] : undefined,
  })

  const aiPanelOpen = controlledAiPanelOpen ?? internalAiPanelOpen
  // In prose (live-preview) editing the pinned toolbar breaks the "same
  // document, now editable" illusion — keep it behind its toggle instead.
  const effectiveToolbarAlwaysVisible = toolbarAlwaysVisible && !proseEditing
  const showToolbar = enableFormattingToolbar && (effectiveToolbarAlwaysVisible || toolbarOpen)
  const stewardFilePath = (aiStewardFilePath ?? currentPath ?? '').trim()
  const relatedSourceFilePath = (relatedThoughtsSourceFilePath ?? stewardFilePath).trim()
  const normalizedPath = currentPath.trim()
  const supportsMindmap = normalizedPath.length > 0
    && /\.md$/i.test(normalizedPath)
    && !/\.excalidraw\.md$/i.test(normalizedPath)
  const inlineDiffRender = useMemo(() => {
    if (!inlineDiffSession) return null
    return renderInlineTextDiffBlock(inlineDiffSession, inlineDiffDecisions)
  }, [inlineDiffDecisions, inlineDiffSession])
  const inlineDiffHunkIds = useMemo(
    () => inlineDiffSession?.hunks.map(hunk => hunk.id) ?? [],
    [inlineDiffSession],
  )
  const aiStateLabel = useMemo(() => {
    if (aiSelectionLoading) return 'resolving model'
    if (stewardRunning) return 'steward running'
    if (assistRunningAction) return `assist running: ${assistRunningAction}`
    return 'idle'
  }, [aiSelectionLoading, assistRunningAction, stewardRunning])
  const aiStateBusy = aiSelectionLoading || stewardRunning || !!assistRunningAction

  useEffect(() => {
    if (!aiPanelOpen) setRelatedThoughtsOpen(false)
  }, [aiPanelOpen])

  useEffect(() => {
    if (!aiStewardEnabled) setStewardRunning(false)
  }, [aiStewardEnabled])

  useLayoutEffect(() => {
    const pending = pendingInlineWidgetScrollRestoreRef.current
    if (!pending) return
    const view = editorViewRef.current
    if (view) {
      view.scrollDOM.scrollTop = pending.top
      view.scrollDOM.scrollLeft = pending.left
    }
    pendingInlineWidgetScrollRestoreRef.current = null
  }, [inlineDiffSession])

  const setAiPanelOpen = useCallback((open: boolean) => {
    if (controlledAiPanelOpen === undefined) {
      setInternalAiPanelOpen(open)
    }
    onAiPanelOpenChange?.(open)
  }, [controlledAiPanelOpen, onAiPanelOpenChange])

  const toggleAiPanel = useCallback(() => {
    setAiPanelOpen(!aiPanelOpen)
  }, [aiPanelOpen, setAiPanelOpen])

  const toggleMindmapPanel = useCallback(() => {
    setMindmapPanelOpen((prev) => !prev)
  }, [])

  const acceptInlineDiffHunk = useCallback((hunkId: string) => {
    setInlineDiffDecisions(prev => ({ ...prev, [hunkId]: 'accepted' }))
  }, [])

  const rejectInlineDiffHunk = useCallback((hunkId: string) => {
    setInlineDiffDecisions(prev => ({ ...prev, [hunkId]: 'rejected' }))
  }, [])

  const resetInlineDiffHunk = useCallback((hunkId: string) => {
    setInlineDiffDecisions(prev => ({ ...prev, [hunkId]: 'pending' }))
  }, [])

  const updateInlineDiffHunkAfterLines = useCallback((hunkId: string, nextAfterLines: string[]) => {
    const currentSession = inlineDiffSession
    if (!currentSession) return
    const currentHunk = currentSession.hunks.find(hunk => hunk.id === hunkId)
    if (!currentHunk) return
    if (currentHunk.afterLines.join('\n') === nextAfterLines.join('\n')) return

    const view = editorViewRef.current
    if (view) {
      pendingInlineWidgetScrollRestoreRef.current = {
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      }
    }

    setInlineDiffSession((prev) => {
      if (!prev) return prev
      const nextHunks = prev.hunks.map((hunk) => {
        if (hunk.id !== hunkId) return hunk
        return { ...hunk, afterLines: nextAfterLines }
      })
      return { ...prev, hunks: nextHunks }
    })
  }, [inlineDiffSession])

  const startInlineDiffReview = useCallback((suggestedContentOverride?: string) => {
    if (!assistSuggestion) return
    const nextSuggestedContent = suggestedContentOverride ?? assistSuggestion.suggestedContent
    const session = buildInlineTextDiffSessionBlock(
      assistSuggestion.originalContent,
      nextSuggestedContent,
    )
    if (session.hunks.length === 0) {
      dismissAssistSuggestion()
      if (value !== nextSuggestedContent) onChange(nextSuggestedContent)
      return
    }
    setInlineDiffSession(session)
    setInlineDiffDecisions({})
    dismissAssistSuggestion()
    if (value !== assistSuggestion.originalContent) onChange(assistSuggestion.originalContent)
  }, [assistSuggestion, dismissAssistSuggestion, onChange, value])

  const acceptAllInlineDiffHunks = useCallback(() => {
    if (inlineDiffHunkIds.length === 0) return
    setInlineDiffDecisions(Object.fromEntries(inlineDiffHunkIds.map(id => [id, 'accepted' as const])))
  }, [inlineDiffHunkIds])

  const rejectAllInlineDiffHunks = useCallback(() => {
    if (inlineDiffHunkIds.length === 0) return
    setInlineDiffDecisions(Object.fromEntries(inlineDiffHunkIds.map(id => [id, 'rejected' as const])))
  }, [inlineDiffHunkIds])

  const discardRejectedAndAcceptRemainingInlineDiffHunks = useCallback(() => {
    if (!inlineDiffSession) return
    const finalDecisions = Object.fromEntries(
      inlineDiffSession.hunks.map((hunk) => [
        hunk.id,
        inlineDiffDecisions[hunk.id] === 'rejected' ? 'rejected' as const : 'accepted' as const,
      ]),
    )
    const next = renderInlineTextDiffBlock(inlineDiffSession, finalDecisions)
    if (value !== next.content) onChange(next.content)
    setInlineDiffSession(null)
    setInlineDiffDecisions({})
  }, [inlineDiffDecisions, inlineDiffSession, onChange, value])

  const finishInlineDiffReview = useCallback(() => {
    setInlineDiffSession(null)
    setInlineDiffDecisions({})
  }, [])

  const cancelInlineDiffReview = useCallback(() => {
    if (inlineDiffSession && value !== inlineDiffSession.originalContent) {
      onChange(inlineDiffSession.originalContent)
    }
    setInlineDiffSession(null)
    setInlineDiffDecisions({})
  }, [inlineDiffSession, onChange, value])

  const undoEditor = () => {
    const view = editorViewRef.current
    if (!view) return
    undo(view)
    view.focus()
  }

  const redoEditor = () => {
    const view = editorViewRef.current
    if (!view) return
    redo(view)
    view.focus()
  }

  useImperativeHandle(ref, () => ({
    undo: undoEditor,
    redo: redoEditor,
    focus: () => {
      editorViewRef.current?.focus()
    },
  }))

  const applyWikilinkSuggestion = useCallback((suggestion: WikilinkSuggestionBlock) => {
    const view = editorViewRef.current
    if (!view) return

    const query = getWikilinkCompletionQueryFromState(view.state)
    if (!query) return

    const target = toObsidianWikilinkTargetOrch(suggestion.target) || suggestion.target
    const hasClosingBrackets = view.state.sliceDoc(query.to, query.to + 2) === ']]'
    const insertValue = hasClosingBrackets ? target : `${target}]]`

    view.dispatch({
      changes: { from: query.from, to: query.to, insert: insertValue },
      selection: { anchor: query.from + target.length },
    })
    view.focus()
    setWikilinkPickerOpen(false)
  }, [])

  const applyWikilinkQuery = useCallback((nextQuery: string) => {
    const view = editorViewRef.current
    if (!view) return

    const query = getWikilinkCompletionQueryFromState(view.state)
    if (!query) return

    view.dispatch({
      changes: { from: query.from, to: query.to, insert: nextQuery },
      selection: { anchor: query.from + nextQuery.length },
    })
    view.focus()
  }, [])

  useEffect(() => {
    if (!wikilinkPickerOpen) {
      setWikilinkSuggestions([])
      setWikilinkLoading(false)
      return
    }

    let canceled = false
    setWikilinkLoading(true)
    void getWikilinkSuggestionsOrch({
      currentPath,
      query: wikilinkQuery,
      limit: UNIVERSAL_SEARCH_DROPDOWN_PRESET_BLOCK.limit ?? 80,
    })
      .then((nextSuggestions) => {
        if (canceled) return
        setWikilinkSuggestions(nextSuggestions)
      })
      .catch(() => {
        if (canceled) return
        setWikilinkSuggestions([])
      })
      .finally(() => {
        if (canceled) return
        setWikilinkLoading(false)
      })

    return () => {
      canceled = true
    }
  }, [currentPath, wikilinkPickerOpen, wikilinkQuery])

  useEffect(() => {
    if (!inlineDiffRender) return
    if (value === inlineDiffRender.content) return
    onChange(inlineDiffRender.content)
  }, [inlineDiffRender, onChange, value])

  const inlineDiffDecorations = useMemo(() => {
    if (!inlineDiffRender) return null
    const offsets = buildLineStartOffsetsBlock(value)
    const ranges: any[] = []
    for (const hunk of inlineDiffRender.hunks) {
      // Anchor widgets at the end of the affected range so they render below the current line block.
      const anchor = lineStartFromOffsetsBlock(offsets, hunk.endLine, value.length)
      ranges.push(Decoration.widget({
        widget: new InlineDiffWidgetBlock(hunk, {
          onAccept: acceptInlineDiffHunk,
          onReject: rejectInlineDiffHunk,
          onReset: resetInlineDiffHunk,
          onUpdateAfterLines: updateInlineDiffHunkAfterLines,
        }),
        side: 1,
        block: true,
      }).range(anchor))

      const lineClass = hunk.decision === 'accepted'
        ? 'ts-ai-inline-diff-line-accepted'
        : (hunk.decision === 'pending' && hunk.kind === 'added'
            ? 'ts-ai-inline-diff-line-pending-added'
            : '')
      if (!lineClass) continue
      for (let lineIndex = hunk.startLine; lineIndex < hunk.endLine; lineIndex += 1) {
        const lineStart = lineStartFromOffsetsBlock(offsets, lineIndex, value.length)
        ranges.push(Decoration.line({ class: lineClass }).range(lineStart))
      }
    }
    return Decoration.set(ranges, true)
  }, [acceptInlineDiffHunk, inlineDiffRender, rejectInlineDiffHunk, resetInlineDiffHunk, updateInlineDiffHunkAfterLines, value])

  const extensions = useMemo(() => {
    const uiTheme = EditorView.theme({
      '&': {
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        height: '100%',
        minHeight: '100%',
        backgroundColor: 'transparent',
        maxWidth: '100%',
        overflow: 'hidden',
        color: 'hsl(var(--foreground))',
        caretColor: 'hsl(var(--foreground))',
      },
      '.cm-scroller': {
        height: '100%',
        minHeight: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        backgroundColor: 'transparent',
        fontFamily: proseEditing
          ? 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
          : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        ...(proseEditing ? { fontSize: '1rem' } : {}),
        lineHeight: proseEditing ? '1.75' : '1.6',
      },
      '.cm-line': {
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      },
      // View mode collapses blank markdown lines into paragraph spacing; give
      // empty editor lines a compressed height so the rhythm matches instead
      // of every blank line costing a full text row.
      ...(proseEditing
        ? {
            '.cm-line:has(> br:only-child)': {
              lineHeight: '0.7',
              minHeight: '0.7em',
            },
          }
        : {}),
      '.cm-content': {
        minHeight: '100%',
        padding: proseEditing
          ? (compactMobile ? '1.25rem 1.25rem' : '1.75rem 2rem')
          : (compactMobile ? '0.6rem 0.6rem 0.6rem 0.45rem' : '0.75rem 0.75rem 0.75rem 0.5rem'),
        whiteSpace: 'pre-wrap',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
        minHeight: '100%',
        marginRight: compactMobile ? '0.25rem' : '0.4rem',
        paddingLeft: compactMobile ? '0.1rem' : '0.25rem',
        color: 'hsl(var(--muted-foreground))',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: proseEditing ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
        ...(proseEditing ? { borderLeftWidth: '2px' } : {}),
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 0.35rem 0 0',
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'hsl(var(--primary) / 0.22)',
      },
      '.cm-focused': {
        outline: 'none',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.ts-ai-inline-diff-widget': {
        margin: compactMobile ? '0.2rem 0.2rem 0.35rem 0' : '0.25rem 0.3rem 0.4rem 0',
        border: '1px solid hsl(var(--border) / 0.8)',
        borderRadius: '0.45rem',
        backgroundColor: 'hsl(var(--background))',
        padding: compactMobile ? '0.35rem' : '0.45rem',
        display: 'grid',
        gap: '0.3rem',
      },
      '.ts-ai-inline-diff-widget-heading': {
        fontSize: '0.72rem',
        lineHeight: '1rem',
        color: 'hsl(var(--muted-foreground))',
      },
      '.ts-ai-inline-diff-widget-preview': {
        display: 'grid',
        gap: '0.25rem',
      },
      '.ts-ai-inline-diff-widget-word-preview': {
        display: 'grid',
        gap: '0.2rem',
      },
      '.ts-ai-inline-diff-widget-word-before': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        whiteSpace: 'pre-wrap',
        backgroundColor: 'hsl(38 92% 50% / 0.09)',
        borderRadius: '0.35rem',
        padding: '0.3rem 0.4rem',
      },
      '.ts-ai-inline-diff-widget-word-after': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        whiteSpace: 'pre-wrap',
        backgroundColor: 'hsl(142 76% 36% / 0.12)',
        borderRadius: '0.35rem',
        padding: '0.3rem 0.4rem',
      },
      '.ts-ai-inline-diff-word-removed': {
        textDecoration: 'line-through',
        borderRadius: '0.2rem',
        backgroundColor: 'hsl(var(--destructive) / 0.25)',
        paddingInline: '0.1rem',
      },
      '.ts-ai-inline-diff-word-added': {
        borderRadius: '0.2rem',
        backgroundColor: 'hsl(142 76% 36% / 0.25)',
        paddingInline: '0.1rem',
      },
      '.ts-ai-inline-diff-widget-note': {
        fontSize: '0.72rem',
        lineHeight: '1rem',
        color: 'hsl(var(--muted-foreground))',
      },
      '.ts-ai-inline-diff-widget-before': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        whiteSpace: 'pre-wrap',
        backgroundColor: 'hsl(38 92% 50% / 0.09)',
        borderRadius: '0.35rem',
        padding: '0.3rem 0.4rem',
      },
      '.ts-ai-inline-diff-widget-after': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        whiteSpace: 'pre-wrap',
        backgroundColor: 'hsl(142 76% 36% / 0.12)',
        borderRadius: '0.35rem',
        padding: '0.3rem 0.4rem',
      },
      '.ts-ai-inline-diff-widget-after-input': {
        width: '100%',
        resize: 'none',
        minHeight: '2.2rem',
        maxHeight: '28rem',
        overflowY: 'hidden',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        whiteSpace: 'pre-wrap',
        backgroundColor: 'hsl(142 76% 36% / 0.12)',
        borderRadius: '0.35rem',
        border: '1px solid hsl(142 76% 36% / 0.28)',
        padding: '0.3rem 0.4rem',
      },
      '.ts-ai-inline-diff-widget-actions': {
        display: 'flex',
        gap: '0.35rem',
      },
      '.ts-ai-inline-diff-widget-btn': {
        border: '1px solid hsl(var(--border) / 0.9)',
        borderRadius: '0.35rem',
        backgroundColor: 'hsl(var(--background))',
        fontSize: '0.72rem',
        lineHeight: '1rem',
        padding: '0.2rem 0.45rem',
        cursor: 'pointer',
      },
      '.ts-ai-inline-diff-widget-btn-accept': {
        borderColor: 'hsl(142 76% 36% / 0.45)',
        color: 'hsl(142 76% 28%)',
      },
      '.ts-ai-inline-diff-widget-btn-reject': {
        borderColor: 'hsl(var(--destructive) / 0.45)',
        color: 'hsl(var(--destructive))',
      },
      '.ts-ai-inline-diff-widget-btn-reset': {
        color: 'hsl(var(--foreground))',
      },
      '.cm-line.ts-ai-inline-diff-line-accepted': {
        backgroundColor: 'hsl(142 76% 36% / 0.12)',
      },
      '.cm-line.ts-ai-inline-diff-line-pending-added': {
        backgroundColor: 'hsl(142 76% 36% / 0.08)',
      },
    })

    const nextExtensions: Extension[] = [
      editorLanguage.extension,
      EditorView.lineWrapping,
      cmPlaceholder(placeholder),
      uiTheme,
      ...(inlineDiffRender ? [EditorState.readOnly.of(true)] : []),
      ...(inlineDiffDecorations ? [EditorView.decorations.of(inlineDiffDecorations)] : []),
      EditorView.updateListener.of((update) => {
        const nextLine = update.state.doc.lineAt(update.state.selection.main.head).number
        setCurrentCursorLine((prev) => (prev === nextLine ? prev : nextLine))
        const query = getWikilinkCompletionQueryFromState(update.state)
        if (!query) {
          setWikilinkPickerOpen(false)
          setWikilinkQuery('')
          return
        }

        setWikilinkQuery(query.query)
        setWikilinkPickerOpen(true)
      }),
      EditorView.domEventHandlers({
        paste(event, view) {
          const items = event.clipboardData?.items
          if (!items) return false
          for (let i = 0; i < items.length; i++) {
            const item = items[i]
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              const file = item.getAsFile()
              if (!file) continue
              event.preventDefault()
              void handleImagePasteRef.current?.(file, view)
              return true
            }
          }
          return false
        },
        contextmenu(event, view) {
          event.preventDefault()
          setContextMenuState({
            x: event.clientX,
            y: event.clientY,
            hasSelection: !view.state.selection.main.empty,
          })
          return true
        },
      }),
      keymap.of([]),
      // Live-preview decorations — markdown files only; code files get their
      // grammar without markdown rendering on top. Flags are read per
      // decoration pass, so the Settings toggle applies without a remount.
      ...(editorLanguage.kind === 'markdown'
        ? [
            createMarkdownInlineImageExtensionBlock({
              getCurrentPath: () => currentPathRef.current ?? null,
            }),
            createMarkdownSyntaxHidingExtensionBlock({
              isEnabled: () => readMarkdownEditorSettingsBlock().livePreviewSyntaxHiding,
            }),
            createMarkdownTaskCheckboxExtensionBlock({
              isEnabled: () => readMarkdownEditorSettingsBlock().livePreviewSyntaxHiding,
            }),
          ]
        : []),
    ]
    return nextExtensions
  }, [compactMobile, editorLanguage, proseEditing, inlineDiffDecorations, inlineDiffRender, placeholder])

  const applyPatch = (patchFactory: (text: string, from: number, to: number) => { value: string; start: number; end: number }) => {
    const view = editorViewRef.current
    if (!view) return
    const state = view.state
    const { from, to } = state.selection.main
    const source = state.doc.toString()
    const patch = patchFactory(source, from, to)
    view.dispatch({
      changes: {
        from: 0,
        to: source.length,
        insert: patch.value,
      },
      selection: {
        anchor: patch.start,
        head: patch.end,
      },
    })
    view.focus()
  }

  const jumpToHeadingLine = useCallback((lineNumber: number) => {
    const view = editorViewRef.current
    if (!view) return
    const boundedLine = Math.max(1, Math.min(lineNumber, view.state.doc.lines))
    const line = view.state.doc.line(boundedLine)
    view.dispatch({
      selection: {
        anchor: line.from,
        head: line.from,
      },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
    view.focus()
  }, [])

  const handleEditorChange = useCallback((next: string) => {
    onChange(next)
    if (assistSuggestion || assistError) clearAssistState()
  }, [assistError, assistSuggestion, clearAssistState, onChange])

  const pasteClipboardAsMarkdownTable = useCallback(async () => {
    const view = editorViewRef.current
    if (!view || !view.hasFocus) return
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return

    let pastedText = ''
    try {
      pastedText = await navigator.clipboard.readText()
    } catch {
      return
    }

    const parsedTable = detectAndParseDelimitedTableBlock(pastedText)
    if (!parsedTable) return

    const markdownTableText = buildMarkdownTableFromRowsBlock(parsedTable.rows)
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: markdownTableText },
      selection: { anchor: from + markdownTableText.length },
    })
    view.focus()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const subscribe = window.electronAPI?.markdownEditorOnPasteAsTable
    if (!subscribe) return
    return subscribe(() => {
      void pasteClipboardAsMarkdownTable()
    })
  }, [pasteClipboardAsMarkdownTable])

  return (
    <div className={cn('ltm-markdown-rich-editor relative flex min-h-0 flex-col', editorCanvasClassName, className)}>
      {/* Toolbar toggle button (only when not always visible) */}
      {enableFormattingToolbar && !effectiveToolbarAlwaysVisible && (
        <div className="flex items-center justify-end gap-1 px-2 pt-1.5">
          {enableAiAssist && !showToolbar && (
            <button
              type="button"
              onClick={toggleAiPanel}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
                aiPanelOpen && 'bg-muted text-foreground',
              )}
              title={aiPanelOpen ? 'Hide AI tools' : 'Show AI tools'}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI
            </button>
          )}
          {supportsMindmap && !showToolbar && (
            <button
              type="button"
              onClick={toggleMindmapPanel}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
                mindmapPanelOpen && 'bg-muted text-foreground',
              )}
              title={mindmapPanelOpen ? 'Hide mindmap tools' : 'Show mindmap tools'}
            >
              <Workflow className="h-3.5 w-3.5" />
              Mindmap
            </button>
          )}
          <button
            type="button"
            onClick={() => setToolbarOpen(prev => !prev)}
            className={cn(
              'rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground',
              toolbarOpen && 'bg-muted text-foreground',
            )}
            title={toolbarOpen ? 'Hide formatting' : 'Show formatting'}
          >
            <PenLine className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Formatting toolbar */}
      {showToolbar && (
        <div className={cn("sticky top-0 z-30 flex flex-wrap items-center gap-1 border-b border-border/20 bg-background p-2", toolbarClassName)}>
          <button type="button" onClick={() => applyPatch((text, from, to) => wrapSelection(text, from, to, '# ', '', 'Heading'))} className={TOOLBAR_BTN} title="Heading">
            <Heading1 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => applyPatch((text, from, to) => wrapSelection(text, from, to, '**', '**', 'bold text'))} className={TOOLBAR_BTN} title="Bold">
            <Bold className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => applyPatch((text, from, to) => wrapSelection(text, from, to, '*', '*', 'italic text'))} className={TOOLBAR_BTN} title="Italic">
            <Italic className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => applyPatch((text, from, to) => wrapSelection(text, from, to, '`', '`', 'code'))} className={TOOLBAR_BTN} title="Code">
            <Code className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => applyPatch((text, from, to) => wrapSelection(text, from, to, '[', '](https://)', 'link text'))} className={TOOLBAR_BTN} title="Link">
            <Link2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => applyPatch((text, from, to) => insertTextAtSelectionBlock(text, from, to, buildMarkdownTableTemplateBlock(3, 2)))}
            className={TOOLBAR_BTN}
            title="Insert table"
          >
            <Table className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => applyPatch(formatMarkdownTableAtSelectionBlock)}
            className="rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Format table"
          >
            Fmt Tbl
          </button>
          <button type="button" onClick={() => applyPatch(insertWikilink)} className="rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground" title="Wikilink">
            [[ ]]
          </button>
          <button type="button" onClick={() => applyPatch((text, from, to) => prefixSelectionLines(text, from, to, (line) => `> ${line}`))} className={TOOLBAR_BTN} title="Quote">
            <Quote className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => applyPatch((text, from, to) => prefixSelectionLines(text, from, to, (line) => `- ${line}`))} className={TOOLBAR_BTN} title="Bullet list">
            <List className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => applyPatch((text, from, to) => prefixSelectionLines(text, from, to, (line, i) => `${i + 1}. ${line}`))} className={TOOLBAR_BTN} title="Numbered list">
            <ListOrdered className="h-4 w-4" />
          </button>
          <MarkdownTableOfContentsBlock
            content={value}
            currentLine={currentCursorLine}
            compact={compactMobile}
            onSelectHeading={(heading) => jumpToHeadingLine(heading.line)}
          />
          <button type="button" onClick={undoEditor} className={TOOLBAR_BTN} title="Undo">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={redoEditor} className={TOOLBAR_BTN} title="Redo">
            <RotateCw className="h-4 w-4" />
          </button>
          {(enableAiAssist || supportsMindmap) && (
            <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          )}
          {enableAiAssist && (
            <button
              type="button"
              onClick={toggleAiPanel}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
                aiPanelOpen && 'bg-muted text-foreground',
              )}
              title={aiPanelOpen ? 'Hide AI tools' : 'Show AI tools'}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI
            </button>
          )}
          {supportsMindmap && (
            <button
              type="button"
              onClick={toggleMindmapPanel}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
                mindmapPanelOpen && 'bg-muted text-foreground',
              )}
              title={mindmapPanelOpen ? 'Hide mindmap tools' : 'Show mindmap tools'}
            >
              <Workflow className="h-3.5 w-3.5" />
              Mindmap
            </button>
          )}
        </div>
      )}

      <MarkdownMindmapPanelBlock
        inputPath={normalizedPath}
        content={value}
        open={supportsMindmap && mindmapPanelOpen}
      />

      {enableAiAssist && aiPanelOpen && (
        <div className="space-y-3 border-b border-border/30 bg-muted/[0.08] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/70 px-2 py-1">
            {selectedProvider && selectedModel ? (
              <div className="inline-flex min-w-0 items-center gap-1">
                <Select
                  value={selectedProvider}
                  onValueChange={(value) => setSelectedProvider(value as AiProvider)}
                  disabled={aiSelectionLoading || aiAssistDisabled}
                >
                  <SelectTrigger className="h-6 min-w-0 w-auto max-w-[12rem] border-0 bg-transparent px-0 py-0 text-xs shadow-none ring-offset-0 focus:ring-0 focus:ring-offset-0">
                    <SelectValue placeholder={selectedProvider} />
                  </SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((providerOption) => (
                      <SelectItem
                        key={providerOption.provider}
                        value={providerOption.provider}
                        className="text-xs"
                        disabled={!providerOption.available}
                      >
                        {providerOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-foreground">/</span>
                <span className="max-w-[12rem] truncate text-xs text-foreground">{selectedModel}</span>
              </div>
            ) : (
              <span className="text-xs text-foreground">No AI provider</span>
            )}
            <span className={cn(
              'text-xs',
              aiStateBusy ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
            )}>
              {`State: ${aiStateLabel}`}
            </span>
            {showThinkToggle && (
              <label className="ml-auto inline-flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Think</span>
                <Switch
                  checked={!!thinkEnabled}
                  onCheckedChange={(checked) => setThinkEnabled(checked)}
                  disabled={aiSelectionLoading || aiAssistDisabled}
                  className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span[data-state=checked]]:translate-x-4"
                />
              </label>
            )}
            {assistResultPill && (
              <span className={cn(
                'inline-flex h-8 items-center rounded-md border px-2 text-xs',
                assistResultPill.tone === 'success' && 'border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
                assistResultPill.tone === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
                assistResultPill.tone === 'neutral' && 'border-border/60 bg-background text-muted-foreground',
              )}>
                {assistResultPill.text}
              </span>
            )}
          </div>

          {aiStewardEnabled && (
            <>
              <div className="h-px bg-border/50" />
              <AiStewardPanelBlock
                filePath={stewardFilePath}
                disabled={aiAssistDisabled}
                onApplySuggestion={onAiStewardApplySuggestion}
                onRunningChange={setStewardRunning}
              />
            </>
          )}

          {relatedThoughtsEnabled && (
            <>
              <div className="h-px bg-border/50" />
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">
                  AI suggested related thoughts
                </div>
                <button
                  type="button"
                  onClick={() => setRelatedThoughtsOpen((prev) => !prev)}
                  className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
                >
                  {relatedThoughtsOpen ? 'Hide related thoughts' : 'Show related thoughts'}
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                Related thoughts are surfaced via lexical similarity from your thought cache.
              </div>
              {relatedThoughtsOpen && (
                <RelatedThoughtsPanelBlock
                  text={value}
                  enabled={enableAiAssist && aiPanelOpen}
                  disabled={aiAssistDisabled}
                  sourceFilePath={relatedSourceFilePath || undefined}
                  limit={relatedThoughtsLimit}
                  minChars={relatedThoughtsMinChars}
                  showTitle={false}
                  onOpenPath={onRelatedThoughtOpenPath}
                  onOpenPathInNewTab={onRelatedThoughtOpenPathInNewTab}
                />
              )}
            </>
          )}

          <div className="h-px bg-border/50" />
          <AiAssistControlsBlock
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            runningAction={assistRunningAction}
            loading={aiSelectionLoading}
            disabled={aiAssistDisabled || inlineDiffSession != null}
            onRun={(action) => { void runAssistAction(action, value) }}
            onRunCustomPrompt={(prompt) => {
              void (async () => {
                const result = await runAssistAction('custom', value, prompt)
                if (!result || !result.changed) return
                applyAssistSuggestion((next) => {
                  onChange(next)
                })
              })()
            }}
            promptHistory={customPromptHistory}
            statusPill={assistResultPill}
            helperText={aiAssistHelperText}
            inlineReviewActionsSlot={inlineDiffRender ? (
              <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  Inline review active in editor:
                  {' '}
                  <span className="text-foreground">pending {inlineDiffRender.summary.pending}</span>
                  {' • '}
                  <span className="text-foreground">accepted {inlineDiffRender.summary.accepted}</span>
                  {' • '}
                  <span className="text-foreground">rejected {inlineDiffRender.summary.rejected}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={acceptAllInlineDiffHunks}
                    className="inline-flex h-8 items-center rounded-md border border-emerald-500/50 bg-emerald-500/10 dark:bg-emerald-500/20 px-3 text-xs text-emerald-700 dark:text-emerald-300"
                  >
                    Accept all
                  </button>
                  <button
                    type="button"
                    onClick={rejectAllInlineDiffHunks}
                    className="inline-flex h-8 items-center rounded-md border border-destructive/50 bg-destructive/10 px-3 text-xs text-destructive"
                  >
                    Reject all
                  </button>
                  <button
                    type="button"
                    onClick={discardRejectedAndAcceptRemainingInlineDiffHunks}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted"
                  >
                    Discard rejected + accept remaining
                  </button>
                  <button
                    type="button"
                    onClick={finishInlineDiffReview}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted"
                  >
                    Finish review
                  </button>
                  <button
                    type="button"
                    onClick={cancelInlineDiffReview}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted"
                  >
                    Cancel and restore original
                  </button>
                </div>
              </div>
            ) : null}
          />

          {assistSuggestion && (
            <AiAssistReviewBlock
              suggestion={assistSuggestion}
              onStartInlineApply={startInlineDiffReview}
              onApply={(nextContent) => {
                applyAssistSuggestion((next) => {
                  onChange(next)
                }, nextContent)
              }}
              onDiscard={dismissAssistSuggestion}
            />
          )}

          {assistError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {assistError}
            </div>
          )}
        </div>
      )}

      <div className={cn('ltm-markdown-rich-editor-surface flex min-h-0 flex-1 flex-col overflow-hidden', editorCanvasClassName, editorClassName)}>
        <CodeMirror
          value={value}
          height="100%"
          theme={resolvedColorMode === 'dark' ? 'dark' : 'light'}
          className={cn('h-full', editorCanvasClassName)}
          basicSetup={{
            lineNumbers: !isIphoneRuntime && !proseEditing,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            foldGutter: !isIphoneRuntime && !proseEditing,
            dropCursor: false,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            highlightSelectionMatches: true,
          }}
          extensions={extensions}
          onCreateEditor={(view) => {
            editorViewRef.current = view
            const hint = initialCursorHint
            if (hint && (hint.after || hint.before)) {
              const source = view.state.doc.toString()
              let anchor = -1
              const tryFind = (needle: string): number => {
                const trimmed = needle.trim()
                if (trimmed.length < 3) return -1
                return source.indexOf(trimmed)
              }
              anchor = tryFind(hint.after)
              if (anchor < 0 && hint.after.trim().length >= 12) {
                anchor = tryFind(hint.after.trim().slice(0, 12))
              }
              if (anchor < 0) {
                const beforeIdx = tryFind(hint.before)
                if (beforeIdx >= 0) anchor = beforeIdx + hint.before.trim().length
              }
              if (anchor >= 0) {
                view.dispatch({
                  selection: { anchor },
                  effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
                })
                view.focus()
              }
            }
            setCurrentCursorLine(view.state.doc.lineAt(view.state.selection.main.head).number)
          }}
          onChange={handleEditorChange}
        />
      </div>

      {contextMenuState && (
        <ContextMenuBlock
          position={{ x: contextMenuState.x, y: contextMenuState.y }}
          onClose={() => setContextMenuState(null)}
          entries={[
            {
              key: 'cut',
              label: 'Cut',
              disabled: !contextMenuState.hasSelection,
              onClick: () => {
                const view = editorViewRef.current
                if (!view) return
                const { from, to } = view.state.selection.main
                const text = view.state.sliceDoc(from, to)
                void navigator.clipboard.writeText(text).catch(() => {})
                view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } })
                view.focus()
              },
            },
            {
              key: 'copy',
              label: 'Copy',
              disabled: !contextMenuState.hasSelection,
              onClick: () => {
                const view = editorViewRef.current
                if (!view) return
                const { from, to } = view.state.selection.main
                void navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(() => {})
              },
            },
            {
              key: 'paste',
              label: 'Paste',
              onClick: () => {
                const view = editorViewRef.current
                if (!view) return
                void navigator.clipboard.readText().then((text) => {
                  const { from, to } = view.state.selection.main
                  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
                  view.focus()
                }).catch(() => {})
              },
            },
            { key: 'sep1', kind: 'separator' },
            {
              key: 'bold',
              label: 'Bold',
              onClick: () => applyPatch((text, from, to) => wrapSelection(text, from, to, '**', '**', 'bold text')),
            },
            {
              key: 'italic',
              label: 'Italic',
              onClick: () => applyPatch((text, from, to) => wrapSelection(text, from, to, '*', '*', 'italic text')),
            },
            {
              key: 'code',
              label: 'Inline Code',
              onClick: () => applyPatch((text, from, to) => wrapSelection(text, from, to, '`', '`', 'code')),
            },
            {
              key: 'link',
              label: 'Insert Link',
              onClick: () => applyPatch((text, from, to) => wrapSelection(text, from, to, '[', '](https://)', 'link text')),
            },
            {
              key: 'wikilink',
              label: 'Insert Wikilink',
              onClick: () => applyPatch(insertWikilink),
            },
          ] satisfies ContextMenuEntryBlock[]}
        />
      )}

      {wikilinkPickerOpen && (
        <div className="pointer-events-none absolute inset-x-3 top-2 z-40">
          <div className="pointer-events-auto ml-auto w-full max-w-xl rounded-lg border border-border/60 bg-background/95 p-2 shadow-2xl backdrop-blur">
            <UniversalSearchBlock<WikilinkSuggestionBlock>
              {...UNIVERSAL_SEARCH_DROPDOWN_PRESET_BLOCK}
              items={wikilinkSuggestions}
              query={wikilinkQuery}
              onQueryChange={applyWikilinkQuery}
              onSelect={applyWikilinkSuggestion}
              getItemKey={(item) => `${item.path}::${item.target}`}
              getItemLabel={(item) => deriveWikilinkLabelBlock(item.target, null)}
              getItemDescription={(item) => item.path}
              getItemSearchCandidates={(item) => [item.target, item.path, deriveWikilinkLabelBlock(item.target, null)]}
              selectedItemKey={null}
              open={wikilinkPickerOpen}
              onOpenChange={(open) => {
                setWikilinkPickerOpen(open)
                if (!open) editorViewRef.current?.focus()
              }}
              onEscapeKeyDown={() => editorViewRef.current?.focus()}
              placeholder="Link a note..."
              emptyMessage={
                wikilinkLoading
                  ? 'Searching notes...'
                  : (UNIVERSAL_SEARCH_DROPDOWN_PRESET_BLOCK.emptyMessage ?? 'No matches found.')
              }
            />
          </div>
        </div>
      )}
    </div>
  )
})

// Memo so tab-switch re-renders of the host page don't re-run the editor
// when its props haven't actually changed. Combined with stable callback
// props at the call site, this avoids CodeMirror's measure→paint→remeasure
// cycle (~600ms) from firing on every parent render.
const MarkdownRichEditorBlock = memo(MarkdownRichEditorBlockInner)
export default MarkdownRichEditorBlock
