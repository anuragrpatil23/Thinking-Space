// Label placement for model diagrams, in screen space: given where each label
// would sit and how big it is, decide which stay put, which slide a line to
// find room, and which give way. Pure, so "labels never overlap" is a test and
// not a hope. The renderer supplies the projected positions and measured sizes.

export interface ModelDiagramLabelBoxBlock {
  /** Centre, in pixels. */
  x: number
  y: number
  w: number
  h: number
  /** Higher wins when two labels would overlap. */
  rank: number
  /** The size of the label's short form, when it has one. */
  shortW?: number
  shortH?: number
  /** 'fixed' shows where it is; 'nudge' shows, moved a little to clear others; 'slide' moves whole lines; the default gives way. */
  mode?: 'fixed' | 'slide' | 'nudge' | 'dock'
  /** A fixed label that is one of a run (a row's name, a column's number): dropped when it would sit on its neighbour, like the ticks of an axis. */
  thin?: boolean
  /** In a thinned run, the one that always shows (the row in use). */
  keep?: boolean
}

export type ModelDiagramLabelFateBlock = 'full' | 'short' | 'hidden'
export interface ModelDiagramLabelPlaceBlock { fate: ModelDiagramLabelFateBlock; dx: number; dy: number }

const PAD = 1

// Small moves tried for a nudged label, nearest first: up and down before sideways, out to 168 px.
const NUDGES: [number, number][] = [[0, 0]]
for (let r = 1; r <= 24; r++) { const d = r * 7; NUDGES.push([0, -d], [0, d], [d, 0], [-d, 0], [d, -d], [-d, -d], [d, d], [-d, d]) }

// Longer moves, for a block of text big enough to stand on its own (a written-out sum): out to 600 px, kept inside the stage.
const FAR: [number, number][] = []
for (let r = 9; r <= 30; r++) { const d = r * 20; FAR.push([0, -d], [0, d], [d, 0], [-d, 0], [d, -d], [-d, -d], [d, d], [-d, d], [d, -d / 2], [-d, -d / 2], [d, d / 2], [-d, d / 2], [d / 2, -d], [-d / 2, -d], [d / 2, d], [-d / 2, d]) }

/**
 * Place labels. Fixed ones (a number beside its line, a row's name) show
 * exactly where the layout put them. A nudged one always shows, moved by the
 * smallest step that clears what is already placed. A sliding one (a step's
 * title) is never hidden either: it moves up or down whole lines, then half
 * its width sideways, and shrinks to its short form only when no place is free. The rest give way, highest rank
 * first, earlier winning a tie. `walls` are the parts of the drawing (bars,
 * circles) that a label which can move keeps off; a fixed label belongs to
 * the drawing and ignores them.
 */
export function placeModelDiagramLabelsBlock(boxes: ModelDiagramLabelBoxBlock[], walls: { x0: number; y0: number; x1: number; y1: number }[] = [], stage?: { w: number; h: number }): ModelDiagramLabelPlaceBlock[] {
  const out: ModelDiagramLabelPlaceBlock[] = boxes.map(() => ({ fate: 'hidden', dx: 0, dy: 0 }))
  const byRank = (ids: number[]) => ids.sort((a, b) => boxes[b].rank - boxes[a].rank || a - b)
  const ids = boxes.map((_, i) => i).filter((i) => boxes[i].w > 0 && boxes[i].h > 0)
  // Placed rectangles as flat [x0, y0, x1, y1] runs.
  const placed: number[] = []
  const free = (b: ModelDiagramLabelBoxBlock, w: number, h: number, dx: number, dy: number, offDrawing = true) => {
    const x0 = b.x + dx - w / 2 - PAD, y0 = b.y + dy - h / 2 - PAD, x1 = b.x + dx + w / 2 + PAD, y1 = b.y + dy + h / 2 + PAD
    for (let k = 0; k < placed.length; k += 4) {
      if (x0 < placed[k + 2] && x1 > placed[k] && y0 < placed[k + 3] && y1 > placed[k + 1]) return false
    }
    // the drawing itself: a label that can move does not sit on a bar or a step's circle
    if (offDrawing) for (const q of walls) if (x0 < q.x1 && x1 > q.x0 && y0 < q.y1 && y1 > q.y0) return false
    return true
  }
  const take = (i: number, w: number, h: number, dx: number, dy: number, fate: ModelDiagramLabelFateBlock = 'full') => {
    const b = boxes[i]
    placed.push(b.x + dx - w / 2 - PAD, b.y + dy - h / 2 - PAD, b.x + dx + w / 2 + PAD, b.y + dy + h / 2 + PAD)
    out[i] = { fate, dx, dy }
  }
  const of = (mode: ModelDiagramLabelBoxBlock['mode']) => ids.filter((k) => boxes[k].mode === mode)
  // a docked block has one home whatever the camera does: the stage's top left corner, one under another
  let dockY = 14
  for (const i of of('dock')) {
    const b = boxes[i]
    if (!stage) { b.mode = 'nudge'; continue }
    take(i, b.w, b.h, 60 + b.w / 2 - b.x, dockY + b.h / 2 - b.y); dockY += b.h + 8
  }
  const fixed = of('fixed')
  for (const i of fixed) if (!boxes[i].thin) take(i, boxes[i].w, boxes[i].h, 0, 0)
  // a run of names: the one in use first, then every one that has room among those already kept
  const run = fixed.filter((k) => boxes[k].thin)
  for (const i of byRank(run)) {
    const b = boxes[i]
    // the name of the row in use always shows; the others fit around it
    if (b.keep) { take(i, b.w, b.h, 0, 0); continue }
    if (free(b, Math.max(1, b.w - 4), Math.max(1, b.h * 0.7), 0, 0)) take(i, b.w, b.h, 0, 0)
  }
  for (const i of byRank(of('nudge'))) {
    // clear of labels and the drawing if it can be; else clear of labels at least: words on a bar read better than words on words
    const b = boxes[i]
    const inside = (dx: number, dy: number) => !!stage && b.x + dx - b.w / 2 >= 8 && b.x + dx + b.w / 2 <= stage.w - 8 && b.y + dy - b.h / 2 >= 8 && b.y + dy + b.h / 2 <= stage.h - 8
    // a block of text goes further for clear ground than a caption may: it reads on its own, a caption only beside its thing
    const far = stage && b.w * b.h > 40000 ? FAR.find(([dx, dy]) => inside(dx, dy) && free(b, b.w, b.h, dx, dy)) : undefined
    // a caption hemmed in above and below steps out to one side of its thing, level with where it was
    const side = (): [number, number] | undefined => {
      for (let k = 0; k <= 12; k++) for (const dy of [0, b.h / 2, b.h, -b.h / 2]) for (const sx of [1, -1]) {
        const dx = sx * (b.w / 2 + k * 16)
        if ((!stage || inside(dx, dy)) && free(b, b.w, b.h, dx, dy)) return [dx, dy]
      }
      return undefined
    }
    const d = NUDGES.find(([dx, dy]) => free(b, b.w, b.h, dx, dy)) ?? (b.w * b.h > 40000 ? far : side()) ?? far ?? NUDGES.find(([dx, dy]) => free(b, b.w, b.h, dx, dy, false)) ?? NUDGES[0]
    take(i, b.w, b.h, d[0], d[1])
  }
  for (const i of byRank(of('slide'))) {
    const b = boxes[i], line = b.h + 3
    // Whole lines first, then half a width to either side on the nearer lines.
    const tries: [number, number][] = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6].map((k) => [0, k * line])
    for (const k of [0, -1, 1, -2, 2, -3, 3]) tries.push([b.w / 2 + 4, k * line], [-b.w / 2 - 4, k * line])
    const d = tries.find(([dx, dy]) => free(b, b.w, b.h, dx, dy)) ?? tries.find(([dx, dy]) => free(b, b.w, b.h, dx, dy, false))
    if (d) { take(i, b.w, b.h, d[0], d[1]); continue }
    if (b.shortW && b.shortH) {
      const sw = b.shortW, sh = b.shortH
      const n = NUDGES.find(([dx, dy]) => free(b, sw, sh, dx, dy))
      if (n) { take(i, sw, sh, n[0], n[1], 'short'); continue }
    }
    take(i, b.w, b.h, 0, 0)
  }
  for (const i of byRank(of(undefined))) {
    const b = boxes[i]
    // these sit where the drawing wants them (a ruler's number, a note on a grid): they give way to labels only
    if (free(b, b.w, b.h, 0, 0, false)) take(i, b.w, b.h, 0, 0)
  }
  return out
}

/** The pairs of shown labels that overlap; empty when placement did its job. Used by tests and the screenshot check. */
export function overlappingModelDiagramLabelsBlock(rects: { x0: number; y0: number; x1: number; y1: number }[]): [number, number][] {
  const out: [number, number][] = []
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const p = rects[a], q = rects[b]
    if (p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0) out.push([a, b])
  }
  return out
}
