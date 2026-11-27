import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  modelTargetNameBlock,
  modelViewSearchBlock,
  parseModelSpecBlock,
  parseModelStepPointerBlock,
  parseModelValuesBlock,
  parseModelWeightsBlock,
  type ModelSpec,
} from '../src/services/lego_blocks/units/modelDiagramFormatBlock'

const TINY = join(__dirname, 'fixtures/model-diagram-engine/tiny-gpt')
const tinySource = readFileSync(join(TINY, 'tiny-gpt.model.yaml'), 'utf8')

const tiny = (): ModelSpec => {
  const result = parseModelSpecBlock(tinySource)
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.value
}

const problemsOf = (source: string): string[] => {
  const result = parseModelSpecBlock(source)
  return result.ok ? [] : result.problems.map(p => `${p.at}: ${p.message}`)
}

describe('parseModelSpecBlock', () => {
  it('reads a spec that connects', () => {
    const spec = tiny()
    expect(spec.source.model).toBe('test/tiny-gpt')
    expect(spec.axes.width).toBe(8)
    expect(spec.ops.find(op => op.id === 'attn')).toMatchObject({ kind: 'attention', mask: 'causal', heads: 2, kv_heads: 2, block: 'layer' })
    expect(spec.blocks[0]).toMatchObject({ id: 'layer', repeat: 2 })
    expect(spec.stream).toEqual(['x0', 'x1', 'x2'])
    expect(spec.steps).toHaveLength(5)
    expect(spec.steps[0]).toEqual({ id: 'embed', text: 'Each token becomes a row of eight numbers.' })
  })

  it('keeps the plain names on ops, blocks and steps', () => {
    const named = tinySource
      .replace('{id: ln1, kind: norm,', '{id: ln1, name: Layer norm, kind: norm,')
      .replace('{id: layer, ops:', '{id: layer, name: Block, ops:')
      .replace('- {id: embed, text:', '- {id: embed, name: Embedding, text:')
    const result = parseModelSpecBlock(named)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ops.find(op => op.id === 'ln1')!.name).toBe('Layer norm')
    expect(result.value.blocks[0].name).toBe('Block')
    expect(result.value.steps[0]).toEqual({ id: 'embed', name: 'Embedding', text: 'Each token becomes a row of eight numbers.' })
  })

  it('refuses an unknown kind by name', () => {
    expect(problemsOf(tinySource.replace('kind: mlp', 'kind: feedforward')))
      .toContainEqual(expect.stringContaining('The kind "feedforward" is not one of the known kinds'))
  })

  it('refuses a missing tensor by name', () => {
    expect(problemsOf(tinySource.replace('in: [x1], out: [m1]', 'in: [x9], out: [m1]')))
      .toContainEqual('ops[5] mlp: "in" names the tensor "x9", which is not in tensors.')
  })

  it('refuses a shape that disagrees', () => {
    const bad = tinySource.replace('{id: a1, axes: [batch, tokens, width]', '{id: a1, axes: [batch, tokens, head_width]')
    expect(problemsOf(bad)).toContainEqual(expect.stringContaining('A add keeps its shape, but x0 [batch, tokens, width] and a1 [batch, tokens, head_width] disagree.'))
  })

  it('refuses an axis the model does not have', () => {
    expect(problemsOf(tinySource.replace('{id: m1, axes: [batch, tokens, width]', '{id: m1, axes: [batch, tokens, depth]')))
      .toContainEqual(expect.stringContaining('The axis "depth" is not one of the model\'s axes.'))
  })

  it('refuses a step naming no id, and one naming an id that is not there', () => {
    expect(problemsOf(tinySource.replace('- {id: mlp, text:', '- {text:'))).toContainEqual('steps[2]: Step 3 names no id.')
    expect(problemsOf(tinySource.replace('- {id: mlp, text:', '- {id: ffn, text:')))
      .toContainEqual('steps[2]: Step 3 names "ffn", which is neither an op nor a block.')
  })

  it('refuses a block naming an op that is not there, and a weight that is an activation', () => {
    expect(problemsOf(tinySource.replace('ops: [ln1, attn,', 'ops: [ln0, attn,'))).toContainEqual(expect.stringContaining('"ln0", which is not in ops'))
    expect(problemsOf(tinySource.replace('weights: [w_up]', 'weights: [x1]'))).toContainEqual(expect.stringContaining('"weights" names "x1", whose role is activation.'))
  })

  it('checks other towers\' streams on their own', () => {
    const withVision = `${tinySource}streams:\n  vision: [ids]\n`
    expect(problemsOf(withVision)).toEqual([])
    const wide = tinySource.replace('{id: logits, axes: [batch, tokens, vocab], role: activation}', '{id: logits, axes: [batch, tokens, vocab], role: activation}\n  - {id: v0, axes: [batch, patches, 6], role: activation}\n  - {id: v1, axes: [batch, patches, 7], role: activation}').replace('vocab: 50}', 'vocab: 50, patches: 4}')
    expect(problemsOf(`${wide}streams:\n  vision: [v0, v1]\n`)).toContainEqual(expect.stringContaining('streams.vision: The stream changes width between v0'))
    expect(problemsOf(`${wide}streams:\n  vision: [v0, w_up]\n`)).toContainEqual('streams.vision: The stream names "w_up", which is a weight.')
    const parsed = parseModelSpecBlock(`${wide}streams:\n  vision: [v0]\n`)
    expect(parsed.ok && parsed.value.streams).toEqual({ vision: ['v0'] })
  })

  it('refuses YAML that does not parse', () => {
    expect(problemsOf('axes: [')[0]).toMatch(/^file: The YAML does not parse/)
  })
})

describe('parseModelValuesBlock', () => {
  const source = readFileSync(join(TINY, 'values/hello.json'), 'utf8')

  it('reads values that match the spec', () => {
    const result = parseModelValuesBlock(source, 'hello', tiny())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ input: 'hello', run_id: 'run-001', reply: ' mat' })
    expect(result.value.tokens).toHaveLength(5)
    expect(result.value.slices.x0.shape).toEqual([1, 5, 8])
  })

  it('passes on the picture\'s rows, the other heads\' last rows, and an op\'s bend', () => {
    const more = { ...JSON.parse(source), picture: { first_row: 1, last_row: 3, name: 'dots' }, attention_last_row: { attn: { 1: [0.1, 0.2, 0.7] } }, attention_last_row_every: 2 }
    const result = parseModelValuesBlock(JSON.stringify(more), 'hello', tiny())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.picture).toMatchObject({ first_row: 1, last_row: 3 })
    expect(result.value.attention_last_row?.attn['1']).toEqual([0.1, 0.2, 0.7])
    expect(result.value.attention_last_row_every).toBe(2)
    const spec = parseModelSpecBlock(tinySource.replace('{id: mlp, kind: mlp,', '{id: mlp, kind: mlp, act: SiLU, gated: true,'))
    expect(spec.ok && spec.value.ops.find(op => op.id === 'mlp')).toMatchObject({ act: 'SiLU', gated: true })
  })

  it('refuses a slice of a tensor the spec does not have, or of the wrong width', () => {
    const wrong = JSON.parse(source)
    wrong.slices.x9 = { shape: [1, 5, 8], rows: [] }
    wrong.slices.x0.shape = [1, 5, 16]
    wrong.attention.mlp = { 0: [[1]] }
    const result = parseModelValuesBlock(JSON.stringify(wrong), 'hello', tiny())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map(p => p.message)).toEqual(expect.arrayContaining([
      'The slice names "x9", which is neither a tensor nor a part of an op in the spec.',
      'Axis width is 16 here and 8 in the spec.',
      '"mlp" is not an attention op in the spec.',
    ]))
  })

  it('accepts the engine\'s fixed names for an op\'s inner parts, and the optional extras', () => {
    const inner = JSON.parse(source)
    inner.slices['attn.q'] = { shape: [1, 5, 8], rows: [[0]] }
    inner.slices['attn.q.weight'] = { shape: [8, 8], rows: [[0]] }
    inner.slices['unembed.top'] = { shape: [5], rows: [] }
    inner.token_ids = [1, 2, 3, 4, 5]
    const result = parseModelValuesBlock(JSON.stringify(inner), 'hello', tiny())
    expect(result.ok ? [] : result.problems).toEqual([])
    if (!result.ok) return
    expect(Object.keys(result.value.slices)).toEqual(expect.arrayContaining(['attn.q', 'attn.q.weight', 'unembed.top']))
    expect(result.value.token_ids).toHaveLength(5)
    inner.slices['ffn.up'] = { shape: [1], rows: [] }
    expect(parseModelValuesBlock(JSON.stringify(inner), 'hello', tiny()).ok).toBe(false)
  })

  it('passes the generator\'s extras through, and chosen rows with their row numbers', () => {
    const extra = JSON.parse(source)
    Object.assign(extra, {
      prompt_tokens: 4,
      labels: { 'unembed.top': ['a', 'b'] },
      row_stats: { x0: { mean: [0], sd: [1], rms: [1] }, after_blocks: { rms: [1] } },
      top_by_pass: [{ 'unembed.top': [[1]], labels: ['a'] }],
    })
    extra.slices.x0.row_ids = [0, 4]
    extra.attention.attn['1'] = { rows: [[1]], row_ids: [4] }
    const result = parseModelValuesBlock(JSON.stringify(extra), 'hello', tiny())
    expect(result.ok ? [] : result.problems).toEqual([])
    if (!result.ok) return
    expect(result.value).toMatchObject({ prompt_tokens: 4, labels: { 'unembed.top': ['a', 'b'] }, top_by_pass: [{ labels: ['a'] }] })
    expect(result.value.row_stats!.after_blocks.rms).toEqual([1])
    expect(result.value.slices.x0.row_ids).toEqual([0, 4])
    expect(result.value.attention.attn['1']).toEqual([[1]])
    expect(result.value.attention_row_ids).toEqual({ attn: { 1: [4] } })
    extra.slices.x0.row_ids = [0, 4, 5]
    expect(parseModelValuesBlock(JSON.stringify(extra), 'hello', tiny()).ok).toBe(false)
  })

  it('checks weights.json: weights only, within 32 x 32', () => {
    const ok = { run_id: 'r', sha256: 's', slices: { w_up: { shape: [8, 32], rows: [[0.5]] }, 'attn.q.weight': { shape: [8, 8], rows: [[1]] } } }
    expect(parseModelWeightsBlock(JSON.stringify(ok), tiny()).ok).toBe(true)
    const activation = { ...ok, slices: { ...ok.slices, x0: { shape: [1, 5, 8], rows: [[1]] } } }
    const refused = parseModelWeightsBlock(JSON.stringify(activation), tiny())
    expect(refused.ok ? [] : refused.problems.map(p => p.message)).toEqual(['"x0" is not a weight; weights.json holds weights only (activations belong in values/).'])
    const big = { ...ok, slices: { w_up: { shape: [8, 32], rows: Array.from({ length: 33 }, () => [0]) } } }
    expect(parseModelWeightsBlock(JSON.stringify(big), tiny()).ok).toBe(false)
  })

  it('keeps col_ids on an attention slice on chosen tokens', () => {
    const chosen = JSON.parse(source)
    chosen.slices['attn.scores'] = { shape: [1, 2, 5, 5], rows: [[1, 2], [3, 4]], row_ids: [1, 4], col_ids: [1, 4] }
    const result = parseModelValuesBlock(JSON.stringify(chosen), 'hello', tiny())
    expect(result.ok && result.value.slices['attn.scores']).toMatchObject({ row_ids: [1, 4], col_ids: [1, 4] })
  })

  it('refuses values that cannot be traced to a run', () => {
    const result = parseModelValuesBlock('{"tokens": []}', 'hello', tiny())
    expect(result.ok).toBe(false)
  })
})

describe('step pointers and model targets', () => {
  it('reads a step pointer on its own line', () => {
    expect(parseModelStepPointerBlock('[[qwen3.5-9b.model#step-26]]')).toEqual({ model: 'qwen3.5-9b', step: 26 })
    expect(parseModelStepPointerBlock('  [[vlm/qwen3.5-9b.model#step-3|the mask]] ')).toEqual({ model: 'qwen3.5-9b', step: 3 })
    expect(parseModelStepPointerBlock('[[qwen3.5-9b#step-26]]')).toBeNull()
    expect(parseModelStepPointerBlock('see [[gpt-2.model#step-2]]')).toBeNull()
  })

  it('names a model from a target', () => {
    expect(modelTargetNameBlock('gpt-2.model')).toBe('gpt-2')
    expect(modelTargetNameBlock('model-diagrams/llm/gpt-2/gpt-2.model')).toBe('gpt-2')
    expect(modelTargetNameBlock('gpt-2')).toBeNull()
  })

  it('writes the full view address', () => {
    expect(modelViewSearchBlock('a/b.model.yaml', 3, 'query')).toBe('?model=a%2Fb.model.yaml&step=3&part=query')
    expect(modelViewSearchBlock('a/b.model.yaml', 0)).toBe('?model=a%2Fb.model.yaml')
  })
})
