import { useMemo } from 'react'
import { PX, spritePathsBlock } from '@/services/lego_blocks/units/moonSpritesBlock'

/* One pixel-art sprite as an SVG: one path per colour, drawn in sprite-pixel
   units and stretched to `px` per pixel, with crisp edges. It occupies the
   sprite's full bounds, so it lays out like an image. (It was a 1px box with
   a box-shadow per pixel; at fractional scales that seamed — see
   spritePathsBlock.) */
export default function MoonPixelSpriteBlock({ rows, px = PX }: { rows: string[]; px?: number }) {
  const paths = useMemo(() => spritePathsBlock(rows), [rows])
  const columns = rows[0]?.length ?? 0
  return (
    <svg
      width={columns * px}
      height={rows.length * px}
      viewBox={`0 0 ${columns} ${rows.length}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      {paths.map(({ color, d }) => <path key={color} d={d} fill={color} />)}
    </svg>
  )
}
