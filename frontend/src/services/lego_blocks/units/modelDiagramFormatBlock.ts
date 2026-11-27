// The model-diagram format, as pure parsing and checking: a model's structure
// (`<model>.model.yaml`) and its real values for one input (`values/<input>.json`).
// The engine that draws it is described in docs/reference/MODEL-DIAGRAM-ENGINE.md.
// A spec that does not connect is refused here, by name, so the engine only
// ever receives one where every tensor, op, block and step resolves. Nothing
// here reads a file; modelDiagramsOrch does that and hands the text in.

import { load as loadYaml } from 'js-yaml'

/** The fixed list of op kinds; each has one standard 3D shape in the engine. */
export const MODEL_OP_KINDS = [
  'input', 'embed', 'patchify', 'position', 'norm', 'linear', 'attention',
  'memory', 'mlp', 'act', 'add', 'join', 'unembed', 'output',
] as const
export type ModelOpKind = (typeof MODEL_OP_KINDS)[number]

export interface ModelSourceBlock {
  model: string
  revision: string | null
  generator_commit: string | null
  date: string | null
}

/** An axis is named (looked up in `axes`) or a plain size. */
export type ModelAxisRefBlock = string | number

export interface ModelTensorBlock {
  id: string
  axes: ModelAxisRefBlock[]
  role: 'activation' | 'weight'
  note?: string
}

export interface ModelOpBlock {
  id: string
  /** A plain label for people ("Layer norm"); the id stays the address. */
  name?: string
  kind: ModelOpKind
  in: string[]
  out: string[]
  weights: string[]
  block?: string
  note?: string
  /** attention only */
  mask?: 'causal' | 'none'
  heads?: number
  kv_heads?: number
  /** memory only: the shape of its running state */
  state?: ModelAxisRefBlock[]
  /** The bend an op applies (GELU, SiLU), when it has one. */
  act?: string
  /** An MLP whose bent layer multiplies a second layer. */
  gated?: boolean
}

export interface ModelRepeatBlock {
  id: string
  name?: string
  ops: string[]
  repeat: number
  pattern?: string
}

export interface ModelStepBlock {
  /** An op id or a block id. */
  id: string
  name?: string
  /** One plain sentence, the way it would be said aloud. */
  text: string
}

export interface ModelSpec {
  source: ModelSourceBlock
  axes: Record<string, number>
  tensors: ModelTensorBlock[]
  ops: ModelOpBlock[]
  blocks: ModelRepeatBlock[]
  /** The residual stream's tensor at each point, in flow order (the language stream in a VLM). */
  stream: string[]
  /** Other towers' streams, by tower ("vision"), each checked like `stream`. */
  streams: Record<string, string[]>
  steps: ModelStepBlock[]
}

export interface ModelValueSliceBlock {
  /** The tensor's full shape. */
  shape: number[]
  /** The first rows and columns (up to 32 x 32), or the rows named in `row_ids`. */
  rows: number[][]
  /** The row number of each row given, when the rows are chosen rather than the first ones. */
  row_ids?: number[]
  /** The column number of each column given (an attention slice on chosen tokens: equal to row_ids). */
  col_ids?: number[]
}


/** The likeliest next tokens on one pass. */
export interface ModelTopPassBlock {
  'unembed.top'?: number[][]
  'output.top'?: number[][]
  'unembed.top.weight'?: number[][]
  labels?: string[]
  [key: string]: unknown
}

export interface ModelValues {
  /** The input's name (the file's name without `.json`). */
  input: string
  run_id: string
  sha256: string
  tokens: string[]
  slices: Record<string, ModelValueSliceBlock>
  /** opId -> head index -> attention map (its rows) */
  attention: Record<string, Record<string, number[][]>>
  /**
   * opId -> head index -> the row number of each row in its map, for heads
   * whose rows were chosen rather than the first ones. The file writes a
   * head as `{ rows, row_ids }`; the parser splits it into the two fields.
   */
  attention_row_ids?: Record<string, Record<string, number[]>>
  /** Every head's similarity scores, laid out as `attention` is; masked cells are -1e9. Head 0 equals the `<op>.scores` slice. */
  attention_scores?: Record<string, Record<string, number[][]>>
  attention_scores_row_ids?: Record<string, Record<string, number[]>>
  row_lengths?: Record<string, number[]>
  reply?: string
  /** Optional extras the engine reads when present. */
  token_ids?: number[]
  /** How many tokens were the input; the rest is the reply. */
  prompt_tokens?: number
  /** slice id -> strings for its columns */
  labels?: Record<string, string[]>
  /** tensor (or point) id -> per-row statistics */
  row_stats?: Record<string, { mean?: number[]; sd?: number[]; rms?: number[] }>
  /** One entry per generated pass. */
  top_by_pass?: ModelTopPassBlock[]
  /** Which rows of the token line are a picture's: first and last row, counted from 0. */
  picture?: { first_row: number; last_row: number; [more: string]: unknown }
  /** opId -> head index -> that head's last row of attention weights, at every `attention_last_row_every`-th token. */
  attention_last_row?: Record<string, Record<string, number[]>>
  attention_last_row_every?: number
}

/** A problem found in a file, with what it names, so it can be fixed by hand. */
export interface ModelFormatProblemBlock {
  /** Where in the file: "ops[3] attn_0", "steps[12]". */
  at: string
  message: string
}

export type ModelParseResultBlock<T> = { ok: true; value: T } | { ok: false; problems: ModelFormatProblemBlock[] }

/** The cap on one values file, from the format. */
export const MODEL_VALUES_MAX_BYTES = 2 * 1024 * 1024

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
const list = (value: unknown): unknown[] => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
const ids = (value: unknown): string[] => list(value).map(str).filter((s): s is string => s !== null)
const isPositiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

const ELEMENTWISE_KINDS: ReadonlySet<ModelOpKind> = new Set(['norm', 'act', 'add', 'position'])
// Kinds that keep every axis but the last (the features) from input to output.
const LEADING_KEPT_KINDS: ReadonlySet<ModelOpKind> = new Set(['linear', 'mlp', 'attention', 'unembed'])

/**
 * Parse and check `<model>.model.yaml`. Refuses an unknown kind, a missing
 * tensor or op, a shape that disagrees, or a step naming no id.
 */
export function parseModelSpecBlock(source: string): ModelParseResultBlock<ModelSpec> {
  let raw: unknown
  try {
    raw = loadYaml(source)
  } catch (error) {
    return { ok: false, problems: [{ at: 'file', message: `The YAML does not parse: ${(error as Error).message.split('\n')[0]}` }] }
  }
  if (!isObject(raw)) return { ok: false, problems: [{ at: 'file', message: 'The file is not a mapping of fields.' }] }

  const problems: ModelFormatProblemBlock[] = []
  const problem = (at: string, message: string) => problems.push({ at, message })

  // source
  const rawSource = isObject(raw.source) ? raw.source : {}
  const modelSource: ModelSourceBlock = {
    model: str(rawSource.model) ?? str(rawSource.id) ?? '',
    revision: str(rawSource.revision),
    generator_commit: str(rawSource.generator_commit) ?? str(rawSource.commit),
    date: str(rawSource.date),
  }
  if (!modelSource.model) problem('source', 'No model id is given (source.model).')

  // axes
  const axes: Record<string, number> = {}
  if (!isObject(raw.axes)) problem('axes', 'No axes are given.')
  else for (const [name, size] of Object.entries(raw.axes)) {
    if (isPositiveInt(size)) axes[name] = size
    else problem(`axes.${name}`, `The axis "${name}" has size ${JSON.stringify(size)}, which is not a positive whole number.`)
  }

  const axisRefs = (value: unknown, at: string): ModelAxisRefBlock[] => list(value).map((axis, i) => {
    if (isPositiveInt(axis)) return axis
    const name = str(axis)
    if (name === null) { problem(at, `Axis ${i + 1} is neither a name nor a size.`); return 0 }
    if (!(name in axes)) problem(at, `The axis "${name}" is not one of the model's axes.`)
    return name
  })

  // tensors
  const tensors: ModelTensorBlock[] = []
  const tensorById = new Map<string, ModelTensorBlock>()
  list(raw.tensors).forEach((t, i) => {
    const id = isObject(t) ? str(t.id) : null
    const at = `tensors[${i}]${id ? ` ${id}` : ''}`
    if (!isObject(t) || !id) { problem(at, 'A tensor has no id.'); return }
    if (tensorById.has(id)) { problem(at, `The tensor id "${id}" is used twice.`); return }
    const role = str(t.role)
    if (role !== 'activation' && role !== 'weight') problem(at, `The role "${role ?? ''}" is neither activation nor weight.`)
    const tensor: ModelTensorBlock = { id, axes: axisRefs(t.axes, at), role: role === 'weight' ? 'weight' : 'activation' }
    if (tensor.axes.length === 0) problem(at, `The tensor "${id}" has no axes.`)
    const note = str(t.note)
    if (note) tensor.note = note
    tensors.push(tensor)
    tensorById.set(id, tensor)
  })
  if (tensors.length === 0) problem('tensors', 'No tensors are given.')

  // blocks (read before ops so an op's `block` can be checked)
  const blocks: ModelRepeatBlock[] = []
  const blockById = new Map<string, ModelRepeatBlock>()
  list(raw.blocks).forEach((b, i) => {
    const id = isObject(b) ? str(b.id) : null
    const at = `blocks[${i}]${id ? ` ${id}` : ''}`
    if (!isObject(b) || !id) { problem(at, 'A block has no id.'); return }
    if (blockById.has(id)) { problem(at, `The block id "${id}" is used twice.`); return }
    const repeat = b.repeat === undefined ? 1 : b.repeat
    if (!isPositiveInt(repeat)) problem(at, `The repeat ${JSON.stringify(b.repeat)} is not a positive whole number.`)
    const block: ModelRepeatBlock = { id, ops: ids(b.ops), repeat: isPositiveInt(repeat) ? repeat : 1 }
    const pattern = str(b.pattern)
    if (pattern) block.pattern = pattern
    const blockName = str(b.name)
    if (blockName) block.name = blockName
    blocks.push(block)
    blockById.set(id, block)
  })

  // ops
  const ops: ModelOpBlock[] = []
  const opById = new Map<string, ModelOpBlock>()
  const kinds = new Set<string>(MODEL_OP_KINDS)
  list(raw.ops).forEach((o, i) => {
    const id = isObject(o) ? str(o.id) : null
    const at = `ops[${i}]${id ? ` ${id}` : ''}`
    if (!isObject(o) || !id) { problem(at, 'An op has no id.'); return }
    if (opById.has(id) || blockById.has(id)) { problem(at, `The id "${id}" is used twice.`); return }
    const kind = str(o.kind) ?? ''
    if (!kinds.has(kind)) problem(at, `The kind "${kind}" is not one of the known kinds (${MODEL_OP_KINDS.join(', ')}).`)
    const op: ModelOpBlock = { id, kind: kind as ModelOpKind, in: ids(o.in), out: ids(o.out), weights: ids(o.weights) }
    for (const [field, refs] of [['in', op.in], ['out', op.out], ['weights', op.weights]] as const) {
      for (const ref of refs) {
        const tensor = tensorById.get(ref)
        if (!tensor) problem(at, `"${field}" names the tensor "${ref}", which is not in tensors.`)
        else if (field === 'weights' && tensor.role !== 'weight') problem(at, `"weights" names "${ref}", whose role is ${tensor.role}.`)
      }
    }
    if (op.out.length === 0 && kind !== 'output') problem(at, `The op "${id}" has no output tensor.`)
    const block = str(o.block)
    if (block) {
      op.block = block
      if (!blockById.has(block)) problem(at, `"block" names "${block}", which is not in blocks.`)
    }
    const note = str(o.note)
    if (note) op.note = note
    const opName = str(o.name)
    if (opName) op.name = opName
    const act = str(o.act)
    if (act) op.act = act
    if (o.gated === true) op.gated = true
    if (kind === 'attention') {
      const mask = str(o.mask) ?? 'none'
      if (mask !== 'causal' && mask !== 'none') problem(at, `The mask "${mask}" is neither causal nor none.`)
      op.mask = mask === 'causal' ? 'causal' : 'none'
      if (!isPositiveInt(o.heads)) problem(at, 'An attention op needs "heads", a positive whole number.')
      else op.heads = o.heads
      const kvHeads = o.kv_heads === undefined ? o.heads : o.kv_heads
      if (!isPositiveInt(kvHeads)) problem(at, '"kv_heads" is not a positive whole number.')
      else {
        op.kv_heads = kvHeads
        if (op.heads && op.heads % kvHeads !== 0) problem(at, `${op.heads} heads do not divide evenly over ${kvHeads} kv_heads.`)
      }
    }
    if (kind === 'memory') {
      if (o.state === undefined) problem(at, 'A memory op needs "state", the shape of its running state.')
      else op.state = axisRefs(o.state, `${at} state`)
    }
    ops.push(op)
    opById.set(id, op)
  })
  if (ops.length === 0) problem('ops', 'No ops are given.')

  // Blocks name real ops, and an op claims at most the block it sits in.
  for (const block of blocks) {
    for (const opId of block.ops) {
      const op = opById.get(opId)
      if (!op) problem(`blocks ${block.id}`, `The block names the op "${opId}", which is not in ops.`)
      else if (op.block && op.block !== block.id) problem(`blocks ${block.id}`, `The op "${opId}" says it is in the block "${op.block}".`)
    }
  }

  // Shapes agree where a kind says they must.
  const size = (axis: ModelAxisRefBlock): number | null => typeof axis === 'number' ? axis : axes[axis] ?? null
  const shapeOf = (id: string): Array<number | null> | null => tensorById.get(id)?.axes.map(size) ?? null
  const same = (a: Array<number | null>, b: Array<number | null>) => a.length === b.length && a.every((n, i) => n === null || b[i] === null || n === b[i])
  const show = (id: string) => `${id} [${(tensorById.get(id)?.axes ?? []).join(', ')}]`
  for (const op of ops) {
    const at = `ops ${op.id}`
    const activations = op.in.filter(id => tensorById.get(id)?.role === 'activation')
    const first = activations[0] ? shapeOf(activations[0]) : null
    if (!first) continue
    if (ELEMENTWISE_KINDS.has(op.kind)) {
      for (const id of [...activations.slice(1), ...op.out]) {
        const shape = shapeOf(id)
        if (shape && !same(first, shape)) problem(at, `A ${op.kind} keeps its shape, but ${show(activations[0])} and ${show(id)} disagree.`)
      }
    } else if (LEADING_KEPT_KINDS.has(op.kind)) {
      for (const id of op.out) {
        const shape = shapeOf(id)
        if (shape && !same(first.slice(0, -1), shape.slice(0, -1))) {
          problem(at, `A ${op.kind} keeps every axis but the last, but ${show(activations[0])} and ${show(id)} disagree.`)
        }
      }
    }
  }

  // Each stream names activations, and keeps one width all along.
  const checkStream = (at: string, line: string[]) => {
    for (const id of line) {
      const tensor = tensorById.get(id)
      if (!tensor) problem(at, `The stream names the tensor "${id}", which is not in tensors.`)
      else if (tensor.role !== 'activation') problem(at, `The stream names "${id}", which is a weight.`)
    }
    const known = line.filter(id => tensorById.has(id))
    const shapes = known.map(id => shapeOf(id)!)
    for (let i = 1; i < shapes.length; i++) {
      const [a, b] = [shapes[i - 1], shapes[i]]
      if (a.length !== b.length || a[a.length - 1] !== b[b.length - 1]) {
        problem(at, `The stream changes width between ${show(known[i - 1])} and ${show(known[i])}.`)
      }
    }
  }
  const stream = ids(raw.stream)
  checkStream('stream', stream)
  const streams: Record<string, string[]> = {}
  if (raw.streams !== undefined && !isObject(raw.streams)) problem('streams', 'The other streams are given by tower name.')
  for (const [tower, line] of Object.entries(isObject(raw.streams) ? raw.streams : {})) {
    streams[tower] = ids(line)
    checkStream(`streams.${tower}`, streams[tower])
  }

  // Steps name a real op or block, and say something.
  const steps: ModelStepBlock[] = []
  list(raw.steps).forEach((s, i) => {
    const at = `steps[${i}]`
    const id = isObject(s) ? str(s.id) ?? str(s.op) ?? str(s.block) : null
    const text = isObject(s) ? str(s.text) ?? str(s.say) : null
    if (!id) { problem(at, `Step ${i + 1} names no id.`); return }
    if (!opById.has(id) && !blockById.has(id)) problem(at, `Step ${i + 1} names "${id}", which is neither an op nor a block.`)
    if (!text) problem(at, `Step ${i + 1} (${id}) has no sentence.`)
    const stepName = isObject(s) ? str(s.name) : null
    steps.push(stepName ? { id, name: stepName, text: text ?? '' } : { id, text: text ?? '' })
  })
  if (steps.length === 0) problem('steps', 'No steps are given.')

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { source: modelSource, axes, tensors, ops, blocks, stream, streams, steps } }
}

/**
 * Parse and check `values/<input>.json` against its spec: every slice names a
 * tensor, every attention map an attention op, and the slice's shape is the
 * tensor's shape.
 */
export function parseModelValuesBlock(source: string, input: string, spec: ModelSpec): ModelParseResultBlock<ModelValues> {
  if (source.length > MODEL_VALUES_MAX_BYTES) {
    return { ok: false, problems: [{ at: 'file', message: `The file is ${(source.length / 1048576).toFixed(1)} MB; the cap is 2 MB.` }] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch (error) {
    return { ok: false, problems: [{ at: 'file', message: `The JSON does not parse: ${(error as Error).message}` }] }
  }
  if (!isObject(raw)) return { ok: false, problems: [{ at: 'file', message: 'The file is not an object.' }] }
  const problems: ModelFormatProblemBlock[] = []
  const problem = (at: string, message: string) => problems.push({ at, message })

  const runId = str(raw.run_id)
  const sha = str(raw.sha256)
  if (!runId) problem('run_id', 'No run id is given, so the numbers cannot be traced to a run.')
  if (!sha) problem('sha256', 'No sha256 of the raw dump is given.')
  const tokens = list(raw.tokens).map(t => typeof t === 'string' ? t : String(t))

  const tensorById = new Map(spec.tensors.map(t => [t.id, t]))
  const axisSize = (axis: ModelAxisRefBlock) => typeof axis === 'number' ? axis : spec.axes[axis]
  const slices: Record<string, ModelValueSliceBlock> = {}
  const opIds = new Set(spec.ops.map(op => op.id))
  for (const [id, slice] of Object.entries(isObject(raw.slices) ? raw.slices : {})) {
    const at = `slices.${id}`
    const tensor = tensorById.get(id)
    // Besides tensors, the engine reads an op's inner parts by fixed names:
    // `<op>.q`, `<op>.scores`, `<op>.<part>.weight`, `<unembed>.top`, ...
    const dot = id.indexOf('.')
    const innerOf = dot > 0 && opIds.has(id.slice(0, dot)) ? id.slice(0, dot) : null
    if (!tensor && !innerOf) { problem(at, `The slice names "${id}", which is neither a tensor nor a part of an op in the spec.`); continue }
    if (!isObject(slice) || !Array.isArray(slice.shape) || !Array.isArray(slice.rows)) { problem(at, 'A slice needs "shape" and "rows".'); continue }
    const shape = slice.shape as number[]
    const rowIds = Array.isArray(slice.row_ids) ? slice.row_ids as number[] : null
    if (rowIds && rowIds.length !== (slice.rows as unknown[]).length) problem(at, `"row_ids" has ${rowIds.length} entries for ${(slice.rows as unknown[]).length} rows.`)
    const colIds = Array.isArray(slice.col_ids) ? slice.col_ids as number[] : null
    const kept = (): ModelValueSliceBlock => {
      const out: ModelValueSliceBlock = { shape, rows: slice.rows as number[][] }
      if (rowIds) out.row_ids = rowIds
      if (colIds) out.col_ids = colIds
      return out
    }
    if (!tensor) {
      slices[id] = kept()
      continue
    }
    if (shape.length !== tensor.axes.length) {
      problem(at, `The slice has ${shape.length} axes; the tensor has ${tensor.axes.length}.`)
    } else {
      // Batch and token sizes vary with the input; every other axis is the spec's.
      tensor.axes.forEach((axis, i) => {
        if (axis === 'batch' || axis === 'tokens' || axis === 'patches') return
        if (shape[i] !== axisSize(axis)) problem(at, `Axis ${axis} is ${shape[i]} here and ${axisSize(axis)} in the spec.`)
      })
    }
    slices[id] = kept()
  }

  const attentionOps = new Set(spec.ops.filter(op => op.kind === 'attention').map(op => op.id))
  // attention maps and, where the file has them, every head's scores: the same layout, read the same way
  const byHead = (field: 'attention' | 'attention_scores') => {
    const out: Record<string, Record<string, number[][]>> = {}, ids: Record<string, Record<string, number[]>> = {}
    for (const [opId, heads] of Object.entries(isObject(raw[field]) ? raw[field] : {})) {
      if (!attentionOps.has(opId)) { problem(`${field}.${opId}`, `"${opId}" is not an attention op in the spec.`); continue }
      if (!isObject(heads)) { problem(`${field}.${opId}`, 'Attention maps are given by head index.'); continue }
      const maps: Record<string, number[][]> = {}
      for (const [head, map] of Object.entries(heads)) {
        if (Array.isArray(map)) { maps[head] = map as number[][]; continue }
        if (!isObject(map) || !Array.isArray(map.rows) || (map.row_ids !== undefined && !Array.isArray(map.row_ids))) {
          problem(`${field}.${opId}.${head}`, 'A head\'s map is a list of rows, or { rows, row_ids }.')
          continue
        }
        maps[head] = map.rows as number[][]
        if (Array.isArray(map.row_ids)) {
          if (map.row_ids.length !== map.rows.length) problem(`${field}.${opId}.${head}`, `"row_ids" has ${map.row_ids.length} entries for ${map.rows.length} rows.`)
          ids[opId] = { ...ids[opId], [head]: map.row_ids as number[] }
        }
      }
      out[opId] = maps
    }
    return { out, ids }
  }
  const { out: attention, ids: attentionRowIds } = byHead('attention')
  const { out: attentionScores, ids: attentionScoresRowIds } = byHead('attention_scores')

  if (problems.length > 0) return { ok: false, problems }
  const values: ModelValues = { input, run_id: runId!, sha256: sha!, tokens, slices, attention }
  if (isObject(raw.row_lengths)) values.row_lengths = raw.row_lengths as Record<string, number[]>
  // The reply keeps its own spacing: a token often starts with one.
  if (typeof raw.reply === 'string' && raw.reply) values.reply = raw.reply
  if (Array.isArray(raw.token_ids)) values.token_ids = raw.token_ids as number[]
  if (Object.keys(attentionRowIds).length > 0) values.attention_row_ids = attentionRowIds
  if (Object.keys(attentionScores).length > 0) values.attention_scores = attentionScores
  if (Object.keys(attentionScoresRowIds).length > 0) values.attention_scores_row_ids = attentionScoresRowIds
  if (typeof raw.prompt_tokens === 'number') values.prompt_tokens = raw.prompt_tokens
  if (isObject(raw.labels)) values.labels = raw.labels as ModelValues['labels']
  if (isObject(raw.row_stats)) values.row_stats = raw.row_stats as ModelValues['row_stats']
  if (Array.isArray(raw.top_by_pass)) values.top_by_pass = raw.top_by_pass as ModelTopPassBlock[]
  if (isObject(raw.picture) && typeof raw.picture.first_row === 'number' && typeof raw.picture.last_row === 'number') values.picture = raw.picture as ModelValues['picture']
  if (isObject(raw.attention_last_row)) values.attention_last_row = raw.attention_last_row as ModelValues['attention_last_row']
  if (typeof raw.attention_last_row_every === 'number') values.attention_last_row_every = raw.attention_last_row_every
  return { ok: true, value: values }
}

/** A model's weight slices, written once in `<model folder>/weights.json` for every input. */
export interface ModelWeightsBlock {
  run_id: string
  sha256: string
  slices: Record<string, ModelValueSliceBlock>
}

/** The cap on a weight slice's rows and columns, from the format. */
export const MODEL_WEIGHT_SLICE_MAX = 32

/**
 * Parse and check `weights.json` the way a values file's slices are checked,
 * and more: every slice is a weight (a weight tensor of the spec, or an op's
 * own weight such as `attn.q.weight`), never an activation, and within 32 x 32.
 */
export function parseModelWeightsBlock(source: string, spec: ModelSpec): ModelParseResultBlock<ModelWeightsBlock> {
  const parsed = parseModelValuesBlock(source, 'weights', spec)
  if (!parsed.ok) return parsed
  const problems: ModelFormatProblemBlock[] = []
  const tensorById = new Map(spec.tensors.map(t => [t.id, t]))
  for (const [id, slice] of Object.entries(parsed.value.slices)) {
    const tensor = tensorById.get(id)
    if (tensor ? tensor.role !== 'weight' : !/\.(weight|bias)$/.test(id)) {
      problems.push({ at: `slices.${id}`, message: `"${id}" is not a weight; weights.json holds weights only (activations belong in values/).` })
    }
    const widest = slice.rows.reduce((most, row) => Math.max(most, Array.isArray(row) ? row.length : 1), 0)
    if (slice.rows.length > MODEL_WEIGHT_SLICE_MAX || widest > MODEL_WEIGHT_SLICE_MAX) {
      problems.push({ at: `slices.${id}`, message: `The slice is ${slice.rows.length} x ${widest}; a weight slice is at most ${MODEL_WEIGHT_SLICE_MAX} x ${MODEL_WEIGHT_SLICE_MAX}.` })
    }
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { run_id: parsed.value.run_id, sha256: parsed.value.sha256, slices: parsed.value.slices } }
}

/** One input's values with the model's weight slices merged in; the input's own slices win on a clash. */
export function mergeModelWeightsBlock(values: ModelValues, weights: ModelWeightsBlock | null): ModelValues {
  return weights ? { ...values, slices: { ...weights.slices, ...values.slices } } : values
}

/** A step pointer: `[[<model>.model#step-<n>]]`. */
export interface ModelStepPointerBlock {
  /** The model's name, as in its folder and `<model>.model.yaml`. */
  model: string
  step: number
}

const STEP_POINTER_RE = /^\[\[([^\]|#]+?)\.model#step-(\d+)(?:\|[^\]]*)?\]\]$/

/** Read a step pointer written alone on a line; null when the line is something else. */
export function parseModelStepPointerBlock(line: string): ModelStepPointerBlock | null {
  const match = STEP_POINTER_RE.exec(line.trim())
  if (!match) return null
  const name = match[1].trim()
  return { model: name.slice(name.lastIndexOf('/') + 1), step: Number(match[2]) }
}

/** A chapter or link target that names a model: `qwen3.5-9b.model` gives `qwen3.5-9b`. */
export function modelTargetNameBlock(target: string): string | null {
  const name = target.trim().replace(/\/$/, '')
  const base = name.slice(name.lastIndexOf('/') + 1)
  return /\.model$/i.test(base) ? base.replace(/\.model$/i, '') : null
}

/** The address of a model's full view. */
export function modelViewSearchBlock(specPath: string, step: number, part?: string | null): string {
  const params = new URLSearchParams({ model: specPath })
  if (step > 0) params.set('step', String(step))
  if (part) params.set('part', part)
  return `?${params.toString()}`
}
