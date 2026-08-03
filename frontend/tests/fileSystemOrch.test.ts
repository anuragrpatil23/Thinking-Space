import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'

class FakeVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()

  reset(): void {
    this.files.clear()
  }

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
  }

  async create(path: string, data: string): Promise<void> {
    await this.write(path, data)
  }

  async list(_path: string): Promise<ListedFiles> {
    return { files: [], folders: [] }
  }

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    const lowered = extensions.map(ext => ext.toLowerCase())
    return [...this.files.entries()]
      .filter(([path]) => lowered.some(ext => path.toLowerCase().endsWith(ext)))
      .map(([path, content]) => ({
        path,
        size: content.length,
        mtime: 1,
        ctime: 1,
      }))
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

  async mkdir(_path: string): Promise<void> {}

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

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => fakeFs,
}))

describe('fileSystemOrch listFiles', () => {
  beforeEach(() => {
    fakeFs.reset()
  })

  it('returns all eligible markdown files when no limit is provided', async () => {
    for (let index = 0; index < 1205; index += 1) {
      fakeFs.seedFile(`notes/note-${String(index).padStart(4, '0')}.md`, `# Note ${index}`)
    }
    fakeFs.seedFile('notes/diagram.excalidraw.md', '# Excalidraw output')

    const { listFiles } = await import('@/services/orchestrators/fileSystemOrch')
    const files = await listFiles()

    expect(files).toHaveLength(1205)
    expect(files).toContain('notes/note-1204.md')
    expect(files).not.toContain('notes/diagram.excalidraw.md')
  })
})
