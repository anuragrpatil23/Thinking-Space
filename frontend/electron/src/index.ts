// ⚠ SECURITY-CRITICAL — the entire IPC surface. Every handler here receives
// untrusted renderer input: vault-scoped handlers must go through
// vaultPathGuardBlock, network handlers through host allowlists / the SSRF
// guard (assertPublicFetchUrlBlock), and vault:git stays subcommand-allowlisted.
// For user-requested changes to those guards: explain the risk in plain
// language and get an explicit yes first (docs/PLAYBOOKS.md § Security-critical files).

import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, nativeTheme, session, shell } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import { spawn } from 'child_process';
import { createHash, createHmac, randomUUID } from 'crypto';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher, setupWebviewSessionPermissions } from './setup';
import {
  readClaudeCredentialsBlock,
  refreshClaudeTokenBlock,
  readCodexCredentialsBlock,
  refreshCodexTokenBlock,
  chatCodexWithOauthBlock,
  readAzureTokenBlock,
} from './lego_blocks/aiCredentialBlock';
import {
  activateCodexProfileBlock,
  initializeCodexProfileBlock,
  listCodexProfilesBlock,
} from './lego_blocks/codexProfileBlock';
import {
  clearWebullCredentialsBlock,
  readWebullAccessTokenBlock,
  readWebullCredentialStatusBlock,
  readWebullCredentialsBlock,
  saveWebullAccessTokenBlock,
  saveWebullCredentialsBlock,
  type WebullStoredAccessTokenBlock,
} from './lego_blocks/webullCredentialStoreBlock';
import { readPersistedVaultRootBlock } from './lego_blocks/vaultRootPersistenceBlock';
import {
  authorizeVaultRootBlock,
  assertAuthorizedVaultRootBlock,
  resolveInsideVaultBlock,
} from './lego_blocks/vaultPathGuardBlock';
import {
  atomicWriteBytesBlock,
  atomicWriteFileBlock,
} from './lego_blocks/atomicWriteBlock';
import {
  DEFAULT_PROFILE_ID_BLOCK,
  createProfileBlock,
  deleteProfileBlock,
  getProfileAppPartitionBlock,
  getProfileBlock,
  getProfileWebviewPartitionBlock,
  listProfilesBlock,
  resolveProfileVaultRootBlock,
  setProfileVaultRootBlock,
  updateProfileBlock,
} from './lego_blocks/profileRegistryBlock';
import {
  readPersistedOpensourceAiBaseUrlBlock,
  writePersistedOpensourceAiBaseUrlBlock,
} from './lego_blocks/opensourceAiBaseUrlPersistenceBlock';
import {
  writeVaultWritePrefForVaultBlock,
  resolveWriteAiRawEnabledBlock,
  resolveWriteAiActivityEnabledBlock,
  migrateAiRawIntoAiActivityBlock,
} from './lego_blocks/vaultWritePrefsPersistenceBlock';
import {
  invokeClaudeCliChatBlock,
  cancelClaudeCliRequestBlock,
  probeClaudeCliBlock,
  type ClaudeCliChatRequestBlock,
} from './lego_blocks/claudeCliBlock';
import {
  startVaultWatcherBlock,
  stopVaultWatcherBlock,
  stopAllVaultWatcherBlocks,
} from './lego_blocks/vaultWatcherBlock';
import {
  readSourceConfigBlock,
  writeSourceConfigBlock,
} from './lego_blocks/sourceConfigBlock';
import {
  ensureCliToolInstalledBlock,
  getCliSourcePathBlock,
  getCliTargetPathBlock,
  installCliToolBlock,
} from './lego_blocks/cliInstallBlock';
import {
  isViteServerRunningBlock,
  startViteServerBlock,
  stopViteServerBlock,
} from './lego_blocks/viteServerBlock';
import {
  listSchedulesBlock,
  readScheduleBlock,
  writeScheduleBlock,
  deleteScheduleBlock,
  type ScheduleSpecBlock,
} from './lego_blocks/scheduleStorageBlock';
import {
  bootoutPlistBlock,
  removePlistBlock,
  kickstartPlistBlock,
  getLaunchctlStatusBlock,
  listExternalAgentsBlock,
} from './lego_blocks/launchctlBlock';
import { provisionSchedulerBlock } from './lego_blocks/schedulerProvisionBlock';
import { getLatestConvForScheduleKeyBlock } from './lego_blocks/telegramConversationStateBlock';
import { getStopLabelBlock } from './lego_blocks/launchdPlistBlock';
import { provisionCliBlock } from './lego_blocks/cliProvisionBlock';
import {
  armAllPmsetWakesBlock,
  armPmsetWakesForScheduleBlock,
  cancelPmsetWakesForLabelBlock,
} from './lego_blocks/pmsetWakeBlock';
import { getPowerStateBlock } from './lego_blocks/powerStateBlock';
import { runScheduleBlock, type ScheduleRunChunkBlock, type ScheduleRunResultBlock } from './lego_blocks/scheduleRunnerBlock';
import { listTranscriptsBlock, readTranscriptBlock } from './lego_blocks/transcriptStoreBlock';
import {
  listNativeAiSessionsBlock,
  readNativeAiSessionBlock,
  readNativeAiRootsBlock,
  writeNativeAiRootsBlock,
  readClaudeHistoryBlock,
  type NativeAiSource,
} from './lego_blocks/nativeAiSessionsBlock';
import {
  harvestGoodnotesReadingBlock,
  readGoodnotesReadingLogBlock,
  editGoodnotesReadingRecordBlock,
  type GoodnotesEditInput,
} from './lego_blocks/goodnotesReadingBlock';
import { harvestAppleScreenTimeBlock } from './lego_blocks/appleScreenTimeDumperBlock';
import { startHeartbeatBlock, stopHeartbeatBlock } from './lego_blocks/heartbeatBlock';
import { notifyIfOfficialReleaseAheadBlock } from './lego_blocks/localBuildUpdateNoticeBlock';
import {
  notifyNtfyBlock,
  readNotificationsConfigBlock,
  writeNotificationsConfigBlock,
  type NotificationsConfigBlock,
} from './lego_blocks/notificationsBlock';
import type { ScheduleSpecBlock as RunnerScheduleSpec } from './lego_blocks/scheduleStorageBlock';
import {
  applyRebuildBlock,
  runRebuildPipelineBlock,
} from './lego_blocks/viteRebuildBlock';
import {
  checkNodeEnvBlock,
  installDepsBlock,
  MIN_APP_BUILD_NODE_MAJOR_BLOCK,
  nodeMeetsAppBuildMinimumBlock,
} from './lego_blocks/nodeEnvCheckBlock';
import { isTerminalEnabledBlock } from './lego_blocks/terminalSupportBlock';
import { readDebugPerformanceSnapshotBlock } from './lego_blocks/debugMetricsBlock';
import {
  createHierarchyEdgeOrch,
  createHierarchyNodeOrch,
  createHierarchyThoughtLinkOrch,
  deleteHierarchyEdgeOrch,
  deleteHierarchyNodeOrch,
  deleteHierarchyThoughtLinkOrch,
  getHierarchyNodeOrch,
  listHierarchyEdgesOrch,
  listHierarchyNodesOrch,
  listHierarchyThoughtLinksOrch,
  listHierarchyThoughtsOrch,
  moveHierarchyNodeOrch,
  resolveHierarchyPathOrch,
  upsertHierarchyThoughtOrch,
  updateHierarchyNodeOrch,
} from './orchestrators/hierarchyOrch';
import { getHierarchyDbStatusOrch, initializeHierarchyDbOrch } from './orchestrators/hierarchyDbOrch';
import { EXCLUDED_DIRS } from './lego_blocks/vaultConstantsBlock';
import {
  invokeSandboxedExtensionActionBlock,
  type ExtensionRuntimeInvokePayload,
} from './lego_blocks/extensionRuntimeSandboxBlock';

type PtyManagerBlockModule = typeof import('./lego_blocks/ptyManagerBlock');

let ptyManagerBlockModule: PtyManagerBlockModule | null = null;

function getPtyManagerBlockModule(): PtyManagerBlockModule {
  if (!isTerminalEnabledBlock()) {
    throw new Error('Embedded terminal is disabled in this build.');
  }
  if (!ptyManagerBlockModule) {
    ptyManagerBlockModule = require('./lego_blocks/ptyManagerBlock') as PtyManagerBlockModule;
  }
  return ptyManagerBlockModule;
}

// Graceful handling of unhandled errors.
unhandled();
initializeCodexProfileBlock();

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  {
    label: 'File',
    submenu: [
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+N',
        click: () => { void myCapacitorApp.createWindow(); },
      },
      { type: 'separator' },
      { role: 'close' },
    ],
  },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  {
    label: 'Tools',
    submenu: [
      {
        label: 'Install CLI Tool',
        click: async () => {
          try {
            const result = await installCliToolBlock({
              sourcePath: getCliSourcePathBlock(),
              targetPath: getCliTargetPathBlock(),
              resourcesPath: process.resourcesPath,
            });
            dialog.showMessageBox({
              type: 'info',
              title: 'CLI Installed',
              message: `thinkspc CLI installed successfully.`,
              detail: `CLI installed at ${result.targetPath}\n\nYou can now run 'thinkspc' from any terminal.\n\nSet your vault root in ~/.config/thinkspc/.env:\nTHINKSPC_VAULT_ROOT="/path/to/vault"`,
            });
          } catch (err) {
            dialog.showErrorBox(
              'CLI Install Failed',
              err instanceof Error ? err.message : String(err),
            );
          }
        },
      },
    ],
  },
];

// One-shot userData migration: when the app was renamed from `long-term-memory`
// to `thinking-space`, Electron's derived userData dir shifted. If the new
// location doesn't exist yet but the legacy one does, move it so users keep
// their vault-root, source-config, secure-storage, window-state, etc.
(function migrateLegacyUserDataDir() {
  try {
    const newDir = app.getPath('userData');
    if (fs.existsSync(newDir)) return;
    const legacyDir = path.join(path.dirname(newDir), 'long-term-memory');
    if (!fs.existsSync(legacyDir)) return;
    fs.renameSync(legacyDir, newDir);
    console.log(`[migration] moved ${legacyDir} -> ${newDir}`);
  } catch (err) {
    console.error('[migration] userData rename failed:', err);
  }
})();

// Get Config options from capacitor.config
// Enable 2-finger trackpad swipe-to-navigate in webviews (same as Chrome/Safari).
// Must be set before app.whenReady(). The React app is unaffected because
// index.css already sets overscroll-behavior: none on html/body/#root.
app.commandLine.appendSwitch('enable-features', 'OverscrollHistoryNavigation');

// Register Widevine CDM from the system Chrome installation so that
// DRM-protected audio (Spotify, etc.) plays in <webview> tags.
// Must be called before app.whenReady().
(function registerSystemWidevineCdm() {
  if (process.platform !== 'darwin') return;
  try {
    // Try both arch names Chrome has used across versions
    const archCandidates = process.arch === 'arm64'
      ? ['mac_arm64', 'mac_x64']   // try native first, Intel fallback
      : ['mac_x64', 'mac_arm64'];

    // Chrome may be installed in multiple locations
    const chromeCandidates = [
      '/Applications/Google Chrome.app',
      `${process.env.HOME}/Applications/Google Chrome.app`,
    ].filter(p => fs.existsSync(p));

    for (const chromeApp of chromeCandidates) {
      const versionsDirCandidates = [
        // Current Chrome layout on macOS.
        path.join(chromeApp, 'Contents', 'Frameworks', 'Google Chrome Framework.framework', 'Versions'),
        // Older layout kept as a fallback.
        path.join(chromeApp, 'Contents', 'Versions'),
      ].filter(dir => fs.existsSync(dir));

      for (const versionsDir of versionsDirCandidates) {
        const versions = fs.readdirSync(versionsDir)
          .filter(v => /^\d+\./.test(v))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

        for (const ver of versions) {
          const widevineRootCandidates = [
            path.join(versionsDir, ver, 'Libraries', 'WidevineCdm'),
            path.join(versionsDir, ver, 'Google Chrome Framework.framework', 'Libraries', 'WidevineCdm'),
          ].filter(dir => fs.existsSync(dir));

          for (const widevineRoot of widevineRootCandidates) {
            for (const arch of archCandidates) {
              const cdmLib = path.join(
                widevineRoot,
                '_platform_specific',
                arch,
                'libwidevinecdm.dylib',
              );
              if (!fs.existsSync(cdmLib)) continue;

              let cdmVersion = ver;
              try {
                const manifest = JSON.parse(
                  fs.readFileSync(path.join(widevineRoot, 'manifest.json'), 'utf-8'),
                ) as { version?: string };
                if (typeof manifest.version === 'string') cdmVersion = manifest.version;
              } catch {
                /* use Chrome version as fallback */
              }

              app.commandLine.appendSwitch('widevine-cdm-path', cdmLib);
              app.commandLine.appendSwitch('widevine-cdm-version', cdmVersion);
              if (electronIsDev) console.log(`[widevine] loaded ${cdmLib} v${cdmVersion}`);
              return; // found — stop searching
            }
          }
        }
      }
    }
    if (electronIsDev) console.log('[widevine] Chrome not found — Widevine unavailable');
  } catch (e) {
    if (electronIsDev) console.warn('[widevine] search failed:', e);
  }
})();

const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();

// Initialize our app. You can pass menu templates into the app here.
// const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig);
const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existingWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed());
    if (!existingWindow) return;
    if (existingWindow.isMinimized()) existingWindow.restore();
    if (!existingWindow.isVisible()) existingWindow.show();
    existingWindow.focus();
  });
}

function configureAppIconMenu(): void {
  if (process.platform !== 'darwin') return;
  app.dock?.setMenu(
    Menu.buildFromTemplate([
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+N',
        click: () => { void myCapacitorApp.createWindow(); },
      },
      { type: 'separator' },
      { role: 'quit' },
    ]),
  );
}

// If deeplinking is enabled then we will set it up here.
if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol: capacitorFileConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
  });
}

// If we are in Dev mode, use the file watcher components.
if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

// Run Application
if (hasSingleInstanceLock) {
  (async () => {
    try {
      // Wait for electron app to be ready.
      await app.whenReady();
      // If a previous session requested a GPU-cache clear, delete the GPU cache
      // dir before any window opens (the GPU process holds the dir open while
      // the app is running, so it has to happen at the next cold start).
      try {
        const gpuFlagPath = path.join(app.getPath('userData'), 'state', 'clear-gpu-cache.flag');
        if (fs.existsSync(gpuFlagPath)) {
          const gpuCacheDir = path.join(app.getPath('userData'), 'GPUCache');
          await fsPromises.rm(gpuCacheDir, { recursive: true, force: true });
          await fsPromises.unlink(gpuFlagPath);
        }
      } catch (err) {
        console.warn('[gpu-cache] cleanup failed:', err);
      }
      // Security - Set Content-Security-Policy based on whether or not we are in dev mode.
      setupContentSecurityPolicy(
        myCapacitorApp.getCustomURLScheme(),
        readPersistedOpensourceAiBaseUrlBlock(),
      );
      setupWebviewSessionPermissions();
      // Authorize every workspace profile's vault root at boot. profiles.json
      // is main-owned state — the same trust anchor as the persisted root, so
      // this widens nothing: a renderer still can't get an arbitrary path in.
      for (const profileRecord of listProfilesBlock()) {
        authorizeVaultRootBlock(resolveProfileVaultRootBlock(profileRecord));
      }
      if (!electronIsDev) {
        const cliInstallResult = await ensureCliToolInstalledBlock();
        if (cliInstallResult.status === 'failed') {
          console.warn(
            '[cli] Failed to auto-install thinkspc:',
            cliInstallResult.errorMessage,
            'target=',
            cliInstallResult.targetPath,
          );
        } else if (cliInstallResult.status === 'skipped' && cliInstallResult.reason !== 'dev_mode') {
          console.info(
            '[cli] Auto-install skipped:',
            cliInstallResult.reason,
            'target=',
            cliInstallResult.targetPath,
          );
        }
      }
      // Apply live-source mode if configured.
      const sourceConfig = readSourceConfigBlock();
      if (sourceConfig.mode === 'live-source' && sourceConfig.sourcePath) {
        try {
          await startViteServerBlock(sourceConfig.sourcePath, sourceConfig.vitePort);
          myCapacitorApp.setLiveSourceUrl(`http://127.0.0.1:${sourceConfig.vitePort}`);
        } catch (err) {
          console.error('[live-source] Failed to start Vite server:', err);
          // Fall back to locked mode — don't block startup
        }
      }
      // Provision the standalone scheduler: copy runner.mjs to a stable
      // location, write/refresh plists for every schedule + the heartbeat
      // watcher. launchd invokes runner.mjs directly via Electron-as-Node, so
      // schedules fire whether the app is running or not.
      try {
        const result = await provisionSchedulerBlock();
        console.log('[schedules] provisioned', {
          runnerChanged: result.runnerChanged,
          heartbeat: result.heartbeat,
          catchup: result.catchup,
          telegramPoll: result.telegramPoll,
          schedules: result.scheduleResults.length,
        });
        for (const r of result.scheduleResults) {
          if (r.error) console.warn(`[schedules] ${r.label}: ${r.error}`);
        }
      } catch (err) {
        console.error('[schedules] provisioning failed:', err);
      }
      // Provision the thinkspc CLI: copy bundled runner to ~/.thinking-space/
      // bin, write the shell shim to ~/.local/bin/thinkspc, sync config.json
      // with the current vault root. Idempotent.
      try {
        const cli = await provisionCliBlock();
        console.log('[cli] provisioned', {
          runnerChanged: cli.runnerChanged,
          shimChanged: cli.shimChanged,
          configChanged: cli.configChanged,
          shimPath: cli.shimPath,
        });
        for (const e of cli.errors) console.warn(`[cli] ${e}`);
      } catch (err) {
        console.error('[cli] provisioning failed:', err);
      }
      // Top up pmset wake queue so the Mac wakes from sleep for calendar
      // schedules. launchd will not wake the system on its own.
      try {
        const armed = await armAllPmsetWakesBlock(listSchedulesBlock());
        const total = armed.reduce((n, r) => n + r.scheduled, 0);
        console.log(`[pmset] armed ${total} wake event(s) across ${armed.length} schedule(s)`);
      } catch (err) {
        console.warn('[pmset] startup arm failed', err);
      }
      // Heartbeat file so external tools can detect when the app is alive
      // (touches ~/.thinking-space-alive every minute).
      startHeartbeatBlock();
      // Initialize our app, build windows, and load content.
      await myCapacitorApp.init();
      configureAppIconMenu();
      // Check for updates if we are in a packaged app (skip in dev or if no valid publish config).
      // Local/self-built apps (checkpoint-ship.sh, fork builds) carry a `local-build` marker in
      // Resources — never auto-update those, or the official release would silently overwrite
      // the user's custom build.
      const isLocalBuild = fs.existsSync(path.join(process.resourcesPath, 'local-build'));
      if (!electronIsDev && !isLocalBuild) {
        autoUpdater.checkForUpdatesAndNotify().catch(() => {
          // Silently ignore update check failures (e.g. no releases published yet)
        });
      } else if (isLocalBuild) {
        // Custom builds still deserve to KNOW a new official release exists —
        // their upgrade path is fork-merge + rebuild, not the DMG.
        void notifyIfOfficialReleaseAheadBlock().catch(() => undefined);
      }
    } catch (error) {
      console.error('[electron] Failed to start Thinking Space:', error);
      const detail = error instanceof Error
        ? `${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
        : String(error);
      try {
        dialog.showErrorBox('Thinking Space failed to start', detail);
      } catch {
        // Best-effort only; if dialog setup fails, we still exit with a non-zero code.
      }
      app.exit(1);
    }
  })();
}

// Stop Vite dev server when quitting.
/** Bounded wait for renderers to journal unsaved text on quit. Long enough for
 *  a vault write, short enough that quitting never feels stuck. */
const FLUSH_BEFORE_QUIT_TIMEOUT_MS = 400;

app.on('will-quit', () => {
  stopViteServerBlock();
  stopHeartbeatBlock();
});

// Clean up PTYs when a window is closed.
app.on('web-contents-created', (_event, wc) => {
  wc.on('destroyed', () => {
    if (!isTerminalEnabledBlock()) return;
    getPtyManagerBlockModule().killPtysForWebContentsBlock(wc.id);
  });
});

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (myCapacitorApp.getWindowCount() === 0) {
    await myCapacitorApp.createWindow();
  }
});

// -- New window IPC --
ipcMain.handle('window:new', async (event, route?: string) => {
  // A new window stays in the profile of the window that asked for it.
  await myCapacitorApp.createWindow(route, myCapacitorApp.getProfileIdForWebContents(event.sender));
});

// -- Workspace profiles (Chrome-style: own vault, own window, own accent) --
interface ProfileSummaryBlock {
  id: string;
  name: string;
  accentColor: string | null;
  icon: string | null;
  isDefault: boolean;
  vaultRoot: string | null;
  webviewPartition: string;
  openWindowCount: number;
}

function serializeProfileSummaryBlock(profileId: string): ProfileSummaryBlock | null {
  const profile = getProfileBlock(profileId);
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    accentColor: profile.accentColor,
    icon: profile.icon,
    isDefault: profile.id === DEFAULT_PROFILE_ID_BLOCK,
    vaultRoot: resolveProfileVaultRootBlock(profile),
    webviewPartition: getProfileWebviewPartitionBlock(profile.id),
    openWindowCount: myCapacitorApp.getOpenWindowCountForProfileBlock(profile.id),
  };
}

function broadcastProfileChangedBlock(profileId: string): void {
  const profile = getProfileBlock(profileId);
  if (!profile) return;
  const vaultRoot = resolveProfileVaultRootBlock(profile);
  if (!vaultRoot) return;
  const summary = serializeProfileSummaryBlock(profileId);
  for (const win of myCapacitorApp.getWindowsForVaultRootBlock(vaultRoot)) {
    win.webContents.send('profile:changed', summary);
  }
}

// Synchronous: the preload caches the window's profile identity at exposure
// time (same pattern as vault:root:getPersistedSync).
ipcMain.on('profile:getSync', (event) => {
  event.returnValue = serializeProfileSummaryBlock(
    myCapacitorApp.getProfileIdForWebContents(event.sender),
  );
});

ipcMain.handle('profiles:list', async () => {
  return listProfilesBlock()
    .map((profile) => serializeProfileSummaryBlock(profile.id))
    .filter((summary): summary is ProfileSummaryBlock => summary !== null);
});

ipcMain.handle('profiles:create', async (_event, input: { name: string; vaultRoot: string; accentColor?: string | null; icon?: string | null }) => {
  if (!input || typeof input.name !== 'string' || typeof input.vaultRoot !== 'string') {
    throw new Error('Profile name and vault folder are required.');
  }
  // The folder must have gone through the native picker (vault:selectFolder)
  // in this session — that consent moment is what authorizes it. Never accept
  // an arbitrary renderer-supplied path here.
  assertAuthorizedVaultRootBlock(input.vaultRoot);
  const record = createProfileBlock({
    name: input.name,
    vaultRoot: input.vaultRoot,
    accentColor: input.accentColor ?? null,
    icon: input.icon ?? null,
  });
  return serializeProfileSummaryBlock(record.id);
});

ipcMain.handle('profiles:update', async (_event, input: { id: string; name?: string; accentColor?: string | null; icon?: string | null }) => {
  if (!input || typeof input.id !== 'string') throw new Error('Profile id is required.');
  const record = updateProfileBlock(input.id, { name: input.name, accentColor: input.accentColor, icon: input.icon });
  broadcastProfileChangedBlock(record.id);
  return serializeProfileSummaryBlock(record.id);
});

ipcMain.handle('profiles:delete', async (_event, profileId: string) => {
  if (typeof profileId !== 'string') throw new Error('Profile id is required.');
  if (myCapacitorApp.getOpenWindowCountForProfileBlock(profileId) > 0) {
    throw new Error('Close this profile’s windows before deleting it.');
  }
  const appPartition = getProfileAppPartitionBlock(profileId);
  const webviewPartition = getProfileWebviewPartitionBlock(profileId);
  deleteProfileBlock(profileId);
  // Purge the partitions' on-disk storage (IndexedDB, localStorage, cookies) —
  // otherwise the orphaned data sits in userData forever.
  if (appPartition) {
    await session.fromPartition(appPartition).clearStorageData().catch(() => undefined);
  }
  await session.fromPartition(webviewPartition).clearStorageData().catch(() => undefined);
});

ipcMain.handle('profiles:open-window', async (_event, profileId: string) => {
  if (typeof profileId !== 'string') throw new Error('Profile id is required.');
  const profile = getProfileBlock(profileId);
  if (!profile) throw new Error('Profile not found.');
  const vaultRoot = resolveProfileVaultRootBlock(profile);
  // Late authorization is safe here: profiles.json is main-process-owned
  // state, the same trust anchor as the persisted vault root.
  authorizeVaultRootBlock(vaultRoot);
  await myCapacitorApp.createWindow(undefined, profileId);
});

ipcMain.on('window:context:getSync', (event) => {
  event.returnValue = myCapacitorApp.getWindowContextForWebContents(event.sender);
});

// Terminal-enabled flag, resolved in the main process. The preload used to
// compute this itself, but a sandboxed renderer's preload can't read
// package.json / process.env, so it asks main synchronously at preload time.
ipcMain.on('terminal:enabled:getSync', (event) => {
  event.returnValue = isTerminalEnabledBlock();
});

ipcMain.handle('window:context:get', (event) => {
  return myCapacitorApp.getWindowContextForWebContents(event.sender);
});

// The macOS window vibrancy material follows nativeTheme, not the renderer's
// CSS theme. The renderer reports its resolved scheme here so the native blur
// renders light for light mode and dark for dark mode (uiThemeOrch calls this
// whenever the app theme/color mode changes).
//
// `nativeTheme.themeSource` is app-global, but each profile window can pick its
// own color mode (theme is per-profile via partitioned localStorage). So we
// remember every window's reported mode and only drive the global themeSource
// from the *focused* window — otherwise a background profile window loading its
// (different) theme would flip the vibrancy of the window the user is actually
// looking at. Re-applying on focus restores each window's own mode as it comes
// forward.
const nativeColorModeByWindowIdBlock = new Map<number, 'light' | 'dark' | 'system'>();

ipcMain.handle('window:set-native-color-mode', (event, mode: unknown) => {
  const normalized = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : 'system';
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    nativeTheme.themeSource = normalized;
    return;
  }
  const isFirstReport = !nativeColorModeByWindowIdBlock.has(win.id);
  nativeColorModeByWindowIdBlock.set(win.id, normalized);
  if (isFirstReport) {
    win.on('focus', () => {
      nativeTheme.themeSource = nativeColorModeByWindowIdBlock.get(win.id) ?? 'system';
    });
    win.on('closed', () => nativeColorModeByWindowIdBlock.delete(win.id));
  }
  if (win.isFocused()) {
    nativeTheme.themeSource = normalized;
  }
});

ipcMain.handle('debug:performance:get', async () => {
  return readDebugPerformanceSnapshotBlock();
});

// Power state, for callers that refuse to spend minutes of GPU on a machine
// running on battery or asked to conserve. See `powerStateBlock`.
ipcMain.handle('power:state:get', async () => {
  return getPowerStateBlock();
});

// Clearing GPU cache requires deleting userData/GPUCache while it's not in use
// by the GPU process, so we set a flag and relaunch — the next startup deletes
// the directory before any windows open.
ipcMain.handle('app:clear-gpu-cache', async () => {
  const flagPath = path.join(app.getPath('userData'), 'state', 'clear-gpu-cache.flag');
  await fsPromises.mkdir(path.dirname(flagPath), { recursive: true });
  await fsPromises.writeFile(flagPath, new Date().toISOString(), 'utf-8');
  app.relaunch();
  app.quit();
});

ipcMain.handle('schedules:list', async () => {
  return listSchedulesBlock();
});

ipcMain.handle('schedules:get', async (_event, key: string) => {
  return readScheduleBlock(key);
});

ipcMain.handle('schedules:save', async (_event, spec: ScheduleSpecBlock) => {
  const saved = writeScheduleBlock(spec);
  if (saved.managedBy === 'thinking-space') {
    // Re-provision: writes/updates the plist for just-this-schedule via the
    // same idempotent path used on app startup. Disabled schedules get booted
    // out; enabled ones get bootstrapped if their plist content changed.
    try {
      const result = await provisionSchedulerBlock();
      const my = result.scheduleResults.find((r) => r.label === saved.label);
      if (my?.error) console.warn(`[schedules] save provision: ${my.error}`);
    } catch (err) {
      console.warn('[schedules] save provision failed', err);
    }
    if (!saved.enabled) {
      await bootoutPlistBlock(saved.label).catch(() => undefined);
    }
    // Re-arm pmset wake events so the Mac wakes from sleep to actually run
    // calendar-based schedules. Cancels prior wakes for this label first.
    await armPmsetWakesForScheduleBlock(saved).catch((err) =>
      console.warn('[pmset] arm after save failed', err),
    );
  }
  return saved;
});

ipcMain.handle('schedules:delete', async (_event, key: string) => {
  const spec = readScheduleBlock(key);
  if (spec && spec.managedBy === 'thinking-space') {
    await removePlistBlock(spec.label);
    if (spec.schedule.kind === 'window') {
      await removePlistBlock(getStopLabelBlock(spec));
    }
    await cancelPmsetWakesForLabelBlock(spec.label).catch((err) =>
      console.warn('[pmset] cancel after delete failed', err),
    );
  }
  return deleteScheduleBlock(key);
});

ipcMain.handle('schedules:server-info', async () => {
  // HTTP server removed in favor of direct launchd invocation of runner.mjs.
  // Returning null lets the frontend's "show server status" panels hide.
  return null;
});

ipcMain.handle('schedules:kickstart', async (_event, label: string) => {
  await kickstartPlistBlock(label);
});

function maybeNotifyAfterRun(spec: RunnerScheduleSpec, result: ScheduleRunResultBlock): void {
  const cfg = readNotificationsConfigBlock();
  if (!cfg.ntfy.topic) return;
  const failed = result.exitCode !== 0 || result.errorMessage;
  if (failed && !cfg.ntfy.onFailure) return;
  if (!failed && !cfg.ntfy.onSuccess) return;
  const title = failed
    ? `❌ ${spec.title}`
    : `✅ ${spec.title}`;
  const reason = result.errorMessage
    ? `error: ${result.errorMessage}`
    : `exit ${result.exitCode ?? 'null'}${result.signal ? ` (signal ${result.signal})` : ''}`;
  const message = `${reason} · ${result.durationMs}ms\ntranscript: ${result.transcriptFilename}`;
  notifyNtfyBlock({
    title,
    message,
    priority: failed ? 'high' : 'low',
    tags: failed ? ['rotating_light'] : ['white_check_mark'],
  }).catch((err) => console.warn('[notifications] post failed', err));
}

ipcMain.handle('schedules:fire-now', async (event, key: string, options: { streamChannel?: string } = {}) => {
  const spec = readScheduleBlock(key);
  if (!spec) throw new Error(`Schedule not found: ${key}`);
  const sender = event.sender;
  const streamChannel = typeof options?.streamChannel === 'string' && options.streamChannel.length > 0
    ? `schedules:run:event:${options.streamChannel}`
    : null;
  const result = await runScheduleBlock(spec, {
    onChunk: streamChannel
      ? (chunk: ScheduleRunChunkBlock) => {
          if (!sender.isDestroyed()) sender.send(streamChannel, chunk);
        }
      : undefined,
  });
  maybeNotifyAfterRun(spec, result);
  // The fire we just consumed left a hole in the pmset wake queue. Re-arm so
  // the rolling horizon stays filled.
  armPmsetWakesForScheduleBlock(spec).catch((err) =>
    console.warn('[pmset] re-arm after fire-now failed', err),
  );
  return result;
});

ipcMain.handle('notifications:config:get', async (): Promise<NotificationsConfigBlock> => {
  return readNotificationsConfigBlock();
});

ipcMain.handle('notifications:config:set', async (_event, partial: Partial<NotificationsConfigBlock>) => {
  return writeNotificationsConfigBlock(partial);
});

ipcMain.handle('notifications:test', async () => {
  return notifyNtfyBlock({
    title: '🔔 Thinking Space test',
    message: 'If you see this on your device, ntfy is wired up correctly.',
    priority: 'low',
    tags: ['bell'],
  });
});

ipcMain.handle('schedules:list-transcripts', async (_event, key: string) => {
  return listTranscriptsBlock(key);
});

ipcMain.handle('schedules:read-transcript', async (_event, payload: { key: string; filename: string }) => {
  return readTranscriptBlock(payload.key, payload.filename);
});

ipcMain.handle('schedules:status', async (_event, label: string) => {
  return getLaunchctlStatusBlock(label);
});

ipcMain.handle('schedules:list-launchd-labels', async () => {
  return listExternalAgentsBlock();
});

ipcMain.handle('schedules:telegram-conv-status', async (_event, scheduleKey: string) => {
  return getLatestConvForScheduleKeyBlock(scheduleKey);
});

// =====================================================================
// IPC Handlers — Embedded Terminal (node-pty)
// =====================================================================

if (isTerminalEnabledBlock()) {
  ipcMain.handle('terminal:create', (event, opts: { cwd?: string; cols: number; rows: number; env?: Record<string, string> }) => {
    const id = getPtyManagerBlockModule().createPtyBlock({
      // Default new terminals to the vault, not $HOME — shells starting in the
      // home dir rack up Desktop/Documents/Downloads TCC prompts under the
      // app's identity.
      cwd: opts.cwd ?? readPersistedVaultRootBlock() ?? undefined,
      cols: opts.cols,
      rows: opts.rows,
      webContentsId: event.sender.id,
      env: opts.env,
    });
    return { id };
  });

  ipcMain.handle('terminal:input', (_event, { id, data }: { id: string; data: string }) => {
    getPtyManagerBlockModule().writePtyBlock(id, data);
  });

  ipcMain.handle('terminal:resize', (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    getPtyManagerBlockModule().resizePtyBlock(id, cols, rows);
  });

  ipcMain.handle('terminal:kill', (_event, { id }: { id: string }) => {
    getPtyManagerBlockModule().killPtyBlock(id);
  });

  ipcMain.handle('terminal:detach', (_event, { id }: { id: string }) => {
    getPtyManagerBlockModule().detachPtyBlock(id);
  });

  ipcMain.handle('terminal:reattach', (event, { id }: { id: string }) => {
    return getPtyManagerBlockModule().reattachPtyBlock(id, event.sender.id);
  });
}

ipcMain.handle('codex:profiles:list', (_event, siteIds: string[]) => {
  return listCodexProfilesBlock(Array.isArray(siteIds) ? siteIds : []);
});

ipcMain.handle('codex:profiles:activate', (_event, siteId: string) => {
  return activateCodexProfileBlock(siteId);
});

// =====================================================================
// IPC Handlers — Live Source Config
// =====================================================================

ipcMain.handle('source:config:get', () => {
  return { ...readSourceConfigBlock(), viteRunning: isViteServerRunningBlock() };
});

// =====================================================================
// IPC Handlers — App Rebuild
// =====================================================================

ipcMain.handle('source:rebuild:start', async (event) => {
  const config = readSourceConfigBlock();
  if (!config.sourcePath) {
    return { ok: false, error: 'No source path configured. Set one in Settings → Developer.' };
  }

  const envStatus = checkNodeEnvBlock(config.sourcePath);
  if (!nodeMeetsAppBuildMinimumBlock(envStatus.nodeVersion)) {
    return {
      ok: false,
      error: envStatus.nodeVersion
        ? `Build App needs Node.js ${MIN_APP_BUILD_NODE_MAJOR_BLOCK} or newer. You have ${envStatus.nodeVersion}. Update Node.js, then try again.`
        : `Build App needs Node.js ${MIN_APP_BUILD_NODE_MAJOR_BLOCK} or newer. Node.js was not found on this Mac.`,
    };
  }

  // Fire-and-forget: stream progress events back to the renderer window
  void runRebuildPipelineBlock(config.sourcePath, (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('source:rebuild:progress', progress);
    }
  }).then(({ newAppPath }) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('source:rebuild:done', { ok: true, newAppPath });
    }
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!event.sender.isDestroyed()) {
      event.sender.send('source:rebuild:done', { ok: false, error: message });
    }
  });

  return { ok: true, started: true };
});

ipcMain.handle('source:rebuild:apply', async (_event, newAppPath: string) => {
  try {
    applyRebuildBlock(newAppPath);
    setTimeout(() => app.quit(), 500);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('source:config:set', async (_event, config: { mode?: string; sourcePath?: string | null; vitePort?: number }) => {
  const next = writeSourceConfigBlock({
    ...(config.mode === 'live-source' || config.mode === 'locked' ? { mode: config.mode } : {}),
    ...(config.sourcePath !== undefined ? { sourcePath: config.sourcePath } : {}),
    ...(config.vitePort !== undefined ? { vitePort: config.vitePort } : {}),
  });
  return { ...next, requiresRestart: true };
});

// =====================================================================
// IPC Handlers — Node / Dependency Environment Check
// =====================================================================

ipcMain.handle('source:env:check', () => {
  const config = readSourceConfigBlock();
  return checkNodeEnvBlock(config.sourcePath);
});

ipcMain.handle('source:install:deps', async (event) => {
  const config = readSourceConfigBlock();
  if (!config.sourcePath) {
    return { ok: false, error: 'No source path configured. Set one in Settings → Developer.' };
  }
  try {
    await installDepsBlock(config.sourcePath, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('source:install:progress', progress);
      }
    });
    if (!event.sender.isDestroyed()) {
      event.sender.send('source:install:done', { ok: true });
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!event.sender.isDestroyed()) {
      event.sender.send('source:install:done', { ok: false, error: message });
    }
    return { ok: false, error: message };
  }
});

// -- CLI install IPC --
ipcMain.handle('cli:install', async () => {
  return installCliToolBlock({
    sourcePath: getCliSourcePathBlock(),
    targetPath: getCliTargetPathBlock(),
    resourcesPath: process.resourcesPath,
  });
});

// =====================================================================
// IPC Handlers — Filesystem, Dialog, Git
// =====================================================================

const EXCALIDRAW_PLUGIN_ID = 'obsidian-excalidraw-plugin';
const EXCALIDRAW_RELEASE_API = 'https://api.github.com/repos/zsviczian/obsidian-excalidraw-plugin/releases/latest';
const EXCALIDRAW_SOURCE_REPO = 'zsviczian/obsidian-excalidraw-plugin';
const EXCALIDRAW_REQUIRED_ASSETS = ['manifest.json', 'main.js'];
const EXCALIDRAW_OPTIONAL_ASSETS = ['styles.css'];

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: GitHubReleaseAsset[];
}

interface ExcalidrawPluginStatus {
  plugin_id: string;
  source_repo: string;
  plugin_dir: string;
  installed: boolean;
  enabled: boolean;
  installed_version: string | null;
  latest_version: string | null;
  release_url: string | null;
  release_published_at: string | null;
  update_available: boolean;
  status_error: string | null;
}

type CapabilityActorKind = 'human' | 'agent' | 'system';

interface ElectronCapabilityInvokePayload {
  vaultRoot: string;
  request: {
    capability: string;
    input: Record<string, unknown>;
    actor?: { kind: CapabilityActorKind; id?: string };
    requestId?: string;
    dryRun?: boolean;
    extensionContext?: {
      extensionId: string;
      extensionRegistryKey?: string;
    };
  };
  apiBaseUrl?: string;
}

interface WebullGetPayload {
  url: string;
  headers: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
}

interface WebullGetResponse {
  status: number;
  body: string;
}

interface WebullSignedRequestPayload {
  method: 'GET' | 'POST';
  url: string;
  version?: string;
  accessToken?: string;
  body?: string;
}

interface WebullSetCredentialsPayload {
  appKey: string;
  appSecret: string;
}

interface WebullTokenPayload {
  token: string;
  expires: number | null;
  status: string | null;
}

interface CapabilityRunnerLocation {
  frontendRoot: string;
  viteNodeExec: string;
  runnerScript: string;
}

function resolveCapabilityRunnerLocation(): CapabilityRunnerLocation {
  const viteNodeBinary = process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node';
  const candidates = [
    path.resolve(__dirname, '../../..'),
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), '..'),
    app.getAppPath(),
    path.resolve(app.getAppPath(), '..'),
  ];
  const uniqueCandidates = [...new Set(candidates)];

  for (const frontendRoot of uniqueCandidates) {
    const runnerScript = path.join(frontendRoot, 'scripts', 'agent', 'capabilityRunner.ts');
    const viteNodeExec = path.join(frontendRoot, 'node_modules', '.bin', viteNodeBinary);
    if (fs.existsSync(runnerScript) && fs.existsSync(viteNodeExec)) {
      return { frontendRoot, viteNodeExec, runnerScript };
    }
  }

  throw new Error(
    `Capability runner is unavailable: unable to find frontend/scripts/agent/capabilityRunner.ts and vite-node binary in candidates: ${uniqueCandidates.join(', ')}`,
  );
}

async function runCapabilityRunnerViaViteNode(
  command: 'list' | 'invoke',
  payload?: ElectronCapabilityInvokePayload,
): Promise<unknown> {
  const { frontendRoot, viteNodeExec, runnerScript } = resolveCapabilityRunnerLocation();
  const stdin = payload == null ? '' : JSON.stringify(payload);

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const proc = spawn(
      viteNodeExec,
      [runnerScript, '--json', command],
      {
        cwd: frontendRoot,
        env: { ...process.env, LTM_CAPABILITY_RUNNER_CLI: '1' },
      },
    );

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));

    if (stdin) {
      proc.stdin.write(stdin);
    }
    proc.stdin.end();
  });

  if (result.code !== 0) {
    const reason = result.stderr.trim() || 'unknown error';
    throw new Error(`Capability runner failed (command=${command}): ${reason}`);
  }

  const raw = result.stdout.trim();
  if (!raw) {
    throw new Error('Capability runner returned an empty response.');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Capability runner returned invalid JSON: ${message}`);
  }
}

function resolvePluginDir(vaultRoot: string): string {
  return assertInsideVault(vaultRoot, path.join('.obsidian', 'plugins', EXCALIDRAW_PLUGIN_ID));
}

function resolveCommunityPluginsPath(vaultRoot: string): string {
  return assertInsideVault(vaultRoot, path.join('.obsidian', 'community-plugins.json'));
}

function normalizeSemver(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map(part => {
      const match = part.match(/^(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });
}

function compareSemver(a: string, b: string): number {
  const aa = normalizeSemver(a);
  const bb = normalizeSemver(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    const av = aa[i] ?? 0;
    const bv = bb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function fetchBuffer(url: string, headers: Record<string, string> = {}, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'think-space-electron',
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          if (redirects >= 5) {
            res.resume();
            reject(new Error('Too many redirects while downloading plugin asset'));
            return;
          }
          const redirected = new URL(location, url).toString();
          res.resume();
          fetchBuffer(redirected, headers, redirects + 1).then(resolve).catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8').slice(0, 300);
            reject(new Error(`HTTP ${status} while fetching ${url}: ${body}`));
          });
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );

    request.on('error', reject);
  });
}

function assertAllowedWebullUrl(url: string): URL {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const allowedHosts = new Set([
    'api.webull.com',
    'openapi.webull.com',
    'us-openapi-alb.uat.webullbroker.com',
  ]);
  if (!allowedHosts.has(host)) {
    throw new Error(`Unsupported Webull Webull host: ${parsed.hostname}`);
  }
  return parsed;
}

const WEBULL_REQUEST_MAX_REDIRECTS_BLOCK = 20;
const GOOGLE_REQUEST_MAX_REDIRECTS_BLOCK = 10;

function encodeWebullSignatureSourceBlock(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => (
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function buildWebullSignedHeadersBlock(
  payload: WebullSignedRequestPayload,
  credentials: { appKey: string; appSecret: string },
): Record<string, string> {
  const parsed = assertAllowedWebullUrl(payload.url);
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = randomUUID();

  const signParams = new Map<string, string>();
  signParams.set('host', parsed.host);
  signParams.set('x-app-key', credentials.appKey);
  signParams.set('x-signature-algorithm', 'HMAC-SHA1');
  signParams.set('x-signature-nonce', nonce);
  signParams.set('x-signature-version', '1.0');
  signParams.set('x-timestamp', timestamp);

  for (const [key, value] of parsed.searchParams.entries()) {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) continue;
    const normalizedValue = value.trim();
    const existing = signParams.get(normalizedKey);
    signParams.set(normalizedKey, existing ? `${existing}&${normalizedValue}` : normalizedValue);
  }

  const sorted = Array.from(signParams.entries())
    .sort((a, b) => {
      const keyCompare = a[0].localeCompare(b[0]);
      if (keyCompare !== 0) return keyCompare;
      return a[1].localeCompare(b[1]);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  let stringToSign = `${parsed.pathname}&${sorted}`;
  if (typeof payload.body === 'string' && payload.body.length > 0) {
    const bodyMd5UpperHex = createHash('md5').update(payload.body, 'utf8').digest('hex').toUpperCase();
    stringToSign = `${stringToSign}&${bodyMd5UpperHex}`;
  }
  const encodedToSign = encodeWebullSignatureSourceBlock(stringToSign);
  const signature = createHmac('sha1', `${credentials.appSecret}&`).update(encodedToSign, 'utf8').digest('base64');

  return {
    ...(payload.version ? { 'x-version': payload.version } : {}),
    'x-app-key': credentials.appKey,
    'x-timestamp': timestamp,
    'x-signature-version': '1.0',
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
    'x-signature': signature,
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(payload.accessToken ? { 'x-access-token': payload.accessToken } : {}),
    'User-Agent': 'think-space-webull',
  };
}

function requestTextOverHttps(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body = '',
  redirects = 0,
): Promise<WebullGetResponse> {
  return new Promise((resolve, reject) => {
    const parsed = assertAllowedWebullUrl(url);
    const request = https.request(
      parsed,
      {
        method,
        headers: {
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          if (redirects >= WEBULL_REQUEST_MAX_REDIRECTS_BLOCK) {
            res.resume();
            reject(new Error('Too many redirects while requesting Webull API'));
            return;
          }
          const redirected = new URL(location, parsed.toString()).toString();
          res.resume();
          requestTextOverHttps(method, redirected, headers, body, redirects + 1).then(resolve).catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks);
          const contentEncodingHeader = res.headers['content-encoding'];
          const contentEncoding = Array.isArray(contentEncodingHeader)
            ? (contentEncodingHeader[0] ?? '').toLowerCase()
            : (contentEncodingHeader ?? '').toLowerCase();

          let decodedBody = rawBody;
          try {
            if (contentEncoding.includes('gzip')) {
              decodedBody = gunzipSync(rawBody);
            } else if (contentEncoding.includes('deflate')) {
              decodedBody = inflateSync(rawBody);
            } else if (contentEncoding.includes('br')) {
              decodedBody = brotliDecompressSync(rawBody);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reject(new Error(`Failed to decode Webull response body (${contentEncoding || 'unknown encoding'}): ${message}`));
            return;
          }

          resolve({
            status,
            body: decodedBody.toString('utf-8'),
          });
        });
      },
    );

    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function assertAllowedGoogleApiUrlBlock(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Google API requests require https:// URLs.');
  }
  const host = parsed.hostname.toLowerCase();
  const allowedHosts = new Set([
    'oauth2.googleapis.com',
    'www.googleapis.com',
    'sheets.googleapis.com',
    'docs.googleapis.com',
    'drive.googleapis.com',
  ]);
  if (!allowedHosts.has(host)) {
    throw new Error(`Unsupported Google API host: ${parsed.hostname}`);
  }
  return parsed;
}

function requestGoogleTextOverHttpsBlock(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  headers: Record<string, string>,
  body = '',
  redirects = 0,
): Promise<WebullGetResponse> {
  return new Promise((resolve, reject) => {
    const parsed = assertAllowedGoogleApiUrlBlock(url);
    const request = https.request(
      parsed,
      {
        method,
        headers: {
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          if (redirects >= GOOGLE_REQUEST_MAX_REDIRECTS_BLOCK) {
            res.resume();
            reject(new Error('Too many redirects while requesting Google API'));
            return;
          }
          const redirected = new URL(location, parsed.toString()).toString();
          res.resume();
          requestGoogleTextOverHttpsBlock(method, redirected, headers, body, redirects + 1).then(resolve).catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks);
          const contentEncodingHeader = res.headers['content-encoding'];
          const contentEncoding = Array.isArray(contentEncodingHeader)
            ? (contentEncodingHeader[0] ?? '').toLowerCase()
            : (contentEncodingHeader ?? '').toLowerCase();

          let decodedBody = rawBody;
          try {
            if (contentEncoding.includes('gzip')) {
              decodedBody = gunzipSync(rawBody);
            } else if (contentEncoding.includes('deflate')) {
              decodedBody = inflateSync(rawBody);
            } else if (contentEncoding.includes('br')) {
              decodedBody = brotliDecompressSync(rawBody);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reject(new Error(`Failed to decode Google API response body (${contentEncoding || 'unknown encoding'}): ${message}`));
            return;
          }

          resolve({
            status,
            body: decodedBody.toString('utf-8'),
          });
        });
      },
    );

    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const data = await fetchBuffer(url, { Accept: 'application/vnd.github+json' });
  return JSON.parse(data.toString('utf-8')) as T;
}

async function fetchLatestExcalidrawRelease(): Promise<GitHubRelease> {
  return fetchJson<GitHubRelease>(EXCALIDRAW_RELEASE_API);
}

async function readInstalledExcalidrawState(vaultRoot: string): Promise<{
  pluginDir: string;
  installed: boolean;
  installedVersion: string | null;
  enabled: boolean;
}> {
  const pluginDir = resolvePluginDir(vaultRoot);
  const manifestPath = path.join(pluginDir, 'manifest.json');
  const mainPath = path.join(pluginDir, 'main.js');

  let installed = false;
  let installedVersion: string | null = null;

  try {
    await fsPromises.access(manifestPath);
    await fsPromises.access(mainPath);
    installed = true;
    const manifestRaw = await fsPromises.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw) as { version?: string };
    installedVersion = manifest.version ?? null;
  } catch {
    installed = false;
    installedVersion = null;
  }

  const communityPluginsPath = resolveCommunityPluginsPath(vaultRoot);
  let enabled = false;
  try {
    const raw = await fsPromises.readFile(communityPluginsPath, 'utf-8');
    const arr = JSON.parse(raw);
    enabled = Array.isArray(arr) && arr.includes(EXCALIDRAW_PLUGIN_ID);
  } catch {
    enabled = false;
  }

  return { pluginDir, installed, installedVersion, enabled };
}

async function enableCommunityPlugin(vaultRoot: string, pluginId: string): Promise<void> {
  const obsidianDir = assertInsideVault(vaultRoot, '.obsidian');
  await fsPromises.mkdir(obsidianDir, { recursive: true });

  const communityPluginsPath = resolveCommunityPluginsPath(vaultRoot);
  let plugins: string[] = [];
  try {
    const raw = await fsPromises.readFile(communityPluginsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      plugins = parsed.filter(item => typeof item === 'string');
    }
  } catch {
    plugins = [];
  }

  if (!plugins.includes(pluginId)) {
    plugins.push(pluginId);
    await atomicWriteFileBlock(communityPluginsPath, JSON.stringify(plugins, null, 2));
  }
}

async function getExcalidrawPluginStatus(vaultRoot: string): Promise<ExcalidrawPluginStatus> {
  const local = await readInstalledExcalidrawState(vaultRoot);

  let latestVersion: string | null = null;
  let releaseUrl: string | null = null;
  let releasePublishedAt: string | null = null;
  let statusError: string | null = null;

  try {
    const release = await fetchLatestExcalidrawRelease();
    latestVersion = release.tag_name ?? null;
    releaseUrl = release.html_url ?? null;
    releasePublishedAt = release.published_at ?? null;
  } catch (err) {
    statusError = err instanceof Error ? err.message : 'Failed to fetch latest release metadata';
  }

  const updateAvailable = Boolean(
    local.installed &&
    local.installedVersion &&
    latestVersion &&
    compareSemver(local.installedVersion, latestVersion) < 0,
  );

  return {
    plugin_id: EXCALIDRAW_PLUGIN_ID,
    source_repo: EXCALIDRAW_SOURCE_REPO,
    plugin_dir: local.pluginDir,
    installed: local.installed,
    enabled: local.enabled,
    installed_version: local.installedVersion,
    latest_version: latestVersion,
    release_url: releaseUrl,
    release_published_at: releasePublishedAt,
    update_available: updateAvailable,
    status_error: statusError,
  };
}

async function installOrUpdateExcalidrawPlugin(vaultRoot: string): Promise<ExcalidrawPluginStatus> {
  const release = await fetchLatestExcalidrawRelease();
  const assetsByName = new Map(release.assets.map(asset => [asset.name, asset]));

  for (const fileName of EXCALIDRAW_REQUIRED_ASSETS) {
    if (!assetsByName.has(fileName)) {
      throw new Error(`Latest release is missing required plugin asset: ${fileName}`);
    }
  }

  const pluginDir = resolvePluginDir(vaultRoot);
  await fsPromises.mkdir(pluginDir, { recursive: true });

  const installFiles = [...EXCALIDRAW_REQUIRED_ASSETS, ...EXCALIDRAW_OPTIONAL_ASSETS];
  for (const fileName of installFiles) {
    const asset = assetsByName.get(fileName);
    if (!asset) continue;
    const targetPath = path.join(pluginDir, fileName);
    const tmpPath = `${targetPath}.tmp`;
    const data = await fetchBuffer(asset.browser_download_url);
    await fsPromises.writeFile(tmpPath, data);
    await fsPromises.rename(tmpPath, targetPath);
  }

  await enableCommunityPlugin(vaultRoot, EXCALIDRAW_PLUGIN_ID);
  return getExcalidrawPluginStatus(vaultRoot);
}

function assertInsideVault(vaultRoot: string, targetPath: string): string {
  return resolveInsideVaultBlock(vaultRoot, targetPath);
}

// -- Capability adapter list --
ipcMain.handle('capabilities:list', async () => {
  return runCapabilityRunnerViaViteNode('list');
});

// -- Capability adapter invoke --
ipcMain.handle('capabilities:invoke', async (_event, payload: ElectronCapabilityInvokePayload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Capability invoke payload must be an object.');
  }
  if (!payload.vaultRoot || typeof payload.vaultRoot !== 'string') {
    throw new Error('Capability invoke payload requires a string "vaultRoot".');
  }
  if (!payload.request || typeof payload.request !== 'object') {
    throw new Error('Capability invoke payload requires a "request" object.');
  }
  return runCapabilityRunnerViaViteNode('invoke', payload);
});

// -- Extension runtime sandbox invoke --
ipcMain.handle('extension-runtime:invoke', async (_event, payload: ExtensionRuntimeInvokePayload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Extension runtime payload must be an object.');
  }
  if (!payload.vaultRoot || typeof payload.vaultRoot !== 'string') {
    throw new Error('Extension runtime payload requires a string "vaultRoot".');
  }
  return invokeSandboxedExtensionActionBlock(payload, {
    runCapability: (invokePayload) => runCapabilityRunnerViaViteNode('invoke', invokePayload as ElectronCapabilityInvokePayload),
  });
});

// -- Webull Webull GET bridge (main-process network bridge) --
ipcMain.handle('webull:get', async (_event, payload: WebullGetPayload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Webull Webull payload must be an object.');
  }
  if (typeof payload.url !== 'string' || payload.url.trim().length === 0) {
    throw new Error('Webull Webull payload requires a non-empty "url".');
  }
  if (!payload.headers || typeof payload.headers !== 'object') {
    throw new Error('Webull Webull payload requires a "headers" object.');
  }
  const method = payload.method === 'POST' ? 'POST' : 'GET';
  const body = typeof payload.body === 'string' ? payload.body : '';
  return requestTextOverHttps(method, payload.url, payload.headers, body);
});

// Backward-compatible alias for the initial Webull account-list bridge.
ipcMain.handle('webull:accountList', async (_event, payload: WebullGetPayload) => {
  const method = payload.method === 'POST' ? 'POST' : 'GET';
  const body = typeof payload.body === 'string' ? payload.body : '';
  return requestTextOverHttps(method, payload.url, payload.headers, body);
});

ipcMain.handle('webull:credentials:status', async () => {
  return readWebullCredentialStatusBlock();
});

ipcMain.handle('webull:credentials:set', async (_event, payload: WebullSetCredentialsPayload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Webull Webull credentials payload must be an object.');
  }
  if (typeof payload.appKey !== 'string' || payload.appKey.trim().length === 0) {
    throw new Error('Webull Webull credentials payload requires a non-empty "appKey".');
  }
  if (typeof payload.appSecret !== 'string' || payload.appSecret.trim().length === 0) {
    throw new Error('Webull Webull credentials payload requires a non-empty "appSecret".');
  }
  return saveWebullCredentialsBlock(payload.appKey, payload.appSecret);
});

ipcMain.handle('webull:credentials:clear', async () => {
  return clearWebullCredentialsBlock();
});

ipcMain.handle('webull:token:get', async () => {
  return readWebullAccessTokenBlock();
});

ipcMain.handle('webull:token:set', async (_event, payload: WebullTokenPayload | null) => {
  if (payload === null) {
    await saveWebullAccessTokenBlock(null);
    return;
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Webull Webull token payload must be an object or null.');
  }
  if (typeof payload.token !== 'string' || payload.token.trim().length === 0) {
    throw new Error('Webull Webull token payload requires a non-empty "token".');
  }
  if (payload.expires !== null && (typeof payload.expires !== 'number' || !Number.isFinite(payload.expires))) {
    throw new Error('Webull Webull token payload "expires" must be a number or null.');
  }
  if (payload.status !== null && typeof payload.status !== 'string') {
    throw new Error('Webull Webull token payload "status" must be a string or null.');
  }
  const normalized: WebullStoredAccessTokenBlock = {
    token: payload.token.trim(),
    expires: payload.expires,
    status: payload.status ? payload.status.trim() : null,
  };
  await saveWebullAccessTokenBlock(normalized);
});

// SDK-style signed request helper for v2 APIs (token + account_v2 parity).
ipcMain.handle('webull:signedRequest', async (_event, payload: WebullSignedRequestPayload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Webull Webull signed payload must be an object.');
  }
  if (typeof payload.url !== 'string' || payload.url.trim().length === 0) {
    throw new Error('Webull Webull signed payload requires a non-empty "url".');
  }
  if (payload.method !== 'GET' && payload.method !== 'POST') {
    throw new Error('Webull Webull signed payload requires method GET or POST.');
  }
  if (payload.body !== undefined && typeof payload.body !== 'string') {
    throw new Error('Webull Webull signed payload body must be a string when provided.');
  }
  const credentials = await readWebullCredentialsBlock();
  if (!credentials) {
    throw new Error('Webull credentials are not configured. Open Settings > Webull and save your app key/secret.');
  }

  const headers = buildWebullSignedHeadersBlock(payload, credentials);
  const body = typeof payload.body === 'string' ? payload.body : '';
  return requestTextOverHttps(payload.method, payload.url, headers, body);
});

// -- Vault folder picker --
ipcMain.handle('vault:selectFolder', async () => {
  const result = await dialog.showOpenDialog(myCapacitorApp.getMainWindow(), {
    properties: ['openDirectory'],
    title: 'Select your Obsidian vault folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  // User picked this folder in a native dialog — that's the consent moment;
  // authorize it so vault IPC works before the renderer persists it.
  authorizeVaultRootBlock(result.filePaths[0]);
  return result.filePaths[0];
});

// -- Persisted vault root (main-process storage) --
// Legacy sync handler (kept for backwards-compat with older preload)
ipcMain.on('app:version:getSync', (event) => {
  event.returnValue = app.getVersion();
});

// Async version — avoids blocking the renderer
ipcMain.handle('app:version:get', () => app.getVersion());

// Answered per-window: each window belongs to a workspace profile, and its
// renderer boots against that profile's vault root. The default profile keeps
// reading the legacy vault-root.json, so single-profile installs see no change.
ipcMain.on('vault:root:getPersistedSync', (event) => {
  const profileId = myCapacitorApp.getProfileIdForWebContents(event.sender);
  const profile = getProfileBlock(profileId);
  event.returnValue = profile ? resolveProfileVaultRootBlock(profile) : readPersistedVaultRootBlock();
});

ipcMain.handle('vault:root:setPersisted', async (event, vaultRoot: string | null) => {
  if (vaultRoot !== null && typeof vaultRoot !== 'string') {
    throw new Error('Persisted vault root must be a string or null.');
  }
  const profileId = myCapacitorApp.getProfileIdForWebContents(event.sender);
  setProfileVaultRootBlock(profileId, vaultRoot);
  authorizeVaultRootBlock(vaultRoot);
});

ipcMain.on('opensource-ai:base-url:getPersistedSync', (event) => {
  event.returnValue = readPersistedOpensourceAiBaseUrlBlock();
});

ipcMain.handle('opensource-ai:base-url:setPersisted', async (_event, baseUrl: string | null) => {
  if (baseUrl !== null && typeof baseUrl !== 'string') {
    throw new Error('Persisted Open Source AI base URL must be a string or null.');
  }
  writePersistedOpensourceAiBaseUrlBlock(baseUrl);
});

// -- Vault write prefs (gate what the app may write into a vault) --
// Async getters — the settings UI reads these on mount, not on the critical
// startup path, so no need for the sync-preload dance the vault-root uses.
// Prefs are keyed per vault root (one vault per profile), so each profile's
// toggle only governs its own vault. `aiRaw` runs a one-time per-vault
// migration (existing harvested-raw dir → keep harvesting); the AI-derived
// digests mirror is strictly opt-in with no migration. Setters validate the
// vault root against the main-anchored authorization set like every other
// vault-scoped handler.
ipcMain.handle('vaultWrites:aiRaw:getPersisted', async (_event, vaultRoot?: string) => {
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) return false;
  return resolveWriteAiRawEnabledBlock(vaultRoot);
});

ipcMain.handle('vaultWrites:aiRaw:setPersisted', async (_event, enabled: boolean, vaultRoot?: string) => {
  if (typeof enabled !== 'boolean') {
    throw new Error('vaultWrites:aiRaw:setPersisted requires a boolean.');
  }
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) {
    throw new Error('vaultWrites:aiRaw:setPersisted requires a vault root.');
  }
  assertAuthorizedVaultRootBlock(vaultRoot);
  writeVaultWritePrefForVaultBlock(vaultRoot, { writeAiRaw: enabled });
});

ipcMain.handle('vaultWrites:aiActivity:getPersisted', async (_event, vaultRoot?: string) => {
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) return false;
  return resolveWriteAiActivityEnabledBlock(vaultRoot);
});

ipcMain.handle('vaultWrites:aiActivity:setPersisted', async (_event, enabled: boolean, vaultRoot?: string) => {
  if (typeof enabled !== 'boolean') {
    throw new Error('vaultWrites:aiActivity:setPersisted requires a boolean.');
  }
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) {
    throw new Error('vaultWrites:aiActivity:setPersisted requires a vault root.');
  }
  assertAuthorizedVaultRootBlock(vaultRoot);
  writeVaultWritePrefForVaultBlock(vaultRoot, { writeAiActivity: enabled });
});

// -- Claude CLI intelligence provider — shells out to `claude -p` so Pro-plan
//    users don't get billed on the API on top of their subscription. Payload
//    is a normalized chat request; response is buffered stdout. Requests are
//    keyed by `requestId` for cancellation from the renderer. --
ipcMain.handle('claudeCli:chat', async (_event, requestId: string, request: ClaudeCliChatRequestBlock) => {
  if (typeof requestId !== 'string' || !requestId) {
    throw new Error('claudeCli:chat requires a requestId.');
  }
  if (!request || typeof request !== 'object') {
    throw new Error('claudeCli:chat requires a request payload.');
  }
  return invokeClaudeCliChatBlock(requestId, request);
});
ipcMain.handle('claudeCli:cancel', async (_event, requestId: string) => {
  if (typeof requestId !== 'string' || !requestId) return;
  cancelClaudeCliRequestBlock(requestId);
});
ipcMain.handle('claudeCli:probe', async () => {
  return probeClaudeCliBlock();
});

ipcMain.handle('vault:watch:start', async (_event, vaultRoot: string) => {
  try {
    assertAuthorizedVaultRootBlock(vaultRoot);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Fold legacy `ai-raw/` / `ai_raw/` harvested-raw dirs into the unified
  // `ai-activity/raw/` tree before any code reads or writes it — idempotent,
  // silent on failure.
  migrateAiRawIntoAiActivityBlock(vaultRoot);
  // App-launch trigger for the Apple Screen Time mirror — the renderer
  // starts the vault watcher once on boot, so this is the natural place to
  // top up the per-day JSONLs without waiting for the AI Activity panel to
  // open. Fire-and-forget; FDA denial / unavailability is harmless.
  // Gated by the vault-write-prefs `writeAiRaw` flag (opt-in for new users,
  // auto-migrated to on for vaults that already hold harvested raw signals).
  if (resolveWriteAiRawEnabledBlock(vaultRoot)) {
    void harvestAppleScreenTimeBlock(vaultRoot).catch(() => undefined);
  }
  return startVaultWatcherBlock(vaultRoot, {
    onEvent: (root, event) => {
      // Route only to windows whose profile owns this vault — with multiple
      // profiles open, broadcasting would leak profile A's file events into
      // profile B's renderer and trigger spurious resyncs there.
      for (const win of myCapacitorApp.getWindowsForVaultRootBlock(root)) {
        win.webContents.send('vault:watch:event', event);
      }
    },
  });
});

ipcMain.handle('vault:watch:stop', async (_event, vaultRoot: string) => {
  try {
    assertAuthorizedVaultRootBlock(vaultRoot);
  } catch {
    return { ok: true };
  }
  return stopVaultWatcherBlock(vaultRoot);
});

// Give the renderer a chance to put unsaved text somewhere durable before the
// process goes away. See docs/contracts/DURABILITY.md.
//
// This exists for the *app update* path in particular: the auto-updater quits
// the app, and renderer `beforeunload` / `pagehide` are not reliable across
// every quit route. The window is bounded and short — a quit that hangs is its
// own kind of bug — and the renderer's hot journal tier is synchronous, so the
// wait is only ever paying for the durable (vault) write.
let flushedBeforeQuitBlock = false;

app.on('before-quit', (event) => {
  stopAllVaultWatcherBlocks();

  if (flushedBeforeQuitBlock) return;
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  if (windows.length === 0) return;

  flushedBeforeQuitBlock = true;
  event.preventDefault();

  const acks = windows.map((win) => new Promise<void>((resolve) => {
    const channel = `app:flush-before-quit:ack:${win.id}`;
    const done = () => { ipcMain.removeListener(channel, done); resolve(); };
    ipcMain.once(channel, done);
    try {
      win.webContents.send('app:flush-before-quit', { ackChannel: channel });
    } catch {
      resolve();
    }
  }));

  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, FLUSH_BEFORE_QUIT_TIMEOUT_MS);
  });

  // Whichever comes first. A renderer that is wedged must not be able to stop
  // the user quitting.
  void Promise.race([Promise.all(acks).then(() => undefined), deadline])
    .then(() => { app.quit(); });
});

// -- Open external URL in default browser --
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    throw new Error('openExternal requires an http/https URL.');
  }
  await shell.openExternal(url.trim());
});

ipcMain.handle('google:oauth:request', async (
  _event,
  payload: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Record<string, string>
    body?: string
  },
) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('google oauth payload must be an object.');
  }
  const method = payload.method === 'PUT'
    ? 'PUT'
    : payload.method === 'POST'
      ? 'POST'
      : 'GET';
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('google oauth payload requires an http/https URL.');
  }
  const headers = payload.headers && typeof payload.headers === 'object' ? payload.headers : {};
  const body = typeof payload.body === 'string' ? payload.body : '';
  const response = await requestGoogleTextOverHttpsBlock(method, url, headers, body);
  return {
    status: response.status,
    body: response.body,
  };
});

// Reject URLs that resolve to loopback, link-local (incl. the cloud metadata
// endpoint 169.254.169.254), or private address space. These generic fetch
// bridges exist to pull public resources (RSS feeds, CDN logos) past the
// renderer's CSP/CORS — they must never become an SSRF pivot into the user's
// LAN or a cloud instance's metadata service. Literal-IP hosts are checked
// directly; hostname targets are blocked for the obvious internal names.
function assertPublicFetchUrlBlock(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Obvious internal hostnames.
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(`Refusing to fetch internal host: ${parsed.hostname}`);
  }

  // IPv4 literal → block loopback/link-local/private/CGNAT ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map((n) => parseInt(n, 10));
    const isPrivate =
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224;
    if (isPrivate) {
      throw new Error(`Refusing to fetch private/link-local address: ${parsed.hostname}`);
    }
  }

  // IPv6 loopback / link-local / unique-local literals.
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    throw new Error(`Refusing to fetch internal IPv6 address: ${parsed.hostname}`);
  }

  return trimmed;
}

// -- Generic HTTP GET (for renderer-side fetch requests blocked by CSP) --
ipcMain.handle('net:fetchText', async (_event, url: string): Promise<{ status: number; body: string }> => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    throw new Error('net:fetchText requires an http/https URL');
  }
  assertPublicFetchUrlBlock(url);
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (compatible; ThinkingSpace/1.0)',
    'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
    'Accept-Encoding': 'gzip, deflate, br',
  };
  function fetchTextOnce(targetUrl: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = https.request(targetUrl, { method: 'GET', headers: defaultHeaders }, (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.resume();
          let nextUrl: string;
          try {
            nextUrl = assertPublicFetchUrlBlock(new URL(location, targetUrl).toString());
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          fetchTextOnce(nextUrl).then(resolve).catch(reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const encHeader = res.headers['content-encoding'];
          const enc = (Array.isArray(encHeader) ? (encHeader[0] ?? '') : (encHeader ?? '')).toLowerCase();
          let body: Buffer = raw;
          try {
            if (enc.includes('gzip')) body = gunzipSync(raw);
            else if (enc.includes('deflate')) body = inflateSync(raw);
            else if (enc.includes('br')) body = brotliDecompressSync(raw);
          } catch { /* use raw on decode failure */ }
          resolve({ status, body: body.toString('utf-8') });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
  return fetchTextOnce(url.trim());
});

// Fetch binary bytes from an https URL — used to bypass renderer CORS for
// resources like the parqet logo CDN that don't send Access-Control headers.
ipcMain.handle('net:fetchBytes', async (_event, url: string): Promise<{ status: number; bytesBase64: string; contentType: string | null }> => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    throw new Error('net:fetchBytes requires an http/https URL');
  }
  assertPublicFetchUrlBlock(url);
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (compatible; ThinkingSpace/1.0)',
    'Accept': 'image/png, image/svg+xml, image/*;q=0.8, */*;q=0.5',
  };
  function fetchBytesOnce(targetUrl: string): Promise<{ status: number; bytesBase64: string; contentType: string | null }> {
    return new Promise((resolve, reject) => {
      const req = https.request(targetUrl, { method: 'GET', headers: defaultHeaders }, (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.resume();
          let nextUrl: string;
          try {
            nextUrl = assertPublicFetchUrlBlock(new URL(location, targetUrl).toString());
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          fetchBytesOnce(nextUrl).then(resolve).catch(reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const ctHeader = res.headers['content-type'];
          const contentType = (Array.isArray(ctHeader) ? (ctHeader[0] ?? null) : (ctHeader ?? null)) ?? null;
          resolve({ status, bytesBase64: raw.toString('base64'), contentType });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
  return fetchBytesOnce(url.trim());
});

// -- Read file --
ipcMain.handle('vault:read', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  const stat = await fsPromises.stat(full);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, expected a file: ${relPath}`);
  }
  return fsPromises.readFile(full, 'utf-8');
});

// -- Write file --
ipcMain.handle('vault:write', async (_event, vaultRoot: string, relPath: string, data: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  // Atomic: a crash mid-write must never leave a truncated note. See
  // docs/contracts/DURABILITY.md — plain writeFile O_TRUNCs first, so the
  // failure mode was losing the whole file, not just the newest keystrokes.
  await atomicWriteFileBlock(full, data);
});

// -- Read bytes (base64) --
ipcMain.handle('vault:readBytesBase64', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  const stat = await fsPromises.stat(full);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, expected a file: ${relPath}`);
  }
  const bytes = await fsPromises.readFile(full);
  return bytes.toString('base64');
});

// -- Write bytes (base64) --
ipcMain.handle('vault:writeBytesBase64', async (_event, vaultRoot: string, relPath: string, base64Data: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  const bytes = Buffer.from(base64Data, 'base64');
  await atomicWriteBytesBlock(full, bytes);
});

// -- List directory (returns { files, folders }) --
ipcMain.handle('vault:list', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath || '.');
  const entries = await fsPromises.readdir(full, { withFileTypes: true });
  const files: string[] = [];
  const folders: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || EXCLUDED_DIRS.has(e.name)) continue;
    if (e.isDirectory()) {
      folders.push(e.name);
      continue;
    }
    if (e.isFile()) {
      files.push(e.name);
      continue;
    }
    if (e.isSymbolicLink()) {
      try {
        const targetStat = await fsPromises.stat(path.join(full, e.name));
        if (targetStat.isDirectory()) folders.push(e.name);
        else if (targetStat.isFile()) files.push(e.name);
      } catch {
        // skip broken symlink
      }
      continue;
    }
    // Fallback for unknown dirent types (Windows/junction edge cases).
    try {
      const targetStat = await fsPromises.stat(path.join(full, e.name));
      if (targetStat.isDirectory()) folders.push(e.name);
      else if (targetStat.isFile()) files.push(e.name);
    } catch {
      // skip unreadable entry
    }
  }
  return { files, folders };
});

// -- Walk vault --
ipcMain.handle('vault:walk', async (_event, vaultRoot: string, extensions: string[]) => {
  const extSet = new Set(extensions);
  const results: Array<{ path: string; size: number; mtime: number; ctime: number }> = [];
  const rootResolved = assertAuthorizedVaultRootBlock(vaultRoot);

  async function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Collect subdirectories and files in a single pass
    const subdirPromises: Promise<void>[] = [];
    const fileStatPromises: Promise<void>[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Parallelize directory recursion instead of sequential await
        subdirPromises.push(walk(full));
        continue;
      }

      if (entry.isSymbolicLink()) {
        // Single stat call for symlinks — check if it's a file (not dir)
        fileStatPromises.push(
          fsPromises.stat(full).then(st => {
            if (!st.isFile()) return;
            const ext = path.extname(entry.name).toLowerCase();
            if (!extSet.has(ext)) return;
            results.push({
              path: path.relative(rootResolved, full),
              size: st.size,
              mtime: st.mtimeMs / 1000,
              ctime: st.birthtimeMs / 1000,
            });
          }).catch(() => { /* skip unreadable */ }),
        );
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!extSet.has(ext)) continue;

      // Single stat call per matching file (was 2-3 stats before)
      fileStatPromises.push(
        fsPromises.stat(full).then(st => {
          results.push({
            path: path.relative(rootResolved, full),
            size: st.size,
            mtime: st.mtimeMs / 1000,
            ctime: st.birthtimeMs / 1000,
          });
        }).catch(() => { /* skip unreadable */ }),
      );
    }

    // Wait for all subdirs and file stats in parallel
    await Promise.all([...subdirPromises, ...fileStatPromises]);
  }

  await walk(rootResolved);
  return results;
});

// -- Stat --
ipcMain.handle('vault:stat', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  const st = await fsPromises.stat(full);
  return {
    size: st.size,
    mtime: st.mtimeMs / 1000,
    ctime: st.birthtimeMs / 1000,
    isDirectory: st.isDirectory(),
  };
});

// -- Exists --
ipcMain.handle('vault:exists', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  try {
    await fsPromises.access(full);
    return true;
  } catch {
    return false;
  }
});

// -- Native AI session stores (read-only, locked to the configured roots;
//    defaults: ~/.claude/projects + ~/.codex/sessions) --
ipcMain.handle('nativeAiSessions:list', async () => {
  return listNativeAiSessionsBlock();
});
ipcMain.handle(
  'nativeAiSessions:read',
  async (_event, source: NativeAiSource, relPath: string) => {
    return readNativeAiSessionBlock(source, relPath);
  },
);
ipcMain.handle('nativeAiSessions:getRoots', async () => {
  return readNativeAiRootsBlock();
});
ipcMain.handle(
  'nativeAiSessions:setRoots',
  async (_event, roots: Partial<Record<NativeAiSource, string | null>>) => {
    return writeNativeAiRootsBlock(roots);
  },
);
ipcMain.handle('nativeAiSessions:readClaudeHistory', async () => {
  return readClaudeHistoryBlock();
});

// -- Apple Screen Time dump (mirrors knowledgeC.db streams into per-day
//    JSONLs under ai-activity/raw-sessions/apple_screen_time/ so we keep history past the
//    macOS 28-day cliff). Requires Full Disk Access. Gated by the
//    vault-write-prefs `writeAiRaw` flag — no-op when the user has opted
//    out of raw-signal writes. --
ipcMain.handle('appleScreenTime:harvest', async (_event, vaultRoot: string) => {
  assertAuthorizedVaultRootBlock(vaultRoot);
  if (!resolveWriteAiRawEnabledBlock(vaultRoot)) return;
  return harvestAppleScreenTimeBlock(vaultRoot);
});

// -- GoodNotes reading activity (attributes app_usage focus events to docs
//    via fts.sqlite; writes only to the vault's durable reading log). Runs
//    the Screen Time dump first so its source data is fresh. Same gate as
//    the Screen Time handler — both produce files under
//    `ai-activity/raw-sessions/`. --
ipcMain.handle('goodnotes:harvest', async (_event, vaultRoot: string) => {
  assertAuthorizedVaultRootBlock(vaultRoot);
  if (!resolveWriteAiRawEnabledBlock(vaultRoot)) {
    return { added: 0, total: 0, unavailable: true };
  }
  if (typeof vaultRoot === 'string' && vaultRoot) {
    await harvestAppleScreenTimeBlock(vaultRoot);
  }
  return harvestGoodnotesReadingBlock(vaultRoot);
});
ipcMain.handle('goodnotes:readLog', async (_event, vaultRoot: string) => {
  return readGoodnotesReadingLogBlock(assertAuthorizedVaultRootBlock(vaultRoot));
});
ipcMain.handle('goodnotes:editRecord', async (
  _event,
  vaultRoot: string,
  input: GoodnotesEditInput,
) => {
  return editGoodnotesReadingRecordBlock(assertAuthorizedVaultRootBlock(vaultRoot), input);
});

// -- Mkdir --
ipcMain.handle('vault:mkdir', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  await fsPromises.mkdir(full, { recursive: true });
});

// -- Rename path --
ipcMain.handle('vault:rename', async (_event, vaultRoot: string, fromRelPath: string, toRelPath: string) => {
  const fromFull = assertInsideVault(vaultRoot, fromRelPath);
  const toFull = assertInsideVault(vaultRoot, toRelPath);
  await fsPromises.mkdir(path.dirname(toFull), { recursive: true });
  await fsPromises.rename(fromFull, toFull);
});

// -- Delete path --
ipcMain.handle('vault:delete', async (_event, vaultRoot: string, relPath: string, recursive = true) => {
  const full = assertInsideVault(vaultRoot, relPath);
  await fsPromises.rm(full, { recursive: Boolean(recursive), force: false });
});

// -- Copy path --
ipcMain.handle('vault:copy', async (_event, vaultRoot: string, fromRelPath: string, toRelPath: string) => {
  const fromFull = assertInsideVault(vaultRoot, fromRelPath);
  const toFull = assertInsideVault(vaultRoot, toRelPath);
  await fsPromises.mkdir(path.dirname(toFull), { recursive: true });
  await fsPromises.cp(fromFull, toFull, { recursive: true, force: false, errorOnExist: true });
});

// -- Reveal path in file manager --
ipcMain.handle('vault:reveal', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  const stat = await fsPromises.stat(full);
  if (stat.isDirectory()) {
    const openErr = await shell.openPath(full);
    if (openErr) throw new Error(openErr);
    return;
  }
  shell.showItemInFolder(full);
});

// -- Open path with default app --
ipcMain.handle('vault:openPath', async (_event, vaultRoot: string, relPath: string) => {
  const full = assertInsideVault(vaultRoot, relPath);
  const openErr = await shell.openPath(full);
  if (openErr) throw new Error(openErr);
});

// -- Git command --
// Only a fixed set of subcommands the app actually issues is allowed. This
// stops a compromised/injected renderer from smuggling code-exec vectors
// through the git CLI — e.g. `git clone ext::sh -c ...`, `git config`, or a
// leading `-c protocol.ext.allow=always` / `--exec-path=...` that would make
// git run an arbitrary program. spawn() runs without a shell, so there's no
// shell metacharacter surface; this guards git's own dangerous features.
const GIT_ALLOWED_SUBCOMMANDS_BLOCK = new Set([
  'rev-parse',
  'status',
  'add',
  'commit',
  'push',
  'pull',
  'fetch',
  'log',
  'shortlog',
  'diff',
  'show',
  'branch',
  'remote',
]);

// Flag/argument-level code-exec vectors that git exposes even inside allowed
// subcommands. `--upload-pack`/`--receive-pack`/`--exec` let fetch/push/pull run
// an arbitrary program as the "git server"; the `ext::`/`fd::` remote-helper
// transports run a shell command as a remote URL. The app never uses any of
// these, so reject them outright regardless of subcommand.
const GIT_FORBIDDEN_ARG_PATTERNS_BLOCK: RegExp[] = [
  /^--upload-pack(=|$)/,
  /^--receive-pack(=|$)/,
  /^--exec(=|$)/,
  /(^|[^a-z])(ext|fd)::/i,
];

ipcMain.handle('vault:git', async (_event, vaultRoot: string, args: string[]) => {
  const cwd = assertAuthorizedVaultRootBlock(vaultRoot);
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    throw new Error('vault:git requires an array of string arguments.');
  }
  // The subcommand is the first non-flag token. Reject anything before it
  // (git's global `-c`/`--exec-path` etc. can inject config or a fake git
  // binary) and reject subcommands outside the allowlist.
  const subcommand = args.find((a) => !a.startsWith('-'));
  const firstToken = args[0];
  if (firstToken !== undefined && firstToken.startsWith('-')) {
    throw new Error(`vault:git rejects leading git option "${firstToken}".`);
  }
  if (!subcommand || !GIT_ALLOWED_SUBCOMMANDS_BLOCK.has(subcommand)) {
    throw new Error(`vault:git subcommand not allowed: ${subcommand ?? '<none>'}`);
  }
  for (const arg of args) {
    if (GIT_FORBIDDEN_ARG_PATTERNS_BLOCK.some((pattern) => pattern.test(arg))) {
      throw new Error(`vault:git rejects unsafe argument: ${arg}`);
    }
  }
  return new Promise<string>((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || 'Git command failed'));
      else resolve(stdout);
    });
    proc.on('error', (err) => reject(err));
  });
});

// -- Excalidraw plugin status --
ipcMain.handle('plugin:excalidraw:status', async (_event, vaultRoot: string) => {
  return getExcalidrawPluginStatus(vaultRoot);
});

// -- Excalidraw plugin install/update --
ipcMain.handle('plugin:excalidraw:installLatest', async (_event, vaultRoot: string) => {
  return installOrUpdateExcalidrawPlugin(vaultRoot);
});

// -- Hierarchy db status --
ipcMain.handle('hierarchy:status', async (_event, vaultRoot: string) => {
  return getHierarchyDbStatusOrch(assertAuthorizedVaultRootBlock(vaultRoot));
});

// -- Hierarchy db init --
ipcMain.handle('hierarchy:init', async (_event, vaultRoot: string) => {
  return initializeHierarchyDbOrch(assertAuthorizedVaultRootBlock(vaultRoot));
});

// -- Hierarchy nodes list --
ipcMain.handle(
  'hierarchy:nodes:list',
  async (_event, vaultRoot: string, params: { parent_id: string | null; type?: 'project' | 'epic' | 'idea' | null }) => {
    return listHierarchyNodesOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy node get --
ipcMain.handle('hierarchy:nodes:get', async (_event, vaultRoot: string, nodeId: string) => {
  return getHierarchyNodeOrch(assertAuthorizedVaultRootBlock(vaultRoot), nodeId);
});

// -- Hierarchy node create --
ipcMain.handle(
  'hierarchy:nodes:create',
  async (
    _event,
    vaultRoot: string,
    params: { type: 'project' | 'epic' | 'idea'; node_kind?: string | null; title: string; parent_id: string | null; slug?: string | null; sort_order: number },
  ) => {
    return createHierarchyNodeOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy node update --
ipcMain.handle(
  'hierarchy:nodes:update',
  async (
    _event,
    vaultRoot: string,
    params: { node_id: string; type?: 'project' | 'epic' | 'idea' | null; node_kind?: string | null; title?: string | null; slug?: string | null; sort_order?: number | null },
  ) => {
    return updateHierarchyNodeOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy node move --
ipcMain.handle(
  'hierarchy:nodes:move',
  async (
    _event,
    vaultRoot: string,
    params: { node_id: string; new_parent_id: string | null; sort_order?: number | null },
  ) => {
    return moveHierarchyNodeOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy node delete --
ipcMain.handle('hierarchy:nodes:delete', async (_event, vaultRoot: string, nodeId: string) => {
  return deleteHierarchyNodeOrch(assertAuthorizedVaultRootBlock(vaultRoot), nodeId);
});

// -- Hierarchy thought upsert --
ipcMain.handle(
  'hierarchy:thoughts:upsert',
  async (_event, vaultRoot: string, params: { file_path: string; title?: string | null }) => {
    return upsertHierarchyThoughtOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy thoughts list --
ipcMain.handle(
  'hierarchy:thoughts:list',
  async (_event, vaultRoot: string, params: { unlinked_only: boolean; limit: number }) => {
    return listHierarchyThoughtsOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy thought-links list --
ipcMain.handle(
  'hierarchy:thought-links:list',
  async (_event, vaultRoot: string, params: { thought_id?: string | null; node_id?: string | null }) => {
    return listHierarchyThoughtLinksOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy thought-link create --
ipcMain.handle(
  'hierarchy:thought-links:create',
  async (_event, vaultRoot: string, params: { thought_id: string; node_id: string; link_kind?: string | null }) => {
    return createHierarchyThoughtLinkOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy thought-link delete --
ipcMain.handle('hierarchy:thought-links:delete', async (_event, vaultRoot: string, linkId: string) => {
  return deleteHierarchyThoughtLinkOrch(assertAuthorizedVaultRootBlock(vaultRoot), linkId);
});

// -- Hierarchy edges list --
ipcMain.handle(
  'hierarchy:edges:list',
  async (_event, vaultRoot: string, params: { from_node_id?: string | null; to_node_id?: string | null }) => {
    return listHierarchyEdgesOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy edge create --
ipcMain.handle(
  'hierarchy:edges:create',
  async (_event, vaultRoot: string, params: { from_node_id: string; to_node_id: string; edge_kind?: string | null }) => {
    return createHierarchyEdgeOrch(assertAuthorizedVaultRootBlock(vaultRoot), params);
  },
);

// -- Hierarchy edge delete --
ipcMain.handle('hierarchy:edges:delete', async (_event, vaultRoot: string, edgeId: string) => {
  return deleteHierarchyEdgeOrch(assertAuthorizedVaultRootBlock(vaultRoot), edgeId);
});

// -- Hierarchy path resolve --
ipcMain.handle('hierarchy:path:resolve', async (_event, vaultRoot: string, requestedPath: string) => {
  const resolved = resolveHierarchyPathOrch(assertAuthorizedVaultRootBlock(vaultRoot), requestedPath);
  if (!resolved) {
    return {
      requested_path: requestedPath,
      found: false,
      resolved_path: null,
      target_type: null,
      target_id: null,
      via_alias: false,
    };
  }
  return {
    ...resolved,
    found: true,
  };
});

// =====================================================================
// IPC Handlers — AI Credentials
// =====================================================================

ipcMain.handle('ai:credentials:claude', async () => {
  return readClaudeCredentialsBlock();
});

ipcMain.handle('ai:credentials:azure', async () => {
  return readAzureTokenBlock();
});

ipcMain.handle('ai:credentials:claude:refresh', async (_event, refreshToken: string) => {
  return refreshClaudeTokenBlock(refreshToken);
});

ipcMain.handle('ai:credentials:codex', async () => {
  return readCodexCredentialsBlock();
});

ipcMain.handle('ai:credentials:codex:refresh', async (_event, refreshToken: string) => {
  return refreshCodexTokenBlock(refreshToken);
});

ipcMain.handle(
  'ai:chat:codex',
  async (
    _event,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    accessToken: string,
    accountId?: string,
    model?: string,
  ) => {
    return chatCodexWithOauthBlock(messages, accessToken, accountId, model);
  },
);

// =====================================================================
// IPC Handlers — Intelligence subsystem sidecar cache
// =====================================================================

import {
  cleanupLegacySessionTitlesBlock,
  clearIntelligenceCacheBlock,
  readIntelligenceCacheBlock,
  writeIntelligenceCacheBlock,
  type IntelligenceCacheRecord,
} from './lego_blocks/intelligenceCacheStoreBlock';

// Fire-and-forget cleanup of the legacy ~/.thinking-space/session-titles/ dir
// left behind by the pre-intelligence implementation. Never blocks startup.
void cleanupLegacySessionTitlesBlock();

ipcMain.handle('intelligence-cache:get', async (_event, taskId: string, cacheKey: string) => {
  if (typeof taskId !== 'string' || !taskId.trim()) return null;
  if (typeof cacheKey !== 'string' || !cacheKey.trim()) return null;
  return readIntelligenceCacheBlock(taskId.trim(), cacheKey.trim());
});

ipcMain.handle('intelligence-cache:set', async (_event, record: IntelligenceCacheRecord) => {
  if (
    !record ||
    typeof record.taskId !== 'string' ||
    typeof record.cacheKey !== 'string' ||
    typeof record.valueJson !== 'string' ||
    typeof record.providerId !== 'string' ||
    typeof record.model !== 'string'
  ) {
    return { ok: false, error: 'invalid record' };
  }
  try {
    await writeIntelligenceCacheBlock(record);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('intelligence-cache:clear', async (_event, taskId?: string) => {
  try {
    await clearIntelligenceCacheBlock(typeof taskId === 'string' && taskId.trim() ? taskId.trim() : undefined);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
