// Filesystem abstraction for vault operations.
// API aligned with Obsidian's Vault / DataAdapter where possible.
// Platform-specific implementations let the same scanner code run
// on web (via backend), Capacitor (mobile), or Electron (desktop).

import { Capacitor } from '@capacitor/core'
import { EXCLUDED_DIRS } from '@/services/lego_blocks/units/vaultConstantsBlock'
import {
  getSyncExcludedPathPrefixes,
  isPathSyncExcluded,
} from '@/services/lego_blocks/units/vaultSyncExclusionsBlock'
import { getStoredVaultRoot, setStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { notifyFileChanged } from '@/services/lego_blocks/units/crossWindowSyncBlock'
import { logDebug, logWarn } from '@/services/lego_blocks/units/debugLogBlock'
import {
  base64ToBytesBlock,
  bytesToBase64Block,
  utf8ToBytesBlock,
  bytesToUtf8Block,
} from '@/services/lego_blocks/units/byteEncodingBlock'

// ── Types ──

export interface ListedFiles {
  files: string[]    // filenames (not full paths)
  folders: string[]  // folder names (not full paths)
}

export interface VaultEntry {
  path: string       // relative to vault root
  size: number
  mtime: number      // unix timestamp (seconds)
  ctime: number      // unix timestamp (seconds), creation time
}

export interface VaultStat {
  size: number
  mtime: number
  ctime?: number
  isDirectory?: boolean
}

function normalizeVaultPathForValidationBlock(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
}

const warnedInvalidVaultPathKeysBlock = new Set<string>()

function invalidVaultPathReasonBlock(path: string, options?: { allowEmpty?: boolean }): string | null {
  const normalized = normalizeVaultPathForValidationBlock(path)
  if (!normalized) return options?.allowEmpty ? null : 'empty path'
  if (normalized === '.md') return `invalid normalized path "${normalized}"`

  const segments = normalized.split('/').filter(Boolean)
  if (segments.some(segment => segment.trim() === '' || segment.trim() === '.')) return 'contains invalid empty path segment'

  // '?' segments/filenames are legitimate user data on disk; the iOS Filesystem
  // plugin previously mis-parsed them as URL queries, but CapacitorVaultFS now
  // percent-encodes them in resolve(). Don't reject — let them through.
  return null
}

function warnRejectedVaultPathBlock(op: string, path: string, reason: string): void {
  const key = `${op}::${path}::${reason}`
  if (warnedInvalidVaultPathKeysBlock.has(key)) return
  warnedInvalidVaultPathKeysBlock.add(key)
  logWarn(
    `Rejected invalid vault path before filesystem call`,
    `op=${op} path=${path} reason=${reason}`,
    'fsBlock',
  )
}

function assertValidVaultPathBlock(op: string, path: string, options?: { allowEmpty?: boolean }): string {
  const reason = invalidVaultPathReasonBlock(path, options)
  if (!reason) return path
  warnRejectedVaultPathBlock(op, path, reason)
  throw new Error(`Rejected invalid vault path for ${op}: ${path} (${reason})`)
}

function isValidVaultPathBlock(path: string, options?: { allowEmpty?: boolean }): boolean {
  const reason = invalidVaultPathReasonBlock(path, options)
  if (!reason) return true
  warnRejectedVaultPathBlock('exists', path, reason)
  return false
}

function vaultPathOrNullBlock(op: string, path: string, options?: { allowEmpty?: boolean }): string | null {
  const reason = invalidVaultPathReasonBlock(path, options)
  if (reason) {
    warnRejectedVaultPathBlock(op, path, reason)
    return null
  }
  return path
}

// Build a fully-valid URL segment for the iOS Filesystem plugin. The plugin
// runs `URL(string:)` on the file:// URI; if any character is invalid (e.g. a
// raw space, '?', or '#'), construction fails and the plugin falls back to
// `addingPercentEncoding` over the whole string, which re-encodes our literal
// '%' characters (turning a '?' we encoded as '%3F' into '%253F') and breaks
// the path. encodeURIComponent encodes everything the URL parser needs —
// including spaces, '?', '#', and literal '%' — so the plugin accepts the
// URI as-is and decodes it correctly when hitting the filesystem.
function encodeFileUriSegmentBlock(segment: string): string {
  return encodeURIComponent(segment)
}

function isAlreadyExistsFilesystemErrorBlock(error: unknown): boolean {
  const maybeRecord = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null
  const code = typeof maybeRecord?.code === 'string' ? maybeRecord.code : ''
  const message = error instanceof Error
    ? error.message
    : typeof maybeRecord?.message === 'string'
      ? maybeRecord.message
      : String(error)
  const normalized = message.toLowerCase()
  return code === 'OS-PLUG-FILE-0010'
    || normalized.includes('already exists')
    || normalized.includes('cannot be overwritten')
    || normalized.includes('eexist')
}

// ── Electron API type declaration ──

interface ElectronAPI {
  isElectron: true
  terminalSupported?: boolean
  windowGetContext?(): {
    browserWindowId: number | null
    sessionId: string
    isMainWindow: boolean
    isBackgroundAuthority: boolean
  }
  onWindowContext?(handler: (context: {
    browserWindowId: number | null
    sessionId: string
    isMainWindow: boolean
    isBackgroundAuthority: boolean
  }) => void): () => void
  versions?: {
    app: string
    electron: string
    chrome: string
    node: string
    v8: string
  }
  capabilitiesList(): Promise<{
    ok: boolean
    capabilities?: Array<{ name: string; description: string; readOnly: boolean }>
  }>
  capabilitiesInvoke(payload: {
    vaultRoot: string
    request: {
      capability: string
      input: Record<string, unknown>
      actor?: { kind: 'human' | 'agent' | 'system'; id?: string }
      requestId?: string
      dryRun?: boolean
    }
    apiBaseUrl?: string
  }): Promise<unknown>
  extensionRuntimeInvoke(payload: {
    vaultRoot: string
    extensionId: string
    extensionRegistryKey: string
    extensionPermissions: string[]
    runtimeEntry: string
    runtimeHandler: string
    actionId: string
    input: Record<string, unknown>
    context?: Record<string, unknown>
    actor?: { kind: 'human' | 'agent' | 'system'; id?: string }
    requestId?: string
    dryRun?: boolean
  }): Promise<unknown>
  selectVaultFolder(): Promise<string | null>
  openExternal?(url: string): Promise<void>
  fetchText?(url: string): Promise<{ status: number; body: string }>
  fetchBytes?(url: string): Promise<{ status: number; bytesBase64: string; contentType: string | null }>
  /** Read-only native AI session metadata (locked to ~/.claude/projects + ~/.codex/sessions). */
  nativeAiSessionsList?(): Promise<Array<{
    source: 'claude' | 'codex'
    relPath: string
    mtime: number
    size: number
  }>>
  nativeAiSessionRead?(source: 'claude' | 'codex', relPath: string): Promise<string>
  googleOauthRequest?(payload: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Record<string, string>
    body?: string
  }): Promise<{ status: number; body: string }>
  vaultRootGetPersisted?(): string | null
  vaultRootSetPersisted?(vaultRoot: string | null): Promise<void>
  vaultWatchStart?(vaultRoot: string): Promise<{ ok: boolean; error?: string }>
  vaultWatchStop?(vaultRoot: string): Promise<{ ok: boolean }>
  onVaultWatchEvent?(handler: (event: { kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }) => void): () => void
  newWindow?(route?: string): Promise<void>
  clearGpuCache?(): Promise<void>
  markdownEditorOnPasteAsTable?(handler: () => void): () => void
  sourceConfigGet?(): Promise<{ mode: string; sourcePath: string | null; vitePort: number; viteRunning: boolean }>
  sourceConfigSet?(config: { mode?: string; sourcePath?: string | null; vitePort?: number }): Promise<{ mode: string; sourcePath: string | null; vitePort: number; requiresRestart: boolean }>
  sourceEnvCheck?(): Promise<{ nodeVersion: string | null; nodeMeetsMinimum: boolean; npmVersion: string | null; depsInstalled: boolean; isGitRepo: boolean; gitBranch: string | null }>
  sourceInstallDeps?(): Promise<{ ok: boolean; error?: string }>
  onSourceInstallProgress?(handler: (entry: { step: string; message: string; type: string }) => void): () => void
  onSourceInstallDone?(handler: (result: { ok: boolean; error?: string }) => void): () => void
  sourceRebuildStart?(): Promise<{ ok: boolean; started?: boolean; error?: string }>
  sourceRebuildApply?(newAppPath: string): Promise<{ ok: boolean; error?: string }>
  onSourceRebuildProgress?(handler: (event: { step: string; message: string; type: string }) => void): () => void
  onSourceRebuildDone?(handler: (result: { ok: boolean; newAppPath?: string; error?: string }) => void): () => void
  terminalCreate?(opts: { cwd?: string; cols: number; rows: number; env?: Record<string, string> }): Promise<{ id: string }>
  terminalInput?(id: string, data: string): Promise<void>
  terminalResize?(id: string, cols: number, rows: number): Promise<void>
  terminalKill?(id: string): Promise<void>
  terminalDetach?(id: string): Promise<void>
  terminalReattach?(id: string): Promise<{ buffer: string } | null>
  debugPerformanceSnapshot?(): Promise<{
    appCpuPercent: number
    appMemoryWorkingSetBytes: number
    appMemoryPeakWorkingSetBytes: number
    processCount: number
    threadCount: number | null
    browserProcessCount: number
    rendererProcessCount: number
    utilityProcessCount: number
    gpuProcessCount: number
    logicalCpuCount: number
    gpuProcessCpuPercent: number | null
    gpuProcessMemoryWorkingSetBytes: number | null
    gpuRenderer: string | null
    gpuModel: string | null
    gpuFeatureStatus: Record<string, string>
    topProcesses: Array<{
      pid: number
      type: string
      name: string | null
      serviceName: string | null
      cpuPercent: number
      idleWakeupsPerSecond: number
      workingSetBytes: number
      peakWorkingSetBytes: number
      threads: number | null
    }>
  }>
  codexProfilesList?(siteIds: string[]): Promise<{
    activeHomePath: string
    launchctlHomePath: string | null
    profileRootPath: string
    profiles: Array<{
      siteId: string
      profileId: string
      homePath: string
      active: boolean
      exists: boolean
      hasAuthFile: boolean
      accountId: string | null
      authMode: string | null
      lastRefresh: string | null
      expiresAt: string | null
      authFileUpdatedAt: string | null
      launchctlMatches: boolean
      error?: string
    }>
  }>
  codexProfileActivate?(siteId: string): Promise<{
    activeHomePath: string
    launchctlHomePath: string | null
    launchctlApplied: boolean
    warning: string | null
    profile: {
      siteId: string
      profileId: string
      homePath: string
      active: boolean
      exists: boolean
      hasAuthFile: boolean
      accountId: string | null
      authMode: string | null
      lastRefresh: string | null
      expiresAt: string | null
      authFileUpdatedAt: string | null
      launchctlMatches: boolean
      error?: string
    }
  }>
  onTerminalData?(id: string, handler: (data: string) => void): () => void
  onTerminalExit?(id: string, handler: (exitCode: number) => void): () => void
  // Write-through of the open-source AI base URL into main-process persistence,
  // so setupContentSecurityPolicy can allow this origin in connect-src next launch.
  opensourceAiBaseUrlSetPersisted?(baseUrl: string | null): Promise<void>
  // Vault write prefs — gates the raw-signal harvesters (Apple Screen Time,
  // GoodNotes reading log) that dump under `ai-raw/`. Pass the current
  // vaultRoot so main can auto-migrate legacy installs on first read.
  vaultWritesAiRawGetPersisted?(vaultRoot: string | null): Promise<boolean>
  vaultWritesAiRawSetPersisted?(enabled: boolean): Promise<void>
  vaultWritesAiActivityGetPersisted?(vaultRoot: string | null): Promise<boolean>
  vaultWritesAiActivitySetPersisted?(enabled: boolean): Promise<void>
  // Claude Code CLI intelligence provider — shells `claude -p` in main so
  // Pro-plan users don't get billed on the API. See claudeCliBlock in main.
  claudeCliChat?(
    requestId: string,
    request: { model: string; system: string; userPrompt: string; timeoutMs: number },
  ): Promise<{ ok: boolean; content?: string; error?: string; latencyMs?: number }>
  claudeCliCancel?(requestId: string): Promise<void>
  claudeCliProbe?(): Promise<{ available: boolean; version: string | null }>
  read(vaultRoot: string, relPath: string): Promise<string>
  write(vaultRoot: string, relPath: string, data: string): Promise<void>
  readBytesBase64?(vaultRoot: string, relPath: string): Promise<string>
  writeBytesBase64?(vaultRoot: string, relPath: string, base64Data: string): Promise<void>
  list(vaultRoot: string, relPath: string): Promise<ListedFiles>
  walkVault(vaultRoot: string, extensions: string[]): Promise<VaultEntry[]>
  stat(vaultRoot: string, relPath: string): Promise<VaultStat>
  exists(vaultRoot: string, relPath: string): Promise<boolean>
  mkdir(vaultRoot: string, relPath: string): Promise<void>
  rename?(vaultRoot: string, fromRelPath: string, toRelPath: string): Promise<void>
  deletePath?(vaultRoot: string, relPath: string, recursive?: boolean): Promise<void>
  copyPath?(vaultRoot: string, fromRelPath: string, toRelPath: string): Promise<void>
  revealPath?(vaultRoot: string, relPath: string): Promise<void>
  openPath?(vaultRoot: string, relPath: string): Promise<void>
  git(vaultRoot: string, args: string[]): Promise<string>
  excalidrawPluginStatus(vaultRoot: string): Promise<import('@/services/lego_blocks/units/typesBlock').ExcalidrawPluginStatus>
  installLatestExcalidrawPlugin(vaultRoot: string): Promise<import('@/services/lego_blocks/units/typesBlock').ExcalidrawPluginStatus>
  hierarchyDbStatus(vaultRoot: string): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyDbStatus>
  initHierarchyDb(vaultRoot: string): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyDbStatus>
  hierarchyListNodes(
    vaultRoot: string,
    params: { parent_id: string | null; type?: import('@/services/lego_blocks/units/typesBlock').HierarchyNodeType | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyNode[]>
  hierarchyGetNode(vaultRoot: string, nodeId: string): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyNode>
  hierarchyCreateNode(
    vaultRoot: string,
    params: { type: import('@/services/lego_blocks/units/typesBlock').HierarchyNodeType; node_kind?: string | null; title: string; parent_id: string | null; slug?: string | null; sort_order: number },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyNode>
  hierarchyUpdateNode(
    vaultRoot: string,
    params: { node_id: string; type?: import('@/services/lego_blocks/units/typesBlock').HierarchyNodeType | null; node_kind?: string | null; title?: string | null; slug?: string | null; sort_order?: number | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyNode>
  hierarchyMoveNode(
    vaultRoot: string,
    params: { node_id: string; new_parent_id: string | null; sort_order?: number | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyNode>
  hierarchyDeleteNode(vaultRoot: string, nodeId: string): Promise<{ success: boolean }>
  hierarchyUpsertThought(
    vaultRoot: string,
    params: { file_path: string; title?: string | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyThought>
  hierarchyListThoughts(
    vaultRoot: string,
    params: { unlinked_only: boolean; limit: number },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyThought[]>
  hierarchyListThoughtLinks(
    vaultRoot: string,
    params: { thought_id?: string | null; node_id?: string | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyThoughtLink[]>
  hierarchyCreateThoughtLink(
    vaultRoot: string,
    params: { thought_id: string; node_id: string; link_kind?: string | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyThoughtLink>
  hierarchyDeleteThoughtLink(vaultRoot: string, linkId: string): Promise<{ success: boolean }>
  hierarchyListEdges(
    vaultRoot: string,
    params: { from_node_id?: string | null; to_node_id?: string | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyEdge[]>
  hierarchyCreateEdge(
    vaultRoot: string,
    params: { from_node_id: string; to_node_id: string; edge_kind?: string | null },
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyEdge>
  hierarchyDeleteEdge(vaultRoot: string, edgeId: string): Promise<{ success: boolean }>
  hierarchyResolvePath(
    vaultRoot: string,
    requestedPath: string,
  ): Promise<import('@/services/lego_blocks/units/typesBlock').HierarchyPathResolution>

  // AI credential management
  aiGetClaudeCredentials(): Promise<{ accessToken: string; refreshToken: string; expiresAt: string } | null>
  aiGetCodexCredentials(): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; accountId?: string } | null>
  aiGetAzureCredentials(): Promise<{ accessToken: string; expiresOn: string } | null>
  aiRefreshClaudeToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }>
  aiRefreshCodexToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; accountId?: string }>
  aiChatCodex(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    accessToken: string,
    accountId?: string,
    model?: string,
  ): Promise<{ text: string; model: string; inputTokens?: number; outputTokens?: number; totalTokens?: number }>
  webullGet?(payload: {
    url: string
    headers: Record<string, string>
    method?: 'GET' | 'POST'
    body?: string
  }): Promise<{ status: number; body: string }>
  webullAccountList?(payload: {
    url: string
    headers: Record<string, string>
    method?: 'GET' | 'POST'
    body?: string
  }): Promise<{ status: number; body: string }>
  webullSignedRequest?(payload: {
    method: 'GET' | 'POST'
    url: string
    version?: string
    accessToken?: string
    body?: string
  }): Promise<{ status: number; body: string }>
  webullCredentialStatus?(): Promise<{
    secureStorageAvailable: boolean
    configured: boolean
    appKeyHint: string | null
  }>
  webullCredentialSet?(payload: {
    appKey: string
    appSecret: string
  }): Promise<{
    secureStorageAvailable: boolean
    configured: boolean
    appKeyHint: string | null
  }>
  webullCredentialClear?(): Promise<{
    secureStorageAvailable: boolean
    configured: boolean
    appKeyHint: string | null
  }>
  webullTokenGet?(): Promise<{
    token: string
    expires: number | null
    status: string | null
  } | null>
  webullTokenSet?(payload: {
    token: string
    expires: number | null
    status: string | null
  } | null): Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// ── Interface ──

export interface VaultFS {
  read(path: string): Promise<string>
  write(path: string, data: string): Promise<void>
  readBytes(path: string): Promise<Uint8Array>
  writeBytes(path: string, data: Uint8Array): Promise<void>
  create(path: string, data: string): Promise<void>
  list(path: string): Promise<ListedFiles>
  walkVault(extensions?: string[]): Promise<VaultEntry[]>
  stat(path: string): Promise<VaultStat>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  delete(path: string): Promise<void>
  process(path: string, fn: (data: string) => string): Promise<void>
}

// ── WebVaultFS (calls Python backend) ──

class WebVaultFS implements VaultFS {
  async read(path: string): Promise<string> {
    const safePath = assertValidVaultPathBlock('read', path)
    const res = await fetch(`/api/tools/file-content?path=${encodeURIComponent(safePath)}`)
    if (!res.ok) {
      let detail = ''
      try {
        const payload = await res.json()
        if (payload?.detail) detail = String(payload.detail)
      } catch {
        // ignore JSON parse errors; fallback to status text
      }
      const suffix = detail || res.statusText || `HTTP ${res.status}`
      throw new Error(`Failed to read file: ${path} (${suffix})`)
    }
    const data = await res.json()
    return data.content
  }

  async write(path: string, data: string): Promise<void> {
    assertValidVaultPathBlock('write', path)
    const res = await fetch('/api/tools/vault/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: data }),
    })
    if (!res.ok) throw new Error(`Failed to write file: ${path}`)
    notifyFileChanged(path)
  }

  async readBytes(path: string): Promise<Uint8Array> {
    assertValidVaultPathBlock('readBytes', path)
    const res = await fetch(`/api/tools/vault/read-bytes?path=${encodeURIComponent(path)}`)
    if (!res.ok) {
      let detail = ''
      try {
        const payload = await res.json()
        if (payload?.detail) detail = String(payload.detail)
      } catch {
        // ignore JSON parse errors
      }
      const suffix = detail || res.statusText || `HTTP ${res.status}`
      throw new Error(`Failed to read bytes: ${path} (${suffix})`)
    }
    const payload = await res.json() as { data_base64?: string }
    return base64ToBytesBlock(payload.data_base64 || '')
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    assertValidVaultPathBlock('writeBytes', path)
    const res = await fetch('/api/tools/vault/write-bytes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        data_base64: bytesToBase64Block(data),
      }),
    })
    if (!res.ok) throw new Error(`Failed to write bytes: ${path}`)
    notifyFileChanged(path)
  }

  async create(path: string, data: string): Promise<void> {
    if (await this.exists(path)) throw new Error(`File already exists: ${path}`)
    await this.write(path, data)
  }

  async list(path: string): Promise<ListedFiles> {
    assertValidVaultPathBlock('list', path, { allowEmpty: true })
    const res = await fetch(`/api/tools/vault/readdir?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error(`Failed to list directory: ${path}`)
    const json = await res.json()
    // Backend returns { entries: [{ name, isDirectory }] } — transform to ListedFiles
    const files: string[] = []
    const folders: string[] = []
    for (const e of json.entries) {
      if (e.isDirectory) folders.push(e.name)
      else files.push(e.name)
    }
    return { files, folders }
  }

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    const ext = extensions.join(',')
    const res = await fetch(`/api/tools/vault/walk?extensions=${encodeURIComponent(ext)}`)
    if (!res.ok) throw new Error('Failed to walk vault')
    const data = await res.json()
    // Backend returns { birthtime } — map to { ctime }
    return data.files.map((f: any) => ({
      path: f.path,
      size: f.size,
      mtime: f.mtime,
      ctime: f.birthtime ?? f.ctime ?? f.mtime,
    }))
  }

  async stat(path: string): Promise<VaultStat> {
    assertValidVaultPathBlock('stat', path)
    const res = await fetch(`/api/tools/vault/stat?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error(`Failed to stat: ${path}`)
    const s = await res.json()
    return {
      size: s.size,
      mtime: s.mtime,
      ctime: s.birthtime ?? s.ctime,
      isDirectory: Boolean(s.isDirectory),
    }
  }

  async exists(path: string): Promise<boolean> {
    if (!isValidVaultPathBlock(path)) return false
    try {
      await this.stat(path)
      return true
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    assertValidVaultPathBlock('mkdir', path, { allowEmpty: true })
    const res = await fetch('/api/tools/vault/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) throw new Error(`Failed to mkdir: ${path}`)
  }

  async delete(path: string): Promise<void> {
    assertValidVaultPathBlock('delete', path)
    const res = await fetch('/api/tools/vault/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, recursive: false }),
    })
    if (!res.ok) throw new Error(`Failed to delete: ${path}`)
  }

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const content = await this.read(path)
    await this.write(path, fn(content))
  }
}

// ── ElectronVaultFS (Node.js filesystem via IPC) ──

class ElectronVaultFS implements VaultFS {
  private vaultRoot: string

  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot
  }

  private get api(): ElectronAPI {
    return window.electronAPI!
  }

  async read(path: string): Promise<string> {
    const safePath = assertValidVaultPathBlock('read', path)
    return this.api.read(this.vaultRoot, safePath)
  }

  async write(path: string, data: string): Promise<void> {
    const safePath = assertValidVaultPathBlock('write', path)
    await this.api.write(this.vaultRoot, safePath, data)
    notifyFileChanged(safePath)
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const safePath = assertValidVaultPathBlock('readBytes', path)
    if (this.api.readBytesBase64) {
      const base64 = await this.api.readBytesBase64(this.vaultRoot, safePath)
      return base64ToBytesBlock(base64)
    }
    const text = await this.read(safePath)
    return utf8ToBytesBlock(text)
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const safePath = assertValidVaultPathBlock('writeBytes', path)
    if (this.api.writeBytesBase64) {
      await this.api.writeBytesBase64(this.vaultRoot, safePath, bytesToBase64Block(data))
      notifyFileChanged(safePath)
      return
    }
    await this.write(safePath, bytesToUtf8Block(data))
  }

  async create(path: string, data: string): Promise<void> {
    if (await this.exists(path)) throw new Error(`File already exists: ${path}`)
    await this.write(path, data)
  }

  async list(path: string): Promise<ListedFiles> {
    const safePath = assertValidVaultPathBlock('list', path, { allowEmpty: true })
    return this.api.list(this.vaultRoot, safePath || '.')
  }

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    return this.api.walkVault(this.vaultRoot, extensions)
  }

  async stat(path: string): Promise<VaultStat> {
    const safePath = assertValidVaultPathBlock('stat', path)
    return this.api.stat(this.vaultRoot, safePath)
  }

  async exists(path: string): Promise<boolean> {
    const safePath = vaultPathOrNullBlock('exists', path)
    if (safePath === null) return false
    return this.api.exists(this.vaultRoot, safePath)
  }

  async mkdir(path: string): Promise<void> {
    const safePath = assertValidVaultPathBlock('mkdir', path, { allowEmpty: true })
    return this.api.mkdir(this.vaultRoot, safePath)
  }

  async delete(path: string): Promise<void> {
    const safePath = assertValidVaultPathBlock('delete', path)
    if (this.api.deletePath) {
      await this.api.deletePath(this.vaultRoot, safePath, false)
    }
  }

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const content = await this.read(path)
    await this.write(path, fn(content))
  }
}

// ── CapacitorVaultFS (reads local device filesystem) ──
// Two modes:
//   1. Relative mode: vaultRoot is relative (e.g. "LTM-Vault"), uses Directory.Documents
//   2. Absolute mode: vaultRoot starts with "/", converted to file:// URI, no directory param
// The absolute mode is used when the user picks a folder via UIDocumentPickerViewController
// (including iCloud Drive folders).

class CapacitorVaultFS implements VaultFS {
  private vaultRoot: string
  private isAbsolute: boolean

  constructor(vaultRoot: string) {
    this.isAbsolute = vaultRoot.startsWith('/')
    this.vaultRoot = vaultRoot
  }

  private resolve(path: string): string {
    const base = path ? `${this.vaultRoot}/${path}` : this.vaultRoot
    // Capacitor Filesystem on iOS parses absolute paths as URLs, so '?' and '#'
    // would be interpreted as query/fragment separators and silently truncate
    // the path. Percent-encode them (and stray '%') per-segment before building
    // the file:// URI. The native plugin handles spaces/Unicode itself.
    if (this.isAbsolute) {
      const encoded = base
        .split('/')
        .map(encodeFileUriSegmentBlock)
        .join('/')
      return `file://${encoded}`
    }
    return base
  }

  private async fsOpts(path: string) {
    if (this.isAbsolute) {
      return { path: this.resolve(path) }
    }
    const { Directory } = await import('@capacitor/filesystem')
    return { path: this.resolve(path), directory: Directory.Documents }
  }

  async read(path: string): Promise<string> {
    const safePath = assertValidVaultPathBlock('read', path)
    const { Filesystem, Encoding } = await import('@capacitor/filesystem')
    const opts = await this.fsOpts(safePath)
    const result = await Filesystem.readFile({ ...opts, encoding: Encoding.UTF8 })
    return result.data as string
  }

  async write(path: string, data: string): Promise<void> {
    const safePath = assertValidVaultPathBlock('write', path)
    const { Filesystem, Encoding } = await import('@capacitor/filesystem')
    const opts = await this.fsOpts(safePath)
    await Filesystem.writeFile({ ...opts, data, encoding: Encoding.UTF8, recursive: true })
    notifyFileChanged(safePath)
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const safePath = assertValidVaultPathBlock('readBytes', path)
    const { Filesystem } = await import('@capacitor/filesystem')
    const opts = await this.fsOpts(safePath)
    const result = await Filesystem.readFile(opts)
    if (typeof result.data === 'string') {
      return base64ToBytesBlock(result.data)
    }
    const arrayBuffer = await (result.data as Blob).arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const safePath = assertValidVaultPathBlock('writeBytes', path)
    const { Filesystem } = await import('@capacitor/filesystem')
    const opts = await this.fsOpts(safePath)
    await Filesystem.writeFile({
      ...opts,
      data: bytesToBase64Block(data),
      recursive: true,
    })
    notifyFileChanged(safePath)
  }

  async create(path: string, data: string): Promise<void> {
    if (await this.exists(path)) throw new Error(`File already exists: ${path}`)
    await this.write(path, data)
  }

  async list(path: string): Promise<ListedFiles> {
    const safePath = assertValidVaultPathBlock('list', path, { allowEmpty: true })
    const { Filesystem } = await import('@capacitor/filesystem')
    const exists = await this.exists(safePath).catch(() => false)
    if (!exists) return { files: [], folders: [] }
    const opts = await this.fsOpts(safePath)
    const result = await Filesystem.readdir(opts)
    const files: string[] = []
    const folders: string[] = []
    for (const f of result.files) {
      if (f.name.startsWith('.')) continue
      if (f.type === 'directory') folders.push(f.name)
      else files.push(f.name)
    }
    return { files, folders }
  }

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    const extSet = new Set(extensions)
    const entries: VaultEntry[] = []
    const excludedPrefixes = getSyncExcludedPathPrefixes()

    // walkByUri: use native-provided URIs from readdir results to avoid
    // encoding issues with special characters (?, #, %) in filenames.
    // Parallelized: subdirectories and file stats run concurrently for faster vault scans.
    const walk = async (dirPath: string, dirUri: string | null, relPrefix: string) => {
      const { Filesystem } = await import('@capacitor/filesystem')
      // Use the native URI when available (properly encoded); fall back to constructing our own
      const opts = dirUri
        ? { path: dirUri }
        : this.isAbsolute
          ? { path: `file://${dirPath}` }
          : { path: dirPath, directory: (await import('@capacitor/filesystem')).Directory.Documents }
      const result = await Filesystem.readdir(opts)

      const subdirPromises: Promise<void>[] = []
      const fileStatPromises: Promise<void>[] = []

      for (const item of result.files) {
        if (item.name.startsWith('.') || EXCLUDED_DIRS.has(item.name)) continue
        const relPath = relPrefix ? `${relPrefix}/${item.name}` : item.name
        if (excludedPrefixes.length > 0 && isPathSyncExcluded(relPath, excludedPrefixes)) continue
        // readdir returns a `uri` for each item that's already properly encoded
        const itemUri: string | undefined = (item as any).uri

        if (item.type === 'directory') {
          const childDir = `${dirPath}/${item.name}`
          subdirPromises.push(
            walk(childDir, itemUri ?? null, relPath).catch(err => {
              // iCloud may list folder metadata for directories that were
              // deleted upstream but whose deletion hasn't synced down to this
              // device yet. The parent readdir returns them as type='directory',
              // but readdir on the child fails with OS-PLUG-FILE-0008. Catch
              // here so the failure doesn't bubble through the iOS plugin into
              // console.error (where it would surface in the debug panel).
              const message = err instanceof Error ? err.message : String(err)
              logDebug(`Skipped iCloud-stale subdirectory during walk: ${relPath}`, message, 'fsBlock')
            }),
          )
        } else {
          const ext = '.' + item.name.split('.').pop()?.toLowerCase()
          if (!extSet.has(ext || '')) continue
          // Use the native URI for stat to avoid encoding issues
          const stOpts = itemUri
            ? { path: itemUri }
            : this.isAbsolute
              ? { path: `file://${dirPath}/${item.name}` }
              : { path: `${dirPath}/${item.name}`, directory: (await import('@capacitor/filesystem')).Directory.Documents }
          fileStatPromises.push(
            Filesystem.stat(stOpts).then(st => {
              entries.push({
                path: relPath,
                size: st.size,
                mtime: (st.mtime || 0) / 1000,
                ctime: (st.ctime || st.mtime || 0) / 1000,
              })
            }).catch(err => {
              // iCloud placeholders not yet downloaded — same race as above.
              const message = err instanceof Error ? err.message : String(err)
              logDebug(`Skipped iCloud-stale file during walk stat: ${relPath}`, message, 'fsBlock')
            }),
          )
        }
      }

      // Wait for all subdirectories and file stats in parallel
      await Promise.all([...subdirPromises, ...fileStatPromises])
    }

    await walk(this.vaultRoot, null, '')
    return entries
  }

  async stat(path: string): Promise<VaultStat> {
    const safePath = assertValidVaultPathBlock('stat', path)
    const { Filesystem } = await import('@capacitor/filesystem')
    const opts = await this.fsOpts(safePath)
    const st = await Filesystem.stat(opts)
    return {
      size: st.size,
      mtime: (st.mtime || 0) / 1000,
      ctime: (st.ctime || st.mtime || 0) / 1000,
    }
  }

  async exists(path: string): Promise<boolean> {
    const safePath = vaultPathOrNullBlock('exists', path, { allowEmpty: true })
    if (safePath === null) return false
    if (!safePath) return true

    const normalized = safePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!normalized) return true

    const slashIndex = normalized.lastIndexOf('/')
    const parent = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ''
    const name = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
    if (!name) return true

    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    try {
      const parentOpts = this.isAbsolute
        ? { path: parent ? this.resolve(parent) : this.resolve('') }
        : { path: parent ? this.resolve(parent) : this.vaultRoot, directory: Directory.Documents }
      const listed = await Filesystem.readdir(parentOpts)
      return listed.files.some((entry) => entry.name === name)
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    const safePath = assertValidVaultPathBlock('mkdir', path, { allowEmpty: true })
    const { Filesystem } = await import('@capacitor/filesystem')
    const opts = await this.fsOpts(safePath)
    const exists = await this.exists(safePath).catch(() => false)
    if (exists) return
    try {
      await Filesystem.mkdir({ ...opts, recursive: true })
    } catch (error) {
      if (isAlreadyExistsFilesystemErrorBlock(error)) return
      throw error
    }
  }

  async delete(path: string): Promise<void> {
    const safePath = assertValidVaultPathBlock('delete', path)
    const { Filesystem } = await import('@capacitor/filesystem')
    const opts = await this.fsOpts(safePath)
    await Filesystem.deleteFile(opts)
  }

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const content = await this.read(path)
    await this.write(path, fn(content))
  }
}

// ── BrowserVaultFS (File System Access API — serverless web) ──

// Store the directory handle in IndexedDB for persistence across sessions.
const FS_HANDLE_DB = 'ltm-fs-handles'
const FS_HANDLE_STORE = 'handles'
const FS_HANDLE_KEY = 'vault-root'

async function persistDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_HANDLE_DB, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(FS_HANDLE_STORE)
    }
    req.onsuccess = () => {
      const tx = req.result.transaction(FS_HANDLE_STORE, 'readwrite')
      tx.objectStore(FS_HANDLE_STORE).put(handle, FS_HANDLE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getPersistedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_HANDLE_DB, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(FS_HANDLE_STORE)
    }
    req.onsuccess = () => {
      const tx = req.result.transaction(FS_HANDLE_STORE, 'readonly')
      const get = tx.objectStore(FS_HANDLE_STORE).get(FS_HANDLE_KEY)
      get.onsuccess = () => resolve(get.result ?? null)
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  })
}

export class BrowserVaultFS implements VaultFS {
  private root: FileSystemDirectoryHandle

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root
  }

  private async resolveFile(filePath: string, create = false): Promise<FileSystemFileHandle> {
    assertValidVaultPathBlock(create ? 'write' : 'read', filePath)
    const parts = filePath.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let dir = this.root
    for (const segment of parts) {
      dir = await dir.getDirectoryHandle(segment, { create })
    }
    return dir.getFileHandle(fileName, { create })
  }

  private async resolveDir(dirPath: string, create = false): Promise<FileSystemDirectoryHandle> {
    assertValidVaultPathBlock(create ? 'mkdir' : 'list', dirPath, { allowEmpty: true })
    const parts = dirPath.split('/').filter(Boolean)
    let dir = this.root
    for (const segment of parts) {
      dir = await dir.getDirectoryHandle(segment, { create })
    }
    return dir
  }

  async read(filePath: string): Promise<string> {
    const handle = await this.resolveFile(filePath)
    const file = await handle.getFile()
    return file.text()
  }

  async write(filePath: string, data: string): Promise<void> {
    const handle = await this.resolveFile(filePath, true)
    const writable = await handle.createWritable()
    await writable.write(data)
    await writable.close()
    notifyFileChanged(filePath)
  }

  async readBytes(filePath: string): Promise<Uint8Array> {
    const handle = await this.resolveFile(filePath)
    const file = await handle.getFile()
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  }

  async writeBytes(filePath: string, data: Uint8Array): Promise<void> {
    const handle = await this.resolveFile(filePath, true)
    const writable = await handle.createWritable()
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    await writable.write(copy)
    await writable.close()
    notifyFileChanged(filePath)
  }

  async create(filePath: string, data: string): Promise<void> {
    if (await this.exists(filePath)) throw new Error(`File already exists: ${filePath}`)
    await this.write(filePath, data)
  }

  async list(dirPath: string): Promise<ListedFiles> {
    const dir = await this.resolveDir(dirPath)
    const files: string[] = []
    const folders: string[] = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (name.startsWith('.')) continue
      if (handle.kind === 'directory') folders.push(name)
      else files.push(name)
    }
    return { files, folders }
  }

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    const extSet = new Set(extensions)
    const entries: VaultEntry[] = []
    const excludedPrefixes = getSyncExcludedPathPrefixes()

    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      // Collect all entries first (async iterator must be consumed sequentially)
      const items: Array<[string, FileSystemHandle]> = []
      for await (const [name, handle] of (dir as any).entries()) {
        if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue
        const relPath = prefix ? `${prefix}/${name}` : name
        if (excludedPrefixes.length > 0 && isPathSyncExcluded(relPath, excludedPrefixes)) continue
        items.push([name, handle])
      }

      // Then process subdirs and file stats in parallel
      const promises: Promise<void>[] = []
      for (const [name, handle] of items) {
        const relPath = prefix ? `${prefix}/${name}` : name

        if (handle.kind === 'directory') {
          promises.push(walk(handle as FileSystemDirectoryHandle, relPath))
        } else {
          const ext = '.' + name.split('.').pop()?.toLowerCase()
          if (!extSet.has(ext || '')) continue
          promises.push(
            (handle as FileSystemFileHandle).getFile().then(file => {
              entries.push({
                path: relPath,
                size: file.size,
                mtime: file.lastModified / 1000,
                ctime: file.lastModified / 1000, // File System Access API doesn't expose ctime
              })
            }),
          )
        }
      }

      await Promise.all(promises)
    }

    await walk(this.root, '')
    return entries
  }

  async stat(filePath: string): Promise<VaultStat> {
    assertValidVaultPathBlock('stat', filePath)
    // Try as file first, then as directory
    try {
      const handle = await this.resolveFile(filePath)
      const file = await handle.getFile()
      return {
        size: file.size,
        mtime: file.lastModified / 1000,
        ctime: file.lastModified / 1000,
        isDirectory: false,
      }
    } catch {
      // Try as directory
      await this.resolveDir(filePath)
      return { size: 0, mtime: 0, ctime: 0, isDirectory: true }
    }
  }

  async exists(filePath: string): Promise<boolean> {
    if (!isValidVaultPathBlock(filePath, { allowEmpty: true })) return false
    try {
      await this.stat(filePath)
      return true
    } catch {
      return false
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    await this.resolveDir(dirPath, true)
  }

  async delete(filePath: string): Promise<void> {
    assertValidVaultPathBlock('delete', filePath)
    const parts = filePath.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let dir = this.root
    for (const segment of parts) {
      dir = await dir.getDirectoryHandle(segment)
    }
    await dir.removeEntry(fileName)
  }

  async process(filePath: string, fn: (data: string) => string): Promise<void> {
    const content = await this.read(filePath)
    await this.write(filePath, fn(content))
  }
}

export function isBrowserFSAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export async function initBrowserVaultFS(): Promise<BrowserVaultFS | null> {
  if (!isBrowserFSAvailable()) return null

  // Try to restore a persisted handle
  const handle = await getPersistedDirectoryHandle()
  if (!handle) return null

  // Request permission — if denied, the user will need to re-pick
  const perm = await (handle as any).requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') return null

  return new BrowserVaultFS(handle)
}

export async function pickAndInitBrowserVaultFS(): Promise<BrowserVaultFS> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await persistDirectoryHandle(handle)
  return new BrowserVaultFS(handle)
}

// ── Platform detection + singleton ──

let _instance: VaultFS | null = null
const DEFAULT_CAPACITOR_VAULT_ROOT = 'LTM-Vault'

export function getVaultFS(): VaultFS {
  if (_instance) return _instance
  _instance = createVaultFS()
  return _instance
}

function createVaultFS(): VaultFS {
  // Electron desktop
  if (isElectron()) {
    const vaultRoot = getStoredVaultRoot() ?? ''
    return new ElectronVaultFS(vaultRoot)
  }
  // Capacitor mobile
  if (isCapacitorNative()) {
    const { vaultRoot, normalizedStoredRoot } = normalizeCapacitorStoredVaultRoot(getStoredVaultRoot())
    if (normalizedStoredRoot) {
      setStoredVaultRoot(normalizedStoredRoot)
    }
    return new CapacitorVaultFS(vaultRoot)
  }
  // Web fallback
  return new WebVaultFS()
}

export function isElectron(): boolean {
  if (typeof window === 'undefined') return false
  return !!window.electronAPI?.isElectron
}

export function isEmbeddedTerminalSupported(): boolean {
  if (!isElectron()) return false
  return window.electronAPI?.terminalSupported !== false
}

export function isCapacitorNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function isDesktop(): boolean {
  return isElectron()
}

export function getPlatformName(): 'electron' | 'ios' | 'android' | 'web' {
  if (isElectron()) return 'electron'
  if (isCapacitorNative()) {
    try {
      const platform = Capacitor.getPlatform()
      if (platform === 'ios') return 'ios'
      if (platform === 'android') return 'android'
    } catch { /* fallthrough */ }
  }
  return 'web'
}

export function setVaultFSInstance(fs: VaultFS): void {
  _instance = fs
}

export function setVaultRoot(path: string): void {
  setStoredVaultRoot(path)
  // Reset singleton so next getVaultFS() uses new root
  _instance = null
}

export async function selectAndSetVaultRoot(): Promise<string | null> {
  if (!isElectron()) return null
  const selected = await window.electronAPI!.selectVaultFolder()
  if (selected) {
    setVaultRoot(selected)
  }
  return selected
}

export function normalizeCapacitorStoredVaultRoot(storedRoot: string | null): {
  vaultRoot: string
  normalizedStoredRoot: string | null
} {
  const stored = storedRoot ?? ''
  // cap-picker: prefix means a folder picked via native UIDocumentPickerViewController
  // The path after the prefix is an absolute POSIX path (e.g. /private/var/mobile/...)
  if (stored.startsWith('cap-picker:')) {
    return {
      vaultRoot: stored.slice('cap-picker:'.length),
      normalizedStoredRoot: null,
    }
  }
  // Relative path within Documents (e.g. "LTM-Vault")
  // Reject stale absolute paths from older versions
  if (stored.startsWith('/')) {
    return {
      vaultRoot: DEFAULT_CAPACITOR_VAULT_ROOT,
      normalizedStoredRoot: DEFAULT_CAPACITOR_VAULT_ROOT,
    }
  }
  const resolved = stored || DEFAULT_CAPACITOR_VAULT_ROOT
  return {
    vaultRoot: resolved,
    normalizedStoredRoot: null,
  }
}
