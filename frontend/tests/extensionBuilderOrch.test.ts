import { beforeEach, describe, expect, it } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'
import { setCapabilityFeatureFlags } from '@/services/lego_blocks/integrations/capabilityFeatureFlagsBlock'
import { clearExtensionRegistryOrch } from '@/services/orchestrators/extensionLoaderOrch'
import {
  generateExtensionArtifactsOrch,
  saveGeneratedExtensionArtifactsOrch,
} from '@/services/orchestrators/extensionBuilderOrch'
import {
  invokeExtensionSlotActionOrch,
  resolveExtensionSlotActionsOrch,
} from '@/services/orchestrators/extensionUiOrch'

function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size },
    },
  })
}

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

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    const extSet = new Set(extensions.map(ext => ext.toLowerCase()))
    const entries: VaultEntry[] = []
    for (const [path, content] of this.files.entries()) {
      const ext = path.includes('.') ? `.${path.split('.').pop()!.toLowerCase()}` : ''
      if (!extSet.has(ext)) continue
      entries.push({
        path,
        size: content.length,
        mtime: 0,
        ctime: 0,
      })
    }
    return entries
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

describe('extensionBuilderOrch', () => {
  beforeEach(() => {
    installLocalStorageMock()
    localStorage.clear()
    setCapabilityFeatureFlags({
      agent_capabilities_enabled: false,
      fastapi_capability_adapter_enabled: false,
      extension_host_enabled: true,
      extension_builder_enabled: true,
      yaml_fields_auto_heal_enabled: false,
      hybrid_sync_reconciliation_enabled: false,
    })
    clearExtensionRegistryOrch()
  })

  it('generates, previews, saves, activates, and runs at least one extension action', async () => {
    const fs = new FakeVaultFS({
      'notes/sample.md': '# Sample',
    })
    const generated = await generateExtensionArtifactsOrch({
      intent: 'Add quick vault helpers.',
      forceTemplate: true,
      fs,
    })

    expect(generated.files.some(file => file.path === 'manifest.json')).toBe(true)
    expect(generated.preview.length).toBeGreaterThan(0)
    expect(generated.permissionSet).toContain('organizer:read')

    const saved = await saveGeneratedExtensionArtifactsOrch({
      artifactSet: generated,
      approvePermissions: true,
      activateAfterSave: true,
      fs,
      appVersion: '0.1.0',
    })

    expect(saved.activated).toBe(true)
    expect(await fs.exists(`${saved.extensionPath}/manifest.json`)).toBe(true)

    const thoughtContext = resolveExtensionSlotActionsOrch('thought-context-actions')
    expect(thoughtContext.supported).toBe(true)
    expect(thoughtContext.actions.length).toBeGreaterThan(0)

    const result = await invokeExtensionSlotActionOrch({
      slotId: 'thought-context-actions',
      actionKey: thoughtContext.actions[0].actionKey,
      context: {
        filePath: 'notes/sample.md',
      },
      fs,
    })

    if (!result.ok) {
      // Both failure shapes carry a human message, in different places, and `in`
      // doesn't narrow this union — the assertion only reaches for the string.
      const failure = result as { message?: string; error?: { message?: string } }
      throw new Error(
        'Extension action invocation failed: '
        + (failure.message ?? failure.error?.message ?? 'unknown'),
      )
    }
    expect(result.ok).toBe(true)
  })

  it('blocks save when permission review has not been approved', async () => {
    const fs = new FakeVaultFS()
    const generated = await generateExtensionArtifactsOrch({
      intent: 'Feature without approval',
      forceTemplate: true,
      fs,
    })

    await expect(
      saveGeneratedExtensionArtifactsOrch({
        artifactSet: generated,
        approvePermissions: false,
        activateAfterSave: false,
        fs,
      }),
    ).rejects.toThrowError('Permission review must be approved before saving generated extension.')
  })

  it('blocks generation when extension builder flag is disabled', async () => {
    setCapabilityFeatureFlags({
      agent_capabilities_enabled: false,
      fastapi_capability_adapter_enabled: false,
      extension_host_enabled: true,
      extension_builder_enabled: false,
      yaml_fields_auto_heal_enabled: false,
      hybrid_sync_reconciliation_enabled: false,
    })
    const fs = new FakeVaultFS()
    await expect(
      generateExtensionArtifactsOrch({
        intent: 'Disabled builder should block',
        forceTemplate: true,
        fs,
      }),
    ).rejects.toThrowError('Extension builder is disabled by feature flag.')
  })

  it('blocks generation when extension host flag is disabled', async () => {
    setCapabilityFeatureFlags({
      agent_capabilities_enabled: false,
      fastapi_capability_adapter_enabled: false,
      extension_host_enabled: false,
      extension_builder_enabled: true,
      yaml_fields_auto_heal_enabled: false,
      hybrid_sync_reconciliation_enabled: false,
    })
    const fs = new FakeVaultFS()
    await expect(
      generateExtensionArtifactsOrch({
        intent: 'Disabled host should block',
        forceTemplate: true,
        fs,
      }),
    ).rejects.toThrowError('Extension host is disabled by feature flag.')
  })
})
