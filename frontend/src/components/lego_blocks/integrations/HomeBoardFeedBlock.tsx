import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { homeCanvasStorage } from '@/services/lego_blocks/integrations/homeCanvasStorageBlock'
import { POST_IT_PALETTE } from '@/components/lego_blocks/units/postItPaletteBlock'
import type {
  CanvasTile,
  CanvasPostItTile,
  CanvasNoteTile,
} from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'
import {
  useCanvasThemeBlock,
  type CanvasThemeTokens,
} from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'

/**
 * The non-spatial view of the Home canvas board. Reads the exact same vault
 * file the desktop canvas writes (`.thinking-space/home-canvas.json`, already
 * iCloud-synced) and lists the post-its + pinned notes as a reverse-chron feed
 * instead of a zoomable board — so iOS can see everything dropped on the canvas
 * without the spatial interaction. Note rows tap through to the reader; the
 * desktop keeps owning tile position (this view never writes x/y).
 */

// Newest first by last edit, falling back to creation, then to id so the order
// is stable for legacy tiles that predate both timestamps.
function tileOrder(t: CanvasTile): number {
  return t.updatedAt ?? t.createdAt ?? 0
}

function noteTitle(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath
  return name.replace(/\.md$/i, '')
}

function PostItCard({ tile }: { tile: CanvasPostItTile }) {
  const palette = POST_IT_PALETTE[tile.color] ?? POST_IT_PALETTE.yellow
  return (
    <div
      style={{
        borderRadius: 12,
        padding: '14px 16px',
        background: palette.background,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        boxShadow: palette.shadow,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {tile.text}
    </div>
  )
}

function NoteRow({ tile, theme }: { tile: CanvasNoteTile; theme: CanvasThemeTokens }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate(`/thinking-space?file=${encodeURIComponent(tile.filePath)}`)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        borderRadius: 12,
        padding: '14px 16px',
        background: theme.anchorPanelBg,
        border: `1px solid ${theme.anchorPanelBorder}`,
        boxShadow: theme.anchorPanelShadow,
        color: theme.anchorHeading,
        cursor: 'pointer',
      }}
    >
      <span aria-hidden style={{ fontSize: 15, opacity: 0.7 }}>📄</span>
      <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {noteTitle(tile.filePath)}
      </span>
    </button>
  )
}

export default function HomeBoardFeedBlock() {
  const theme = useCanvasThemeBlock()
  const [tiles, setTiles] = useState<CanvasTile[] | null>(null)

  useEffect(() => {
    let cancelled = false
    homeCanvasStorage
      .read()
      .then(loaded => { if (!cancelled) setTiles(loaded ?? []) })
      .catch(() => { if (!cancelled) setTiles([]) })
    return () => { cancelled = true }
  }, [])

  const feed = useMemo(() => {
    if (!tiles) return []
    return tiles
      // Onboarding seeds (canvas gesture hints) and empty post-its are noise in
      // a feed; web-widgets are desktop-only webview regions.
      .filter(t => !t.id.startsWith('seed-'))
      .filter(t => {
        if (t.type === 'post-it') return t.text.trim().length > 0
        return t.type === 'note'
      })
      .sort((a, b) => tileOrder(b) - tileOrder(a))
  }, [tiles])

  if (!tiles || feed.length === 0) return null

  return (
    <section>
      <h2
        style={{
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: theme.anchorEyebrow,
          margin: '0 0 12px',
        }}
      >
        Board
      </h2>
      <div className="space-y-3">
        {feed.map(tile =>
          tile.type === 'post-it' ? (
            <PostItCard key={tile.id} tile={tile} />
          ) : (
            <NoteRow key={tile.id} tile={tile as CanvasNoteTile} theme={theme} />
          ),
        )}
      </div>
    </section>
  )
}
