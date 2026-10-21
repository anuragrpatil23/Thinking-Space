import { PALETTE } from '@/services/lego_blocks/units/moonSpritesBlock'

// Pixel-styled speech bubble for scheduled messages; anchored above a sprite
// and grows upward with the text.
export default function MoonSpeechBubbleBlock({ text }: { text: string }) {
  return (
    <div style={{ position: 'relative', width: 'max-content', maxWidth: 160 }}>
      <div
        style={{
          background: PALETTE.W,
          color: PALETTE.K,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1.45,
          padding: '6px 9px',
          border: `3px solid ${PALETTE.K}`,
          boxShadow: '0 3px 0 rgba(0,0,0,0.35)',
        }}
      >
        {text}
      </div>
      {/* tail */}
      <div
        style={{
          position: 'absolute',
          left: 10,
          bottom: -7,
          width: 10,
          height: 10,
          background: PALETTE.W,
          borderLeft: `3px solid ${PALETTE.K}`,
          borderBottom: `3px solid ${PALETTE.K}`,
          transform: 'rotate(-45deg)',
        }}
      />
    </div>
  )
}
