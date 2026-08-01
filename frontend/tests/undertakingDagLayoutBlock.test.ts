import { describe, expect, it } from 'vitest'
import { layoutUndertakingDagBlock } from '@/services/lego_blocks/units/undertakingDagLayoutBlock'

const nodes = [
  { key: 'tsmc', title: 'TSMC' },
  { key: 'physics', title: 'Semiconductor physics' },
  { key: 'micron', title: 'Micron' },
  { key: 'mu', title: 'MU earnings play' },
  { key: 'lonely', title: 'A study with no lineage' },
]

// TSMC → physics → Micron → MU, the doc's chain.
const edges = [
  { from: 'tsmc', to: 'physics' },
  { from: 'physics', to: 'micron' },
  { from: 'micron', to: 'mu' },
]

describe('layoutUndertakingDagBlock', () => {
  it('ranks a chain into increasing layers', () => {
    const layout = layoutUndertakingDagBlock(nodes, edges)
    const layer = (k: string) => layout.nodes.find(n => n.key === k)?.layer
    expect(layer('tsmc')).toBe(0)
    expect(layer('physics')).toBe(1)
    expect(layer('micron')).toBe(2)
    expect(layer('mu')).toBe(3)
    expect(layout.layerCount).toBe(4)
  })

  it('excludes undertakings with no lineage edge', () => {
    const layout = layoutUndertakingDagBlock(nodes, edges)
    expect(layout.nodes.find(n => n.key === 'lonely')).toBeUndefined()
  })

  it('uses the deepest ancestor for the layer when a node has two parents', () => {
    // d grows out of both a root (a) and a depth-2 node (c) → layer 3.
    const layout = layoutUndertakingDagBlock(
      [
        { key: 'a', title: 'A' },
        { key: 'b', title: 'B' },
        { key: 'c', title: 'C' },
        { key: 'd', title: 'D' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'a', to: 'd' },
        { from: 'c', to: 'd' },
      ],
    )
    expect(layout.nodes.find(n => n.key === 'd')?.layer).toBe(3)
  })

  it('drops edges pointing at keys that do not exist', () => {
    const layout = layoutUndertakingDagBlock(
      [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
      [{ from: 'a', to: 'b' }, { from: 'a', to: 'ghost' }],
    )
    expect(layout.edges).toHaveLength(1)
    expect(layout.nodes.map(n => n.key).sort()).toEqual(['a', 'b'])
  })

  it('does not hang on a cycle in hand-edited data', () => {
    const layout = layoutUndertakingDagBlock(
      [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    )
    expect(layout.nodes).toHaveLength(2)
  })
})
