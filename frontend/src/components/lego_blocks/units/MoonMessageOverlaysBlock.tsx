import PixelSprite from '@/components/lego_blocks/units/MoonPixelSpriteBlock'
import {
  SKATEBOARD,
  SLEEP_Z,
  SPARKLE,
  WIZARD_HAT,
  WIZARD_WAND,
  tailRows,
} from '@/services/lego_blocks/units/moonSpritesBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'

// Hat, wand, and popping sparkles for the wizard animation; skateboard for
// skate. Offsets differ per sprite, so they're passed in.
export default function MoonMessageOverlaysBlock({
  anim,
  skateboardLeft,
  skateboardTop,
  hatLeft,
  hatTop,
  wandLeft,
  wandTop,
  tailLeft,
  tailTop,
  tailColor,
}: {
  anim: MoonSceneAnimationBlock
  skateboardLeft: number
  skateboardTop: number
  hatLeft: number
  hatTop: number
  wandLeft: number
  wandTop: number
  tailLeft: number
  tailTop: number
  tailColor: string
}) {
  if (anim === 'wag') {
    return (
      <div
        style={{
          position: 'absolute',
          left: tailLeft,
          top: tailTop,
          animation: 'moon-msg-wag-tail 0.35s ease-in-out infinite alternate',
          transformOrigin: 'top right',
        }}
      >
        <PixelSprite rows={tailRows(tailColor)} px={4} />
      </div>
    )
  }
  if (anim === 'skate') {
    return (
      <div style={{ position: 'absolute', left: skateboardLeft, top: skateboardTop }}>
        <PixelSprite rows={SKATEBOARD} px={4} />
      </div>
    )
  }
  if (anim === 'sleep') {
    // Rising zzz above the head; reuses the DJ-mode note-rise keyframe.
    return (
      <>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: wandLeft - 4 + i * 9,
              top: hatTop - 4 - i * 6,
              animation: `moon-note-rise 3s ease-out ${i * 1}s infinite`,
              opacity: 0,
            }}
          >
            <PixelSprite rows={SLEEP_Z} px={2} />
          </div>
        ))}
      </>
    )
  }
  if (anim === 'wizard') {
    return (
      <>
        <div style={{ position: 'absolute', left: hatLeft, top: hatTop }}>
          <PixelSprite rows={WIZARD_HAT} px={4} />
        </div>
        <div style={{ position: 'absolute', left: wandLeft, top: wandTop }}>
          <PixelSprite rows={WIZARD_WAND} px={4} />
        </div>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: wandLeft + 14 + i * 8,
              top: wandTop - 8 - i * 8,
              animation: `moon-msg-sparkle 1.2s ease-in-out ${i * 0.4}s infinite`,
              opacity: 0,
            }}
          >
            <PixelSprite rows={SPARKLE} px={3} />
          </div>
        ))}
      </>
    )
  }
  return null
}
