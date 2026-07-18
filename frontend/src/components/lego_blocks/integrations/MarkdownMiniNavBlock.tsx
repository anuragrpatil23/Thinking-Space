import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { assignSectionOutlineLabelsBlock } from '@/services/lego_blocks/units/outlineCounterBlock'
import DocumentOutlinePanelBlock, {
  type DocumentOutlineRowBlock,
} from '@/components/lego_blocks/units/DocumentOutlinePanelBlock'

/** Latest-AI-session provenance for the open file (file-level — the pipeline
 *  has no line ranges). Colors mirror the explorer's telemetry dots. */
export interface MiniNavAiTouch {
  kind: 'created' | 'edited'
  topic: string
}

interface MarkdownMiniNavBlockProps {
  content: string
  container: HTMLDivElement | null
  className?: string
  useRenderedHeadings?: boolean
  renderRootSelector?: string
  aiTouch?: MiniNavAiTouch | null
}

interface HeadingMark {
  level: number
  ratio: number
  text: string
}

type ScrollTargetMode = 'container' | 'page'

const MAX_TICKS = 120
const MAX_PANEL_ROWS = 80
const IDLE_FADE_DELAY_MS = 1200

function extractHeadingMarks(markdown: string): HeadingMark[] {
  const lines = markdown.split('\n')
  const total = Math.max(lines.length - 1, 1)
  const marks: HeadingMark[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const m = line.match(/^(#{1,6})\s+(.*)/)
    if (!m) continue
    marks.push({
      level: m[1].length,
      ratio: i / total,
      text: m[2].trim(),
    })
  }
  return marks
}

function tickWidthForLevel(level: number): number {
  if (level <= 1) return 14
  if (level === 2) return 9
  return 5
}

/**
 * Structure rail for long markdown documents. Deliberately NOT a scrollbar —
 * the native one stays; this is a quiet column of heading ticks beside it.
 * The tick for the section currently in view is highlighted; hovering opens a
 * solid outline panel (rows, not floating pills — always readable over any
 * content) with click-to-jump; the tick track itself is click/drag scrubbable.
 */
export default function MarkdownMiniNavBlock({
  content,
  container,
  className,
  useRenderedHeadings = true,
  renderRootSelector,
  aiTouch = null,
}: MarkdownMiniNavBlockProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollHeight, setScrollHeight] = useState(1)
  const [clientHeight, setClientHeight] = useState(1)
  const fallbackHeadingMarks = useMemo(() => extractHeadingMarks(content), [content])
  const [headingMarks, setHeadingMarks] = useState<HeadingMark[]>(fallbackHeadingMarks)

  const trackRef = useRef<HTMLDivElement | null>(null)
  const [hovering, setHovering] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [scrollActive, setScrollActive] = useState(false)
  const scrollIdleTimerRef = useRef<number | null>(null)
  const hoverLeaveTimerRef = useRef<number | null>(null)
  const dragMovedRef = useRef(false)
  const dragStartYRef = useRef(0)

  const pulseScrollActivity = useCallback(() => {
    setScrollActive(true)
    if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current)
    scrollIdleTimerRef.current = window.setTimeout(() => {
      scrollIdleTimerRef.current = null
      setScrollActive(false)
    }, IDLE_FADE_DELAY_MS)
  }, [])

  useEffect(() => () => {
    if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current)
  }, [])

  // Hover-intent: keep the panel open while the pointer crosses the gap
  // between the track and the panel.
  const handleHoverEnter = useCallback(() => {
    if (hoverLeaveTimerRef.current !== null) {
      window.clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    setHovering(true)
  }, [])
  const handleHoverLeave = useCallback(() => {
    if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current)
    hoverLeaveTimerRef.current = window.setTimeout(() => {
      hoverLeaveTimerRef.current = null
      setHovering(false)
    }, 250)
  }, [])
  useEffect(() => () => {
    if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current)
  }, [])

  const readPageMetrics = useCallback((): { top: number; height: number; viewportHeight: number } => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return { top: 0, height: 1, viewportHeight: 1 }
    }
    const scrollingElement = document.scrollingElement ?? document.documentElement
    const top = Number.isFinite(window.scrollY) ? window.scrollY : scrollingElement.scrollTop
    const height = Math.max(scrollingElement.scrollHeight, 1)
    const viewportHeight = Math.max(window.innerHeight || scrollingElement.clientHeight, 1)
    return { top: Math.max(top, 0), height, viewportHeight }
  }, [])

  const readScrollTargetMode = useCallback((): ScrollTargetMode => {
    if (!container) return 'page'
    return container.scrollHeight - container.clientHeight > 1 ? 'container' : 'page'
  }, [container])

  const resolveRenderedHeadingMarks = useCallback((): HeadingMark[] => {
    if (!useRenderedHeadings) return fallbackHeadingMarks
    const mode = readScrollTargetMode()

    const roots = renderRootSelector
      ? (container
          ? Array.from(container.querySelectorAll<HTMLElement>(renderRootSelector))
          : Array.from(document.querySelectorAll<HTMLElement>(renderRootSelector)))
      : (container ? [container] : [])
    const headings: HTMLHeadingElement[] = roots.flatMap((root) =>
      Array.from(root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')),
    )
    if (headings.length === 0) return fallbackHeadingMarks

    const containerRect = container?.getBoundingClientRect() ?? null
    const pageMetrics = readPageMetrics()
    const maxScroll = mode === 'container'
      ? Math.max((container?.scrollHeight ?? 1) - (container?.clientHeight ?? 1), 1)
      : Math.max(pageMetrics.height - pageMetrics.viewportHeight, 1)
    const marks: HeadingMark[] = []

    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1))
      if (!Number.isFinite(level)) continue
      const headingRect = heading.getBoundingClientRect()
      const offsetTop = mode === 'container' && containerRect && container
        ? headingRect.top - containerRect.top + container.scrollTop
        : headingRect.top + pageMetrics.top
      const ratio = Math.max(0, Math.min(1, offsetTop / maxScroll))
      marks.push({ level, ratio, text: (heading.textContent ?? '').trim() })
    }

    return marks.length > 0 ? marks : fallbackHeadingMarks
  }, [container, fallbackHeadingMarks, readPageMetrics, readScrollTargetMode, renderRootSelector, useRenderedHeadings])

  useEffect(() => {
    setHeadingMarks(fallbackHeadingMarks)
  }, [fallbackHeadingMarks])

  useEffect(() => {
    let headingFrame: number | null = null
    const scheduleHeadingUpdate = () => {
      if (headingFrame !== null) return
      headingFrame = window.requestAnimationFrame(() => {
        headingFrame = null
        setHeadingMarks(resolveRenderedHeadingMarks())
      })
    }

    const updateMetrics = () => {
      const mode = readScrollTargetMode()
      if (mode === 'container' && container) {
        setScrollTop(container.scrollTop)
        setScrollHeight(Math.max(container.scrollHeight, 1))
        setClientHeight(Math.max(container.clientHeight, 1))
        return
      }

      const page = readPageMetrics()
      setScrollTop(page.top)
      setScrollHeight(page.height)
      setClientHeight(page.viewportHeight)
    }

    updateMetrics()
    scheduleHeadingUpdate()

    const handleContainerScroll = () => {
      if (readScrollTargetMode() !== 'container' || !container) return
      setScrollTop(container.scrollTop)
      pulseScrollActivity()
    }
    container?.addEventListener('scroll', handleContainerScroll, { passive: true })

    const handleWindowScroll = () => {
      if (readScrollTargetMode() !== 'page') return
      const page = readPageMetrics()
      setScrollTop(page.top)
      pulseScrollActivity()
    }
    window.addEventListener('scroll', handleWindowScroll, { passive: true })

    const ro = new ResizeObserver(() => {
      updateMetrics()
      scheduleHeadingUpdate()
    })
    if (container) ro.observe(container)

    // Only structural/text changes move heading positions. Watching attributes
    // across the subtree would remeasure on every in-content class flip (link
    // hovers, checkbox toggles); the container ResizeObserver already covers
    // layout-size changes.
    const mo = new MutationObserver(() => {
      updateMetrics()
      scheduleHeadingUpdate()
    })
    if (container) {
      mo.observe(container, { subtree: true, childList: true, characterData: true })
    }

    const handleWindowResize = () => {
      updateMetrics()
      scheduleHeadingUpdate()
    }
    window.addEventListener('resize', handleWindowResize)

    return () => {
      if (headingFrame !== null) {
        window.cancelAnimationFrame(headingFrame)
        headingFrame = null
      }
      container?.removeEventListener('scroll', handleContainerScroll)
      window.removeEventListener('scroll', handleWindowScroll)
      window.removeEventListener('resize', handleWindowResize)
      ro.disconnect()
      mo.disconnect()
    }
  }, [container, fallbackHeadingMarks, pulseScrollActivity, readPageMetrics, readScrollTargetMode, resolveRenderedHeadingMarks])

  const maxScroll = Math.max(scrollHeight - clientHeight, 1)

  const scrollToRatio = useCallback((ratio: number, behavior: ScrollBehavior = 'smooth') => {
    const clamped = Math.max(0, Math.min(1, ratio))
    const mode = readScrollTargetMode()
    if (mode === 'container' && container) {
      container.scrollTo({
        top: clamped * Math.max(container.scrollHeight - container.clientHeight, 1),
        behavior,
      })
      return
    }

    const page = readPageMetrics()
    const pageMaxScroll = Math.max(page.height - page.viewportHeight, 1)
    window.scrollTo({
      top: clamped * pageMaxScroll,
      behavior,
    })
  }, [container, readPageMetrics, readScrollTargetMode])

  // Jump so the heading lands about a third down the viewport — near-center
  // reads better than pinning the section title to the top edge.
  const scrollToHeading = useCallback((ratio: number) => {
    const clamped = Math.max(0, Math.min(1, ratio))
    const mode = readScrollTargetMode()
    if (mode === 'container' && container) {
      const max = Math.max(container.scrollHeight - container.clientHeight, 1)
      const top = Math.max(0, Math.min(max, clamped * max - container.clientHeight / 3))
      container.scrollTo({ top, behavior: 'smooth' })
      return
    }
    const page = readPageMetrics()
    const max = Math.max(page.height - page.viewportHeight, 1)
    const top = Math.max(0, Math.min(max, clamped * max - page.viewportHeight / 3))
    window.scrollTo({ top, behavior: 'smooth' })
  }, [container, readPageMetrics, readScrollTargetMode])

  const ratioFromPointer = useCallback((clientY: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(rect.height, 1)))
  }, [])

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragMovedRef.current = false
    dragStartYRef.current = e.clientY
    setDragging(true)
  }, [])

  const handleTrackPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    if (!dragMovedRef.current && Math.abs(e.clientY - dragStartYRef.current) < 3) return
    dragMovedRef.current = true
    scrollToRatio(ratioFromPointer(e.clientY), 'auto')
  }, [dragging, ratioFromPointer, scrollToRatio])

  const handleTrackPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    if (!dragMovedRef.current) {
      scrollToRatio(ratioFromPointer(e.clientY), 'smooth')
    }
  }, [dragging, ratioFromPointer, scrollToRatio])

  const ticks = useMemo(() => headingMarks.slice(0, MAX_TICKS), [headingMarks])

  // Judge "current section" at the same one-third reading line that
  // click-to-jump lands headings on, so the highlight matches where you land.
  const readingLineRatio = (scrollTop + clientHeight / 3) / maxScroll
  const activeMarkIndex = useMemo(() => {
    let active = -1
    for (let i = 0; i < headingMarks.length; i += 1) {
      if (headingMarks[i].ratio <= readingLineRatio + 0.005) active = i
      else break
    }
    return active
  }, [readingLineRatio, headingMarks])

  const panelRows = useMemo<DocumentOutlineRowBlock[]>(() => {
    const marks = headingMarks.slice(0, MAX_PANEL_ROWS)
    const { titleIndex, labels } = assignSectionOutlineLabelsBlock(marks.map((m) => m.level))
    return marks.map((mark, i) => ({
      key: `row-${i}-${mark.text}`,
      label: labels[i],
      text: mark.text,
      level: mark.level,
      isTitle: i === titleIndex,
      active: i === activeMarkIndex,
      onSelect: i === titleIndex
        ? () => scrollToRatio(0, 'smooth')
        : () => scrollToHeading(mark.ratio),
    }))
  }, [activeMarkIndex, headingMarks, scrollToHeading, scrollToRatio])

  // Non-intrusive gating: no rail on short documents or docs without structure.
  const scrollable = scrollHeight > clientHeight * 1.5
  if (!scrollable || headingMarks.length === 0) return null

  const engaged = hovering || dragging || scrollActive
  const peeking = hovering || dragging

  return (
    <div
      // Widen the hover trigger leftward with transparent padding so the panel
      // opens without pinpointing the thin tick track — the visual rail stays
      // pinned to the right edge (track is right-aligned inside), only the
      // hit-zone grows. The panel anchors to the track, so it's unaffected.
      className={cn('select-none pl-12', className)}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') handleHoverEnter() }}
      onPointerLeave={handleHoverLeave}
    >
      <div
        className={cn(
          'relative h-full transition-opacity duration-300',
          engaged ? 'opacity-100' : 'opacity-30',
        )}
      >
        {aiTouch && (
          <div
            className={cn(
              'pointer-events-none absolute -top-3 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full',
              aiTouch.kind === 'created' ? 'bg-emerald-500' : 'bg-amber-500',
            )}
            style={{
              boxShadow: aiTouch.kind === 'created'
                ? '0 0 8px 1px rgba(16, 185, 129, 0.55)'
                : '0 0 8px 1px rgba(245, 158, 11, 0.55)',
            }}
            title={`AI ${aiTouch.kind} this file — ${aiTouch.topic}`}
          />
        )}

        {peeking && (
          <div className="absolute right-full top-0 mr-2 flex max-h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            {aiTouch && (
              <div
                className={cn(
                  'flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5 text-[10px] font-medium',
                  aiTouch.kind === 'created' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    aiTouch.kind === 'created' ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                />
                <span className="truncate">AI {aiTouch.kind} · {aiTouch.topic}</span>
              </div>
            )}
            <DocumentOutlinePanelBlock rows={panelRows} size="compact" />
          </div>
        )}

        <div
          ref={trackRef}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={() => setDragging(false)}
          className="relative h-full w-4 cursor-pointer touch-none"
          aria-hidden="true"
        >
          {ticks.map((mark, i) => (
            <div
              key={`tick-${mark.level}-${i}`}
              className={cn(
                'pointer-events-none absolute right-0.5 rounded-full transition-colors duration-200',
                i === activeMarkIndex
                  ? 'bg-primary/80'
                  : mark.level <= 1
                    ? 'bg-muted-foreground/50'
                    : mark.level === 2
                      ? 'bg-muted-foreground/35'
                      : 'bg-muted-foreground/25',
              )}
              style={{
                top: `${mark.ratio * 100}%`,
                height: 2,
                width: tickWidthForLevel(mark.level) + (i === activeMarkIndex ? 2 : 0),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
