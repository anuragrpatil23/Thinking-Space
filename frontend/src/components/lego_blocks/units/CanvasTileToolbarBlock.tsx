import { Move, Copy, Trash2, Droplet, ArrowUpRight, RefreshCw, Timer, Info, FolderInput } from 'lucide-react'
import { HOME_CANVAS_PATH } from '@/services/lego_blocks/integrations/homeCanvasStorageBlock'
import { useEffect, useState } from 'react'
import type {
  CanvasTile,
  PostItFontSize,
} from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import {
  POST_IT_COLORS,
  POST_IT_PALETTE,
  type PostItColor,
} from './postItPaletteBlock'

interface Props {
  tile: CanvasTile
  screenX: number
  screenY: number
  /** World-space scale, used to convert screen drag delta → world delta. */
  scale: number
  onMove: (id: string, x: number, y: number) => void
  onSetColor: (id: string, color: PostItColor) => void
  onSetFontSize: (id: string, fontSize: PostItFontSize) => void
  onSetTextColor: (id: string, textColor: PostItColor | undefined) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  onOpenInPage?: (filePath: string) => void
  /** Post-its only: open the save-to-vault dialog for this tile. */
  onSaveToVault?: (id: string) => void
  onRefreshWidget?: (id: string) => void
  onSetWidgetRefreshSec?: (id: string, refreshSec: number | undefined) => void
}

const WIDGET_REFRESH_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Off', value: undefined },
  { label: '5s', value: 5 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 },
]

function formatRefreshSec(sec: number | undefined): string {
  if (!sec) return 'Off'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec / 3600)}h`
}

const ICON_SIZE = 16

function formatTimestamp(ms: number | undefined): string {
  if (!ms) return 'Unknown'
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const TILE_TYPE_LABELS: Record<CanvasTile['type'], string> = {
  'post-it': 'Post-it',
  note: 'Note',
  'web-widget': 'Web widget',
}

const FONT_SIZES: { key: Extract<PostItFontSize, 's' | 'm' | 'l'>; px: number }[] = [
  { key: 's', px: 11 },
  { key: 'm', px: 14 },
  { key: 'l', px: 18 },
]

export default function CanvasTileToolbarBlock({
  tile,
  screenX,
  screenY,
  scale,
  onMove,
  onSetColor,
  onSetFontSize,
  onSetTextColor,
  onDuplicate,
  onRemove,
  onOpenInPage,
  onSaveToVault,
  onRefreshWidget,
  onSetWidgetRefreshSec,
}: Props) {
  const theme = useCanvasThemeBlock()
  const [colorOpen, setColorOpen] = useState(false)
  const [moveActive, setMoveActive] = useState(false)
  const [refreshIntervalOpen, setRefreshIntervalOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [fontSizeInput, setFontSizeInput] = useState('')
  const isPostIt = tile.type === 'post-it'
  const isNote = tile.type === 'note'
  const isWidget = tile.type === 'web-widget'
  const supportsFontSize = isPostIt || isNote
  const activeFontSize = supportsFontSize ? tile.fontSize ?? 'm' : 'm'
  const textColor = isPostIt ? tile.textColor : undefined

  useEffect(() => {
    setFontSizeInput(typeof activeFontSize === 'number' ? String(activeFontSize) : '')
  }, [activeFontSize])

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    borderRadius: 6,
    background: 'transparent',
    border: 'none',
    color: theme.toolbarText,
    cursor: 'pointer',
    transition: 'background 120ms ease, color 120ms ease',
    fontFamily: 'inherit',
  }

  const dividerStyle: React.CSSProperties = {
    width: 1,
    alignSelf: 'stretch',
    background: theme.toolbarBorder,
    marginInline: 4,
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        padding: 4,
        background: theme.toolbarBg,
        border: `1px solid ${theme.toolbarBorder}`,
        borderRadius: 10,
        boxShadow: theme.isDark ? '0 10px 30px rgba(0,0,0,0.5)' : '0 10px 30px rgba(20,20,24,0.18)',
        zIndex: 100,
        pointerEvents: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        style={{
          ...buttonStyle,
          color: moveActive ? theme.tileText : theme.toolbarText,
          background: moveActive ? theme.toolbarHighlight : 'transparent',
          cursor: moveActive ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        title="Drag to move"
        aria-label="Drag to move tile"
        aria-pressed={moveActive}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMoveActive(true)
          const startX = e.clientX
          const startY = e.clientY
          const origX = tile.x
          const origY = tile.y
          const id = tile.id
          const onPointerMove = (ev: PointerEvent) => {
            const dx = (ev.clientX - startX) / scale
            const dy = (ev.clientY - startY) / scale
            onMove(id, origX + dx, origY + dy)
          }
          const onPointerUp = () => {
            document.removeEventListener('pointermove', onPointerMove)
            document.removeEventListener('pointerup', onPointerUp)
            setMoveActive(false)
          }
          document.addEventListener('pointermove', onPointerMove)
          document.addEventListener('pointerup', onPointerUp)
        }}
      >
        <Move size={ICON_SIZE} />
      </button>

      {isPostIt && (
        <>
          <div style={dividerStyle} />
          <div style={{ position: 'relative' }}>
            <button
              style={{
                ...buttonStyle,
                color: colorOpen ? theme.tileText : theme.toolbarText,
              }}
              onClick={() => setColorOpen(v => !v)}
              title="Color"
            >
              <Droplet size={ICON_SIZE} />
            </button>
            {colorOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginTop: 8,
                  padding: 8,
                  background: theme.popoverBg,
                  border: `1px solid ${theme.popoverBorder}`,
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  boxShadow: theme.isDark ? '0 8px 20px rgba(0,0,0,0.4)' : '0 8px 20px rgba(20,20,24,0.15)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: theme.popoverTextMuted,
                      width: 32,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Card
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {POST_IT_COLORS.map(c => (
                      <button
                        key={c}
                        aria-label={`Card color ${c}`}
                        onClick={() => onSetColor(tile.id, c)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 4,
                          background: POST_IT_PALETTE[c].background,
                          border:
                            tile.type === 'post-it' && tile.color === c
                              ? `2px solid ${theme.isDark ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,24,0.85)'}`
                              : `1px solid ${theme.toolbarBorder}`,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    paddingTop: 6,
                    borderTop: `1px solid ${theme.popoverBorder}`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: theme.popoverTextMuted,
                      width: 32,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Text
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      aria-label="Default text color"
                      aria-pressed={!textColor}
                      onClick={() => onSetTextColor(tile.id, undefined)}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        background: 'transparent',
                        border: !textColor
                          ? `2px solid ${theme.isDark ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,24,0.85)'}`
                          : `1px solid ${theme.toolbarBorder}`,
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: theme.toolbarText,
                        fontWeight: 600,
                        fontSize: 12,
                        fontFamily: 'inherit',
                      }}
                    >
                      A
                    </button>
                    {POST_IT_COLORS.map(c => (
                      <button
                        key={c}
                        aria-label={`Text color ${c}`}
                        aria-pressed={textColor === c}
                        onClick={() => onSetTextColor(tile.id, c)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 4,
                          background: 'transparent',
                          border:
                            textColor === c
                              ? `2px solid ${theme.isDark ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,24,0.85)'}`
                              : `1px solid ${theme.toolbarBorder}`,
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: POST_IT_PALETTE[c].cornerMark,
                          fontWeight: 600,
                          fontSize: 12,
                          fontFamily: 'inherit',
                        }}
                      >
                        A
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

        </>
      )}

      {supportsFontSize && (
        <>
          <div style={dividerStyle} />
          {FONT_SIZES.map(({ key, px }) => {
            const active = activeFontSize === key
            return (
              <button
                key={key}
                onClick={() => onSetFontSize(tile.id, key)}
                title={`Text ${key.toUpperCase()}`}
                style={{
                  ...buttonStyle,
                  width: 26,
                  color: active ? theme.tileText : theme.toolbarTextMuted,
                  background: active ? theme.toolbarHighlight : 'transparent',
                  fontSize: px,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                }}
              >
                A
              </button>
            )
          })}
          <input
            type="number"
            min={6}
            max={96}
            value={fontSizeInput}
            placeholder="px"
            onChange={(e) => {
              const raw = e.target.value
              setFontSizeInput(raw)
              if (raw === '') return
              const n = Number(raw)
              if (Number.isFinite(n) && n >= 6 && n <= 96) {
                onSetFontSize(tile.id, n)
              }
            }}
            onBlur={() => {
              if (fontSizeInput === '') return
              const n = Number(fontSizeInput)
              if (!Number.isFinite(n)) {
                setFontSizeInput(typeof activeFontSize === 'number' ? String(activeFontSize) : '')
                return
              }
              const clamped = Math.min(96, Math.max(6, Math.round(n)))
              setFontSizeInput(String(clamped))
              onSetFontSize(tile.id, clamped)
            }}
            title="Custom size in px (6–96)"
            style={{
              width: 44,
              height: 26,
              marginLeft: 2,
              padding: '0 6px',
              borderRadius: 6,
              border: `1px solid ${theme.toolbarBorder}`,
              background:
                typeof activeFontSize === 'number'
                  ? theme.toolbarHighlight
                  : 'transparent',
              color:
                typeof activeFontSize === 'number'
                  ? theme.tileText
                  : theme.toolbarTextMuted,
              fontSize: 11,
              fontFamily: 'inherit',
              outline: 'none',
              textAlign: 'center',
              // hide native spinner (cleaner look in a chip toolbar)
              MozAppearance: 'textfield',
            }}
          />
        </>
      )}

      <div style={dividerStyle} />
      {isPostIt && onSaveToVault && tile.text.trim() && (
        <button
          style={buttonStyle}
          onClick={() => onSaveToVault(tile.id)}
          title="Save to vault"
        >
          <FolderInput size={ICON_SIZE} />
        </button>
      )}
      {isNote && onOpenInPage && (
        <button
          style={buttonStyle}
          onClick={() => onOpenInPage(tile.filePath)}
          title="Open in page"
        >
          <ArrowUpRight size={ICON_SIZE} />
        </button>
      )}
      {isWidget && onRefreshWidget && (
        <button
          style={buttonStyle}
          onClick={() => onRefreshWidget(tile.id)}
          title="Refresh widget now"
        >
          <RefreshCw size={ICON_SIZE} />
        </button>
      )}
      {isWidget && onSetWidgetRefreshSec && (
        <div style={{ position: 'relative' }}>
          <button
            style={{
              ...buttonStyle,
              width: 'auto',
              padding: '0 8px',
              gap: 4,
              color: refreshIntervalOpen ? theme.tileText : theme.toolbarText,
              background: refreshIntervalOpen ? theme.toolbarHighlight : 'transparent',
              fontSize: 11,
              fontWeight: 500,
            }}
            onClick={() => setRefreshIntervalOpen(v => !v)}
            title="Auto-refresh interval"
            aria-pressed={refreshIntervalOpen}
          >
            <Timer size={ICON_SIZE} />
            <span>{formatRefreshSec(tile.refreshSec)}</span>
          </button>
          {refreshIntervalOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginTop: 8,
                padding: 4,
                background: theme.popoverBg,
                border: `1px solid ${theme.popoverBorder}`,
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 80,
                boxShadow: theme.isDark
                  ? '0 8px 20px rgba(0,0,0,0.4)'
                  : '0 8px 20px rgba(20,20,24,0.15)',
                zIndex: 110,
              }}
            >
              {WIDGET_REFRESH_OPTIONS.map(opt => {
                const active = (tile.refreshSec ?? undefined) === opt.value
                return (
                  <button
                    key={opt.label}
                    onClick={() => {
                      onSetWidgetRefreshSec(tile.id, opt.value)
                      setRefreshIntervalOpen(false)
                    }}
                    style={{
                      padding: '6px 10px',
                      border: 'none',
                      background: active ? theme.popoverHighlight : 'transparent',
                      color: active ? theme.popoverText : theme.popoverTextMuted,
                      cursor: 'pointer',
                      borderRadius: 4,
                      fontSize: 12,
                      textAlign: 'left',
                      fontFamily: 'inherit',
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <button
          style={{
            ...buttonStyle,
            color: infoOpen ? theme.tileText : theme.toolbarText,
            background: infoOpen ? theme.toolbarHighlight : 'transparent',
          }}
          onClick={() => setInfoOpen(v => !v)}
          title="Details"
          aria-label="Tile details"
          aria-pressed={infoOpen}
        >
          <Info size={ICON_SIZE} />
        </button>
        {infoOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginTop: 8,
              padding: 10,
              background: theme.popoverBg,
              border: `1px solid ${theme.popoverBorder}`,
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              width: 240,
              boxShadow: theme.isDark
                ? '0 8px 20px rgba(0,0,0,0.4)'
                : '0 8px 20px rgba(20,20,24,0.15)',
              zIndex: 110,
            }}
          >
            {[
              { label: 'Type', value: TILE_TYPE_LABELS[tile.type] },
              { label: 'Created', value: formatTimestamp(tile.createdAt) },
              { label: 'Updated', value: formatTimestamp(tile.updatedAt) },
              { label: 'Path', value: tile.type === 'note' ? tile.filePath : HOME_CANVAS_PATH },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    fontSize: 10,
                    color: theme.popoverTextMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: theme.popoverText,
                    fontFamily: row.label === 'Path' ? 'monospace' : 'inherit',
                    wordBreak: 'break-all',
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        style={buttonStyle}
        onClick={() => onDuplicate(tile.id)}
        title="Duplicate"
      >
        <Copy size={ICON_SIZE} />
      </button>
      <button
        style={{ ...buttonStyle, color: theme.isDark ? 'rgba(255, 120, 120, 0.85)' : 'rgba(200, 40, 40, 0.9)' }}
        onClick={() => onRemove(tile.id)}
        title="Delete"
      >
        <Trash2 size={ICON_SIZE} />
      </button>
    </div>
  )
}
