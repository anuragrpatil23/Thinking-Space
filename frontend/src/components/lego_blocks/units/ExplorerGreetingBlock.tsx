import { useEffect, useState } from 'react'
import ExplorerClawdBlock, {
  EXPLORER_INLINE_CLAWD_SCALE_BLOCK,
  EXPLORER_INLINE_CLAWD_WIDTH_BLOCK,
} from '@/components/lego_blocks/units/ExplorerClawdBlock'
import { explorerGreetingPartsBlock } from '@/services/lego_blocks/units/explorerGreetingBlock'
import { cn } from '@/lib/utils'

/* "Good evening, Anurag" — and, once per session, Clawd from the Home moon
   scene slides in from the right into the space at the end of the row,
   waves (Home's own wave), and slides back out, so the greeting itself never
   moves. (Pulling past the top of the tree is ExplorerPullHelloBlock.) A hello, not a resident: the explorer sits
   beside everything you work on, so nothing here stays or loops
   (docs/contracts/ENERGY.md). With reduced motion on he does not appear.
   The pull-past-the-top hello is ExplorerPullHelloBlock. */

const GREETED_SESSION_KEY_BLOCK = 'thinkspc:explorer-greeted'
const GREETING_MS_BLOCK = 2600

function shouldGreetBlock(): boolean {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    return window.sessionStorage.getItem(GREETED_SESSION_KEY_BLOCK) !== '1'
  } catch {
    return false
  }
}

export default function ExplorerGreetingBlock({
  name,
  large = false,
  dismissNonce = 0,
  className,
}: {
  name?: string | null
  /** iOS large-title size (at rest at the top of the explorer). */
  large?: boolean
  /** Changing this sends him off at once: only one Clawd on screen, so the
      drop-in from the top dismisses this one. */
  dismissNonce?: number
  className?: string
}) {
  const [greeting, setGreeting] = useState(shouldGreetBlock)


  useEffect(() => {
    if (dismissNonce > 0) setGreeting(false)
  }, [dismissNonce])
  const parts = explorerGreetingPartsBlock(name)

  useEffect(() => {
    if (!greeting) return
    try {
      window.sessionStorage.setItem(GREETED_SESSION_KEY_BLOCK, '1')
    } catch {
      /* Without storage he may greet again next mount; harmless. */
    }
  }, [greeting])

  return (
    <div className={cn('flex min-w-0 items-center', className)}>
      <style>{`
        @keyframes ltm-greeter-slot {
          0% { width: 0; }
          10%, 82% { width: ${EXPLORER_INLINE_CLAWD_WIDTH_BLOCK + 6}px; }
          100% { width: 0; }
        }
        @keyframes ltm-greeter-clawd {
          0% { transform: translateX(28px); opacity: 0; }
          14% { transform: translateX(0); opacity: 1; }
          80% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(28px); opacity: 0; }
        }
      `}</style>
      {/* One tone, the app's own weight at both sizes: a two-tone line made
          the name shout, and a light weight read as a different typeface. */}
      <span
        className={cn(
          'min-w-0 truncate text-foreground/85 transition-[font-size,letter-spacing] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          large ? 'text-[20px] font-medium tracking-[-0.015em]' : 'text-[15px] font-medium tracking-[-0.005em]',
        )}
      >
        {parts.name ? `${parts.greeting}, ${parts.name}` : parts.greeting}
      </span>
      {greeting && (
        <span
          aria-hidden="true"
          /* At the far end of the row, in the open space before the icons.
             Clipped sideways only, so his hop is never cut off at the top. */
          /* mr-5: he visits the greeting; tight against the toolbar icons he
             read as a fourth button. */
          className="ml-auto mr-5 inline-flex shrink-0 items-end [overflow-x:clip] [overflow-y:visible]"
          style={{ width: 0, animation: `ltm-greeter-slot ${GREETING_MS_BLOCK}ms cubic-bezier(0.3, 0.7, 0.3, 1) forwards` }}
          onAnimationEnd={(event) => {
            if (event.animationName === 'ltm-greeter-slot') setGreeting(false)
          }}
        >
          <span
            className="block"
            style={{ animation: `ltm-greeter-clawd ${GREETING_MS_BLOCK}ms ease-out forwards` }}
          >
            <ExplorerClawdBlock anim="wave" scale={EXPLORER_INLINE_CLAWD_SCALE_BLOCK} />
          </span>
        </span>
      )}
    </div>
  )
}
