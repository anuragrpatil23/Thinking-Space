import { Loader2 } from 'lucide-react'
import { useUndertakingDagBlock } from '@/components/lego_blocks/hooks/units/useUndertakingDagBlock'

// The lineage view: undertakings as a layered DAG of grew_out_of edges. Each
// edge means "this grew out of that" — the picture of how understanding was
// built across entries, which is the accumulation the index list can't show.
// Deliberately not a force-directed graph: few edges, each with one meaning,
// laid out left-to-right in the direction understanding flowed. Opened rarely,
// on purpose.

interface Props {
  projectId: string | null
  onOpenUndertaking?: (key: string) => void
}

const COL_W = 240
const ROW_H = 64
const NODE_W = 190
const NODE_H = 44
const PAD = 24

export default function UndertakingDagBlock({ projectId, onOpenUndertaking }: Props) {
  const { dag, loading, error } = useUndertakingDagBlock(projectId)

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading lineage…
      </div>
    )
  }
  if (error) {
    return <div className="px-2 py-8 text-sm text-destructive">Could not load lineage: {error}</div>
  }
  if (!dag || dag.layout.nodes.length === 0) {
    return (
      <div className="px-2 py-8 text-sm text-muted-foreground/70">
        No lineage yet. As undertakings grow out of earlier ones, the edges appear here.
        {dag && dag.isolatedCount > 0 && (
          <> {dag.isolatedCount} undertaking{dag.isolatedCount === 1 ? '' : 's'} in the list have no lineage edge.</>
        )}
      </div>
    )
  }

  const { nodes, edges } = dag.layout
  // Position by layer (x) and order within layer (y).
  const pos = new Map(nodes.map(n => [n.key, { x: PAD + n.layer * COL_W, y: PAD + n.order * ROW_H }]))
  const maxOrderByNothing = Math.max(...nodes.map(n => n.order)) + 1
  const width = PAD * 2 + (dag.layout.layerCount - 1) * COL_W + NODE_W
  const height = PAD * 2 + (maxOrderByNothing - 1) * ROW_H + NODE_H

  return (
    <div className="space-y-3">
      <p className="px-2 text-xs text-muted-foreground/70">
        {edges.length} lineage edge{edges.length === 1 ? '' : 's'}
        {dag.isolatedCount > 0 && ` · ${dag.isolatedCount} with no lineage (in the list)`}
      </p>
      <div className="overflow-auto rounded-lg border border-border/60 bg-background/40">
        <svg width={width} height={height} className="text-foreground">
          <defs>
            <marker
              id="dag-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground/60" />
            </marker>
          </defs>

          {edges.map((e, i) => {
            const from = pos.get(e.from)
            const to = pos.get(e.to)
            if (!from || !to) return null
            const x1 = from.x + NODE_W
            const y1 = from.y + NODE_H / 2
            const x2 = to.x
            const y2 = to.y + NODE_H / 2
            const midX = (x1 + x2) / 2
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                className="stroke-muted-foreground/40"
                strokeWidth={1.5}
                markerEnd="url(#dag-arrow)"
              />
            )
          })}

          {nodes.map(n => {
            const p = pos.get(n.key)!
            return (
              <g
                key={n.key}
                transform={`translate(${p.x}, ${p.y})`}
                className="cursor-pointer"
                onClick={() => onOpenUndertaking?.(n.key)}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  className="fill-card stroke-border hover:stroke-foreground/40"
                  strokeWidth={1}
                />
                <text
                  x={10}
                  y={NODE_H / 2}
                  dominantBaseline="middle"
                  className="fill-foreground text-[12px]"
                >
                  {n.title.length > 26 ? `${n.title.slice(0, 25)}…` : n.title}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
