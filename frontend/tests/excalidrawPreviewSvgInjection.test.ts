import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({
    read: async (path: string) => files.get(path) ?? '',
  }),
}))

const { loadExcalidrawSvgPreviewBlock } = await import('@/services/lego_blocks/units/excalidrawPreviewBlock')

const BREAKOUT = '1"/><image href="x" onerror="alert(1)"/><rect x="'

describe('Excalidraw SVG preview', () => {
  beforeEach(() => files.clear())

  it('never lets a string in a number field break out of its attribute', async () => {
    files.set('evil.excalidraw', JSON.stringify({
      elements: [
        { type: 'rectangle', x: BREAKOUT, y: 0, width: 10, height: 10, strokeWidth: BREAKOUT, opacity: BREAKOUT },
        { type: 'line', x: 0, y: 0, width: 5, height: 5, points: [[BREAKOUT, 0], [5, BREAKOUT]] },
        { type: 'text', x: 0, y: 0, width: 5, height: 5, fontSize: BREAKOUT, text: '<script>alert(1)</script>' },
      ],
    }))
    const svg = await loadExcalidrawSvgPreviewBlock('evil.excalidraw')
    expect(svg).not.toMatch(/<image|onerror|<script/i)
    expect(svg).toContain('&lt;script&gt;')
  })

  it('still renders an ordinary drawing', async () => {
    files.set('ok.excalidraw.md', '## Drawing\n```json\n' + JSON.stringify({
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 50, strokeWidth: 2 }],
    }) + '\n```\n')
    const svg = await loadExcalidrawSvgPreviewBlock('ok.excalidraw.md')
    expect(svg).toContain('<rect')
    expect(svg).toContain('stroke-width="2"')
  })
})
