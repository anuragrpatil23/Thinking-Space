import { memo, useEffect, useRef } from 'react'
import type { CanvasTile } from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'
import CanvasWebWidgetBlock from './CanvasWebWidgetBlock'
import { POST_IT_PALETTE } from './postItPaletteBlock'

interface Props {
  tile: CanvasTile
  focused: boolean
  scale: number
  /** True when the tile is off-canvas viewport; used to suspend web widgets. */
  offscreen: boolean
  /** Increment to force-reload a web-widget tile's underlying webview. */
  reloadKey: number
  onFocus: (id: string) => void
  onBlur: () => void
  onHoverChange: (id: string | null) => void
  onChange: (id: string, text: string) => void
  onResize: (id: string, w: number, h: number) => void
  onRemove: (id: string) => void
}

function CanvasTileBlockImpl({
  tile,
  focused,
  scale,
  offscreen,
  reloadKey,
  onFocus,
  onBlur,
  onHoverChange,
  onChange,
  onResize,
  onRemove,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (focused && tile.type === 'post-it') {
      textareaRef.current?.focus()
    }
  }, [focused, tile.type])

  // Click tile body → focus. Movement is driven by the toolbar's drag handle.
  const handleBodyMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!focused) onFocus(tile.id)
  }

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const origW = tile.w
    const origH = tile.h
    const id = tile.id

    const onPointerMove = (ev: PointerEvent) => {
      const dw = (ev.clientX - startX) / scale
      const dh = (ev.clientY - startY) / scale
      onResize(id, origW + dw, origH + dh)
    }
    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
    }
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      if (tile.type === 'post-it' && tile.text.trim() === '') {
        onRemove(tile.id)
      } else {
        onBlur()
        textareaRef.current?.blur()
      }
    }
  }

  const theme = useCanvasThemeBlock()
  const isPostIt = tile.type === 'post-it'
  const palette = isPostIt ? POST_IT_PALETTE[tile.color] : null
  const postItFontSizePx = (() => {
    if (!isPostIt) return 13
    if (typeof tile.fontSize === 'number') return tile.fontSize
    if (tile.fontSize === 's') return 11
    if (tile.fontSize === 'l') return 17
    return 13
  })()

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: tile.x,
    top: tile.y,
    width: tile.w,
    height: tile.h,
    padding: isPostIt ? 16 : 0,
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
    zIndex: focused ? 10 : 1,
    cursor: focused ? (isPostIt ? 'text' : 'default') : 'pointer',
    overflow: 'hidden',
  }

  const skinStyle: React.CSSProperties = {
    borderRadius: 12,
    background: theme.tileBg,
    border: `1px solid ${focused ? theme.tileBorderFocused : theme.tileBorder}`,
    boxShadow: focused ? theme.tileShadowFocused : theme.tileShadow,
    ...(isPostIt ? { paddingTop: 22 } : {}),
  }

  return (
    <div
      data-canvas-tile="true"
      onMouseDown={handleBodyMouseDown}
      onMouseEnter={() => onHoverChange(tile.id)}
      onMouseLeave={() => onHoverChange(null)}
      style={{ ...baseStyle, ...skinStyle }}
    >
      {isPostIt && palette && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            width: 8,
            height: 8,
            borderRadius: 2,
            background: palette.cornerMark,
            opacity: 0.85,
            pointerEvents: 'none',
          }}
        />
      )}

      {tile.type === 'web-widget' ? (
        <CanvasWebWidgetBlock tile={tile} suspended={offscreen} reloadKey={reloadKey} />
      ) : isPostIt ? (
        focused ? (
          <textarea
            ref={textareaRef}
            value={tile.text}
            onChange={e => onChange(tile.id, e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type something…"
            style={{
              width: '100%',
              height: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color:
                isPostIt && tile.textColor
                  ? POST_IT_PALETTE[tile.textColor].cornerMark
                  : theme.tileText,
              fontSize: postItFontSizePx,
              lineHeight: 1.5,
              fontFamily: 'inherit',
              padding: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              color: tile.text
                ? isPostIt && tile.textColor
                  ? POST_IT_PALETTE[tile.textColor].cornerMark
                  : theme.tileText
                : theme.tileTextMuted,
              fontSize: postItFontSizePx,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            {tile.text || 'Type something…'}
          </div>
        )
      ) : tile.type === 'note' ? (
        <NoteTileContent filePath={tile.filePath} fontSize={tile.fontSize ?? 'm'} />
      ) : null}

      {/* Resize affordance — invisible hit-target at bottom-right corner. */}
      <div
        onPointerDown={handleResizePointerDown}
        aria-label="Resize"
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
        }}
      />
    </div>
  )
}

function deriveNoteTitle(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath
  return name.replace(/\.md$/i, '')
}

function NoteTileContent({
  filePath,
  fontSize,
}: {
  filePath: string
  fontSize: 's' | 'm' | 'l' | number
}) {
  const theme = useCanvasThemeBlock()
  const title = deriveNoteTitle(filePath)
  const fontPx = (() => {
    if (typeof fontSize === 'number') return fontSize
    if (fontSize === 's') return 11
    if (fontSize === 'l') return 15
    return 12
  })()
  return (
    <div
      className={theme.isDark ? 'dark' : ''}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        // Consumed by the `[data-canvas-tile] .prose` CSS override below to
        // shrink markdown content to fit a tile-sized viewport.
        ['--canvas-md-font-size' as string]: `${fontPx}px`,
      }}
    >
      <div
        title={filePath}
        style={{
          padding: '8px 14px',
          borderBottom: `1px solid ${theme.tileBorder}`,
          background: theme.toolbarBg,
          color: theme.tileTextMuted,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.01em',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          lineHeight: 1.35,
          flexShrink: 0,
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <MarkdownDocumentBlock path={filePath} active topBarHidden />
      </div>
    </div>
  )
}

const CanvasTileBlock = memo(CanvasTileBlockImpl)
export default CanvasTileBlock
