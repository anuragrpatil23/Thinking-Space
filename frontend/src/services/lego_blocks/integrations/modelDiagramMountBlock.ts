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
  /** 'app' takes the host app's colours and type and drops the frame round the drawing; the default is the standalone page's own look. */
  appearance?: 'page' | 'app'
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
  // One stylesheet per document, and always this engine's: a page that has already shown a drawing with an older
  // engine (a hot reload, a second bundle) must not keep the older rules under newer markup.
  const sheet = (id: string, css: string) => {
    let st = doc.getElementById(id) as HTMLStyleElement | null
    if (!st) { st = doc.createElement('style'); st.id = id; doc.head.appendChild(st) }
    if (st.textContent !== css) st.textContent = css
  }
  sheet(STYLE_ID, MODEL_DIAGRAM_CSS_BLOCK)
  sheet(FONTS_ID, MODEL_DIAGRAM_FONTS_CSS_BLOCK)

  const { spec } = props
  const stops = modelDiagramStopsBlock(spec)
  const values = new Map<string, ModelValues>(Object.entries(props.values ?? {}))
  const loading = new Set<string>()
  let input: string | null = props.inputs[0] ?? null
  let themeProp = props.theme
  let disposed = false
  const state: ModelDiagramStateBlock & Required<Omit<ModelDiagramPassStateBlock, 'stage'>> & Pick<ModelDiagramPassStateBlock, 'stage'> = { focus: null, t: 5, sel: {}, pass: 0, showNew: true, head: 0, example: 0, open: null, stage: undefined }
  const stopFor = (step: number, part?: string) => {
    if (!step) return null
    const mine = stops.filter((s) => s.specStep === step)
    return (part ? mine.find((s) => s.part === part || s.id === part) : undefined)?.id ?? mine[0]?.id ?? null
  }
  state.focus = stopFor(props.step, props.part)

  // ---- the page
  host.classList.add('mdg-host')
  const root = el('div', props.appearance === 'app' ? 'mdg app' : 'mdg')
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
    const out = rows.length > 3 || props.appearance === 'app'
    legend.className = out ? 'legend out' : 'legend'
    if (out) { if (legend.parentElement !== side) side.insertBefore(legend, hint) } else if (legend.parentElement !== frame) frame.appendChild(legend)
    for (const [k, text] of rows) {
      if (legend.childNodes.length) legend.appendChild(out ? doc.createTextNode('   ') : el('br'))
      const sp = el('span', 'li'); sp.appendChild(el('b', '', k)); sp.appendChild(doc.createTextNode(text)); legend.appendChild(sp)
    }
  }
  const hint = el('p', 'hint', 'This is one drawing of the whole model. Click a step name or any block to fly into that part. Once inside, click any block to see the step that made it, at work on that number. Drag to turn, right-drag to slide. Block height: for similarity scores and for shares, taller means a larger value. For every other bar it is the size of the number, with negative numbers drawn paler.')
  const under = el('section', 'under'), what = el('div', 'card'), weights = el('div', 'card w')
  // In the app the numbers are not a card under the page: they open over the drawing, when asked for, and stay until closed.
  const pop = el('div', 'pop'), appLook = props.appearance === 'app'
  if (appLook) { under.append(what); what.classList.add('what'); pop.appendChild(weights); weights.hidden = true } else under.append(what, weights)
  frame.append(stage, labels, stepBtns, viewBtns, legend)
  if (appLook) frame.appendChild(pop)
  // Everything that is words: under the drawing as a rule (the wrapper is invisible to layout), a side panel in full screen.
  const side = el('div', 'side')
  // in the app the step's words come first, straight under the drawing they describe; the general notes follow
  if (appLook) side.append(under, hint); else side.append(hint, under)
  root.append(bar, strip, frame, side)
  host.appendChild(root)

  const systemDark = () => {
    const h = doc.documentElement
    if (h.classList.contains('dark') || h.getAttribute('data-theme') === 'dark') return true
    if (h.getAttribute('data-theme') === 'light' || h.classList.contains('light')) return false
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  // Inside the app the page's real background decides: a light page gets the light drawing whatever the system prefers.
  const hostDark = (): boolean | null => {
    if (props.appearance !== 'app') return null
    const probe = el('span'); probe.style.display = 'none'; probe.style.color = 'hsl(var(--background))'
    root.appendChild(probe)
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(getComputedStyle(probe).color)
    probe.remove()
    return m ? 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3] < 128 : null
  }
  const applyTheme = () => { root.setAttribute('data-theme', themeProp ?? ((hostDark() ?? systemDark()) ? 'dark' : 'light')) }
  applyTheme()

  // ---- the scene for the present state, laid out once and kept
  const scenes = new Map<string, ModelDiagramSceneBlock>()
  const sceneNow = () => {
    const v = input ? values.get(input) ?? null : null
    // the stage's size, to the nearest 5 px, so a step's numbers are spaced for the room there is
    const sw = Math.round(stage.clientWidth / 5) * 5, sh = Math.round(stage.clientHeight / 5) * 5
    state.stage = sw > 0 && sh > 0 && state.focus ? { w: sw, h: sh } : undefined
    const key = JSON.stringify([v ? input : null, state.focus, state.t, state.sel, state.pass, state.showNew, state.head, state.example, state.open, state.stage])
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
    // in the app a click flies to the step and no more: a bar's numbers open when asked for, beside the drawing
    state.focus = id; state.open = props.appearance === 'app' ? null : open
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
  // in the app the page-level buttons (notes, full screen) sit at the end of the navigator's row, off the drawing
  const navTools = el('div', 'navtools')
  const wholeBtn = button('The whole model', () => focus(null)), runBtn = button('Run', () => renderer?.run())
  for (const b of [wholeBtn, prev, next]) b.classList.add('walk')
  stepBtns.append(wholeBtn, prev, next, runBtn)

  // ---- inside the app: the step in focus named above a track of every step, to click or scrub along
  let navUpdate = () => {}
  let onOutside: ((e: Event) => void) | null = null
  if (props.appearance === 'app') {
    const nav = el('div', 'nav'), row = el('div', 'navrow'), track = el('div', 'track'), list = el('div', 'navlist'), bubble = el('div', 'bubble')
    list.hidden = true; bubble.hidden = true
    const home = button('Whole model', () => focus(null)); home.className = 'navhome'
    const pv = button('‹', () => stepBy(-1)), nx = button('›', () => stepBy(1))
    pv.className = nx.className = 'navarrow'; pv.setAttribute('aria-label', 'Previous step'); nx.setAttribute('aria-label', 'Next step')
    const cur = button('', () => { list.hidden = !list.hidden; cur.setAttribute('aria-expanded', list.hidden ? 'false' : 'true') }); cur.className = 'navcur'
    const count = el('span', 'navcount'), name = el('span', 'navname'), sec = el('span', 'navsec')
    cur.append(count, name, el('span', 'navcaret', '▾'))
    row.append(home, pv, cur, nx, track, sec, navTools)
    const dots = new Map<string, HTMLButtonElement>(), items = new Map<string, HTMLButtonElement>(), segs: { seg: HTMLElement; ids: string[] }[] = []
    for (const part of scene.strip) {
      if ('note' in part) continue
      const seg = el('div', 'seg'), dd = el('div', 'dots'), col = el('div', 'lsec')
      col.appendChild(el('div', 'lhead', part.label))
      for (const id of part.stops) {
        const st = scene.stops.find((x) => x.id === id)!, text = `${st.n}. ${st.chip}`
        const d = button('', () => focus(id)); d.className = 'dot'; d.setAttribute('aria-label', text)
        d.addEventListener('pointerenter', () => {
          const r = d.getBoundingClientRect(), t = track.getBoundingClientRect()
          bubble.textContent = text; bubble.style.left = `${r.left - t.left + r.width / 2}px`; bubble.style.top = `${r.top - t.top - 30}px`; bubble.hidden = false
        })
        d.addEventListener('pointerleave', () => { bubble.hidden = true })
        dots.set(id, d); dd.appendChild(d)
        const li = button(text, () => { list.hidden = true; focus(id) }); li.className = 'litem'; items.set(id, li); col.appendChild(li)
      }
      // under the dots, the section's own name without the block it belongs to ("Attention"); the full name is beside the step's title
      seg.append(dd, el('span', 'seglabel', part.label.includes(': ') ? part.label.slice(part.label.indexOf(': ') + 2) : part.label)); track.appendChild(seg); segs.push({ seg, ids: part.stops }); list.appendChild(col)
    }
    track.appendChild(bubble)
    nav.append(row, list)
    // the header reads: where you are in the model, then what is going through it
    root.insertBefore(nav, bar)
    onOutside = (e) => { if (!list.hidden && !nav.contains(e.target as Node)) list.hidden = true }
    doc.addEventListener('pointerdown', onOutside)
    navUpdate = () => {
      const n = state.focus ? stops.findIndex((x) => x.id === state.focus) : -1, at = n >= 0 ? scene.stops[n] : null
      count.textContent = at ? `${n + 1} / ${stops.length}` : `${stops.length} steps`
      name.textContent = at ? at.chip : 'The whole model'
      sec.textContent = at ? at.group : ''
      pv.disabled = n <= 0; nx.disabled = n === stops.length - 1
      home.setAttribute('aria-pressed', at ? 'false' : 'true')
      stops.forEach((x, k) => {
        dots.get(x.id)?.setAttribute('class', k === n ? 'dot cur' : n >= 0 && k < n ? 'dot done' : 'dot')
        const li = items.get(x.id)
        if (li) { if (k === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current') }
      })
      for (const g of segs) g.seg.classList.toggle('cur', Boolean(state.focus && g.ids.includes(state.focus)))
    }
  }
  // in the app the camera buttons are a small stack in the stage's corner, as on a map
  const inApp = props.appearance === 'app'
  const ICON: Record<string, string> = {
    Numbers: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M2.5 9.8h11M6.3 3v10"/>',
    'Zoom in': '<path d="M8 3.5v9M3.5 8h9"/>', 'Zoom out': '<path d="M3.5 8h9"/>',
    'Reset view': '<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.8v2.6h2.6"/>', Run: '<path d="M5.2 3.6v8.8L12.4 8z" fill="currentColor" stroke-linejoin="round"/>',
  }
  const icon = (b: HTMLButtonElement, name: string, withText = false) => {
    b.innerHTML = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${ICON[name]}</svg>${withText ? `<span>${name}</span>` : ''}`
    b.title = name; b.setAttribute('aria-label', name)
  }
  const numBtn = button('Numbers', () => { showN = !showN; draw() })
  const camBtn = (text: string, _glyph: string, onClick: () => void) => { const b = button(text, onClick); if (inApp) icon(b, text); return b }
  viewBtns.append(
    camBtn('Zoom in', '+', () => renderer?.zoom(0.8)), camBtn('Zoom out', '\u2212', () => renderer?.zoom(1.25)),
    camBtn('Reset view', '\u27F2', () => renderer?.flyTo(state.focus ? scene.stops.find((s) => s.id === state.focus)!.frame : scene.all)),
  )
  // ---- full screen: the drawing laid over the whole window
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
    bleed()
    // the stage has a new size: frame the same step again once it has been measured
    refit()
  }
  const overlay = (on: boolean) => {
    root.classList.toggle('overlay', on)
    if (on) doc.body.appendChild(root); else host.appendChild(root)
    applyFull(on)
  }
  // Full screen fills the window, as the app's own focus modes do; it does not take over the display.
  function setFull(on: boolean) { overlay(on) }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && root.classList.contains('overlay')) { overlay(false); return }
    // the arrow keys step through the model while the drawing has the keyboard (it was clicked, or it is full screen)
    const t = e.target as HTMLElement | null
    if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || t?.isContentEditable) return
    if (!full && !(t && root.contains(t))) return
    if (e.key === 'ArrowRight') { stepBy(1); e.preventDefault() }
    else if (e.key === 'ArrowLeft') { stepBy(-1); e.preventDefault() }
    else if (e.key === 'f' || e.key === 'F') { setFull(!full); e.preventDefault() }
  }
  root.tabIndex = -1
  root.addEventListener('pointerdown', () => { if (!root.contains(doc.activeElement)) root.focus({ preventScroll: true }) })
  // Inside the app the drawing is not held to the text column: the stage runs the whole width of the page area it scrolls in.
  let bleedRo: ResizeObserver | null = null
  const scroller = (() => {
    if (props.appearance !== 'app') return null
    for (let e = host.parentElement; e && e !== doc.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY
      if (o === 'auto' || o === 'scroll') return e
    }
    return doc.documentElement
  })()
  const bleed = () => {
    if (!scroller || disposed) return
    if (full) { frame.style.marginLeft = ''; frame.style.width = ''; frame.style.maxWidth = ''; return }
    const t = scroller === doc.documentElement ? { left: 0 } : scroller.getBoundingClientRect(), r = root.getBoundingClientRect()
    const left = Math.max(0, Math.round(r.left - t.left)), w = scroller.clientWidth
    if (w <= 0) return
    frame.style.marginLeft = `${-left}px`; frame.style.width = `${w}px`; frame.style.maxWidth = 'none'
  }
  if (scroller && typeof ResizeObserver !== 'undefined') { bleedRo = new ResizeObserver(bleed); bleedRo.observe(scroller); bleedRo.observe(host) }
  bleed()
  // a stage that changed size lays the focused step out again, so its numbers keep clear of each other
  let sizeWas = ''
  const stageRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    const now = `${Math.round(stage.clientWidth / 5)}x${Math.round(stage.clientHeight / 5)}`
    if (now === sizeWas) return
    const first = sizeWas === ''; sizeWas = now
    if (!first && state.focus && !disposed) draw()
  }) : null
  stageRo?.observe(stage)
  doc.addEventListener('keydown', onKey)
  if (inApp) { navTools.append(notesBtn, fullBtn); icon(runBtn, 'Run', true); runBtn.title = 'Play this step again'; runBtn.classList.add('run'); viewBtns.prepend(runBtn); icon(numBtn, 'Numbers', true); numBtn.title = 'Show this step\u2019s numbers beside the drawing'; numBtn.classList.add('run'); runBtn.after(numBtn) } else viewBtns.append(notesBtn, fullBtn)
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
  const overBtn = button('Start over', () => setPass(props.appearance === 'app' ? state.pass - 1 : 0)), tokensEl = el('span', '')
  const showBtn = button('Show what the new token touches', () => { state.showNew = !state.showNew; draw() })
  const passGroup = el('div', 'g'), wroteGroup = el('div', 'g')
  // the head in front of an attention step
  const headGroup = el('div', 'g'), headLabel = el('span', 'l')
  const setHead = (n: number) => { const h = scene.heads; if (!h) return; state.head = (n + h.count) % h.count; draw() }
  if (props.appearance === 'app') {
    const hp = button('\u2039', () => setHead(state.head - 1)), hn = button('\u203A', () => setHead(state.head + 1))
    hp.title = 'Previous head'; hp.setAttribute('aria-label', 'Previous head'); hn.title = 'Next head'; hn.setAttribute('aria-label', 'Next head')
    headLabel.className = 'v'; passLabel.className = 'v'
    headGroup.classList.add('pager'); headGroup.append(el('span', 'l', 'Head'), hp, headLabel, hn)
  } else headGroup.append(headLabel, button('Previous head', () => setHead(state.head - 1)), button('Next head', () => setHead(state.head + 1)))
  headGroup.hidden = true
  // which example of the batch is drawn
  const exGroup = el('div', 'g'), exLabel = el('span', 'l'), exRange = doc.createElement('input')
  exRange.type = 'range'; exRange.min = '1'; exRange.step = '1'; exRange.setAttribute('aria-label', 'Example in the batch')
  exRange.addEventListener('input', () => { state.example = Number(exRange.value) - 1; draw() })
  exGroup.append(exLabel, exRange); exGroup.hidden = true
  // the saved numbers of a bar that was clicked
  const openCard = el('div', 'card open'), openBody = el('div', 'openbody')
  const closeBtn = button('Close', () => { state.open = null; showN = false; draw() })
  openCard.append(closeBtn, openBody); openCard.hidden = true
  if (props.inputs.length) {
    const g = el('div', 'g join'); g.appendChild(el('span', 'l', inApp ? 'Prompt' : 'Prompt at the front'))
    for (const name of props.inputs) { const b = button(name, () => setInput(name)); inputBtns.set(name, b); g.appendChild(b) }
    if (inApp) {
      // one word at a time, forwards or back: the same stepper as the heads
      writeBtn.textContent = '\u203A'; writeBtn.title = 'Write the next word'; writeBtn.setAttribute('aria-label', 'Write the next word')
      overBtn.textContent = '\u2039'; overBtn.title = 'Take the last word back'; overBtn.setAttribute('aria-label', 'Take the last word back')
      tokensEl.className = 'v dim'; passGroup.append(tokensEl)
    } else passGroup.append(passLabel, writeBtn, overBtn, showBtn)
    // in the app one control: what is written, the word that comes next, and an arrow either side to take a word back or write it
    if (inApp) wroteGroup.append(overBtn, el('span', 'l', 'Written so far'), writtenEl, el('span', 'l', 'Next word'), nextEl, writeBtn)
    else wroteGroup.append(el('span', 'l', 'Written so far'), writtenEl, el('span', 'l', 'Next word'), nextEl)
    wroteGroup.classList.add('readout')
    // in the app what the new token touches is always shown: it is the point of stepping a word at a time
    if (inApp) state.showNew = true
    if (inApp) bar.append(g, wroteGroup, passGroup); else bar.append(g, passGroup, wroteGroup)
  }
  headGroup.classList.add('right')
  bar.append(headGroup, exGroup)
  if (inApp) pop.insertBefore(openCard, pop.firstChild); else side.insertBefore(openCard, under)

  // in the app each card says what it is before it says anything else
  const card = (into: HTMLElement, items: ModelDiagramCardItemBlock[], tagged: boolean, eyebrow?: [string, string]) => {
    into.textContent = ''
    if (inApp && eyebrow) { const e = el('div', 'eyebrow'); e.append(el('b', '', eyebrow[0]), el('span', '', eyebrow[1])); into.appendChild(e) }
    let head: HTMLElement | null = null
    // the step's card in the app: the telling on the left, the formula and sizes beside it
    const split = inApp && into === what
    const main = split ? el('div', 'main') : into, aside = split ? el('div', 'aside') : into
    if (split) { const cols = el('div', 'cols'); cols.append(main, aside); into.appendChild(cols) }
    const dest = (t: string) => (t === 'h2' || t === 'p' ? main : aside)
    let skipSum = false
    if (tagged) { head = el('div', 'hd'); head.appendChild(el('span', 'tag wt', 'WEIGHTS')); into.appendChild(head) }
    for (const it of items) {
      // the sum written out already has its place in the drawing's corner
      if (split) { if (it.t === 'h3' && it.text === 'The sum, written out') { skipSum = true; continue } if (skipSum && it.t === 'formula') continue; skipSum = false }
      if (it.t === 'sizes') { const d = el('div', 'sizes'); for (const l of it.lines) d.appendChild(el('span', '', l)); dest(it.t).appendChild(d) }
      else if (it.t === 'table') {
        const t = el('table', it.cls)
        it.rows.forEach((r, n) => {
          const tr = el('tr', r.on ? 'on' : '')
          const pick = n > 0 ? it.pickRows?.[n - 1] : undefined
          if (pick !== undefined && state.focus) { const id = state.focus; tr.classList.add('pickable'); tr.title = 'Show this neuron in the drawing'; tr.addEventListener('click', () => { state.sel[id] = pick; draw() }) }
          r.cells.forEach((c, k) => { const td = el(n === 0 ? 'th' : 'td', '', c); const sh = r.shade?.[k]; if (sh) td.style.background = `color-mix(in srgb, var(--neuron) ${Math.round(sh * 60)}%, transparent)`; if (inApp && it.pickRows && r.on && k >= 1 && k <= 8) td.style.boxShadow = `inset 0 -3px 0 var(--c${k})`; tr.appendChild(td) })
          t.appendChild(tr)
        })
        const d = el('div', 'tscroll'); d.appendChild(t); dest(it.t).appendChild(d)
      } else if (it.t === 'h3' && head && head.childNodes.length === 1) head.appendChild(el('h3', '', it.text))
      else dest(it.t).appendChild(el(it.t === 'h2' || it.t === 'h3' ? it.t : it.t === 'p' || it.t === 'note' ? 'p' : 'div', it.t === 'note' ? 'note' : it.t === 'formula' ? 'formula' : '', it.text))
    }
  }

  let showN = false
  function draw() {
    scene = sceneNow()
    if (inApp) {
      // the inspector shows the numbers of the step in focus: its result, and its weights when it has any
      const cur = showN && state.focus ? scene.stops.find((x) => x.id === state.focus) : undefined
      const key = cur ? cur.bars[cur.bars.length - 1] ?? null : null
      if (state.open !== key) { state.open = key; scene = sceneNow() }
    }
    for (const [id, b] of chip) { if (id === state.focus) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current') }
    // a strip that scrolls sideways keeps the step in focus in sight
    const cur = state.focus ? chip.get(state.focus) : allChip
    if (cur && strip.scrollWidth > strip.clientWidth + 4) {
      const c = cur.getBoundingClientRect(), r = strip.getBoundingClientRect()
      strip.scrollLeft += c.left + c.width / 2 - (r.left + r.width / 2)
    }
    if (!state.focus) allChip.setAttribute('aria-current', 'step'); else allChip.removeAttribute('aria-current')
    for (const [name, b] of inputBtns) b.setAttribute('aria-pressed', name === input ? 'true' : 'false')
    const n = state.focus ? stops.findIndex((s) => s.id === state.focus) : -1
    prev.disabled = n <= 0; next.disabled = n === stops.length - 1
    drawLegend(scene.legend)
    navUpdate()
    const hs = scene.heads
    headGroup.hidden = !hs
    if (hs) headLabel.textContent = `${props.appearance === 'app' ? '' : 'Head '}${hs.head + 1} of ${hs.count}${hs.saved.length && !hs.saved.includes(hs.head) ? ' (its numbers were not saved)' : ''}`
    const ex = scene.examples
    exGroup.hidden = !ex
    if (ex) { exLabel.textContent = `Example ${ex.index + 1} of ${ex.count} in the batch`; exRange.max = String(ex.count); exRange.value = String(ex.index + 1) }
    bar.hidden = !props.inputs.length && !hs && !ex
    openCard.hidden = !scene.open
    if (scene.open) card(openBody, scene.open, false, [inApp ? 'This step\u2019s result' : 'The bar you clicked', 'the numbers saved for it'])
    const ps = scene.passes
    wroteGroup.hidden = !ps
    passGroup.hidden = !ps || ps.count <= 1
    if (inApp) { writeBtn.hidden = overBtn.hidden = !ps || ps.count <= 1 }
    if (ps) {
      passLabel.textContent = props.appearance === 'app' ? `${ps.pass} of ${ps.count - 1}` : `Pass ${ps.pass + 1} of ${ps.count}: ${scene.tokens.length} tokens go in`
      writeBtn.disabled = ps.pass >= ps.count - 1; overBtn.disabled = ps.pass === 0; tokensEl.textContent = `${ps.pass} of ${ps.count - 1} words \u00B7 ${scene.tokens.length} tokens read`
      showBtn.setAttribute('aria-pressed', state.showNew ? 'true' : 'false'); if (inApp) showBtn.setAttribute('aria-checked', state.showNew ? 'true' : 'false')
      const wr = ps.written.join(' ')
      // in the app the control keeps its width as words are added: a long run shows its end
      writtenEl.textContent = !ps.written.length ? '(nothing yet)' : inApp && wr.length > 24 ? `\u2026${wr.slice(-23)}` : wr; writtenEl.title = wr; nextEl.textContent = ps.next
    }
    card(what, scene.what, false, [state.focus ? 'This step' : 'The model', state.focus ? 'what it does, in words and numbers' : 'what the drawing shows']); card(weights, scene.weights, true, [state.focus ? 'This step\u2019s weights' : 'Weights', state.focus ? 'click a row to show that neuron in the drawing' : 'learned in training; the same for every prompt'])
    if (inApp) {
      const hasTable = scene.weights.some((x) => x.t === 'table')
      weights.hidden = !(showN && state.focus && hasTable)
      numBtn.hidden = !state.focus; numBtn.setAttribute('aria-pressed', showN ? 'true' : 'false')
      const aside = what.querySelector('.aside')
      if (aside && state.focus && !hasTable) aside.appendChild(el('p', 'note', 'This step has no weights of its own: it only combines what earlier steps produced.'))
      // the inspector takes a strip of the stage; the drawing is fitted again into what is left
      const insp = showN && Boolean(state.focus)
      if (insp !== root.classList.contains('inspect')) { root.classList.toggle('inspect', insp); refit() }
    }
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
        for (const e of [stepBtns, viewBtns, legend, pop]) {
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
      stageRo?.disconnect(); bleedRo?.disconnect()
      if (onOutside) doc.removeEventListener('pointerdown', onOutside)
      doc.removeEventListener('keydown', onKey)
      mq?.removeEventListener('change', retheme); mo?.disconnect()
      renderer?.dispose(); renderer = null
      scenes.clear(); values.clear()
      root.remove(); host.classList.remove('mdg-host')
    },
  }
}
