import { Suspense, lazy, memo, useEffect, useState } from 'react'

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
}

const ANCHOR_ELEMENTS = {
  welcome: { w: 640, h: 200, offsetY: -540 },
  // Tall enough to hold the chart + drill-down table without scrolling.
  aiActivity: { w: 880, h: 980, offsetY: -380 },
  charts: { w: 880, h: 360, offsetY: 640 },
  thisWeek: { w: 880, h: 360, offsetY: 1040 },
  today: { w: 880, h: 440, offsetY: 1440 },
} as const

function FloatingPanel({
  x,
  y,
  w,
  h,
  variant = 'panel',
  theme,
  children,
}: {
  x: number
  y: number
  w: number
  h: number
  variant?: 'panel' | 'text'
  theme: CanvasThemeTokens
  children: React.ReactNode
}) {
  const isPanel = variant === 'panel'
  return (
    <div
      data-canvas-anchor-element="true"
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        padding: isPanel ? 20 : 0,
        borderRadius: isPanel ? 14 : 0,
        background: isPanel ? theme.anchorPanelBg : 'transparent',
        border: isPanel ? `1px solid ${theme.anchorPanelBorder}` : 'none',
        boxShadow: isPanel ? theme.anchorPanelShadow : 'none',
        overflow: 'hidden',
        cursor: 'default',
        zIndex: 2,
      }}
    >
      {children}
    </div>
  )
}

function HomeAnchorTileBlockImpl({ centerX, centerY }: AnchorElementProps) {
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

  const place = (key: keyof typeof ANCHOR_ELEMENTS) => {
    const { w, h, offsetY } = ANCHOR_ELEMENTS[key]
    return { x: centerX - w / 2, y: centerY + offsetY, w, h }
  }

  const welcome = place('welcome')
  const charts = place('charts')
  const thisWeek = place('thisWeek')
  const today = place('today')
  const aiActivity = place('aiActivity')

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

      <FloatingPanel {...thisWeek} theme={theme}>
        <ThisWeekDigestBlock />
      </FloatingPanel>

      <FloatingPanel {...today} theme={theme}>
        <TodayFileActivityOrch
          highlights={activity.series?.highlights ?? null}
          highlightsLoading={activity.loading}
        />
      </FloatingPanel>

      <FloatingPanel {...aiActivity} theme={theme}>
        <AiActivityPanelBlock />
      </FloatingPanel>
    </div>
  )
}

// Memo prevents this whole subtree (charts, this-week digest, today activity) from
// re-rendering on every wheel pan/zoom in HomeCanvasOrch — its props are
// constants for the lifetime of the page.
const HomeAnchorTileBlock = memo(HomeAnchorTileBlockImpl)
export default HomeAnchorTileBlock
