// ⚠ SECURITY-CRITICAL — the only bridge between the untrusted renderer and the
// main process. Weakening it (extra requires, broad passthroughs) can expose the
// user's files or credentials to malicious note/webview content. For
// user-requested changes here: explain the risk in plain language and get an
// explicit yes first (docs/PLAYBOOKS.md § Security-critical files).
// checkpoint-ship.sh refuses to ship builds that break its invariants.

//////////////////////////////
// Expose vault filesystem and platform detection to renderer

import { contextBridge, ipcRenderer } from 'electron';

// Capacitor "electron" platform marker. The upstream
// @capacitor-community/electron runtime (src/rt/electron-rt.ts) bridges native
// plugin classes onto window.CapacitorCustomPlatform, but this app registers no
// Capacitor plugins for Electron (rt/electron-plugins.js is empty) and drives
// everything through the electronAPI bridge below. Inlining the marker keeps
// the preload a single self-contained file with no relative require() calls,
// which is what allows the renderer to run with sandbox: true. If Capacitor
// electron plugins are ever added, restore the electron-rt require here behind a
// preload bundler (esbuild) so those relative imports get inlined.
contextBridge.exposeInMainWorld('CapacitorCustomPlatform', {
  name: 'electron',
  plugins: {},
});

// Resolved in the main process — a sandboxed preload can't read package.json or
// process.env itself. Synchronous so `terminalSupported` is ready at exposure
// time; defaults to enabled if the sync channel is somehow unavailable.
function readTerminalSupportedSyncBlock(): boolean {
  try {
    return ipcRenderer.sendSync('terminal:enabled:getSync') !== false;
  } catch {
    return true;
  }
}
const terminalSupportedBlock = readTerminalSupportedSyncBlock();

interface ElectronWindowContextBlock {
  browserWindowId: number | null
  sessionId: string
  isMainWindow: boolean
  isBackgroundAuthority: boolean
}

const DEFAULT_WINDOW_CONTEXT_BLOCK: ElectronWindowContextBlock = {
  browserWindowId: null,
  sessionId: 'default',
  isMainWindow: false,
  isBackgroundAuthority: true,
}

function normalizePersistedVaultRootBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function readPersistedVaultRootSyncBlock(): string | null {
  try {
    const value = ipcRenderer.sendSync('vault:root:getPersistedSync')
    return normalizePersistedVaultRootBlock(value)
  } catch {
    return null
  }
}

function normalizePersistedOpensourceAiBaseUrlBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function readPersistedOpensourceAiBaseUrlSyncBlock(): string | null {
  try {
    const value = ipcRenderer.sendSync('opensource-ai:base-url:getPersistedSync')
    return normalizePersistedOpensourceAiBaseUrlBlock(value)
  } catch {
    return null
  }
}

function normalizeWindowContextBlock(value: unknown): ElectronWindowContextBlock {
  if (!value || typeof value !== 'object') return DEFAULT_WINDOW_CONTEXT_BLOCK
  const record = value as Record<string, unknown>
  const browserWindowId = typeof record.browserWindowId === 'number' && Number.isFinite(record.browserWindowId)
    ? record.browserWindowId
    : null
  const sessionId = typeof record.sessionId === 'string' && record.sessionId.trim().length > 0
    ? record.sessionId.trim()
    : DEFAULT_WINDOW_CONTEXT_BLOCK.sessionId
  return {
    browserWindowId,
    sessionId,
    isMainWindow: Boolean(record.isMainWindow),
    isBackgroundAuthority: record.isBackgroundAuthority === undefined
      ? DEFAULT_WINDOW_CONTEXT_BLOCK.isBackgroundAuthority
      : Boolean(record.isBackgroundAuthority),
  }
}

interface ElectronProfileSummaryBlock {
  id: string
  name: string
  accentColor: string | null
  icon: string | null
  isDefault: boolean
  vaultRoot: string | null
  webviewPartition: string
  openWindowCount: number
}

const DEFAULT_PROFILE_SUMMARY_BLOCK: ElectronProfileSummaryBlock = {
  id: 'default',
  name: 'Main',
  accentColor: null,
  icon: null,
  isDefault: true,
  vaultRoot: null,
  webviewPartition: 'persist:thinking-space-links',
  openWindowCount: 1,
}

function normalizeProfileSummaryBlock(value: unknown): ElectronProfileSummaryBlock {
  if (!value || typeof value !== 'object') return DEFAULT_PROFILE_SUMMARY_BLOCK
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.trim().length > 0
    ? record.id.trim()
    : DEFAULT_PROFILE_SUMMARY_BLOCK.id
  return {
    id,
    name: typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : 'Main',
    accentColor: typeof record.accentColor === 'string' && record.accentColor.trim().length > 0
      ? record.accentColor.trim()
      : null,
    icon: typeof record.icon === 'string' && record.icon.trim().length > 0
      ? record.icon.trim()
      : null,
    isDefault: record.isDefault === undefined ? id === 'default' : Boolean(record.isDefault),
    vaultRoot: typeof record.vaultRoot === 'string' && record.vaultRoot.trim().length > 0
      ? record.vaultRoot.trim()
      : null,
    webviewPartition: typeof record.webviewPartition === 'string' && record.webviewPartition.trim().length > 0
      ? record.webviewPartition.trim()
      : DEFAULT_PROFILE_SUMMARY_BLOCK.webviewPartition,
    openWindowCount: typeof record.openWindowCount === 'number' && Number.isFinite(record.openWindowCount)
      ? record.openWindowCount
      : 1,
  }
}

function readProfileSummarySyncBlock(): ElectronProfileSummaryBlock {
  try {
    return normalizeProfileSummaryBlock(ipcRenderer.sendSync('profile:getSync'))
  } catch {
    return DEFAULT_PROFILE_SUMMARY_BLOCK
  }
}

function readWindowContextSyncBlock(): ElectronWindowContextBlock {
  try {
    const value = ipcRenderer.sendSync('window:context:getSync')
    return normalizeWindowContextBlock(value)
  } catch {
    return DEFAULT_WINDOW_CONTEXT_BLOCK
  }
}

// Cache the sync IPC result so we only make ONE synchronous round-trip at preload time.
// Subsequent calls return the cached value without blocking the renderer.
let persistedVaultRootBlock: string | null = readPersistedVaultRootSyncBlock()
let persistedOpensourceAiBaseUrlBlock: string | null = readPersistedOpensourceAiBaseUrlSyncBlock()
let windowContextBlock: ElectronWindowContextBlock = readWindowContextSyncBlock()
let profileSummaryBlock: ElectronProfileSummaryBlock = readProfileSummarySyncBlock()

ipcRenderer.on('profile:changed', (_event, value: unknown) => {
  profileSummaryBlock = normalizeProfileSummaryBlock(value)
})

function getPersistedVaultRootBlock(): string | null {
  // Return cached value — no additional sync IPC calls needed.
  // The value is updated via vaultRootSetPersisted below.
  return persistedVaultRootBlock
}

ipcRenderer.on('window:context-changed', (_event, value: unknown) => {
  windowContextBlock = normalizeWindowContextBlock(value)
})

// Fetch app version asynchronously to avoid blocking the renderer at preload.
// The contextBridge getter returns '' until the async call resolves.
let appVersion = ''
ipcRenderer.invoke('app:version:get').then((v: unknown) => {
  if (typeof v === 'string') appVersion = v
}).catch(() => { /* ignore */ })

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  setNativeColorMode: (mode: 'light' | 'dark' | 'system') =>
    ipcRenderer.invoke('window:set-native-color-mode', mode),
  terminalSupported: terminalSupportedBlock,
  versions: {
    app: appVersion,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  },

  // Capability adapter management
  capabilitiesList: () =>
    ipcRenderer.invoke('capabilities:list'),
  capabilitiesInvoke: (payload: {
    vaultRoot: string
    request: {
      capability: string
      input: Record<string, unknown>
      actor?: { kind: 'human' | 'agent' | 'system'; id?: string }
      requestId?: string
      dryRun?: boolean
    }
    apiBaseUrl?: string
  }) => ipcRenderer.invoke('capabilities:invoke', payload),
  extensionRuntimeInvoke: (payload: {
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
  }) => ipcRenderer.invoke('extension-runtime:invoke', payload),

  // Vault filesystem watcher
  vaultWatchStart: (vaultRoot: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vault:watch:start', vaultRoot),
  vaultWatchStop: (vaultRoot: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('vault:watch:stop', vaultRoot),
  onVaultWatchEvent: (handler: (event: { kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }) => void) => {
    const channel = 'vault:watch:event';
    const listener = (_: unknown, data: unknown) => handler(data as { kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string });
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },

  /** Main is about to quit and is holding the quit open for us. The handler
   *  must put unsaved text somewhere durable and then call `done()`; failing to
   *  call it only costs the bounded timeout in main, never the quit itself.
   *  See docs/contracts/DURABILITY.md. */
  onFlushBeforeQuit: (handler: (done: () => void) => void) => {
    const channel = 'app:flush-before-quit';
    const listener = (_: unknown, data: unknown) => {
      const ackChannel = (data as { ackChannel?: unknown })?.ackChannel;
      if (typeof ackChannel !== 'string') return;
      let acked = false;
      handler(() => {
        if (acked) return;
        acked = true;
        ipcRenderer.send(ackChannel);
      });
    };
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },

  // Live source config
  sourceConfigGet: (): Promise<{ mode: string; sourcePath: string | null; vitePort: number; viteRunning: boolean }> =>
    ipcRenderer.invoke('source:config:get'),
  sourceConfigSet: (config: { mode?: string; sourcePath?: string | null; vitePort?: number }): Promise<{ mode: string; sourcePath: string | null; vitePort: number; requiresRestart: boolean }> =>
    ipcRenderer.invoke('source:config:set', config),

  // Node / dependency environment check
  sourceEnvCheck: (): Promise<{ nodeVersion: string | null; nodeMeetsMinimum: boolean; npmVersion: string | null; depsInstalled: boolean; isGitRepo: boolean; gitBranch: string | null }> =>
    ipcRenderer.invoke('source:env:check'),
  sourceInstallDeps: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('source:install:deps'),
  onSourceInstallProgress: (handler: (entry: { step: string; message: string; type: string }) => void) => {
    const channel = 'source:install:progress';
    const listener = (_: unknown, data: unknown) => handler(data as { step: string; message: string; type: string });
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
  onSourceInstallDone: (handler: (result: { ok: boolean; error?: string }) => void) => {
    const channel = 'source:install:done';
    const listener = (_: unknown, data: unknown) => handler(data as { ok: boolean; error?: string });
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },

  // App rebuild
  sourceRebuildStart: (): Promise<{ ok: boolean; started?: boolean; error?: string }> =>
    ipcRenderer.invoke('source:rebuild:start'),
  sourceRebuildApply: (newAppPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('source:rebuild:apply', newAppPath),
  onSourceRebuildProgress: (handler: (event: { step: string; message: string; type: string }) => void) => {
    const channel = 'source:rebuild:progress';
    const listener = (_: unknown, data: unknown) => handler(data as { step: string; message: string; type: string });
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
  onSourceRebuildDone: (handler: (result: { ok: boolean; newAppPath?: string; error?: string }) => void) => {
    const channel = 'source:rebuild:done';
    const listener = (_: unknown, data: unknown) => handler(data as { ok: boolean; newAppPath?: string; error?: string });
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },

  // Embedded terminal
  terminalCreate: (opts: { cwd?: string; cols: number; rows: number; env?: Record<string, string> }): Promise<{ id: string }> =>
    ipcRenderer.invoke('terminal:create', opts),
  terminalInput: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:input', { id, data }),
  terminalResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
  terminalKill: (id: string): Promise<void> =>
    ipcRenderer.invoke('terminal:kill', { id }),
  terminalDetach: (id: string): Promise<void> =>
    ipcRenderer.invoke('terminal:detach', { id }),
  terminalReattach: (id: string): Promise<{ buffer: string } | null> =>
    ipcRenderer.invoke('terminal:reattach', { id }),
  codexProfilesList: (siteIds: string[]): Promise<{
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
  }> => ipcRenderer.invoke('codex:profiles:list', siteIds),
  codexProfileActivate: (siteId: string): Promise<{
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
  }> => ipcRenderer.invoke('codex:profiles:activate', siteId),
  onTerminalData: (id: string, handler: (data: string) => void) => {
    const channel = 'terminal:data';
    const listener = (_: unknown, payload: { id: string; data: string }) => {
      if (payload.id === id) handler(payload.data);
    };
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
  onTerminalExit: (id: string, handler: (exitCode: number) => void) => {
    const channel = 'terminal:exit';
    const listener = (_: unknown, payload: { id: string; exitCode: number }) => {
      if (payload.id === id) handler(payload.exitCode);
    };
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },

  // Window management
  newWindow: (route?: string) => ipcRenderer.invoke('window:new', route),

  // Workspace profiles (Chrome-style: own vault, own window, own accent)
  profileGet: (): ElectronProfileSummaryBlock => profileSummaryBlock,
  onProfileChanged: (handler: (profile: ElectronProfileSummaryBlock) => void) => {
    const channel = 'profile:changed'
    const listener = (_: unknown, value: unknown) => {
      profileSummaryBlock = normalizeProfileSummaryBlock(value)
      handler(profileSummaryBlock)
    }
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.removeListener(channel, listener) }
  },
  profilesList: (): Promise<ElectronProfileSummaryBlock[]> =>
    ipcRenderer.invoke('profiles:list'),
  profilesCreate: (input: { name: string; vaultRoot: string; accentColor?: string | null; icon?: string | null }): Promise<ElectronProfileSummaryBlock> =>
    ipcRenderer.invoke('profiles:create', input),
  profilesUpdate: (input: { id: string; name?: string; accentColor?: string | null; icon?: string | null }): Promise<ElectronProfileSummaryBlock> =>
    ipcRenderer.invoke('profiles:update', input),
  profilesDelete: (profileId: string): Promise<void> =>
    ipcRenderer.invoke('profiles:delete', profileId),
  profilesOpenWindow: (profileId: string): Promise<void> =>
    ipcRenderer.invoke('profiles:open-window', profileId),
  windowGetContext: (): ElectronWindowContextBlock => windowContextBlock,
  onWindowContext: (handler: (context: ElectronWindowContextBlock) => void) => {
    const channel = 'window:context-changed'
    const listener = (_: unknown, value: unknown) => {
      windowContextBlock = normalizeWindowContextBlock(value)
      handler(windowContextBlock)
    }
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.removeListener(channel, listener) }
  },
  debugPerformanceSnapshot: (): Promise<{
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
  }> => ipcRenderer.invoke('debug:performance:get'),
  clearGpuCache: (): Promise<void> => ipcRenderer.invoke('app:clear-gpu-cache'),
  powerStateGet: (): Promise<{
    onBattery: boolean
    lowPowerMode: boolean
    known: boolean
  }> => ipcRenderer.invoke('power:state:get'),
  // Webview swipe navigation (macOS 2-finger swipe via BrowserWindow 'swipe' event)
  onWebviewSwipe: (handler: (direction: 'left' | 'right') => void) => {
    const channel = 'webview:swipe'
    const listener = (_: unknown, dir: string) => handler(dir as 'left' | 'right')
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.removeListener(channel, listener) }
  },

  markdownEditorOnPasteAsTable: (handler: () => void) => {
    const channel = 'markdown-editor:paste-as-table'
    const listener = () => {
      handler()
    }
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },

  // Schedules / scheduled jobs
  schedulesList: () => ipcRenderer.invoke('schedules:list'),
  schedulesGet: (key: string) => ipcRenderer.invoke('schedules:get', key),
  schedulesSave: (spec: unknown) => ipcRenderer.invoke('schedules:save', spec),
  schedulesDelete: (key: string) => ipcRenderer.invoke('schedules:delete', key),
  schedulesServerInfo: () => ipcRenderer.invoke('schedules:server-info'),
  schedulesKickstart: (label: string) => ipcRenderer.invoke('schedules:kickstart', label),
  schedulesFireNow: (key: string, options?: { streamChannel?: string }) =>
    ipcRenderer.invoke('schedules:fire-now', key, options ?? {}),
  schedulesListTranscripts: (key: string) =>
    ipcRenderer.invoke('schedules:list-transcripts', key),
  schedulesReadTranscript: (payload: { key: string; filename: string }) =>
    ipcRenderer.invoke('schedules:read-transcript', payload),
  notificationsConfigGet: () => ipcRenderer.invoke('notifications:config:get'),
  notificationsConfigSet: (partial: unknown) => ipcRenderer.invoke('notifications:config:set', partial),
  notificationsTest: () => ipcRenderer.invoke('notifications:test'),
  onScheduleRunChunk: (streamChannel: string, handler: (chunk: { channel: 'stdout' | 'stderr'; data: string }) => void) => {
    const fullChannel = `schedules:run:event:${streamChannel}`;
    const listener = (_: unknown, data: unknown) => handler(data as { channel: 'stdout' | 'stderr'; data: string });
    ipcRenderer.on(fullChannel, listener);
    return () => { ipcRenderer.removeListener(fullChannel, listener); };
  },
  schedulesStatus: (label: string) => ipcRenderer.invoke('schedules:status', label),
  schedulesListLaunchdLabels: () => ipcRenderer.invoke('schedules:list-launchd-labels'),
  schedulesTelegramConvStatus: (scheduleKey: string) =>
    ipcRenderer.invoke('schedules:telegram-conv-status', scheduleKey),

  // Vault folder picker dialog
  selectVaultFolder: () => ipcRenderer.invoke('vault:selectFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  fetchText: (url: string) => ipcRenderer.invoke('net:fetchText', url) as Promise<{ status: number; body: string }>,
  fetchBytes: (url: string) => ipcRenderer.invoke('net:fetchBytes', url) as Promise<{ status: number; bytesBase64: string; contentType: string | null }>,
  googleOauthRequest: (payload: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Record<string, string>
    body?: string
  }) => ipcRenderer.invoke('google:oauth:request', payload),
  vaultRootGetPersisted: () => getPersistedVaultRootBlock(),
  vaultRootSetPersisted: async (vaultRoot: string | null) => {
    const normalized = normalizePersistedVaultRootBlock(vaultRoot)
    await ipcRenderer.invoke('vault:root:setPersisted', normalized)
    persistedVaultRootBlock = normalized
  },

  // Open Source AI base URL — persisted in main process so it can be applied
  // to the CSP `connect-src` directive at app startup. localStorage in the
  // renderer remains the UI's source of truth; this is a write-through mirror.
  opensourceAiBaseUrlGetPersisted: () => persistedOpensourceAiBaseUrlBlock,
  opensourceAiBaseUrlSetPersisted: async (baseUrl: string | null) => {
    const normalized = normalizePersistedOpensourceAiBaseUrlBlock(baseUrl)
    await ipcRenderer.invoke('opensource-ai:base-url:setPersisted', normalized)
    persistedOpensourceAiBaseUrlBlock = normalized
  },

  // Vault write prefs — gate for the raw-signal harvesters that dump under
  // `ai-activity/raw-sessions/` (Apple Screen Time, GoodNotes reading log).
  // Keyed per vault root (one vault per profile), so both getters and setters
  // carry the current vaultRoot. aiRaw auto-migrates on for vaults that
  // already hold harvested raw; the digests mirror is strictly opt-in.
  vaultWritesAiRawGetPersisted: (vaultRoot: string | null): Promise<boolean> =>
    ipcRenderer.invoke('vaultWrites:aiRaw:getPersisted', vaultRoot ?? undefined),
  vaultWritesAiRawSetPersisted: (enabled: boolean, vaultRoot: string | null): Promise<void> =>
    ipcRenderer.invoke('vaultWrites:aiRaw:setPersisted', enabled, vaultRoot ?? undefined),
  // Sibling toggle for the AI-derived project-day atoms mirror. Same shape
  // as the raw-signal pair; kept separate so users can enable durable digests
  // without also opting into raw-signal writes.
  vaultWritesAiActivityGetPersisted: (vaultRoot: string | null): Promise<boolean> =>
    ipcRenderer.invoke('vaultWrites:aiActivity:getPersisted', vaultRoot ?? undefined),
  vaultWritesAiActivitySetPersisted: (enabled: boolean, vaultRoot: string | null): Promise<void> =>
    ipcRenderer.invoke('vaultWrites:aiActivity:setPersisted', enabled, vaultRoot ?? undefined),

  // Claude CLI intelligence provider — shells out to `claude -p` in the
  // main process. Reuses the OAuth login the interactive Claude Code CLI
  // has already set up, so Pro-plan users don't pay API tokens on top of
  // their subscription.
  claudeCliChat: (
    requestId: string,
    request: { model: string; system: string; userPrompt: string; timeoutMs: number },
  ): Promise<{ ok: boolean; content?: string; error?: string; latencyMs?: number }> =>
    ipcRenderer.invoke('claudeCli:chat', requestId, request),
  claudeCliCancel: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('claudeCli:cancel', requestId),
  claudeCliProbe: (): Promise<{ available: boolean; version: string | null }> =>
    ipcRenderer.invoke('claudeCli:probe'),

  // Filesystem operations (all take vaultRoot as first arg)
  read: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:read', vaultRoot, relPath),
  write: (vaultRoot: string, relPath: string, data: string) =>
    ipcRenderer.invoke('vault:write', vaultRoot, relPath, data),
  readBytesBase64: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:readBytesBase64', vaultRoot, relPath),
  writeBytesBase64: (vaultRoot: string, relPath: string, base64Data: string) =>
    ipcRenderer.invoke('vault:writeBytesBase64', vaultRoot, relPath, base64Data),
  list: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:list', vaultRoot, relPath),
  walkVault: (vaultRoot: string, extensions: string[]) =>
    ipcRenderer.invoke('vault:walk', vaultRoot, extensions),
  stat: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:stat', vaultRoot, relPath),
  exists: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:exists', vaultRoot, relPath),
  mkdir: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:mkdir', vaultRoot, relPath),
  rename: (vaultRoot: string, fromRelPath: string, toRelPath: string) =>
    ipcRenderer.invoke('vault:rename', vaultRoot, fromRelPath, toRelPath),
  deletePath: (vaultRoot: string, relPath: string, recursive = true) =>
    ipcRenderer.invoke('vault:delete', vaultRoot, relPath, recursive),
  copyPath: (vaultRoot: string, fromRelPath: string, toRelPath: string) =>
    ipcRenderer.invoke('vault:copy', vaultRoot, fromRelPath, toRelPath),
  revealPath: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:reveal', vaultRoot, relPath),
  openPath: (vaultRoot: string, relPath: string) =>
    ipcRenderer.invoke('vault:openPath', vaultRoot, relPath),

  // Native AI session stores — read-only, locked to the configured roots in
  // the main process (defaults: ~/.claude/projects/ and ~/.codex/sessions/).
  nativeAiSessionsList: (): Promise<Array<{
    source: 'claude' | 'codex'
    relPath: string
    mtime: number
    size: number
  }>> => ipcRenderer.invoke('nativeAiSessions:list'),
  nativeAiSessionRead: (source: 'claude' | 'codex', relPath: string): Promise<string> =>
    ipcRenderer.invoke('nativeAiSessions:read', source, relPath),
  nativeAiSessionsGetRoots: (): Promise<{
    claude: string
    codex: string
    claudeDefault: string
    codexDefault: string
  }> => ipcRenderer.invoke('nativeAiSessions:getRoots'),
  nativeAiSessionsSetRoots: (roots: { claude?: string | null; codex?: string | null }): Promise<{
    claude: string
    codex: string
    claudeDefault: string
    codexDefault: string
  }> => ipcRenderer.invoke('nativeAiSessions:setRoots', roots),
  // Claude Code's permanent prompt log — used to reconstruct sessions whose
  // transcripts were deleted by cleanup. '' when the file doesn't exist.
  nativeAiClaudeHistoryRead: (): Promise<string> =>
    ipcRenderer.invoke('nativeAiSessions:readClaudeHistory'),

  // Git (desktop-only)
  git: (vaultRoot: string, args: string[]) =>
    ipcRenderer.invoke('vault:git', vaultRoot, args),

  // Excalidraw community plugin management
  excalidrawPluginStatus: (vaultRoot: string) =>
    ipcRenderer.invoke('plugin:excalidraw:status', vaultRoot),
  installLatestExcalidrawPlugin: (vaultRoot: string) =>
    ipcRenderer.invoke('plugin:excalidraw:installLatest', vaultRoot),

  // Hierarchy sqlite management
  hierarchyDbStatus: (vaultRoot: string) =>
    ipcRenderer.invoke('hierarchy:status', vaultRoot),
  initHierarchyDb: (vaultRoot: string) =>
    ipcRenderer.invoke('hierarchy:init', vaultRoot),

  // Hierarchy CRUD + thought linking
  hierarchyListNodes: (
    vaultRoot: string,
    params: { parent_id: string | null; type?: 'project' | 'epic' | 'idea' | null },
  ) => ipcRenderer.invoke('hierarchy:nodes:list', vaultRoot, params),
  hierarchyGetNode: (vaultRoot: string, nodeId: string) =>
    ipcRenderer.invoke('hierarchy:nodes:get', vaultRoot, nodeId),
  hierarchyCreateNode: (
    vaultRoot: string,
    params: { type: 'project' | 'epic' | 'idea'; node_kind?: string | null; title: string; parent_id: string | null; slug?: string | null; sort_order: number },
  ) => ipcRenderer.invoke('hierarchy:nodes:create', vaultRoot, params),
  hierarchyUpdateNode: (
    vaultRoot: string,
    params: { node_id: string; type?: 'project' | 'epic' | 'idea' | null; node_kind?: string | null; title?: string | null; slug?: string | null; sort_order?: number | null },
  ) => ipcRenderer.invoke('hierarchy:nodes:update', vaultRoot, params),
  hierarchyMoveNode: (
    vaultRoot: string,
    params: { node_id: string; new_parent_id: string | null; sort_order?: number | null },
  ) => ipcRenderer.invoke('hierarchy:nodes:move', vaultRoot, params),
  hierarchyDeleteNode: (vaultRoot: string, nodeId: string) =>
    ipcRenderer.invoke('hierarchy:nodes:delete', vaultRoot, nodeId),

  hierarchyUpsertThought: (vaultRoot: string, params: { file_path: string; title?: string | null }) =>
    ipcRenderer.invoke('hierarchy:thoughts:upsert', vaultRoot, params),
  hierarchyListThoughts: (vaultRoot: string, params: { unlinked_only: boolean; limit: number }) =>
    ipcRenderer.invoke('hierarchy:thoughts:list', vaultRoot, params),

  hierarchyListThoughtLinks: (
    vaultRoot: string,
    params: { thought_id?: string | null; node_id?: string | null },
  ) => ipcRenderer.invoke('hierarchy:thought-links:list', vaultRoot, params),
  hierarchyCreateThoughtLink: (
    vaultRoot: string,
    params: { thought_id: string; node_id: string; link_kind?: string | null },
  ) => ipcRenderer.invoke('hierarchy:thought-links:create', vaultRoot, params),
  hierarchyDeleteThoughtLink: (vaultRoot: string, linkId: string) =>
    ipcRenderer.invoke('hierarchy:thought-links:delete', vaultRoot, linkId),
  hierarchyListEdges: (
    vaultRoot: string,
    params: { from_node_id?: string | null; to_node_id?: string | null },
  ) => ipcRenderer.invoke('hierarchy:edges:list', vaultRoot, params),
  hierarchyCreateEdge: (
    vaultRoot: string,
    params: { from_node_id: string; to_node_id: string; edge_kind?: string | null },
  ) => ipcRenderer.invoke('hierarchy:edges:create', vaultRoot, params),
  hierarchyDeleteEdge: (vaultRoot: string, edgeId: string) =>
    ipcRenderer.invoke('hierarchy:edges:delete', vaultRoot, edgeId),
  hierarchyResolvePath: (vaultRoot: string, requestedPath: string) =>
    ipcRenderer.invoke('hierarchy:path:resolve', vaultRoot, requestedPath),

  // AI credential management
  aiGetClaudeCredentials: () =>
    ipcRenderer.invoke('ai:credentials:claude'),
  aiGetAzureCredentials: () =>
    ipcRenderer.invoke('ai:credentials:azure'),
  aiGetCodexCredentials: () =>
    ipcRenderer.invoke('ai:credentials:codex'),
  aiRefreshClaudeToken: (refreshToken: string) =>
    ipcRenderer.invoke('ai:credentials:claude:refresh', refreshToken),
  aiRefreshCodexToken: (refreshToken: string) =>
    ipcRenderer.invoke('ai:credentials:codex:refresh', refreshToken),
  aiChatCodex: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    accessToken: string,
    accountId?: string,
    model?: string,
  ) => ipcRenderer.invoke('ai:chat:codex', messages, accessToken, accountId, model),

  // Webull / Webull bridge (main-process network to bypass renderer CORS limits)
  webullGet: (payload: {
    url: string
    headers: Record<string, string>
    method?: 'GET' | 'POST'
    body?: string
  }) => ipcRenderer.invoke('webull:get', payload),
  webullAccountList: (payload: {
    url: string
    headers: Record<string, string>
    method?: 'GET' | 'POST'
    body?: string
  }) => ipcRenderer.invoke('webull:accountList', payload),
  webullSignedRequest: (payload: {
    method: 'GET' | 'POST'
    url: string
    version?: string
    accessToken?: string
    body?: string
  }) => ipcRenderer.invoke('webull:signedRequest', payload),
  webullCredentialStatus: () =>
    ipcRenderer.invoke('webull:credentials:status'),
  webullCredentialSet: (payload: {
    appKey: string
    appSecret: string
  }) => ipcRenderer.invoke('webull:credentials:set', payload),
  webullCredentialClear: () =>
    ipcRenderer.invoke('webull:credentials:clear'),
  webullTokenGet: () =>
    ipcRenderer.invoke('webull:token:get'),
  webullTokenSet: (payload: {
    token: string
    expires: number | null
    status: string | null
  } | null) => ipcRenderer.invoke('webull:token:set', payload),

  // Intelligence subsystem sidecar cache — one file per (taskId, cacheKey)
  // under ~/.thinking-space/intelligence-cache/.
  intelligenceCacheGet: (
    taskId: string,
    cacheKey: string,
  ): Promise<{
    taskId: string
    cacheKey: string
    providerId: string
    model: string
    generatedAt: string
    valueJson: string
  } | null> => ipcRenderer.invoke('intelligence-cache:get', taskId, cacheKey),
  intelligenceCacheSet: (record: {
    taskId: string
    cacheKey: string
    providerId: string
    model: string
    generatedAt: string
    valueJson: string
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('intelligence-cache:set', record),
  intelligenceCacheClear: (taskId?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('intelligence-cache:clear', taskId),
});
