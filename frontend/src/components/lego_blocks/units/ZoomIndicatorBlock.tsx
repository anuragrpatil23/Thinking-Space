import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'

interface Props {
  scale: number
  onReset: () => void
  edgeInset?: number
  minimapHeight?: number
}

export default function ZoomIndicatorBlock({
  scale,
  onReset,
  edgeInset = 24,
  minimapHeight = 100,
}: Props) {
  const theme = useCanvasThemeBlock()
  return (
    <button
      onClick={onReset}
      aria-label="Reset zoom"
      style={{
        position: 'absolute',
        bottom: edgeInset + minimapHeight + 8,
        right: edgeInset,
        padding: '6px 10px',
        background: theme.toolbarBg,
        border: `1px solid ${theme.toolbarBorder}`,
        borderRadius: 8,
        color: theme.toolbarTextMuted,
        fontSize: 11,
        lineHeight: 1.3,
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 12, color: theme.toolbarText }}>
        {Math.round(scale * 100)}%
      </div>
      <div style={{ opacity: 0.55, fontSize: 10 }}>reset</div>
    </button>
  )
}
