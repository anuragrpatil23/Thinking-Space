#!/usr/bin/env node
// The model-diagram engine's own check, run in a headless Chrome with no test
// framework: it draws a model at every step in light and dark, saves a
// screenshot of each, reports any labels that overlap, and prints the
// performance numbers (first frame, frame time while flying, draw calls,
// triangles, and memory across ten open-and-close rounds).
//
//   node scripts/model-diagram-check.mjs [--spec <model.yaml>] [--values <input.json>] [--weights <weights.json>] [--name <label>]
//        [--ref <reference.html>] [--out <dir>] [--chrome <binary>]
//
// With --ref (the hand-built gpt-with-sparse-network.html) the reference page is
// shot at the same steps and size, for a side-by-side diff
// (scripts/model-diagram-diff.py). Output goes to frontend/tests/.model-diagram-check/, which is
// not committed.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '..')
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const specPath = resolve(arg('spec', join(frontend, 'tests/fixtures/model-diagram-engine/gpt-2.model.yaml')))
const valuesPath = resolve(arg('values', join(frontend, 'tests/fixtures/model-diagram-engine/values/sky.json')))
const weightsPath = arg('weights', join(dirname(dirname(valuesPath)), 'weights.json'))
const refPath = arg('ref', '')
const name = arg('name', 'gpt-2')
const outDir = resolve(arg('out', join(frontend, 'tests/.model-diagram-check', name)))
// --size 920,700 shoots in a smaller window than the reference's 1500 x 1000
const [W, H] = arg('size', '1500,1000').split(',').map(Number)
// --app shoots the look the engine has inside the app (the app's colours stood in for); --steps 0,24 shoots only those steps; --themes dark only that theme; --quick skips the performance run.
const onlySteps = arg('steps', '') ? arg('steps', '').split(',').map(Number) : null
const themes = arg('themes', 'dark,light').split(',')
const quick = process.argv.includes('--quick')

function findChrome() {
  const given = arg('chrome', process.env.CHROME_BIN ?? '')
  if (given) return given
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (existsSync(cache)) for (const d of readdirSync(cache).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const p = join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
  const app = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(app)) return app
  throw new Error('No Chrome found. Pass --chrome <binary>.')
}

// ---- the page under test: the engine's mount, bundled with a spec and its values
const work = mkdtempSync(join(tmpdir(), 'model-diagram-check-'))
const require = createRequire(join(frontend, 'package.json'))
const esbuild = require('esbuild')
writeFileSync(join(work, 'entry.ts'), `
import { mountModelDiagram } from ${JSON.stringify(join(frontend, 'src/services/lego_blocks/integrations/modelDiagramMountBlock.ts'))}
import { parseModelSpecBlock } from ${JSON.stringify(join(frontend, 'src/services/lego_blocks/units/modelDiagramFormatBlock.ts'))}
const w = window as any
const p = parseModelSpecBlock(w.__SPEC__)
if (!p.ok) throw new Error(JSON.stringify(p.problems))
w.__mount = () => {
  w.__ready = null
  w.__md = mountModelDiagram(document.getElementById('host')!, {
    spec: p.value, inputs: w.__VALUES__ ? ['input'] : [], step: 0, appearance: w.__APP__ ? 'app' : 'page',
    loadValues: async () => { w.__valuesAt = performance.now(); return w.__VALUES__ },
    onReady: (i: any) => { w.__ready = i },
  })
}
w.__mount()
`)
await esbuild.build({ entryPoints: [join(work, 'entry.ts')], bundle: true, format: 'iife', minify: true, outfile: join(work, 'bundle.js'), logLevel: 'warning' })
// An input's values, with the model's weights.json (written once per model) merged in, as the app gives them to the engine.
const valuesJson = () => {
  if (!existsSync(valuesPath)) return 'null'
  const v = JSON.parse(readFileSync(valuesPath, 'utf8'))
  if (existsSync(weightsPath)) v.slices = { ...JSON.parse(readFileSync(weightsPath, 'utf8')).slices, ...v.slices }
  return JSON.stringify(v)
}
const page = (theme) => `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<style>body{margin:0;background:${theme === 'dark' ? '#0f1218' : '#f6f7f9'}}.wrap{max-width:1642px;margin:0 auto;padding-inline:19px;padding-block:24px 56px}</style></head>
<body><main class="wrap"><div id="host"></div></main>
${process.argv.includes('--app') ? '<style>:root{--background:240 14% 97%;--foreground:0 0% 9%;--card:0 0% 100%;--muted-foreground:0 0% 45%;--border:0 0% 90%;--muted:0 0% 94%;--primary:0 0% 9%;--primary-foreground:0 0% 100%}body{background:hsl(var(--background))}</style><script>window.__APP__=1</script>' : ''}<script>window.__SPEC__=${JSON.stringify(readFileSync(specPath, 'utf8'))};window.__VALUES__=${valuesJson()}</script>
<script src="/bundle.js"></script></body></html>`
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/engine') { res.setHeader('content-type', 'text/html'); res.end(page(url.searchParams.get('theme') ?? 'light')) }
  else if (url.pathname === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(join(work, 'bundle.js'))) }
  else if (url.pathname === '/ref' && refPath) { res.setHeader('content-type', 'text/html'); res.end(readFileSync(refPath)) }
  else { res.statusCode = 404; res.end() }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

// ---- Chrome, driven over its debugging socket
const profile = join(work, 'profile')
const chrome = spawn(findChrome(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--force-device-scale-factor=2',
  '--hide-scrollbars', '--no-first-run', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((ok, bad) => {
  let buf = ''
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) ok(m[1]) })
  chrome.on('exit', () => bad(new Error(`Chrome exited early:\n${buf}`)))
  setTimeout(() => bad(new Error('Chrome did not start in 20 s')), 20000)
})
const port = new URL(wsUrl).port
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let seq = 0
const waiting = new Map()
const errors = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && waiting.has(msg.id)) { const [ok, bad] = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? bad(new Error(msg.error.message)) : ok(msg.result) }
  else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
}
const cdp = (method, params = {}) => new Promise((ok, bad) => { const id = ++seq; waiting.set(id, [ok, bad]); ws.send(JSON.stringify({ id, method, params })) })
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (expression, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expression)) return; await sleep(50) } throw new Error(`timed out waiting for ${expression}`) }
await cdp('Page.enable'); await cdp('Runtime.enable')
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
const go = async (url) => { await cdp('Page.navigate', { url }); await until('document.readyState === "complete"') }
const motion = (reduce) => cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] })
const shot = async (selector, file) => {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } })()`)
  await sleep(120)
  const png = await cdp('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 }, captureBeyondViewport: true })
  writeFileSync(file, Buffer.from(png.data, 'base64'))
}
// Wait for the fonts, then put the stage on a whole pixel so two pages can be compared pixel for pixel.
const settle = async () => {
  await js('document.fonts.ready.then(() => 1)'); await sleep(300)
  await js(`(() => { const e = document.querySelector('.stageframe'); const y = e.getBoundingClientRect().y + scrollY; e.style.marginTop = (Math.ceil(y) - y) + 'px'; window.dispatchEvent(new Event('resize')) })()`)
  await sleep(300)
}
const pad = (n) => String(n).padStart(2, '0')

mkdirSync(outDir, { recursive: true })
const report = { model: name, shots: outDir, overlaps: {}, perf: {}, errors }
try {
  // ---- every step, light and dark, with motion off so a shot is the settled picture
  await motion(true)
  let stopCount = 0
  for (const theme of themes) {
    await go(`${base}/engine?theme=${theme}`)
    await until('window.__ready && window.__valuesAt'); await settle()
    stopCount = await js('document.querySelectorAll(".mdg .strip .chips button").length - 1')
    for (let n = 0; n <= stopCount; n++) {
      if (onlySteps && !onlySteps.includes(n)) continue
      await js(`document.querySelectorAll(".mdg .strip .chips button")[${n}].click()`); await sleep(350)
      await shot('.mdg .stageframe', join(outDir, `engine-${theme}-${pad(n)}.png`))
      const over = await js(`(() => { const r = window.__md.labelRects(), out = []; for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++) { const p = r[a], q = r[b]; const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0); const idx = p.text.length <= 16 && q.text.length <= 16; /* row names and table indices: their line boxes touch, their letters do not, as on the reference */ if (ox > 1 && oy > (idx ? 6 : 1)) out.push(p.text.slice(0, 28) + ' | ' + q.text.slice(0, 28)) } return out })()`)
      if (over.length) report.overlaps[`${theme}-${pad(n)}`] = over
    }
    // full screen (headless Chrome refuses the display's own, so this is the laid-over form): the drawing alone, then with the side panel
    if (!onlySteps || onlySteps.includes(0)) {
      const press = (text) => js(`[...document.querySelectorAll(".mdg button")].find((b) => b.textContent === ${JSON.stringify(text)}).click()`)
      const n = Math.min(7, stopCount)
      await js(`document.querySelectorAll(".mdg .strip .chips button")[${n}].click()`); await sleep(500)
      // the whole page as it sits in the app: controls, navigator, drawing, cards
      await shot('.mdg', join(outDir, `engine-${theme}-page.png`))
      // the numbers that open over the drawing when asked for (the app look only)
      if (await js(`!!document.querySelector(".mdg.app")`)) {
        await js(`document.querySelectorAll(".mdg .strip .chips button")[3].click()`); await sleep(900)
        await js(`[...document.querySelectorAll(".mdg .viewbtns button")].find((b) => b.textContent === 'Numbers')?.click()`); await sleep(1400)
        await shot('.mdg', join(outDir, `engine-${theme}-pop.png`))
        await js(`[...document.querySelectorAll(".mdg .viewbtns button")].find((b) => b.textContent === 'Numbers')?.click()`)
        await js(`document.querySelectorAll(".mdg .strip .chips button")[${n}].click()`); await sleep(500)
      }
      await press('Full screen'); await sleep(700)
      await shot('.mdg', join(outDir, `engine-${theme}-full.png`))
      await press('Notes'); await sleep(700)
      await shot('.mdg', join(outDir, `engine-${theme}-full-notes.png`))
      const over = await js(`(() => { const r = window.__md.labelRects(), out = []; for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++) { const p = r[a], q = r[b]; const idx = p.text.length <= 16 && q.text.length <= 16; const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0); if (ox > 1 && oy > (idx ? 6 : 1)) out.push(p.text.slice(0, 28) + ' | ' + q.text.slice(0, 28)) } return out })()`)
      if (over.length) report.overlaps[`${theme}-full-notes`] = over
      await press('Exit full screen'); await sleep(300)
    }
    if (refPath) {
      await go(`${base}/ref`); await js(`document.documentElement.setAttribute('data-theme', '${theme}')`); await settle()
      for (let n = 0; n <= stopCount; n++) {
        await js(`document.querySelectorAll("#strip .chips button")[${n}].click()`); await sleep(350)
        await shot('.stageframe', join(outDir, `ref-${theme}-${pad(n)}.png`))
      }
    }
  }

  // ---- performance, with motion on
  if (quick) throw 'quick'
  await motion(false)
  await go(`${base}/engine?theme=dark`)
  await until('window.__ready && window.__valuesAt'); await settle()
  report.perf.firstFrameMs = +(await js('window.__ready.firstFrameMs')).toFixed(1)
  report.perf.valuesAskedAfterFirstFrame = await js('window.__valuesAt >= performance.timing.navigationStart * 0 + window.__ready.firstFrameMs')
  await sleep(1200)
  const idle0 = await js('window.__md.stats(true).frames'); await sleep(1000)
  report.perf.framesDrawnWhileStillForOneSecond = await js('window.__md.stats().frames'); void idle0
  const whole = await js('(() => { const s = window.__md.stats(); return { drawCalls: s.drawCalls, triangles: s.triangles } })()')
  report.perf.wholeModel = whole
  await js('window.__md.stats(true)')
  let maxCalls = 0, maxTris = 0
  for (let n = 1; n <= stopCount; n++) {
    await js(`document.querySelectorAll(".mdg .strip .chips button")[${n}].click()`); await sleep(900)
    const s = await js('(() => { const s = window.__md.stats(); return [s.drawCalls, s.triangles] })()')
    maxCalls = Math.max(maxCalls, s[0]); maxTris = Math.max(maxTris, s[1])
  }
  const ft = (await js('window.__md.stats(true).frameMs')).sort((a, b) => a - b)
  report.perf.flyThrough = { frames: ft.length, avgMs: +(ft.reduce((a, b) => a + b, 0) / (ft.length || 1)).toFixed(2), p95Ms: +(ft[Math.floor(ft.length * 0.95)] ?? 0).toFixed(2), maxDrawCalls: maxCalls, maxTriangles: maxTris }
  // open and close ten times: memory must come back
  const heap = async () => { await cdp('HeapProfiler.collectGarbage'); await sleep(150); return (await cdp('Runtime.getHeapUsage')).usedSize }
  await js('window.__md.dispose()'); const heap0 = await heap()
  for (let k = 0; k < 10; k++) { await js('window.__mount()'); await until('window.__ready'); await js(`document.querySelectorAll(".mdg .strip .chips button")[${1 + (k % stopCount)}].click()`); await sleep(120); await js('window.__md.dispose()') }
  const heap1 = await heap()
  report.perf.heapMB = { before: +(heap0 / 1048576).toFixed(2), afterTenOpens: +(heap1 / 1048576).toFixed(2), grewBy: +((heap1 - heap0) / 1048576).toFixed(2) }
  report.perf.canvasesLeft = await js('document.querySelectorAll("canvas").length')
} catch (e) { if (e !== 'quick') throw e
} finally {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  ws.close(); chrome.kill(); server.close()
  await sleep(300); rmSync(work, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
if (errors.length) process.exitCode = 1
