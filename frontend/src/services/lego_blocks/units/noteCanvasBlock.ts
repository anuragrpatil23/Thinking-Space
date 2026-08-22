// Storage unit for the Note Canvas mode.
//
// A note's canvas state lives in the markdown body as a single fenced block:
//
//   ```thinkspace-canvas v1
//   { "tiles": [...] }
//   ```
//
// Tiles are stored as CanvasTile[] (the same shape used everywhere else in
// the canvas system), so a note canvas reuses the full CanvasSurfaceOrch +
// useCanvasTilesBlock pipeline without translation.

import type { CanvasTile } from '@/components/lego_blocks/hooks/shared/useCanvasTilesBlock'

export const NOTE_CANVAS_BLOCK_TAG = 'thinkspace-canvas'
export const NOTE_CANVAS_BLOCK_VERSION = 'v1'

// Match ```thinkspace-canvas v1\n...\n``` (only v1 for now; future versions
// will be parsed read-only with a banner so users don't lose data).
const FENCE_PATTERN = /(^|\n)([ \t]*)```thinkspace-canvas[ \t]+(v\d+)\n([\s\S]*?)\n```/

export interface ParsedNoteCanvasBlock {
  tiles: CanvasTile[]
  version: string | null
  // Body with the canvas fence removed, used by the doc-mode renderer so the
  // raw JSON payload never reaches markdown view.
  bodyWithoutCanvas: string
  hadFence: boolean
}

export function parseNoteCanvasBlock(content: string): ParsedNoteCanvasBlock {
  const match = FENCE_PATTERN.exec(content)
  if (!match) {
    return { tiles: [], version: null, bodyWithoutCanvas: content, hadFence: false }
  }
  const version = match[3]
  const json = match[4]
  let parsed: unknown = null
  try {
    parsed = JSON.parse(json)
  } catch {
    parsed = null
  }
  const obj = (parsed && typeof parsed === 'object') ? (parsed as Record<string, unknown>) : {}
  const rawTiles = Array.isArray(obj.tiles) ? obj.tiles : []
  // Trust the CanvasTile schema — the canvas pipeline normalizes/clamps on
  // its own. We only filter out non-objects so a corrupt entry doesn't crash
  // the render.
  const tiles = rawTiles.filter((t): t is CanvasTile => !!t && typeof t === 'object')

  const before = content.slice(0, match.index + match[1].length)
  const after = content.slice(match.index + match[0].length)
  const bodyWithoutCanvas = `${before}${after.startsWith('\n') ? after.slice(1) : after}`

  return { tiles, version, bodyWithoutCanvas, hadFence: true }
}

export function stringifyNoteCanvasBlock(tiles: CanvasTile[]): string {
  return `\`\`\`${NOTE_CANVAS_BLOCK_TAG} ${NOTE_CANVAS_BLOCK_VERSION}\n${JSON.stringify({ tiles }, null, 2)}\n\`\`\``
}

// Replace or append the canvas fence in `content`. If tiles is empty AND no
// fence already exists, leave content untouched — never write an empty fence
// into a note that doesn't use canvas mode.
export function applyNoteCanvasToContent(content: string, tiles: CanvasTile[]): string {
  const parsed = parseNoteCanvasBlock(content)
  const hasContent = tiles.length > 0
  if (!parsed.hadFence && !hasContent) return content

  const block = stringifyNoteCanvasBlock(tiles)
  if (parsed.hadFence) {
    const match = FENCE_PATTERN.exec(content)
    if (!match) return appendCanvasFence(content, block)
    const before = content.slice(0, match.index + match[1].length)
    const after = content.slice(match.index + match[0].length)
    if (!hasContent) {
      const trimmedAfter = after.startsWith('\n') ? after.slice(1) : after
      return `${before}${trimmedAfter}`
    }
    return `${before}${block}${after}`
  }
  return appendCanvasFence(content, block)
}

/** Append the fence, adding exactly the separator that is missing.
 *
 *  This has to be the inverse of `parseNoteCanvasBlock`, which removes the
 *  fence *and* one following newline. When it was not — it unconditionally
 *  added a newline before the block — a note with a canvas gained one blank
 *  line on every keystroke, because the composer round-trips body → content on
 *  each change. Caught by the round-trip property test, 2026-08-22.
 *
 *  See docs/contracts/DURABILITY.md and docs/contracts/EDITOR.md (markdown on
 *  disk stays byte-identical). */
function appendCanvasFence(content: string, block: string): string {
  if (content.length === 0) return `${block}\n`
  if (content.endsWith('\n\n')) return `${content}${block}\n`
  if (content.endsWith('\n')) return `${content}\n${block}\n`
  return `${content}\n\n${block}\n`
}
