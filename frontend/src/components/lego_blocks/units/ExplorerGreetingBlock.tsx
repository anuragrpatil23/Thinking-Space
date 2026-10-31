import { useEffect, useState } from 'react'
import ExplorerClawdBlock, {
  EXPLORER_INLINE_CLAWD_SCALE_BLOCK,
  EXPLORER_INLINE_CLAWD_WIDTH_BLOCK,
} from '@/components/lego_blocks/units/ExplorerClawdBlock'
import MoonPixelBubbleBlock from '@/components/lego_blocks/units/MoonPixelBubbleBlock'
import { nextEncouragementBlock } from '@/services/lego_blocks/units/explorerEncouragementBlock'
import { explorerGreetingPartsBlock } from '@/services/lego_blocks/units/explorerGreetingBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'
import { cn } from '@/lib/utils'

/* "Good evening, Anurag" — and, once per session, Clawd from the Home moon
   scene slides in from the right into the space at the end of the row,
   waves (Home's own wave), and slides back out, so the greeting itself never
   moves. The easter egg (keep scrolling up at the top of the tree, counted
   by topNudgeCounterBlock) brings him back to the same spot, doing one of
   Home's tricks with something kind in a pixel bubble to his left. (It
   used to drop in over the top of the tree; here it matches the hi.)
   A hello, not a resident: the explorer sits beside everything you work
   on, so nothing here stays or loops (docs/contracts/ENERGY.md). With
   reduced motion on he does not appear. */

const GREETED_SESSION_KEY_BLOCK = 'thinkspc:explorer-greeted'
const GREETING_MS_BLOCK = 2600
const HELLO_MS_BLOCK = 3800
/* Walked in order, so each easter-egg hello shows a different trick. */
const TRICKS_BLOCK: readonly MoonSceneAnimationBlock[] = ['wave', 'skate', 'dance', 'wizard', 'cheer', 'hop', 'spin', 'backflip']

/* Some tricks reach past his body: skate shuttles ±29px at this size and
   the wizard's wand and sparkles stick out ~13px to the right. The slot
   clips sideways (so the hi slides in from nowhere), and a clip his own
   width cut them off — skate showed a hard edge. So easter-egg tricks clip
   wider than the slot (it keeps its layout width, so the greeting never
   gives up room), and the wide ones start further left, clear of ＋.
   `shift` moves him left; `left`/`right` widen the clip; `bubble` moves
   the line left past where he goes. */
interface TrickRoomBlock { shift: number; left: number; right: number; bubble: number }
const TRICK_ROOM_BLOCK: Partial<Record<MoonSceneAnimationBlock, TrickRoomBlock>> = {
  skate: { shift: 14, left: 48, right: 18, bubble: 30 },
  wizard: { shift: 10, left: 14, right: 18, bubble: 0 },
}
const EASTER_ROOM_BLOCK: TrickRoomBlock = { shift: 0, left: 10, right: 12, bubble: 0 }
const HI_ROOM_BLOCK: TrickRoomBlock = { shift: 0, left: 0, right: 0, bubble: 0 }

function prefersReducedMotionBlock(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

function shouldGreetBlock(): boolean {
  try {
    if (prefersReducedMotionBlock()) return false
    return window.sessionStorage.getItem(GREETED_SESSION_KEY_BLOCK) !== '1'
  } catch {
    return false
  }
}

export default function ExplorerGreetingBlock({
  name,
  large = false,
  helloNonce = 0,
  className,
}: {
  name?: string | null
  /** iOS large-title size (at rest at the top of the explorer). */
  large?: boolean
  /** Each change brings him back for the easter-egg hello. */
  helloNonce?: number
  className?: string
}) {
  /* The once-per-session hi, or an easter-egg hello (trick + line). */
  const [visit, setVisit] = useState<{ key: number; anim: MoonSceneAnimationBlock; line: string | null } | null>(
    () => (shouldGreetBlock() ? { key: 0, anim: 'wave', line: null } : null),
  )

  useEffect(() => {
    if (helloNonce <= 0 || prefersReducedMotionBlock()) return
    setVisit({ key: helloNonce, anim: TRICKS_BLOCK[(helloNonce - 1) % TRICKS_BLOCK.length], line: nextEncouragementBlock() })
  }, [helloNonce])
  const parts = explorerGreetingPartsBlock(name)

  useEffect(() => {
    if (visit?.key !== 0) return
    try {
      window.sessionStorage.setItem(GREETED_SESSION_KEY_BLOCK, '1')
    } catch {
      /* Without storage he may greet again next mount; harmless. */
    }
  }, [visit])
  const ms = visit?.line ? HELLO_MS_BLOCK : GREETING_MS_BLOCK
  const room = !visit?.line ? HI_ROOM_BLOCK : TRICK_ROOM_BLOCK[visit.anim] ?? EASTER_ROOM_BLOCK

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
        @keyframes ltm-greeter-bubble {
          0%, 14% { opacity: 0; transform: translateY(3px); }
          22%, 76% { opacity: 1; transform: translateY(0); }
          86%, 100% { opacity: 0; }
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
      {visit && (
        /* At the far end of the row, in the open space before the icons.
           mr-5: he visits the greeting; tight against the toolbar icons he
           read as a fourth button. */
        <span key={visit.key} aria-hidden="true" className="pointer-events-none relative ml-auto mr-5 inline-flex shrink-0">
          <span
            /* Clipped sideways only, so his hop is never cut off at the top. */
            className="inline-flex items-end"
            style={{
              width: 0,
              clipPath: `inset(-200px ${-room.right}px -200px ${-room.left}px)`,
              animation: `ltm-greeter-slot ${ms}ms cubic-bezier(0.3, 0.7, 0.3, 1) forwards`,
            }}
            onAnimationEnd={(event) => {
              if (event.animationName === 'ltm-greeter-slot') setVisit(null)
            }}
          >
            <span
              className="relative block"
              style={{ left: -room.shift, animation: `ltm-greeter-clawd ${ms}ms ease-out forwards` }}
            >
              <ExplorerClawdBlock anim={visit.anim} scale={EXPLORER_INLINE_CLAWD_SCALE_BLOCK} />
            </span>
          </span>
          {visit.line && (
            /* To his left, over the greeting, the tail dropping toward him. */
            <span
              className="absolute bottom-1/2 z-10 block"
              style={{
                right: EXPLORER_INLINE_CLAWD_WIDTH_BLOCK + 2 + room.shift + room.bubble,
                opacity: 0,
                animation: `ltm-greeter-bubble ${ms}ms ease-out forwards`,
              }}
            >
              <MoonPixelBubbleBlock text={visit.line} pixel={2} tail="right" />
            </span>
          )}
        </span>
      )}
    </div>
  )
}
