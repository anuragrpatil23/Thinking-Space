import { describe, expect, it, vi } from 'vitest'
import type { VaultFS, ListedFiles, VaultEntry, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'

class FakeVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()
  readonly writes: Array<{ path: string; content: string }> = []

  seedFile(path: string, content: string): void {
    this.files.set(path, content)
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content == null) throw new Error(`Missing file: ${path}`)
    return content
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data)
    this.writes.push({ path, content: data })
  }

  async create(path: string, data: string): Promise<void> {
    await this.write(path, data)
  }

  async list(_path: string): Promise<ListedFiles> {
    return { files: [], folders: [] }
  }

  async walkVault(_extensions?: string[]): Promise<VaultEntry[]> {
    return []
  }

  async stat(path: string): Promise<VaultStat> {
    const content = this.files.get(path)
    if (content == null) throw new Error(`Missing stat: ${path}`)
    return {
      size: content.length,
      mtime: 1,
      ctime: 1,
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }

  async mkdir(_path: string): Promise<void> {
    return
  }

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const current = await this.read(path)
    await this.write(path, fn(current))
  }

  // Binary reads/writes and delete: no test here exercises them. They exist so
  // the double actually satisfies VaultFS — a double that doesn't is invisible
  // to the typechecker, which is what let renames rot in tests unnoticed.
  async readBytes(p: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(p))
  }

  async writeBytes(p: string, data: Uint8Array): Promise<void> {
    await this.write(p, new TextDecoder().decode(data))
  }

  async delete(_p: string): Promise<void> {
    throw new Error('delete is not implemented by this test double')
  }
}

const fakeFs = new FakeVaultFS()

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => {
  return {
    getVaultFS: () => fakeFs,
  }
})

describe('mindmapBuilderOrch', () => {
  it('captures timing metrics for preview generation', async () => {
    fakeFs.seedFile('notes/example.md', '# Root\n\n## Child\nBody paragraph')

    const mod = await import('@/services/orchestrators/mindmapBuilderOrch')
    const preview = await mod.buildMindmapPreviewOrch(
      'notes/example.md',
      mod.getDefaultMindmapBuildOptionsOrch(),
    )

    expect(preview.nodeCount).toBeGreaterThan(0)
    expect(preview.sceneMarkdown.length).toBeGreaterThan(0)
    expect(preview.timingMs.read).toBeGreaterThanOrEqual(0)
    expect(preview.timingMs.build).toBeGreaterThanOrEqual(0)
    expect(preview.timingMs.serialize).toBeGreaterThanOrEqual(0)
    expect(preview.timingMs.total).toBeGreaterThanOrEqual(preview.timingMs.read)
  })

  it('returns write and total timing metrics when saving', async () => {
    fakeFs.seedFile('notes/ship.md', '# Ship\n\n## Roadmap\nLaunch sequence')

    const mod = await import('@/services/orchestrators/mindmapBuilderOrch')
    const result = await mod.saveMindmapSceneOrch({
      inputPath: 'notes/ship.md',
      options: mod.getDefaultMindmapBuildOptionsOrch(),
      outputPath: 'notes/ship (mindmap).excalidraw.md',
    })

    expect(result.outputPath).toBe('notes/ship (mindmap).excalidraw.md')
    expect(result.timingMs.previewTotal).toBeGreaterThanOrEqual(0)
    expect(result.timingMs.write).toBeGreaterThanOrEqual(0)
    expect(result.timingMs.total).toBeGreaterThanOrEqual(result.timingMs.write)
    expect(fakeFs.writes.some((entry) => entry.path === 'notes/ship (mindmap).excalidraw.md')).toBe(true)
  })

  it('builds preview directly from in-memory markdown content', async () => {
    const mod = await import('@/services/orchestrators/mindmapBuilderOrch')
    const preview = mod.buildMindmapPreviewFromContentOrch({
      inputPath: 'notes/from-editor.md',
      content: '# Root\n\n## Child\nText',
      options: mod.getDefaultMindmapBuildOptionsOrch(),
    })

    expect(preview.inputPath).toBe('notes/from-editor.md')
    expect(preview.nodeCount).toBeGreaterThan(0)
    expect(preview.sceneMarkdown.length).toBeGreaterThan(0)
    expect(preview.timingMs.read).toBe(0)
    expect(preview.timingMs.total).toBeGreaterThanOrEqual(preview.timingMs.build)
  })

  it('saves mindmap from in-memory markdown content', async () => {
    const mod = await import('@/services/orchestrators/mindmapBuilderOrch')
    const result = await mod.saveMindmapSceneFromContentOrch({
      inputPath: 'notes/editor-save.md',
      content: '# Editor Save\n\n## Section\nPayload',
      options: mod.getDefaultMindmapBuildOptionsOrch(),
      outputPath: 'notes/editor-save (mindmap).excalidraw.md',
    })

    expect(result.outputPath).toBe('notes/editor-save (mindmap).excalidraw.md')
    expect(result.timingMs.write).toBeGreaterThanOrEqual(0)
    expect(fakeFs.writes.some((entry) => entry.path === 'notes/editor-save (mindmap).excalidraw.md')).toBe(true)
  })
})
