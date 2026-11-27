// One self-contained HTML file for a model diagram: the engine's bundle (with
// three.js), the spec, every input's values and the prose, all inline, so the
// file opens from a plain folder with no app. The engine draws what it draws
// here exactly as in the app; this only packages it. Pure: the caller hands
// in the bundle's text and the prose already rendered.

import type { ModelSpec, ModelValueSliceBlock, ModelValues } from './modelDiagramFormatBlock'

/**
 * Take the shared weight slices back out of each input's merged values, so the
 * file holds them once. A slice is the shared one when it is the very object
 * the merge copied in; an input's own slice of the same name stays.
 */
export function splitSharedWeightsBlock(values: Record<string, ModelValues>, weightSlices: Record<string, ModelValueSliceBlock>): Record<string, ModelValues> {
  return Object.fromEntries(Object.entries(values).map(([input, value]) => [input, {
    ...value,
    slices: Object.fromEntries(Object.entries(value.slices).filter(([id, slice]) => weightSlices[id] !== slice)),
  }]))
}

export interface ModelDiagramExportInputBlock {
  title: string
  /** "llm · gpt-2", shown above the title. */
  eyebrow: string
  /** The engine's IIFE bundle; defines the global `ModelDiagram.mountModelDiagram`. */
  engineJs: string
  spec: ModelSpec
  inputs: string[]
  /** Every input's values, weights already merged in (as the app hands them to the engine). */
  values: Record<string, ModelValues>
  /** The model's shared weight slices; stored once in the file and merged back into each input on load. */
  weightSlices?: Record<string, ModelValueSliceBlock>
  step: number
  /** The model page's and kind page's prose, already rendered to HTML. */
  proseHtml: string
  /** The source and export date, for the foot of the page. */
  footnote: string
}

/** Text safe inside a <script> element: nothing in it can close the element. */
export function scriptSafeBlock(text: string): string {
  return text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}

/** JSON safe inside a <script> element. */
export function scriptJsonBlock(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Enough of the app's reading style for the prose to read the same.
const PAGE_CSS = `
:root { color-scheme: light dark; --fg: #1c1c1e; --muted: #6b6b70; --border: #e3e3e6; --bg: #fff; --code: #f3f3f5; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececee; --muted: #9a9aa0; --border: #2e2e33; --bg: #141416; --code: #222226; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 32px 32px 96px; }
.eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 0; }
h1 { font-family: ui-serif, "New York", "Iowan Old Style", Charter, Georgia, serif; font-weight: 400; font-size: 40px; line-height: 1.08; margin: 4px 0 24px; }
#model-diagram { width: 100%; }
.prose { max-width: 700px; margin-top: 40px; font-family: ui-serif, "New York", "Iowan Old Style", Charter, Georgia, serif; font-size: 16.5px; line-height: 1.7; }
.prose h2 { font-size: 22px; font-weight: 400; margin: 2em 0 .4em; }
.prose h3 { font-size: 18px; font-weight: 600; margin: 1.6em 0 .3em; }
.prose code { font: 13px ui-monospace, Menlo, monospace; background: var(--code); padding: 0 4px; border-radius: 4px; }
.prose table { border-collapse: collapse; font-family: -apple-system, sans-serif; font-size: 14px; }
.prose td, .prose th { border: 1px solid var(--border); padding: 4px 8px; }
.prose section + section { border-top: 1px solid var(--border); margin-top: 48px; padding-top: 8px; }
.prose a { color: inherit; }
footer { margin-top: 64px; color: var(--muted); font-size: 12px; }
`

export function buildModelDiagramHtmlBlock(input: ModelDiagramExportInputBlock): string {
  const weights = input.weightSlices ?? {}
  const data = { spec: input.spec, inputs: input.inputs, values: splitSharedWeightsBlock(input.values, weights), weights, step: input.step }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<p class="eyebrow">${escapeHtml(input.eyebrow)}</p>
<h1>${escapeHtml(input.title)}</h1>
<div id="model-diagram"></div>
<div class="prose">${input.proseHtml}</div>
<footer>${escapeHtml(input.footnote)}</footer>
</main>
<script id="model-diagram-data" type="application/json">${scriptJsonBlock(data)}</script>
<script>${scriptSafeBlock(input.engineJs)}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('model-diagram-data').textContent);
  Object.keys(data.values).forEach(function (input) {
    data.values[input].slices = Object.assign({}, data.weights, data.values[input].slices);
  });
  var fromHash = /^#step-(\\d+)(?::(.+))?$/.exec(location.hash);
  var step = fromHash ? Number(fromHash[1]) : data.step;
  var part = fromHash && fromHash[2] ? decodeURIComponent(fromHash[2]) : undefined;
  var view = window.ModelDiagram.mountModelDiagram(document.getElementById('model-diagram'), {
    spec: data.spec, inputs: data.inputs, values: data.values, step: step, part: part,
    onStep: function (n, p) { history.replaceState(null, '', '#step-' + n + (p ? ':' + encodeURIComponent(p) : '')); }
  });
  window.addEventListener('hashchange', function () {
    var m = /^#step-(\\d+)(?::(.+))?$/.exec(location.hash);
    if (m) view.setStep(Number(m[1]), m[2] ? decodeURIComponent(m[2]) : undefined);
  });
})();
</script>
</body>
</html>
`
}

/** A file name for the export: `gpt-2-model.html`. */
export function modelDiagramExportFileNameBlock(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9._-]+/g, '-')}-model.html`
}
