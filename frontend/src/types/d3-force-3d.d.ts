// Minimal ambient types for d3-force-3d (ships no declarations). We only use
// forceCollide from it, applied to force-graph's simulation via graph.d3Force.
declare module 'd3-force-3d' {
  interface CollideForce<N> {
    (): void
    radius(r: number | ((node: N) => number)): CollideForce<N>
    strength(s: number): CollideForce<N>
    iterations(n: number): CollideForce<N>
  }
  export function forceCollide<N = unknown>(
    radius?: number | ((node: N) => number),
  ): CollideForce<N>
}
