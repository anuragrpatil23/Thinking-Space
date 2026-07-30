// Pure layered layout for the grew_out_of DAG — the index's second view.
//
// The relationship this draws is causal, not associative: an edge means "this
// grew out of that", and the picture answers "what did this come from". That is
// deliberately not a force-directed graph of undifferentiated connections
// (Obsidian's graph view — impressive, answers no question). Few edges, each
// with one meaning, laid out in layers so the direction of derivation reads
// left-to-right.
//
// Only undertakings that take part in at least one edge appear here. An
// undertaking with no lineage is not part of how understanding was built across
// entries, so it belongs in the index list, not in this view.
//
// The data is supposed to be acyclic. It comes from hand-edited records, so a
// cycle is possible; the ranker breaks one defensively rather than looping
// forever — correctness of the picture matters less than not hanging.

export interface DagInputNode {
  key: string
  title: string
}

/** `from` grew into `to`: ancestor → descendant, the direction understanding
 *  flowed. For a record R with `grew_out_of: [P]`, the edge is P → R. */
export interface DagInputEdge {
  from: string
  to: string
}

export interface DagLaidOutNode {
  key: string
  title: string
  /** 0 for a root (no ancestor); otherwise one past its deepest ancestor. */
  layer: number
  /** Position within the layer, top to bottom. */
  order: number
}

export interface DagLayout {
  nodes: DagLaidOutNode[]
  edges: DagInputEdge[]
  layerCount: number
}

export function layoutUndertakingDagBlock(
  nodes: DagInputNode[],
  edges: DagInputEdge[],
): DagLayout {
  const titleByKey = new Map(nodes.map(n => [n.key, n.title]))

  // Keep only edges whose endpoints both exist, and only nodes that take part.
  const validEdges = edges.filter(e => titleByKey.has(e.from) && titleByKey.has(e.to) && e.from !== e.to)
  const included = new Set<string>()
  const parents = new Map<string, string[]>() // node → its ancestors (edge.from)
  for (const e of validEdges) {
    included.add(e.from)
    included.add(e.to)
    const arr = parents.get(e.to) ?? []
    arr.push(e.from)
    parents.set(e.to, arr)
  }

  // Longest-path rank from roots, memoized, with a recursion guard so a cycle
  // in hand-edited data contributes 0 for the back-edge instead of hanging.
  const rank = new Map<string, number>()
  const inProgress = new Set<string>()
  const computeRank = (key: string): number => {
    const cached = rank.get(key)
    if (cached !== undefined) return cached
    if (inProgress.has(key)) return 0 // back-edge: break the cycle
    inProgress.add(key)
    const ps = parents.get(key) ?? []
    const r = ps.length === 0 ? 0 : Math.max(...ps.map(p => computeRank(p) + 1))
    inProgress.delete(key)
    rank.set(key, r)
    return r
  }
  for (const key of included) computeRank(key)

  // Group by layer, order within a layer by title for a stable, readable column.
  const byLayer = new Map<number, string[]>()
  for (const key of included) {
    const layer = rank.get(key) ?? 0
    const arr = byLayer.get(layer) ?? []
    arr.push(key)
    byLayer.set(layer, arr)
  }
  const laidOut: DagLaidOutNode[] = []
  let layerCount = 0
  for (const [layer, keys] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    layerCount = Math.max(layerCount, layer + 1)
    keys
      .sort((a, b) => (titleByKey.get(a) ?? '').localeCompare(titleByKey.get(b) ?? ''))
      .forEach((key, order) => {
        laidOut.push({ key, title: titleByKey.get(key) ?? key, layer, order })
      })
  }

  return { nodes: laidOut, edges: validEdges, layerCount }
}
