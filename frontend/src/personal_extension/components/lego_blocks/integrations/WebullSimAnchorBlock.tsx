import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { computeSimTimelineWidthBlock } from './WebullSimTimelineBlock'
import WebullSimBoardBlock from './WebullSimBoardBlock'
import type { WebullSimOverviewBlock } from '@/personal_extension/services/orchestrators/webullSimOrch'

interface AnchorProps {
  /** Left edge of the sim panel in world coords (fixed; the world grows rightward). */
  panelLeft: number
  /** Fixed top edge of the sim panel in world coords (lets it grow downward). */
  simTopY: number
  /** Reports the panel's outer width + height so the canvas world can grow to fit. */
  onSizeChange: (width: number, height: number) => void
}

const MISSION_W = 720
const MISSION_H = 150
const MISSION_GAP = 32
const PANEL_H_PADDING = 40 // padding: 20 (left + right)
const PANEL_V_PADDING = 40 // padding: 20 (top + bottom)
const FALLBACK_PANEL_WIDTH = 1600 // before the first overview loads

export default function WebullSimAnchorBlock({ panelLeft, simTopY, onSizeChange }: AnchorProps) {
  const theme = useCanvasThemeBlock()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [overview, setOverview] = useState<WebullSimOverviewBlock | null>(null)
  const [measuredHeight, setMeasuredHeight] = useState(520)

  // Width is deterministic from the model (year span + lane gutter), so the
  // panel can size itself exactly and the canvas world grows to fit the whole
  // timeline — no inner horizontal scroll.
  const panelWidth = useMemo(() => (
    overview?.configured
      ? computeSimTimelineWidthBlock(overview.model) + PANEL_H_PADDING
      : FALLBACK_PANEL_WIDTH
  ), [overview])

  // Height still comes from measurement (summary strip can wrap, lane count varies).
  useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = entry.contentRect.height + PANEL_V_PADDING
        setMeasuredHeight((prev) => (Math.abs(prev - next) < 1 ? prev : next))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [overview])

  useEffect(() => {
    onSizeChange(panelWidth, measuredHeight)
  }, [panelWidth, measuredHeight, onSizeChange])

  const missionX = panelLeft + panelWidth / 2 - MISSION_W / 2
  const missionY = simTopY - MISSION_H - MISSION_GAP

  return (
    <div className={theme.isDark ? 'dark' : ''}>
      <div
        data-canvas-anchor-element="true"
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: missionX,
          top: missionY,
          width: MISSION_W,
          height: MISSION_H,
          textAlign: 'center',
          userSelect: 'none',
          zIndex: 2,
        }}
      >
        <h1 style={{ fontSize: 32, fontWeight: 600, color: theme.anchorHeading, margin: 0 }}>Sim</h1>
        <p style={{ fontSize: 14, color: theme.anchorEyebrow, margin: '8px 0 0', lineHeight: 1.5 }}>
          Practice reps across market history. Each mark is a company at a moment; click to open the case.
        </p>
      </div>

      <div
        data-canvas-anchor-element="true"
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: panelLeft,
          top: simTopY,
          width: panelWidth,
          padding: 20,
          borderRadius: 14,
          background: theme.anchorPanelBg,
          border: `1px solid ${theme.anchorPanelBorder}`,
          boxShadow: theme.anchorPanelShadow,
          overflow: 'visible',
          cursor: 'default',
          zIndex: 2,
          color: theme.tileText,
        }}
      >
        <div ref={contentRef}>
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: theme.anchorHeading, margin: 0 }}>Sim timeline</h2>
            <p style={{ fontSize: 13, color: theme.tileTextMuted, margin: '4px 0 0' }}>
              Staged reps and bench candidates across market/history eras.
            </p>
          </div>
          <WebullSimBoardBlock fitWidth onOverviewLoaded={setOverview} />
        </div>
      </div>
    </div>
  )
}
