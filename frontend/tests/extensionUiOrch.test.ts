import { beforeEach, describe, expect, it } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'
import { setCapabilityFeatureFlags } from '@/services/lego_blocks/integrations/capabilityFeatureFlagsBlock'
import { clearExtensionRegistryOrch } from '@/services/orchestrators/extensionLoaderOrch'
import {
  buildExtensionActionKeyOrch,
  invokeExtensionSlotActionOrch,
  refreshExtensionUiOrch,
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

function setElectronApiMock(value: unknown): void {
  const root = globalThis as unknown as { window?: { electronAPI?: unknown } }
  if (!root.window) root.window = {}
  root.window.electronAPI = value
}

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

function manifestWithActions(): string {
  return JSON.stringify({
    id: 'com.thinking-space.ui-demo',
    name: 'UI demo',
    version: '1.0.0',
    api_version: '1',
    entry_kind: 'declarative',
    min_app_version: '0.1.0',
    permissions: ['organizer:read'],
    targets: ['sidebar-bottom', 'thought-context-actions'],
    actions: [
      {
        id: 'read-frontmatter',
        label: 'Read frontmatter',
        target: 'thought-context-actions',
        capability: 'organizer.node.read_frontmatter',
        input: {
          filePath: '{{context.filePath}}',
        },
      },
      {
        id: 'list-folders',
        label: 'List folders',
        target: 'sidebar-bottom',
        capability: 'tools.folders.list',
        input: { limit: 5 },
      },
    ],
  })
}

function runtimeManifestWithActions(): string {
  return JSON.stringify({
    id: 'com.thinking-space.runtime-demo',
    name: 'Runtime demo',
    version: '1.0.0',
    api_version: '1',
    entry_kind: 'electron-js',
    entry: 'runtime/main.ts',
    min_app_version: '0.1.0',
    permissions: ['organizer:read'],
    targets: ['thought-context-actions'],
    actions: [
      {
        id: 'runtime-frontmatter',
        runtime_handler: 'readFrontmatter',
        label: 'Runtime frontmatter',
        target: 'thought-context-actions',
        input: {
          filePath: '{{context.filePath}}',
        },
      },
    ],
  })
}

describe('extensionUiOrch', () => {
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
    setElectronApiMock(undefined)
  })

  it('resolves actions for supported slot targets', async () => {
    const fs = new FakeVaultFS({
      '.extensions/demo/manifest.json': manifestWithActions(),
    })
    await refreshExtensionUiOrch({ fs, appVersion: '0.1.0' })

    const resolved = resolveExtensionSlotActionsOrch('sidebar-bottom')
    expect(resolved.supported).toBe(true)
    expect(resolved.reason).toBeNull()
    expect(resolved.actions).toHaveLength(1)
    expect(resolved.actions[0]).toMatchObject({
      actionId: 'list-folders',
      extensionId: 'com.thinking-space.ui-demo',
      extensionRegistryKey: 'demo',
    })
  })

  it('returns deterministic reason for unsupported slot targets', () => {
    const resolved = resolveExtensionSlotActionsOrch('footer-actions')
    expect(resolved).toEqual({
      supported: false,
      slotId: 'footer-actions',
      actions: [],
      reason: {
        code: 'UNSUPPORTED_TARGET',
        message: 'Unsupported extension slot target "footer-actions".',
      },
    })
  })

  it('returns feature-disabled reason when extension host flag is off', () => {
    setCapabilityFeatureFlags({
      agent_capabilities_enabled: false,
      fastapi_capability_adapter_enabled: false,
      extension_host_enabled: false,
      extension_builder_enabled: true,
      yaml_fields_auto_heal_enabled: false,
      hybrid_sync_reconciliation_enabled: false,
    })
    const resolved = resolveExtensionSlotActionsOrch('sidebar-bottom')
    expect(resolved).toEqual({
      supported: false,
      slotId: 'sidebar-bottom',
      actions: [],
      reason: {
        code: 'FEATURE_DISABLED',
        message: 'Extension host is disabled by feature flag.',
      },
    })
  })

  it('blocks action invocation when extension host flag is off', async () => {
    const fs = new FakeVaultFS({
      '.extensions/demo/manifest.json': manifestWithActions(),
      'notes/sample.md': `---\ntitle: Sample\n---\nhello`,
    })
    await refreshExtensionUiOrch({ fs, appVersion: '0.1.0' })
    setCapabilityFeatureFlags({
      agent_capabilities_enabled: false,
      fastapi_capability_adapter_enabled: false,
      extension_host_enabled: false,
      extension_builder_enabled: true,
      yaml_fields_auto_heal_enabled: false,
      hybrid_sync_reconciliation_enabled: false,
    })

    await expect(
      invokeExtensionSlotActionOrch({
        slotId: 'thought-context-actions',
        actionKey: buildExtensionActionKeyOrch('demo', 'read-frontmatter'),
        context: { filePath: 'notes/sample.md' },
        fs,
      }),
    ).rejects.toThrowError('Extension host is disabled by feature flag.')
  })

  it('invokes declarative action with context-backed input template', async () => {
    const fs = new FakeVaultFS({
      '.extensions/demo/manifest.json': manifestWithActions(),
      'notes/sample.md': `---\ntitle: Sample\n---\nhello`,
    })
    await refreshExtensionUiOrch({ fs, appVersion: '0.1.0' })

    const result = await invokeExtensionSlotActionOrch({
      slotId: 'thought-context-actions',
      actionKey: buildExtensionActionKeyOrch('demo', 'read-frontmatter'),
      context: {
        filePath: 'notes/sample.md',
      },
      fs,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || 'blocked' in result) return
    expect((result.data as { frontmatter?: { title?: string } }).frontmatter?.title).toBe('Sample')
  })

  it('routes runtime actions through electron runtime adapter', async () => {
    const invokedPayloads: Record<string, unknown>[] = []
    setElectronApiMock({
      isElectron: true,
      extensionRuntimeInvoke: async (payload: Record<string, unknown>) => {
        invokedPayloads.push(payload)
        return {
          ok: true,
          requestId: 'req-runtime',
          extensionId: 'com.thinking-space.runtime-demo',
          extensionRegistryKey: 'runtime',
          actionId: 'runtime-frontmatter',
          runtimeHandler: 'readFrontmatter',
          warnings: [],
          data: { echoed: payload.input },
        }
      },
    } as unknown)
    localStorage.setItem('ltm-vault-root', '/tmp/vault')

    const fs = new FakeVaultFS({
      '.extensions/runtime/manifest.json': runtimeManifestWithActions(),
    })
    await refreshExtensionUiOrch({ fs, appVersion: '0.1.0' })

    const result = await invokeExtensionSlotActionOrch({
      slotId: 'thought-context-actions',
      actionKey: buildExtensionActionKeyOrch('runtime', 'runtime-frontmatter'),
      context: {
        filePath: 'notes/runtime.md',
      },
      fs,
    })

    expect(result.ok).toBe(true)
    expect(invokedPayloads).toHaveLength(1)
    expect(invokedPayloads[0]).toMatchObject({
      runtimeEntry: 'runtime/main.ts',
      runtimeHandler: 'readFrontmatter',
      actionId: 'runtime-frontmatter',
      input: {
        filePath: 'notes/runtime.md',
      },
    })
  })
})
