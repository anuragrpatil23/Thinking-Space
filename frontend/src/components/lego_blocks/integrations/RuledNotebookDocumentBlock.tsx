import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, ChevronLeft, ChevronRight, Eraser, List, Loader2, Pencil, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  markdownMathRehypePluginsBlock,
  markdownMathRemarkPluginsBlock,
} from '@/services/lego_blocks/integrations/markdownMathPluginsBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import TikzDiagramBlock from '@/components/lego_blocks/units/TikzDiagramBlock'
import { cn } from '@/lib/utils'
import { splitFrontmatter } from '@/components/lego_blocks/units/MarkdownDocumentContentBlock'
import { readMarkdownDocument, saveMarkdownDocument } from '@/services/orchestrators/markdownDocumentsOrch'
import {
  splitMarkdownIntoBlocksBlock,
  paginateBlocksByHeightBlock,
  type RuledNotebookPageBlock,
} from '@/services/lego_blocks/units/ruledNotebookPaginationBlock'
import { assignOutlineLabelsBlock } from '@/services/lego_blocks/units/outlineCounterBlock'
import { useRouteActivityBlock } from '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
import { useReadingAttentionBlock } from '@/components/lego_blocks/hooks/shared/useReadingAttentionBlock'
import { resolveFrontmatterDatesBlock } from '@/services/lego_blocks/units/frontmatterDatesBlock'
import { appendMemorizedSessionInPlace } from '@/services/lego_blocks/units/memorizedSessionsBlock'
import {
  joinInkFencedBlock,
  splitInkFencedBlock,
} from '@/services/lego_blocks/units/inkFencedBlock'
import {
  buildAnchorForBlockIndex,
  resolveInkAnchorsBlock,
} from '@/services/lego_blocks/units/inkAnchorBlock'
import {
  createInkStrokeIdBlock,
  type InkStroke,
} from '@/services/lego_blocks/units/inkStrokeBlock'
import InkOverlayBlock, {
  type InkOverlayMode,
  type InkStrokeDraft,
  type RenderableInkStroke,
} from '@/components/lego_blocks/integrations/InkOverlayBlock'
import ExcalidrawPenPaletteBlock from '@/components/lego_blocks/integrations/ExcalidrawPenPaletteBlock'
import {
  EXCALIDRAW_HIGHLIGHTER_PRESETS_ORCH,
  loadExcalidrawHighlighterPresetsOrch,
  type ExcalidrawHighlighterPresetBlock,
} from '@/services/orchestrators/excalidrawHighlighterOrch'
import {
  FREEHAND_PEN_ID,
  getDefaultExcalidrawPenDefaultsOrch,
  readAllExcalidrawPerPresetSettingsOrch,
  readExcalidrawActivePresetIdOrch,
  readExcalidrawPenDefaultsOrch,
  writeAllExcalidrawPerPresetSettingsOrch,
  writeExcalidrawActivePresetIdOrch,
  writeExcalidrawPenDefaultsOrch,
  type ExcalidrawPenDefaultsOrch,
} from '@/services/orchestrators/excalidrawPenDefaultsOrch'

interface RuledNotebookDocumentBlockProps {
  path: string
  onClose?: () => void
  className?: string
  topBarHidden?: boolean
}

type TransitionKind = 'idle' | 'page-over' | 'page-slide'
interface TransitionState {
  kind: Exclude<TransitionKind, 'idle'>
  direction: 'forward' | 'backward'
  fromIndex: number
  toIndex: number
}

const PAGE_TURN_MS = 640
// Opening a ruled notebook auto-starts a memorization session; it only counts
// once the document has been open for at least this long. Anything shorter is
// treated as a passing glance and never written (avoids YAML churn).
const MEMORIZE_MIN_MS = 10 * 60_000
const REMARK_PLUGINS = [remarkGfm, ...markdownMathRemarkPluginsBlock]
const REHYPE_PLUGINS = markdownMathRehypePluginsBlock as any

const MARKDOWN_COMPONENTS = {
  code: ({ className, children, ...props }: any) => {
    const lang = /language-(\w+)/.exec(className || '')?.[1]
    if (lang === 'tikz') {
      const source = Array.isArray(children) ? children.join('') : String(children ?? '')
      return <TikzDiagramBlock source={source.replace(/\n$/, '')} />
    }
    return <code className={className} {...props}>{children}</code>
  },
} as const

function colorWithOpacity(color: string, opacity: number): string {
  const alpha = Math.min(Math.max(Math.round(opacity), 1), 100) / 100
  if (alpha >= 1) return color
  const hex = color.replace('#', '')
  if (hex.length !== 6) return color
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  if ([r, g, b].some((n) => !Number.isFinite(n))) return color
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function leafNameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? path : path.slice(idx + 1)
}

function sideOf(index: number): 'right' | 'left' {
  // Page 1 (index 0) is the cover/right page. Even indices → right, odd → left.
  return index % 2 === 0 ? 'right' : 'left'
}

interface PageFaceInkProps {
  enabled: boolean
  mode: InkOverlayMode
  /* Strokes that anchor to one of this page's blocks. Index in the tuple
     is local to this page (0..page.blocks.length-1). */
  pageStrokes: Array<{ stroke: InkStroke; pageBlockIndex: number }>
  onStrokeCommit: (params: { draft: InkStrokeDraft; pageBlockIndex: number }) => void
  onStrokesErase: (strokeIds: string[]) => void
  penColor: string
  penWidth: number
  pressureSensitive: boolean
}

interface PageFaceProps {
  page: RuledNotebookPageBlock | null
  index: number
  title: string
  className?: string
  /* Optional date jotted into the page-1 left margin (the column to the left of the red rule). */
  marginDate?: string | null
  ink?: PageFaceInkProps
}

function PageFace({ page, index, title, className, marginDate, ink }: PageFaceProps) {
  const side = sideOf(index)
  const paperRef = useRef<HTMLDivElement | null>(null)
  const blockRefs = useRef<Array<HTMLDivElement | null>>([])
  const [layoutVersion, setLayoutVersion] = useState(0)

  useLayoutEffect(() => {
    blockRefs.current = blockRefs.current.slice(0, page?.blocks.length ?? 0)
    setLayoutVersion((version) => version + 1)
  }, [page])

  const getBlockRectLocal = useCallback((blockIdx: number) => {
    const blockEl = blockRefs.current[blockIdx]
    const paperEl = paperRef.current
    if (!blockEl || !paperEl) return null
    const b = blockEl.getBoundingClientRect()
    const p = paperEl.getBoundingClientRect()
    return { left: b.left - p.left, top: b.top - p.top, width: b.width, height: b.height }
  }, [])

  const renderableStrokes = useMemo<RenderableInkStroke[]>(() => {
    if (!ink) return []
    return ink.pageStrokes.map(({ stroke, pageBlockIndex }) => ({
      stroke,
      blockRect: getBlockRectLocal(pageBlockIndex),
    }))
    /* getBlockRectLocal is stable; we intentionally recompute rects on
       every render of the parent (e.g., after resize) by reading refs. */
  }, [ink, getBlockRectLocal, layoutVersion])

  const hitTestBlock = useCallback((x: number, y: number) => {
    /* Two-pass: first try direct hit (point inside a block). If the user
       drew in a margin, on whitespace between blocks, or below the last
       block, fall back to the block closest by vertical distance — that
       way annotations work anywhere on the page, not just on text. */
    let bestIdx = -1
    let bestRect: { left: number; top: number; width: number; height: number } | null = null
    let bestDist = Infinity
    for (let i = 0; i < blockRefs.current.length; i++) {
      const rect = getBlockRectLocal(i)
      if (!rect) continue
      if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) {
        return { blockIndex: i, blockRect: rect }
      }
      const centerY = rect.top + rect.height / 2
      const dist = Math.abs(y - centerY)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
        bestRect = rect
      }
    }
    if (bestIdx >= 0 && bestRect) {
      return { blockIndex: bestIdx, blockRect: bestRect }
    }
    return null
  }, [getBlockRectLocal])

  if (!page) return null
  return (
    <div
      className={cn(
        'ltm-ruled-notebook-page-frame',
        side === 'right' ? 'ltm-ruled-notebook-page-right' : 'ltm-ruled-notebook-page-left',
        className,
      )}
    >
      <div className="ltm-ruled-notebook-page-meta">
        <span>{title}</span>
        <span>Page {index + 1}</span>
      </div>
      <div ref={paperRef} className="ltm-ruled-notebook-paper relative">
        {marginDate ? (
          <div className="ltm-ruled-notebook-margin-date" aria-label={`Created ${marginDate}`}>
            {marginDate}
          </div>
        ) : null}
        <div className="ltm-ruled-notebook-content">
          {page.blocks.map((block, blockIdx) => (
            <div
              key={blockIdx}
              ref={(el) => { blockRefs.current[blockIdx] = el }}
              data-block-idx={blockIdx}
            >
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>{block.source}</ReactMarkdown>
            </div>
          ))}
        </div>
        {ink ? (
          <InkOverlayBlock
            enabled={ink.enabled}
            mode={ink.mode}
            renderableStrokes={renderableStrokes}
            hitTestBlock={hitTestBlock}
            onStrokeCommit={(draft) => ink.onStrokeCommit({ draft, pageBlockIndex: draft.blockIndex })}
            onStrokesErase={ink.onStrokesErase}
            penColor={ink.penColor}
            penWidth={ink.penWidth}
            pressureSensitive={ink.pressureSensitive}
          />
        ) : null}
      </div>
      <div className="ltm-ruled-notebook-footer">
        <span>{side}</span>
        <span>{index + 1}</span>
      </div>
    </div>
  )
}

export default function RuledNotebookDocumentBlock({
  path,
  onClose,
  className,
  topBarHidden = false,
}: RuledNotebookDocumentBlockProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The ruled notebook is a reading surface in its own right — paginated, ink
  // annotations, the thing you actually sit with — and it does NOT render
  // through MarkdownDocumentBlock, so instrumenting that block left this one
  // measuring nothing at all. It is always the foreground pane when mounted
  // (the orchestrator renders it *instead of* the inline document), so
  // `attending` is just "loaded and not broken"; the arbiter settles the rest.
  // ...but the whole surface stays mounted behind `visibility: hidden` when
  // you navigate to another tab, so "mounted" is not "on screen" and the
  // route's own activity has to be part of the predicate too.
  const surfaceVisible = useRouteActivityBlock()
  const readingSurfaceRef = useRef<HTMLElement | null>(null)
  useReadingAttentionBlock(path, surfaceVisible && !loading && error === null, {
    surfaceRef: readingSurfaceRef,
    inputs: { surfaceVisible, loading, errored: error !== null },
  })
  const [pageIndex, setPageIndex] = useState(0)
  const [transition, setTransition] = useState<TransitionState | null>(null)
  const [pages, setPages] = useState<RuledNotebookPageBlock[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [createdSeconds, setCreatedSeconds] = useState<number | null>(null)
  const [inkStrokes, setInkStrokes] = useState<InkStroke[]>([])
  const [tool, setTool] = useState<'off' | 'pen' | 'eraser'>('off')
  const [penDefaults, setPenDefaults] = useState<ExcalidrawPenDefaultsOrch>(() => getDefaultExcalidrawPenDefaultsOrch())
  const [presets, setPresets] = useState<readonly ExcalidrawHighlighterPresetBlock[]>(EXCALIDRAW_HIGHLIGHTER_PRESETS_ORCH)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [perPresetSettings, setPerPresetSettings] = useState<Record<string, ExcalidrawPenDefaultsOrch>>({})
  const baseMtimeRef = useRef<number>(0)
  const saveTimerRef = useRef<number | null>(null)

  const paperMeasureRef = useRef<HTMLDivElement | null>(null)
  const blocksMeasureRef = useRef<HTMLDivElement | null>(null)

  const pageTitle = useMemo(() => leafNameOf(path).replace(/\.md$/i, ''), [path])

  /* Created date, jotted in the left-hand margin of page 1 — same way a kid would
     write the date at the top-left of their notebook. Prefer YAML frontmatter
     (`created_at`/`created`/…) so iCloud-mirrored ctime collisions don't matter. */
  const createdLabel = useMemo(() => {
    if (content === null) return null
    const { created } = resolveFrontmatterDatesBlock(content, { ctimeSeconds: createdSeconds })
    if (!created) return null
    return created.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
  }, [content, createdSeconds])

  /* Strip the trailing ```ink``` annotation block before any other parsing —
     it isn't prose and should never be rendered as markdown or paginated. */
  const renderableContent = useMemo(() => {
    if (content === null) return null
    return splitInkFencedBlock(content).body
  }, [content])

  const blocks = useMemo(() => {
    if (renderableContent === null) return []
    const { body } = splitFrontmatter(renderableContent)
    return splitMarkdownIntoBlocksBlock(body)
  }, [renderableContent])

  /* Map each stroke to its current global block index using the resolver.
     `null` blockIndex = orphan (anchor text disappeared). */
  const inkResolutions = useMemo(() => {
    if (inkStrokes.length === 0) return new Map<string, number | null>()
    const blockTexts = blocks.map((b) => b.source)
    const resolved = resolveInkAnchorsBlock(inkStrokes, { blockTexts })
    const out = new Map<string, number | null>()
    for (const r of resolved) out.set(r.strokeId, r.blockIndex)
    return out
  }, [inkStrokes, blocks])

  useLayoutEffect(() => {
    if (blocks.length === 0) {
      setPages([{ index: 0, source: '', blocks: [] }])
      return
    }
    const paperEl = paperMeasureRef.current
    const blocksEl = blocksMeasureRef.current
    if (!paperEl || !blocksEl) return

    const compute = () => {
      const paperPx = paperEl.clientHeight
      if (!paperPx) return
      const contentStyle = window.getComputedStyle(blocksEl)
      const lineHeightPx = parseFloat(contentStyle.lineHeight || '0') || 0
      // Keep pagination slightly conservative so subpixel line boxes and
      // font-rendering differences do not push the final live lines below the
      // paper's clipping edge.
      const pageBudgetPx = Math.max(0, paperPx - Math.max(4, Math.round(lineHeightPx * 0.35)))
      const blockEls = Array.from(blocksEl.children) as HTMLElement[]
      const heights = blockEls.map((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        const marginBottom = parseFloat(style.marginBottom || '0') || 0
        return rect.height + marginBottom
      })
      setPages(paginateBlocksByHeightBlock(blocks, heights, pageBudgetPx))
    }

    compute()
    const ro = new ResizeObserver(() => compute())
    ro.observe(paperEl)
    ro.observe(blocksEl)
    return () => ro.disconnect()
  }, [blocks])

  // Walk paginated blocks to extract headings + the page each one lives on.
  const tocItems = useMemo(() => {
    const items: Array<{ id: string; title: string; level: number; pageIndex: number; label: string }> = []
    pages.forEach((page, pIdx) => {
      page.blocks.forEach((block, bIdx) => {
        if (block.kind !== 'heading') return
        const match = block.source.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/m)
        if (!match) return
        const level = match[1].length
        const title = match[2].trim()
        if (!title) return
        items.push({ id: `${pIdx}-${bIdx}-${level}-${title.toLowerCase()}`, title, level, pageIndex: pIdx, label: '' })
      })
    })
    const labels = assignOutlineLabelsBlock(items.map((item) => item.level))
    return items.map((item, idx) => ({ ...item, label: labels[idx] }))
  }, [pages])

  const currentPage = pages[pageIndex] ?? null
  const hasPrev = pageIndex > 0
  const hasNext = pageIndex < pages.length - 1
  const currentSide = sideOf(pageIndex)

  const transitionKind: TransitionKind = transition?.kind ?? 'idle'
  const transitionDirection = transition?.direction ?? 'forward'
  const outgoingPage = transition ? pages[transition.fromIndex] ?? null : null
  const peekIndex = hasNext ? pageIndex + 1 : null
  const peekPage = peekIndex !== null ? pages[peekIndex] ?? null : null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPageIndex(0)
    setTransition(null)

    const load = async () => {
      try {
        const document = await readMarkdownDocument(path, { includeHash: false })
        if (!cancelled) {
          const { strokes } = splitInkFencedBlock(document.content)
          setContent(document.content)
          setInkStrokes(strokes)
          baseMtimeRef.current = document.mtime
          setCreatedSeconds(document.ctime ?? null)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load markdown file.')
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    if (!onClose) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /* While the ruled notebook is on screen, suppress chrome from any
     Excalidraw canvases mounted in background tabs (iPad/mobile-mode Excalidraw
     renders a fixed bottom toolbar that bleeds through when its tab isn't the
     active one). Scoped to a body class so it only affects this view. */
  useEffect(() => {
    document.body.classList.add('ltm-ruled-notebook-active')
    return () => document.body.classList.remove('ltm-ruled-notebook-active')
  }, [])

  useEffect(() => {
    if (!transition) return
    const timeout = window.setTimeout(() => setTransition(null), PAGE_TURN_MS)
    return () => window.clearTimeout(timeout)
  }, [transition])

  /* Debounced persist: write the .md with the current ink fence whenever
     `inkStrokes` changes. We rebuild from `renderableContent` (body without
     any existing fence) so we never accidentally nest fences. */
  const scheduleInkSave = useCallback((nextStrokes: InkStroke[]) => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      saveTimerRef.current = null
      if (content === null) return
      const body = splitInkFencedBlock(content).body
      const next = joinInkFencedBlock(body, nextStrokes)
      if (next === content) return
      try {
        const result = await saveMarkdownDocument({
          path,
          content: next,
          baseMtime: baseMtimeRef.current,
          baseContent: content,
        })
        baseMtimeRef.current = result.mtime
        setContent(next)
      } catch (err) {
        /* Conflict / IO error: surface in console for now; pen mode stays
           on, user can retry by drawing again. Avoid a noisy toast for v1. */
        console.warn('[ruled-notebook] ink save failed', err)
      }
    }, 600)
  }, [content, path])

  const handleStrokeCommit = useCallback<(params: {
    draft: InkStrokeDraft
    pageBlockIndex: number
    pageStartGlobalBlockIdx: number
  }) => void>((params) => {
    const { draft, pageBlockIndex, pageStartGlobalBlockIdx } = params
    const globalIdx = pageStartGlobalBlockIdx + pageBlockIndex
    const blockTexts = blocks.map((b) => b.source)
    if (globalIdx < 0 || globalIdx >= blockTexts.length) return
    const { anchorText, anchorContext } = buildAnchorForBlockIndex(blockTexts, globalIdx)
    const stroke: InkStroke = {
      id: createInkStrokeIdBlock(),
      anchorText,
      anchorContext,
      type: 'freedraw',
      x: draft.x,
      y: draft.y,
      width: draft.width,
      height: draft.height,
      points: draft.points,
      pressures: draft.pressures,
      simulatePressure: draft.simulatePressure,
      strokeColor: colorWithOpacity(penDefaults.strokeColor, penDefaults.opacity),
      strokeWidth: penDefaults.strokeWidth,
      opacity: penDefaults.opacity,
      createdAt: Date.now(),
    }
    setInkStrokes((prev) => {
      const next = [...prev, stroke]
      scheduleInkSave(next)
      return next
    })
  }, [blocks, scheduleInkSave, penDefaults])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
  }, [])

  /* Memorization is measured in ACTIVE time, not wall-clock-since-open: we only
     accumulate while this window is focused + visible, so a notebook left open
     in the background (or forgotten for days) doesn't inflate the session.
     - firstActive: when reading actually began (anchors the recorded start).
     - activeMs: total focused time accumulated so far.
     - segmentStart: Date.now() of the current active stretch, or null when paused. */
  const memorizeFirstActiveRef = useRef<Date | null>(null)
  const activeMsRef = useRef(0)
  const segmentStartRef = useRef<number | null>(null)

  const pauseMemorizeActive = useCallback(() => {
    if (segmentStartRef.current !== null) {
      activeMsRef.current += Date.now() - segmentStartRef.current
      segmentStartRef.current = null
    }
  }, [])

  const resumeMemorizeActive = useCallback(() => {
    if (segmentStartRef.current !== null) return
    // Visibility is the reliable cross-platform signal — it fires on iPad/iOS
    // (background, tab switch, screen lock) where window focus events are flaky.
    // Desktop app-switching (window stays visible but loses focus) is covered by
    // the explicit blur/focus listeners, which pause/resume directly.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    segmentStartRef.current = Date.now()
    if (memorizeFirstActiveRef.current === null) memorizeFirstActiveRef.current = new Date()
  }, [])

  const commitMemorizedSession = useCallback(async () => {
    if (content === null) return
    pauseMemorizeActive() // flush the in-flight active stretch
    const activeMs = activeMsRef.current
    const firstActive = memorizeFirstActiveRef.current
    activeMsRef.current = 0
    memorizeFirstActiveRef.current = null
    // Only a real sitting counts — ignore anything under the active threshold.
    if (firstActive === null || activeMs < MEMORIZE_MIN_MS) return
    // Record a contiguous block whose duration equals the active time read.
    const endedAt = new Date(firstActive.getTime() + activeMs)
    const next = appendMemorizedSessionInPlace(content, firstActive, endedAt)
    if (next === null) return
    try {
      const result = await saveMarkdownDocument({
        path,
        content: next,
        baseMtime: baseMtimeRef.current,
        baseContent: content,
      })
      baseMtimeRef.current = result.mtime
      setContent(next)
    } catch (err) {
      console.warn('[ruled-notebook] memorized session save failed', err)
    }
  }, [content, path, pauseMemorizeActive])

  const commitMemorizedSessionRef = useRef(commitMemorizedSession)
  useEffect(() => { commitMemorizedSessionRef.current = commitMemorizedSession }, [commitMemorizedSession])

  /* Auto-record: being in the ruled-notebook view IS the memorization session.
     Opening a document starts active-time tracking; focus/visibility changes
     pause and resume it so background time doesn't count; closing the document
     (unmount) or switching to another one commits the sitting into
     `memorized_sessions` YAML. No manual toggle. Sub-threshold sittings are
     dropped in the commit. */
  useEffect(() => {
    activeMsRef.current = 0
    memorizeFirstActiveRef.current = null
    segmentStartRef.current = null
    resumeMemorizeActive()

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pauseMemorizeActive()
      else resumeMemorizeActive()
    }
    window.addEventListener('focus', resumeMemorizeActive)
    window.addEventListener('blur', pauseMemorizeActive)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('focus', resumeMemorizeActive)
      window.removeEventListener('blur', pauseMemorizeActive)
      document.removeEventListener('visibilitychange', onVisibility)
      void commitMemorizedSessionRef.current()
    }
  }, [path, pauseMemorizeActive, resumeMemorizeActive])

  /* Mount-once: load persisted pen settings + Obsidian-shared highlighter
     presets. Failures fall back to built-in defaults silently. */
  useEffect(() => {
    setPenDefaults(readExcalidrawPenDefaultsOrch())
    setActivePresetId(readExcalidrawActivePresetIdOrch())
    setPerPresetSettings(readAllExcalidrawPerPresetSettingsOrch())
    let cancelled = false
    void loadExcalidrawHighlighterPresetsOrch().then((p) => {
      if (!cancelled && p.length > 0) setPresets(p)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const handlePenDefaultsChange = useCallback((next: ExcalidrawPenDefaultsOrch) => {
    setPenDefaults(next)
    writeExcalidrawPenDefaultsOrch(next)
    if (activePresetId && activePresetId !== FREEHAND_PEN_ID) {
      setPerPresetSettings((prev) => {
        const merged = { ...prev, [activePresetId]: next }
        writeAllExcalidrawPerPresetSettingsOrch(merged)
        return merged
      })
    }
  }, [activePresetId])

  const handleStrokeWidthChange = useCallback((width: number) => {
    handlePenDefaultsChange({ ...penDefaults, strokeWidth: width })
  }, [handlePenDefaultsChange, penDefaults])

  const applyHighlighterPreset = useCallback((presetId: string) => {
    setActivePresetId(presetId)
    writeExcalidrawActivePresetIdOrch(presetId)
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) return
    const stored = perPresetSettings[presetId]
    const presetColor = preset.backgroundColor !== 'transparent' ? preset.backgroundColor : preset.strokeColor
    const next: ExcalidrawPenDefaultsOrch = stored ?? {
      strokeColor: presetColor !== 'transparent' ? presetColor : penDefaults.strokeColor,
      strokeWidth: preset.strokeWidth > 0 ? preset.strokeWidth : penDefaults.strokeWidth,
      opacity: preset.opacity,
      pressureSensitive: penDefaults.pressureSensitive,
    }
    setPenDefaults(next)
    writeExcalidrawPenDefaultsOrch(next)
  }, [presets, perPresetSettings, penDefaults])

  const handleStrokesErase = useCallback((strokeIds: string[]) => {
    if (strokeIds.length === 0) return
    setInkStrokes((prev) => {
      const drop = new Set(strokeIds)
      const next = prev.filter((s) => !drop.has(s.id))
      if (next.length === prev.length) return prev
      scheduleInkSave(next)
      return next
    })
  }, [scheduleInkSave])

  /* For each page, derive the slice of global block indices it covers.
     Pagination is sequential so this is just a prefix sum. */
  const pageStartGlobalBlockIdxByPage = useMemo(() => {
    const out: number[] = []
    let acc = 0
    for (const page of pages) {
      out.push(acc)
      acc += page.blocks.length
    }
    return out
  }, [pages])

  /* Filter strokes to those whose resolved global block index falls in the
     current page's range, expressed as page-local index for PageFace. */
  const buildPageStrokes = useCallback((pageIdx: number) => {
    const start = pageStartGlobalBlockIdxByPage[pageIdx] ?? 0
    const len = pages[pageIdx]?.blocks.length ?? 0
    const out: Array<{ stroke: InkStroke; pageBlockIndex: number }> = []
    for (const stroke of inkStrokes) {
      const gIdx = inkResolutions.get(stroke.id)
      if (gIdx === null || gIdx === undefined) continue
      if (gIdx < start || gIdx >= start + len) continue
      out.push({ stroke, pageBlockIndex: gIdx - start })
    }
    return out
  }, [inkStrokes, inkResolutions, pageStartGlobalBlockIdxByPage, pages])

  const inkPropsForPage = useCallback((pageIdx: number): PageFaceInkProps => ({
    enabled: tool !== 'off',
    mode: tool === 'eraser' ? 'eraser' : 'pen',
    pageStrokes: buildPageStrokes(pageIdx),
    onStrokeCommit: ({ draft, pageBlockIndex }) =>
      handleStrokeCommit({
        draft,
        pageBlockIndex,
        pageStartGlobalBlockIdx: pageStartGlobalBlockIdxByPage[pageIdx] ?? 0,
      }),
    onStrokesErase: handleStrokesErase,
    penColor: penDefaults.strokeColor,
    penWidth: penDefaults.strokeWidth,
    pressureSensitive: penDefaults.pressureSensitive,
  }), [tool, buildPageStrokes, handleStrokeCommit, handleStrokesErase, pageStartGlobalBlockIdxByPage, penDefaults])

  const handleMovePage = useCallback(
    (direction: 'forward' | 'backward') => {
      setPageIndex((current) => {
        const next = direction === 'forward' ? current + 1 : current - 1
        if (next < 0 || next >= pages.length) return current
        // Page-over flip: forward from a right page (even) or backward from a left page (odd) —
        // both turn the same physical sheet over its spine. Otherwise slide to next sheet.
        const kind: Exclude<TransitionKind, 'idle'> =
          (direction === 'forward' && current % 2 === 0)
          || (direction === 'backward' && current % 2 === 1)
            ? 'page-over'
            : 'page-slide'
        setTransition({ kind, direction, fromIndex: current, toIndex: next })
        return next
      })
    },
    [pages.length],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        handleMovePage('forward')
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        handleMovePage('backward')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleMovePage])

  if (loading) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading notebook…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6', className)}>
        <div className="max-w-md rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    )
  }

  return (
    <section
      ref={readingSurfaceRef}
      className={cn('ltm-ruled-notebook-shell flex h-full min-h-0 flex-col', className)}
    >
      {!topBarHidden && (
        <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <BookOpenText className="h-4 w-4" />
              <span>Notebook view</span>
            </div>
            <h2 className="truncate pt-1 text-base font-semibold text-foreground">{pageTitle}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {pageIndex + 1} / {Math.max(pages.length, 1)}
            </span>
            <Button
              variant={tool === 'pen' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool((t) => (t === 'pen' ? 'off' : 'pen'))}
              title={tool === 'pen' ? 'Disable pencil' : 'Annotate with pencil'}
              aria-pressed={tool === 'pen'}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant={tool === 'eraser' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setTool((t) => (t === 'eraser' ? 'off' : 'eraser'))}
              title={tool === 'eraser' ? 'Disable eraser' : 'Erase ink'}
              aria-pressed={tool === 'eraser'}
            >
              <Eraser className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTocOpen((open) => !open)}
              title="Contents"
              disabled={tocItems.length === 0}
              aria-expanded={tocOpen}
            >
              <List className="h-4 w-4" />
            </Button>
            {onClose ? (
              <Button variant="ghost" size="icon" onClick={onClose} title="Close notebook view">
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <div
            className="ltm-ruled-notebook-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.max(pages.length, 1)}
            aria-valuenow={pageIndex + 1}
          >
            <div
              className="ltm-ruled-notebook-progress-fill"
              style={{
                width: `${Math.min(100, ((pageIndex + 1) / Math.max(pages.length, 1)) * 100)}%`,
              }}
            />
          </div>
        </header>
      )}

      {tocOpen && tocItems.length > 0 ? (
        <>
          <button
            type="button"
            aria-label="Close contents"
            className="ltm-ruled-notebook-toc-overlay"
            onClick={() => setTocOpen(false)}
          />
          <aside className="ltm-ruled-notebook-toc-panel" role="dialog" aria-label="Contents">
            <div className="ltm-ruled-notebook-toc-header">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Contents</span>
              <Button variant="ghost" size="icon" onClick={() => setTocOpen(false)} title="Close contents">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ul className="ltm-ruled-notebook-toc-list">
              {tocItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      'ltm-ruled-notebook-toc-item',
                      item.pageIndex === pageIndex && 'ltm-ruled-notebook-toc-item-active',
                    )}
                    style={{ paddingLeft: `${12 + (item.level - 1) * 14}px` }}
                    onClick={() => {
                      setPageIndex(item.pageIndex)
                      setTransition(null)
                      setTocOpen(false)
                    }}
                  >
                    <span className="ltm-ruled-notebook-toc-item-label">{item.label}</span>
                    <span className="ltm-ruled-notebook-toc-item-title">{item.title}</span>
                    <span className="ltm-ruled-notebook-toc-item-page">{item.pageIndex + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={() => handleMovePage('backward')} disabled={!hasPrev}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <div className="text-center text-xs uppercase tracking-[0.22em] text-muted-foreground">
              {currentSide === 'right' ? 'Right Page' : 'Left Page'}
            </div>
            <Button variant="outline" size="sm" onClick={() => handleMovePage('forward')} disabled={!hasNext}>
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>

          <div className="ltm-ruled-notebook-stage">
            {tool === 'pen' ? (
              <ExcalidrawPenPaletteBlock
                presets={presets}
                activePresetId={activePresetId}
                onSelectPreset={applyHighlighterPreset}
                penDefaults={penDefaults}
                onPenDefaultsChange={handlePenDefaultsChange}
                currentStrokeWidth={penDefaults.strokeWidth}
                onStrokeWidthChange={handleStrokeWidthChange}
                perPresetSettings={perPresetSettings}
              />
            ) : null}
            <div className="ltm-ruled-notebook-stack">
              {/* Peek: a slim strip of the next page poking out from the right edge */}
              {peekPage ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    'ltm-ruled-notebook-page-peek',
                    transitionKind === 'page-slide' && transitionDirection === 'forward' && 'ltm-ruled-notebook-page-peek-shift',
                  )}
                />
              ) : null}

              {/* Outgoing layer during slide */}
              {transitionKind === 'page-slide' && outgoingPage ? (
                <PageFace
                  page={outgoingPage}
                  index={transition?.fromIndex ?? pageIndex}
                  title={pageTitle}
                  marginDate={(transition?.fromIndex ?? pageIndex) === 0 ? createdLabel : null}
                  className={cn(
                    'ltm-ruled-notebook-page-layer ltm-ruled-notebook-page-layer-outgoing',
                    transitionDirection === 'forward'
                      ? 'ltm-ruled-notebook-animate-slide-out-forward'
                      : 'ltm-ruled-notebook-animate-slide-out-backward',
                  )}
                />
              ) : null}

              {/* Current page */}
              <PageFace
                page={currentPage}
                index={pageIndex}
                title={pageTitle}
                marginDate={pageIndex === 0 ? createdLabel : null}
                ink={inkPropsForPage(pageIndex)}
                className={cn(
                  'ltm-ruled-notebook-page-layer ltm-ruled-notebook-page-layer-current',
                  transitionKind === 'page-slide' && transitionDirection === 'forward' && 'ltm-ruled-notebook-animate-slide-in-forward',
                  transitionKind === 'page-slide' && transitionDirection === 'backward' && 'ltm-ruled-notebook-animate-slide-in-backward',
                )}
              />

              {/* Turning page on top during page-over: outgoing page flips, revealing the new page beneath */}
              {transitionKind === 'page-over' && outgoingPage ? (
                <PageFace
                  page={outgoingPage}
                  index={transition?.fromIndex ?? pageIndex}
                  title={pageTitle}
                  marginDate={(transition?.fromIndex ?? pageIndex) === 0 ? createdLabel : null}
                  className={cn(
                    'ltm-ruled-notebook-page-layer ltm-ruled-notebook-page-layer-turning',
                    transitionDirection === 'forward'
                      ? 'ltm-ruled-notebook-animate-page-over'
                      : 'ltm-ruled-notebook-animate-page-over-reverse',
                  )}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden measurement layer — same width as the live page so block heights line up. */}
      <div aria-hidden="true" className="ltm-ruled-notebook-measure-host">
        <div className="ltm-ruled-notebook-page-frame ltm-ruled-notebook-page-right">
          <div className="ltm-ruled-notebook-page-meta">
            <span>&nbsp;</span>
            <span>Page 0</span>
          </div>
          <div className="ltm-ruled-notebook-paper" ref={paperMeasureRef}>
            <div className="ltm-ruled-notebook-content" ref={blocksMeasureRef}>
              {blocks.map((block, idx) => (
                <div key={idx} className="ltm-ruled-notebook-measure-block">
                  <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>{block.source}</ReactMarkdown>
                </div>
              ))}
            </div>
          </div>
          <div className="ltm-ruled-notebook-footer">
            <span>right</span>
            <span>0</span>
          </div>
        </div>
      </div>
    </section>
  )
}
