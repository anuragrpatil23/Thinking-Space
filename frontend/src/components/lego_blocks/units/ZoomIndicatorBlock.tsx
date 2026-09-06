import { useState } from 'react'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'

interface Props {
  scale: number
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  /** Current clamp range — used to fade a step control once it can't move
   * further, so the dead press is visible before it happens. */
  minScale: number
  maxScale: number
  edgeInset?: number
  minimapHeight?: number
}

/** One flat glass pill: −, the live percentage, +. The percentage doubles as
 * the reset button; the word "reset" only replaces it on hover, so the resting
 * state stays a single line of numbers instead of a two-line label block. */
export default function ZoomIndicatorBlock({
  scale,
  onReset,
  onZoomIn,
  onZoomOut,
  minScale,
  maxScale,
  edgeInset = 24,
  minimapHeight = 100,
}: Props) {
  const theme = useCanvasThemeBlock()
  const [hovered, setHovered] = useState<'in' | 'out' | 'reset' | null>(null)

  // Float epsilon: after a few multiplicative steps the clamped scale lands a
  // hair off the bound, which would otherwise leave the button live forever.
  const atMin = scale <= minScale + 0.001
  const atMax = scale >= maxScale - 0.001

  const step = (disabled: boolean, isHovered: boolean): React.CSSProperties => ({
    width: 26,
    height: 26,
    display: 'grid',
    placeItems: 'center',
    background: isHovered && !disabled ? theme.toolbarHighlight : 'transparent',
    border: 'none',
    borderRadius: 999,
    color: theme.toolbarText,
    fontSize: 15,
    lineHeight: 1,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.22 : isHovered ? 1 : 0.6,
    transition: 'opacity 140ms ease, background 140ms ease',
    padding: 0,
  })

  return (
    <div
      style={{
        position: 'absolute',
        bottom: edgeInset + minimapHeight + 8,
        right: edgeInset,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        padding: 3,
        background: theme.toolbarBg,
        border: `1px solid ${theme.toolbarBorder}`,
        borderRadius: 999,
        boxShadow: theme.tileShadow,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        userSelect: 'none',
      }}
    >
      <button
        onClick={onZoomOut}
        onPointerEnter={() => setHovered('out')}
        onPointerLeave={() => setHovered(null)}
        disabled={atMin}
        aria-label="Zoom out"
        title="Zoom out"
        style={step(atMin, hovered === 'out')}
      >
        −
      </button>

      <button
        onClick={onReset}
        onPointerEnter={() => setHovered('reset')}
        onPointerLeave={() => setHovered(null)}
        aria-label="Reset zoom"
        title="Reset zoom"
        style={{
          // Fixed width + tabular figures: the pill must not breathe as the
          // percentage crosses 99 → 100 during a pinch.
          width: 52,
          height: 26,
          display: 'grid',
          placeItems: 'center',
          background: hovered === 'reset' ? theme.toolbarHighlight : 'transparent',
          border: 'none',
          borderRadius: 999,
          color: hovered === 'reset' ? theme.toolbarTextMuted : theme.toolbarText,
          fontSize: hovered === 'reset' ? 10 : 12,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: hovered === 'reset' ? '0.06em' : 0,
          textTransform: hovered === 'reset' ? 'uppercase' : 'none',
          lineHeight: 1,
          cursor: 'pointer',
          transition: 'background 140ms ease, color 140ms ease',
          padding: 0,
        }}
      >
        {hovered === 'reset' ? 'reset' : `${Math.round(scale * 100)}%`}
      </button>

      <button
        onClick={onZoomIn}
        onPointerEnter={() => setHovered('in')}
        onPointerLeave={() => setHovered(null)}
        disabled={atMax}
        aria-label="Zoom in"
        title="Zoom in"
        style={step(atMax, hovered === 'in')}
      >
        +
      </button>
    </div>
  )
}
