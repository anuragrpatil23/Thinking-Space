import { useCallback, useMemo, useState } from 'react'
import CanvasSurfaceOrch from '@/components/orchestrators/CanvasSurfaceOrch'
import type { CanvasTile } from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'
import { webullF9SimCanvasStorage } from '@/personal_extension/services/lego_blocks/integrations/webullCanvasStorageBlock'
import WebullSimAnchorBlock from '@/personal_extension/components/lego_blocks/integrations/WebullSimAnchorBlock'

// Mirrors WebullF9CanvasOrch (the Study board): a bounded pan/zoom world with an
// anchor panel. Here the anchor hosts the Sim timeline, and the world grows to
// whatever width/height the timeline reports so the entire timeline is visible
// (pan/zoom to explore) rather than scrolling inside a fixed card.
const SIDE_BREATHING = 400
const PANEL_LEFT = SIDE_BREATHING
const FALLBACK_PANEL_WIDTH = 1600

const MISSION_HEIGHT = 150
const MISSION_GAP = 32
const ANCHOR_TOP_BREATHING = 520
const SIM_TOP_Y = MISSION_HEIGHT + MISSION_GAP + ANCHOR_TOP_BREATHING

const SIM_MIN_HEIGHT_FOR_LAYOUT = 520 // first-render fallback before size is reported
const SIM_BOTTOM_BREATHING = 320

const SEED_TILES: CanvasTile[] = [
  {
    id: 'f9-sim-seed-howto',
    type: 'post-it',
    x: 60,
    y: SIM_TOP_Y + 40,
    w: 260,
    h: 190,
    text: 'Time is the master axis here, not tickers.\n\nClick a mark to open the case. Double-click empty space to add a post-it.',
    color: 'blue',
    locked: true,
  },
]

export default function WebullF9SimCanvasOrch() {
  const [size, setSize] = useState({ width: FALLBACK_PANEL_WIDTH, height: SIM_MIN_HEIGHT_FOR_LAYOUT })

  const onSizeChange = useCallback((width: number, height: number) => {
    setSize((prev) => (
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height }
    ))
  }, [])

  const worldWidth = useMemo(() => size.width + SIDE_BREATHING * 2, [size.width])
  const worldHeight = useMemo(() => SIM_TOP_Y + size.height + SIM_BOTTOM_BREATHING, [size.height])
  const centerX = PANEL_LEFT + size.width / 2

  return (
    <CanvasSurfaceOrch
      surfaceId="webull-f9-sim"
      storage={webullF9SimCanvasStorage}
      seedTiles={SEED_TILES}
      worldWidth={worldWidth}
      worldHeight={worldHeight}
      clampMinScaleToFit
      initialFocus={{
        worldX: centerX,
        worldY: SIM_TOP_Y + size.height / 2,
        contentWidth: size.width + 120,
        contentHeight: size.height + MISSION_HEIGHT + MISSION_GAP,
      }}
      worldExtras={
        <WebullSimAnchorBlock
          panelLeft={PANEL_LEFT}
          simTopY={SIM_TOP_Y}
          onSizeChange={onSizeChange}
        />
      }
    />
  )
}
