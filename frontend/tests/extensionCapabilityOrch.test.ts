import { describe, expect, it } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'
import { invokeExtensionCapabilityOrch } from '@/services/orchestrators/extensionCapabilityOrch'

class FakeVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()
  private readonly dirs = new Set<string>([''])

  constructor(initialFiles: Record<string, string> = {}) {
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
    this.ensureDir(this.normalize(path))
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
    if (!path) return
    const parts = path.split('/')
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

describe('extensionCapabilityOrch', () => {
  it('blocks capability when extension lacks required permission and returns UI reason', async () => {
    const fs = new FakeVaultFS()
    const result = await invokeExtensionCapabilityOrch({
      extensionId: 'com.thinking-space.blocked',
      extensionPermissions: ['organizer:read'],
      capability: 'organizer.node.create',
      input: {
        type: 'thought',
        title: 'Should Block',
        projectRoot: 'projects/blocked',
      },
      fs,
    })

    expect(result.ok).toBe(false)
    expect('blocked' in result && result.blocked).toBe(true)
    if (!('blocked' in result) || !result.blocked) return
    expect(result.reasonCode).toBe('MISSING_PERMISSION')
    expect(result.requiredPermissions).toEqual(['organizer:write'])
    expect(result.message).toContain('requires one of')

    const log = await fs.read('.thinking-space/audit/capability-audit.log')
    const lines = log.split('\n').filter(Boolean)
    const latest = JSON.parse(lines[lines.length - 1]) as {
      extensionId?: string
      capability: string
      ok: boolean
      errorCode?: string
    }
    expect(latest.extensionId).toBe('com.thinking-space.blocked')
    expect(latest.capability).toBe('organizer.node.create')
    expect(latest.ok).toBe(false)
    expect(latest.errorCode).toContain('EXTENSION_PERMISSION_MISSING_PERMISSION')
  })

  it('passes extension context through capability audit log on allowed execution', async () => {
    const fs = new FakeVaultFS({
      'notes/sample.md': `---\ntitle: Sample\n---\nhello`,
    })

    const result = await invokeExtensionCapabilityOrch({
      extensionId: 'com.thinking-space.allowed',
      extensionPermissions: ['organizer:read'],
      capability: 'organizer.node.read_frontmatter',
      input: { filePath: 'notes/sample.md' },
      fs,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const log = await fs.read('.thinking-space/audit/capability-audit.log')
    const lines = log.split('\n').filter(Boolean)
    const latest = JSON.parse(lines[lines.length - 1]) as {
      extensionId?: string
      capability: string
      ok: boolean
      origin?: string
    }
    expect(latest.extensionId).toBe('com.thinking-space.allowed')
    expect(latest.capability).toBe('organizer.node.read_frontmatter')
    expect(latest.ok).toBe(true)
    expect(latest.origin).toBe('extension')
  })
})
