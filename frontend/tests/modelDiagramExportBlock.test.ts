import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseModelSpecBlock, type ModelSpec } from '../src/services/lego_blocks/units/modelDiagramFormatBlock'
import { buildModelDiagramHtmlBlock, modelDiagramExportFileNameBlock, scriptSafeBlock } from '../src/services/lego_blocks/units/modelDiagramExportBlock'

const TINY = join(__dirname, 'fixtures/model-diagram-engine/tiny-gpt')
const parsed = parseModelSpecBlock(readFileSync(join(TINY, 'tiny-gpt.model.yaml'), 'utf8'))
const spec = (parsed.ok ? parsed.value : null) as ModelSpec

const build = (engineJs: string, step = 2) => buildModelDiagramHtmlBlock({
  title: 'Tiny <GPT>', eyebrow: 'llm · test/tiny-gpt', engineJs, spec, inputs: ['hello'],
  values: { hello: { input: 'hello', run_id: 'r', sha256: 's', tokens: ['</script><b>'], slices: {}, attention: {} } },
  step, proseHtml: '<p>We draw a language model.</p>', footnote: 'test',
})

describe('buildModelDiagramHtmlBlock', () => {
  it('inlines the engine, the spec, the values and the prose in one page', () => {
    const html = build('window.ModelDiagram={mountModelDiagram:function(){return{setStep:function(){}}}}')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Tiny &lt;GPT&gt;</title>')
    expect(html).toContain('<p>We draw a language model.</p>')
    expect(html).toContain('window.ModelDiagram={mountModelDiagram')
    expect(html).not.toMatch(/<script[^>]+src=/)
    const data = /<script id="model-diagram-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]
    const back = JSON.parse(data)
    expect(back.step).toBe(2)
    expect(back.spec.steps).toHaveLength(5)
    expect(back.values.hello.tokens[0]).toBe('</script><b>')
  })

  it('keeps an engine bundle from closing its script element', () => {
    expect(scriptSafeBlock('a="</script>"; b="<!--"')).toBe('a="<\\/script>"; b="<\\!--"')
    const html = build('var s="</script><p>escaped</p>"')
    expect(html.match(/<\/script>/g)).toHaveLength(3)
  })

  it('runs the page script: mounts the engine with the spec and the step from the address', () => {
    const html = build('window.ModelDiagram={mountModelDiagram:function(el,p){window.mounted=p;return{setStep:function(){}}}}')
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
    const data = /<script id="model-diagram-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]
    const win: Record<string, unknown> = { addEventListener: () => {} }
    const doc = { getElementById: (id: string) => id === 'model-diagram-data' ? { textContent: data } : { id } }
    for (const script of scripts) new Function('window', 'document', 'location', 'history', script)(win, doc, { hash: '#step-4:query' }, { replaceState: () => {} })
    expect(win.mounted).toMatchObject({ step: 4, part: 'query', inputs: ['hello'] })
  })

  it('stores shared weights once and merges them back into every input on load', () => {
    const shared = { shape: [8, 32], rows: [[0.5]] }
    const own = { shape: [8, 32], rows: [[7]] }
    const html = buildModelDiagramHtmlBlock({
      title: 't', eyebrow: 'e', engineJs: 'window.ModelDiagram={mountModelDiagram:function(el,p){window.mounted=p;return{setStep:function(){}}}}',
      spec, inputs: ['a', 'b'], step: 0, proseHtml: '', footnote: '',
      values: {
        a: { input: 'a', run_id: 'r', sha256: 's', tokens: [], slices: { w_up: shared }, attention: {} },
        b: { input: 'b', run_id: 'r', sha256: 's', tokens: [], slices: { w_up: own }, attention: {} },
      },
      weightSlices: { w_up: shared },
    })
    const data = /<script id="model-diagram-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]
    expect(data.match(/"rows":\[\[0\.5\]\]/g)).toHaveLength(1)
    const win: Record<string, any> = { addEventListener: () => {} }
    const doc = { getElementById: (id: string) => id === 'model-diagram-data' ? { textContent: data } : { id } }
    for (const script of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])) new Function('window', 'document', 'location', 'history', script)(win, doc, { hash: '' }, { replaceState: () => {} })
    expect(win.mounted.values.a.slices.w_up.rows).toEqual([[0.5]])
    expect(win.mounted.values.b.slices.w_up.rows).toEqual([[7]])
  })

  it('names the file after the model', () => {
    expect(modelDiagramExportFileNameBlock('qwen3.5-9b')).toBe('qwen3.5-9b-model.html')
  })
})
