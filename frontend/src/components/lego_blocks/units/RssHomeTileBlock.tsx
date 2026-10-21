import { Rss } from 'lucide-react'
import HomeTileBlock, { HOME_TILE_SHADOW_BLOCK, HomeTileFigureBlock } from '@/components/lego_blocks/units/HomeTileBlock'
import type { CanvasThemeTokens } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'

/** The phone Home's way into the RSS reader, the most-used surface after the
 *  vault itself. It shows no unread count on purpose: knowing it means loading
 *  every feed, and doing that whenever Home opens was not worth a number. */
export default function RssHomeTileBlock({ theme, onOpen }: { theme: CanvasThemeTokens; onOpen: () => void }) {
  return (
    <div
      style={{
        height: '100%',
        borderRadius: 22,
        padding: '22px 20px',
        background: theme.anchorPanelBg,
        border: `1px solid ${theme.anchorPanelBorder}`,
        boxShadow: HOME_TILE_SHADOW_BLOCK,
      }}
    >
      <HomeTileBlock
        label="Feeds"
        onOpen={onOpen}
        accessory={<Rss aria-hidden className="h-3.5 w-3.5 shrink-0 text-orange-400" />}
      >
        <HomeTileFigureBlock figure="Read" line="Today's articles" />
      </HomeTileBlock>
    </div>
  )
}
