// The layout engine for model diagrams: a checked spec (and, when there are
// any, the real numbers for one input) goes in, and a 3D scene comes out as
// plain data. Nothing here touches the browser or three.js, so every placement
// rule can be tested on its own; the renderer only draws what this gives it.
//
// Notes: docs/reference/MODEL-DIAGRAM-ENGINE.md. The look and
// the placement rules are those of the hand-built gpt-with-sparse-network.html,
// made general: x is the flow through the steps, y is width and the branches
// above the stream, z is the stack (the batch behind each bar).
import type { ModelOpBlock, ModelSpec, ModelValues } from './modelDiagramFormatBlock'
import {
  MODEL_DIAGRAM_CIRCLE_BLOCK, MODEL_DIAGRAM_UNIT_TAG_BLOCK, modelDiagramPartTextBlock,
  type ModelDiagramTextFactsBlock, type ModelDiagramUnitKind,
} from './modelDiagramTextsBlock'

export type ModelDiagramVec3Block = [number, number, number]
/** A theme colour by name, optionally mixed towards others: ['tile', 'c3', 0.45]. */
export type ModelDiagramColBlock = string | (string | number)[]
type V3 = ModelDiagramVec3Block
type Col = ModelDiagramColBlock

export interface ModelDiagramFrameBlock { cx: number; cy: number; hw: number; hh: number }

/** A grid of value tiles: a bar of activations, or a table of weights. */
export interface ModelDiagramGridBlock {
  key: string
  cx: number; cy: number; p: number; nR: number; nC: number; w: number; h: number
  /** Tile heights and colours, row by row. */
  heights: number[]
  colors: Col[]
  /** What a click on a tile means. */
  pick: { stop: string; rows?: number[] } | null
}
export interface ModelDiagramSlabBlock { c: V3; w: number; h: number; d: number; color: Col; opacity: number; edge: Col; edgeOpacity: number }
export interface ModelDiagramRodBlock { a: V3; b: V3; r: number; color: Col; opacity: number }
export interface ModelDiagramLineBlock { a: V3; b: V3; color: Col; opacity: number }
export interface ModelDiagramSpriteBlock { p: V3; text: string; stop: string }
export interface ModelDiagramDotBlock { p: V3; r: number; color: Col }
export interface ModelDiagramLabelBlock {
  p: V3
  cls: string
  parts: [string, string][]
  /** '*' always shows; 'step:<id>' and 'bar:<key>' show when that step is in focus. */
  tag: string
  /** A step title: clicking it flies to this stop. */
  stop?: string
  /** The colour slot (1 to 8) of a pill's border. */
  slot?: number
  /** Higher wins when two labels would overlap. */
  rank: number
  /** 'bottom': the label's bottom edge sits at its point and it grows upward (a caption over a bar), however small the drawing is. */
  anchor?: 'bottom'
  /**
   * 'fixed' shows exactly where it is (a number beside its line, a row's name). 'nudge' shows, moved a little if that
   * clears another label. 'slide' (a step's title) moves whole lines to find room. None of those ever hides; the rest give way.
   */
  mode?: 'fixed' | 'slide' | 'nudge' | 'dock'
  /** What a title shrinks to when there is no room for it. */
  short?: string
}
export type ModelDiagramCardItemBlock =
  | { t: 'h2' | 'h3' | 'p' | 'note' | 'formula'; text: string }
  | { t: 'sizes'; lines: string[] }
  | { t: 'table'; cls: string; /** The neuron each body row stands for: a click on the row picks it, as a click on the drawn table does. */ pickRows?: number[]; rows: { cells: string[]; on?: boolean; /** 0 to 1 per cell: how strongly to tint it. */ shade?: number[] }[] }

export interface ModelDiagramStopBlock {
  id: string
  /** 1-based place on the strip. */
  n: number
  /** 1-based index into spec.steps of the step this stop belongs to; 0 when the spec names none. */
  specStep: number
  /** The part of the op this stop shows ('q', 'scores', ...), or '' when the op is one stop. */
  part: string
  opId: string
  group: string
  chip: string
  frame: ModelDiagramFrameBlock
  /** The lines drawn thick and dashed, with moving dots, while this stop is in focus. */
  detail: { a: V3; b: V3; r: number; color: Col; opacity: number }[]
  out: [V3, V3]
  /** The bars whose labels show while this stop is in focus: what it reads, and what it makes. */
  bars: string[]
}

export interface ModelDiagramSceneBlock {
  stops: ModelDiagramStopBlock[]
  /** The strip's groups, in order; a note is the dashed "repeats" card. */
  strip: ({ label: string; stops: string[] } | { note: string })[]
  all: ModelDiagramFrameBlock
  grids: ModelDiagramGridBlock[]
  slabs: ModelDiagramSlabBlock[]
  rods: ModelDiagramRodBlock[]
  lines: ModelDiagramLineBlock[]
  sprites: ModelDiagramSpriteBlock[]
  dots: ModelDiagramDotBlock[]
  labels: ModelDiagramLabelBlock[]
  what: ModelDiagramCardItemBlock[]
  weights: ModelDiagramCardItemBlock[]
  /** The row and column the focused stop is shown at work on. */
  at: { t: number; i: number } | null
  tokens: string[]
  batch: number
  /** The next-word passes of this input, when its values hold more tokens than the prompt. */
  passes: { pass: number; count: number; written: string[]; next: string } | null
  /** The letters used in the shapes, from this model's own axes. */
  legend: [string, string][]
  /** A model with so many steps that their titles are set on one line and kept small. */
  dense: boolean
  /** The heads of the attention step in focus, for a head picker; null elsewhere. */
  heads: { count: number; head: number; saved: number[] } | null
  /** The examples in the values' batch, for a slider; null when there is one. */
  examples: { count: number; index: number } | null
  /** The saved numbers of the bar that was clicked, as a card; null when none is open. */
  open: ModelDiagramCardItemBlock[] | null
}

export interface ModelDiagramStateBlock {
  /** The stop in focus, or null for the whole model. */
  focus: string | null
  /** The row (token position) shown at work. */
  t: number
  /** The chosen column, per stop. */
  sel: Record<string, number>
}

export interface ModelDiagramPassStateBlock {
  /** How many words the model has written so far: pass 0 reads the prompt alone. */
  pass?: number
  /** Tint the row the newest token added, in every bar. */
  showNew?: boolean
  /** The attention head in front, from 0. */
  head?: number
  /** Which example of the batch is drawn, from 0, when the values hold more than one. */
  example?: number
  /** The bar whose saved numbers are laid out as a table (a click on it). */
  open?: string | null
  /** The stage's size on screen, in pixels: the numbers inside a step are spaced to clear each other at this size. */
  stage?: { w: number; h: number }
}

export const MODEL_DIAGRAM_START_STATE_BLOCK: ModelDiagramStateBlock = { focus: null, t: 5, sel: {} }

// ---------------------------------------------------------------- numbers

const fmtN = (n: number) => n.toLocaleString('en-US')
/** A signed number to two places, the way the drawing writes every value. */
export function modelDiagramSignedBlock(v: number): string {
  if (v === -Infinity) return '−∞'
  if (!Number.isFinite(v)) return '·'
  return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2)
}
const sg = modelDiagramSignedBlock
const gelu = (z: number) => 0.5 * z * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z * z * z)))
const bendShare = (z: number) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z * z * z)))

/**
 * How many columns of a row of `size` numbers are drawn. A log scale: every
 * doubling of the true size adds four columns (768 draws 8, 3,072 draws 16),
 * so a wide layer looks wider without becoming a pillar. The true size is
 * always written under the bar.
 */
export function modelDiagramColumnsBlock(size: number): number {
  if (size <= 32) return Math.max(1, size)
  const n = 2 * Math.round((4 * Math.log2(size) - 30.34) / 2)
  return Math.max(4, Math.min(32, n))
}
const MAX_ROWS = 32

// ---------------------------------------------------------------- the plan

interface BarPlan {
  key: string; x: number; y: number
  kind: 'act' | 'score' | 'prob'
  size: number
  name: string
  slice: string
  square: boolean
  /** Columns drawn when it is not the log rule's count (the most likely tokens). */
  cols?: number
  /** A memory's state: one small square per head, laid out as a bank of cells. */
  cells?: { heads: number; side: number }
  /** An attention grid: how many heads stand behind it, and whether a token is kept from looking ahead. */
  heads?: number
  masked?: boolean
}
interface StopPlan {
  id: string; opId: string; part: string
  unit: ModelDiagramUnitKind
  circle: string
  key: string
  ux: number; uy: number
  group: string; chip: string; text: string
  /** The bars this stop reads. */
  ins: string[]
  /** Slice names of this stop's weights and intercepts. */
  w: string[]; b: string[]
  /** An add whose result starts a new row: the stream's path there. */
  wrap?: { fromY: number; next: string; left: number }
  /** The pre-activation slice of a layer drawn together with its bend. */
  pre?: string
  act?: string
  noBias?: boolean
}
interface Plan {
  stops: StopPlan[]
  bars: Map<string, BarPlan>
  /** Bars drawn without a stop of their own (the stream after the repeated blocks). */
  extraBars: { key: string; rowOf: string }[]
  ghosts: { xs: number[]; y: number; more: number; what: string }[]
  /** The stream carried down to the start of a new row, where the next block or region begins. */
  carries: { from: [number, number]; midY: number; left: number; to: string; label: string }[]
  /** A second tower's result brought across to the op that joins it in. */
  routes: { fromKey: string; stop: string; viaX: number }[]
  /** A memory's state, drawn as a block of fixed size over its unit. */
  cubes: { x: number; y: number; dims: number[]; stop: string }[]
  groupLabels: { x: number; y: number; z: number; parts: [string, string][]; region?: boolean }[]
  embed: { stop: string; x: number; tables: { title: string; size: string; sub: string; slice: string; rowLabel: 'token' | 'position' }[] } | null
  strip: ModelDiagramSceneBlock['strip']
  feedback: string | null
  legend: [string, string][]
  facts: ModelDiagramTextFactsBlock
  alias: Map<string, string>
}

const ATT = { normY: 11.5, normUnitY: 7, q: 17.5, k: 11.5, v: 5.5, grid: 14.5, mix: 10, addY: 3 }
const MLP = { normY: 10, normUnitY: 6, y: 10, addY: 4 }
const PITCH = 12
const ROW = 30
/** The drop to a row whose branch is attention, when the row above is not: attention stands taller over its stream. */
const ROW_TALL = 44

/** The op's plain name, as the generator writes it, falling back to its id. */
/** The bend an op applies: its own field, or the name after the plus sign in its label. */
const actOf = (op: ModelOpBlock) => { const a = (op as ModelOpBlock & { act?: string }).act ?? /\+\s*([A-Za-z0-9]+)\s*$/.exec(op.name ?? '')?.[1] ?? /\(([A-Za-z0-9]+)\)\s*$/.exec(op.name ?? '')?.[1] ?? 'GELU'; return a.toLowerCase() === 'silu' ? 'SiLU' : a.toUpperCase() }
const normName = (op: ModelOpBlock) => (/rms/i.test(op.name ?? '') ? 'RMS norm' : 'Layer norm')
const plainName = (op: ModelOpBlock) => (op as ModelOpBlock & { name?: string }).name ?? op.note ?? op.id

function planOf(spec: ModelSpec): Plan {
  const tensor = new Map(spec.tensors.map((t) => [t.id, t]))
  const axis = (a: string | number) => (typeof a === 'number' ? a : spec.axes[a] ?? 0)
  const lastSize = (id: string) => { const t = tensor.get(id); return t && t.axes.length ? axis(t.axes[t.axes.length - 1]) : 0 }
  const rank = (id: string) => tensor.get(id)?.axes.length ?? 0
  const blockOf = new Map(spec.blocks.map((b) => [b.id, b]))
  const stepOf = new Map<string, number>()
  spec.steps.forEach((s, n) => { if (!stepOf.has(s.id)) stepOf.set(s.id, n + 1) })

  const width = lastSize(spec.stream[0] ?? '') || spec.axes.width || 0
  const firstAtt = spec.ops.find((o) => o.kind === 'attention')
  const firstMlp = spec.ops.find((o) => o.kind === 'mlp')
  const heads = firstAtt?.heads ?? spec.axes.heads ?? 1
  const actName = firstMlp ? actOf(firstMlp) : 'GELU'
  const facts: ModelDiagramTextFactsBlock = {
    heads, headWidth: spec.axes.head_width ?? (heads ? Math.round(width / heads) : width),
    width: fmtN(width), mlpWidth: fmtN(spec.axes.mlp_width ?? width * 4), vocab: fmtN(spec.axes.vocab ?? 0), act: actName, addStep: 0,
  }

  const plan: Plan = { stops: [], bars: new Map(), extraBars: [], ghosts: [], carries: [], routes: [], cubes: [], groupLabels: [], embed: null, strip: [], feedback: null, legend: [], facts, alias: new Map() }
  const text = (part: string) => modelDiagramPartTextBlock(part, facts)
  let maxX = 0
  const bar = (b: BarPlan) => { plan.bars.set(b.key, b); if (b.x > maxX) maxX = b.x; return b }
  const stop = (s: Omit<StopPlan, 'circle' | 'w' | 'b'> & Partial<Pick<StopPlan, 'circle' | 'w' | 'b'>>) => {
    plan.stops.push({ circle: MODEL_DIAGRAM_CIRCLE_BLOCK[s.unit] ?? 'Σ', w: [], b: [], ...s }); if (s.ux + 11 > maxX) maxX = s.ux + 11; return s
  }
  const resolve = (id: string) => plan.alias.get(id) ?? id
  const wOf = (op: ModelOpBlock, prefix: string) => [`${prefix}.weight`, ...op.weights.filter((w) => rank(w) >= 2)]
  const bOf = (op: ModelOpBlock, prefix: string) => [`${prefix}.bias`, ...op.weights.filter((w) => rank(w) === 1)]

  let row = 0
  let x = 0
  // A tower (the vision tower, the language model) is a lane of its own, laid out from its own origin, left to right.
  let ox = 0
  let lane = -1
  let handOver = false
  const inputOuts = new Set(spec.ops.filter((o) => o.kind === 'input').flatMap((o) => o.out))
  const startsLane = (o: ModelOpBlock) => (o.kind === 'embed' || o.kind === 'patchify') && o.in.length > 0 && o.in.every((id) => inputOuts.has(id))
  const laneCount = Math.max(1, spec.ops.filter(startsLane).length)
  const laneName = (o: ModelOpBlock) => (o.kind === 'patchify' ? 'Vision' : 'Language')
  let laneLabel = ''
  const blockName = (id: string | undefined) => { const b = spec.blocks.find((k) => k.id === id); return (b as { name?: string } | undefined)?.name ?? id ?? 'block' }
  let streamKey = ''
  let branch: { kind: 'att' | 'mlp' | 'mem'; x: number; norms: number } | null = null
  let normsSeen = 0
  let seenBlock = false
  const ops = spec.ops
  const branchKindFrom = (from: number): 'att' | 'mlp' | 'mem' => {
    for (let j = from; j < ops.length; j++) {
      if (ops[j].kind === 'attention') return 'att'
      if (ops[j].kind === 'memory') return 'mem'
      if (ops[j].kind === 'mlp' || ops[j].kind === 'add') return 'mlp'
    }
    return 'mlp'
  }
  const group = (op: ModelOpBlock) => {
    if (!op.block) { const g = handOver ? 'Hand-over' : seenBlock ? 'Out' : 'In'; return laneCount > 1 ? `${laneLabel}: ${g}` : g }
    const kind = branch?.kind === 'att' ? 'Attention' : branch?.kind === 'mem' ? 'Memory' : 'MLP'
    return spec.blocks.length > 1 ? `${blockName(op.block)}: ${kind}` : `Block 1: ${kind}`
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const out = op.out[0] ?? op.id
    if (op.kind === 'input') continue
    if (startsLane(op)) {
      lane++
      if (streamKey) { ox = maxX + 42; row = 0; x = ox; streamKey = ''; seenBlock = false; normsSeen = 0; branch = null; handOver = false }
      laneLabel = laneName(op)
      if (laneCount > 1) plan.groupLabels.push({ x: ox + 40, y: 27.5, z: 0, region: true, parts: op.kind === 'patchify'
        ? [['', 'VISION TOWER'], ['sm', 'the picture, cut into patches, each one a row']]
        : [['', 'LANGUAGE MODEL'], ['sm', 'the words and the picture’s rows, in one line']] })
    }

    if (op.kind === 'embed' && !streamKey) {
      // The embedding, with a position table and the add that follows it drawn as one step.
      let last = out
      const tables: NonNullable<Plan['embed']>['tables'] = []
      const table = (o: ModelOpBlock, title: string, rowLabel: 'token' | 'position') => {
        const w = o.weights.find((id) => rank(id) === 2)
        const t = w ? tensor.get(w) : undefined
        const rows = t ? axis(t.axes[0]) : 0
        const cols = t ? axis(t.axes[1]) : width
        tables.push({ title, size: t ? `${fmtN(rows)} rows x ${fmtN(cols)} = ${fmtN(rows * cols)} weights` : '', sub: '', slice: rowLabel === 'token' ? o.out[0] ?? o.id : `${o.id}.rows`, rowLabel })
      }
      table(op, 'word table', 'token')
      let j = i + 1
      if (ops[j]?.kind === 'position' && !ops[j].block) { table(ops[j], 'position table', 'position'); last = ops[j].out[0] ?? last; j++ }
      if (tables.length > 1 && ops[j]?.kind === 'add' && !ops[j].block) { last = ops[j].out[0] ?? last; j++ }
      for (let k = i; k < j; k++) for (const o of ops[k].out) plan.alias.set(o, last)
      plan.alias.delete(last)
      i = j - 1
      bar({ key: last, x: ox, y: row, kind: 'act', size: lastSize(last) || width, name: 'The stream after embedding', slice: last, square: false })
      stop({ id: op.id, opId: op.id, part: '', unit: 'lookup', key: last, ux: ox - 6, uy: row, group: group(op), chip: 'Embedding', text: text(tables.length > 1 ? 'embed' : 'embed-only'), ins: [] })
      plan.embed = { stop: op.id, x: ox, tables }
      streamKey = last; x = ox
      continue
    }

    if (!streamKey) {
      // A model that does not open with an embedding: its first output is the stream's first bar, and what it
      // reads (the picture's patches, each one a row of pixel numbers) is drawn before it.
      const inKey = op.in[0] && tensor.has(op.in[0]) ? op.in[0] : ''
      const inOp = inKey ? spec.ops.find((o) => o.kind === 'input' && o.out.includes(inKey)) : undefined
      if (inKey) bar({ key: inKey, x: ox - PITCH, y: row, kind: 'act', size: lastSize(inKey), name: inOp?.note ?? (inOp ? plainName(inOp) : 'what goes in'), slice: inKey, square: false })
      if (inKey) plan.extraBars.push({ key: inKey, rowOf: op.id })
      bar({ key: out, x: ox, y: row, kind: 'act', size: lastSize(out), name: plainName(op), slice: out, square: false })
      const layer = inKey && op.kind === 'patchify'
      stop({ id: op.id, opId: op.id, part: '', unit: layer ? 'linear' : 'plain', circle: layer ? 'Σ' : MODEL_DIAGRAM_CIRCLE_BLOCK[op.kind] ?? 'Σ', key: out, ux: ox - 6, uy: row, group: group(op), chip: plainName(op), text: text(op.kind), ins: inKey ? [inKey] : [], w: layer ? [`${op.id}.weight`] : [], b: layer ? [`${op.id}.bias`] : [] })
      streamKey = out; x = ox
      continue
    }

    if (op.block) seenBlock = true
    const inBlock = Boolean(op.block)

    if (op.kind === 'add') {
      const kind = branch?.kind ?? 'mlp'
      const bx = branch?.x ?? x
      const ux = bx + 6
      const uy = row + (kind !== 'mlp' ? ATT.addY : MLP.addY)
      const fromY = row
      // A long branch, or one with another branch of the same block to come, hands the stream on to a new row.
      const wraps = ux - ox >= 72 || (inBlock && ops[i + 1]?.block === op.block && ux - ox >= 36)
      if (wraps) { row -= kind === 'mlp' && branchKindFrom(i + 1) !== 'mlp' ? ROW_TALL : ROW; x = ox } else x = ux + 6
      const stream = resolve(op.in.find((id) => resolve(id) === streamKey) ?? op.in[0] ?? streamKey)
      const other = resolve(op.in.find((id) => resolve(id) !== stream) ?? op.in[1] ?? stream)
      bar({ key: out, x, y: row, kind: 'act', size: lastSize(out) || width, name: kind === 'att' ? 'the stream after attention is added' : kind === 'mem' ? 'the stream after the memory is added' : 'the stream leaving the block', slice: out, square: false })
      const nk = branchKindFrom(i + 1), nextKind = nk === 'att' ? 'attention' : nk === 'mem' ? 'the memory' : 'the MLP'
      stop({
        id: op.id, opId: op.id, part: '', unit: 'sum', key: out, ux, uy, group: group(op), chip: 'Add to the stream',
        text: text(kind === 'att' ? 'add-attention' : kind === 'mlp' && firstMlp ? 'add-mlp' : 'add'), ins: [stream, other],
        wrap: wraps ? { fromY, next: nextKind, left: ox - 7 } : undefined, act: kind === 'att' ? 'from attention' : kind === 'mem' ? 'from the memory' : 'from the MLP',
      })
      if (kind === 'att') {
        if (!facts.addStep) facts.addStep = plan.stops.length
        plan.groupLabels.push({ x: bx - 36, y: fromY - 2.2, z: 0, parts: [['sm', `the stream skips past attention and is added back at step ${plan.stops.length}`]] })
      }
      streamKey = out; branch = null
    } else if (inBlock) {
      if (!branch) {
        branch = { kind: branchKindFrom(i), x, norms: 0 }
        plan.groupLabels.push(branch.kind === 'att'
          ? { x: x + 42, y: row + 21.6, z: 0, parts: [['', 'ATTENTION'], ['sm', 'positions exchange information']] }
          : branch.kind === 'mem'
            ? { x: x + 36, y: row + 21.6, z: 0, parts: [['', 'MEMORY'], ['sm', 'a state of fixed size, updated token by token']] }
            : { x: x + 3, y: row + 12.8, z: 0, parts: [['', 'MLP'], ['sm', 'each position on its own']] })
      }
      const k = branch.kind
      const src = resolve(op.in[0] ?? streamKey)
      const g = group(op)
      if (op.kind === 'norm') {
        normsSeen++
        const nth = normsSeen === 1 ? 'first' : normsSeen === 2 ? 'second' : 'next'
        bar({ key: out, x: branch.x + PITCH, y: row + (k !== 'mlp' ? ATT.normY : MLP.normY), kind: 'act', size: lastSize(out) || width, name: `the stream after the ${nth} layer norm`, slice: out, square: false })
        stop({ id: op.id, opId: op.id, part: '', unit: 'norm', key: out, ux: branch.x + 6, uy: row + (k !== 'mlp' ? ATT.normUnitY : MLP.normUnitY), group: g, chip: normName(op), text: text(normsSeen === 1 ? 'norm' : 'norm-again'), ins: [src], w: [`${op.id}.weight`, ...op.weights.slice(0, 1)], b: [`${op.id}.bias`, ...op.weights.slice(1, 2)] })
        branch.x += PITCH
      } else if (op.kind === 'attention') {
        const bx = branch.x
        const T = spec.axes.tokens ?? 0
        const qkv: [string, string, number, string][] = [['q', 'queries', ATT.q, 'Query'], ['k', 'keys', ATT.k, 'Key'], ['v', 'values', ATT.v, 'Value']]
        for (const [part, name, dy, chip] of qkv) {
          const key = `${op.id}.${part}`
          bar({ key, x: bx + PITCH, y: row + dy, kind: 'act', size: lastSize(key) || lastSize(src) || width, name, slice: key, square: false })
          stop({ id: key, opId: op.id, part, unit: 'linear', key, ux: bx + 6, uy: row + dy, group: g, chip, text: text(part), ins: [src], w: [`${key}.weight`], b: [`${key}.bias`] })
        }
        const sKey = `${op.id}.scores`, aKey = `${op.id}.weights`, mKey = `${op.id}.mixed`
        const masked = op.mask !== 'none'
        bar({ key: sKey, x: bx + 2 * PITCH, y: row + ATT.grid, kind: 'score', size: T, name: 'similarity between a query and a key', slice: sKey, square: true, heads: op.heads ?? heads, masked })
        stop({ id: sKey, opId: op.id, part: 'scores', unit: 'dot', key: sKey, ux: bx + 18, uy: row + ATT.grid, group: g, chip: masked ? 'Similarity + mask' : 'Similarity', text: text(masked ? 'scores' : 'scores-open'), ins: [`${op.id}.q`, `${op.id}.k`] })
        bar({ key: aKey, x: bx + 3 * PITCH, y: row + ATT.grid, kind: 'prob', size: T, name: 'attention weights', slice: aKey, square: true, heads: op.heads ?? heads, masked })
        stop({ id: aKey, opId: op.id, part: 'weights', unit: 'softmax', key: aKey, ux: bx + 30, uy: row + ATT.grid, group: g, chip: 'Attention weights', text: text('weights'), ins: [sKey] })
        bar({ key: mKey, x: bx + 4 * PITCH, y: row + ATT.mix, kind: 'act', size: lastSize(mKey) || lastSize(src) || width, name: 'values mixed across positions', slice: mKey, square: false })
        stop({ id: mKey, opId: op.id, part: 'mix', unit: 'mix', key: mKey, ux: bx + 42, uy: row + ATT.mix, group: g, chip: 'Mix the values', text: text('mix'), ins: [aKey, `${op.id}.v`] })
        const gKey = `${op.id}.gate`
        if (tensor.has(gKey)) {
          bar({ key: gKey, x: bx + 4 * PITCH, y: row + ATT.q, kind: 'act', size: lastSize(gKey) || width, name: 'the gate: how much of each head’s result to let through', slice: gKey, square: false })
          stop({ id: gKey, opId: op.id, part: 'gate', unit: 'linear', key: gKey, ux: bx + 42, uy: row + ATT.q, group: g, chip: 'Gate', text: text('gate'), ins: [src], w: [`${gKey}.weight`], b: [`${gKey}.bias`] })
          const mix = plan.stops.find((x) => x.id === mKey)!
          mix.ins.push(gKey); mix.chip = 'Mix the values, then gate'; mix.text += ' ' + text('gate-mix')
        }
        bar({ key: out, x: bx + 5 * PITCH, y: row + ATT.mix, kind: 'act', size: lastSize(out) || width, name: 'what attention adds to the stream', slice: out, square: false })
        stop({ id: `${op.id}.out`, opId: op.id, part: 'out', unit: 'linear', key: out, ux: bx + 54, uy: row + ATT.mix, group: g, chip: 'Output layer', text: text('out'), ins: [mKey], w: [`${op.id}.out.weight`], b: [`${op.id}.out.bias`] })
        branch.x += 5 * PITCH
      } else if (op.kind === 'memory') {
        const bx = branch.x
        const dims = (op.state ?? []).map(axis).filter((n) => n > 0)
        const mh = dims[1] ?? 1, side = dims[2] ?? 1
        facts.memHeads = mh; facts.memSide = side
        const qkv: [string, string, number, string][] = [['q', 'read keys: what each token reads the memory with', ATT.q, 'Read key'], ['k', 'write keys: where each token writes', ATT.k, 'Write key'], ['v', 'what each token writes', ATT.v, 'What to write']]
        for (const [part, name, dy, chip] of qkv) {
          const key = `${op.id}.${part}`
          bar({ key, x: bx + PITCH, y: row + dy, kind: 'act', size: lastSize(key) || width, name, slice: key, square: false })
          stop({ id: key, opId: op.id, part, unit: 'linear', key, ux: bx + 6, uy: row + dy, group: g, chip, text: text(`memory-${part}`), ins: [src], w: [`${key}.weight`], b: [`${key}.bias`] })
        }
        const sKey = `${op.id}.state`, mKey = `${op.id}.mixed`
        bar({ key: sKey, x: bx + 2 * PITCH, y: row + ATT.grid, kind: 'act', size: side, name: 'the memory after the last token', slice: sKey, square: false, cells: { heads: mh, side } })
        stop({ id: sKey, opId: op.id, part: 'state', unit: 'plain', circle: 'fade|+|write', key: sKey, ux: bx + 18, uy: row + ATT.grid, group: g, chip: 'Fade, then write', text: text('memory-write'), ins: [`${op.id}.k`, `${op.id}.v`] })
        bar({ key: mKey, x: bx + 3 * PITCH, y: row + ATT.mix, kind: 'act', size: lastSize(mKey) || width, name: 'each token’s reading from the memory', slice: mKey, square: false })
        stop({ id: mKey, opId: op.id, part: 'read', unit: 'plain', circle: 'read', key: mKey, ux: bx + 30, uy: row + ATT.mix, group: g, chip: 'Read, scale and gate', text: text('memory-read'), ins: [sKey, `${op.id}.q`] })
        bar({ key: out, x: bx + 4 * PITCH, y: row + ATT.mix, kind: 'act', size: lastSize(out) || width, name: 'what the memory adds to the stream', slice: out, square: false })
        stop({ id: `${op.id}.out`, opId: op.id, part: 'out', unit: 'linear', key: out, ux: bx + 42, uy: row + ATT.mix, group: g, chip: 'Output layer', text: text('memory-out'), ins: [mKey], w: [`${op.id}.out.weight`], b: [`${op.id}.out.bias`] })
        branch.x += 4 * PITCH
      } else if (op.kind === 'mlp' && tensor.has(`${op.id}.up`) && op.weights.includes(`${op.id}.gate.weight`)) {
        // A gated MLP: two layers read the same row, one is bent and multiplies the other.
        const bx = branch.x
        const y = row + (k !== 'mlp' ? ATT.mix : MLP.y)
        const an = actOf(op), hidden = lastSize(`${op.id}.act`) || spec.axes.mlp_width || width * 4
        const pKey = `${op.id}.pre`, uKey = `${op.id}.up`, aKey = `${op.id}.act`
        bar({ key: pKey, x: bx + PITCH, y: y + 3.3, kind: 'act', size: hidden, name: 'the gate layer’s sums, before the bend', slice: pKey, square: false })
        stop({ id: pKey, opId: op.id, part: 'gate', unit: 'linear', key: pKey, ux: bx + 6, uy: y + 3.3, group: g, chip: 'MLP gate layer', text: text('mlp-gate'), ins: [src], w: [`${op.id}.gate.weight`], b: [`${op.id}.gate.bias`] })
        bar({ key: uKey, x: bx + PITCH, y: y - 3.3, kind: 'act', size: hidden, name: 'the up layer’s sums', slice: uKey, square: false })
        stop({ id: uKey, opId: op.id, part: 'up', unit: 'linear', key: uKey, ux: bx + 6, uy: y - 3.3, group: g, chip: 'MLP up layer', text: text('mlp-up-plain'), ins: [src], w: [`${op.id}.up.weight`], b: [`${op.id}.up.bias`] })
        bar({ key: aKey, x: bx + 2 * PITCH, y, kind: 'act', size: hidden, name: `the gate after ${an}, times the up layer`, slice: aKey, square: false })
        stop({ id: aKey, opId: op.id, part: 'times', unit: 'plain', circle: `${an}|×`, key: aKey, ux: bx + 18, uy: y, group: g, chip: `${an}, then multiply`, text: text('mlp-times'), ins: [pKey, uKey], act: an })
        bar({ key: out, x: bx + 3 * PITCH, y, kind: 'act', size: lastSize(out) || width, name: 'what the MLP adds to the stream', slice: out, square: false })
        stop({ id: `${op.id}.down`, opId: op.id, part: 'down', unit: 'linear', key: out, ux: bx + 30, uy: y, group: g, chip: 'MLP layer down', text: text('mlp-down'), ins: [aKey], w: [`${op.id}.down.weight`], b: [`${op.id}.down.bias`] })
        branch.x += 3 * PITCH
      } else if (op.kind === 'mlp') {
        const bx = branch.x
        const aKey = `${op.id}.act`
        const hidden = spec.axes.mlp_width ?? width * 4
        const y = row + (k === 'att' ? ATT.mix : MLP.y)
        const an = actOf(op)
        bar({ key: aKey, x: bx + PITCH, y, kind: 'act', size: hidden, name: 'MLP neurons after the nonlinearity', slice: aKey, square: false })
        stop({ id: aKey, opId: op.id, part: 'up', unit: 'relu', circle: `Σ|+|${an}`, key: aKey, ux: bx + 6, uy: y, group: g, chip: `MLP layer 1 + ${an}`, text: text('mlp-up'), ins: [src], w: [`${op.id}.up.weight`], b: [`${op.id}.up.bias`], pre: `${op.id}.pre`, act: an })
        bar({ key: out, x: bx + 2 * PITCH, y, kind: 'act', size: lastSize(out) || width, name: 'what the MLP adds to the stream', slice: out, square: false })
        stop({ id: `${op.id}.down`, opId: op.id, part: 'down', unit: 'linear', key: out, ux: bx + 18, uy: y, group: g, chip: 'MLP layer 2', text: text('mlp-down'), ins: [aKey], w: [`${op.id}.down.weight`], b: [`${op.id}.down.bias`] })
        branch.x += 2 * PITCH
      } else {
        const y = row + (k === 'att' ? ATT.mix : MLP.y)
        const unit: ModelDiagramUnitKind = op.kind === 'linear' ? 'linear' : 'plain'
        bar({ key: out, x: branch.x + PITCH, y, kind: 'act', size: lastSize(out) || width, name: plainName(op), slice: out, square: false })
        stop({ id: op.id, opId: op.id, part: '', unit, circle: MODEL_DIAGRAM_CIRCLE_BLOCK[op.kind] ?? 'Σ', key: out, ux: branch.x + 6, uy: y, group: g, chip: plainName(op), text: text(op.kind), ins: [src], w: wOf(op, op.id), b: bOf(op, op.id) })
        branch.x += PITCH
      }
    } else {
      // After the blocks, along the stream's own row.
      const src = resolve(op.in.find((id) => resolve(id) === streamKey) ?? op.in[0] ?? streamKey)
      x += PITCH
      if (op.kind === 'join') {
        const other = op.in.map(resolve).find((k) => k !== src && plan.bars.has(k))
        if (other) plan.routes.push({ fromKey: other, stop: op.id, viaX: ox - 31 })
      }
      if (op.kind === 'norm') {
        bar({ key: out, x, y: row, kind: 'act', size: lastSize(out) || width, name: 'The stream after the final layer norm', slice: out, square: false })
        stop({ id: op.id, opId: op.id, part: '', unit: 'norm', key: out, ux: x - 6, uy: row, group: group(op), chip: `Final ${normName(op).replace('L', 'l')}`, text: text('norm-final'), ins: [src], w: [`${op.id}.weight`, ...op.weights.slice(0, 1)], b: [`${op.id}.bias`, ...op.weights.slice(1, 2)] })
      } else if (op.kind === 'unembed') {
        bar({ key: out, x, y: row, kind: 'act', size: lastSize(out), name: 'A score for each word', slice: `${op.id}.top`, square: false, cols: 8 })
        stop({ id: op.id, opId: op.id, part: '', unit: 'linear', key: out, ux: x - 6, uy: row, group: group(op), chip: 'Score per word', text: text('unembed'), ins: [src], w: [`${op.id}.top.weight`], noBias: true })
      } else if (op.kind === 'output') {
        bar({ key: out, x, y: row, kind: 'prob', size: lastSize(src) || lastSize(out), name: 'The chance of each word coming next', slice: `${op.id}.top`, square: false, cols: 8 })
        stop({ id: op.id, opId: op.id, part: '', unit: 'softmax', key: out, ux: x - 6, uy: row, group: group(op), chip: 'Chance of each word', text: text('output'), ins: [src] })
        plan.feedback = out
      } else {
        const unit: ModelDiagramUnitKind = op.kind === 'linear' ? 'linear' : 'plain'
        bar({ key: out, x, y: row, kind: 'act', size: lastSize(out) || width, name: plainName(op), slice: out, square: false })
        stop({ id: op.id, opId: op.id, part: '', unit, circle: MODEL_DIAGRAM_CIRCLE_BLOCK[op.kind] ?? 'Σ', key: out, ux: x - 6, uy: row, group: group(op), chip: plainName(op), text: text(op.kind), ins: [src], w: wOf(op, op.id), b: bOf(op, op.id) })
      }
      streamKey = out
    }

    // The end of a repeated block: the repeats collapse into ghost boxes, and
    // the stream is drawn again where they hand it on.
    const blk = op.block ? blockOf.get(op.block) : undefined
    const next = ops[i + 1]
    if (blk && (!next || next.block !== op.block)) {
      branch = null
      const many = spec.blocks.length > 1, what = many ? `${blockName(blk.id).toLowerCase()}s` : 'blocks'
      if (blk.repeat > 1) plan.ghosts.push({ xs: [x + 6, x + 9, x + 12], y: row, more: blk.repeat - 1, what })
      if (next && !startsLane(next)) {
        // What follows starts a row of its own when it is another block, or a region of several steps (a hand-over).
        let tail = 0
        for (let j = i + 1; j < ops.length && !ops[j].block && !startsLane(ops[j]); j++) tail++
        const newRow = Boolean(next.block) || (tail >= 4 && lane < laneCount - 1)
        if (blk.repeat > 1 || newRow) {
          const key = `after:${blk.id}`
          const from = resolve(next.in[0] ?? streamKey)
          if (newRow) {
            plan.carries.push({ from: [x + (blk.repeat > 1 ? 14.2 : 3), row], midY: row - 13.5, left: ox - 7, to: key, label: next.block ? `the stream carries on to the ${blockName(next.block).toLowerCase()}s` : 'the stream is handed over' })
            row -= next.block && branchKindFrom(i + 1) !== 'mlp' ? ROW_TALL : ROW; x = ox
            if (!next.block) { handOver = true; plan.groupLabels.push({ x: ox + 36, y: row + 6.2, z: 0, region: true, parts: [['', 'HAND-OVER'], ['sm', 'the picture’s rows are made the size the language model reads']] }) }
          } else x += 18
          bar({ key, x, y: row, kind: 'act', size: lastSize(streamKey) || width, name: many ? `the stream after the ${what}` : 'the stream after the last block', slice: from === streamKey ? key : from, square: false })
          plan.extraBars.push({ key, rowOf: next.id })
          plan.alias.set(from, key)
          streamKey = key
        }
      }
    }
  }

  // The strip: stops in order, grouped, with the repeats card before the way out.
  let label = ''
  const repeats = spec.blocks.filter((b) => b.repeat > 1)
  for (const s of plan.stops) {
    if (s.group !== label) {
      // once, before the last way out (a model with two towers has an "Out" in each)
      if ((s.group === 'Out' || s.group === 'Language: Out') && repeats.length && !plan.stops.slice(plan.stops.indexOf(s) + 1).some((x) => x.group !== s.group)) {
        plan.strip.push({ note: repeats.length > 1
          ? `A full model repeats each block with different weights each time: ${repeats.map((b) => `the ${blockName(b.id).toLowerCase()} ${b.repeat} times`).join(', ')}.`
          : `A full model repeats the block with different weights each time: ${repeats.map((b) => `${b.repeat} times`).join(', ')} in ${spec.source.model}.` })
      }
      plan.strip.push({ label: s.group, stops: [] })
      label = s.group
    }
    (plan.strip[plan.strip.length - 1] as { stops: string[] }).stops.push(s.id)
  }
  if (laneCount > 1) {
    const A = spec.axes, n = (k: string) => fmtN(A[k] ?? 0)
    if (A.batch) plan.legend.push(['B', ` = batch = ${n('batch')} here: independent inputs processed in parallel`])
    if (A.patches) plan.legend.push(['P', ` = patches = ${n('patches')}: the picture's squares, each one a row`])
    if (A.tokens) plan.legend.push(['T', ` = tokens = ${n('tokens')}: the words and the picture's rows in one line`])
    const vw = A.v_width ? `${n('v_width')} in the vision tower, ` : ''
    plan.legend.push(['C', ` = width of a row: ${vw}${fmtN(width)} in the language model`])
    if ([...plan.bars.values()].some((b) => b.size > 3072)) plan.legend.push(['— —', ' a ruler with a gap is not to scale'])
  } else {
    plan.legend.push(['B', ' = batch size = no. of independent sequences processed in parallel'], ['T', ' = block size = context length = time dimension'], ['C', ' = channel size = embedding size'])
  }
  void stepOf
  return plan
}

// ---------------------------------------------------------------- the scene

type Part = { type: 'act'; k: string; t: number; i: number; val: number } | { type: 'w'; label: string; val: number }
interface Term { label: string; parts: Part[]; product: number }
interface Explain {
  kind: string
  value: number
  formula?: string
  terms: Term[]
  bias?: { label: string; val: number } | null
  restN?: number; restSum?: number; restPct?: boolean
  nIn?: number; nOut?: number
  W?: number[][]; Wb?: number[] | null
  mean?: number; sd?: number; g?: number; shift?: number; rowKey?: string
}
interface Reg { rows: number[][]; kind: 'act' | 'score' | 'prob'; size: number; real: boolean }

const planCache = new WeakMap<ModelSpec, Plan>()

/** The stops of a model, in strip order, without laying anything out. */
export function modelDiagramStopsBlock(spec: ModelSpec): { id: string; opId: string; part: string; specStep: number }[] {
  const plan = planFor(spec)
  const stepOf = specSteps(spec)
  return plan.stops.map((s) => ({ id: s.id, opId: s.opId, part: s.part, specStep: stepOf(s) }))
}
function planFor(spec: ModelSpec): Plan {
  let plan = planCache.get(spec)
  if (!plan) { plan = planOf(spec); planCache.set(spec, plan) }
  return plan
}
function specSteps(spec: ModelSpec) {
  const byId = new Map<string, number>()
  spec.steps.forEach((s, n) => { if (!byId.has(s.id)) byId.set(s.id, n + 1) })
  const blockOfOp = new Map(spec.ops.map((o) => [o.id, o.block]))
  return (s: { opId: string }) => byId.get(s.opId) ?? byId.get(blockOfOp.get(s.opId) ?? '') ?? 0
}

/**
 * Lay a model out. `values` may be null: the structure is then drawn with flat
 * tiles and no arithmetic. The same spec, values and state always give the
 * same scene.
 */
export function layoutModelDiagramBlock(spec: ModelSpec, values: ModelValues | null, state: ModelDiagramStateBlock & ModelDiagramPassStateBlock): ModelDiagramSceneBlock {
  const first = layoutOnce(spec, values, state)
  const stop = state.focus ? first.stops.find((s) => s.id === state.focus) : undefined
  if (!stop) return first
  // The step in focus has opened up (its numbers, its table of weights, its sum). A bar it neither reads nor writes
  // that now sits inside its view steps back, down or up, until it is clear; with nothing in focus it is back in its place.
  const f = stop.frame, mine = new Set(stop.bars), planned = planFor(spec).bars
  const near = first.grids.filter((g) => planned.has(g.key) && !mine.has(g.key) && Math.abs(g.cx - f.cx) < f.hw + g.w / 2)
  let down = 0, up = 0
  for (const g of near) {
    if (g.cy < f.cy) down = Math.max(down, g.cy + g.h / 2 + 0.8 - (f.cy - f.hh))
    else up = Math.max(up, f.cy + f.hh - (g.cy - g.h / 2 - 0.8))
  }
  if (down <= 0.05 && up <= 0.05) return first
  const shift = new Map<string, number>()
  for (const g of near) { const d = g.cy < f.cy ? -Math.max(0, down) : Math.max(0, up); if (d) shift.set(g.key, d) }
  return shift.size ? layoutOnce(spec, values, state, shift) : first
}

function layoutOnce(spec: ModelSpec, values: ModelValues | null, state: ModelDiagramStateBlock & ModelDiagramPassStateBlock, shift?: Map<string, number>): ModelDiagramSceneBlock {
  const plan0 = planFor(spec)
  const plan: Plan = !shift ? plan0 : {
    ...plan0,
    bars: new Map([...plan0.bars].map(([k, b]) => [k, shift.has(k) ? { ...b, y: b.y + shift.get(k)! } : b])),
    stops: plan0.stops.map((s) => (shift.has(s.key) ? { ...s, uy: s.uy + shift.get(s.key)! } : s)),
  }
  const stepOf = specSteps(spec)
  const facts = plan.facts
  const HS = facts.headWidth
  const WIN = 8
  const allTokens = values?.tokens ?? []
  const promptLen = values?.prompt_tokens && values.prompt_tokens <= allTokens.length ? values.prompt_tokens : allTokens.length
  const passCount = Math.max(1, Math.min(allTokens.length, MAX_ROWS) - promptLen + 1)
  const pass = Math.max(0, Math.min(state.pass ?? 0, passCount - 1))
  // One pass reads the first tokens only; earlier rows are the same on every pass.
  const tokens = allTokens.slice(0, promptLen + pass)
  const showNew = (state.showNew ?? true) && pass > 0
  const top = values?.top_by_pass?.[pass] as Record<string, unknown> | undefined
  const T = Math.max(1, Math.min(MAX_ROWS, tokens.length || spec.axes.tokens || 1))
  const batch = spec.axes.batch ?? 1
  const word = (r: number) => tokens[r] ?? String(r + 1)
  // The name of a bar's row: its token, or the row's number when the rows are not tokens (patches) or were chosen.
  const X = (values ?? {}) as unknown as { picture?: { first_row?: number; last_row?: number }; attention_last_row?: Record<string, Record<string, number[]>>; attention_last_row_every?: number }
  const pic = typeof X.picture?.first_row === 'number' && typeof X.picture?.last_row === 'number' ? { first: X.picture.first_row, last: X.picture.last_row } : null
  // A head other than the first is drawn only where its numbers exist: the attention weights and the mix that uses them.
  // Everywhere else the drawing stays on head 1, whatever the picker was last left at.
  const headStep = plan.stops.find((s) => s.id === state.focus)
  const head = headStep && (headStep.part === 'weights' || headStep.part === 'mix') ? Math.max(0, Math.floor(state.head ?? 0)) : 0
  // An attention map as the file writes it ({ rows, row_ids }) or as the parser hands it on (rows, with the ids beside).
  const attMap = (op: string, h: number): { rows: number[][]; ids?: number[] } | null => {
    const m = values?.attention?.[op]?.[String(h)] as unknown
    if (!m) return null
    if (Array.isArray(m)) return { rows: m as number[][], ids: values?.attention_row_ids?.[op]?.[String(h)] }
    const o = m as { rows?: number[][]; row_ids?: number[] }
    return o.rows ? { rows: o.rows, ids: o.row_ids } : null
  }
  const attOf = (slice: string) => slice.replace(/\.(weights|scores)$/, '')
  /** The token (or patch) number of a bar's row, when its rows are tokens. */
  const tokenRows = (slice: string) => { const t = spec.tensors.find((x) => x.id === slice); return !t || t.axes.includes('tokens') }
  const rowToken = (slice: string, r: number): number | null => {
    if (!tokenRows(slice)) return null
    const sl = values?.slices?.[slice]
    if (!sl) { const am = attMap(attOf(slice), 0); return am ? am.ids?.[r] ?? r : values ? r : null }
    const rowsAxis = sl.shape.length >= 2 ? sl.shape[sl.shape.length - 2] : 0
    return rowsAxis === allTokens.length || !sl.row_ids ? sl.row_ids?.[r] ?? r : null
  }
  const isPic = (slice: string, r: number) => { const n = rowToken(slice, r); return pic !== null && n !== null && allTokens.length > pic.last && n >= pic.first && n <= pic.last && /pad|image/i.test(allTokens[n] ?? '') }
  // The name of a bar's row: its token, or the row's number when the rows are not tokens (patches) or were chosen.
  const rowName = (slice: string, r: number) => {
    const n = rowToken(slice, r)
    if (n === null) { const am = attMap(attOf(slice), 0); return values?.slices?.[slice] || am || !tokenRows(slice) ? `row ${fmtN((values?.slices?.[slice]?.row_ids?.[r] ?? am?.ids?.[r] ?? r) + 1)}` : word(r) }
    if (isPic(slice, r)) return `picture ${fmtN(n - pic!.first + 1)}`
    return allTokens[n] ?? String(n + 1)
  }
  const extra = (values ?? {}) as unknown as {
    token_ids?: number[]
    labels?: Record<string, string[]>
    row_stats?: Record<string, { mean: number[]; sd: number[] }>
  }

  const scene: ModelDiagramSceneBlock = {
    stops: [], strip: plan.strip, all: { cx: 0, cy: 0, hw: 1, hh: 1 }, grids: [], slabs: [], rods: [], lines: [], sprites: [], dots: [],
    labels: [], what: [], weights: [], at: null, tokens: tokens.slice(0, T), batch, passes: null, legend: plan.legend, dense: plan.stops.length > 24, heads: null, examples: null, open: null,
  }
  const RANK: Record<string, number> = { ttl: 100, grpl: 90, pill: 80, eqn: 70, pu: 55, ex: 55, or: 50, word: 40, ruler: 30 }
  const lab = (tag: string, cls: string, x: number, y: number, z: number, parts: [string, string][], more: Partial<ModelDiagramLabelBlock> = {}) => {
    const first = cls.split(' ')[0]
    const l: ModelDiagramLabelBlock = { p: [x, y, z], cls, parts, tag, rank: RANK[first] ?? 60, ...(first === 'ttl' ? { mode: 'slide' as const } : tag === '*' ? {} : first === 'pill' || first === 'word' || first === 'ruler' ? { mode: 'fixed' as const } : { mode: 'nudge' as const }), ...more }
    scene.labels.push(l); return l
  }
  const rod = (a: V3, b: V3, r: number, color: Col, opacity: number) => { scene.rods.push({ a, b, r, color, opacity }) }
  const thin = (a: V3, b: V3, color: Col, opacity: number) => { scene.lines.push({ a, b, color, opacity }) }
  const lerp = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
  const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const toward = (a: V3, b: V3, d: number): V3 => { const n = dist(a, b) || 1; return lerp(a, b, d / n) }
  const wire = (c: V3, w: number, h: number, d: number, color: Col, opacity: number) => {
    const [x0, x1, y0, y1, z0, z1] = [c[0] - w / 2, c[0] + w / 2, c[1] - h / 2, c[1] + h / 2, c[2] - d / 2, c[2] + d / 2]
    for (const z of [z0, z1]) { thin([x0, y0, z], [x1, y0, z], color, opacity); thin([x1, y0, z], [x1, y1, z], color, opacity); thin([x1, y1, z], [x0, y1, z], color, opacity); thin([x0, y1, z], [x0, y0, z], color, opacity) }
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) thin([x, y, z0], [x, y, z1], color, opacity)
  }

  // ---- the numbers each bar draws
  // A slice saved for several examples holds one block of rows per example.
  let exampleCount = 1
  for (const sl of Object.values(values?.slices ?? {})) {
    const r = sl.rows as unknown[]
    if (Array.isArray(r) && Array.isArray((r[0] as unknown[])?.[0]) && sl.shape.length >= 3 && r.length > exampleCount) exampleCount = r.length
  }
  const example = Math.max(0, Math.min(Math.floor(state.example ?? 0), exampleCount - 1))
  if (exampleCount > 1) scene.examples = { count: exampleCount, index: example }
  const sliceRows = (name: string): number[][] | null => {
    const mine = top?.[name]
    if (Array.isArray(mine) && mine.length) return mine as number[][]
    const s = values?.slices?.[name]
    if (!s || !Array.isArray(s.rows) || !s.rows.length) return null
    const rows = s.rows as unknown[]
    return (Array.isArray((rows[0] as unknown[])?.[0]) ? rows[Math.min(example, rows.length - 1)] : rows) as number[][]
  }
  const firstRows = (names: string[]) => { for (const n of names) { const r = sliceRows(n); if (r) return r } return null }
  const firstVec = (names: string[]): number[] | null => { const r = firstRows(names); return r ? (r.length === 1 ? r[0] : r.map((x) => x[0])) : null }
  const num = (v: unknown) => (typeof v !== 'number' || v < -1e8 ? -Infinity : v)
  const reg = new Map<string, Reg>()
  const put = (key: string, slice: string, kind: Reg['kind'], size: number, square: boolean, cols?: number, masked = true) => {
    let src = sliceRows(slice)
    let lastRow: number[] | null = null
    // similarity scores are saved for the first head only: another head's bar is drawn empty, not with the first head's numbers
    if (square && head > 0 && slice.endsWith('.scores')) src = null
    if (square && slice.endsWith('.weights') && (!src || head > 0)) {
      const op = attOf(slice), am = attMap(op, head)
      if (head > 0) src = null
      if (am) src = am.rows
      else {
        // A head whose whole map was not saved: its last row was, at every few tokens.
        const lr = X.attention_last_row?.[op]?.[String(head)], ids = attMap(op, 0)?.ids, every = X.attention_last_row_every ?? 1
        if (lr && ids && ids[ids.length - 1] === allTokens.length - 1) lastRow = ids.map((id) => lr[Math.floor(id / every)] ?? NaN)
      }
    }
    const nC = square ? T : cols ?? modelDiagramColumnsBlock(size || WIN)
    const real = Boolean(src && src.length >= (square ? T : 1) && (src[0]?.length ?? 0) >= nC)
    // A slice may hold fewer rows than there are tokens (chosen rows): the bar then draws the rows it has.
    const nR = real && !square ? Math.min(T, src!.length) : T
    const rows: number[][] = []
    for (let r = 0; r < nR; r++) {
      const row: number[] = []
      for (let c = 0; c < nC; c++) row.push(square && masked && c > r ? -Infinity : real ? num(src![r][c]) : lastRow && r === nR - 1 ? lastRow[c] ?? NaN : NaN)
      rows.push(row)
    }
    reg.set(key, { rows, kind, size: square ? T : size, real })
  }
  const putCells = (b: BarPlan) => {
    // Eight heads to a line, each head a 2 x 2 patch: the first four numbers of its square.
    const src = sliceRows(b.slice), per = 8, heads = b.cells!.heads
    const rows: number[][] = Array.from({ length: 2 * Math.ceil(heads / per) }, () => new Array<number>(2 * per).fill(NaN))
    for (let h = 0; h < heads; h++) for (let j = 0; j < 4; j++) {
      const v = src?.[h]?.[j]
      if (typeof v === 'number') rows[2 * Math.floor(h / per) + (j >> 1)][2 * (h % per) + (j & 1)] = v
    }
    reg.set(b.key, { rows, kind: 'act', size: b.cells!.side, real: Boolean(src) })
  }
  for (const b of plan.bars.values()) if (b.cells) putCells(b); else put(b.key, b.slice, b.kind, b.size, b.square, b.cols, b.masked ?? true)
  for (const s of plan.stops) if (s.pre) put(s.pre, s.pre, 'act', reg.get(s.key)!.size, false)
  const val = (k: string, t: number, i: number) => reg.get(k)?.rows[t]?.[i] ?? NaN

  // The word the network writes next: the most likely token at the last row of this pass.
  const nextWord = (Array.isArray(top?.labels) ? (top!.labels as string[])[0] : undefined) ?? (plan.feedback ? extra.labels?.[plan.bars.get(plan.feedback)!.slice]?.[0] : undefined) ?? (pass === 0 ? values?.reply : undefined) ?? ''
  if (values) scene.passes = { pass, count: passCount, written: tokens.slice(promptLen), next: nextWord }
  const t0 = Math.max(0, Math.min(state.t, T - 1))
  const selCol = (s: StopPlan): number => {
    const R = reg.get(s.key)!.rows
    let i = state.sel[s.id]
    if (i === undefined) {
      i = 0
      if (s.unit === 'dot' || (s.unit === 'softmax' && s.part === 'weights')) {
        const src = reg.get(`${s.opId}.weights`)?.rows[t0]
        if (src) for (let c = 1; c <= t0; c++) if (src[c] > src[i]) i = c
      }
    }
    return Math.max(0, Math.min(i, R[0].length - 1))
  }

  // ---- the arithmetic behind one number
  const A = (k: string, t: number, i: number): Part => ({ type: 'act', k, t, i, val: val(k, t, i) })
  const Wt = (label: string, v: number): Part => ({ type: 'w', label, val: v })
  const explain = (s: StopPlan, key: string, t: number, i: number): Explain => {
    const y = val(key, t, i)
    const inKey = s.ins[0]
    const real = (k: string | undefined) => Boolean(k && reg.get(k)?.real)
    switch (key === s.pre ? 'linear' : s.unit) {
      case 'lookup': {
        const terms: Term[] = []
        plan.embed?.tables.forEach((tb, n) => {
          const rows = sliceRows(tb.slice)
          const v = rows?.[t]?.[i]
          if (typeof v === 'number') terms.push({ label: n === 0 ? `the word “${word(t)}”` : `position ${t + 1}`, parts: [Wt('', v)], product: v })
        })
        if (terms.length === 1 && plan.embed!.tables.length === 1) terms[0].product = y
        return { kind: 'sum', value: y, formula: terms.length > 1 ? 'word row + position row' : 'word row', terms }
      }
      case 'norm': {
        if (!real(inKey)) return { kind: 'norm', value: y, terms: [], formula: '( x − mean ) ÷ spread × g + b', rowKey: inKey }
        const a = A(inKey, t, i)
        const st = extra.row_stats?.[plan.bars.get(inKey)?.slice ?? inKey] ?? extra.row_stats?.[inKey]
        const g = firstVec(s.w), b = firstVec(s.b)
        return { kind: 'norm', value: y, terms: [{ label: '', parts: [a], product: a.val }], mean: st?.mean[t], sd: st?.sd[t], g: g?.[i], shift: b?.[i], rowKey: inKey, formula: '( x − mean ) ÷ spread × g + b' }
      }
      case 'linear': case 'relu': {
        const nIn = reg.get(inKey)?.size ?? 0, nOut = reg.get(s.key)!.size
        const W = firstRows(s.w), bv = s.noBias ? null : firstVec(s.b)
        const formula = `y${i + 1} = a${i + 1},1·x1 + … + a${i + 1},${fmtN(nIn)}·x${fmtN(nIn)}${s.noBias ? '' : ` + b${i + 1}`}`
        const base: Explain = { kind: 'linear', value: y, terms: [], nIn, nOut, formula, bias: s.noBias ? null : { label: `b${i + 1}`, val: bv?.[i] ?? NaN }, W: W ?? undefined, Wb: bv }
        if (!W || !W[i] || !real(inKey)) return base
        let sum = 0
        const n = Math.min(WIN, W[i].length, reg.get(inKey)!.rows[0].length)
        for (let c = 0; c < n; c++) {
          const a = A(inKey, t, c) as Extract<Part, { type: 'act' }>
          const pr = a.val * W[i][c]
          base.terms.push({ label: `x${c + 1}`, parts: [Wt(`a${i + 1},${c + 1}`, W[i][c]), a], product: pr }); sum += pr
        }
        base.restN = nIn - n
        base.restSum = y - sum - (base.bias && Number.isFinite(base.bias.val) ? base.bias.val : 0)
        return base
      }
      case 'dot': {
        if (i > t && reg.get(key)!.rows[t][i] === -Infinity) return { kind: 'leaf', value: y, formula: 'masked', terms: [] }
        const terms: Term[] = []
        let sum = 0
        if (real(s.ins[0]) && real(s.ins[1])) for (let c = 0; c < WIN; c++) {
          const q = A(s.ins[0], t, c), k = A(s.ins[1], i, c)
          terms.push({ label: '', parts: [q, k], product: q.val * k.val }); sum += q.val * k.val
        }
        return { kind: 'dot', value: y, terms, restN: terms.length ? HS - WIN : undefined, restSum: y * Math.sqrt(HS) - sum, formula: `( query at position ${t + 1} · key at position ${i + 1} ) ÷ √${HS}` }
      }
      case 'softmax': {
        const terms: Term[] = []
        if (s.part === 'weights') {
          if (real(inKey)) for (let j = 0; j <= t; j++) terms.push({ label: '', parts: [A(inKey, t, j)], product: val(key, t, j) })
          return { kind: 'softmax', value: y, terms, formula: 'e^score ÷ sum of e^score over the row' }
        }
        let sum = 0
        if (real(inKey)) for (let j = 0; j < Math.min(WIN, reg.get(key)!.rows[0].length); j++) { const pv = val(key, t, j); terms.push({ label: '', parts: [A(inKey, t, j)], product: pv }); sum += pv }
        return { kind: 'softmax', value: y, terms, restN: terms.length ? reg.get(key)!.size - terms.length : undefined, restSum: 1 - sum, restPct: true, formula: `e^score ÷ sum of e^score over all ${fmtN(reg.get(key)!.size)} tokens` }
      }
      case 'mix': {
        const terms: Term[] = []
        if (real(s.ins[0]) && real(s.ins[1])) for (let j = 0; j <= t; j++) {
          const a = A(s.ins[0], t, j), v = A(s.ins[1], j, i)
          terms.push({ label: '', parts: [a, v], product: a.val * v.val })
        }
        return { kind: 'mix', value: y, terms, formula: 'sum over positions of attention weight × value' }
      }
      case 'sum': {
        const [k1, k2] = s.ins
        if (!real(k1) || !real(k2)) return { kind: 'sum', value: y, terms: [], formula: `the stream + ${s.act}` }
        const a = A(k1, t, i), c = A(k2, t, i), what = s.act ?? 'the branch'
        return { kind: 'sum', value: y, terms: [{ label: 'the stream', parts: [a], product: a.val }, { label: what, parts: [c], product: c.val }], formula: `the stream + ${what} = ${sg(a.val)} ${c.val < 0 ? '−' : '+'} ${Math.abs(c.val).toFixed(2)} = ${sg(y)}` }
      }
      default: {
        // A place added to a row: the row that goes in is saved and so is the result, so what was added is their difference.
        const pk = s.ins.length === 1 && spec.ops.find((o) => o.id === s.opId)?.kind === 'position' ? s.ins[0] : undefined
        if (pk && real(pk)) {
          const a = A(pk, t, i), d = y - a.val
          return { kind: 'sum', value: y, terms: [{ label: 'the row that goes in', parts: [a], product: a.val }], formula: Number.isFinite(d) ? `the row + its place = ${sg(a.val)} ${d < 0 ? '−' : '+'} ${Math.abs(d).toFixed(2)} = ${sg(y)}` : 'the row + its place' }
        }
        return { kind: 'leaf', value: y, terms: [] }
      }
    }
  }

  // ---- one step: the number it shows and what that number is made from
  interface Step {
    s: StopPlan; t: number; i: number; E: Explain; EL: Explain; kind: string
    shown: Term[]; rest: { n: number; sum: number; pct?: boolean } | null
    inKeys: string[]; n: number; sp: number; y0: number; half: number
    extra: [number, number, number, number] | null
    lines: ModelDiagramStopBlock['detail']; out: [V3, V3]
  }
  const steps = new Map<string, Step>()
  for (const s of plan.stops) {
    const t = t0, i = selCol(s)
    const E: Explain = s.unit === 'relu' ? { kind: 'gelu', value: val(s.key, t, i), terms: [] } : explain(s, s.key, t, i)
    const EL = s.unit === 'relu' ? explain(s, s.pre!, t, i) : E
    let terms = EL.terms.slice(), shown = terms, rest: Step['rest'] = null
    if (EL.restN) rest = { n: EL.restN, sum: EL.restSum ?? 0, pct: EL.restPct }
    else if ((EL.kind === 'mix' || EL.kind === 'softmax') && terms.length > 9) {
      terms = terms.sort((a, b) => Math.abs(b.product) - Math.abs(a.product))
      shown = terms.slice(0, 8)
      rest = { n: terms.length - 8, sum: terms.slice(8).reduce((x, y) => x + y.product, 0), pct: EL.kind === 'softmax' }
    }
    const inKeys = s.ins.filter((k) => plan.bars.has(k))
    const n = shown.length + (rest ? 1 : 0) + (EL.bias && EL.terms.length ? 1 : 0) + (EL.kind === 'norm' && EL.terms.length ? 3 : 0)
    const sp = Math.min(0.36, 3.6 / Math.max(n, 1)), y0 = ((n - 1) / 2) * sp
    steps.set(s.id, { s, t, i, E, EL, kind: s.unit === 'relu' ? 'relu' : E.kind, shown, rest, inKeys, n, sp, y0, half: Math.max(y0 + 0.5, 1.25), extra: null, lines: [], out: [[0, 0, 0], [0, 0, 0]] })
  }
  const focus = state.focus && steps.has(state.focus) ? state.focus : null
  {
    const fo = focus ? spec.ops.find((o) => o.id === steps.get(focus)!.s.opId) : undefined
    // the head picker is offered only where it changes the drawing: a step that reads or writes a bar drawn one head at a time
    const fs = focus ? steps.get(focus)! : null
    const perHead = !!fs && (fs.s.part === 'weights' || fs.s.part === 'mix')
    if (fo?.kind === 'attention' && (fo.heads ?? 1) > 1 && perHead) {
      const saved = Object.keys(values?.attention?.[fo.id] ?? {}).map(Number)
      for (const k of Object.keys(X.attention_last_row?.[fo.id] ?? {})) if (!saved.includes(Number(k))) saved.push(Number(k))
      scene.heads = { count: fo.heads!, head: Math.min(head, fo.heads! - 1), saved: saved.sort((p, q) => p - q) }
    }
  }

  // ---- which tiles of each bar are used by the step that reads it
  const used = new Map<string, Map<string, number>>()
  const mark = (k: string, id: string, v: number) => {
    let m = used.get(k); if (!m) { m = new Map(); used.set(k, m) }
    if (v === 2 || !m.get(id)) m.set(id, v)
  }
  for (const st of steps.values()) {
    if (focus && st.s.id !== focus) continue
    for (const x of st.EL.terms) for (const p of x.parts) if (p.type === 'act') mark(p.k, `${p.t},${p.i}`, st.shown.includes(x) ? 2 : 1)
    if (st.EL.kind === 'norm' && st.EL.rowKey && reg.has(st.EL.rowKey)) {
      const n = reg.get(st.EL.rowKey)!.rows[0].length
      for (let c = 0; c < n; c++) mark(st.EL.rowKey, `${st.t},${c}`, 1)
    }
  }

  // ---- bars
  interface Bar extends ModelDiagramGridBlock { tiles: V3[][] }
  const bars = new Map<string, Bar>()
  const makeBar = (b: BarPlan, selRow: number, selC: number, stopId: string | null) => {
    const R = reg.get(b.key)!, rows = R.rows, nR = rows.length, nC = rows[0].length, kind = R.kind
    const p = nC > 8 && kind === 'act' ? Math.min(0.3, 4.7 / nR) : Math.min(0.5, 4.7 / nR, 4.6 / nC)
    const g: Bar = { key: b.key, cx: b.x, cy: b.y, p, nR, nC, w: nC * p, h: nR * p, heights: [], colors: [], pick: stopId ? { stop: stopId } : null, tiles: [] }
    let max = 1e-9, lo = Infinity, hi = -Infinity
    for (const row of rows) for (const v of row) { if (!Number.isFinite(v)) continue; if (Math.abs(v) > max) max = Math.abs(v); if (v < lo) lo = v; if (v > hi) hi = v }
    const nh = Math.min(b.heads ?? 0, 16)
    if (nh > 1) for (let k = nh - 1; k >= 0; k--) scene.slabs.push({ c: [b.x + k * 0.07, b.y + k * 0.07, -0.07 - k * 0.3], w: g.w + 0.2, h: g.h + 0.2, d: 0.14, color: 'slab', opacity: k ? 0.5 : 1, edge: 'bar', edgeOpacity: k ? 0.55 : 1 })
    else [-1.5, -0.78, -0.07].forEach((z, n) => scene.slabs.push({ c: [b.x, b.y, z], w: g.w + 0.2, h: g.h + 0.2, d: 0.14, color: 'slab', opacity: n < 2 ? 0.5 : 1, edge: 'bar', edgeOpacity: n < 2 ? 0.55 : 1 }))
    const hk = Math.min(1.1, p * 2.4), act = used.get(b.key)
    const picRows = b.cells ? [] : rows.map((_, r) => isPic(b.slice, r))
    for (let r = 0; r < nR; r++) {
      g.tiles.push([])
      for (let c = 0; c < nC; c++) {
        const v = rows[r][c], masked = v === -Infinity, flat = Number.isNaN(v)
        const hh = masked ? 0.03 : flat ? 0.08 * hk : kind === 'score' ? (0.08 + (v - lo) / (hi - lo || 1)) * hk : kind === 'prob' ? (0.04 + v / (hi || 1)) * hk * 1.7 : (0.08 + Math.abs(v) / max) * hk
        const a = act?.get(`${r},${c}`), isSel = r === selRow && c === selC, slot = `c${(c % 8) + 1}`
        let col: (string | number)[] = isSel ? ['neuron'] : a === 2 ? [slot] : a === 1 ? ['tile', slot, 0.45] : r === selRow ? ['tile', 'neuron', 0.22] : ['tile']
        if (v < 0 && kind === 'act' && (a || isSel)) col = [...col, 'slab', 0.38]
        if (showNew && !isSel && a !== 2 && r === nR - 1) col = [...col, 'ex', 0.5]
        if (masked) col = ['slab', 'tile', 0.25]
        else if (col.length === 1 && col[0] === 'tile' && picRows[r]) col = ['tile', 'bar', 0.4]
        else if (b.cells && !flat) col = ['tile', v < 0 ? 'ex' : 'neuron', 0.12 + 0.8 * Math.min(1, Math.abs(v) / max)]
        g.heights.push(hh); g.colors.push(col.length === 1 ? (col[0] as string) : col)
        g.tiles[r].push([b.x + (c - (nC - 1) / 2) * p, b.y - (r - (nR - 1) / 2) * p, hh])
      }
    }
    const tagk = `bar:${b.key}`
    const drawn = b.cols && R.size > nC ? `, the ${nC} most likely drawn` : R.size > nC ? `, first ${nC} columns drawn` : ''
    // A model with more than one tower names its axes by letter from the tensor's own shape; one tower keeps (B, T, C).
    const tn = spec.tensors.find((x) => x.id === b.key) ?? spec.tensors.find((x) => x.id === b.slice)
    const LET: Record<string, string> = { batch: 'B', tokens: 'T', patches: 'P', v_merged: 'P/4' }
    const ax = (a: string | number) => (typeof a === 'number' ? a : spec.axes[a] ?? 0)
    const shape = b.cells
      ? `(B, heads, ${fmtN(b.cells.side)}, ${fmtN(b.cells.side)}) = ${batch} x ${b.cells.heads} x ${fmtN(b.cells.side)} x ${fmtN(b.cells.side)}: one square per head, the first 2 x 2 of each drawn`
      : plan.legend.length > 3 && tn && !b.square
        ? `(${tn.axes.map((a, k) => (k < tn.axes.length - 1 && typeof a === 'string' && LET[a]) || fmtN(ax(a))).join(', ')}) = ${tn.axes.map((a) => fmtN(ax(a))).join(' x ')}${nR < ax(tn.axes[tn.axes.length - 2] ?? 0) ? `, ${nR} rows` : ''}${drawn ? `${nR < ax(tn.axes[tn.axes.length - 2] ?? 0) ? ' and' : ','}${drawn.slice(1)}` : ''}`
        : `(B, T, ${fmtN(R.size)}) = ${batch} x ${nR} x ${fmtN(R.size)}${drawn}`
    // A ruler under the bar, to one scale across the whole drawing.
    // A square bar shows every one of its columns, so its ruler is simply its own width, and says what the columns are.
    const broken = R.size > 3072, L = b.square ? g.w : broken ? 11 : Math.max(0.35, (R.size / 768) * 3), ry = b.y - g.h / 2 - 0.6
    const ra: V3 = [b.x - L / 2, ry, 0.1], rb: V3 = [b.x + L / 2, ry, 0.1]
    if (!b.cells) {
      if (broken) { rod(ra, [b.x - 0.5, ry, 0.1], 0.06, 'bar', 1); rod([b.x + 0.5, ry, 0.1], rb, 0.06, 'bar', 1) } else rod(ra, rb, 0.06, 'bar', 1)
      for (const e of [ra, rb]) rod([e[0], ry - 0.22, 0.1], [e[0], ry + 0.22, 0.1], 0.05, 'bar', 1)
      lab('*', 'ruler', b.x, ry - 0.55, 0.1, [['', b.square ? `${fmtN(R.size)} columns, one per position` : fmtN(R.size)]])
    } else {
      // the bank of heads: a thin frame round each head's patch, and what the whole thing is
      for (let h = 0; h < b.cells.heads; h++) wire([b.x + ((h % 8) * 2 + 1 - nC / 2) * p, b.y - (Math.floor(h / 8) * 2 + 1 - nR / 2) * p, 0.05], 2 * p, 2 * p, 0.02, 'neuron', 0.5)
      lab('*', 'ruler', b.x, ry - 0.55, 0.1, [['', `${b.cells.heads} x ${fmtN(b.cells.side)} x ${fmtN(b.cells.side)}`]])
      lab(tagk, 'pu', b.x, ry - 1.7, 0.1, [['', 'each small square is one head’s memory'], ['', 'purple is above zero, blue below'], ['', 'it is the same size at every token']])
    }
    const nm = b.heads && b.heads > 1 ? `${b.name}, head ${head + 1} of ${b.heads}${head > 0 && !R.real ? ' (saved for head 1 only)' : ''}` : b.square ? `${b.name}, head 1` : b.name
    lab(tagk, '', b.x, b.y + g.h / 2 + 0.5, 0, [['tag act', 'ACTIVATIONS'], ['nm', R.real || b.heads ? nm : `${nm} (not saved: drawn flat)`], ['', shape]], { anchor: 'bottom' })
    if (b.square && b.masked && nR > 2) {
      // the mask's edge: a token reads itself and what came before, never what comes after
      for (let r = 0; r < nR - 1; r++) {
        const xr = b.x + (r + 1 - nC / 2) * p, yt = b.y - (r - nR / 2) * p
        thin([xr, yt, 0.06], [xr, yt - p, 0.06], 'neuron', 0.9); thin([xr, yt - p, 0.06], [xr + p, yt - p, 0.06], 'neuron', 0.9)
      }
      lab(tagk, 'pu', b.x + g.w * 0.22, b.y + g.h * 0.24, 0.3, [['', 'masked:'], ['', 'no looking ahead']], { mode: undefined })
    }
    if (picRows.some(Boolean) && p >= 0.1) lab(tagk, 'or', b.x, ry - (b.square ? 1.9 : 1.5), 0.2, [['', 'orange rows: the picture’s tokens']])
    if (nh > 1) lab(tagk, 'or', b.x + g.w / 2 + 2.4, b.y + g.h / 2 + 0.2, -nh * 0.15, [['', `${b.heads} heads, one behind another`]])
    if (p >= 0.22 && !b.cells) for (let r = 0; r < nR; r++) lab(tagk, `word${r === selRow ? ' on' : ''}${r >= promptLen ? ' ans' : ''}${picRows[r] ? ' pic' : ''}`, b.x - g.w / 2 - 0.75, b.y - (r - (nR - 1) / 2) * p, 0.2, [['', rowName(b.slice, r)]])
    const names = (b.cols && Array.isArray(top?.labels) ? (top!.labels as string[]) : undefined) ?? extra.labels?.[b.slice]
    if (showNew) {
      lab(tagk, 'ex', b.x + g.w / 2 + 1.35, b.y - ((nR - 1) / 2) * p, 0.2, [['', 'new row']])
      const part = b.key.split('.').pop()
      const reads = plan.stops.filter((x) => x.part === 'scores' || x.part === 'mix').map((x) => plan.stops.indexOf(x) + 1)
      lab(tagk, 'ex', b.x, ry - 1.2, 0.2, [['', b.square ? 'one new row; the new column is masked for earlier rows'
        : (part === 'k' || part === 'v') && reads.length ? `only the blue row is new; the new row reads the rows above at steps ${reads.join(' and ')}`
          : 'only the blue row is new; the rows above are the same as last pass']])
    }
    if (names && selC >= 0 && names[selC]) lab(tagk, 'pu', b.x + (selC - (nC - 1) / 2) * p, b.y + g.h / 2 + 0.25, 0.3, [['', `“${names[selC]}”`]])
    bars.set(b.key, g); scene.grids.push(g)
    return g
  }
  const tilePt = (k: string, r: number, c: number): V3 => { const g = bars.get(k)!, t = g.tiles[Math.min(r, g.nR - 1)][Math.min(c, g.nC - 1)]; return [t[0], t[1], t[2] + 0.03] }
  for (const s of plan.stops) {
    const st = steps.get(s.id)!, mine = !focus || s.id === focus
    const pb = plan.bars.get(s.key)!
    makeBar(pb, mine && !pb.cells ? st.t : -1, mine && !pb.cells ? st.i : -1, s.id)
  }
  for (const e of plan.extraBars) makeBar(plan.bars.get(e.key)!, steps.get(e.rowOf)?.t ?? -1, -1, null)

  // ---- a table of weights
  const makeTable = (rowsArr: number[][], cx: number, cy: number, p: number, selRow: number, selC: number, title: string, size: string, sub: string, rowLabel: string, tag: string,
    more: { pick?: { stop: string; rows: number[] }; rowNames?: string[]; colNames?: string[]; rowsTitle?: string[]; colsTitle?: string[]; key: string }) => {
    const nR = rowsArr.length, nC = rowsArr[0].length, w = nC * p, h = nR * p, hk = Math.min(1.1, p * 2.4)
    let max = 1e-9
    for (const row of rowsArr) for (const v of row) if (Math.abs(v) > max) max = Math.abs(v)
    scene.slabs.push({ c: [cx, cy, -0.07], w: w + 0.2, h: h + 0.2, d: 0.14, color: 'slab', opacity: 1, edge: 'muted', edgeOpacity: 1 })
    const g: ModelDiagramGridBlock = { key: more.key, cx, cy, p, nR, nC, w, h, heights: [], colors: [], pick: more.pick ?? null }
    let pt: V3 = [cx, cy, 0]
    for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
      const v = rowsArr[r][c], hh = (0.08 + (Number.isFinite(v) ? Math.abs(v) / max : 0)) * hk, slot = `c${(c % 8) + 1}`
      g.heights.push(hh); g.colors.push(r === selRow ? (c === selC ? slot : ['tile', slot, 0.45]) : 'tile')
      if (r === selRow && c === selC) pt = [cx + (c - (nC - 1) / 2) * p, cy - (r - (nR - 1) / 2) * p, hh + 0.03]
    }
    scene.grids.push(g)
    more.rowNames?.forEach((nm, r) => lab(tag, `word${r === selRow ? ' on' : ''}`, cx - w / 2 - 0.75, cy - (r - (nR - 1) / 2) * p, 0.2, [['', nm]]))
    more.colNames?.forEach((nm, c) => lab(tag, 'ruler', cx + (c - (nC - 1) / 2) * p, cy - h / 2 - 0.3, 0.2, [['', nm]]))
    if (more.rowsTitle) lab(tag, 'pu', cx - w / 2 - 3.4, cy, 0.2, more.rowsTitle.map((x) => ['', x]))
    if (more.colsTitle) lab(tag, 'pu', cx, cy - h / 2 - 1.05, 0.2, more.colsTitle.map((x) => ['', x]))
    const ry = cy - (selRow - (nR - 1) / 2) * p, fd = Math.min(1.2, p * 3)
    if (selRow >= 0) wire([cx, ry, fd / 2], w + 0.08, p, fd, 'fg', 1)
    lab(tag, '', cx, cy + h / 2 + 0.55, 0, [['tag wt', 'WEIGHTS'], ['nm', title], ['', size], ...(sub ? sub.split('. ') : []).map((l) => ['', l])].filter((x) => x[1]) as [string, string][], { anchor: 'bottom', rank: 65 })
    if (selRow >= 0) lab(tag, 'word on', cx + w / 2 + 1.6, ry, 0.2, [['', rowLabel]], { mode: 'nudge' })
    return { pt, rowPt: [cx - w / 2 - 0.12, ry, 0.1] as V3 }
  }

  // ---- the embedding's left side: the words as row numbers, and the tables they pick rows from
  const tabPts: V3[] = []
  if (plan.embed) {
    const es = steps.get(plan.embed.stop)!, ex0 = plan.embed.x, y = es.s.uy, tp = Math.min(0.3, 4.6 / T), two = plan.embed.tables.length > 1
    const rowPts: V3[] = []
    plan.embed.tables.forEach((tb, n) => {
      const src = sliceRows(tb.slice)
      const rows: number[][] = []
      for (let r = 0; r < T; r++) { const row: number[] = []; for (let c = 0; c < WIN; c++) row.push(typeof src?.[r]?.[c] === 'number' ? src[r][c] : NaN); rows.push(row) }
      const id = extra.token_ids?.[es.t]
      const out = makeTable(rows, ex0 - 12, y + (two ? (n === 0 ? 3.9 : -3.9) : 0), tp, es.t, es.i, tb.title, tb.size,
        tb.rowLabel === 'token' ? 'drawn: the rows these tokens pick, first 8 columns' : `drawn: the first ${T} rows, first 8 columns`,
        tb.rowLabel === 'token' ? (id !== undefined ? `row ${fmtN(id)}` : `the row for “${word(es.t)}”`) : `row ${es.t + 1}`, `step:${es.s.id}`, { key: `table:${tb.slice}` })
      tabPts.push(out.pt); rowPts.push(out.rowPt)
    })
    es.extra = [ex0 - 23.5, ex0 - 9.2, y - 7.4, y + 8.9]
    lab(`step:${es.s.id}`, '', ex0 - 17.2, y + (T * 0.42) / 2 + 1.0, 0, [['nm', 'the words, as row numbers'], ['', `(B, T) = ${batch} x ${T}`]])
    for (let r = 0; r < T; r++) {
      const ly = y + ((T - 1) / 2) * 0.42 - r * 0.42, id = extra.token_ids?.[r]
      lab(`step:${es.s.id}`, `word${r === es.t ? ' on' : ''}${r >= promptLen ? ' ans' : ''}`, ex0 - 17.2, ly, 0, [['', id !== undefined ? `${word(r)} = ${fmtN(id)}` : word(r)]])
      if (r === es.t) for (const rp of rowPts) thin([ex0 - 16.0, ly, 0.1], rp, 'fg', 0.7)
    }
  }

  // ---- the units: the working part of each step, opened up in a purple box
  const eqLines = (st: Step): string[] => {
    const EL = st.EL
    const ts = st.shown.map((x) => ({ w: x.parts.find((p) => p.type === 'w')!, a: x.parts.find((p) => p.type === 'act')!, p: x.product }))
    if (ts.length < 2) return []
    const s8 = ts.reduce((a, b) => a + b.p, 0)
    const term = (t: (typeof ts)[number]) => `(${sg(t.w.val)} × ${sg(t.a.val)})`
    const L: string[] = []
    const bias = EL.bias && Number.isFinite(EL.bias.val) ? EL.bias : null
    L.push(`the sum for “${rowName(plan.bars.get(st.s.key)!.slice, st.t)}”:  z = ${(ts[0].w as { label: string }).label}·x1 + ${(ts[1].w as { label: string }).label}·x2 + … (${fmtN(EL.nIn ?? 0)} terms)${bias ? ` + ${bias.label}` : ''}`)
    L.push(`a dot product: weights row · input row${bias ? ', plus the intercept' : ''}`); L.push('multiply matching columns, then add up')
    L.push(`= ${ts.slice(0, 4).map(term).join(' + ')}`)
    if (ts.length > 4) L.push(`+ ${ts.slice(4).map(term).join(' + ')}`)
    L.push(`= ${ts.map((t) => sg(t.p)).join(' ')}   which add to ${sg(s8)}`)
    if (st.rest) L.push(`+ the other ${fmtN(st.rest.n)} terms, worked the same way, which add to ${sg(st.rest.sum)}`)
    if (bias) L.push(`+ the intercept ${bias.label} = ${sg(bias.val)}`)
    L.push(`z = ${sg(s8)}${st.rest ? ` ${sg(st.rest.sum)}` : ''}${bias ? ` ${sg(bias.val)}` : ''} = ${sg(EL.value)}`)
    return L
  }
  const grow = (st: Step, x0: number, x1: number, y0: number, y1: number) => {
    const e = st.extra ?? [x0, x1, y0, y1]
    st.extra = [Math.min(e[0], x0), Math.max(e[1], x1), Math.min(e[2], y0), Math.max(e[3], y1)]
  }
  const plotBend = (st: Step, name: string) => {
    const { ux, uy } = st.s, x0 = ux - 1.85, w = 3.4, yb = uy + st.half + 2.0, h = 2.1, zr = 3, lo = -0.5, hi = 3, tg = `step:${st.s.id}`
    const smooth = name !== 'RELU'
    const f = smooth ? gelu : (z: number) => (z > 0 ? z : 0)
    const P = (z: number, y: number): V3 => [x0 + ((z + zr) / (2 * zr)) * w, yb + ((Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo)) * h, 0.4]
    thin(P(-zr, 0), P(zr, 0), 'muted', 0.9); thin(P(0, lo), P(0, hi), 'muted', 0.9)
    for (let z = -zr; z < zr - 1e-9; z += 0.1) rod(P(z, f(z)), P(z + 0.1, f(z + 0.1)), 0.028, 'neuron', 1)
    const zv = st.EL.value, ov = st.E.value
    if (Number.isFinite(zv)) {
      const zin = Math.max(-zr, Math.min(zr, zv)), pp = P(zin, f(zin))
      thin(P(zin, 0), pp, 'ex', 1); thin(P(0, f(zin)), pp, 'ex', 1)
      scene.dots.push({ p: pp, r: 0.1, color: 'ex' })
      if (smooth) lab(tg, 'pu', x0 + w + 3.5, yb + h * 0.62, 0.4, [['', `${name}(z) = z × share`], ['', 'share = 0.5 × ( 1 + tanh( 0.798 × ( z + 0.0447 z³ ) ) )'], ['', `here: share = ${bendShare(zv).toFixed(3)}`], ['', `${sg(zv)} × ${bendShare(zv).toFixed(3)} = ${sg(ov)}`]])
      else lab(tg, 'pu', x0 + w + 2.6, yb + h * 0.62, 0.4, [['', 'ReLU(z) = z if z is positive, otherwise 0'], ['', `here: z = ${sg(zv)}, so the output is ${sg(ov)}`]])
      lab(tg, 'ex', pp[0] - 1.35, pp[1] + 0.42, 0.4, [['', `in ${sg(zv)}, out ${sg(ov)}`]])
    }
    lab(tg, 'pu', x0 + w / 2, yb + h + 0.42, 0.4, [['', `${name}: the sum goes in along the bottom, the output is read off the height`]])
    for (const v of [-zr, 0, zr]) { const q = P(v, lo); lab(tg, 'ruler', q[0], q[1] - 0.2, 0.4, [['', v === 0 ? '0' : sg(v).replace('.00', '')]]) }
    grow(st, x0 - 0.5, x0 + w + 6.6, uy - st.half - 1.7, yb + h + 0.9)
  }

  // Where the camera looks for one stop: its unit, the bars it reads and the bar it makes.
  const frameOf = (st: Step): ModelDiagramFrameBlock => {
    const { ux, uy } = st.s
    const xs = [ux - 2.6, ux + 2.6], ys = [uy - st.half - 1.2, uy + st.half + 1.6]
    for (const k of st.inKeys.concat([st.s.key])) {
      const b = bars.get(k)!
      if (st.s.unit === 'sum' && Math.abs(b.cx - ux) + Math.abs(b.cy - uy) > 20) continue
      xs.push(b.cx - b.w / 2 - 1.6, b.cx + b.w / 2 + 1.6); ys.push(b.cy - b.h / 2 - 1.0, b.cy + b.h / 2 + 1.9)
    }
    if (st.s.unit === 'sum') { xs.push(ux - 7, ux + 7); ys.push(uy - 4.5, uy + 4.5) }
    if (st.extra) { xs.push(st.extra[0], st.extra[1]); ys.push(st.extra[2], st.extra[3]) }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 }
  }
  // The numbers inside the focused unit each sit beside a line, so they cannot be moved apart on screen afterwards.
  // They are spaced here instead, by the distance the camera will take, so that no two touch.
  // The written-out sum is docked in the stage's top left corner; the step keeps a band clear above itself so the camera leaves that corner empty.
  const dockRoom = (st: Step) => { const f = frameOf(st), left = f.cx - f.hw, top = f.cy + f.hh; grow(st, left, left + 11, top, top + 4.0) }
  let focusBox: [number, number, number, number] | null = null
  if (focus) {
    const st = steps.get(focus)!, { ux, uy } = st.s, base = st.extra, STAGE = state.stage?.h || 785, PILL = 19.5, ASPECT = state.stage ? state.stage.w / state.stage.h : 16 / 8.6
    const around = () => {
    // what the unit will add around itself once drawn: its written-out sum, its table of weights, its bend
    if (st.EL.kind === 'linear') {
      if (st.EL.W?.length) grow(st, ux - 0.2 - 5.6, ux - 0.2 + 4.6, uy - st.half - 4.4 - 2.9, uy - st.half - 4.4)
    }
    if (st.s.unit === 'relu') grow(st, ux - 1.85 - 0.5, ux - 1.85 + 3.4 + 6.6, uy - st.half - 1.7, uy + st.half + 2.0 + 2.1 + 0.9)
    if (st.EL.kind === 'linear' && st.shown.length > 1) dockRoom(st)
    }
    for (let pass = 0; pass < 3 && st.n > 1; pass++) {
      st.extra = base
      around()
      const f = frameOf(st), eff = Math.max(f.hh, f.hw / ASPECT) * 1.06
      st.sp = Math.max(st.sp, (PILL * 2 * eff) / STAGE); st.y0 = ((st.n - 1) / 2) * st.sp; st.half = Math.max(st.y0 + 0.5, 1.25)
    }
    // The room the step in focus takes, with its numbers, its table and its sums: a neighbour's working part inside it is not drawn.
    st.extra = base; around()
    const e = st.extra as [number, number, number, number] | null
    focusBox = [Math.min(ux - 3.4, e ? e[0] : Infinity), Math.max(ux + 2.0, e ? e[1] : -Infinity), Math.min(uy - st.half - 0.5, e ? e[2] : Infinity), Math.max(uy + st.half + 1.7, e ? e[3] : -Infinity)]
    st.extra = base
  }

  plan.stops.forEach((s, n) => {
    const st = steps.get(s.id)!, EL = st.EL, { ux, uy } = s, px = ux - 1.25, cc: V3 = [ux + 0.75, uy, 0.4], tg = `step:${s.id}`
    if (focusBox && s.id !== focus && !s.wrap && ux + 1.7 > focusBox[0] && ux - 2.4 < focusBox[1] && uy + 1.4 > focusBox[2] && uy - 1.4 < focusBox[3]) {
      // inside the room the step in focus has taken: this step keeps its bar and gives up its working part
      st.out = [cc, tilePt(s.key, st.t, st.i)]
      return
    }
    let k = 0
    const pillAt = (text: string, isW: boolean, ci: number) => {
      const y = uy + st.y0 - k * st.sp; k++
      lab(tg, `pill${isW ? ' w' : ''}`, px, y, 0.4, [['', text]], ci >= 0 ? { slot: ci + 1 } : {})
      const a: V3 = [px + 0.72, y, 0.4]
      thin(a, toward(cc, a, 0.66), ci >= 0 ? `c${ci + 1}` : 'neuron', 0.9)
      return y
    }
    st.shown.forEach((x, xi) => {
      const acts = x.parts.filter((p): p is Extract<Part, { type: 'act' }> => p.type === 'act')
      const ws = x.parts.filter((p): p is Extract<Part, { type: 'w' }> => p.type === 'w')
      const ci = acts.length ? acts[acts.length - 1].i % 8 : -1
      let text: string
      if (EL.kind === 'linear') text = `${ws[0].label} = ${sg(ws[0].val)}`
      else if (EL.kind === 'softmax') { const e = Math.exp(acts[0].val); text = `e^${sg(acts[0].val).replace('+', '')} = ${e < 0.005 ? e.toExponential(1) : e.toFixed(2)} → ${(x.product * 100).toFixed(0)}%` }
      else if (ws.length && !acts.length) text = `${x.label}: ${sg(ws[0].val)}`
      else text = ((EL.kind === 'sum' || EL.kind === 'sub') && x.label ? `${x.label}: ` : '') + x.parts.map((p) => sg(p.val)).join(' × ')
      const y = pillAt(text, ws.length > 0, ci), end: V3 = [px - 0.8, y, 0.4]
      if (s.unit === 'lookup' && tabPts[xi]) { const tc = `c${(st.i % 8) + 1}`; thin(tabPts[xi], end, tc, 0.75); st.lines.push({ a: tabPts[xi], b: end, color: tc, r: 0.03, opacity: 1 }) }
      for (const p of acts) {
        const a = tilePt(p.k, p.t, p.i), col = `c${(p.i % 8) + 1}`, neg = ws.length > 0 && ws[0].val < 0
        thin(a, end, col, neg ? 0.35 : 0.75)
        st.lines.push({ a, b: end, color: col, r: EL.kind === 'linear' ? 0.016 + 0.05 * Math.min(1, Math.abs(ws[0].val)) : 0.03, opacity: neg ? 0.45 : 1 })
      }
    })
    if (st.rest) pillAt(`+ ${fmtN(st.rest.n)} more = ${st.rest.pct ? `${(st.rest.sum * 100).toFixed(0)}%` : sg(st.rest.sum)}`, false, -1)
    if (EL.kind === 'norm' && EL.terms.length) {
      pillAt(EL.mean !== undefined ? `mean ${sg(EL.mean)}, spread ${(EL.sd ?? NaN).toFixed(2)}` : 'the row’s own mean and spread', false, -1)
      pillAt(EL.g !== undefined ? `scale ${sg(EL.g)}, shift ${sg(EL.shift ?? NaN)}` : 'a scale and a shift', true, -1)
    } else if (EL.bias && EL.terms.length) pillAt(`${EL.bias.label} = ${sg(EL.bias.val)}`, true, -1)

    if (s.unit === 'plain' && st.inKeys.length > 1) {
      // A part with no single sum to show: a line from each thing it reads, and what it does with them in words.
      st.inKeys.forEach((k, n) => {
        const b = bars.get(k)
        if (!b) return
        const a: V3 = [b.cx + b.w / 2 + 0.1, b.cy, 0.3], end: V3 = [px - 0.8, uy + ((st.inKeys.length - 1) / 2 - n) * 0.5, 0.4]
        thin(a, end, 'neuron', 0.8); st.lines.push({ a, b: end, color: 'neuron', r: 0.03, opacity: 1 })
      })
      const how: Record<string, string[]> = {
        state: ['at each token, in order:', 'memory = memory × fade + strength × (what to write, stored at the write key)'],
        read: ['reading = the memory as it stood at this token × the read key', 'then ÷ its root mean square, × the gate'],
        times: [`${s.act ?? 'bend'}( gate layer ) × up layer`],
      }
      if (how[s.part]) lab(tg, 'pu', cc[0] - 0.5, uy - st.half - 0.75 - 0.3 * how[s.part].length, 0.4, how[s.part].map((x) => ['', x] as [string, string]))
    }
    scene.sprites.push({ p: cc, text: st.E.kind === 'leaf' && s.unit === 'dot' ? MODEL_DIAGRAM_CIRCLE_BLOCK.leaf : s.circle, stop: s.id })
    const bx0 = px - 0.95, bx1 = cc[0] + 0.9
    thin([bx0, uy + st.half, 0.4], [bx1, uy + st.half, 0.4], 'neuron', 0.7); thin([bx1, uy + st.half, 0.4], [bx1, uy - st.half, 0.4], 'neuron', 0.7)
    thin([bx1, uy - st.half, 0.4], [bx0, uy - st.half, 0.4], 'neuron', 0.7); thin([bx0, uy - st.half, 0.4], [bx0, uy + st.half, 0.4], 'neuron', 0.7)
    const opKind = spec.ops.find((o) => o.id === s.opId)?.kind ?? ''
    const unitTag = s.unit === 'plain' ? ({ state: 'FADE, THEN WRITE', read: 'READ THE MEMORY', times: 'BEND, THEN MULTIPLY' } as Record<string, string>)[s.part] ?? MODEL_DIAGRAM_UNIT_TAG_BLOCK[opKind] ?? 'UNIT' : EL.kind === 'linear' ? `NEURON y${st.i + 1} OF ${fmtN(EL.nOut ?? 0)}` : s.unit === 'lookup' ? MODEL_DIAGRAM_UNIT_TAG_BLOCK.lookup : MODEL_DIAGRAM_UNIT_TAG_BLOCK[st.E.kind] ?? MODEL_DIAGRAM_UNIT_TAG_BLOCK[spec.ops.find((o) => o.id === s.opId)?.kind ?? ''] ?? 'UNIT'
    lab(tg, '', cc[0] - 0.05, uy + st.half - 0.27, 0.4, [['tag nr', unitTag]])
    // A step with nothing to show its working by: what it reads was not saved for this model. It is still joined to
    // the bars it reads, by plain lines, and says why there are no numbers.
    if (focus === s.id && !st.shown.length) {
      const missing = st.inKeys.filter((k) => !reg.get(k)?.real)
      for (const k of st.inKeys) if (bars.has(k)) thin(tilePt(k, st.t, 0), [px, uy, 0.4], 'neuron', 0.55)
      if (missing.length) lab(tg, 'pu', cc[0] - 0.6, uy - st.half - 0.5, 0.4, [['', `the numbers this step reads were not saved for this model,`], ['', 'so only its shape is drawn']])
    }

    if (EL.kind === 'linear' && focus === s.id) {
      const eq = eqLines(st)
      if (eq.length) {
        const relu = s.unit === 'relu', ex = relu ? ux + 19.5 : ux + 7.4, ey = uy + st.half + 3.0
        // the sum written out has one home, the stage's top left corner, at every step: it is read as text, not found in the drawing
        lab(tg, 'pu eqn', ex, ey, 0.4, eq.map((l) => ['', l]), { mode: 'dock', rank: 900 })
      }
      if (EL.W && EL.W.length) {
        const Wm = EL.W, rws: number[] = []
        for (let r = 0; r < Math.min(8, Wm.length); r++) rws.push(r)
        if (st.i > 7 && Wm[st.i]) rws[rws.length - 1] = st.i
        const tab = rws.map((r) => { const row = Wm[r].slice(0, 8); while (row.length < 8) row.push(NaN); return row })
        const tcx = ux - 0.2, tcy = uy - st.half - 4.4, nIn = EL.nIn ?? 0, nOut = EL.nOut ?? 0
        const T2 = makeTable(tab, tcx, tcy, 0.3, rws.indexOf(st.i), -1, 'a: this layer’s table of weights', 'a row is one neuron; a column is one input',
          `a${st.i + 1},1 is row ${st.i + 1}, column 1. Click a row to put that neuron in the box above`, 'this neuron', tg, {
            key: `table:${s.id}`, pick: { stop: s.id, rows: rws }, rowNames: rws.map((r) => String(r + 1)), colNames: ['1', '2', '3', '4', '5', '6', '7', '8'],
            rowsTitle: [`${fmtN(nOut)} rows`, `= ${fmtN(nOut)} neurons`, `${rws.length} drawn`],
            colsTitle: [`${fmtN(nIn)} columns = ${fmtN(nIn)} inputs, so ${fmtN(nIn)} slopes in each row`, 'the first 8 drawn'],
          })
        thin(T2.rowPt, [bx0, uy - st.half, 0.4], 'neuron', 0.9)
        grow(st, tcx - 5.6, tcx + 4.6, tcy - 2.9, tcy)
      }
    }
    if (s.unit === 'relu') {
      if (Number.isFinite(EL.value)) lab(tg, 'pu', cc[0] + 0.3, uy - 1.35, 0.4, [['', `the sum: z = ${sg(EL.value)}`], ['', `share = ${bendShare(EL.value).toFixed(2)}`], ['', `z × share = ${sg(st.E.value)}`]])
      plotBend(st, s.act ?? 'GELU')
    }
    if (st.E.kind === 'leaf' && s.unit === 'dot') lab(tg, 'pu', px, uy, 0.4, [['', 'this pair is masked']])
    if (EL.kind === 'sum' && s.unit === 'sum') {
      lab(tg, 'pu', px - 3.2, uy - 2.2, 0.4, [['', 'the dashed line from the left is the stream,'], ['', 'carried past this branch unchanged']])
      lab(tg, 'pu', cc[0] + 3.6, uy + 0.9, 0.4, [['', 'the sum goes on as the new stream']])
    }
    if (EL.kind === 'softmax') lab(tg, 'pu', cc[0] - 0.6, uy - st.half - 0.45, 0.4, [['', 'each e^score ÷ the sum of them all'], ['', 'so the row adds up to 100%']])
    lab('*', 'ttl', ux, uy + st.half + 0.75, 0.4, [['', `${n + 1}. ${s.chip}`]], { stop: s.id, short: String(n + 1) })

    // out: the unit feeds the chosen block of its bar
    const dst = tilePt(s.key, st.t, st.i)
    if (s.wrap) {
      const yy = s.wrap.fromY - 13.5
      const pts: V3[] = [[cc[0] + 0.68, cc[1], 0.4], [ux + 10, uy, 0.4], [ux + 10, yy, 0.4], [s.wrap.left, yy, 0.4], [s.wrap.left, dst[1], 0.4], dst]
      for (let q = 0; q < pts.length - 1; q++) rod(pts[q], pts[q + 1], 0.07, 'neuron', 1)
      st.out = [pts[0], pts[1]]
      lab('*', 'pu', (ux + 10 + s.wrap.left) / 2 - 0.5, yy + 0.9, 0.4, [['', `the stream carries on to ${s.wrap.next}`]])
    } else {
      const from = toward(cc, dst, 0.68)
      rod(from, dst, 0.035, 'neuron', 1); st.out = [from, dst]
    }
  })

  // ---- the repeats, the region names and the way back to the start
  for (const g of plan.ghosts) {
    for (const x of g.xs) wire([x, g.y, 0.2], 3, 5, 1.5, 'muted', 0.55)
    lab('*', 'grpl', g.xs[1], g.y + 5.0, 0.2, [['', `${g.more} more ${g.more === 1 ? g.what.replace(/s$/, '') : g.what}`], ['sm', 'same steps, different weights']])
  }
  for (const c of plan.carries) {
    const to = bars.get(c.to)!
    const pts: V3[] = [[c.from[0], c.from[1], 0.4], [c.from[0] + 3, c.from[1], 0.4], [c.from[0] + 3, c.midY, 0.4], [c.left, c.midY, 0.4], [c.left, to.cy, 0.4], [to.cx - to.w / 2 - 0.2, to.cy, 0.4]]
    for (let q = 0; q < pts.length - 1; q++) rod(pts[q], pts[q + 1], 0.07, 'neuron', 1)
    lab('*', 'pu', (c.from[0] + 3 + c.left) / 2, c.midY + 0.9, 0.4, [['', c.label]])
  }
  for (const r of plan.routes) {
    const from = bars.get(r.fromKey), st = steps.get(r.stop)
    if (!from || !st) continue
    const top = st.s.uy + 11.2, ux = st.s.ux + 0.75
    const pts: V3[] = [[from.cx + from.w / 2 + 0.2, from.cy, 0.4], [r.viaX, from.cy, 0.4], [r.viaX, top, 0.4], [ux, top, 0.4], [ux, st.s.uy + 0.75, 0.4]]
    for (let q = 0; q < pts.length - 1; q++) rod(pts[q], pts[q + 1], 0.07, 'bar', 1)
    lab('*', 'or', (r.viaX + ux) / 2, top + 0.9, 0.4, [['', 'the picture’s rows go in among the words']], { mode: 'slide', rank: 120 })
  }
  for (const c of plan.cubes) {
    const n = Math.max(2, Math.min(8, Math.round(Math.log2((c.dims[0] ?? 4) + 1))))
    for (let k = n - 1; k >= 0; k--) scene.slabs.push({ c: [c.x, c.y, -0.07 - k * 0.42], w: 2.6, h: 2.6, d: 0.14, color: 'slab', opacity: k ? 0.5 : 1, edge: 'neuron', edgeOpacity: k ? 0.55 : 1 })
    lab('*', 'pu', c.x, c.y + 2.2, 0, [['', `the memory: ${c.dims.map(fmtN).join(' x ')}`], ['', 'the same size at every token']])
    thin([c.x, c.y - 1.3, 0.1], [c.x + 0.75, c.y - 1.3 - 2.0, 0.4], 'neuron', 0.7)
    const cs = steps.get(c.stop)
    if (cs) grow(cs, c.x - 2.2, c.x + 2.2, c.y - 1.6, c.y + 3.4)
  }
  for (const g of plan.groupLabels) lab('*', 'grpl', g.x, g.y, g.z, g.parts, g.region ? { mode: 'slide', rank: 170 } : {})
  const first = plan.stops[0] ? plan.bars.get(plan.stops[0].key) : undefined
  if (first && batch > 1) lab('*', 'or', first.x - 3.6, first.y + 3.6, -1.5, [['', 'B: the rest'], ['', 'of the batch']], { mode: 'slide' })
  if (plan.feedback && plan.embed) {
    const fx0 = plan.embed.x
    const pb = bars.get(plan.feedback)!, ey = steps.get(plan.embed.stop)!.s.uy, ny = ey - (T * 0.42) / 2 - 0.45, by = pb.cy - 8.5
    const lp: V3[] = [[pb.cx, pb.cy - pb.h / 2 - 0.35, 0.2], [pb.cx, by, 0.2], [fx0 - 22.5, by, 0.2], [fx0 - 22.5, ny, 0.2], [fx0 - 18.9, ny, 0.2]]
    for (let q = 0; q < lp.length - 1; q++) rod(lp[q], lp[q + 1], 0.07, 'ex', 1)
    lab('*', 'ex', (pb.cx + fx0 - 22.5) / 2 - 1.75, by + 1.0, 0.2, [['', 'the most likely word is added to the end of the words, and the whole network runs again']])
    if (nextWord) {
      const stop = nextWord === '<end>' || nextWord === '<|endoftext|>'
      lab(`step:${plan.embed.stop}`, 'ex', fx0 - 17.2, ny, 0, [['', stop ? 'next: stop' : `next: ${nextWord}`]])
      lab(`step:${plan.stops[plan.stops.length - 1].id}`, 'ex', pb.cx, pb.cy - pb.h / 2 - 1.1, 0.2, [['', stop ? 'the network chooses to stop' : `the network writes “${nextWord}”`]])
    }
  }

  // ---- where the camera looks, for each stop and for the whole model
  plan.stops.forEach((s, n) => {
    const st = steps.get(s.id)!
    if (focus === s.id && st.EL.kind === 'linear' && st.shown.length > 1) dockRoom(st)
    scene.stops.push({ id: s.id, n: n + 1, specStep: stepOf(s), part: s.part, opId: s.opId, group: s.group, chip: s.chip, frame: frameOf(st), detail: st.lines, out: st.out, bars: st.inKeys.concat([s.key]) })
  })
  {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    const see = (x: number, y: number) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    for (const g of scene.grids) { see(g.cx - g.w / 2 - 1.6, g.cy - g.h / 2 - 2.2); see(g.cx + g.w / 2 + 1.6, g.cy + g.h / 2 + 1.9) }
    for (const r of scene.rods) { see(r.a[0], r.a[1]); see(r.b[0], r.b[1]) }
    for (const l of scene.labels) if (l.tag === '*') see(l.p[0], l.p[1] + (l.cls.startsWith('grpl') ? 1.2 : 0))
    if (plan.embed) see(-23.5, 0)
    scene.all = Number.isFinite(x0) ? { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2 + 1, hh: (y1 - y0) / 2 + 1 } : scene.all
  }

  // ---- the clicked bar's saved numbers, as a table
  {
    const ob = state.open ? plan.bars.get(state.open) : undefined, R = ob ? reg.get(ob.key) : undefined
    if (ob && R) {
      const rows = R.rows, nC = rows[0]?.length ?? 0
      let max = 1e-9
      for (const row of rows) for (const v of row) if (Number.isFinite(v) && Math.abs(v) > max) max = Math.abs(v)
      const fmt = (v: number) => (v === -Infinity ? 'masked' : Number.isNaN(v) ? '·' : R.kind === 'prob' ? `${(v * 100).toFixed(1)}%` : sg(v))
      const names = ob.cols ? ((Array.isArray(top?.labels) ? (top!.labels as string[]) : undefined) ?? extra.labels?.[ob.slice]) : undefined
      const head1 = ob.square ? rows.map((_, c) => rowName(ob.slice, c)) : Array.from({ length: nC }, (_, c) => names?.[c] ?? String(c + 1))
      const table: { cells: string[]; on?: boolean; shade?: number[] }[] = [{ cells: [ob.cells ? '' : ob.square ? 'reads ↓ from →' : 'row', ...head1] }]
      rows.forEach((row, r) => table.push({
        cells: [ob.cells ? `heads ${Math.floor(r / 2) * 8 + 1} to ${Math.floor(r / 2) * 8 + 8}, line ${(r % 2) + 1}` : rowName(ob.slice, r), ...row.map(fmt)],
        shade: [0, ...row.map((v) => (Number.isFinite(v) ? Math.min(1, Math.abs(v) / max) : 0))],
        on: !ob.cells && r === t0,
      }))
      const saved = R.real ? `${rows.length} rows x ${nC} columns of it are saved and shown here` : 'its numbers were not saved for this input, so the cells are empty'
      scene.open = [
        { t: 'h3', text: ob.heads && ob.heads > 1 ? `${ob.name}, head ${head + 1} of ${ob.heads}` : ob.name },
        { t: 'sizes', lines: [ob.cells ? `${ob.cells.heads} heads x ${fmtN(ob.cells.side)} x ${fmtN(ob.cells.side)}` : ob.square ? `${fmtN(R.size)} x ${fmtN(R.size)} drawn` : `each row is ${fmtN(R.size)} numbers wide`, saved] },
        { t: 'table', cls: 'mx', rows: table },
      ]
    }
  }

  // ---- the two cards under the drawing
  const what = scene.what, wts = scene.weights
  if (!focus) {
    what.push({ t: 'h2', text: 'The whole model' })
    for (const s of spec.steps) what.push({ t: 'p', text: s.text })
    what.push({ t: 'note', text: 'The orange ruler under each bar is its true width, all to one scale. Each bar draws its first columns as blocks, more of them for a wider row. Click a step name, or any block, to fly into that part.' })
    const blockOf = new Map(spec.blocks.map((b) => [b.id, b]))
    const sizeOf = (id: string) => { const t = spec.tensors.find((x) => x.id === id); return t ? t.axes.map((a) => (typeof a === 'number' ? a : spec.axes[a] ?? 0)) : [] }
    const rows: { cells: string[]; on?: boolean }[] = [{ cells: ['Where', 'Size', 'Weights', 'Across the model'] }]
    const counted = new Set<string>()
    let total = 0
    for (const op of spec.ops) for (const w of op.weights) {
      if (counted.has(w)) { rows.push({ cells: [`${op.id}: ${w}`, 'reused', '0', '0'] }); continue }
      counted.add(w)
      const dims = sizeOf(w), nw = dims.reduce((a, b) => a * b, 1), rep = op.block ? blockOf.get(op.block)?.repeat ?? 1 : 1
      total += nw * rep
      rows.push({ cells: [`${op.id}: ${w}`, dims.map(fmtN).join(' x '), fmtN(nw), rep > 1 ? `${fmtN(nw * rep)} across ${rep} blocks` : fmtN(nw)] })
    }
    rows.push({ cells: ['Total', '', '', fmtN(total)], on: true })
    wts.push({ t: 'h3', text: 'What goes into the parameter count' })
    wts.push({ t: 'p', text: 'A model’s parameter count is every weight added up: all the slopes, all the intercepts, and the scale and shift in each layer norm. For this model:' })
    wts.push({ t: 'table', cls: 'pc', rows })
  } else {
    const st = steps.get(focus)!, s = st.s, E = st.E, EL = st.EL, R = reg.get(s.key)!, n = plan.stops.indexOf(s)
    scene.at = { t: st.t, i: st.i }
    what.push({ t: 'h2', text: `Step ${n + 1} of ${plan.stops.length}: ${s.chip}` })
    const own = spec.steps[stepOf(s) - 1]?.text
    if (own) what.push({ t: 'p', text: own })
    if (s.text) what.push({ t: 'p', text: s.text })
    let f = EL.formula ?? ''
    if (s.unit === 'relu') f = `y${st.i + 1} = ${s.act}( ${f.replace(/^y\d+ = /, '')} )`
    if (f && E.kind !== 'leaf') what.push({ t: 'formula', text: f })
    if (EL.kind === 'linear') { const eq = eqLines(st); if (eq.length) { what.push({ t: 'h3', text: 'The sum, written out' }); for (const l of eq) what.push({ t: 'formula', text: l }) } }
    const sizes = [`goes out: (B, T, ${fmtN(R.size)}) = ${batch} x ${R.rows.length} x ${fmtN(R.size)} = ${fmtN(batch * R.rows.length * R.size)} activations`]
    if (EL.kind === 'linear') {
      const nO = EL.nOut ?? 0, nI = EL.nIn ?? 0
      sizes.push(`this layer: ${fmtN(nO)} neurons x ${fmtN(nI)} slopes${EL.bias ? ` + ${fmtN(nO)} intercepts = ${fmtN(nO * nI + nO)}` : ` = ${fmtN(nO * nI)}`} weights`)
      sizes.push(`a neuron is as wide as its input (${fmtN(nI)}); how many neurons there are (${fmtN(nO)}) is a free choice`)
    }
    if (['scores', 'weights', 'mix'].includes(s.part)) sizes.push(`drawn for head ${head + 1} of ${facts.heads}; each head has its own ${HS} columns of the queries, keys and values`)
    what.push({ t: 'sizes', lines: sizes })
    const exchanges = ['scores', 'weights', 'mix'].includes(s.part)
    const at = s.part === 'scores' || s.part === 'weights' ? `looking at position ${st.i + 1} (“${word(st.i)}”)` : `column ${st.i + 1} of ${fmtN(R.size)}`
    what.push({ t: 'note', text: `Shown at work on: position ${st.t + 1} (“${rowName(plan.bars.get(st.s.key)!.slice, st.t)}”), ${at}. The same thing happens at every position and for every example in the batch, each on its own${exchanges ? ', except that here a position does use the positions before it' : ''}.` })
    if (EL.kind === 'linear') {
      const nO = EL.nOut ?? 0, nI = EL.nIn ?? 0
      wts.push({ t: 'h3', text: `The table drawn under this step, as numbers: 8 of its ${fmtN(nO)} neurons, 8 of each one’s ${fmtN(nI)} slopes` })
      if (EL.W && EL.W.length) {
        const rows: { cells: string[]; on?: boolean }[] = [{ cells: [''].concat([1, 2, 3, 4, 5, 6, 7, 8].map((c) => `x${c}`), ['…', EL.Wb ? 'intercept' : '']) }]
        EL.W.forEach((r, j) => { if (j > 7 && j !== st.i) return; rows.push({ cells: [`y${j + 1} :`].concat(r.slice(0, 8).map(sg), ['…', EL.Wb ? sg(EL.Wb[j]) : '']), on: j === st.i }) })
        wts.push({ t: 'table', cls: 'mx', rows, pickRows: EL.W.map((_, j) => j).filter((j) => j <= 7 || j === st.i) })
      }
      wts.push({ t: 'note', text: `The whole matrix is ${fmtN(nO)} rows by ${fmtN(nI)} columns. These numbers stay the same for every prompt. Only the blocks in the drawing change.` })
    } else if (s.unit === 'lookup') {
      wts.push({ t: 'h3', text: plan.embed && plan.embed.tables.length > 1 ? 'Two lookup tables' : 'A lookup table' })
      wts.push({ t: 'note', text: `${plan.embed?.tables.map((tb) => `The ${tb.title}: ${tb.size}.`).join(' ')} A lookup picks one row. There is no sum over inputs and no neuron here.` })
    } else if (E.kind === 'norm') {
      wts.push({ t: 'h3', text: `A scale and a shift per column: ${fmtN(2 * R.size)} weights` })
      wts.push({ t: 'note', text: `Layer norm has one scale and one shift for each of the ${fmtN(R.size)} columns. The mean and the spread are not weights. They are worked out fresh from each row.` })
    } else {
      wts.push({ t: 'h3', text: 'None in this step' })
      wts.push({ t: 'note', text: `This step has no weights of its own. It only combines activations that earlier steps produced${s.part === 'scores' ? ', which is why the same step works for any pair of positions.' : '.'}` })
    }
  }
  return scene
}
