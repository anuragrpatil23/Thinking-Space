import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { deviceCanHoverBlock } from '@/services/lego_blocks/units/hoverCapabilityBlock'

// The app's hover tooltip: a dark card anchored to the *cursor*, not to the
// trigger's box. That distinction is the whole reason this exists — the explorer
// row it was built for is full-width, so a box-anchored tooltip would fling
// itself far from where you are actually pointing. It opens on a delay, follows
// the cursor position at open time, and clamps into the viewport before paint.
//
// Extracted from VaultExplorerBlock so other hover surfaces (the density strip)
// speak the same language instead of inventing a second tooltip.

const SHOW_DELAY_MS = 400
const CURSOR_OFFSET = { x: 18, y: 32 }
const VIEWPORT_PAD = 8

interface Props {
  /** Tooltip body. Renders nothing when null — a trigger with nothing to say
   *  gets no tooltip rather than an empty card. */
  content: ReactNode
  /** The hover target. Cloned to attach the mouse handlers, so it must be a
   *  single element that forwards DOM props. */
  children: ReactElement
  /** Fired once when the tooltip is about to open — for lazy-loading content. */
  onOpen?: () => void
  /** Opens immediately instead of after the delay. For surfaces where the
   *  tooltip *is* the readout (the density strip) rather than extra detail. */
  instant?: boolean
  /** Called with the cursor position on every move over the trigger, so the
   *  trigger can track what is under the cursor (which bucket, which cell). */
  onMove?: (event: React.MouseEvent) => void
  className?: string
}

export default function CursorTooltipBlock({
  content,
  children,
  onOpen,
  instant = false,
  onMove,
  className,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const cursorRef = useRef({ x: 0, y: 0 })
  const showTimerRef = useRef<number | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const clearShowTimer = () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }

  const handleEnter = (event: React.MouseEvent) => {
    // Touch surfaces synthesize mouseenter on tap and may never deliver the
    // matching mouseleave — the tooltip would appear and stick. Hover-opened
    // overlays are mouse/trackpad-only chrome.
    if (!deviceCanHoverBlock()) return
    cursorRef.current = { x: event.clientX, y: event.clientY }
    clearShowTimer()
    const open = () => {
      onOpen?.()
      setPos(cursorRef.current)
      setVisible(true)
    }
    if (instant) open()
    else showTimerRef.current = window.setTimeout(open, SHOW_DELAY_MS)
  }

  const handleMove = (event: React.MouseEvent) => {
    cursorRef.current = { x: event.clientX, y: event.clientY }
    onMove?.(event)
    // While open, the card tracks the cursor — on a strip you are reading a
    // different bucket with every pixel, so a card frozen where you entered
    // would be labelling the wrong bar.
    if (visible && instant) setPos({ x: event.clientX, y: event.clientY })
  }

  const handleLeave = () => {
    clearShowTimer()
    setVisible(false)
  }

  useEffect(() => () => clearShowTimer(), [])

  // Clamp into the viewport once measured, before paint (no flicker).
  useLayoutEffect(() => {
    if (!visible || !tipRef.current) return
    const rect = tipRef.current.getBoundingClientRect()
    let x = pos.x + CURSOR_OFFSET.x
    let y = pos.y + CURSOR_OFFSET.y
    if (x + rect.width > window.innerWidth - VIEWPORT_PAD) x = pos.x - rect.width - CURSOR_OFFSET.x
    if (x < VIEWPORT_PAD) x = VIEWPORT_PAD
    if (y + rect.height > window.innerHeight - VIEWPORT_PAD) y = pos.y - rect.height - CURSOR_OFFSET.y
    if (y < VIEWPORT_PAD) y = VIEWPORT_PAD
    tipRef.current.style.left = `${x}px`
    tipRef.current.style.top = `${y}px`
  }, [visible, pos, content])

  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        onMouseEnter: handleEnter,
        onMouseMove: handleMove,
        onMouseLeave: handleLeave,
      })
    : children

  return (
    <>
      {trigger}
      {visible && content
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              className={cn(
                'pointer-events-none fixed z-[70] max-w-[340px] rounded-lg border border-white/10 bg-zinc-900/95',
                'px-3 py-2.5 text-[12.5px] leading-relaxed text-zinc-100 shadow-xl shadow-black/40 backdrop-blur-sm',
                className,
              )}
              style={{ left: pos.x + CURSOR_OFFSET.x, top: pos.y + CURSOR_OFFSET.y }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
