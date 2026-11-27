import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseModelSpecBlock, type ModelSpec, type ModelValues } from '../src/services/lego_blocks/units/modelDiagramFormatBlock'
import {
  layoutModelDiagramBlock, modelDiagramColumnsBlock, modelDiagramStopsBlock, MODEL_DIAGRAM_START_STATE_BLOCK,
} from '../src/services/lego_blocks/units/modelDiagramLayoutBlock'

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/model-diagram-engine/${name}`, import.meta.url)), 'utf8')
const parsed = parseModelSpecBlock(read('gpt-2.model.yaml'))
if (!parsed.ok) throw new Error(`the GPT-2 fixture does not pass the checker: ${JSON.stringify(parsed.problems)}`)
const spec: ModelSpec = parsed.value
const values = JSON.parse(read('values/sky.json')) as ModelValues
const start = MODEL_DIAGRAM_START_STATE_BLOCK

describe('modelDiagramColumnsBlock', () => {
  it('draws 8 columns for 768 and 16 for 3,072, and never a pillar', () => {
    expect(modelDiagramColumnsBlock(768)).toBe(8)
    expect(modelDiagramColumnsBlock(3072)).toBe(16)
    expect(modelDiagramColumnsBlock(11)).toBe(11)
    expect(modelDiagramColumnsBlock(2880)).toBeLessThanOrEqual(16)
    expect(modelDiagramColumnsBlock(10_000_000)).toBe(32)
    expect(modelDiagramColumnsBlock(40)).toBe(4)
  })
})

describe('layoutModelDiagramBlock on GPT-2', () => {
  const scene = layoutModelDiagramBlock(spec, values, start)
  const grid = (key: string) => scene.grids.find((g) => g.key === key)!

  it('opens the model into the reference page\'s seventeen steps, in its groups', () => {
    expect(scene.stops.map((s) => s.chip)).toEqual([
      'Embedding', 'Layer norm', 'Query', 'Key', 'Value', 'Similarity + mask', 'Attention weights', 'Mix the values', 'Output layer',
      'Add to the stream', 'Layer norm', 'MLP layer 1 + GELU', 'MLP layer 2', 'Add to the stream', 'Final layer norm', 'Score per word', 'Chance of each word',
    ])
    expect(scene.strip.map((g) => ('label' in g ? g.label : 'note'))).toEqual(['In', 'Block 1: Attention', 'Block 1: MLP', 'note', 'Out'])
  })

  it('puts every bar where the reference page has it', () => {
    const want: Record<string, [number, number]> = {
      x0: [0, 0], h1: [12, 11.5], 'attn.q': [24, 17.5], 'attn.k': [24, 11.5], 'attn.v': [24, 5.5], 'attn.scores': [36, 14.5], 'attn.weights': [48, 14.5],
      'attn.mixed': [60, 10], a1: [72, 10], x1: [0, -30], h2: [12, -20], 'mlp.act': [24, -20], m1: [36, -20], x2: [48, -30],
      'after:block': [66, -30], hf: [78, -30], logits: [90, -30], probs: [102, -30],
    }
    for (const [key, [x, y]] of Object.entries(want)) expect([key, grid(key).cx, grid(key).cy]).toEqual([key, x, y])
  })

  it('sizes bars as the reference does: 8 columns of 768, 16 of 3,072, a square for attention', () => {
    expect([grid('x0').nR, grid('x0').nC]).toEqual([11, 8])
    expect(grid('mlp.act').nC).toBe(16)
    expect([grid('attn.scores').nR, grid('attn.scores').nC]).toEqual([11, 11])
    expect(grid('logits').nC).toBe(8)
    for (const g of scene.grids) { expect(g.w).toBeLessThanOrEqual(4.9); expect(g.h).toBeLessThanOrEqual(4.9) }
  })

  it('masks the pairs above the diagonal', () => {
    const g = grid('attn.scores')
    expect(g.heights[0 * 11 + 5]).toBe(0.03)
    expect(g.heights[5 * 11 + 0]).toBeGreaterThan(0.03)
  })

  it('carries the stream to the next row as one line, and back to the start from the answer', () => {
    const thick = scene.rods.filter((r) => r.r === 0.07)
    expect(thick.some((r) => r.color === 'neuron' && r.a[0] === 88 && r.b[0] === 88 && r.b[1] === -13.5)).toBe(true)
    expect(thick.some((r) => r.color === 'ex' && r.a[1] === -38.5 && r.b[0] === -22.5)).toBe(true)
  })

  it('collapses the other eleven blocks into ghosts, with their count', () => {
    expect(scene.labels.some((l) => l.parts[0][1] === '11 more blocks')).toBe(true)
  })

  it('maps every stop back to a step of the spec', () => {
    const stops = modelDiagramStopsBlock(spec)
    expect(stops.find((s) => s.id === 'attn.scores')!.specStep).toBe(2)
    expect(stops.find((s) => s.id === 'ln2')!.specStep).toBe(4)
    expect(stops.find((s) => s.id === 'output')!.specStep).toBe(6)
  })

  it('works a neuron\'s sum out of real numbers when a step is in focus', () => {
    const s = layoutModelDiagramBlock(spec, values, { ...start, focus: 'attn.q' })
    const formulas = s.what.filter((c) => c.t === 'formula').map((c) => (c as { text: string }).text)
    expect(formulas[0]).toBe('y1 = a1,1·x1 + … + a1,768·x768 + b1')
    expect(formulas.some((f) => f.startsWith('z = '))).toBe(true)
    expect(s.labels.filter((l) => l.cls.startsWith('pill') && l.tag === 'step:attn.q')).toHaveLength(10)
    expect(s.grids.some((g) => g.key === 'table:attn.q' && g.pick?.rows?.length === 8)).toBe(true)
    expect(s.stops.find((x) => x.id === 'attn.q')!.detail.length).toBe(8)
  })

  it('frames a step around its unit and the bars it reads', () => {
    const f = scene.stops.find((s) => s.id === 'attn.scores')!.frame
    expect(f.cx).toBeGreaterThan(24); expect(f.cx).toBeLessThan(36)
    expect(f.hh).toBeLessThan(12)
  })

  it('is the same scene for the same input', () => {
    expect(layoutModelDiagramBlock(spec, values, start)).toEqual(scene)
  })

  it('draws the structure with flat tiles when there are no values', () => {
    const bare = layoutModelDiagramBlock(spec, null, start)
    expect(bare.stops).toHaveLength(17)
    expect(new Set(bare.grids.find((g) => g.key === 'x0')!.heights).size).toBe(1)
    expect(bare.labels.filter((l) => l.cls.startsWith('pill'))).toHaveLength(0)
  })
})

describe('layoutModelDiagramBlock on the tiny fixture', () => {
  it('lays out a model with no position table, no norm before its MLP and no softmax', () => {
    const dir = './fixtures/model-diagram-engine/tiny-gpt/'
    const p = parseModelSpecBlock(readFileSync(fileURLToPath(new URL(`${dir}tiny-gpt.model.yaml`, import.meta.url)), 'utf8'))
    if (!p.ok) throw new Error(JSON.stringify(p.problems))
    const scene = layoutModelDiagramBlock(p.value, null, start)
    expect(scene.stops.map((s) => s.chip)).toEqual(['Embedding', 'Layer norm', 'Query', 'Key', 'Value', 'Similarity + mask', 'Attention weights', 'Mix the values', 'Output layer',
      'Add to the stream', 'MLP layer 1 + GELU', 'MLP layer 2', 'Add to the stream', 'Score per word'])
    expect(scene.labels.some((l) => l.parts[0][1] === '1 more block')).toBe(true)
  })
})

describe('a batch of examples, and a bar opened as a table', () => {
  const dir = './fixtures/model-diagram-engine/tiny-gpt/'
  const p = parseModelSpecBlock(readFileSync(fileURLToPath(new URL(`${dir}tiny-gpt.model.yaml`, import.meta.url)), 'utf8'))
  if (!p.ok) throw new Error(JSON.stringify(p.problems))
  const block = (k: number) => Array.from({ length: 5 }, (_, r) => Array.from({ length: 8 }, (_, c) => k + r + c / 10))
  const values = {
    input: 'two', run_id: 'r', sha256: 's', tokens: ['a', 'b', 'c', 'd', 'e'], attention: {},
    slices: { x0: { shape: [2, 5, 8], rows: [block(1), block(100)] } },
  } as unknown as ModelValues

  it('draws the example the slider picks, and offers the slider only when there is more than one', () => {
    const first = layoutModelDiagramBlock(p.value, values, { ...start, example: 0, open: 'x0' })
    const second = layoutModelDiagramBlock(p.value, values, { ...start, example: 1, open: 'x0' })
    expect(first.examples).toEqual({ count: 2, index: 0 })
    expect(second.examples).toEqual({ count: 2, index: 1 })
    const cell = (sc: typeof first) => (sc.open!.find((x) => x.t === 'table') as { rows: { cells: string[] }[] }).rows[1].cells[1]
    expect(cell(first)).toBe('+1.00')
    expect(cell(second)).toBe('+100.00')
    expect(layoutModelDiagramBlock(p.value, null, start).examples).toBeNull()
  })

  it('lays the clicked bar out as a table with a row per token, and nothing when no bar is open', () => {
    const scene = layoutModelDiagramBlock(p.value, values, { ...start, open: 'x0' })
    const table = scene.open!.find((x) => x.t === 'table') as { rows: { cells: string[]; shade?: number[] }[] }
    expect(table.rows).toHaveLength(6)
    expect(table.rows[1].cells[0]).toBe('a')
    expect(table.rows[5].shade![8]).toBeGreaterThan(table.rows[1].shade![1])
    expect(layoutModelDiagramBlock(p.value, values, start).open).toBeNull()
  })
})

describe('layoutModelDiagramBlock on a model with two towers', () => {
  // A small vision-language model in the generator's shape: a vision tower, a hand-over, and a language model with a memory block and an attention block.
  const yaml = `
source: {model: test/tiny-vlm, revision: a, generator_commit: b, date: 2026-11-26}
axes: {batch: 1, tokens: 40, width: 64, patches: 100, v_width: 32, pixels: 48, vocab: 500, mem_heads: 4, mem_key: 8, heads: 4, head_width: 16}
tensors:
  - {id: pixels, axes: [patches, pixels], role: activation}
  - {id: ids, axes: [batch, tokens], role: activation}
  - {id: p.out, axes: [patches, v_width], role: activation}
  - {id: va.out, axes: [patches, v_width], role: activation}
  - {id: vadd.out, axes: [patches, v_width], role: activation}
  - {id: v_after, axes: [patches, v_width], role: activation}
  - {id: vn.out, axes: [patches, v_width], role: activation}
  - {id: vj.out, axes: [25, 128], role: activation}
  - {id: vl.out, axes: [25, 128], role: activation}
  - {id: vg.out, axes: [25, 128], role: activation}
  - {id: vl2.out, axes: [25, width], role: activation}
  - {id: e.out, axes: [batch, tokens, width], role: activation}
  - {id: j.out, axes: [batch, tokens, width], role: activation}
  - {id: m.out, axes: [batch, tokens, width], role: activation}
  - {id: madd.out, axes: [batch, tokens, width], role: activation}
  - {id: a_in, axes: [batch, tokens, width], role: activation}
  - {id: a.out, axes: [batch, tokens, width], role: activation}
  - {id: aadd.out, axes: [batch, tokens, width], role: activation}
  - {id: after, axes: [batch, tokens, width], role: activation}
  - {id: u.out, axes: [batch, tokens, vocab], role: activation}
ops:
  - {id: pic, kind: input, in: [], out: [pixels]}
  - {id: toks, kind: input, in: [], out: [ids]}
  - {id: p, name: Patch to row, kind: patchify, in: [pixels], out: [p.out]}
  - {id: va, kind: attention, in: [p.out], out: [va.out], mask: none, heads: 4, block: vis}
  - {id: vadd, kind: add, in: [p.out, va.out], out: [vadd.out], block: vis}
  - {id: vn, name: Layer norm before the hand-over, kind: norm, in: [v_after], out: [vn.out]}
  - {id: vj, name: Join four patches, kind: join, in: [vn.out], out: [vj.out]}
  - {id: vl, name: Hand-over layer 1, kind: linear, in: [vj.out], out: [vl.out]}
  - {id: vg, name: Bend, kind: act, in: [vl.out], out: [vg.out]}
  - {id: vl2, name: To the language model's width, kind: linear, in: [vg.out], out: [vl2.out]}
  - {id: e, kind: embed, in: [ids], out: [e.out]}
  - {id: j, name: Into the sequence, kind: join, in: [e.out, vl2.out], out: [j.out]}
  - {id: m, name: Running memory, kind: memory, in: [j.out], out: [m.out], state: [batch, mem_heads, mem_key, mem_key], block: mem}
  - {id: madd, kind: add, in: [j.out, m.out], out: [madd.out], block: mem}
  - {id: a, kind: attention, in: [a_in], out: [a.out], mask: causal, heads: 4, block: att}
  - {id: aadd, kind: add, in: [a_in, a.out], out: [aadd.out], block: att}
  - {id: u, kind: unembed, in: [after], out: [u.out]}
blocks:
  - {id: vis, name: Vision block, ops: [va, vadd], repeat: 3}
  - {id: mem, name: Memory block, ops: [m, madd], repeat: 6}
  - {id: att, name: Attention block, ops: [a, aadd], repeat: 2}
stream: [j.out, madd.out, a_in, aadd.out, after]
streams: {vision: [p.out, vadd.out, v_after]}
steps:
  - {id: p, text: The picture is cut into patches.}
  - {id: vis, text: The patches look at each other.}
  - {id: j, text: The picture's rows go in among the words.}
  - {id: m, text: A memory of fixed size is updated at every token.}
  - {id: a, text: Every fourth block is attention.}
  - {id: u, text: A score for every word.}
`
  const p = parseModelSpecBlock(yaml)
  if (!p.ok) throw new Error(JSON.stringify(p.problems))
  const scene = layoutModelDiagramBlock(p.value, null, start)
  const grid = (key: string) => scene.grids.find((g) => g.key === key)!
  const titles = scene.labels.filter((l) => l.cls.startsWith('grpl')).map((l) => l.parts[0][1])

  it('names its three regions', () => {
    expect(titles).toEqual(expect.arrayContaining(['VISION TOWER', 'HAND-OVER', 'LANGUAGE MODEL', 'MEMORY', 'ATTENTION']))
  })

  it('lays the language model out beside the vision tower, not on top of it', () => {
    const vision = ['p.out', 'va.out', 'vadd.out', 'vl2.out'].map((k) => grid(k).cx)
    expect(grid('e.out').cx).toBeGreaterThan(Math.max(...vision) + 30)
    expect(grid('e.out').cy).toBe(0)
  })

  it('gives the hand-over and each new block a row of its own', () => {
    expect(grid('vn.out').cy).toBeLessThan(grid('vadd.out').cy)
    expect(grid('after:mem').cy).toBeLessThan(grid('madd.out').cy)
    expect(grid('after:mem').cx).toBe(grid('e.out').cx)
  })

  it('collapses each kind of block, by name', () => {
    const ghosts = scene.labels.map((l) => l.parts[0][1]).filter((t) => t.includes(' more '))
    expect(ghosts).toEqual(['2 more vision blocks', '5 more memory blocks', '1 more attention block'])
  })

  it('opens the memory into its own steps, with one small square per head', () => {
    const parts = scene.stops.filter((x) => x.opId === 'm').map((x) => x.part)
    expect(parts).toEqual(['q', 'k', 'v', 'state', 'read', 'out'])
    const bank = scene.grids.find((g) => g.key === 'm.state')!
    expect([bank.nR, bank.nC]).toEqual([2, 16])
    expect(scene.labels.some((l) => l.parts[0][1] === '4 x 8 x 8')).toBe(true)
  })

  it('brings the picture across to the join', () => {
    expect(scene.labels.some((l) => l.parts[0][1] === 'the picture’s rows go in among the words')).toBe(true)
    expect(scene.rods.some((r) => r.color === 'bar' && r.r === 0.07 && r.a[0] !== r.b[0] && r.a[1] === r.b[1])).toBe(true)
  })

  it('draws no pillar: every bar and every ruler stays within a few units', () => {
    for (const g of scene.grids) { expect(g.w).toBeLessThanOrEqual(4.9); expect(g.h).toBeLessThanOrEqual(4.9) }
    for (const r of scene.rods.filter((x) => x.color === 'bar' && x.r === 0.06)) expect(Math.abs(r.b[0] - r.a[0])).toBeLessThanOrEqual(12)
  })
})

describe('every head\'s similarity scores (attention_scores)', () => {
  const scoresStop = () => layoutModelDiagramBlock(spec, values, start).stops.find((s) => s.part === 'scores')!
  const grid = (v: ModelValues, head: number) => {
    const st = scoresStop()
    return layoutModelDiagramBlock(spec, v, { ...start, focus: st.id, head }).grids.find((g) => g.key === st.id)!
  }
  it('without them, the picker is not offered at the scores step and the bar stays on head 1', () => {
    const bare = { ...values, attention_scores: undefined } as ModelValues
    const st = scoresStop()
    expect(layoutModelDiagramBlock(spec, bare, { ...start, focus: st.id, head: 3 }).heads).toBeNull()
    expect(grid(bare, 3).heights).toEqual(grid(bare, 0).heights)
  })
  it('with them, the picker is offered and another head draws its own numbers', () => {
    const st = scoresStop(), T = values.tokens.length
    // head 3's scores: a ramp, masked above the diagonal as the file writes it
    const rows = Array.from({ length: T }, (_, r) => Array.from({ length: T }, (_, c) => (c > r ? -1e9 : (r + 1) * 0.5 - c)))
    const withScores = { ...values, attention_scores: { [st.opId]: { '3': rows } } } as ModelValues
    const scene = layoutModelDiagramBlock(spec, withScores, { ...start, focus: st.id, head: 3 })
    expect(scene.heads?.head).toBe(3)
    expect(grid(withScores, 3).heights).not.toEqual(grid(withScores, 0).heights)
    expect(scene.grids.find((g) => g.key === st.id)!.heights.some((h) => h > 0.05)).toBe(true)
  })
})

describe('each head\'s own Q/K/V columns (attention_heads)', () => {
  const stopOf = (part: string) => layoutModelDiagramBlock(spec, values, start).stops.find((s) => s.part === part)!
  const T = values.tokens.length
  const sq = Array.from({ length: T }, (_, r) => Array.from({ length: T }, (_, c) => (c > r ? -1e9 : (r + 1) * 0.5 - c)))
  const cols = (seed: number) => Array.from({ length: T }, (_, r) => Array.from({ length: 8 }, (_, c) => Math.sin(seed + r * 1.3 + c)))
  it('without them, another head shows its score but no products; with them, the products are that head\'s', () => {
    const st = stopOf('scores')
    const scoresOnly = { ...values, attention_scores: { [st.opId]: { '3': sq } } } as ModelValues
    const a = layoutModelDiagramBlock(spec, scoresOnly, { ...start, focus: st.id, head: 3 })
    expect(a.stops.find((s) => s.id === st.id)!.detail.length).toBe(0)
    const both = { ...scoresOnly, attention_heads: { [st.opId]: { '3': { q: cols(1), k: cols(2), v: cols(3) } } } } as ModelValues
    const b = layoutModelDiagramBlock(spec, both, { ...start, focus: st.id, head: 3 })
    expect(b.stops.find((s) => s.id === st.id)!.detail.length).toBeGreaterThan(0)
    const q = `${st.opId}.q`
    expect(b.grids.find((g) => g.key === q)!.heights).not.toEqual(a.grids.find((g) => g.key === q)!.heights)
    expect(b.labels.some((l) => l.parts.some((p) => p[1].includes('head 4’s columns')))).toBe(true)
  })
})
