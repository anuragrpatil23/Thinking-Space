import MoonClawdBlock from '@/components/lego_blocks/units/MoonClawdBlock'
import MoonSceneKeyframesBlock from '@/components/lego_blocks/units/MoonSceneKeyframesBlock'
import { CLAWD, PX } from '@/services/lego_blocks/units/moonSpritesBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'

/* Home's Clawd, shrunk for the explorer. He is drawn exactly as on Home (same
   component, same keyframes) and scaled as a whole, so every animation —
   wave, skate, wizard, backflip — works unchanged. No idle life: between
   animations he stands still (docs/contracts/ENERGY.md). */

export const EXPLORER_CLAWD_SCALE_BLOCK = 0.45
const BODY_WIDTH = CLAWD[0].length * PX
const BODY_HEIGHT = CLAWD.length * PX
export const EXPLORER_CLAWD_WIDTH_BLOCK = Math.round(BODY_WIDTH * EXPLORER_CLAWD_SCALE_BLOCK)
export const EXPLORER_CLAWD_HEIGHT_BLOCK = Math.round(BODY_HEIGHT * EXPLORER_CLAWD_SCALE_BLOCK)

export default function ExplorerClawdBlock({ anim }: { anim: MoonSceneAnimationBlock }) {
  return (
    <span
      className="relative block"
      style={{ width: EXPLORER_CLAWD_WIDTH_BLOCK, height: EXPLORER_CLAWD_HEIGHT_BLOCK }}
    >
      <MoonSceneKeyframesBlock />
      <span
        className="absolute bottom-0 left-0 block"
        style={{
          width: BODY_WIDTH,
          height: BODY_HEIGHT,
          transform: `scale(${EXPLORER_CLAWD_SCALE_BLOCK})`,
          transformOrigin: 'left bottom',
        }}
      >
        <MoonClawdBlock anim={anim} idle={false} style={{ position: 'relative' }} />
      </span>
    </span>
  )
}
