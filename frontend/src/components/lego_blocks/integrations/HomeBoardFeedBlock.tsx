import { ArrowUp } from 'lucide-react'
import HomeTileBlock, { HomeTileFigureBlock, HOME_TILE_SHADOW_BLOCK } from '@/components/lego_blocks/units/HomeTileBlock'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addBoardInboxNoteBlock,
  readBoardInboxBlock,
  type BoardInboxNoteBlock,
} from '@/services/lego_blocks/integrations/boardInboxBlock'
import { DEFAULT_POST_IT_COLOR } from '@/components/lego_blocks/units/postItPaletteBlock'
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

interface HomeBoardFeedBlockProps {
  /** 'feed' (default) is the board in Home's column. 'tile' is the phone Home
   *  tile: a count and the newest note's first line, as a button that calls
   *  `onOpen`. 'page' is the full-screen page that tile opens — the same feed
   *  without its own "Board" heading, which the page's title bar carries. */
  surface?: 'feed' | 'tile' | 'page'
  onOpen?: () => void
}

export default function HomeBoardFeedBlock({ surface = 'feed', onOpen }: HomeBoardFeedBlockProps = {}) {
  const theme = useCanvasThemeBlock()
  const columnCount = useBoardColumnCountBlock()
  const [tiles, setTiles] = useState<CanvasTile[] | null>(null)
  // Notes jotted on this phone that the desktop board has not pulled in yet
  // (see boardInboxBlock). Shown alongside the board so a note appears the
  // moment it is written.
  const [inboxNotes, setInboxNotes] = useState<BoardInboxNoteBlock[]>([])

  useEffect(() => {
    let cancelled = false
    homeCanvasStorage
      .read()
      .then(loaded => { if (!cancelled) setTiles(loaded ?? []) })
      .catch(() => { if (!cancelled) setTiles([]) })
    void readBoardInboxBlock().then(notes => { if (!cancelled) setInboxNotes(notes) })
    return () => { cancelled = true }
  }, [])

  const addNote = useCallback(async (text: string) => {
    const note = await addBoardInboxNoteBlock(text)
    setInboxNotes(prev => [...prev, note])
  }, [])

  const feed = useMemo(() => {
    if (!tiles) return []
    const onBoard = new Set(tiles.map(t => t.id))
    const waiting: CanvasTile[] = inboxNotes
      .filter(note => !onBoard.has(note.id))
      .map(note => ({
        id: note.id,
        type: 'post-it',
        x: 0,
        y: 0,
        w: 280,
        h: 280,
        text: note.text,
        color: DEFAULT_POST_IT_COLOR,
        locked: true,
        createdAt: note.createdAt,
      }))
    return [...tiles, ...waiting]
      // Onboarding seeds (canvas gesture hints) and empty post-its are noise in
      // a feed; web-widgets are desktop-only webview regions.
      .filter(t => !t.id.startsWith('seed-'))
      .filter(t => {
        if (t.type === 'post-it') return t.text.trim().length > 0
        return t.type === 'note'
      })
      .sort((a, b) => tileOrder(b) - tileOrder(a))
  }, [tiles, inboxNotes])

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

  if (!tiles) return null
  // The board's own column on desktop Home has nothing to show. The phone's
  // tile and page still render: they are where a note gets jotted.
  if (feed.length === 0 && surface === 'feed') return null

  if (surface === 'tile' && feed.length === 0) {
    return (
      <div
        style={{
          height: '100%',
          borderRadius: 22,
          padding: '22px 20px',
          background: theme.anchorPanelBg,
          border: `1px solid ${theme.anchorPanelBorder}`,
          boxShadow: HOME_TILE_SHADOW_BLOCK,
        }}
      >
        <HomeTileBlock label="Board" onOpen={onOpen ?? (() => {})}>
          <HomeTileFigureBlock figure="Jot" line="A quick thought" />
        </HomeTileBlock>
      </div>
    )
  }

  if (surface === 'tile') {
    const newest = feed[0]
    const preview =
      newest.type === 'post-it'
        ? newest.text.trim().split('\n')[0]
        : noteTitle((newest as CanvasNoteTile).filePath)
    return (
      // The same panel the other Home tiles sit in. Drawn here rather than by
      // Home because an empty board renders nothing at all, and Home cannot
      // know that from outside.
      <div
        style={{
          height: '100%',
          borderRadius: 22,
          padding: '22px 20px',
          background: theme.anchorPanelBg,
          border: `1px solid ${theme.anchorPanelBorder}`,
          boxShadow: HOME_TILE_SHADOW_BLOCK,
        }}
      >
        <HomeTileBlock
          label="Board"
          onOpen={onOpen ?? (() => {})}
          accessory={
            // The newest few notes' own colours, as the corner marks the
            // post-its wear on the board itself.
            <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
              {feed.slice(0, 4).map(t => (
                <span
                  key={t.id}
                  className="h-[7px] w-[7px] rounded-[2px]"
                  style={{
                    background:
                      t.type === 'post-it'
                        ? (POST_IT_PALETTE[(t as CanvasPostItTile).color] ?? POST_IT_PALETTE.yellow).cornerMark
                        : 'rgba(148,163,184,0.5)',
                  }}
                />
              ))}
            </span>
          }
        >
          <HomeTileFigureBlock
            figure={
              <>
                {feed.length}
                <span className="ml-1.5 text-[13px] font-normal tracking-normal text-muted-foreground">
                  {feed.length === 1 ? 'note' : 'notes'}
                </span>
              </>
            }
            line={preview}
          />
        </HomeTileBlock>
      </div>
    )
  }

  return (
    <section>
      {surface === 'page' && <BoardQuickCaptureBlock theme={theme} onAdd={addNote} />}
      {surface !== 'page' && (
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
      )}
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

/** The phone's way onto the board: type, add, and it is a post-it. It lands
 *  in the board inbox; the desktop board places it where you are looking the
 *  next time it is open.
 *
 *  Drawn as one of the cards below it (same surface, same corner mark) rather
 *  than a yellow slab: the first version was louder than the notes it sits
 *  over, a third of the screen tall before anything was typed, and its
 *  disabled button went muddy on the yellow. One line that grows; the send
 *  arrow appears only once there is something to send. */
function BoardQuickCaptureBlock({ theme, onAdd }: { theme: CanvasThemeTokens; onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)
  const trimmed = text.trim()
  const palette = POST_IT_PALETTE[DEFAULT_POST_IT_COLOR]

  const submit = async () => {
    if (!trimmed || saving) return
    setSaving(true)
    setFailed(false)
    try {
      await onAdd(trimmed)
      setText('')
      if (fieldRef.current) fieldRef.current.style.height = ''
    } catch {
      // Keep the text: a failed save must not cost the thought.
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-3">
      <div
        className="relative flex items-end gap-2"
        style={{
          borderRadius: 12,
          padding: '20px 10px 10px 16px',
          background: theme.tileBg,
          border: `1px solid ${theme.tileBorder}`,
          boxShadow: theme.tileShadow,
          color: theme.tileText,
        }}
      >
        <span
          aria-hidden
          className="absolute left-2 top-2 h-2 w-2 rounded-[2px]"
          style={{ background: palette.cornerMark, opacity: 0.85 }}
        />
        {/* 16px: anything smaller and iOS zooms the page in on focus. Grows
            with its content, measured on each change (WebKit has no
            field-sizing). */}
        <textarea
          ref={fieldRef}
          value={text}
          onChange={event => {
            const field = event.currentTarget
            setText(field.value)
            field.style.height = 'auto'
            field.style.height = `${field.scrollHeight}px`
          }}
          placeholder="Jot a thought…"
          rows={1}
          className="min-h-[24px] flex-1 resize-none bg-transparent pb-1 text-[16px] leading-6 outline-none placeholder:text-current placeholder:opacity-40"
          style={{ maxHeight: '40vh' }}
        />
        {trimmed && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            aria-label="Add to board"
            className="ltm-touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
            style={{ background: palette.cornerMark, color: '#fff' }}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
      {failed && <p className="mt-1.5 px-1 text-[12px] text-red-600">Couldn't save — try again</p>}
    </div>
  )
}
