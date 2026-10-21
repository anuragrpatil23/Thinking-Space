import { useCallback, useMemo, useState } from 'react'
import CanvasSurfaceOrch from '@/components/orchestrators/CanvasSurfaceOrch'
import type { CanvasTile } from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'
import HomeAnchorTileBlock from '@/components/lego_blocks/integrations/HomeAnchorTileBlock'
import MoonSceneBlock from '@/components/lego_blocks/units/MoonSceneBlock'
import { homeCanvasStorage } from '@/services/lego_blocks/integrations/homeCanvasStorageBlock'
import { readBoardInboxBlock, removeBoardInboxNotesBlock } from '@/services/lego_blocks/integrations/boardInboxBlock'
import { isElectron } from '@/services/lego_blocks/integrations/fsBlock'

/** Stable, so the board's inbox effect does not re-run every render. Only
 *  the desktop pulls the inbox in: every device that holds the board writes
 *  its whole copy, so two pullers could each drop the other's placement and
 *  both delete the note's file — one puller keeps a phone note safe. */
const BOARD_INBOX_BLOCK = isElectron() ? { read: readBoardInboxBlock, remove: removeBoardInboxNotesBlock } : undefined

const DEFAULT_WORLD_HEIGHT = 4500
const CONTENT_BOTTOM_BREATHING = 320

const ANCHOR_CENTER_X = 4500 / 2
// +200 vs the original 3000/2 center: extra sky above the moon scene.
const ANCHOR_CENTER_Y = 3000 / 2 + 200

const SEED_TILES: CanvasTile[] = [
  {
    id: 'seed-1',
    type: 'post-it',
    x: 480,
    y: 780,
    w: 280,
    h: 280,
    text: 'double-click empty space to make a new one',
    color: 'yellow',
    locked: true,
  },
  {
    id: 'seed-2',
    type: 'post-it',
    x: 2080,
    y: 780,
    w: 280,
    h: 320,
    text: 'right-click and "Add note" to pull a vault note onto the board',
    color: 'pink',
    locked: true,
  },
  {
    id: 'seed-3',
    type: 'post-it',
    x: 200,
    y: 1660,
    w: 280,
    h: 280,
    text: '',
    color: 'blue',
    locked: true,
  },
]

export default function HomeCanvasOrch() {
  // The AI-Activity tile grows when its drill-down opens; the panels below
  // cascade off it and the world height stretches to fit. Reported bottom
  // is the todayBottom edge in world coords.
  const [contentBottomY, setContentBottomY] = useState<number | null>(null)
  const onContentBottomChange = useCallback((next: number) => {
    setContentBottomY(prev => (prev != null && Math.abs(prev - next) < 1 ? prev : next))
  }, [])
  const worldHeight = useMemo(() => {
    if (contentBottomY == null) return DEFAULT_WORLD_HEIGHT
    return Math.max(DEFAULT_WORLD_HEIGHT, Math.ceil(contentBottomY + CONTENT_BOTTOM_BREATHING))
  }, [contentBottomY])
  return (
    <CanvasSurfaceOrch
      surfaceId="home"
      storage={homeCanvasStorage}
      inbox={BOARD_INBOX_BLOCK}
      seedTiles={SEED_TILES}
      worldHeight={worldHeight}
      initialFocus={{
        worldX: ANCHOR_CENTER_X,
        worldY: ANCHOR_CENTER_Y - 280,
        contentWidth: 920,
        contentHeight: 1100,
      }}
      worldExtras={
        <>
          <MoonSceneBlock x={ANCHOR_CENTER_X - 260} y={ANCHOR_CENTER_Y - 810} />
          <HomeAnchorTileBlock
            centerX={ANCHOR_CENTER_X}
            centerY={ANCHOR_CENTER_Y}
            onContentBottomChange={onContentBottomChange}
          />
        </>
      }
    />
  )
}
