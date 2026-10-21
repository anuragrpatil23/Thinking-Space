import { PALETTE } from '@/services/lego_blocks/units/moonSpritesBlock'

/* A speech bubble drawn the way the moon scene draws its thought bubbles: a
   soft white block with stepped (pixel) corners, no outline, and a two-pixel
   tail dropping toward the speaker — so a line of text can sit inside one
   without a bordered box that looks like it came from another app.
   `pixel` is the size of one pixel step, matching the speaker's scale. */
export default function MoonPixelBubbleBlock({
  text,
  pixel = 3,
  tail = 'left',
}: {
  text: string
  pixel?: number
  /** Which side of the bubble's bottom the tail drops from. */
  tail?: 'left' | 'right'
}) {
  const p = pixel
  /* Stepped corners: each corner loses one pixel square. */
  const clip = `polygon(${p}px 0, calc(100% - ${p}px) 0, calc(100% - ${p}px) ${p}px, 100% ${p}px, 100% calc(100% - ${p}px), calc(100% - ${p}px) calc(100% - ${p}px), calc(100% - ${p}px) 100%, ${p}px 100%, ${p}px calc(100% - ${p}px), 0 calc(100% - ${p}px), 0 ${p}px, ${p}px ${p}px)`
  const tailX = tail === 'left' ? p * 3 : undefined
  const tailRight = tail === 'right' ? p * 3 : undefined
  return (
    <div style={{ position: 'relative', width: 'max-content', maxWidth: 200, paddingBottom: p * 3 }}>
      <div
        style={{
          background: PALETTE.W,
          color: PALETTE.K,
          clipPath: clip,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.35,
          padding: `${p * 2}px ${p * 3}px`,
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
      {/* tail: one pixel under the bubble, one more beneath and inward */}
      <span style={{ position: 'absolute', bottom: p, left: tailX, right: tailRight, width: p * 2, height: p, background: PALETTE.W }} />
      <span style={{ position: 'absolute', bottom: 0, left: tailX !== undefined ? tailX - p : undefined, right: tailRight !== undefined ? tailRight - p : undefined, width: p, height: p, background: PALETTE.W }} />
    </div>
  )
}
