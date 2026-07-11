// Force-directed canvas for the vault graph. Wraps the force-graph library
// (dynamically imported — never in the startup bundle) around four ideas:
//
// 1. Layout runs once, then every node is frozen (fx/fy). The timeline scrub
//    is a pure visibility filter over fixed positions, so dragging it costs
//    nothing and the vault visibly grows into its final shape.
// 2. Node color encodes the vault container; a warm ember halo encodes how
//    recently an AI session plausibly touched the note.
// 3. Labels are drawn in one post-render pass with greedy collision
//    rejection — a label that would overlap an already-placed one is simply
//    not drawn. Priority goes hovered > neighbors > degree, so dense
//    clusters stay readable instead of smearing.
// 4. Hover focus eases in and out (~160ms) rather than cutting to black,
//    and the hovered note's metadata lives in a corner card, not on the
//    canvas.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { VaultGraphData, VaultGraphNode } from '@/services/orchestrators/vaultGraphOrch'
import { readFileTooltipMeta } from '@/services/orchestrators/fileSystemOrch'

/** An emphasis lens: matching notes stay lit, the rest recede. */
export type VaultGraphEmphasis =
  | { mode: 'none' }
  /** AI-born notes whose last touch was also AI — not yet made human. */
  | { mode: 'unabsorbed' }
  /** Notes AI touched inside a brushed time window. */
  | { mode: 'window'; startMs: number; endMs: number }
  /** An explicit set of node ids — the AI-activity card's day/session lens. */
  | { mode: 'nodes'; ids: ReadonlySet<string> }

export function vaultGraphEmphasisMatch(emphasis: VaultGraphEmphasis, node: VaultGraphNode): boolean {
  switch (emphasis.mode) {
    case 'none':
      return true
    case 'unabsorbed':
      return node.aiBorn && node.aiTouchMs > 0
    case 'window':
      return node.aiTouchMs >= emphasis.startMs && node.aiTouchMs <= emphasis.endMs
    case 'nodes':
      return emphasis.ids.has(node.id)
  }
}

export const VAULT_GRAPH_FALLBACK_COLOR = '#8A93A6'
const EMBER = '255, 158, 61' // rgb of the AI-heat halo — also the selected node
/** Accent for the frozen selection subgraph: the selected note's neighbors and
 *  the links to them, kept lit and distinct from the live hover highlight. */
const SELECT_NEIGHBOR = '244, 114, 182' // pink-400

const NODE_ALPHA = 0.92
const DIM_NODE_ALPHA = 0.16
const LINK_ALPHA = 0.12
const FOCUS_LINK_ALPHA = 0.5
const DIM_LINK_ALPHA = 0.035
const DIM_EASE_MS = 160
const LABEL_MAX_CHARS = 30
/** Idle labels fade in across this zoom range; below it only hover labels show. */
const IDLE_LABEL_ZOOM_IN = 0.9
const IDLE_LABEL_ZOOM_FULL = 1.6
const MAX_HOVER_LABELS = 24
// Canvas-drawn labels don't inherit CSS theme tokens, so each mode carries its
// own fill + halo: light text on a dark halo for dark mode, dark text on a
// light halo for light mode.
const LABEL_FILL_DARK = 'rgba(198, 206, 218, 1)'
const LABEL_FOCUS_FILL_DARK = 'rgba(238, 242, 248, 1)'
const LABEL_OUTLINE_DARK = 'rgba(14, 16, 20, 0.9)'
const LABEL_FILL_LIGHT = 'rgba(71, 78, 92, 1)'
const LABEL_FOCUS_FILL_LIGHT = 'rgba(17, 21, 28, 1)'
const LABEL_OUTLINE_LIGHT = 'rgba(250, 251, 253, 0.92)'

/** Node radius in graph-world units — grows with degree, capped so hubs don't
 *  blot out the map. */
function nodeRadius(node: VaultGraphNode): number {
  return Math.min(10, 1.8 + Math.sqrt(node.degree) * 0.75)
}

// Floor on a node's on-screen radius (px). Below the fit-all zoom the world
// radius maps to sub-pixel dots, so we lift each node to at least this many
// screen pixels (÷ zoom converts px back to world units) — legible when zoomed
// out without inflating when in. Two tiers, because the floor cuts both ways:
//   - Orphan notes (no links) sit far apart in the outer ring, so a generous
//     floor makes them clearly visible with no overlap risk.
//   - Linked notes pack into tight clusters, so the SAME floor would fuse them
//     into blobs. They get a much smaller floor and keep their true (small)
//     size, so cluster members stay individually resolvable.
const MIN_SCREEN_NODE_PX_ORPHAN = 2.2
const MIN_SCREEN_NODE_PX_LINKED = 1.3

function drawnNodeRadius(node: VaultGraphNode, scale: number): number {
  const floorPx = node.degree > 0 ? MIN_SCREEN_NODE_PX_LINKED : MIN_SCREEN_NODE_PX_ORPHAN
  return Math.max(nodeRadius(node), floorPx / scale)
}

function truncateTitle(title: string): string {
  return title.length > LABEL_MAX_CHARS ? `${title.slice(0, LABEL_MAX_CHARS - 1)}…` : title
}

// force-graph types link endpoints as string | number | node | undefined
// (ids before ingestion, node refs after).
type LinkEndpoint = VaultGraphNode | string | number | undefined

interface GraphLinkResolved {
  source?: LinkEndpoint
  target?: LinkEndpoint
}

function endpointId(end: LinkEndpoint): string {
  return typeof end === 'object' && end !== null ? end.id : String(end ?? '')
}

interface LabelRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

interface VaultGraphCanvasBlockProps {
  data: VaultGraphData
  /** Notes born after this instant are hidden. */
  scrubMs: number
  hiddenProjects: ReadonlySet<string>
  /** Stroke color per project — same palette the AI activity card resolves. */
  projectColors: ReadonlyMap<string, string>
  /** Theme flag — canvas-drawn labels swap fill/halo since they can't read
   *  CSS theme tokens. */
  isDark: boolean
  /** True while the timeline replay runs — enables the birth flash. */
  playing: boolean
  emphasis: VaultGraphEmphasis
  /** A camera fit request: zoom to the given node subset. `nonce` re-triggers
   *  the fit even when the ids are unchanged (re-clicking the same session). */
  zoomTo?: { ids: ReadonlySet<string>; nonce: number } | null
  /** A DOM card that lives in graph-world space: it pans and zooms with the
   *  graph exactly like the home-canvas panels, sliding off as you explore. */
  worldCard?: ReactNode
  /** Fired only for modifier clicks (⌘ / ⌥). Plain clicks toggle the in-canvas
   *  selection and never leave the graph; the parent routes ⌘ → side panel and
   *  ⌥ → explorer off the event's modifier keys. */
  onNodeClick: (node: VaultGraphNode, event: MouseEvent) => void
}

/** Fraction of the card's natural (CSS px) size it opens at in the default
 *  fit-all view. <1 so a fit-everything graph and the card read proportional
 *  instead of the card ballooning over a tiny cluster; zooming in grows both. */
const CARD_OPEN_SCALE = 0.42
/** How far below the viewport bottom the card's bottom-right corner is pinned at
 *  open, so it sits low in the frame. It pans with the graph, so anything past
 *  the fold is just a pan away. */
const CARD_OPEN_DROP_PX = 170

export default function VaultGraphCanvasBlock({
  data,
  scrubMs,
  hiddenProjects,
  projectColors,
  isDark,
  playing,
  emphasis,
  zoomTo,
  worldCard,
  onNodeClick,
}: VaultGraphCanvasBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // The world-anchored card + its anchor: a fixed graph-world point plus the
  // reference zoom baseline, so its scale tracks the graph 1:1 from that point.
  const worldCardRef = useRef<HTMLDivElement | null>(null)
  const worldCardAnchorRef = useRef<{ x: number; y: number; baseK: number } | null>(null)
  // force-graph instance — untyped ref because the lib loads dynamically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null)
  const [hoverInfo, setHoverInfo] = useState<VaultGraphNode | null>(null)
  // Persistent selection from a plain click — outlives hover and survives
  // pan/zoom, so the picked note's connections stay lit while you explore.
  const [selectedNode, setSelectedNode] = useState<VaultGraphNode | null>(null)
  const [hoverSummary, setHoverSummary] = useState<string | null>(null)
  // The note whose metadata the corner card shows: live hover wins, else the
  // standing selection.
  const detailNode = hoverInfo ?? selectedNode
  // Frontmatter summaries read lazily on hover; capped so a long browse
  // session doesn't hold thousands of strings.
  const summaryCacheRef = useRef(new Map<string, string | null>())

  // Mutable view state read by the paint/visibility closures each frame, so
  // scrubbing and hovering never rebuild accessors or graph data.
  const viewRef = useRef({
    scrubMs,
    hidden: hiddenProjects,
    colors: projectColors,
    isDark,
    playing,
    flashWindowMs: 0,
    emphasis: emphasis as VaultGraphEmphasis,
    hover: null as VaultGraphNode | null,
    // Focus survives hover=null so the dim can ease back out from the same
    // neighborhood instead of snapping.
    focusId: null as string | null,
    focusNeighbors: new Set<string>(),
    // Standing selection — its neighborhood stays lit (in accent colors) as a
    // frozen layer beneath the live hover highlight.
    selectedId: null as string | null,
    selectedNeighbors: new Set<string>(),
    dimEase: 0, // 0 = idle, 1 = fully focused
  })
  viewRef.current.scrubMs = scrubMs
  viewRef.current.hidden = hiddenProjects
  viewRef.current.colors = projectColors
  viewRef.current.isDark = isDark
  viewRef.current.selectedId = selectedNode?.id ?? null
  viewRef.current.playing = playing
  viewRef.current.emphasis = emphasis
  viewRef.current.flashWindowMs = Math.max(86_400_000, (data.maxBirthMs - data.minBirthMs) * 0.02)

  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const link of data.links as GraphLinkResolved[]) {
      const a = endpointId(link.source)
      const b = endpointId(link.target)
      let setA = map.get(a)
      if (!setA) map.set(a, (setA = new Set()))
      setA.add(b)
      let setB = map.get(b)
      if (!setB) map.set(b, (setB = new Set()))
      setB.add(a)
    }
    return map
  }, [data])

  const adjacencyRef = useRef(adjacency)
  adjacencyRef.current = adjacency

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let dimRaf = 0
    let wheelHandler: ((e: WheelEvent) => void) | null = null

    // force-graph + d3-force-3d (its own force lib) load together in the graph
    // route chunk — never the startup bundle.
    void Promise.all([import('force-graph'), import('d3-force-3d')]).then(
      ([{ default: ForceGraph }, { forceCollide }]) => {
      if (disposed || !containerRef.current) return
      const view = viewRef.current

      const nodeVisible = (node: VaultGraphNode) =>
        node.birthMs <= view.scrubMs && !view.hidden.has(node.project)

      const inFocus = (id: string) =>
        view.focusId !== null && (id === view.focusId || view.focusNeighbors.has(id))

      // In the frozen selection subgraph (selected note or one of its neighbors).
      const inSelection = (id: string) =>
        view.selectedId !== null && (id === view.selectedId || view.selectedNeighbors.has(id))

      const emphasized = (node: VaultGraphNode) => vaultGraphEmphasisMatch(view.emphasis, node)

      function pokeRedraw() {
        // Re-setting an accessor marks the scene dirty without touching data.
        graph.nodeVisibility(graph.nodeVisibility())
      }

      // ── World-anchored control card ──
      // The anchor is a graph-world point tied to the card's BOTTOM-RIGHT corner
      // plus a reference zoom (baseK). Each frame we map the point back to screen
      // space and lay the card up-and-left of it, scaled by zoom/baseK — so it
      // pans and zooms with the graph like a home-canvas panel and sits in the
      // bottom-right corner rather than on top of the nodes. baseK is set ABOVE
      // the fit zoom (see anchorWorldCard) so the card opens at CARD_OPEN_SCALE,
      // proportional to a fit-everything graph instead of ballooning over it.
      function syncWorldCard(kOverride?: number) {
        const el = worldCardRef.current
        const anchor = worldCardAnchorRef.current
        if (!el || !anchor) return
        const card = el.firstElementChild
        const cw = card instanceof HTMLElement ? card.offsetWidth : 880
        const ch = card instanceof HTMLElement ? card.offsetHeight : 640
        const s = graph.graph2ScreenCoords(anchor.x, anchor.y)
        const k = (kOverride ?? graph.zoom()) / anchor.baseK
        el.style.transform = `translate(${s.x - cw * k}px, ${s.y - ch * k}px) scale(${k})`
      }
      function anchorWorldCard() {
        const host = containerRef.current
        if (!worldCardRef.current || !host) return
        // Pin the card's bottom-right to the viewport's bottom-right corner, and
        // set baseK = fitZoom / CARD_OPEN_SCALE so the card renders at
        // CARD_OPEN_SCALE of its natural size at this default view.
        const world = graph.screen2GraphCoords(
          host.clientWidth - 20,
          host.clientHeight - 20 + CARD_OPEN_DROP_PX,
        )
        worldCardAnchorRef.current = {
          x: world.x,
          y: world.y,
          baseK: graph.zoom() / CARD_OPEN_SCALE,
        }
        worldCardRef.current.style.opacity = '1'
        syncWorldCard()
      }

      // Ease the focus dim toward `target` (0 idle / 1 focused), redrawing
      // each frame. Clears the focus set once fully idle.
      function animateDim(target: number) {
        cancelAnimationFrame(dimRaf)
        let last = performance.now()
        const tick = (now: number) => {
          const dt = now - last
          last = now
          const step = dt / DIM_EASE_MS
          view.dimEase =
            target > view.dimEase
              ? Math.min(target, view.dimEase + step)
              : Math.max(target, view.dimEase - step)
          pokeRedraw()
          if (view.dimEase !== target) {
            dimRaf = requestAnimationFrame(tick)
          } else if (target === 0) {
            view.focusId = null
            view.focusNeighbors = new Set()
            pokeRedraw()
          }
        }
        dimRaf = requestAnimationFrame(tick)
      }

      const lerp = (from: number, to: number) => from + (to - from) * view.dimEase

      // ── Post-render label pass with greedy collision rejection ──
      const placedRects: LabelRect[] = []
      function tryPlaceLabel(
        ctx: CanvasRenderingContext2D,
        node: VaultGraphNode,
        scale: number,
        alpha: number,
        focused: boolean,
        force: boolean,
      ): void {
        const fontSize = (focused ? 12.5 : 11) / scale
        ctx.font = `${focused ? '600 ' : ''}${fontSize}px ui-sans-serif, system-ui, sans-serif`
        const text = truncateTitle(node.title)
        const width = ctx.measureText(text).width
        const x = node.x ?? 0
        const y = (node.y ?? 0) + nodeRadius(node) + 2 / scale
        const pad = 3 / scale
        const rect: LabelRect = {
          x0: x - width / 2 - pad,
          y0: y - pad,
          x1: x + width / 2 + pad,
          y1: y + fontSize + pad,
        }
        if (!force) {
          for (const placed of placedRects) {
            if (rectsOverlap(rect, placed)) return
          }
        }
        placedRects.push(rect)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.globalAlpha = alpha
        ctx.strokeStyle = view.isDark ? LABEL_OUTLINE_DARK : LABEL_OUTLINE_LIGHT
        ctx.lineWidth = 3 / scale
        ctx.lineJoin = 'round'
        ctx.strokeText(text, x, y)
        ctx.fillStyle = view.isDark
          ? focused
            ? LABEL_FOCUS_FILL_DARK
            : LABEL_FILL_DARK
          : focused
            ? LABEL_FOCUS_FILL_LIGHT
            : LABEL_FILL_LIGHT
        ctx.fillText(text, x, y)
        ctx.globalAlpha = 1
      }

      function drawLabels(ctx: CanvasRenderingContext2D, scale: number) {
        placedRects.length = 0
        const el = containerRef.current
        if (!el) return
        // Viewport bounds in graph coordinates — labels outside are skipped.
        const tl = graph.screen2GraphCoords(0, 0)
        const br = graph.screen2GraphCoords(el.clientWidth, el.clientHeight)
        const margin = 20 / scale
        const onScreen = (n: VaultGraphNode) =>
          (n.x ?? 0) > tl.x - margin &&
          (n.x ?? 0) < br.x + margin &&
          (n.y ?? 0) > tl.y - margin &&
          (n.y ?? 0) < br.y + margin

        const nodes = graph.graphData().nodes as VaultGraphNode[]

        if (view.focusId !== null && view.dimEase > 0.05) {
          const focusNode = nodes.find(n => n.id === view.focusId)
          if (focusNode && nodeVisible(focusNode)) {
            tryPlaceLabel(ctx, focusNode, scale, Math.min(1, view.dimEase * 1.4), true, true)
          }
          const neighbors = nodes
            .filter(n => view.focusNeighbors.has(n.id) && nodeVisible(n) && onScreen(n))
            .sort((a, b) => b.degree - a.degree)
            .slice(0, MAX_HOVER_LABELS)
          for (const node of neighbors) {
            tryPlaceLabel(ctx, node, scale, 0.8 * view.dimEase, false, false)
          }
          return
        }

        // Idle: labels surface progressively with zoom, most-linked first.
        // A lens keeps a handful of names visible at any zoom — the lit
        // notes are the whole point of looking.
        if (view.emphasis.mode === 'none' && scale < IDLE_LABEL_ZOOM_IN) return
        const zoomK = Math.max(
          view.emphasis.mode === 'none' ? 0 : 0.15,
          Math.min(1, (scale - IDLE_LABEL_ZOOM_IN) / (IDLE_LABEL_ZOOM_FULL - IDLE_LABEL_ZOOM_IN)),
        )
        const budget = Math.round(8 + zoomK * 52)
        // Under a lens, only lit notes deserve names.
        const candidates = nodes
          .filter(
            n =>
              nodeVisible(n) &&
              onScreen(n) &&
              (view.emphasis.mode === 'none' ? n.degree >= 2 || scale > 3 : emphasized(n)),
          )
          .sort((a, b) => b.degree - a.degree)
          .slice(0, budget)
        const alpha = (0.35 + 0.45 * zoomK) * (1 - view.dimEase)
        for (const node of candidates) {
          tryPlaceLabel(ctx, node, scale, alpha, false, false)
        }
      }

      const graph = new ForceGraph<VaultGraphNode>(containerRef.current)
        .width(container.clientWidth)
        .height(container.clientHeight)
        .nodeId('id')
        .nodeVisibility(nodeVisible)
        .linkVisibility((link: GraphLinkResolved) => {
          const s = link.source as VaultGraphNode
          const t = link.target as VaultGraphNode
          return typeof s === 'object' && typeof t === 'object' && nodeVisible(s) && nodeVisible(t)
        })
        .linkColor((link: GraphLinkResolved) => {
          // Frozen selection links: always cyan, on top of any hover dim, so the
          // selected note's connections stay legible while you explore.
          if (
            view.selectedId !== null &&
            (endpointId(link.source) === view.selectedId ||
              endpointId(link.target) === view.selectedId)
          ) {
            return `rgba(${SELECT_NEIGHBOR}, 0.85)`
          }
          if (view.dimEase > 0 && view.focusId !== null) {
            const touches =
              endpointId(link.source) === view.focusId || endpointId(link.target) === view.focusId
            const alpha = touches ? lerp(LINK_ALPHA, FOCUS_LINK_ALPHA) : lerp(LINK_ALPHA, DIM_LINK_ALPHA)
            return `rgba(150, 160, 175, ${alpha.toFixed(3)})`
          }
          if (view.emphasis.mode !== 'none') {
            const s = link.source as VaultGraphNode
            const t = link.target as VaultGraphNode
            const bothMatch =
              typeof s === 'object' && typeof t === 'object' && emphasized(s) && emphasized(t)
            return `rgba(150, 160, 175, ${bothMatch ? 0.25 : DIM_LINK_ALPHA})`
          }
          return `rgba(140, 150, 165, ${LINK_ALPHA})`
        })
        .linkWidth((link: GraphLinkResolved) => {
          if (
            view.selectedId !== null &&
            (endpointId(link.source) === view.selectedId ||
              endpointId(link.target) === view.selectedId)
          ) {
            return 1.3
          }
          if (view.dimEase === 0 || view.focusId === null) return 0.6
          const touches =
            endpointId(link.source) === view.focusId || endpointId(link.target) === view.focusId
          return touches ? lerp(0.6, 1.1) : 0.6
        })
        .nodeCanvasObject((node: VaultGraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
          const r = drawnNodeRadius(node, scale)
          const x = node.x ?? 0
          const y = node.y ?? 0
          const focused = inFocus(node.id)
          const selMatch = inSelection(node.id)
          const lensMatch = emphasized(node)
          // A lens recedes non-matching notes; hover focus then recedes
          // everything outside the neighborhood on top of that. The frozen
          // selection subgraph is exempt — it stays lit beneath the live hover.
          let alpha = lensMatch ? NODE_ALPHA : DIM_NODE_ALPHA
          let haloScale = lensMatch ? 1 : 0
          if (view.dimEase > 0 && !focused && !selMatch) {
            alpha = Math.min(alpha, lerp(NODE_ALPHA, DIM_NODE_ALPHA))
            haloScale = Math.min(haloScale, 1 - view.dimEase)
          }

          if (node.heat > 0.04 && haloScale > 0.05) {
            ctx.beginPath()
            ctx.arc(x, y, r * (1.8 + node.heat * 2.2), 0, 2 * Math.PI)
            ctx.fillStyle = `rgba(${EMBER}, ${(0.32 * node.heat * haloScale).toFixed(3)})`
            ctx.fill()
          }

          // Birth flash: during replay, a just-born note gets a bright ring
          // so growth reads as sparks appearing, not dots fading in.
          if (view.playing) {
            const sinceBirth = view.scrubMs - node.birthMs
            if (sinceBirth >= 0 && sinceBirth < view.flashWindowMs) {
              const k = 1 - sinceBirth / view.flashWindowMs
              ctx.beginPath()
              ctx.arc(x, y, r + 2.5 * k, 0, 2 * Math.PI)
              ctx.strokeStyle = `rgba(255, 244, 214, ${(0.85 * k).toFixed(3)})`
              ctx.lineWidth = 1.2 / scale + 0.4
              ctx.stroke()
            }
          }

          ctx.beginPath()
          ctx.arc(x, y, r, 0, 2 * Math.PI)
          ctx.globalAlpha = alpha
          // The selected note fills ember-orange; its neighbors keep their
          // project color but pick up a cyan ring below.
          ctx.fillStyle =
            node.id === view.selectedId
              ? `rgb(${EMBER})`
              : view.colors.get(node.project) ?? VAULT_GRAPH_FALLBACK_COLOR
          ctx.fill()
          ctx.globalAlpha = 1

          // Frozen selection neighbor: cyan ring marks it as connected to the
          // selected note, distinct from the live hover highlight.
          if (selMatch && node.id !== view.selectedId) {
            ctx.beginPath()
            ctx.arc(x, y, r + 1.8, 0, 2 * Math.PI)
            ctx.strokeStyle = `rgba(${SELECT_NEIGHBOR}, 0.95)`
            ctx.lineWidth = 1.1 / scale + 0.35
            ctx.stroke()
          }

          // Lens matches carry an ember ring so "lit" reads even at far zoom.
          if (view.emphasis.mode !== 'none' && lensMatch && haloScale > 0.05) {
            ctx.beginPath()
            ctx.arc(x, y, r + 1.2, 0, 2 * Math.PI)
            ctx.strokeStyle = `rgba(${EMBER}, ${(0.7 * haloScale).toFixed(3)})`
            ctx.lineWidth = 0.8 / scale + 0.3
            ctx.stroke()
          }

          if (view.hover === node) {
            ctx.beginPath()
            ctx.arc(x, y, r + 1.6, 0, 2 * Math.PI)
            ctx.strokeStyle = `rgba(235, 240, 248, ${(0.9 * view.dimEase).toFixed(3)})`
            ctx.lineWidth = 1 / scale + 0.3
            ctx.stroke()
          }

          // Standing selection: a crisp ember ring so the picked note stays
          // marked after hover ends and through pan/zoom.
          if (view.selectedId === node.id) {
            ctx.beginPath()
            ctx.arc(x, y, r + 2.4, 0, 2 * Math.PI)
            ctx.strokeStyle = `rgba(${EMBER}, 0.95)`
            ctx.lineWidth = 1.4 / scale + 0.4
            ctx.stroke()
          }
        })
        .nodePointerAreaPaint(
          (node: VaultGraphNode, color: string, ctx: CanvasRenderingContext2D, scale: number) => {
            ctx.beginPath()
            ctx.arc(node.x ?? 0, node.y ?? 0, drawnNodeRadius(node, scale) + 3, 0, 2 * Math.PI)
            ctx.fillStyle = color
            ctx.fill()
          },
        )
        .onRenderFramePost((ctx: CanvasRenderingContext2D, scale: number) => {
          drawLabels(ctx, scale)
          syncWorldCard(scale)
        })
        .onZoom(() => syncWorldCard())
        .onNodeHover((node: VaultGraphNode | null) => {
          view.hover = node
          if (node) {
            view.focusId = node.id
            view.focusNeighbors = adjacencyRef.current.get(node.id) ?? new Set()
            animateDim(1)
          } else if (view.selectedId) {
            // Hover ended but a selection stands — fall back to it instead of
            // clearing, so its neighborhood keeps its focus.
            view.focusId = view.selectedId
            view.focusNeighbors = adjacencyRef.current.get(view.selectedId) ?? new Set()
            animateDim(1)
          } else {
            animateDim(0)
          }
          container.style.cursor = node ? 'pointer' : 'default'
          setHoverInfo(node)
        })
        .onNodeClick((node: VaultGraphNode, event: MouseEvent) => {
          // Modifier clicks leave the graph (⌘ side panel / ⌥ explorer); the
          // parent reads the keys off the event. A plain click only toggles the
          // in-canvas selection.
          if (event.metaKey || event.altKey) {
            onNodeClickRef.current(node, event)
            return
          }
          const wasSelected = view.selectedId === node.id
          if (wasSelected) {
            view.selectedId = null
            view.selectedNeighbors = new Set()
            setSelectedNode(null)
            if (!view.hover) animateDim(0)
            else pokeRedraw()
          } else {
            const neighbors = adjacencyRef.current.get(node.id) ?? new Set<string>()
            view.selectedId = node.id
            view.selectedNeighbors = neighbors
            setSelectedNode(node)
            view.focusId = node.id
            view.focusNeighbors = neighbors
            animateDim(1)
          }
        })
        .onBackgroundClick(() => {
          if (!view.selectedId) return
          view.selectedId = null
          view.selectedNeighbors = new Set()
          setSelectedNode(null)
          if (!view.hover) animateDim(0)
          else pokeRedraw()
        })
        .warmupTicks(80)
        .cooldownTicks(220)
        .onEngineStop(() => {
          // Freeze the settled layout — from here on, scrubbing and filtering
          // are visibility-only and positions never shift under the user.
          const { nodes } = graph.graphData()
          for (const node of nodes as VaultGraphNode[]) {
            node.fx = node.x
            node.fy = node.y
          }
          graph.zoomToFit(600, 48)
          setTimeout(anchorWorldCard, 640)
        })

      graph.d3Force('charge')?.strength(-38)
      // Collision force: dense link-bound clusters would otherwise collapse into
      // overlapping blobs. Giving each node a hard radius pushes cluster members
      // apart into a readable disc. The already-spread outer ring sits well
      // beyond this radius, so it (and the zoom-to-fit framing) is unaffected —
      // only the knots expand.
      graph.d3Force(
        'collide',
        forceCollide((node: VaultGraphNode) => nodeRadius(node) + 5).strength(0.9),
      )

      // ── Interaction model: match the rest of the app's canvases ──
      // The library default (single click-drag pans, wheel zooms) is replaced
      // with the useInfiniteCanvasBlock convention: two-finger trackpad scroll
      // pans, pinch / ⌘+wheel zooms around the cursor. Nodes stay frozen, so
      // node drag is off too — a press is only ever a click.
      graph.enableNodeDrag(false).enablePanInteraction(false).enableZoomInteraction(false)

      wheelHandler = (e: WheelEvent) => {
        e.preventDefault()
        const rect = container.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        if (e.ctrlKey || e.metaKey) {
          // Pinch / ⌘-scroll → zoom, holding the point under the cursor fixed.
          const before = graph.screen2GraphCoords(cx, cy)
          const factor = Math.exp(-e.deltaY * 0.01)
          const k = Math.max(0.05, Math.min(12, graph.zoom() * factor))
          graph.zoom(k, 0)
          const after = graph.screen2GraphCoords(cx, cy)
          const c = graph.centerAt()
          graph.centerAt(c.x + (before.x - after.x), c.y + (before.y - after.y), 0)
        } else {
          // Two-finger scroll → pan. Screen delta → graph delta is /zoom.
          const k = graph.zoom() || 1
          const c = graph.centerAt()
          graph.centerAt(c.x + e.deltaX / k, c.y + e.deltaY / k, 0)
        }
      }
      container.addEventListener('wheel', wheelHandler, { passive: false })

      // Cached data may arrive pre-frozen (fx set) from a previous visit —
      // skip the settle animation and fit immediately.
      const prefrozen = data.nodes.length > 0 && data.nodes[0].fx !== undefined
      graph.graphData({ nodes: data.nodes, links: data.links })
      if (prefrozen) {
        graph.cooldownTicks(0)
        setTimeout(() => {
          graph.zoomToFit(0, 48)
          anchorWorldCard()
        }, 0)
      }

      graphRef.current = graph
    })

    const resizeObserver = new ResizeObserver(() => {
      const el = containerRef.current
      if (el && graphRef.current) {
        graphRef.current.width(el.clientWidth).height(el.clientHeight)
      }
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      cancelAnimationFrame(dimRaf)
      resizeObserver.disconnect()
      if (wheelHandler) container.removeEventListener('wheel', wheelHandler)
      if (graphRef.current) {
        graphRef.current._destructor()
        graphRef.current = null
      }
    }
    // Recreate the graph only when the dataset object itself is replaced.
  }, [data])

  // Scrub / filter / play / lens changes: refs are already updated
  // synchronously above; this effect just marks the canvas dirty.
  useEffect(() => {
    const graph = graphRef.current
    if (graph) graph.nodeVisibility(graph.nodeVisibility())
  }, [scrubMs, hiddenProjects, projectColors, playing, emphasis, isDark])

  // Session-lens zoom: fit the camera to the selected node subset. Keyed on the
  // nonce so re-selecting the same session re-frames it. force-graph's
  // zoomToFit takes a node predicate as its third arg.
  useEffect(() => {
    if (!zoomTo || zoomTo.ids.size === 0) return
    const graph = graphRef.current
    if (!graph) return
    const ids = zoomTo.ids
    graph.zoomToFit(600, 80, (node: VaultGraphNode) => ids.has(node.id))
  }, [zoomTo])

  // Frontmatter summary for the corner card (hovered or selected note) — read
  // lazily, debounced, cached.
  const detailId = detailNode?.id ?? null
  useEffect(() => {
    if (!detailId) {
      setHoverSummary(null)
      return
    }
    const path = detailId
    const cache = summaryCacheRef.current
    if (cache.has(path)) {
      setHoverSummary(cache.get(path) ?? null)
      return
    }
    setHoverSummary(null)
    const timer = setTimeout(() => {
      void readFileTooltipMeta(path).then(meta => {
        const summary = meta?.summary ?? null
        if (cache.size > 500) cache.clear()
        cache.set(path, summary)
        // Only surface if the card still points at the same note.
        const current = viewRef.current.hover?.id ?? viewRef.current.selectedId
        if (current === path) setHoverSummary(summary)
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [detailId])

  const hoverAiAgeDays =
    detailNode && detailNode.heat > 0.04
      ? Math.round(Math.log(detailNode.heat) / Math.log(0.5) * 21)
      : null

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
      {/* World-anchored control card — transform is driven imperatively each
          frame by syncWorldCard so it tracks the graph's pan and zoom. */}
      {worldCard && (
        <div
          ref={worldCardRef}
          className="absolute left-0 top-0 origin-top-left opacity-0 [will-change:transform]"
        >
          {worldCard}
        </div>
      )}
      {/* Detail card: metadata for the hovered or selected note, off the canvas. */}
      {detailNode && (
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-lg border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
          <p className="text-sm font-medium leading-snug">{detailNode.title}</p>
          <p className="mt-0.5 break-all font-mono text-[10px] leading-tight text-muted-foreground/70">
            {detailNode.id}
          </p>
          {hoverSummary && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{hoverSummary}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: projectColors.get(detailNode.project) ?? VAULT_GRAPH_FALLBACK_COLOR,
                }}
              />
              {detailNode.project}
            </span>
            <span className="font-mono tabular-nums">
              {detailNode.degree} {detailNode.degree === 1 ? 'link' : 'links'}
            </span>
            <span className="font-mono tabular-nums">
              born{' '}
              {new Date(detailNode.birthMs).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
              })}
            </span>
            {hoverAiAgeDays !== null && (
              <span className="font-mono tabular-nums" style={{ color: `rgb(${EMBER})` }}>
                AI · {hoverAiAgeDays <= 0 ? 'today' : `${hoverAiAgeDays}d ago`}
              </span>
            )}
          </div>
          {/* Shortcut affordance for the selected note. */}
          {selectedNode?.id === detailNode.id && (
            <p className="mt-1.5 border-t border-border/60 pt-1.5 font-mono text-[10px] leading-tight text-muted-foreground/70">
              ⌘ click → side panel · ⌥ click → explorer
            </p>
          )}
        </div>
      )}
    </div>
  )
}
