// A model diagram, mounted into any element with no framework: the input bar,
// the step strip, the 3D stage with its buttons, and the two cards under it.
// The app's React block and the exported HTML page both call this, so what the
// export shows is what the app shows. It lays the model out (pure), hands the
// scene to the renderer, and reports steps and picks back to its host.
import type { ModelSpec, ModelValues } from '../units/modelDiagramFormatBlock'
import {
  layoutModelDiagramBlock, modelDiagramStopsBlock, type ModelDiagramCardItemBlock, type ModelDiagramPassStateBlock, type ModelDiagramSceneBlock, type ModelDiagramStateBlock,
} from '../units/modelDiagramLayoutBlock'
import { MODEL_DIAGRAM_FONTS_CSS_BLOCK } from '../units/modelDiagramFontsBlock'
import { MODEL_DIAGRAM_CSS_BLOCK } from '../units/modelDiagramStyleBlock'
import { createModelDiagramRendererBlock, type ModelDiagramRendererBlock, type ModelDiagramRendererStatsBlock } from './modelDiagramRendererBlock'

export interface ModelDiagramMountPropsBlock {
  spec: ModelSpec
  /** Names of the values files, in order. */
  inputs: string[]
  /** Values already in hand (the export inlines them). */
  values?: Record<string, ModelValues>
  /** Called only when an input's values are needed and not in hand. */
  loadValues?: (input: string) => Promise<ModelValues>
  /** 1-based index into spec.steps; 0 is the whole model. */
  step: number
  /** The stop inside that step ('q', 'scores', ...), when the step opens into several. */
  part?: string
  theme?: 'light' | 'dark'
  onStep?: (step: number, part?: string) => void
  onPickBlock?: (id: string) => void
  onReady?: (info: { firstFrameMs: number }) => void
}

export interface ModelDiagramHandleBlock {
  setStep(step: number, part?: string): void
  setTheme(theme: 'light' | 'dark' | undefined): void
  /** Draw calls, triangles and frame times, for the performance check. */
  stats(reset?: boolean): ModelDiagramRendererStatsBlock
  labelRects(): ReturnType<ModelDiagramRendererBlock['labelRects']>
  dispose(): void
}

const STYLE_ID = 'model-diagram-style'
const FONTS_ID = 'model-diagram-fonts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', '', text); b.type = 'button'; b.addEventListener('click', onClick); return b
}

export function mountModelDiagram(host: HTMLElement, props: ModelDiagramMountPropsBlock): ModelDiagramHandleBlock {
  const t0 = performance.now()
  const doc = host.ownerDocument
  if (!doc.getElementById(STYLE_ID)) { const st = doc.createElement('style'); st.id = STYLE_ID; st.textContent = MODEL_DIAGRAM_CSS_BLOCK; doc.head.appendChild(st) }
  if (!doc.getElementById(FONTS_ID)) { const st = doc.createElement('style'); st.id = FONTS_ID; st.textContent = MODEL_DIAGRAM_FONTS_CSS_BLOCK; doc.head.appendChild(st) }

  const { spec } = props
  const stops = modelDiagramStopsBlock(spec)
  const values = new Map<string, ModelValues>(Object.entries(props.values ?? {}))
  const loading = new Set<string>()
  let input: string | null = props.inputs[0] ?? null
  let themeProp = props.theme
  let disposed = false
  const state: ModelDiagramStateBlock & Required<ModelDiagramPassStateBlock> = { focus: null, t: 5, sel: {}, pass: 0, showNew: true, head: 0, example: 0, open: null }
  const stopFor = (step: number, part?: string) => {
    if (!step) return null
    const mine = stops.filter((s) => s.specStep === step)
    return (part ? mine.find((s) => s.part === part || s.id === part) : undefined)?.id ?? mine[0]?.id ?? null
  }
  state.focus = stopFor(props.step, props.part)

  // ---- the page
  host.classList.add('mdg-host')
  const root = el('div', 'mdg')
  const bar = el('div', 'bar2')
  const strip = el('nav', 'strip'); strip.setAttribute('aria-label', 'Steps')
  const frame = el('div', 'stageframe')
  const stage = el('div', 'mdg-stage'), labels = el('div', 'mdg-labels')
  const stepBtns = el('div', 'stepbtns'), viewBtns = el('div', 'viewbtns')
  const legend = el('p', 'legend')
  let legendOf: unknown = null
  const drawLegend = (rows: [string, string][]) => {
    if (legendOf === rows) return
    legendOf = rows; legend.textContent = ''
    // Three lines fit in the drawing's corner, as on the hand-built page; a longer legend gets its own panel under the drawing.
    const out = rows.length > 3
    legend.className = out ? 'legend out' : 'legend'
    if (out) { if (legend.parentElement !== side) side.insertBefore(legend, hint) } else if (legend.parentElement !== frame) frame.appendChild(legend)
    for (const [k, text] of rows) {
      if (legend.childNodes.length) legend.appendChild(out ? doc.createTextNode('   ') : el('br'))
      const sp = el('span', 'li'); sp.appendChild(el('b', '', k)); sp.appendChild(doc.createTextNode(text)); legend.appendChild(sp)
    }
  }
  const hint = el('p', 'hint', 'This is one drawing of the whole model. Click a step name or any block to fly into that part. Once inside, click any block to see the step that made it, at work on that number. Drag to turn, right-drag to slide. Block height: for similarity scores and for shares, taller means a larger value. For every other bar it is the size of the number, with negative numbers drawn paler.')
  const under = el('section', 'under'), what = el('div', 'card'), weights = el('div', 'card w')
  under.append(what, weights)
  frame.append(stage, labels, stepBtns, viewBtns, legend)
  // Everything that is words: under the drawing as a rule (the wrapper is invisible to layout), a side panel in full screen.
  const side = el('div', 'side')
  side.append(hint, under)
  root.append(bar, strip, frame, side)
  host.appendChild(root)

  const systemDark = () => {
    const h = doc.documentElement
    if (h.classList.contains('dark') || h.getAttribute('data-theme') === 'dark') return true
    if (h.getAttribute('data-theme') === 'light' || h.classList.contains('light')) return false
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  const applyTheme = () => { root.setAttribute('data-theme', themeProp ?? (systemDark() ? 'dark' : 'light')) }
  applyTheme()

  // ---- the scene for the present state, laid out once and kept
  const scenes = new Map<string, ModelDiagramSceneBlock>()
  const sceneNow = () => {
    const v = input ? values.get(input) ?? null : null
    const key = JSON.stringify([v ? input : null, state.focus, state.t, state.sel, state.pass, state.showNew, state.head, state.example, state.open])
    let s = scenes.get(key)
    if (!s) {
      s = layoutModelDiagramBlock(spec, v, state)
      if (scenes.size >= 6) scenes.delete(scenes.keys().next().value as string)
      scenes.set(key, s)
    }
    return s
  }

  let renderer: ModelDiagramRendererBlock | null = null
  let scene: ModelDiagramSceneBlock = sceneNow()

  const report = () => {
    const s = stops.find((x) => x.id === state.focus)
    props.onStep?.(s ? s.specStep : 0, s?.part || undefined)
  }
  const focus = (id: string | null, tell = true, open: string | null = null) => {
    state.focus = id; state.open = open
    draw(); renderer?.flyTo(id ? scene.stops.find((s) => s.id === id)!.frame : scene.all)
    if (tell) report()
  }
  const stepBy = (d: number) => {
    const ids = stops.map((s) => s.id)
    const n = state.focus ? ids.indexOf(state.focus) + d : d > 0 ? 0 : ids.length - 1
    if (n >= 0 && n < ids.length) focus(ids[n])
  }

  // ---- strip and buttons
  const chip = new Map<string, HTMLButtonElement>()
  const allChip = button('The whole model', () => focus(null))
  {
    const g = el('div', 'grp'); g.appendChild(el('span', 'gl', 'Overview'))
    const c = el('div', 'chips'); c.appendChild(allChip); g.appendChild(c); strip.appendChild(g)
    for (const part of scene.strip) {
      if ('note' in part) { strip.appendChild(el('div', 'grp stack', part.note)); continue }
      const grp = el('div', 'grp'); grp.appendChild(el('span', 'gl', part.label))
      const chips = el('div', 'chips')
      for (const id of part.stops) {
        const s = scene.stops.find((x) => x.id === id)!
        const b = button(`${s.n}. ${s.chip}`, () => focus(id)); chip.set(id, b); chips.appendChild(b)
      }
      grp.appendChild(chips); strip.appendChild(grp)
    }
  }
  const prev = button('Previous step', () => stepBy(-1)), next = button('Next step', () => stepBy(1))
  stepBtns.append(button('The whole model', () => focus(null)), prev, next, button('Run', () => renderer?.run()))
  viewBtns.append(
    button('Zoom in', () => renderer?.zoom(0.8)), button('Zoom out', () => renderer?.zoom(1.25)),
    button('Reset view', () => renderer?.flyTo(state.focus ? scene.stops.find((s) => s.id === state.focus)!.frame : scene.all)),
  )
  // ---- full screen: the display's own full screen where the browser has it, else the drawing laid over the whole window
  let full = false
  const refit = () => setTimeout(() => { if (!disposed) renderer?.flyTo(state.focus ? scene.stops.find((s) => s.id === state.focus)!.frame : scene.all) }, 80)
  // In full screen the words wait in a side panel: a click on a block or a step's title brings it up.
  const setNotes = (on: boolean) => {
    if (!full || root.classList.contains('notes') === on) return
    root.classList.toggle('notes', on); notesBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); refit()
  }
  const notesBtn = button('Notes', () => setNotes(!root.classList.contains('notes')))
  notesBtn.hidden = true
  const closeNotes = button('Close', () => setNotes(false)); closeNotes.className = 'sideclose'
  side.insertBefore(closeNotes, side.firstChild)
  const fullBtn = button('Full screen', () => setFull(!full))
  const applyFull = (on: boolean) => {
    full = on
    root.classList.toggle('full', on)
    if (!on) root.classList.remove('notes')
    notesBtn.hidden = !on
    fullBtn.textContent = on ? 'Exit full screen' : 'Full screen'
    // the stage has a new size: frame the same step again once it has been measured
    refit()
  }
  const overlay = (on: boolean) => {
    root.classList.toggle('overlay', on)
    if (on) doc.body.appendChild(root); else host.appendChild(root)
    applyFull(on)
  }
  function setFull(on: boolean) {
    if (on) {
      if (typeof root.requestFullscreen === 'function') root.requestFullscreen().catch(() => overlay(true))
      else overlay(true)
    } else if (doc.fullscreenElement === root) void doc.exitFullscreen()
    else overlay(false)
  }
  const onFullscreenChange = () => { if (!root.classList.contains('overlay')) applyFull(doc.fullscreenElement === root) }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && root.classList.contains('overlay')) overlay(false) }
  doc.addEventListener('fullscreenchange', onFullscreenChange)
  doc.addEventListener('keydown', onKey)
  viewBtns.append(notesBtn, fullBtn)
  const inputBtns = new Map<string, HTMLButtonElement>()
  const passLabel = el('span', 'l'), writtenEl = el('b', 'mono'), nextEl = el('b', 'mono nxt')
  const setPass = (n: number) => {
    state.pass = Math.max(0, n); state.sel = {}
    const v = input ? values.get(input) : undefined
    const rows = v ? Math.min(v.tokens.length, (v.prompt_tokens ?? v.tokens.length) + state.pass) : 1
    state.t = state.pass === 0 ? Math.min(5, rows - 1) : rows - 1
    draw()
  }
  const writeBtn = button('Write the next word', () => setPass(state.pass + 1))
  const overBtn = button('Start over', () => setPass(0))
  const showBtn = button('Show what the new token touches', () => { state.showNew = !state.showNew; draw() })
  const passGroup = el('div', 'g'), wroteGroup = el('div', 'g')
  // the head in front of an attention step
  const headGroup = el('div', 'g'), headLabel = el('span', 'l')
  const setHead = (n: number) => { const h = scene.heads; if (!h) return; state.head = (n + h.count) % h.count; draw() }
  headGroup.append(headLabel, button('Previous head', () => setHead(state.head - 1)), button('Next head', () => setHead(state.head + 1)))
  headGroup.hidden = true
  // which example of the batch is drawn
  const exGroup = el('div', 'g'), exLabel = el('span', 'l'), exRange = doc.createElement('input')
  exRange.type = 'range'; exRange.min = '1'; exRange.step = '1'; exRange.setAttribute('aria-label', 'Example in the batch')
  exRange.addEventListener('input', () => { state.example = Number(exRange.value) - 1; draw() })
  exGroup.append(exLabel, exRange); exGroup.hidden = true
  // the saved numbers of a bar that was clicked
  const openCard = el('div', 'card open'), openBody = el('div', 'openbody')
  const closeBtn = button('Close', () => { state.open = null; draw() })
  openCard.append(closeBtn, openBody); openCard.hidden = true
  if (props.inputs.length) {
    const g = el('div', 'g'); g.appendChild(el('span', 'l', 'Prompt at the front'))
    for (const name of props.inputs) { const b = button(name, () => setInput(name)); inputBtns.set(name, b); g.appendChild(b) }
    passGroup.append(passLabel, writeBtn, overBtn, showBtn)
    wroteGroup.append(el('span', 'l', 'Written so far'), writtenEl, el('span', 'l', 'Next word'), nextEl)
    bar.append(g, passGroup, wroteGroup)
  }
  bar.append(headGroup, exGroup)
  side.insertBefore(openCard, under)

  const card = (into: HTMLElement, items: ModelDiagramCardItemBlock[], tagged: boolean) => {
    into.textContent = ''
    let head: HTMLElement | null = null
    if (tagged) { head = el('div', 'hd'); head.appendChild(el('span', 'tag wt', 'WEIGHTS')); into.appendChild(head) }
    for (const it of items) {
      if (it.t === 'sizes') { const d = el('div', 'sizes'); for (const l of it.lines) d.appendChild(el('span', '', l)); into.appendChild(d) }
      else if (it.t === 'table') {
        const t = el('table', it.cls)
        it.rows.forEach((r, n) => {
          const tr = el('tr', r.on ? 'on' : '')
          r.cells.forEach((c, k) => { const td = el(n === 0 ? 'th' : 'td', '', c); const sh = r.shade?.[k]; if (sh) td.style.background = `color-mix(in srgb, var(--neuron) ${Math.round(sh * 60)}%, transparent)`; tr.appendChild(td) })
          t.appendChild(tr)
        })
        const d = el('div', 'tscroll'); d.appendChild(t); into.appendChild(d)
      } else if (it.t === 'h3' && head && head.childNodes.length === 1) head.appendChild(el('h3', '', it.text))
      else into.appendChild(el(it.t === 'h2' || it.t === 'h3' ? it.t : it.t === 'p' || it.t === 'note' ? 'p' : 'div', it.t === 'note' ? 'note' : it.t === 'formula' ? 'formula' : '', it.text))
    }
  }

  function draw() {
    scene = sceneNow()
    for (const [id, b] of chip) { if (id === state.focus) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current') }
    if (!state.focus) allChip.setAttribute('aria-current', 'step'); else allChip.removeAttribute('aria-current')
    for (const [name, b] of inputBtns) b.setAttribute('aria-pressed', name === input ? 'true' : 'false')
    const n = state.focus ? stops.findIndex((s) => s.id === state.focus) : -1
    prev.disabled = n <= 0; next.disabled = n === stops.length - 1
    drawLegend(scene.legend)
    const hs = scene.heads
    headGroup.hidden = !hs
    if (hs) headLabel.textContent = `Head ${hs.head + 1} of ${hs.count}${hs.saved.length && !hs.saved.includes(hs.head) ? ' (its numbers were not saved)' : ''}`
    const ex = scene.examples
    exGroup.hidden = !ex
    if (ex) { exLabel.textContent = `Example ${ex.index + 1} of ${ex.count} in the batch`; exRange.max = String(ex.count); exRange.value = String(ex.index + 1) }
    bar.hidden = !props.inputs.length && !hs && !ex
    openCard.hidden = !scene.open
    if (scene.open) card(openBody, scene.open, false)
    const ps = scene.passes
    wroteGroup.hidden = !ps
    passGroup.hidden = !ps || ps.count <= 1
    if (ps) {
      passLabel.textContent = `Pass ${ps.pass + 1} of ${ps.count}: ${scene.tokens.length} tokens go in`
      writeBtn.disabled = ps.pass >= ps.count - 1; overBtn.disabled = ps.pass === 0
      showBtn.setAttribute('aria-pressed', state.showNew ? 'true' : 'false')
      writtenEl.textContent = ps.written.length ? ps.written.join(' ') : '(nothing yet)'; nextEl.textContent = ps.next
    }
    card(what, scene.what, false); card(weights, scene.weights, true)
    renderer?.setScene(scene, state.focus)
  }

  // ---- values: fetched when the drawing first needs them, never before the first frame
  const need = (name: string | null) => {
    if (!name || values.has(name) || loading.has(name) || !props.loadValues) return
    loading.add(name)
    props.loadValues(name).then((v) => {
      loading.delete(name)
      if (disposed) return
      values.set(name, v)
      if (name === input) { state.t = Math.min(state.t, Math.max(0, (v.prompt_tokens ?? v.tokens.length) - 1)); draw() }
    }, () => { loading.delete(name) })
  }
  function setInput(name: string) { input = name; state.sel = {}; state.pass = 0; need(name); draw() }

  try {
    renderer = createModelDiagramRendererBlock(stage, labels, root, {
      onPick(grid, row, col) {
        if (!grid.pick) return
        const id = grid.pick.stop
        if (grid.pick.rows) state.sel[id] = grid.pick.rows[row]
        else if (state.focus) { state.t = row; state.sel[id] = col }
        const s = stops.find((x) => x.id === id)
        if (s) props.onPickBlock?.(s.opId)
        focus(id, true, grid.key)
        setNotes(true)
      },
      onStop: (id) => { focus(id); setNotes(true) },
      obstacles() {
        const f = stage.getBoundingClientRect(), out: { x0: number; y0: number; x1: number; y1: number }[] = []
        for (const e of [stepBtns, viewBtns, legend]) {
          if (e.parentElement !== frame) continue
          const r = e.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) out.push({ x0: r.left - f.left, y0: r.top - f.top, x1: r.right - f.left, y1: r.bottom - f.top })
        }
        return out
      },
      onFirstFrame() {
        props.onReady?.({ firstFrameMs: performance.now() - t0 })
        need(input)
      },
    })
  } catch {
    stage.appendChild(el('div', 'fallback', 'The 3D drawing could not start in this view. The step descriptions below still work.'))
    need(input)
  }
  draw()
  renderer?.flyTo(state.focus ? scene.stops.find((s) => s.id === state.focus)!.frame : scene.all, true)

  const retheme = () => { applyTheme(); renderer?.retheme() }
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  mq?.addEventListener('change', retheme)
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(retheme) : null
  mo?.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  // The circles are drawn with the page's font, so they are redrawn once it has loaded.
  if (doc.fonts) {
    void Promise.all([doc.fonts.load('600 74px "IBM Plex Sans"', 'Σq·k'), doc.fonts.load('500 46px "IBM Plex Sans"', 'GELU+')])
      .then(() => doc.fonts.ready).then(() => { if (!disposed) renderer?.retheme() }, () => {})
  }

  return {
    setStep(step, part) {
      const id = stopFor(step, part)
      const cur = stops.find((s) => s.id === state.focus)
      if (id === state.focus || (cur && cur.specStep === step && !part)) return
      focus(id, false)
    },
    setTheme(theme) { themeProp = theme; retheme() },
    stats: (reset) => renderer?.stats(reset) ?? { drawCalls: 0, triangles: 0, frames: 0, frameMs: [], geometries: 0, textures: 0 },
    labelRects: () => renderer?.labelRects() ?? [],
    dispose() {
      disposed = true
      doc.removeEventListener('fullscreenchange', onFullscreenChange); doc.removeEventListener('keydown', onKey)
      if (doc.fullscreenElement === root) void doc.exitFullscreen()
      mq?.removeEventListener('change', retheme); mo?.disconnect()
      renderer?.dispose(); renderer = null
      scenes.clear(); values.clear()
      root.remove(); host.classList.remove('mdg-host')
    },
  }
}
