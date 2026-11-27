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
  mode?: 'fixed' | 'slide' | 'nudge'
}

export type ModelDiagramLabelFateBlock = 'full' | 'short' | 'hidden'
export interface ModelDiagramLabelPlaceBlock { fate: ModelDiagramLabelFateBlock; dx: number; dy: number }

const PAD = 1

// Small moves tried for a nudged label, nearest first: up and down before sideways, out to 168 px.
const NUDGES: [number, number][] = [[0, 0]]
for (let r = 1; r <= 24; r++) { const d = r * 7; NUDGES.push([0, -d], [0, d], [d, 0], [-d, 0], [d, -d], [-d, -d], [d, d], [-d, d]) }

/**
 * Place labels. Fixed ones (a number beside its line, a row's name) show
 * exactly where the layout put them. A nudged one always shows, moved by the
 * smallest step that clears what is already placed. A sliding one (a step's
 * title) is never hidden either: it moves up or down whole lines, then half
 * its width sideways, and shrinks to its short form only when no place is free. The rest give way, highest rank
 * first, earlier winning a tie.
 */
export function placeModelDiagramLabelsBlock(boxes: ModelDiagramLabelBoxBlock[]): ModelDiagramLabelPlaceBlock[] {
  const out: ModelDiagramLabelPlaceBlock[] = boxes.map(() => ({ fate: 'hidden', dx: 0, dy: 0 }))
  const byRank = (ids: number[]) => ids.sort((a, b) => boxes[b].rank - boxes[a].rank || a - b)
  const ids = boxes.map((_, i) => i).filter((i) => boxes[i].w > 0 && boxes[i].h > 0)
  // Placed rectangles as flat [x0, y0, x1, y1] runs.
  const placed: number[] = []
  const free = (b: ModelDiagramLabelBoxBlock, w: number, h: number, dx: number, dy: number) => {
    const x0 = b.x + dx - w / 2 - PAD, y0 = b.y + dy - h / 2 - PAD, x1 = b.x + dx + w / 2 + PAD, y1 = b.y + dy + h / 2 + PAD
    for (let k = 0; k < placed.length; k += 4) {
      if (x0 < placed[k + 2] && x1 > placed[k] && y0 < placed[k + 3] && y1 > placed[k + 1]) return false
    }
    return true
  }
  const take = (i: number, w: number, h: number, dx: number, dy: number, fate: ModelDiagramLabelFateBlock = 'full') => {
    const b = boxes[i]
    placed.push(b.x + dx - w / 2 - PAD, b.y + dy - h / 2 - PAD, b.x + dx + w / 2 + PAD, b.y + dy + h / 2 + PAD)
    out[i] = { fate, dx, dy }
  }
  const of = (mode: ModelDiagramLabelBoxBlock['mode']) => ids.filter((k) => boxes[k].mode === mode)
  for (const i of of('fixed')) take(i, boxes[i].w, boxes[i].h, 0, 0)
  for (const i of byRank(of('nudge'))) {
    const b = boxes[i], d = NUDGES.find(([dx, dy]) => free(b, b.w, b.h, dx, dy)) ?? NUDGES[0]
    take(i, b.w, b.h, d[0], d[1])
  }
  for (const i of byRank(of('slide'))) {
    const b = boxes[i], line = b.h + 3
    // Whole lines first, then half a width to either side on the nearer lines.
    const tries: [number, number][] = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6].map((k) => [0, k * line])
    for (const k of [0, -1, 1, -2, 2, -3, 3]) tries.push([b.w / 2 + 4, k * line], [-b.w / 2 - 4, k * line])
    const d = tries.find(([dx, dy]) => free(b, b.w, b.h, dx, dy))
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
    if (free(b, b.w, b.h, 0, 0)) take(i, b.w, b.h, 0, 0)
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
