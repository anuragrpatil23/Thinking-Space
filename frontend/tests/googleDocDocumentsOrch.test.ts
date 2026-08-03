import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'

class FakeVaultFS implements VaultFS {
  private readonly textByPath = new Map<string, string>()
  private readonly statByPath = new Map<string, VaultStat>()
  private readonly readErrorByPath = new Map<string, Error>()
  private readonly listByPath = new Map<string, ListedFiles>()
  private readonly listErrorByPath = new Map<string, Error>()

  private normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/g, '')
  }

  seedStat(path: string, stat: VaultStat): void {
    this.statByPath.set(this.normalize(path), stat)
  }

  seedText(path: string, value: string, stat?: VaultStat): void {
    const key = this.normalize(path)
    this.textByPath.set(key, value)
    if (stat) this.statByPath.set(key, stat)
  }

  seedReadError(path: string, error: Error): void {
    this.readErrorByPath.set(this.normalize(path), error)
  }

  seedList(path: string, listed: ListedFiles): void {
    this.listByPath.set(this.normalize(path), listed)
  }

  seedListError(path: string, error: Error): void {
    this.listErrorByPath.set(this.normalize(path), error)
  }

  async read(path: string): Promise<string> {
    const key = this.normalize(path)
    const error = this.readErrorByPath.get(key)
    if (error) throw error
    const value = this.textByPath.get(key)
    if (value == null) throw new Error(`Missing file: ${path}`)
    return value
  }

  async write(path: string, data: string): Promise<void> {
    this.textByPath.set(this.normalize(path), data)
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(path))
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const text = new TextDecoder().decode(data)
    this.textByPath.set(this.normalize(path), text)
  }

  async create(path: string, data: string): Promise<void> {
    await this.write(path, data)
  }

  async list(path: string): Promise<ListedFiles> {
    const key = this.normalize(path)
    const error = this.listErrorByPath.get(key)
    if (error) throw error
    return this.listByPath.get(key) ?? { files: [], folders: [] }
  }

  async walkVault(): Promise<VaultEntry[]> {
    return []
  }

  async stat(path: string): Promise<VaultStat> {
    const stat = this.statByPath.get(this.normalize(path))
    if (!stat) throw new Error(`Missing stat: ${path}`)
    return stat
  }

  async exists(path: string): Promise<boolean> {
    return this.textByPath.has(this.normalize(path)) || this.statByPath.has(this.normalize(path))
  }

  async mkdir(_path: string): Promise<void> {
    // no-op for tests
  }

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const current = await this.read(path)
    await this.write(path, fn(current))
  }

  // Not exercised here; present so the double satisfies VaultFS.
  async delete(_p: string): Promise<void> {
    throw new Error('delete is not implemented by this test double')
  }
}

let fakeFs = new FakeVaultFS()

vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => fakeFs,
}))

describe('googleDocDocumentsOrch', () => {
  beforeEach(() => {
    fakeFs = new FakeVaultFS()
  })

  // NOTE: sibling-metadata / directory-proxy shortcut resolution lives on the
  // unmerged fix/windows-gdoc-shortcut-resolution branch; main reads the
  // .gdoc file content directly.
  it('decodes a .gdoc JSON shortcut into a google doc descriptor', async () => {
    const mod = await import('@/services/orchestrators/googleDocDocumentsOrch')
    const path = 'docs/project/meeting-notes.gdoc'
    const docId = '1q2w3e4r5t6y7u8i9o0p'

    fakeFs.seedText(
      path,
      JSON.stringify({ url: `https://docs.google.com/document/d/${docId}/edit`, doc_id: docId }),
      { size: 64, mtime: 42, ctime: 42, isDirectory: false },
    )

    const loaded = await mod.readGoogleDocDocument(path)

    expect(loaded.document.descriptor.fileId).toBe(docId)
    expect(loaded.document.descriptor.openUrl).toBe(`https://docs.google.com/document/d/${docId}/edit`)
    expect(loaded.document.isBinaryDocx).toBe(false)
    expect(loaded.mtime).toBe(42)
    expect(loaded.hash).toMatch(/^[0-9a-f]{8}$/)
  })
})
