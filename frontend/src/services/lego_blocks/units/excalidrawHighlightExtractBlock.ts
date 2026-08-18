// Extract highlighted text from an Obsidian Excalidraw mindmap, grouped by
// tree node. Highlights are freedraw "pen" strokes drawn over text; we detect
// the highlighter strokes (translucent + thick), correlate each to the text
// element it overlaps, slice the covered phrase, and group the results by the
// node (rectangle) the text is bound to. The node tree is reconstructed from
// arrow bindings (startBinding → parent, endBinding → child).

interface ExcalidrawElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  strokeColor?: string
  backgroundColor?: string
  strokeWidth?: number
  opacity?: number
  text?: string
  containerId?: string | null
  boundElements?: Array<{ id: string; type: string }> | null
  startBinding?: { elementId: string } | null
  endBinding?: { elementId: string } | null
  points?: Array<[number, number]>
  isDeleted?: boolean
}

interface ExcalidrawScene {
  elements?: ExcalidrawElement[]
}

export interface ExcalidrawHighlightSegmentBlock {
  /** The pen color (hex), e.g. "#f59f00". */
  color: string
  /** Friendly color name, e.g. "amber". */
  colorName: string
  /** The highlighted text (sliced phrase, or full line when slicing is unreliable). */
  text: string
}

export interface ExcalidrawHighlightNodeBlock {
  nodeId: string
  /** Cleaned title of the node this text belongs to. */
  title: string
  /** Tree path of node titles, root → this node. */
  path: string[]
  segments: ExcalidrawHighlightSegmentBlock[]
}

export interface ExcalidrawHighlightsExtractBlock {
  totalHighlights: number
  /** Highlights that could not be correlated to any text element. */
  unmatched: number
  colorLegend: Array<{ color: string; colorName: string; count: number }>
  nodes: ExcalidrawHighlightNodeBlock[]
}

const COLOR_NAMES: Record<string, string> = {
  '#f59f00': 'amber',
  '#d6336c': 'pink',
  '#fff9db': 'yellow',
  '#ffec99': 'yellow',
  '#ffd43b': 'yellow',
  '#1e1e1e': 'black',
  '#e64980': 'pink',
  '#4263eb': 'blue',
  '#40c057': 'green',
  '#fab005': 'amber',
}

function colorName(hex: string | undefined): string {
  if (!hex) return 'unknown'
  return COLOR_NAMES[hex.toLowerCase()] ?? hex
}

/** Parse the JSON scene out of a .excalidraw / .excalidraw.md file. */
export function parseExcalidrawSceneBlock(content: string): ExcalidrawScene | null {
  const trimmed = content.trimStart()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as ExcalidrawScene
    } catch {
      return null
    }
  }
  const drawingMatch = content.match(/## Drawing\s*\n```json\s*\n([\s\S]*?)\n```/)
  if (drawingMatch) {
    try {
      return JSON.parse(drawingMatch[1]) as ExcalidrawScene
    } catch {
      return null
    }
  }
  const jsonBlockMatch = content.match(/```json\s*\n([\s\S]*?)\n```/)
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1]) as ExcalidrawScene
    } catch {
      return null
    }
  }
  return null
}

/** A freedraw stroke is a highlighter (not ink) when it's translucent and thick. */
function isHighlightStroke(el: ExcalidrawElement): boolean {
  if (el.type !== 'freedraw') return false
  const opacity = el.opacity ?? 100
  const strokeWidth = el.strokeWidth ?? 1
  return opacity <= 60 && strokeWidth >= 3
}

function freedrawBbox(el: ExcalidrawElement): [number, number, number, number] {
  const pts = el.points ?? []
  if (pts.length === 0) {
    return [el.x, el.y, el.x + (el.width || 0), el.y + (el.height || 0)]
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of pts) {
    minX = Math.min(minX, el.x + px)
    minY = Math.min(minY, el.y + py)
    maxX = Math.max(maxX, el.x + px)
    maxY = Math.max(maxY, el.y + py)
  }
  return [minX, minY, maxX, maxY]
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function cleanTitle(raw: string): string {
  let t = raw.trim()
  // Strip Obsidian "📍[[Link Name]]" wrappers.
  const linkMatch = t.match(/\[\[([^\]]+)\]\]/)
  if (linkMatch) t = linkMatch[1]
  // Strip leading marker glyphs/bullets.
  t = t.replace(/^[📍•\-\s]+/u, '')
  return t.trim().slice(0, 80)
}

export function extractExcalidrawHighlightsBlock(content: string): ExcalidrawHighlightsExtractBlock {
  const scene = parseExcalidrawSceneBlock(content)
  if (!scene) {
    throw new Error('Could not parse Excalidraw scene from file content.')
  }
  const elements = (scene.elements ?? []).filter(e => !e.isDeleted)
  const byId = new Map<string, ExcalidrawElement>()
  for (const el of elements) byId.set(el.id, el)

  const texts = elements.filter(e => e.type === 'text')
  const arrows = elements.filter(e => e.type === 'arrow')
  const highlights = elements.filter(isHighlightStroke)

  // Tree: child rect id → parent rect id (arrow start = parent, end = child).
  const childToParent = new Map<string, string>()
  for (const a of arrows) {
    const parent = a.startBinding?.elementId
    const child = a.endBinding?.elementId
    if (parent && child) childToParent.set(child, parent)
  }

  const rectTitle = (rectId: string): string => {
    const rect = byId.get(rectId)
    if (!rect) return rectId
    for (const bound of rect.boundElements ?? []) {
      if (bound.type === 'text') {
        const t = byId.get(bound.id)
        if (t?.text) return cleanTitle(t.text.split('\n')[0] ?? t.text)
      }
    }
    return rectId
  }

  const pathOf = (rectId: string): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    let cursor: string | undefined = rectId
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      out.push(rectTitle(cursor))
      cursor = childToParent.get(cursor)
    }
    return out.reverse()
  }

  // Group highlights by the text element's container (rectangle) node.
  const segmentsByNode = new Map<string, ExcalidrawHighlightSegmentBlock[]>()
  const colorCounts = new Map<string, number>()
  let unmatched = 0

  for (const h of highlights) {
    const [hx0, hy0, hx1, hy1] = freedrawBbox(h)
    let best: ExcalidrawElement | null = null
    let bestScore = 0
    for (const t of texts) {
      const tx0 = t.x, ty0 = t.y, tx1 = t.x + t.width, ty1 = t.y + t.height
      const score = overlap1d(hx0, hx1, tx0, tx1) * overlap1d(hy0, hy1, ty0, ty1)
      if (score > bestScore) {
        bestScore = score
        best = t
      }
    }
    if (!best || bestScore <= 0) {
      unmatched += 1
      continue
    }

    const color = (h.strokeColor ?? '').toLowerCase()
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)

    const lines = (best.text ?? '').split('\n')
    const lineCount = Math.max(1, lines.length)
    const lineHeight = best.height / lineCount

    // Lines whose vertical band the highlight overlaps. A swipe can cross two.
    const phrases: string[] = []
    for (let li = 0; li < lines.length; li += 1) {
      const ly0 = best.y + li * lineHeight
      const ly1 = ly0 + lineHeight
      const vOverlap = overlap1d(hy0, hy1, ly0, ly1)
      if (vOverlap < lineHeight * 0.3) continue
      const line = lines[li]
      const phrase = sliceLinePhrase(line, best.x, best.width, hx0, hx1)
      if (phrase) phrases.push(phrase)
    }
    if (phrases.length === 0) continue

    const nodeId = best.containerId ?? best.id
    const seg = segmentsByNode.get(nodeId) ?? []
    seg.push({
      color: color || '#000000',
      colorName: colorName(color),
      text: phrases.join(' '),
    })
    segmentsByNode.set(nodeId, seg)
  }

  const nodes: ExcalidrawHighlightNodeBlock[] = []
  for (const [nodeId, segments] of segmentsByNode) {
    nodes.push({
      nodeId,
      title: rectTitle(nodeId),
      path: pathOf(nodeId),
      segments,
    })
  }
  // Stable order: by tree depth then title so parents precede children.
  nodes.sort((a, b) => a.path.length - b.path.length || a.title.localeCompare(b.title))

  const colorLegend = [...colorCounts.entries()]
    .map(([color, count]) => ({ color, colorName: colorName(color), count }))
    .sort((a, b) => b.count - a.count)

  return {
    totalHighlights: highlights.length,
    unmatched,
    colorLegend,
    nodes,
  }
}

/**
 * Slice the portion of a line a highlight bbox covers, by horizontal
 * proportion. Fonts aren't monospace so this is approximate; when the slice
 * lands on whitespace or covers most of the line, fall back to the full line.
 */
function sliceLinePhrase(
  line: string,
  textX: number,
  textWidth: number,
  hx0: number,
  hx1: number,
): string {
  const trimmedFull = line.trim()
  if (!trimmedFull || textWidth <= 0) return trimmedFull
  const len = line.length
  let c0 = Math.round(((hx0 - textX) / textWidth) * len)
  let c1 = Math.round(((hx1 - textX) / textWidth) * len)
  c0 = Math.max(0, Math.min(len, c0))
  c1 = Math.max(0, Math.min(len, c1))
  if (c1 <= c0) return trimmedFull
  // Near-full-line coverage: just return the whole line.
  if (c1 - c0 >= len * 0.85) return trimmedFull
  const sliced = line.slice(c0, c1).trim()
  return sliced || trimmedFull
}
