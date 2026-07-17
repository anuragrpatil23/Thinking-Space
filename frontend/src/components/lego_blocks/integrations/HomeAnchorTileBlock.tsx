import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react'

// Code-split boundary: keeps recharts out of the startup bundle.
const DashboardChartsBlock = lazy(() => import('@/components/lego_blocks/integrations/DashboardChartsBlock'))
import ThisWeekDigestBlock from '@/components/lego_blocks/integrations/ThisWeekDigestBlock'
import AiActivityPanelBlock from '@/components/lego_blocks/integrations/AiActivityPanelBlock'
import TodayFileActivityOrch from '@/components/orchestrators/TodayFileActivityOrch'
import { useUserProfileBlock } from '@/components/lego_blocks/hooks/shared/useUserProfileBlock'
import { useCanvasProjectBindingBlock } from '@/components/lego_blocks/hooks/shared/useCanvasProjectBindingBlock'
import { useDashboardActivityBlock } from '@/components/lego_blocks/hooks/shared/useDashboardActivityBlock'
import { readVaultUiPreferencesOrch } from '@/services/orchestrators/vaultUiPreferencesOrch'
import {
  useCanvasThemeBlock,
  type CanvasThemeTokens,
} from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'

interface AnchorElementProps {
  centerX: number
  centerY: number
  /** Notified whenever the world's needed bottom edge changes so the parent
   *  canvas can grow its worldHeight to fit the expanded AI-Activity tile
   *  (drill-down opens/closes) without scroll or clipping. */
  onContentBottomChange?: (bottomWorldY: number) => void
}

// aiActivity + thisWeek have an *initial* height only — actual height is
// measured at runtime and the panels below cascade off them. Order top→bottom:
// aiActivity → thisWeek → charts → today. Both intrinsic panels sit near the
// top of the stack so their expansion pushes everything below in one shot.
const ANCHOR_ELEMENTS = {
  welcome: { w: 640, h: 200, offsetY: -540 },
  aiActivity: { w: 880, initialH: 620, offsetY: -380 },
  thisWeek: { w: 880, initialH: 700, gap: 40 },
  charts: { w: 880, h: 360, gap: 40 },
  today: { w: 880, h: 440, gap: 40 },
} as const

// Hard cap for intrinsic panels — beyond this the card scrolls internally
// instead of pushing the whole cascade further down. Generous so normal weeks
// never hit it; the This Week card's 700px *floor* (minHeight) is the value
// that actually shapes its resting size.
const INTRINSIC_MAX_HEIGHT = 2200

function FloatingPanel({
  x,
  y,
  w,
  h,
  minHeight,
  maxHeight,
  variant = 'panel',
  theme,
  innerRef,
  children,
}: {
  x: number
  y: number
  w: number
  /** Omit for an intrinsic-height panel that grows with its content. */
  h?: number
  /** Floor for an intrinsic panel — the card occupies at least this height even
   *  when its content is shorter, then still grows past it as content spills. */
  minHeight?: number
  /** Only meaningful for intrinsic panels: caps the outer height and turns on
   *  internal scroll when the content would spill past. When capped and the
   *  cursor is over the card, wheel events are captured so the card scrolls
   *  and the canvas doesn't pan/zoom underneath. */
  maxHeight?: number
  variant?: 'panel' | 'text'
  theme: CanvasThemeTokens
  /** Attach a ref to the outer positioned element — used to measure intrinsic
   *  height so the world can grow around it. */
  innerRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}) {
  const isPanel = variant === 'panel'
  const intrinsic = h === undefined
  const localRef = useRef<HTMLDivElement | null>(null)
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node
      if (typeof innerRef === 'function') innerRef(node)
      else if (innerRef && typeof innerRef === 'object') {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    [innerRef],
  )
  // Only intrinsic + capped panels can overflow — track it so we know when to
  // hijack wheel from the canvas. Runs on scroll + resize (both trigger the
  // scrollHeight vs clientHeight check).
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = localRef.current
    if (!el || maxHeight === undefined || typeof ResizeObserver === 'undefined') return
    const update = () => setOverflowing(el.scrollHeight - el.clientHeight > 1)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxHeight])
  // Wheel-capture: only when we're actively overflowing. When the card can't
  // scroll, wheel passes through so canvas pan/zoom keeps working. `wheel`
  // has to be attached natively to opt out of passive-listener defaults so
  // preventDefault can stop the canvas from also handling it.
  useEffect(() => {
    if (!overflowing) return
    const el = localRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation()
      // Only preventDefault when there's actually room to scroll in the
      // wheel's direction — lets the browser bounce at the edges without
      // trapping the user inside the card.
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return
      e.preventDefault()
      el.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [overflowing])
  return (
    <div
      ref={setRefs}
      data-canvas-anchor-element="true"
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        minHeight,
        maxHeight,
        padding: isPanel ? 20 : 0,
        borderRadius: isPanel ? 14 : 0,
        background: isPanel ? theme.anchorPanelBg : 'transparent',
        border: isPanel ? `1px solid ${theme.anchorPanelBorder}` : 'none',
        boxShadow: isPanel ? theme.anchorPanelShadow : 'none',
        // Capped intrinsic panels scroll internally when their content spills;
        // uncapped intrinsic panels stay visible so drill-down grows the
        // canvas world; fixed-height panels keep clipping for safety.
        overflow:
          maxHeight !== undefined
            ? 'auto'
            : intrinsic
              ? 'visible'
              : 'hidden',
        cursor: 'default',
        zIndex: 2,
      }}
    >
      {children}
    </div>
  )
}

function HomeAnchorTileBlockImpl({ centerX, centerY, onContentBottomChange }: AnchorElementProps) {
  const theme = useCanvasThemeBlock()
  const { profile } = useUserProfileBlock()
  const activity = useDashboardActivityBlock('30d')
  const { project } = useCanvasProjectBindingBlock('home')
  const [showDailyHighlights, setShowDailyHighlights] = useState(false)

  useEffect(() => {
    let cancelled = false
    readVaultUiPreferencesOrch()
      .then(prefs => { if (!cancelled) setShowDailyHighlights(prefs.showDailyHighlights) })
      .catch(() => { /* leave off */ })
    return () => { cancelled = true }
  }, [])

  // Measured height of the AI-Activity tile — drives the cascade of every
  // panel below it, and (via callback) the canvas world height. Seeded from
  // `initialH` so first paint uses a sensible layout before ResizeObserver
  // reports the real value.
  const [aiActivityHeight, setAiActivityHeight] = useState<number>(ANCHOR_ELEMENTS.aiActivity.initialH)
  const [thisWeekHeight, setThisWeekHeight] = useState<number>(ANCHOR_ELEMENTS.thisWeek.initialH)
  const aiActivityRef = useRef<HTMLDivElement | null>(null)
  const thisWeekRef = useRef<HTMLDivElement | null>(null)
  // Same measurement recipe for both intrinsic panels: borderBoxSize (with a
  // contentRect fallback) already includes FloatingPanel's own padding.
  const observeIntrinsicPanel = (
    ref: React.MutableRefObject<HTMLDivElement | null>,
    apply: (measured: number) => void,
  ) => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return () => {}
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const measured = Math.ceil((entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height))
        if (measured < 100) return
        apply(measured)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }
  useEffect(
    () => observeIntrinsicPanel(aiActivityRef, m =>
      setAiActivityHeight(prev => (Math.abs(prev - m) < 1 ? prev : m)),
    ),
    [],
  )
  useEffect(
    () => observeIntrinsicPanel(thisWeekRef, m =>
      setThisWeekHeight(prev => (Math.abs(prev - m) < 1 ? prev : m)),
    ),
    [],
  )

  // Legacy home tiles (the "Activity" charts panel + "What you did today" file-
  // activity panel) are hidden — the AI-Activity panel now covers this ground.
  // Kept wired (imports, layout, components) behind this flag so they can be
  // flipped back on without reconstructing anything.
  const SHOW_SECONDARY_PANELS = false

  const w = 880
  const welcomeSpec = ANCHOR_ELEMENTS.welcome
  const aiSpec = ANCHOR_ELEMENTS.aiActivity
  const chartsSpec = ANCHOR_ELEMENTS.charts
  const thisWeekSpec = ANCHOR_ELEMENTS.thisWeek
  const todaySpec = ANCHOR_ELEMENTS.today

  const welcome = {
    x: centerX - welcomeSpec.w / 2,
    y: centerY + welcomeSpec.offsetY,
    w: welcomeSpec.w,
    h: welcomeSpec.h,
  }
  const aiActivityTop = centerY + aiSpec.offsetY
  const aiActivityBottom = aiActivityTop + aiActivityHeight
  const thisWeekTop = aiActivityBottom + thisWeekSpec.gap
  const thisWeekBottom = thisWeekTop + thisWeekHeight
  const chartsTop = thisWeekBottom + chartsSpec.gap
  const chartsBottom = chartsTop + chartsSpec.h
  const todayTop = chartsBottom + todaySpec.gap
  const todayBottom = todayTop + todaySpec.h

  const aiActivity = { x: centerX - w / 2, y: aiActivityTop, w }
  const thisWeek = { x: centerX - w / 2, y: thisWeekTop, w }
  const charts = { x: centerX - w / 2, y: chartsTop, w, h: chartsSpec.h }
  const today = { x: centerX - w / 2, y: todayTop, w, h: todaySpec.h }

  const notifyBottom = useCallback(
    (bottom: number) => onContentBottomChange?.(bottom),
    [onContentBottomChange],
  )
  // Canvas world height follows the last *visible* tile — This Week when the
  // secondary panels are hidden, otherwise the Today panel at the cascade end.
  const contentBottom = SHOW_SECONDARY_PANELS ? todayBottom : thisWeekBottom
  useEffect(() => { notifyBottom(contentBottom) }, [contentBottom, notifyBottom])

  return (
    <div className={theme.isDark ? 'dark' : ''}>
      <FloatingPanel {...welcome} variant="text" theme={theme}>
        <div style={{ textAlign: 'center', userSelect: 'none' }}>
          <p
            style={{
              fontSize: 12,
              color: theme.anchorEyebrow,
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              margin: 0,
            }}
          >
            Thinking Space
          </p>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: theme.anchorHeading,
              margin: '10px 0 0',
              letterSpacing: '-0.02em',
            }}
          >
            Welcome, {profile.name}
          </h1>
          {project && project.mission.trim() && (
            <p
              style={{
                fontSize: 14,
                color: theme.anchorEyebrow,
                margin: '12px 0 0',
                fontStyle: 'italic',
                lineHeight: 1.5,
              }}
            >
              {project.mission}
            </p>
          )}
        </div>
      </FloatingPanel>

      {SHOW_SECONDARY_PANELS && (
        <FloatingPanel {...charts} theme={theme}>
          <Suspense fallback={null}>
            <DashboardChartsBlock
              series={activity.series}
              loading={activity.loading}
              error={activity.error}
              preset={activity.preset}
              onPresetChange={activity.setPreset}
              showDailyHighlights={showDailyHighlights}
            />
          </Suspense>
        </FloatingPanel>
      )}

      <FloatingPanel
        {...thisWeek}
        minHeight={ANCHOR_ELEMENTS.thisWeek.initialH}
        maxHeight={INTRINSIC_MAX_HEIGHT}
        theme={theme}
        innerRef={thisWeekRef}
      >
        <ThisWeekDigestBlock />
      </FloatingPanel>

      {SHOW_SECONDARY_PANELS && (
        <FloatingPanel {...today} theme={theme}>
          <TodayFileActivityOrch
            highlights={activity.series?.highlights ?? null}
            highlightsLoading={activity.loading}
          />
        </FloatingPanel>
      )}

      <FloatingPanel {...aiActivity} theme={theme} innerRef={aiActivityRef}>
        {/* The AI-Activity panel caps its own drill table internally, so
            the outer card grows only through header+heatmap+timeline — the
            table scrolls in place instead of the whole card scrolling. */}
        <AiActivityPanelBlock enableGraphPeek />
      </FloatingPanel>
    </div>
  )
}

// Memo prevents this whole subtree (charts, this-week digest, today activity) from
// re-rendering on every wheel pan/zoom in HomeCanvasOrch — its props are
// constants for the lifetime of the page.
const HomeAnchorTileBlock = memo(HomeAnchorTileBlockImpl)
export default HomeAnchorTileBlock
