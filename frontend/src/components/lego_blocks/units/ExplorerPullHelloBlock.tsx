import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import ExplorerClawdBlock, { EXPLORER_CLAWD_HEIGHT_BLOCK, EXPLORER_CLAWD_WIDTH_BLOCK } from '@/components/lego_blocks/units/ExplorerClawdBlock'
import MoonPixelBubbleBlock from '@/components/lego_blocks/units/MoonPixelBubbleBlock'
import { nextEncouragementBlock } from '@/services/lego_blocks/units/explorerEncouragementBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'

/* Pull past the top of the file tree and Clawd says hello — pull-to-refresh
   from the Claude iPhone app, with a hello instead of a refresh.

   It is a visible pull, not a hidden trigger: as you pull, a space opens
   above the header on a rubber band and Clawd's head rises into it, further
   the further you pull. Letting go past the line commits — he pops up, does
   one of Home's tricks and says something kind in a pixel bubble; letting go
   short springs the space shut and nothing happens. That release rule is what
   makes it feel intended rather than accidental.

   The pull moves every frame, so it is driven straight on the elements
   (`update`/`release` through a ref) rather than through React state — a
   render of the whole explorer per wheel event would make the pull feel
   heavy. React takes over only for the hello itself. Nothing stays or loops
   afterwards (docs/contracts/ENERGY.md); reduced motion turns it off. */

export interface ExplorerPullHelloHandle {
  /** Raw pull distance past the top, px; `threshold` is the commit line. */
  update: (pull: number, threshold: number) => void
  /** Fingers lifted: commit if past the line, otherwise spring shut. */
  release: () => void
}

const HELLO_MS_BLOCK = 3400
const PULL_REACH_PX_BLOCK = 72
const OPEN_HEIGHT_PX_BLOCK = 84
const SPRING_BLOCK = 'cubic-bezier(0.22, 1, 0.36, 1)'
/* Walked in order, so each hello shows a different trick. */
const TRICKS_BLOCK: readonly MoonSceneAnimationBlock[] = ['wave', 'skate', 'dance', 'wizard', 'cheer', 'hop', 'spin', 'backflip']

function prefersReducedMotionBlock(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

/* The pull follows the fingers with growing resistance and never passes
   `reach` — the iOS rubber band. */
function rubberBandBlock(pull: number, reach: number): number {
  return (1 - 1 / ((pull * 0.55) / reach + 1)) * reach
}

const ExplorerPullHelloBlock = forwardRef<ExplorerPullHelloHandle, { onHello?: () => void }>(
  function ExplorerPullHelloBlock({ onHello }, ref) {
    const spaceRef = useRef<HTMLDivElement | null>(null)
    const peekRef = useRef<HTMLSpanElement | null>(null)
    const progressRef = useRef(0)
    const [hello, setHello] = useState<{ count: number; line: string; trick: MoonSceneAnimationBlock } | null>(null)
    const helloRef = useRef(false)
    const countRef = useRef(0)

    useImperativeHandle(ref, () => ({
      update(pull, threshold) {
        if (helloRef.current || prefersReducedMotionBlock()) return
        const space = spaceRef.current
        const peek = peekRef.current
        if (!space || !peek) return
        const progress = Math.max(0, Math.min(1, pull / threshold))
        progressRef.current = progress
        space.style.transition = 'none'
        space.style.height = `${rubberBandBlock(Math.max(0, pull), PULL_REACH_PX_BLOCK)}px`
        peek.style.transition = 'none'
        /* His head rises with the pull; at the line he is fully up, the cue
           that letting go now will bring him out. */
        peek.style.transform = `translateY(${Math.round((1 - progress) * (EXPLORER_CLAWD_HEIGHT_BLOCK + 6))}px)`
        peek.style.opacity = String(Math.min(1, progress * 1.4))
      },
      release() {
        const space = spaceRef.current
        const peek = peekRef.current
        if (!space || !peek || helloRef.current) return
        const committed = progressRef.current >= 1
        progressRef.current = 0
        if (!committed) {
          space.style.transition = `height 320ms ${SPRING_BLOCK}`
          space.style.height = '0px'
          peek.style.transition = `transform 320ms ${SPRING_BLOCK}, opacity 200ms ease-out`
          peek.style.transform = `translateY(${EXPLORER_CLAWD_HEIGHT_BLOCK + 6}px)`
          peek.style.opacity = '0'
          return
        }
        helloRef.current = true
        countRef.current += 1
        space.style.transition = `height 260ms ${SPRING_BLOCK}`
        space.style.height = `${OPEN_HEIGHT_PX_BLOCK}px`
        peek.style.transition = 'none'
        peek.style.opacity = '0'
        setHello({
          count: countRef.current,
          line: nextEncouragementBlock(),
          trick: TRICKS_BLOCK[(countRef.current - 1) % TRICKS_BLOCK.length],
        })
        onHello?.()
        window.setTimeout(() => {
          space.style.transition = `height 360ms ${SPRING_BLOCK}`
          space.style.height = '0px'
          window.setTimeout(() => {
            helloRef.current = false
            setHello(null)
          }, 380)
        }, HELLO_MS_BLOCK)
      },
    }), [onHello])

    return (
      <div
        ref={spaceRef}
        aria-hidden="true"
        className="relative flex items-end justify-center overflow-hidden"
        style={{ height: 0 }}
      >
        <style>{`
          @keyframes ltm-pull-hello-pop {
            0% { transform: translateY(14px); }
            40% { transform: translateY(-6px); }
            70%, 100% { transform: translateY(0); }
          }
          @keyframes ltm-pull-hello-bubble {
            0%, 10% { opacity: 0; transform: translateY(3px); }
            20%, 82% { opacity: 1; transform: translateY(0); }
            94%, 100% { opacity: 0; }
          }
        `}</style>
        {/* The peek: his head rising during the pull. */}
        <span ref={peekRef} className="mb-2 block" style={{ opacity: 0 }}>
          {!hello && <ExplorerClawdBlock anim="none" />}
        </span>
        {hello && (
          <span
            key={hello.count}
            className="absolute bottom-2 left-1/2 block"
            style={{ marginLeft: -EXPLORER_CLAWD_WIDTH_BLOCK / 2, animation: `ltm-pull-hello-pop 520ms ${SPRING_BLOCK} both` }}
          >
            <ExplorerClawdBlock anim={hello.trick} />
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
              <MoonPixelBubbleBlock text={hello.line} pixel={2} />
            </span>
          </span>
        )}
      </div>
    )
  },
)

export default ExplorerPullHelloBlock
