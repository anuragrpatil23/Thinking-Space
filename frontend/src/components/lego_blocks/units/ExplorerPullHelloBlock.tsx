import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import ExplorerClawdBlock, { EXPLORER_CLAWD_HEIGHT_BLOCK, EXPLORER_CLAWD_WIDTH_BLOCK } from '@/components/lego_blocks/units/ExplorerClawdBlock'
import MoonPixelBubbleBlock from '@/components/lego_blocks/units/MoonPixelBubbleBlock'
import { nextEncouragementBlock } from '@/services/lego_blocks/units/explorerEncouragementBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'

/* Pull past the end of the file tree and Clawd says hello — pull-to-refresh
   from the Claude iPhone app, turned upside down, with a hello instead of a
   refresh. It used to live at the top; the top is where the greeting and
   search are, and sliding them away on every overscroll was unsettling, so
   the top stays put and the hello is for reaching the end. It also suits
   him better: he climbs up out of the floor instead of hanging from above.

   It is a visible pull, not a hidden trigger: as you pull, the whole
   explorer — greeting, session line, tree — slides up with your fingers,
   one to one up to a stop, and Clawd's head rises out of the gap it leaves
   at the bottom, further the further you pull. Pulling on to the line brings him out right
   there, fingers still down — he pops up, does one of Home's tricks and says
   something kind in a pixel bubble, and the rest of that pull is ignored.
   Letting go short springs everything back and nothing happens. (It used to
   wait for the release; triggering at the line feels more direct.)

   Everything moves by `translate` only: the explorer's children slide and
   this layer (absolute, its top edge riding the tree's bottom) follows, so
   nothing reflows per frame. An earlier version grew a space above the
   header instead, and resizing the panel every wheel event made the pull
   feel heavy. For the same reason it is driven straight on the elements
   (`update`/`release` through a ref) rather than through React state; React
   takes over only for the hello itself. Nothing stays or loops afterwards
   (docs/contracts/ENERGY.md); reduced motion turns it off. */

export interface ExplorerPullHelloHandle {
  /** Raw pull distance past the end, px; reaching `threshold` says hello.
      `glide` eases to it instead of jumping (the trackpad's coarse deltas). */
  update: (pull: number, threshold: number, glide?: boolean) => void
  /** Fingers lifted (or still): short of the line, spring back; re-arms. */
  release: () => void
  /** The pull that matches where the explorer is right now — mid spring-back
      included — so a pull resumed during it continues without a jump. */
  currentPull: () => number
}

const HELLO_MS_BLOCK = 3400
const PULL_REACH_PX_BLOCK = 230
/* One to one up to here, then easing into the reach. */
const PULL_EASE_FROM_PX_BLOCK = 150
const OPEN_HEIGHT_PX_BLOCK = 108
const SPRING_BLOCK = 'cubic-bezier(0.22, 1, 0.36, 1)'
/* A fast trackpad scroll arrives as a few big deltas, and jumping to each
   one read as jerky. Instead each one glides there, briefly; the next delta
   retargets the glide from wherever it is, so a burst blurs into one
   motion while slow pulls stay just behind the fingers. */
const GLIDE_MS_BLOCK = 120
const GLIDE_BLOCK = 'cubic-bezier(0.25, 1, 0.5, 1)'
/* Going back is a real spring: a critically damped one let go from rest,
   x(t) = 1 − (1 + ωt)·e^(−ωt). It leaves gently (a curve starting at full
   speed read as a jolt) and settles without overshoot, and like any spring
   it takes the same time whatever the stretch — so the further you pulled,
   the faster it snaps back. (Scaling the time with distance did the
   opposite and made long pulls drag.) */
const SETTLE_MS_BLOCK = 450
const SETTLE_BLOCK = (() => {
  const omega = 7.4 // ≈99.5% home at the end of SETTLE_MS_BLOCK
  const stops: string[] = []
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24
    const x = i === 24 ? 1 : 1 - (1 + omega * t) * Math.exp(-omega * t)
    stops.push(x.toFixed(4))
  }
  return `linear(${stops.join(', ')})`
})()
/* Walked in order, so each hello shows a different trick. */
const TRICKS_BLOCK: readonly MoonSceneAnimationBlock[] = ['wave', 'skate', 'dance', 'wizard', 'cheer', 'hop', 'spin', 'backflip']

function prefersReducedMotionBlock(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

interface ExplorerPullHelloProps {
  /** The explorer root: every child but this layer slides with the pull. It
      must be `relative overflow-hidden`. */
  containerRef: RefObject<HTMLElement | null>
  onHello?: () => void
}

const ExplorerPullHelloBlock = forwardRef<ExplorerPullHelloHandle, ExplorerPullHelloProps>(
  function ExplorerPullHelloBlock({ containerRef, onHello }, ref) {
    const spaceRef = useRef<HTMLDivElement | null>(null)
    const peekRef = useRef<HTMLSpanElement | null>(null)
    /* This pull already said hello; the rest of it is ignored. */
    const spentRef = useRef(false)
    const [hello, setHello] = useState<{ count: number; line: string; trick: MoonSceneAnimationBlock } | null>(null)
    const helloRef = useRef(false)
    const countRef = useRef(0)
    const settleTimerRef = useRef<number | null>(null)

    /* Where the explorer is right now, mid-animation included: the layer
       rides the tree's bottom edge, so its live translate is the offset. */
    function liveOffsetBlock(): number {
      const space = spaceRef.current
      if (!space) return 0
      const live = getComputedStyle(space).translate.split(' ')
      return Math.max(0, OPEN_HEIGHT_PX_BLOCK - (Number.parseFloat(live[1] ?? '') || OPEN_HEIGHT_PX_BLOCK))
    }

    /* Slides the explorer's contents and this layer to `offset` px up,
       springing over `ms` (0 = follow the fingers). */
    function slideBlock(offset: number, ms: number, curve = SPRING_BLOCK) {
      const space = spaceRef.current
      const container = containerRef.current
      if (!space || !container) return
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
      const transition = ms ? `translate ${ms}ms ${curve}` : 'none'
      const moving: HTMLElement[] = [space]
      for (const child of Array.from(container.children)) {
        if (child !== space && child instanceof HTMLElement) moving.push(child)
      }
      for (const el of moving) {
        el.style.willChange = 'translate'
        el.style.transition = transition
      }
      for (const el of moving) {
        el.style.translate = el === space ? `0 ${OPEN_HEIGHT_PX_BLOCK - offset}px` : offset ? `0 ${-offset}px` : ''
      }
      /* Back at rest: drop the layer hints so nothing stays composited. */
      if (offset === 0) {
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null
          for (const el of moving) {
            el.style.willChange = ''
            el.style.transition = ''
          }
        }, ms + 40)
      }
    }

    useImperativeHandle(ref, () => ({
      update(pull, threshold, glide = false) {
        if (helloRef.current || spentRef.current || prefersReducedMotionBlock()) return
        const peek = peekRef.current
        if (!peek) return
        if (pull >= threshold) {
          spentRef.current = true
          sayHelloBlock(peek)
          return
        }
        /* Tracks the fingers exactly — a rubber band's resistance made the
           pull feel like it was fighting back — then eases into the reach
           instead of stopping dead: a hard stop left the last stretch of the
           pull (to the line) frozen, which read as a stutter. */
        const lead = Math.max(0, pull)
        const tail = PULL_REACH_PX_BLOCK - PULL_EASE_FROM_PX_BLOCK
        const offset = lead <= PULL_EASE_FROM_PX_BLOCK
          ? lead
          : PULL_EASE_FROM_PX_BLOCK + tail * (1 - Math.exp(-(lead - PULL_EASE_FROM_PX_BLOCK) / (tail * 2.5)))  // inverse in currentPull
        slideBlock(offset, glide ? GLIDE_MS_BLOCK : 0, GLIDE_BLOCK)
        /* He rises as soon as the gap fits him and stands there, quiet, for
           the rest of the pull — you see him well before anything happens. */
        const rise = Math.min(1, offset / (EXPLORER_CLAWD_HEIGHT_BLOCK + 14))
        peek.style.transition = glide ? `transform ${GLIDE_MS_BLOCK}ms ${GLIDE_BLOCK}, opacity ${GLIDE_MS_BLOCK}ms ${GLIDE_BLOCK}` : 'none'
        peek.style.transform = `translateY(${Math.round((1 - rise) * (EXPLORER_CLAWD_HEIGHT_BLOCK + 6))}px)`
        /* Brightens from the moment he is fully up to the line, so the
           rest of the pull visibly still counts. (Starting at the ease
           point left only the last 10px once the line moved to 160.) */
        const risen = EXPLORER_CLAWD_HEIGHT_BLOCK + 14
        const near = Math.max(0, (lead - risen) / Math.max(1, threshold - risen))
        peek.style.opacity = String(Math.min(1, rise * (0.6 + 0.4 * near)))
      },
      release() {
        spentRef.current = false
        const peek = peekRef.current
        if (!peek || helloRef.current) return
        const ms = SETTLE_MS_BLOCK
        slideBlock(0, ms, SETTLE_BLOCK)
        /* He sinks with the explorer and is gone a little before it lands. */
        peek.style.transition = `transform ${ms}ms ${SETTLE_BLOCK}, opacity ${Math.round(ms * 0.7)}ms ease-out`
        peek.style.transform = `translateY(${EXPLORER_CLAWD_HEIGHT_BLOCK + 6}px)`
        peek.style.opacity = '0'
      },
      currentPull() {
        if (helloRef.current) return 0
        const offset = liveOffsetBlock()
        if (offset <= PULL_EASE_FROM_PX_BLOCK) return offset
        const tail = PULL_REACH_PX_BLOCK - PULL_EASE_FROM_PX_BLOCK
        const eased = Math.min(0.99, (offset - PULL_EASE_FROM_PX_BLOCK) / tail)
        return PULL_EASE_FROM_PX_BLOCK - tail * 2.5 * Math.log(1 - eased)
      },
    }), [onHello])  // eslint-disable-line react-hooks/exhaustive-deps -- the helpers read refs only

    function sayHelloBlock(peek: HTMLSpanElement) {
      helloRef.current = true
      countRef.current += 1
      slideBlock(OPEN_HEIGHT_PX_BLOCK, 260)
      peek.style.transition = 'none'
      peek.style.opacity = '0'
      setHello({
        count: countRef.current,
        line: nextEncouragementBlock(),
        trick: TRICKS_BLOCK[(countRef.current - 1) % TRICKS_BLOCK.length],
      })
      onHello?.()
      window.setTimeout(() => {
        slideBlock(0, SETTLE_MS_BLOCK, SETTLE_BLOCK)
        window.setTimeout(() => {
          helloRef.current = false
          setHello(null)
        }, SETTLE_MS_BLOCK + 20)
      }, HELLO_MS_BLOCK)
    }

    return (
      <div
        ref={spaceRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center overflow-hidden"
        style={{ height: OPEN_HEIGHT_PX_BLOCK, translate: `0 ${OPEN_HEIGHT_PX_BLOCK}px` }}
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
