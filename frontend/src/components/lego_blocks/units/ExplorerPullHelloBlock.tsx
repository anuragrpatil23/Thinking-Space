import { useEffect, useState } from 'react'
import ExplorerClawdBlock, { EXPLORER_CLAWD_HEIGHT_BLOCK, EXPLORER_CLAWD_WIDTH_BLOCK } from '@/components/lego_blocks/units/ExplorerClawdBlock'
import MoonPixelBubbleBlock from '@/components/lego_blocks/units/MoonPixelBubbleBlock'
import { nextEncouragementBlock } from '@/services/lego_blocks/units/explorerEncouragementBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'

/* Pull past the top of the file tree and Clawd drops in to say hi — the
   pull-to-refresh gesture from the Claude iPhone app, with a hello instead of
   a refresh. A small space opens above the explorer's header; he drops into
   it doing one of Home's own animations (skate, dance, wizard, …), with a
   kind line in a pixel speech bubble above him like the Home scene's, then
   goes back up as the space closes. Once per pull (`nonce` changes); nothing
   stays or loops afterwards. Reduced motion: never. */

const HELLO_MS_BLOCK = 3400
/* Walked in order, so each pull shows a different trick. */
const TRICKS_BLOCK: readonly MoonSceneAnimationBlock[] = ['wave', 'skate', 'dance', 'wizard', 'cheer', 'hop', 'spin', 'backflip']

function prefersReducedMotionBlock(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export default function ExplorerPullHelloBlock({ nonce }: { nonce: number }) {
  const [shown, setShown] = useState(0)
  const [line, setLine] = useState('')

  useEffect(() => {
    if (nonce > 0 && !prefersReducedMotionBlock()) {
      setLine(nextEncouragementBlock())
      setShown(nonce)
    }
  }, [nonce])

  if (!shown) return null
  const trick = TRICKS_BLOCK[(shown - 1) % TRICKS_BLOCK.length]

  return (
    <div
      key={shown}
      aria-hidden="true"
      className="relative flex items-end justify-center overflow-hidden"
      style={{ height: 0, animation: `ltm-pull-hello-space ${HELLO_MS_BLOCK}ms cubic-bezier(0.3, 0.7, 0.3, 1) forwards` }}
      onAnimationEnd={(event) => {
        if (event.animationName === 'ltm-pull-hello-space') setShown(0)
      }}
    >
      <style>{`
        @keyframes ltm-pull-hello-space {
          0% { height: 0; }
          10%, 84% { height: 84px; }
          100% { height: 0; }
        }
        @keyframes ltm-pull-hello-drop {
          0% { transform: translateY(-60px); opacity: 0; }
          14% { transform: translateY(0); opacity: 1; }
          84% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-60px); opacity: 0; }
        }
        @keyframes ltm-pull-hello-bubble {
          0%, 18% { opacity: 0; transform: translateY(3px); }
          26%, 78% { opacity: 1; transform: translateY(0); }
          86%, 100% { opacity: 0; }
        }
      `}</style>
      <span
        className="relative mb-2 block"
        style={{ animation: `ltm-pull-hello-drop ${HELLO_MS_BLOCK}ms ease-out forwards` }}
      >
        <ExplorerClawdBlock anim={trick} />
        {/* Above his head with the tail dropping toward him, as on Home. */}
        <span
          className="absolute block"
          style={{
            left: Math.round(EXPLORER_CLAWD_WIDTH_BLOCK * 0.55),
            bottom: EXPLORER_CLAWD_HEIGHT_BLOCK + 4,
            opacity: 0,
            animation: `ltm-pull-hello-bubble ${HELLO_MS_BLOCK}ms ease-out forwards`,
          }}
        >
          <MoonPixelBubbleBlock text={line} pixel={2} />
        </span>
      </span>
    </div>
  )
}
