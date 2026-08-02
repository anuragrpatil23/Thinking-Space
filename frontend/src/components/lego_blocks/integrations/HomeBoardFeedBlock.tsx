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
 * iCloud-synced) and lays the post-its + pinned notes out as a masonry of small
 * cards (newest first) instead of a zoomable board — so iOS can see everything
 * dropped on the canvas without the spatial interaction. Post-its cap their
 * height with a color-matched fade and expand on tap; note cards tap through to
 * the reader. The desktop keeps owning tile position (this view never writes x/y).
 */

// Collapsed post-its clip to this height with a fade; tapping expands to full.
const COLLAPSED_MAX_HEIGHT = 220

// Newest first by last edit, falling back to creation, then to id so the order
// is stable for legacy tiles that predate both timestamps.
function tileOrder(t: CanvasTile): number {
  return t.updatedAt ?? t.createdAt ?? 0
}

function noteTitle(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath
  return name.replace(/\.md$/i, '')
}

// Canvas post-its often carry big vertical gaps (spatial breathing room). In a
// feed those read as dead space, so collapse blank-line runs and trim the ends.
function cleanPostItText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim()
}

// Masonry columns, resolved in JS rather than CSS `columns-*`.
//
// The CSS multi-column version flickered constantly on iPad (2026-08-02):
// WebKit re-fragments a multi-column container on every repaint, and with
// translucent tiles (`tileBg` is rgba) each carrying a large blurred
// box-shadow, that re-fragmentation is visible as flicker. It only showed on
// iPad because the phone renders a single column, where there is nothing to
// fragment. Laying the columns out as plain flex children removes the
// fragmentation entirely; the packing is preserved by distributing tiles
// shortest-column-first below.
//
// Mirrors Tailwind's sm/xl breakpoints, which is what `sm:columns-2
// xl:columns-3` used.
const BOARD_COLUMN_BREAKPOINTS = [
  { query: '(min-width: 1280px)', columns: 3 },
  { query: '(min-width: 640px)', columns: 2 },
]

function resolveBoardColumnCount(): number {
  if (typeof window === 'undefined') return 1
  for (const { query, columns } of BOARD_COLUMN_BREAKPOINTS) {
    if (window.matchMedia(query).matches) return columns
  }
  return 1
}

function useBoardColumnCountBlock(): number {
  const [count, setCount] = useState(resolveBoardColumnCount)

  useEffect(() => {
    const lists = BOARD_COLUMN_BREAKPOINTS.map(({ query }) => window.matchMedia(query))
    const onChange = () => setCount(resolveBoardColumnCount())
    lists.forEach((list) => list.addEventListener('change', onChange))
    onChange()
    return () => lists.forEach((list) => list.removeEventListener('change', onChange))
  }, [])

  return count
}

// Rough height proxy for balancing the columns — text length for post-its (the
// only tiles whose height actually varies), a flat cost for note cards. Exact
// heights would need measurement; this only has to keep the columns from
// ending at wildly different depths.
function estimateTileWeight(tile: CanvasTile): number {
  if (tile.type !== 'post-it') return 90
  return Math.min(cleanPostItText(tile.text).length, 620) + 60
}

// Mirrors CanvasTileBlock's post-it font sizing so a tile reads at the same
// size on the board as it does on the canvas.
function postItFontSizePx(tile: CanvasPostItTile): number {
  if (typeof tile.fontSize === 'number') return tile.fontSize
  if (tile.fontSize === 's') return 11
  if (tile.fontSize === 'l') return 17
  return 13
}

function PostItCard({ tile, theme }: { tile: CanvasPostItTile; theme: CanvasThemeTokens }) {
  const palette = POST_IT_PALETTE[tile.color] ?? POST_IT_PALETTE.yellow
  const [expanded, setExpanded] = useState(false)
  const text = cleanPostItText(tile.text)
  // Rough heuristic for "is this tall enough to clip" — avoids a fade on short
  // notes. ~11 lines at the collapsed height.
  const clampable = text.split('\n').length > 11 || text.length > 620

  // Same visual recipe as the canvas post-it (CanvasTileBlock): a glass tile
  // (theme.tileBg) with a small palette-colored corner mark — NOT a solid
  // fill. textColor, when set, tints the text with that color's mark hue.
  return (
    <button
      type="button"
      onClick={() => clampable && setExpanded(e => !e)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        position: 'relative',
        borderRadius: 12,
        padding: '22px 16px 16px',
        background: theme.tileBg,
        color: tile.textColor ? POST_IT_PALETTE[tile.textColor].cornerMark : theme.tileText,
        border: `1px solid ${theme.tileBorder}`,
        boxShadow: theme.tileShadow,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: postItFontSizePx(tile),
        lineHeight: 1.5,
        maxHeight: !expanded && clampable ? COLLAPSED_MAX_HEIGHT : undefined,
        overflow: 'hidden',
        cursor: clampable ? 'pointer' : 'default',
      }}
    >
      <span
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
        }}
      />
      {text}
      {clampable && !expanded && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 56,
            background: `linear-gradient(transparent, ${theme.tileBg})`,
          }}
        />
      )}
    </button>
  )
}

function NoteCard({ tile, theme }: { tile: CanvasNoteTile; theme: CanvasThemeTokens }) {
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
        background: theme.tileBg,
        border: `1px solid ${theme.tileBorder}`,
        boxShadow: theme.tileShadow,
        color: theme.tileText,
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
  const columnCount = useBoardColumnCountBlock()
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

  // Shortest-column-first, which is what CSS multi-column was doing for us.
  // Reading order goes down each column rather than across rows; the feed is
  // a board, not a ranked list, so that reads fine.
  const columns = useMemo(() => {
    const buckets: CanvasTile[][] = Array.from({ length: columnCount }, () => [])
    const weights = new Array<number>(columnCount).fill(0)
    for (const tile of feed) {
      let target = 0
      for (let i = 1; i < columnCount; i += 1) {
        if (weights[i] < weights[target]) target = i
      }
      buckets[target].push(tile)
      weights[target] += estimateTileWeight(tile)
    }
    return buckets
  }, [feed, columnCount])

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
      {/* Masonry: post-its keep their natural height, notes stay compact, and
          the columns pack tightly instead of one wall-wide card per row. Flex
          columns, not CSS `columns-*` — see BOARD_COLUMN_BREAKPOINTS. */}
      <div className="flex items-start gap-3">
        {columns.map((column, index) => (
          <div key={index} className="flex min-w-0 flex-1 flex-col gap-3">
            {column.map(tile => (
              tile.type === 'post-it' ? (
                <PostItCard key={tile.id} tile={tile} theme={theme} />
              ) : (
                <NoteCard key={tile.id} tile={tile as CanvasNoteTile} theme={theme} />
              )
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
