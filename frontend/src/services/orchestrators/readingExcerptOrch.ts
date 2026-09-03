// Pull the text a reading sitting actually looked at, back out of the vault.
//
// Extraction happens here — at digest time — rather than at capture, and the
// span log stores no excerpt. The document is in the vault, so the content is
// re-derivable; storing a copy would be a derived value that can go stale
// against the file it came from, which docs/contracts/DERIVATION.md permits
// only to move something somewhere it cannot be derived. Nothing here needs
// moving.
//
// One consequence worth knowing: this works on every device. An AI session
// digest needs `~/.claude`, so iPhone and web can never generate one. A reading
// digest needs the vault, which every surface already has.
//
// Both parsers are imported dynamically, and that is load-bearing rather than
// tidy. This module hangs off the session-digest orchestrator, which IS
// statically reachable from the entry, so a plain import of either vendor lands
// in the startup chunk: `excalidrawFileBlock` pulls @excalidraw/excalidraw and
// measurably pushed the entry from 2,493 kB to 3,633 kB against a 2.4 MB
// budget. PdfDocumentBlock gets away with a static pdfjs import because the
// whole block is lazy; this path is not. See docs/contracts/STARTUP-PERFORMANCE.md.

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ThinkingspaceReadingWhere } from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'
import {
  MIN_LOCATION_DWELL_MS,
  type ReadingExcerptLocationBlock,
} from '@/services/lego_blocks/units/readingExcerptBlock'

/** Never open more than this many PDF pages for one sitting. The excerpt
 *  budget would discard the rest anyway, and each page is a real parse. */
const MAX_PDF_PAGES = 8

/** Cap the raw text taken from one location before budgeting. A page of a
 *  technical book runs to a few thousand characters and the budget will clip
 *  it hard; carrying the whole thing to the clipper wastes the parse. */
const MAX_RAW_CHARS_PER_LOCATION = 3_000

interface ExcalidrawElementTextBlock {
  id?: unknown
  type?: unknown
  text?: unknown
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  isDeleted?: unknown
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Text of the pages that held attention, most-dwelt first.
 *
 * Only pages past the dwell floor are opened at all — a page passed through
 * contributes nothing to the digest, so parsing it is pure cost.
 */
async function pdfLocationsBlock(
  fs: VaultFS,
  filePath: string,
  where: Extract<ThinkingspaceReadingWhere, { kind: 'pdf' }>,
): Promise<ReadingExcerptLocationBlock[]> {
  const wanted = where.pages
    .filter(p => p.activeMs >= MIN_LOCATION_DWELL_MS)
    .sort((a, b) => b.activeMs - a.activeMs)
    .slice(0, MAX_PDF_PAGES)
  if (wanted.length === 0) return []

  const bytes = await fs.readBytes(filePath)
  const pdfjs = await import('pdfjs-dist')
  const doc = await pdfjs.getDocument({
    data: bytes,
    // Nothing is rendered here — this is a text pass, and asking for the
    // rendering side effects would cost memory on a device already reading.
    isEvalSupported: false,
  }).promise

  try {
    const out: ReadingExcerptLocationBlock[] = []
    for (const page of wanted) {
      if (page.page < 1 || page.page > doc.numPages) continue
      try {
        const proxy = await doc.getPage(page.page)
        const content = await proxy.getTextContent()
        const text = content.items
          .map(item => (typeof (item as { str?: unknown }).str === 'string' ? (item as { str: string }).str : ''))
          .join(' ')
        // Release the page proxy immediately — retained proxies are the iOS
        // memory risk called out in IOS-MEMORY.md.
        proxy.cleanup()
        if (text.trim()) {
          out.push({
            label: `p.${page.page}`,
            activeMs: page.activeMs,
            text: text.slice(0, MAX_RAW_CHARS_PER_LOCATION),
          })
        }
      } catch {
        // One unreadable page must not lose the rest of the sitting.
      }
    }
    return out
  } finally {
    await doc.destroy()
  }
}

/**
 * Text of the elements inside the canvas regions that held attention.
 *
 * The stored `elementIds` were captured as a drift hint — proof of what the
 * rect covered when it was written — and double as the answer to "what was
 * there". Where they are missing or the scene has moved on, the rect itself
 * still selects: geometry is the observation, ids are the shortcut.
 */
async function canvasLocationsBlock(
  content: string,
  where: Extract<ThinkingspaceReadingWhere, { kind: 'canvas' }>,
): Promise<ReadingExcerptLocationBlock[]> {
  const { parseExcalidrawScene } = await import(
    '@/services/lego_blocks/integrations/excalidrawFileBlock'
  )
  const scene = parseExcalidrawScene(content)
  if (!scene) return []
  const elements = scene.elements as ExcalidrawElementTextBlock[]

  const stations = where.stations
    .filter(s => s.activeMs >= MIN_LOCATION_DWELL_MS)
    .sort((a, b) => b.activeMs - a.activeMs)

  const out: ReadingExcerptLocationBlock[] = []
  stations.forEach((station, index) => {
    const ids = new Set(station.elementIds ?? [])
    const texts: string[] = []
    for (const el of elements) {
      if (el?.isDeleted) continue
      const text = typeof el?.text === 'string' ? el.text.trim() : ''
      if (!text) continue
      const byId = ids.size > 0 && typeof el.id === 'string' && ids.has(el.id)
      if (!byId) {
        // Fall back to the rect. An id list that no longer matches means the
        // scene moved; the region is still where the person was looking.
        const x = numberOr(el.x, Number.NaN)
        const y = numberOr(el.y, Number.NaN)
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        const w = numberOr(el.width, 0)
        const h = numberOr(el.height, 0)
        if (x + w < station.x || x > station.x + station.w) continue
        if (y + h < station.y || y > station.y + station.h) continue
      }
      texts.push(text)
      if (texts.join(' ').length > MAX_RAW_CHARS_PER_LOCATION) break
    }
    if (texts.length > 0) {
      out.push({
        label: `region ${index + 1}`,
        activeMs: station.activeMs,
        text: texts.join(' · ').slice(0, MAX_RAW_CHARS_PER_LOCATION),
      })
    }
  })
  return out
}

/** The stretch of a markdown document the reader got to. Coarse by
 *  construction — a scroll ratio is not an anchor — so it takes the region
 *  around the deepest point rather than pretending to a precise span. */
function scrollLocationsBlock(
  content: string,
  where: Extract<ThinkingspaceReadingWhere, { kind: 'scroll' }>,
  activeMs: number,
): ReadingExcerptLocationBlock[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  if (!body) return []
  const end = Math.min(1, Math.max(0, where.max))
  const centre = Math.floor(body.length * end)
  const half = Math.floor(MAX_RAW_CHARS_PER_LOCATION / 2)
  const text = body.slice(Math.max(0, centre - half), centre + half)
  return text.trim() ? [{ label: 'read to ' + Math.round(end * 100) + '%', activeMs, text }] : []
}

/**
 * Locations with their text, ready for budgeting. Returns [] when nothing can
 * be extracted — a missing file, an unparseable scene, a scanned PDF with no
 * text layer. The caller then keeps the mechanical sentence and makes no call.
 */
export async function extractReadingLocationsOrch(
  fs: VaultFS,
  filePath: string,
  where: ThinkingspaceReadingWhere | undefined,
  activeMs: number,
): Promise<ReadingExcerptLocationBlock[]> {
  if (!where) return []
  try {
    if (where.kind === 'pdf') return await pdfLocationsBlock(fs, filePath, where)
    const content = await fs.read(filePath)
    if (where.kind === 'canvas') return await canvasLocationsBlock(content, where)
    return scrollLocationsBlock(content, where, activeMs)
  } catch {
    // Extraction is best-effort. A digest that falls back to the mechanical
    // sentence is a worse digest; a thrown error is a broken panel.
    return []
  }
}
