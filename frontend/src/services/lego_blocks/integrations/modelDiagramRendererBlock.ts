// The three.js renderer for model diagrams. It draws exactly what the layout
// engine hands it and decides nothing about placement. Ported from the
// hand-built gpt-with-sparse-network.html (same camera, lights, materials and
// three.js r128, so the picture matches it), with the drawing batched: every
// tile in the scene is one instanced mesh, every rod another, every thin line
// one line set. A frame is drawn only when something changed.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type {
  ModelDiagramColBlock, ModelDiagramFrameBlock, ModelDiagramLabelBlock, ModelDiagramSceneBlock, ModelDiagramVec3Block,
} from '../units/modelDiagramLayoutBlock'
import { placeModelDiagramLabelsBlock, type ModelDiagramLabelBoxBlock } from '../units/modelDiagramLabelsBlock'

type V3 = ModelDiagramVec3Block
type Col = ModelDiagramColBlock

export interface ModelDiagramRendererStatsBlock {
  drawCalls: number
  triangles: number
  frames: number
  /** Frame times in ms since the last reset, for frames drawn back to back. */
  frameMs: number[]
  geometries: number
  textures: number
}

export interface ModelDiagramRendererBlock {
  setScene(scene: ModelDiagramSceneBlock, focus: string | null): void
  /** Re-read the theme's colours from CSS and redraw. */
  retheme(): void
  flyTo(frame: ModelDiagramFrameBlock, instant?: boolean): void
  zoom(factor: number): void
  /** Pulse the focused step's lines once. */
  run(): void
  stats(reset?: boolean): ModelDiagramRendererStatsBlock
  /** Screen rectangles of the labels now showing, for the overlap check. */
  labelRects(): { x0: number; y0: number; x1: number; y1: number; text: string }[]
  dispose(): void
}

export interface ModelDiagramRendererEventsBlock {
  /** A tile was clicked: which grid, and its row and column. */
  onPick(grid: ModelDiagramSceneBlock['grids'][number], row: number, col: number): void
  onStop(stop: string): void
  onFirstFrame?(): void
  /** Things laid over the drawing (buttons, a legend), in the stage's own pixels: labels keep clear of them. */
  obstacles?(): { x0: number; y0: number; x1: number; y1: number }[]
}

const TOKENS = ['bg', 'fg', 'muted', 'tile', 'slab', 'bar', 'neuron', 'rule', 'ex', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']

export function createModelDiagramRendererBlock(
  stage: HTMLElement, labelLayer: HTMLElement, tokenRoot: HTMLElement, events: ModelDiagramRendererEventsBlock,
): ModelDiagramRendererBlock {
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  stage.appendChild(renderer.domElement)
  const scene3 = new THREE.Scene()
  const Yax = new THREE.Vector3(0, 1, 0)
  const TILT = new THREE.Vector3(-0.15, 0.17, 1).normalize()
  const camera = new THREE.PerspectiveCamera(28, 1.8, 0.5, 1200)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.enablePan = true; controls.screenSpacePanning = true; controls.enableZoom = false
  controls.minPolarAngle = 0.75; controls.maxPolarAngle = 1.75; controls.minAzimuthAngle = -0.95; controls.maxAzimuthAngle = 0.7
  scene3.add(new THREE.AmbientLight(0xffffff, 0.86))
  const sun = new THREE.DirectionalLight(0xffffff, 0.42); sun.position.set(-6, 9, 12); scene3.add(sun)
  const root = new THREE.Group(); scene3.add(root)
  const detail = new THREE.Group(); scene3.add(detail)

  // Shared shapes and materials, made once and reused by every scene.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8)
  const ballGeo = new THREE.SphereGeometry(1, 14, 10)
  const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const slabGlass = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true })
  const rodMats = new Map<number, THREE.MeshBasicMaterial>()
  const rodMat = (opacity: number) => {
    let m = rodMats.get(opacity)
    if (!m) { m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: opacity < 1, opacity }); rodMats.set(opacity, m) }
    return m
  }
  const circleTex = new Map<string, THREE.CanvasTexture>()
  const spriteMats = new Map<string, THREE.SpriteMaterial>()

  // ---- colours
  const css: Record<string, string> = {}
  const K: Record<string, THREE.Color> = {}
  const readTokens = () => {
    // Read each token as the browser resolves it (a token may point at the host app's own colours), through one probe element.
    const probe = document.createElement('span')
    probe.style.display = 'none'; tokenRoot.appendChild(probe)
    for (const n of TOKENS) {
      probe.style.color = ''; probe.style.color = `var(--${n})`
      const got = getComputedStyle(probe).color
      const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(got)
      css[n] = m ? `rgb(${Math.round(+m[1])}, ${Math.round(+m[2])}, ${Math.round(+m[3])})` : '#888888'
      K[n] = new THREE.Color(css[n])
    }
    probe.remove()
  }
  const tmpCol = new THREE.Color()
  const colour = (c: Col, into = tmpCol) => {
    if (typeof c === 'string') return into.copy(K[c] ?? K.fg)
    into.copy(K[c[0] as string] ?? K.fg)
    for (let k = 1; k + 1 < c.length; k += 2) into.lerp(K[c[k] as string] ?? K.fg, c[k + 1] as number)
    return into
  }

  // ---- state
  let scene: ModelDiagramSceneBlock | null = null
  let focus: string | null = null
  let tiles: THREE.InstancedMesh | null = null
  let tileStarts: number[] = []
  let sprites: { stop: string; s: THREE.Sprite }[] = []
  let pulses: THREE.Mesh[] = []
  let plines: [THREE.Vector3, THREE.Vector3, boolean][] = []
  let fly: { t0: number; p0: THREE.Vector3; q0: THREE.Vector3; p1: THREE.Vector3; q1: THREE.Vector3 } | null = null
  let runAt: number | null = null
  let raf = 0
  let disposed = false
  let firstFrame = false
  let lastFrameAt = 0
  let lastFrame: ModelDiagramFrameBlock | null = null
  const stat = { frames: 0, frameMs: [] as number[] }
  interface Lab { l: ModelDiagramLabelBlock; el: HTMLElement; on: boolean; w: number; h: number; sw: number; sh: number; p: THREE.Vector3; shown: string; tx: string }
  let labs: Lab[] = []
  let labelsDirty = true

  const invalidate = () => { if (!raf && !disposed) raf = requestAnimationFrame(tick) }
  const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2])

  const wipe = (g: THREE.Group) => {
    while (g.children.length) {
      const o = g.children.pop() as THREE.Object3D & { geometry?: THREE.BufferGeometry; dispose?: () => void }
      if (o.geometry && o.geometry !== boxGeo && o.geometry !== cylGeo && o.geometry !== ballGeo) o.geometry.dispose()
      if ((o as THREE.InstancedMesh).isInstancedMesh) o.dispose?.()
      if (o.userData.ownMaterial) ((o as unknown as THREE.Mesh).material as THREE.Material).dispose()
    }
  }

  const texCircle = (text: string) => {
    const key = `${css.bg}|${css.neuron}|${text}`
    let tex = circleTex.get(key)
    if (tex) return tex
    const cv = document.createElement('canvas'); cv.width = cv.height = 256
    const g = cv.getContext('2d')!
    g.fillStyle = css.bg; g.beginPath(); g.arc(128, 128, 112, 0, 6.2832); g.fill(); g.lineWidth = 12; g.strokeStyle = css.neuron; g.stroke()
    g.fillStyle = css.neuron; g.textAlign = 'center'; g.textBaseline = 'middle'
    const ps = text.split('|'), font = '"IBM Plex Sans",system-ui,sans-serif'
    if (ps.length === 3) {
      g.font = `600 74px ${font}`; g.fillText(ps[0], 128, 84); g.font = `500 40px ${font}`; g.fillText(ps[1], 128, 133); g.font = `500 46px ${font}`; g.fillText(ps[2], 128, 180)
    } else { g.font = `600 ${text.length > 3 ? 52 : 92}px ${font}`; g.fillText(text, 128, 132) }
    tex = new THREE.CanvasTexture(cv); circleTex.set(key, tex)
    return tex
  }
  const spriteMat = (text: string) => {
    const key = `${css.bg}|${css.neuron}|${text}`
    let m = spriteMats.get(key)
    if (!m) { m = new THREE.SpriteMaterial({ map: texCircle(text), transparent: true }); spriteMats.set(key, m) }
    return m
  }
  const dropCircles = () => {
    for (const m of spriteMats.values()) m.dispose(); spriteMats.clear()
    for (const t of circleTex.values()) t.dispose(); circleTex.clear()
  }

  // Rods of one opacity as a single instanced mesh.
  const mt = new THREE.Matrix4(), qi = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), dir = new THREE.Vector3()
  const rodsInto = (group: THREE.Group, rods: { a: V3; b: V3; r: number; color: Col; opacity: number }[]) => {
    const by = new Map<number, typeof rods>()
    for (const r of rods) { const l = by.get(r.opacity); if (l) l.push(r); else by.set(r.opacity, [r]) }
    for (const [opacity, list] of by) {
      const im = new THREE.InstancedMesh(cylGeo, rodMat(opacity), list.length)
      list.forEach((r, n) => {
        dir.set(r.b[0] - r.a[0], r.b[1] - r.a[1], r.b[2] - r.a[2])
        const len = dir.length()
        ps.set(r.a[0] + dir.x / 2, r.a[1] + dir.y / 2, r.a[2] + dir.z / 2)
        qi.setFromUnitVectors(Yax, len ? dir.multiplyScalar(1 / len) : dir.set(0, 1, 0))
        sc.set(r.r, len, r.r); mt.compose(ps, qi, sc); im.setMatrixAt(n, mt); im.setColorAt(n, colour(r.color))
      })
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.frustumCulled = false
      group.add(im)
    }
  }

  const build = () => {
    wipe(root); sprites = []; tiles = null; tileStarts = []
    if (!scene) return
    scene3.background = K.bg
    const s = scene
    const ident = new THREE.Quaternion()

    // slabs: solid ones, glass ones (back to front), and their edges
    for (const glass of [false, true]) {
      const list = s.slabs.filter((x) => (x.opacity < 1) === glass)
      if (!list.length) continue
      const im = new THREE.InstancedMesh(boxGeo, glass ? slabGlass : slabMat, list.length)
      list.forEach((x, n) => { ps.set(x.c[0], x.c[1], x.c[2]); sc.set(x.w, x.h, x.d); mt.compose(ps, ident, sc); im.setMatrixAt(n, mt); im.setColorAt(n, colour(x.color)) })
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.frustumCulled = false
      root.add(im)
    }
    const segs: number[] = [], cols: number[] = []
    const seg = (a: V3, b: V3, c: THREE.Color, o: number) => { segs.push(a[0], a[1], a[2], b[0], b[1], b[2]); cols.push(c.r, c.g, c.b, o, c.r, c.g, c.b, o) }
    for (const x of s.slabs) {
      const c = colour(x.edge), [x0, x1, y0, y1, z0, z1] = [x.c[0] - x.w / 2, x.c[0] + x.w / 2, x.c[1] - x.h / 2, x.c[1] + x.h / 2, x.c[2] - x.d / 2, x.c[2] + x.d / 2]
      for (const z of [z0, z1]) { seg([x0, y0, z], [x1, y0, z], c, x.edgeOpacity); seg([x1, y0, z], [x1, y1, z], c, x.edgeOpacity); seg([x1, y1, z], [x0, y1, z], c, x.edgeOpacity); seg([x0, y1, z], [x0, y0, z], c, x.edgeOpacity) }
      for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) seg([px, py, z0], [px, py, z1], c, x.edgeOpacity)
    }
    for (const l of s.lines) seg(l.a, l.b, colour(l.color), l.opacity)
    if (segs.length) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4))
      const ls = new THREE.LineSegments(g, lineMat); ls.frustumCulled = false; root.add(ls)
    }

    // every tile of every grid, as one instanced mesh
    let total = 0
    for (const g of s.grids) { tileStarts.push(total); total += g.nR * g.nC }
    if (total) {
      const im = new THREE.InstancedMesh(boxGeo, tileMat, total)
      let n = 0
      for (const g of s.grids) {
        const side = g.p * 0.86
        for (let r = 0; r < g.nR; r++) for (let c = 0; c < g.nC; c++) {
          const k = r * g.nC + c, hh = g.heights[k]
          ps.set(g.cx + (c - (g.nC - 1) / 2) * g.p, g.cy - (r - (g.nR - 1) / 2) * g.p, hh / 2); sc.set(side, side, hh)
          mt.compose(ps, ident, sc); im.setMatrixAt(n, mt); im.setColorAt(n, colour(g.colors[k])); n++
        }
      }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.frustumCulled = false
      root.add(im); tiles = im
    }

    rodsInto(root, s.rods)
    for (const d of s.dots) {
      const m = new THREE.Mesh(ballGeo, rodMat(1).clone()); (m.material as THREE.MeshBasicMaterial).color.copy(colour(d.color))
      m.userData.ownMaterial = true; m.position.set(d.p[0], d.p[1], d.p[2]); m.scale.setScalar(d.r); root.add(m)
    }
    for (const x of s.sprites) {
      const sp = new THREE.Sprite(spriteMat(x.text)); sp.position.set(x.p[0], x.p[1], x.p[2]); sp.scale.set(1.4, 1.4, 1); root.add(sp)
      sprites.push({ stop: x.stop, s: sp })
    }
    buildLabels(); buildDetail()
  }

  // Thick dashed lines and moving dots for the step in focus only.
  const buildDetail = () => {
    wipe(detail); pulses = []; plines = []
    const st = scene && focus ? scene.stops.find((x) => x.id === focus) : null
    if (!st) { runAt = null; return }
    const dashes: { a: V3; b: V3; r: number; color: Col; opacity: number }[] = []
    for (const l of st.detail) {
      const a = v(l.a), b = v(l.b), n = Math.max(8, Math.round(a.distanceTo(b) / 0.9))
      for (let k = 0; k < n; k++) {
        const p = a.clone().lerp(b, k / n), q = a.clone().lerp(b, (k + 0.56) / n)
        dashes.push({ a: [p.x, p.y, p.z], b: [q.x, q.y, q.z], r: l.r, color: l.color, opacity: l.opacity })
      }
      plines.push([a, b, false])
      const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: colour(l.color).clone() })); m.userData.ownMaterial = true; m.scale.setScalar(0.1); m.visible = false; detail.add(m); pulses.push(m)
    }
    plines.push([v(st.out[0]), v(st.out[1]), true])
    const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: K.neuron.clone() })); m.userData.ownMaterial = true; m.scale.setScalar(0.13); m.visible = false; detail.add(m); pulses.push(m)
    rodsInto(detail, dashes)
    if (!still) runAt = performance.now() + 700
  }

  // ---- labels: one overlay layer, built when the scene changes, moved only when the camera does
  const buildLabels = () => {
    labelLayer.textContent = ''
    labelLayer.classList.toggle('dense', Boolean(scene?.dense))
    labelLayer.appendChild(leaders); leaderPath.setAttribute('d', ''); leaderD = ''
    labs = []
    if (!scene) return
    const st = focus ? scene.stops.find((x) => x.id === focus) : null
    const show = new Set<string>(['*'])
    if (st) { show.add(`step:${st.id}`); for (const k of st.bars) show.add(`bar:${k}`) }
    const frag = document.createDocumentFragment()
    for (const l of scene.labels) {
      if (!show.has(l.tag)) continue
      const el = document.createElement('div')
      el.className = `lab ${l.cls}${l.stop && l.stop === focus ? ' cur' : ''}`
      for (const [cls, text] of l.parts) { const sp = document.createElement('span'); if (cls) sp.className = cls; sp.textContent = text; el.appendChild(sp) }
      if (l.slot) el.style.borderColor = `var(--c${l.slot})`
      if (l.stop) { const id = l.stop; el.addEventListener('click', () => events.onStop(id)) }
      el.style.visibility = 'hidden'
      frag.appendChild(el)
      labs.push({ l, el, on: true, w: 0, h: 0, sw: 0, sh: 0, p: v(l.p), shown: '', tx: '' })
    }
    labelLayer.appendChild(frag)
    // one read pass for every size, after one write pass
    for (const b of labs) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight }
    for (const b of labs) if (b.l.short) { b.sw = 12 + 8 * b.l.short.length; b.sh = b.h }
    labelsDirty = true
  }
  // Thin lines from a title that had to move back to the step it names.
  const SVG = 'http://www.w3.org/2000/svg'
  const leaders = document.createElementNS(SVG, 'svg'), leaderPath = document.createElementNS(SVG, 'path')
  leaders.setAttribute('class', 'leaders'); leaders.appendChild(leaderPath)
  let leaderD = ''
  const q3 = new THREE.Vector3()
  const placeLabels = () => {
    const w = stage.clientWidth, h = stage.clientHeight
    const boxes: ModelDiagramLabelBoxBlock[] = []
    const tight = true
    const idx: number[] = []
    labs.forEach((b, n) => {
      q3.copy(b.p).project(camera)
      const vis = b.l.mode === 'dock' || (q3.z < 1 && Math.abs(q3.x) < 1.15 && Math.abs(q3.y) < 1.15)
      if (!vis) { if (b.shown !== 'hidden') { b.el.style.visibility = 'hidden'; b.shown = 'hidden' } return }
      boxes.push({ x: (q3.x * 0.5 + 0.5) * w, y: (-q3.y * 0.5 + 0.5) * h - (b.l.anchor === 'bottom' ? b.h / 2 : 0), w: b.l.mode === 'slide' ? b.w + 2 : b.l.mode && !tight ? Math.max(1, b.w - 2) : b.w, h: b.l.mode === 'slide' ? b.h + 1 : b.l.mode && !(tight && b.l.mode === 'nudge') ? Math.max(1, b.h - 5) : b.h, rank: b.l.rank + (b.l.stop && b.l.stop === focus ? 50 : 0) + (b.l.cls.includes(' on') ? 10 : 0), shortW: b.sw || undefined, shortH: b.sh || undefined, mode: b.l.mode, thin: b.l.mode === 'fixed' && (b.l.cls.startsWith('word') || b.l.cls.startsWith('ruler')), keep: b.l.cls.includes(' on') })
      idx.push(n)
    })
    const real = boxes.length
    for (const o of events.obstacles?.() ?? []) boxes.push({ x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2, w: o.x1 - o.x0 + 6, h: o.y1 - o.y0 + 6, rank: 1000, mode: 'fixed' })
    // the drawing's own bars and circles, as rectangles on screen
    const walls: { x0: number; y0: number; x1: number; y1: number }[] = []
    if (scene) {
      const px = (x: number, y: number, z: number): [number, number] | null => { q3.set(x, y, z).project(camera); return q3.z < 1 ? [(q3.x * 0.5 + 0.5) * w, (-q3.y * 0.5 + 0.5) * h] : null }
      const wall = (pts: ([number, number] | null)[], inset: number) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const p of pts) { if (!p) return; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1] }
        if (x1 < 0 || y1 < 0 || x0 > w || y0 > h || x1 - x0 < 2 * inset + 2 || y1 - y0 < 2 * inset + 2) return
        walls.push({ x0: x0 + inset, y0: y0 + inset, x1: x1 - inset, y1: y1 - inset })
      }
      for (const g of scene.grids) {
        const a = g.cx - g.w / 2, b = g.cx + g.w / 2, c = g.cy - g.h / 2, d = g.cy + g.h / 2
        wall([px(a, c, 0), px(b, c, 0), px(a, d, 0), px(b, d, 0), px(a, c, 0.5), px(b, c, 0.5), px(a, d, 0.5), px(b, d, 0.5)], 3)
      }
      for (const sp of scene.sprites) wall([px(sp.p[0] - 0.7, sp.p[1] - 0.7, sp.p[2]), px(sp.p[0] + 0.7, sp.p[1] + 0.7, sp.p[2])], 2)
    }
    const place = placeModelDiagramLabelsBlock(boxes, walls, { w, h })
    let d = ''
    place.forEach(({ fate: f, dx, dy }, k) => {
      if (k >= real) return
      const b = labs[idx[k]], box = boxes[k]
      if (f !== b.shown) {
        if (b.l.short && (f === 'short') !== (b.shown === 'short')) (b.el.firstChild as HTMLElement).textContent = f === 'short' ? b.l.short : b.l.parts[0][1]
        b.el.style.visibility = f === 'hidden' ? 'hidden' : 'visible'; b.shown = f
      }
      if (f === 'hidden') return
      const tx = `translate(${(box.x + dx).toFixed(1)}px,${(box.y + dy).toFixed(1)}px) translate(-50%,-50%)`
      if (tx !== b.tx) { b.el.style.transform = tx; b.tx = tx }
      if (b.l.stop && (dx || Math.abs(dy) > 1)) d += `M${(box.x + dx).toFixed(1)} ${(box.y + dy).toFixed(1)}L${box.x.toFixed(1)} ${(box.y + b.h / 2).toFixed(1)}`
    })
    if (d !== leaderD) { leaderPath.setAttribute('d', d); leaderD = d }
  }

  // ---- camera
  const camFor = (f: ModelDiagramFrameBlock) => {
    const th = Math.tan((14 * Math.PI) / 180), d = Math.max(f.hh / th, f.hw / (th * camera.aspect)) * 1.06, t = new THREE.Vector3(f.cx, f.cy, 0)
    return { t, p: TILT.clone().multiplyScalar(d).add(t) }
  }
  const flyTo = (f: ModelDiagramFrameBlock, instant?: boolean) => {
    lastFrame = f
    const c = camFor(f)
    if (instant || still) { camera.position.copy(c.p); controls.target.copy(c.t); fly = null } else fly = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: c.p, q1: c.t }
    invalidate()
  }
  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix()
    if (lastFrame) flyTo(lastFrame, true)
    labelsDirty = true; invalidate()
  }

  // ---- the frame: drawn only while something is moving
  const camWas = new THREE.Matrix4()
  function tick(now: number) {
    raf = 0
    if (disposed) return
    let moving = false
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / 800), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.q0, fly.q1, e)
      if (k >= 1) fly = null
      moving = true
    }
    if (controls.update()) moving = true
    let pop = 1
    if (runAt !== null) {
      moving = true
      if (now >= runAt) {
        const kk = (now - runAt) / 1500
        pulses.forEach((p, n) => {
          const l = plines[n]
          if (l[2]) { if (kk >= 0.72 && kk < 1) { p.visible = true; p.position.copy(l[0]).lerp(l[1], (kk - 0.72) / 0.28) } else p.visible = false }
          else if (kk < 0.55) { p.visible = true; p.position.copy(l[0]).lerp(l[1], kk / 0.55) } else p.visible = false
        })
        if (kk >= 0.55 && kk < 0.72) pop = 1 + 0.2 * Math.sin((Math.PI * (kk - 0.55)) / 0.17)
        if (kk >= 1) { runAt = null; for (const p of pulses) p.visible = false }
      }
    }
    for (const x of sprites) x.s.scale.setScalar(1.4 * (x.stop === focus ? pop : 1))
    camera.updateMatrixWorld()
    if (labelsDirty || !camWas.equals(camera.matrixWorld)) { placeLabels(); camWas.copy(camera.matrixWorld); labelsDirty = false }
    renderer.render(scene3, camera)
    stat.frames++
    if (lastFrameAt && now - lastFrameAt < 100) stat.frameMs.push(now - lastFrameAt)
    lastFrameAt = moving ? now : 0
    if (!firstFrame && scene) { firstFrame = true; events.onFirstFrame?.() }
    if (moving) invalidate()
  }

  // ---- pointer
  const canvas = renderer.domElement
  let down: [number, number] | null = null
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; invalidate() }
  const onUp = (e: PointerEvent) => {
    if (!down) return
    const d = Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]); down = null
    if (d > 6 || !tiles || !scene) return
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera)
    const hit = ray.intersectObject(tiles)[0]
    if (!hit || hit.instanceId === undefined) return
    let g = 0
    while (g + 1 < tileStarts.length && tileStarts[g + 1] <= hit.instanceId) g++
    const grid = scene.grids[g], k = hit.instanceId - tileStarts[g]
    events.onPick(grid, Math.floor(k / grid.nC), k % grid.nC)
  }
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp)
  controls.addEventListener('change', invalidate)
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null
  ro?.observe(stage)

  readTokens(); size()

  return {
    setScene(next, nextFocus) { scene = next; focus = nextFocus; build(); invalidate() },
    retheme() { readTokens(); dropCircles(); build(); invalidate() },
    flyTo,
    zoom(f) { camera.position.sub(controls.target).multiplyScalar(f).add(controls.target); invalidate() },
    run() { if (!still && focus) { runAt = performance.now(); invalidate() } },
    stats(reset) {
      const out = { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, frames: stat.frames, frameMs: stat.frameMs.slice(), geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }
      if (reset) { stat.frames = 0; stat.frameMs = [] }
      return out
    },
    labelRects() {
      return labs.filter((b) => b.shown === 'full' || b.shown === 'short').map((b) => { const r = b.el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, text: b.el.textContent ?? '' } })
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp)
      controls.removeEventListener('change', invalidate); controls.dispose()
      wipe(root); wipe(detail); dropCircles()
      for (const g of [boxGeo, cylGeo, ballGeo]) g.dispose()
      for (const m of [tileMat, slabMat, slabGlass, lineMat, ...rodMats.values()]) m.dispose()
      renderer.dispose(); renderer.forceContextLoss()
      canvas.remove(); labelLayer.textContent = ''; labs = []; scene = null
    },
  }
}
