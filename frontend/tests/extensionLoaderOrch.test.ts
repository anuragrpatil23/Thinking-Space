import { beforeEach, describe, expect, it } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'
import {
  activateExtensionOrch,
  clearExtensionRegistryOrch,
  deactivateExtensionOrch,
  discoverExtensionsOrch,
  listRegisteredExtensionsOrch,
} from '@/services/orchestrators/extensionLoaderOrch'

class FakeVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()
  private readonly dirs = new Set<string>([''])

  constructor(initialFiles: Record<string, string>) {
    for (const [path, content] of Object.entries(initialFiles)) {
      const normalized = this.normalize(path)
      this.files.set(normalized, content)
      this.ensureParentDirs(normalized)
    }
  }

  async read(path: string): Promise<string> {
    const normalized = this.normalize(path)
    const content = this.files.get(normalized)
    if (content == null) throw new Error(`Missing file: ${normalized}`)
    return content
  }

  async write(path: string, data: string): Promise<void> {
    const normalized = this.normalize(path)
    this.files.set(normalized, data)
    this.ensureParentDirs(normalized)
  }

  async create(path: string, data: string): Promise<void> {
    const normalized = this.normalize(path)
    if (this.files.has(normalized)) throw new Error(`File already exists: ${normalized}`)
    await this.write(normalized, data)
  }

  async list(path: string): Promise<ListedFiles> {
    const normalized = this.normalize(path)
    if (!this.folderExists(normalized)) throw new Error(`Missing folder: ${normalized}`)
    const files = new Set<string>()
    const folders = new Set<string>()

    for (const filePath of this.files.keys()) {
      const { parent, name } = this.splitParent(filePath)
      if (parent === normalized) files.add(name)
    }

    for (const dirPath of this.dirs) {
      if (dirPath === normalized) continue
      const { parent, name } = this.splitParent(dirPath)
      if (parent === normalized) folders.add(name)
    }

    return {
      files: [...files].sort(),
      folders: [...folders].sort(),
    }
  }

  async walkVault(_extensions?: string[]): Promise<VaultEntry[]> {
    return []
  }

  async stat(path: string): Promise<VaultStat> {
    const normalized = this.normalize(path)
    if (this.files.has(normalized)) {
      return { size: this.files.get(normalized)!.length, mtime: 0, isDirectory: false }
    }
    if (this.folderExists(normalized)) {
      return { size: 0, mtime: 0, isDirectory: true }
    }
    throw new Error(`Missing path: ${normalized}`)
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalize(path)
    return this.files.has(normalized) || this.folderExists(normalized)
  }

  async mkdir(path: string): Promise<void> {
    const normalized = this.normalize(path)
    this.ensureDir(normalized)
  }

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const current = await this.read(path)
    await this.write(path, fn(current))
  }

  private normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
  }

  private splitParent(path: string): { parent: string; name: string } {
    const idx = path.lastIndexOf('/')
    if (idx < 0) return { parent: '', name: path }
    return { parent: path.slice(0, idx), name: path.slice(idx + 1) }
  }

  private ensureParentDirs(path: string): void {
    const parts = this.normalize(path).split('/')
    if (parts.length <= 1) return
    let cursor = ''
    for (let idx = 0; idx < parts.length - 1; idx += 1) {
      cursor = cursor ? `${cursor}/${parts[idx]}` : parts[idx]
      this.dirs.add(cursor)
    }
  }

  private ensureDir(path: string): void {
    const normalized = this.normalize(path)
    if (!normalized) return
    const parts = normalized.split('/')
    let cursor = ''
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part
      this.dirs.add(cursor)
    }
  }

  private folderExists(path: string): boolean {
    if (!path) return true
    if (this.dirs.has(path)) return true
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(`${path}/`)) return true
    }
    return false
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

function validManifest(overrides?: Partial<Record<string, unknown>>): string {
  return JSON.stringify({
    id: 'com.thinking-space.demo',
    name: 'Demo Extension',
    version: '1.0.0',
    api_version: '1',
    entry_kind: 'declarative',
    min_app_version: '0.4.0',
    permissions: ['read:thoughts'],
    targets: ['toolbar'],
    ...overrides,
  })
}

describe('extensionLoaderOrch', () => {
  beforeEach(() => {
    clearExtensionRegistryOrch()
  })

  it('discovers and activates compatible extensions from .extensions', async () => {
    const fs = new FakeVaultFS({
      '.extensions/demo/manifest.json': validManifest(),
    })

    const records = await discoverExtensionsOrch({
      fs,
      appVersion: '0.4.1',
      supportedApiVersions: ['1'],
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      registryKey: 'demo',
      status: 'active',
      loadable: true,
      extensionId: 'com.thinking-space.demo',
      reason: null,
    })
    expect(listRegisteredExtensionsOrch()).toHaveLength(1)
  })

  it('marks extension invalid when manifest JSON cannot be parsed', async () => {
    const fs = new FakeVaultFS({
      '.extensions/bad-json/manifest.json': '{invalid json',
    })

    const records = await discoverExtensionsOrch({
      fs,
      appVersion: '0.4.1',
      supportedApiVersions: ['1'],
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      registryKey: 'bad-json',
      status: 'invalid',
      loadable: false,
      reason: {
        code: 'MANIFEST_JSON_INVALID',
      },
    })
  })

  it('marks extension inactive when min_app_version is incompatible', async () => {
    const fs = new FakeVaultFS({
      '.extensions/incompatible/manifest.json': validManifest({ min_app_version: '0.9.0' }),
    })

    const records = await discoverExtensionsOrch({
      fs,
      appVersion: '0.4.1',
      supportedApiVersions: ['1'],
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      registryKey: 'incompatible',
      status: 'inactive',
      loadable: false,
      reason: {
        code: 'MANIFEST_INCOMPATIBLE',
      },
    })
  })

  it('marks electron-js extensions inactive on non-electron runtimes', async () => {
    const fs = new FakeVaultFS({
      '.extensions/runtime/manifest.json': validManifest({
        entry_kind: 'electron-js',
        entry: 'runtime/main.ts',
      }),
    })

    const records = await discoverExtensionsOrch({
      fs,
      appVersion: '0.4.1',
      supportedApiVersions: ['1'],
      runtimeTarget: 'web',
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      registryKey: 'runtime',
      status: 'inactive',
      loadable: false,
      reason: {
        code: 'MANIFEST_INCOMPATIBLE',
      },
    })
    expect(records[0].reason?.message).toContain('requires Electron runtime')
  })

  it('handles missing .extensions root safely', async () => {
    const fs = new FakeVaultFS({})
    const records = await discoverExtensionsOrch({
      fs,
      appVersion: '0.4.1',
      supportedApiVersions: ['1'],
    })

    expect(records).toEqual([])
    expect(listRegisteredExtensionsOrch()).toEqual([])
  })

  it('supports deactivate and activate lifecycle toggles for loadable extensions', async () => {
    const fs = new FakeVaultFS({
      '.extensions/demo/manifest.json': validManifest(),
    })
    await discoverExtensionsOrch({
      fs,
      appVersion: '0.4.1',
      supportedApiVersions: ['1'],
    })

    const deactivated = deactivateExtensionOrch('demo')
    expect(deactivated).toMatchObject({
      status: 'inactive',
      reason: {
        code: 'EXTENSION_DEACTIVATED',
      },
    })

    const activated = activateExtensionOrch('demo')
    expect(activated).toMatchObject({
      status: 'active',
      reason: null,
    })
  })
})
