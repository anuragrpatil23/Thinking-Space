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
  /** An explicit set of node ids — the AI-activity card's day/session lens. */
  | { mode: 'nodes'; ids: ReadonlySet<string> }

export function vaultGraphEmphasisMatch(emphasis: VaultGraphEmphasis, node: VaultGraphNode): boolean {
  switch (emphasis.mode) {
    case 'none':
      return true
    case 'unabsorbed':
      return node.aiBorn && node.aiTouchMs > 0
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
// Region names sit under low alpha (map-style, they fade as you zoom in), so on
// a near-black canvas the standard node fill reads muddy. They get a brighter
// dedicated fill so the small-caps stay legible at their reduced opacity.
const LABEL_REGION_FILL_DARK = 'rgba(232, 237, 246, 1)'
const LABEL_REGION_FILL_LIGHT = LABEL_FILL_LIGHT

/** Node radius in graph-world units — grows with degree, capped so hubs don't
 *  blot out the map. */
function nodeRadius(node: VaultGraphNode): number {
  return Math.min(10, 1.8 + Math.sqrt(node.degree) * 0.75)
}

// Upper bound on the camera zoom when framing a node subset. force-graph's
// zoomToFit maxes out the zoom for a zero-size bounding box (a lone node or a
// tight pair), so it would fill the whole canvas with one dot — this caps it.
const GRAPH_FIT_MAX_ZOOM = 2.2

interface GraphFitTarget {
  graphData: () => { nodes: VaultGraphNode[] }
  centerAt: (x: number, y: number, ms?: number) => void
  zoom: (k: number, ms?: number) => void
}

/** Center + zoom the camera onto a set of node ids, clamped so a small
 *  selection frames tightly without over-zooming. */
function fitGraphToIdsBlock(
  graph: GraphFitTarget,
  containerEl: HTMLElement,
  ids: ReadonlySet<string>,
  ms: number,
  padding = 80,
): void {
  const matched = (graph.graphData().nodes as VaultGraphNode[]).filter(
    n => ids.has(n.id) && Number.isFinite(n.x) && Number.isFinite(n.y),
  )
  if (matched.length === 0) return
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of matched) {
    const x = n.x as number
    const y = n.y as number
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const spanX = maxX - minX
  const spanY = maxY - minY
  const availW = Math.max(1, containerEl.clientWidth - padding * 2)
  const availH = Math.max(1, containerEl.clientHeight - padding * 2)
  const k = (spanX < 1 && spanY < 1)
    ? GRAPH_FIT_MAX_ZOOM
    : Math.min(GRAPH_FIT_MAX_ZOOM, availW / Math.max(spanX, 1), availH / Math.max(spanY, 1))
  graph.centerAt(cx, cy, ms)
  graph.zoom(k, ms)
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

// ── Folder-gravity clustering ──
// Wikilinks alone converge on a hairball: the force layout has no idea what
// matters. But the human already classified the vault by filing things — so
// every note is pulled toward the centroid of its folder (strong) and of its
// project (gentle). Structure emerges as neighborhoods; wikilinks stay the
// weak long-range threads crossing between them. Runs only during the initial
// settle — positions freeze afterwards like every other force here.

/** Simulation-time node: d3-force adds velocity fields it integrates each tick. */
type SimNode = VaultGraphNode & { vx: number; vy: number }

/** The neighborhood a note belongs to: its project's top-level folder — one
 *  level shallower than the deepest folder, so `thinking-organizer/{epics,
 *  thoughts}` reads as one "thinking-organizer" region instead of splintering.
 *  The key keeps the full project prefix, so every project's templated
 *  "AI Synthesis" folder stays a distinct cluster (they never fuse by name);
 *  `folder` is that top-level folder, '' when the note sits in the project root.
 *
 *  The prefix comes off the node. This file used to carry its own copy of the
 *  container-root rule "so the grouping math doesn't couple the canvas to the
 *  data block" — but two copies of a rule are coupling with no one responsible
 *  for keeping them equal, and the copy here was hardcoded to three folder
 *  names that only exist in one vault. */
function regionGroupOf(node: Pick<VaultGraphNode, 'id' | 'projectPrefix'>): { key: string; folder: string } {
  const prefix = node.projectPrefix
  const rest = node.id.startsWith(`${prefix}/`) ? node.id.slice(prefix.length + 1) : ''
  const segs = rest.split('/')
  // note directly under the project root — no sub-folder to name
  if (segs.length <= 1) return { key: prefix, folder: '' }
  return { key: `${prefix}/${segs[0]}`, folder: segs[0] }
}

function regionKeyOf(node: Pick<VaultGraphNode, 'id' | 'projectPrefix'>): string {
  return regionGroupOf(node).key
}

/** d3 custom force: nudge each node toward its group's centroid. Groups with a
 *  single member get no pull (their centroid is themselves). */
function makeCentroidForce(keyOf: (node: VaultGraphNode) => string, strength: number) {
  let nodes: SimNode[] = []
  const force = (alpha: number) => {
    const groups = new Map<string, { x: number; y: number; count: number }>()
    for (const node of nodes) {
      const key = keyOf(node)
      let group = groups.get(key)
      if (!group) groups.set(key, (group = { x: 0, y: 0, count: 0 }))
      group.x += node.x ?? 0
      group.y += node.y ?? 0
      group.count += 1
    }
    const k = strength * alpha
    for (const node of nodes) {
      const group = groups.get(keyOf(node))
      if (!group || group.count < 2) continue
      node.vx += (group.x / group.count - (node.x ?? 0)) * k
      node.vy += (group.y / group.count - (node.y ?? 0)) * k
    }
  }
  // The simulation hands in VaultGraphNode[]; d3-force has already attached
  // vx/vy to each node by the time the force body runs.
  force.initialize = (initNodes: VaultGraphNode[]) => {
    nodes = initNodes as SimNode[]
  }
  return force
}

const FOLDER_CLUSTER_STRENGTH = 0.22
const PROJECT_CLUSTER_STRENGTH = 0.04

// ── Cluster regions: soft glow + name for the big folder neighborhoods ──
// Only clusters that earn it get chrome: at least REGION_MIN_MEMBERS notes,
// capped at the REGION_MAX_COUNT largest — labeling every folder would bury
// the map in noise. Glows draw under the nodes (pre-render pass); labels fade
// as you zoom in and node labels take over, and both recede under hover
// focus / lens emphasis so they never compete with active inspection.
const REGION_MIN_MEMBERS = 5
const REGION_MAX_COUNT = 14
/** Region labels start fading past this zoom; nodes' own labels take over. */
const REGION_LABEL_ZOOM_FADE_START = 1.4

interface ClusterRegionDef {
  label: string
  members: VaultGraphNode[]
  /** Dominant project among members — tints the glow with the legend color. */
  project: string
}

/** Per-frame resolved geometry of a drawn region (visible members only). */
interface ClusterRegionFrame {
  cx: number
  cy: number
  r: number
  label: string
  project: string
}

/** Pick the neighborhoods worth marking (project top-level folders, see
 *  regionGroupOf). Labels pair project with folder — "sfdl / thoughts",
 *  "sfai / AI Synthesis" — so templated folders read against the project they
 *  belong to; a note-in-project-root cluster is labeled by the project alone. */
function buildClusterRegionDefs(nodes: VaultGraphNode[]): ClusterRegionDef[] {
  const byRegion = new Map<string, { members: VaultGraphNode[]; folder: string }>()
  for (const node of nodes) {
    const { key, folder } = regionGroupOf(node)
    if (!key) continue // loose root files are not a neighborhood
    const region = byRegion.get(key)
    if (region) region.members.push(node)
    else byRegion.set(key, { members: [node], folder })
  }
  const picked = [...byRegion.values()]
    .filter(r => r.members.length >= REGION_MIN_MEMBERS)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, REGION_MAX_COUNT)

  return picked.map(({ members, folder }) => {
    const projectCounts = new Map<string, number>()
    for (const m of members) projectCounts.set(m.project, (projectCounts.get(m.project) ?? 0) + 1)
    let project = members[0].project
    let bestCount = 0
    for (const [p, count] of projectCounts) {
      if (count > bestCount) {
        project = p
        bestCount = count
      }
    }
    // Pair project with folder ("sfdl / thoughts"); drop the folder when it just
    // restates the project (a project whose canonical name is its own folder,
    // e.g. kai-workspace/F9 → "F9") so the label never reads "F9 / F9".
    const label =
      folder && folder.toLowerCase() !== project.toLowerCase() ? `${project} / ${folder}` : project
    return { label, members, project }
  })
}

/** Project colors arrive as hex strings; the gradients need channels. */
function hexToRgbChannels(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 138, g: 147, b: 166 } // VAULT_GRAPH_FALLBACK_COLOR
  const v = parseInt(m[1], 16)
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff }
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

/** Region labels widen out of hand ("F9 / THOUGHTS, PREDICTIONS, LAUNCHES AND
 *  POSTMORTEM") and smear across neighbors. Greedy word-wrap to a max width
 *  (caller passes it in world units); a single over-long word stays on its own
 *  line rather than getting chopped. Assumes ctx.font / letterSpacing are set. */
function wrapLabelLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): { lines: string[]; width: number } {
  const words = text.split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  let width = 0
  for (const line of lines) width = Math.max(width, ctx.measureText(line).width)
  return { lines: lines.length ? lines : [text], width }
}

/** Longest a region label line may run before wrapping, in screen px (converted
 *  to world units per-frame so wrapping is stable across zoom). */
const REGION_LABEL_MAX_WIDTH_PX = 200

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
  /** A control panel docked to the right edge in screen space — fixed size,
   *  independent scroll, never scales with the graph. The canvas is inset to
   *  the left of it so the panel never overlaps the nodes. */
  sidePanel?: ReactNode
  /** Fired only for modifier clicks (⌘ / ⌥). Plain clicks toggle the in-canvas
   *  selection and never leave the graph; the parent routes ⌘ → side panel and
   *  ⌥ → explorer off the event's modifier keys. */
  onNodeClick: (node: VaultGraphNode, event: MouseEvent) => void
  /** Clicking empty canvas — the parent uses it to clear the card session/day
   *  lens (the in-canvas node selection is cleared here regardless). */
  onBackgroundClick?: () => void
}

/** Width reserved on the right for the docked panel (panel width + gutters). */
const SIDE_PANEL_RESERVE = 468

export default function VaultGraphCanvasBlock({
  data,
  scrubMs,
  hiddenProjects,
  projectColors,
  isDark,
  playing,
  emphasis,
  zoomTo,
  sidePanel,
  onNodeClick,
  onBackgroundClick,
}: VaultGraphCanvasBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
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

  // Latest zoom target, read by onEngineStop / the prefrozen path so a subset
  // fit that was requested before the (async-created) graph settled still wins
  // over the default "fit everything" framing.
  const zoomToRef = useRef(zoomTo)
  zoomToRef.current = zoomTo

  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick
  const onBackgroundClickRef = useRef(onBackgroundClick)
  onBackgroundClickRef.current = onBackgroundClick

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

      // ── Pre-render pass: soft cluster glows under the nodes ──
      // Geometry is recomputed per frame from visible members (scrub/filter
      // aware); membership itself is fixed, so this is one pass over the
      // clustered nodes. frameRegions carries the results to the label pass.
      const clusterRegions = buildClusterRegionDefs(data.nodes)
      const frameRegions: ClusterRegionFrame[] = []
      function drawRegions(ctx: CanvasRenderingContext2D) {
        frameRegions.length = 0
        if (clusterRegions.length === 0) return
        // Regions are ambient chrome: recede under hover focus and lenses.
        const fade = (1 - view.dimEase * 0.75) * (view.emphasis.mode === 'none' ? 1 : 0.4)
        if (fade < 0.05) return
        for (const region of clusterRegions) {
          let sx = 0
          let sy = 0
          let n = 0
          for (const m of region.members) {
            if (!nodeVisible(m)) continue
            sx += m.x ?? 0
            sy += m.y ?? 0
            n += 1
          }
          if (n < 4) continue // scrubbed/filtered down to nothing — no blob
          const cx = sx / n
          const cy = sy / n
          let sd = 0
          for (const m of region.members) {
            if (!nodeVisible(m)) continue
            const dx = (m.x ?? 0) - cx
            const dy = (m.y ?? 0) - cy
            sd += dx * dx + dy * dy
          }
          const r = Math.max(26, Math.sqrt(sd / n) * 1.8 + 14)
          const { r: cr, g: cg, b: cb } = hexToRgbChannels(
            view.colors.get(region.project) ?? VAULT_GRAPH_FALLBACK_COLOR,
          )
          const base = (view.isDark ? 0.09 : 0.07) * fade
          const glow = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r)
          glow.addColorStop(0, `rgba(${cr},${cg},${cb},${base.toFixed(3)})`)
          glow.addColorStop(0.65, `rgba(${cr},${cg},${cb},${(base * 0.55).toFixed(3)})`)
          glow.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, 2 * Math.PI)
          ctx.fillStyle = glow
          ctx.fill()
          // Faint top-left sheen — the soft-3D read without any real chrome.
          const hx = cx - r * 0.3
          const hy = cy - r * 0.35
          const sheen = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.75)
          sheen.addColorStop(0, `rgba(255,255,255,${((view.isDark ? 0.045 : 0.14) * fade).toFixed(3)})`)
          sheen.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, 2 * Math.PI)
          ctx.fillStyle = sheen
          ctx.fill()
          frameRegions.push({ cx, cy, r, label: region.label, project: region.project })
        }
      }

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

        // Region names first: they claim their rects so node labels route
        // around them. Small caps with light tracking, fading out as you zoom
        // in and note labels take over — map-style, not UI-style.
        if (frameRegions.length > 0 && view.dimEase < 0.95) {
          const zoomFade =
            scale <= REGION_LABEL_ZOOM_FADE_START
              ? 1
              : Math.max(0.2, 1 - (scale - REGION_LABEL_ZOOM_FADE_START) / 2.2)
          // Dark canvas needs more punch than the light one to read at all.
          const regionAlpha =
            (view.isDark ? 0.72 : 0.55) *
            zoomFade *
            (1 - view.dimEase) *
            (view.emphasis.mode === 'none' ? 1 : 0.45)
          if (regionAlpha > 0.04) {
            const trackedCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
            const canTrack = 'letterSpacing' in trackedCtx
            if (canTrack) trackedCtx.letterSpacing = `${(1.5 / scale).toFixed(2)}px`
            const fontSize = 11.5 / scale
            const lineHeight = fontSize * 1.18
            const maxWidth = REGION_LABEL_MAX_WIDTH_PX / scale
            for (const region of frameRegions) {
              ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
              const { lines, width } = wrapLabelLines(ctx, region.label.toUpperCase(), maxWidth)
              const blockH = lines.length * lineHeight
              const x = region.cx
              // Stack sits above the blob; the last line lands just over its rim.
              const topY = region.cy - region.r - 3 / scale - blockH
              const pad = 3 / scale
              const rect: LabelRect = {
                x0: x - width / 2 - pad,
                y0: topY - pad,
                x1: x + width / 2 + pad,
                y1: topY + blockH + pad,
              }
              if (rect.x1 < tl.x || rect.x0 > br.x || rect.y1 < tl.y || rect.y0 > br.y) continue
              placedRects.push(rect)
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              ctx.globalAlpha = regionAlpha
              ctx.strokeStyle = view.isDark ? LABEL_OUTLINE_DARK : LABEL_OUTLINE_LIGHT
              ctx.lineWidth = 3 / scale
              ctx.lineJoin = 'round'
              ctx.fillStyle = view.isDark ? LABEL_REGION_FILL_DARK : LABEL_REGION_FILL_LIGHT
              for (let i = 0; i < lines.length; i += 1) {
                const ly = topY + i * lineHeight
                ctx.strokeText(lines[i], x, ly)
                ctx.fillText(lines[i], x, ly)
              }
              ctx.globalAlpha = 1
            }
            if (canTrack) trackedCtx.letterSpacing = '0px'
          }
        }

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

          // AI-heat halo is an on-demand lens, not ambient chrome: at rest the
          // graph is plain project colors. It lights up only under an active
          // AI-activity selection (day/session/window/unabsorbed), so selecting
          // sessions is what surfaces the AI-touch glow.
          if (view.emphasis.mode !== 'none' && node.heat > 0.04 && haloScale > 0.05) {
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
        .onRenderFramePre((ctx: CanvasRenderingContext2D) => {
          drawRegions(ctx)
        })
        .onRenderFramePost((ctx: CanvasRenderingContext2D, scale: number) => {
          drawLabels(ctx, scale)
        })
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
          // Let the parent clear the card session/day lens too.
          onBackgroundClickRef.current?.()
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
          const pendingZoom = zoomToRef.current
          if (pendingZoom && pendingZoom.ids.size > 0) {
            fitGraphToIdsBlock(graph, container, pendingZoom.ids, 600)
          } else {
            graph.zoomToFit(600, 48)
          }
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
      // Folder gravity (see makeCentroidForce): the folder pull shapes tight
      // neighborhoods, the project pull drifts sibling folders near each other.
      // Keyed on the region grouping (project top-level folder), so a blob's
      // shape matches its label instead of splintering one level too deep.
      graph.d3Force('folderCluster', makeCentroidForce(n => regionKeyOf(n), FOLDER_CLUSTER_STRENGTH))
      graph.d3Force('projectCluster', makeCentroidForce(n => n.project, PROJECT_CLUSTER_STRENGTH))

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
          const pendingZoom = zoomToRef.current
          if (pendingZoom && pendingZoom.ids.size > 0) {
            fitGraphToIdsBlock(graph, container, pendingZoom.ids, 0)
          } else {
            graph.zoomToFit(0, 48)
          }
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
    const el = containerRef.current
    if (!graph || !el) return
    fitGraphToIdsBlock(graph, el, zoomTo.ids, 600)
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
      {/* Canvas is inset to the left of the docked panel so the graph fits into
          the open space and the panel never overlaps the nodes. */}
      <div
        ref={containerRef}
        className="absolute inset-y-0 left-0"
        // touch-action none: the iOS shell puts `touch-action: pan-y` on the
        // page scroller, which lets the browser claim canvas touches for
        // scrolling — force-graph's d3-zoom then never sees pan/pinch.
        style={{ right: sidePanel ? SIDE_PANEL_RESERVE : 0, touchAction: 'none' }}
      />
      {/* Control panel docked to the right edge in screen space — fixed width,
          full height, its own scroll. Does not pan or zoom with the graph. */}
      {sidePanel && (
        <aside className="absolute inset-y-3 right-3 w-[440px] max-w-[calc(100%-1.5rem)]">
          {sidePanel}
        </aside>
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
