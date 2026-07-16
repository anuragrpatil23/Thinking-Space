import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import {
  CapElectronEventEmitter,
  CapacitorSplashScreen,
  setupCapacitorElectronPlugins,
} from '@capacitor-community/electron';
import chokidar from 'chokidar';
import type { MenuItemConstructorOptions, Rectangle, Session, WebContents } from 'electron';
import { app, BrowserWindow, clipboard, Menu, MenuItem, nativeImage, screen, Tray, session, shell } from 'electron';
import electronIsDev from 'electron-is-dev';
import electronServe from 'electron-serve';
import windowStateKeeper from 'electron-window-state';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  buildUserAiOriginEntryBlock,
  collectCspSourcesForDirectiveBlock,
  type CspBuildOptionsBlock,
  type CspDirective,
} from './lego_blocks/cspWhitelistBlock';

// Define components for a watcher to detect when the webapp is changed so we can reload in Dev mode.
const reloadWatcher = {
  debouncer: null,
  ready: false,
  watcher: null,
};

const MAC_TRAFFIC_LIGHT_POSITION = { x: 14, y: 14 };
const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 640;

interface PersistedWindowStateBlock {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface SafeWindowBoundsBlock {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface AppWindowContextBlock {
  browserWindowId: number;
  sessionId: string;
  isMainWindow: boolean;
  isBackgroundAuthority: boolean;
}

function isFiniteNumberBlock(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampNumberBlock(value: number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.min(Math.max(value, min), max);
}

function rectsIntersectBlock(left: Rectangle, right: Rectangle): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function pickDisplayForBoundsBlock(bounds: Rectangle) {
  const displays = screen.getAllDisplays();
  const exactMatch = displays.find((display) => rectsIntersectBlock(bounds, display.workArea));
  return exactMatch ?? screen.getPrimaryDisplay();
}

function resolveSafeWindowBoundsBlock(
  state: PersistedWindowStateBlock,
  defaults: { width: number; height: number },
): SafeWindowBoundsBlock {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const desiredWidth = isFiniteNumberBlock(state.width) ? state.width : defaults.width;
  const desiredHeight = isFiniteNumberBlock(state.height) ? state.height : defaults.height;
  const width = clampNumberBlock(desiredWidth, MIN_WINDOW_WIDTH, primaryWorkArea.width);
  const height = clampNumberBlock(desiredHeight, MIN_WINDOW_HEIGHT, primaryWorkArea.height);

  if (isFiniteNumberBlock(state.x) && isFiniteNumberBlock(state.y)) {
    const desiredBounds = { x: state.x, y: state.y, width, height };
    const workArea = pickDisplayForBoundsBlock(desiredBounds).workArea;
    return {
      width: Math.min(width, workArea.width),
      height: Math.min(height, workArea.height),
      x: clampNumberBlock(state.x, workArea.x, workArea.x + Math.max(0, workArea.width - width)),
      y: clampNumberBlock(state.y, workArea.y, workArea.y + Math.max(0, workArea.height - height)),
    };
  }

  return { width, height };
}

function resolveContextMenuOwnerWindowBlock(targetContents: WebContents): BrowserWindow | undefined {
  const guestHostContents = (targetContents as WebContents & { hostWebContents?: WebContents }).hostWebContents;
  return BrowserWindow.fromWebContents(guestHostContents ?? targetContents) ?? undefined;
}

function attachWebviewContextMenuBlock(targetContents: WebContents): void {
  targetContents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.isEditable) {
      // --- Spell-check suggestions (macOS native autocorrect feel) ---
      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions) {
          template.push({
            label: suggestion,
            click: () => { targetContents.replaceMisspelling(suggestion); },
          });
        }
        if (params.dictionarySuggestions.length === 0) {
          template.push({ label: 'No Suggestions', enabled: false });
        }
        template.push({ type: 'separator' });
      }

      // --- Editable field: edit actions only (mirrors Chrome behaviour) ---
      template.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll' },
      );
    } else {
      const linkUrl = params.linkURL?.trim() ?? '';
      const selectionText = params.selectionText?.trim() ?? '';

      // --- Link ---
      if (linkUrl) {
        template.push(
          {
            label: 'Open Link in Browser',
            click: () => { void shell.openExternal(linkUrl).catch(() => undefined); },
          },
          {
            label: 'Copy Link Address',
            click: () => { clipboard.writeText(linkUrl); },
          },
        );
      }

      // --- Image ---
      if (params.hasImageContents && params.srcURL) {
        if (template.length > 0) template.push({ type: 'separator' });
        template.push(
          {
            label: 'Save Image As…',
            click: () => { targetContents.downloadURL(params.srcURL); },
          },
          {
            label: 'Copy Image Address',
            click: () => { clipboard.writeText(params.srcURL); },
          },
          {
            label: 'Open Image in Browser',
            click: () => { void shell.openExternal(params.srcURL).catch(() => undefined); },
          },
        );
      }

      // --- Selected text ---
      if (selectionText) {
        if (template.length > 0) template.push({ type: 'separator' });
        const query = selectionText.length > 30 ? `${selectionText.slice(0, 30)}…` : selectionText;
        template.push(
          { role: 'copy' },
          {
            label: `Search Google for "${query}"`,
            click: () => {
              void shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(selectionText)}`).catch(() => undefined);
            },
          },
        );
      }

      // --- Navigation (Back / Forward / Reload) ---
      if (template.length > 0) template.push({ type: 'separator' });
      template.push(
        {
          label: 'Back',
          enabled: targetContents.canGoBack(),
          click: () => { targetContents.goBack(); },
        },
        {
          label: 'Forward',
          enabled: targetContents.canGoForward(),
          click: () => { targetContents.goForward(); },
        },
        {
          label: 'Reload',
          click: () => { targetContents.reload(); },
        },
      );

      // --- Page actions ---
      const pageUrl = params.pageURL?.trim() ?? '';
      template.push(
        { type: 'separator' },
        {
          label: 'Save As…',
          enabled: Boolean(pageUrl),
          click: () => { if (pageUrl) targetContents.downloadURL(pageUrl); },
        },
        {
          label: 'Print…',
          click: () => { targetContents.print(); },
        },
        { type: 'separator' },
        {
          label: 'View Page Source',
          enabled: Boolean(pageUrl),
          click: () => { if (pageUrl) void shell.openExternal(`view-source:${pageUrl}`).catch(() => undefined); },
        },
        {
          label: 'Inspect',
          click: () => { targetContents.openDevTools(); },
        },
      );
    }

    if (template.length === 0) return;
    const ownerWindow = resolveContextMenuOwnerWindowBlock(targetContents);
    Menu.buildFromTemplate(template).popup(ownerWindow ? { window: ownerWindow } : {});
  });
}

function isCustomSchemeUrlBlock(url: string, customScheme: string): boolean {
  return url.startsWith(`${customScheme}://`);
}

function isTrustedPopupUrlBlock(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'google.com'
      || host.endsWith('.google.com')
      || host.endsWith('.googleusercontent.com');
  } catch {
    return false;
  }
}
export function setupReloadWatcher(electronCapacitorApp: ElectronCapacitorApp): void {
  // Properly close any existing watcher before creating a new one to prevent
  // file descriptor leaks and memory growth during dev mode reloads
  if (reloadWatcher.watcher) {
    reloadWatcher.watcher.close().catch(() => { /* best-effort cleanup */ });
    reloadWatcher.watcher = null;
  }
  reloadWatcher.watcher = chokidar
    .watch(join(app.getAppPath(), 'app'), {
      ignored: /[/\\]\./,
      persistent: true,
    })
    .on('ready', () => {
      reloadWatcher.ready = true;
    })
    .on('all', (_event, _path) => {
      if (reloadWatcher.ready) {
        clearTimeout(reloadWatcher.debouncer);
        reloadWatcher.debouncer = setTimeout(async () => {
          electronCapacitorApp.getMainWindow().webContents.reload();
          reloadWatcher.ready = false;
          clearTimeout(reloadWatcher.debouncer);
          reloadWatcher.debouncer = null;
          setupReloadWatcher(electronCapacitorApp);
        }, 1500);
      }
    });
}

// Define our class to manage our app.
export class ElectronCapacitorApp {
  private windows: BrowserWindow[] = [];
  private windowSessionIdById = new Map<number, string>();
  private mainWindowId: number | null = null;
  private backgroundAuthorityWindowId: number | null = null;
  private SplashScreen: CapacitorSplashScreen | null = null;
  private TrayIcon: Tray | null = null;
  private CapacitorFileConfig: CapacitorElectronConfig;
  private TrayMenuTemplate: (MenuItem | MenuItemConstructorOptions)[] = [
    new MenuItem({ label: 'Quit App', role: 'quit' }),
  ];
  private AppMenuBarMenuTemplate: (MenuItem | MenuItemConstructorOptions)[] = [
    { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
    { role: 'viewMenu' },
  ];
  private mainWindowState;
  private loadWebApp;
  private customScheme: string;
  private liveSourceUrl: string | null = null;

  constructor(
    capacitorFileConfig: CapacitorElectronConfig,
    trayMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[],
    appMenuBarMenuTemplate?: (MenuItemConstructorOptions | MenuItem)[]
  ) {
    this.CapacitorFileConfig = capacitorFileConfig;

    this.customScheme = this.CapacitorFileConfig.electron?.customUrlScheme ?? 'capacitor-electron';

    if (trayMenuTemplate) {
      this.TrayMenuTemplate = trayMenuTemplate;
    }

    if (appMenuBarMenuTemplate) {
      this.AppMenuBarMenuTemplate = appMenuBarMenuTemplate;
    }

    // Setup our web app loader, this lets us load apps like react, vue, and angular without changing their build chains.
    this.loadWebApp = electronServe({
      directory: join(app.getAppPath(), 'app'),
      scheme: this.customScheme,
    });
  }

  // Helper function to load in the app.
  private async loadMainWindow(thisRef: ElectronCapacitorApp) {
    if (thisRef.liveSourceUrl) {
      await thisRef.windows[0].loadURL(thisRef.liveSourceUrl);
    } else {
      await thisRef.loadWebApp(thisRef.windows[0]);
    }
  }

  // Expose the first window for backward compatibility.
  getMainWindow(): BrowserWindow {
    return this.windows[0];
  }

  getWindowCount(): number {
    return this.windows.length;
  }

  getWindowContextForWebContents(targetContents: WebContents): AppWindowContextBlock | null {
    const targetWindow = BrowserWindow.fromWebContents(targetContents);
    if (!targetWindow) return null;
    return this.buildWindowContextBlock(targetWindow);
  }

  getCustomURLScheme(): string {
    return this.customScheme;
  }

  setLiveSourceUrl(url: string | null): void {
    this.liveSourceUrl = url;
  }

  getLiveSourceUrl(): string | null {
    return this.liveSourceUrl;
  }

  private registerAppWindowContextBlock(targetWindow: BrowserWindow, options: { isMainWindow: boolean }): void {
    const sessionId = options.isMainWindow
      ? 'main-window'
      : `window-${randomUUID()}`;
    this.windowSessionIdById.set(targetWindow.id, sessionId);
    if (options.isMainWindow) {
      this.mainWindowId = targetWindow.id;
    }
    if (this.backgroundAuthorityWindowId === null || !this.windowSessionIdById.has(this.backgroundAuthorityWindowId)) {
      this.backgroundAuthorityWindowId = targetWindow.id;
    }
    this.broadcastWindowContextChangesBlock();
  }

  private handleTrackedWindowClosedBlock(targetWindow: BrowserWindow): void {
    const closingWindowId = targetWindow.id;
    this.windows = this.windows.filter((windowRef) => windowRef !== targetWindow);
    this.windowSessionIdById.delete(closingWindowId);
    if (this.mainWindowId === closingWindowId) {
      this.mainWindowId = null;
    }
    if (this.backgroundAuthorityWindowId === closingWindowId) {
      this.backgroundAuthorityWindowId = this.resolveNextBackgroundAuthorityWindowIdBlock();
    }
    this.broadcastWindowContextChangesBlock();
  }

  private resolveNextBackgroundAuthorityWindowIdBlock(): number | null {
    for (const targetWindow of this.windows) {
      if (targetWindow.isDestroyed()) continue;
      if (!this.windowSessionIdById.has(targetWindow.id)) continue;
      return targetWindow.id;
    }
    return null;
  }

  private buildWindowContextBlock(targetWindow: BrowserWindow): AppWindowContextBlock {
    const sessionId = this.windowSessionIdById.get(targetWindow.id) ?? `window-${targetWindow.id}`;
    return {
      browserWindowId: targetWindow.id,
      sessionId,
      isMainWindow: this.mainWindowId === targetWindow.id,
      isBackgroundAuthority: this.backgroundAuthorityWindowId === targetWindow.id,
    };
  }

  private broadcastWindowContextChangesBlock(): void {
    for (const targetWindow of this.windows) {
      if (targetWindow.isDestroyed()) continue;
      targetWindow.webContents.send('window:context-changed', this.buildWindowContextBlock(targetWindow));
    }
  }

  reloadAllWindows(): void {
    for (const win of this.windows) {
      if (win.isDestroyed()) continue;
      if (this.liveSourceUrl) {
        void win.loadURL(this.liveSourceUrl);
      } else {
        void this.loadWebApp(win);
      }
    }
  }

  private isLiveSourceUrl(url: string): boolean {
    if (!this.liveSourceUrl) return false;
    return url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:');
  }

  private getWindowChromeOptions() {
    if (process.platform === 'darwin') {
      return {
        frame: false,
        titleBarStyle: 'hidden' as const,
        roundedCorners: true,
        // Native NSVisualEffectView blur behind the window; the renderer keeps
        // the shell chrome translucent so desktop content bleeds through like
        // the Finder sidebar. `transparent: true` must NOT be set here — it
        // suppresses the vibrancy view and leaves a static see-through window.
        // Requires the transparent html/body/#root chain in App.tsx.
        vibrancy: 'sidebar' as const,
        visualEffectState: 'followWindow' as const,
        trafficLightPosition: MAC_TRAFFIC_LIGHT_POSITION,
      };
    }
    return {
      roundedCorners: true,
    };
  }

  private shouldHideNativeMenuBar(): boolean {
    return process.platform === 'win32';
  }

  private applyNativeMenuBarVisibility(targetWindow: BrowserWindow): void {
    if (!this.shouldHideNativeMenuBar()) return;
    targetWindow.setAutoHideMenuBar(true);
    targetWindow.setMenuBarVisibility(false);
  }

  /**
   * Preserve rounded-corner window chrome by avoiding restored maximized/fullscreen states.
   */
  private enforceRoundedRectangleWindow(targetWindow: BrowserWindow): void {
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    }

    if (targetWindow.isFullScreen()) {
      targetWindow.setFullScreen(false);
    }

    if (process.platform === 'darwin' && targetWindow.isSimpleFullScreen()) {
      targetWindow.setSimpleFullScreen(false);
    }
  }

  private normalizeInAppRoute(route?: string): string | null {
    const trimmed = route?.trim();
    if (!trimmed) return null;
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return normalized;
  }

  private routeWindowAfterLoad(targetWindow: BrowserWindow, route?: string): void {
    const normalizedRoute = this.normalizeInAppRoute(route);
    if (!normalizedRoute) return;
    const script = `(() => {
      const nextRoute = ${JSON.stringify(normalizedRoute)};
      if (window.location.hash !== \`#\${nextRoute}\`) {
        window.location.hash = nextRoute;
      }
    })();`;

    targetWindow.webContents.once('did-finish-load', () => {
      void targetWindow.webContents.executeJavaScript(script, true).catch(() => {});
    });
  }

  private resolveAppIconPath(): string {
    const iconFileName = process.platform === 'win32' ? 'appIcon.ico' : 'appIcon.png';
    const candidates = [
      join(app.getAppPath(), 'assets', iconFileName),
      join(process.resourcesPath, 'assets', iconFileName),
      join(process.cwd(), 'assets', iconFileName),
      join(process.cwd(), 'electron', 'assets', iconFileName),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  private createAppIcon() {
    const iconPath = this.resolveAppIconPath();
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.warn(`[electron] Unable to load app icon from ${iconPath}`);
    }
    return icon;
  }

  private attachNativeContextMenu(targetWindow: BrowserWindow): void {
    targetWindow.webContents.on('context-menu', (_event, params) => {
      let template: MenuItemConstructorOptions[] = [];

      if (params.isEditable) {
        // Spell-check suggestions (macOS native autocorrect feel)
        if (params.misspelledWord) {
          for (const suggestion of params.dictionarySuggestions) {
            template.push({
              label: suggestion,
              click: () => { targetWindow.webContents.replaceMisspelling(suggestion); },
            });
          }
          if (params.dictionarySuggestions.length === 0) {
            template.push({ label: 'No Suggestions', enabled: false });
          }
          template.push({ type: 'separator' });
        }

        template.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          {
            label: 'Paste as Markdown Table',
            enabled: params.editFlags.canPaste,
            click: () => {
              targetWindow.webContents.send('markdown-editor:paste-as-table')
            },
          },
          { role: 'selectAll' },
        );
      } else if (params.selectionText?.trim()) {
        template = [
          { role: 'copy' },
          { type: 'separator' },
          { role: 'selectAll' },
        ];
      } else {
        return;
      }

      Menu.buildFromTemplate(template).popup({ window: targetWindow });
    });
  }

  private applyMacWindowButtonVisibility(targetWindow: BrowserWindow): void {
    if (process.platform !== 'darwin') return;
    targetWindow.setWindowButtonVisibility(true);
    targetWindow.setWindowButtonPosition(MAC_TRAFFIC_LIGHT_POSITION);
  }

  private shouldApplyConfiguredBackgroundColor(): boolean {
    return process.platform !== 'darwin';
  }

  // Create a new window (used for multi-window support).
  async createWindow(route?: string): Promise<BrowserWindow> {
    const icon = this.createAppIcon();
    const preloadPath = join(app.getAppPath(), 'build', 'src', 'preload.js');
    const winState = windowStateKeeper({
      defaultWidth: DEFAULT_WINDOW_WIDTH,
      defaultHeight: DEFAULT_WINDOW_HEIGHT,
    });

    // Cascade new windows 32px down-right from the frontmost existing window
    // so they don't land exactly on top of it.
    const CASCADE_OFFSET = 32;
    const frontmost = BrowserWindow.getFocusedWindow() ?? this.windows[this.windows.length - 1];
    let spawnX = winState.x;
    let spawnY = winState.y;
    if (frontmost && !frontmost.isDestroyed()) {
      const [fx, fy] = frontmost.getPosition();
      spawnX = fx + CASCADE_OFFSET;
      spawnY = fy + CASCADE_OFFSET;
    }
    const safeBounds = resolveSafeWindowBoundsBlock(
      {
        x: spawnX,
        y: spawnY,
        width: winState.width,
        height: winState.height,
      },
      { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
    );

    const newWindow = new BrowserWindow({
      icon,
      show: false,
      ...safeBounds,
      autoHideMenuBar: this.shouldHideNativeMenuBar(),
      ...this.getWindowChromeOptions(),
      webPreferences: {
        // Renderer talks to the main process exclusively through the
        // contextBridge API exposed in preload.ts — it never touches Node
        // directly. Keeping nodeIntegration off means a renderer-side script
        // injection (e.g. via markdown/webview) can't reach `require`,
        // `child_process`, or `process`. Do not flip this back on.
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
        webviewTag: true,
        spellcheck: true,
      },
    });
    winState.manage(newWindow);
    this.enforceRoundedRectangleWindow(newWindow);
    this.applyMacWindowButtonVisibility(newWindow);
    this.applyNativeMenuBarVisibility(newWindow);
    this.attachNativeContextMenu(newWindow);
    setupWindowSwipeNavigation(newWindow);

    if (this.CapacitorFileConfig.backgroundColor && this.shouldApplyConfiguredBackgroundColor()) {
      newWindow.setBackgroundColor(this.CapacitorFileConfig.electron.backgroundColor);
    }

    // Track window and remove on close.
    this.windows.push(newWindow);
    this.registerAppWindowContextBlock(newWindow, { isMainWindow: false });
    newWindow.on('closed', () => {
      this.handleTrackedWindowClosedBlock(newWindow);
    });

    // Security
    newWindow.webContents.setWindowOpenHandler((details) => {
      if (isCustomSchemeUrlBlock(details.url, this.customScheme) || isTrustedPopupUrlBlock(details.url)) {
        return { action: 'allow' };
      }
      void shell.openExternal(details.url).catch(() => undefined);
      return { action: 'deny' };
    });
    newWindow.webContents.on('will-navigate', (event, _newURL) => {
      const currentUrl = newWindow.webContents.getURL();
      if (!currentUrl.includes(this.customScheme) && !this.isLiveSourceUrl(currentUrl)) {
        event.preventDefault();
      }
    });

    // Load the web app and show the window when ready.
    newWindow.webContents.on('dom-ready', () => {
      newWindow.show();
      if (electronIsDev) {
        newWindow.webContents.openDevTools();
      }
    });

    this.routeWindowAfterLoad(newWindow, route);
    if (this.liveSourceUrl) {
      await newWindow.loadURL(this.liveSourceUrl);
    } else {
      await this.loadWebApp(newWindow);
    }
    return newWindow;
  }

  async init(): Promise<void> {
    const icon = this.createAppIcon();
    if (process.platform === 'darwin' && !icon.isEmpty()) {
      app.dock?.setIcon(icon);
    }
    this.mainWindowState = windowStateKeeper({
      defaultWidth: DEFAULT_WINDOW_WIDTH,
      defaultHeight: DEFAULT_WINDOW_HEIGHT,
    });
    const safeMainWindowBounds = resolveSafeWindowBoundsBlock(this.mainWindowState, {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    });
    // Setup preload script path and construct our main window.
    const preloadPath = join(app.getAppPath(), 'build', 'src', 'preload.js');
    const mainWindow = new BrowserWindow({
      icon,
      show: false,
      ...safeMainWindowBounds,
      autoHideMenuBar: this.shouldHideNativeMenuBar(),
      ...this.getWindowChromeOptions(),
      webPreferences: {
        // See createWindow(): the renderer uses only the contextBridge API, so
        // Node integration stays off to shrink the blast radius of any
        // renderer-side script injection. Do not flip this back on.
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
        webviewTag: true,
        spellcheck: true,
      },
    });
    this.mainWindowState.manage(mainWindow);
    this.enforceRoundedRectangleWindow(mainWindow);
    this.applyMacWindowButtonVisibility(mainWindow);
    this.applyNativeMenuBarVisibility(mainWindow);
    this.windows = [mainWindow];
    this.registerAppWindowContextBlock(mainWindow, { isMainWindow: true });
    this.attachNativeContextMenu(mainWindow);
    setupWindowSwipeNavigation(mainWindow);

    if (this.CapacitorFileConfig.backgroundColor && this.shouldApplyConfiguredBackgroundColor()) {
      mainWindow.setBackgroundColor(this.CapacitorFileConfig.electron.backgroundColor);
    }

    // If we close the main window with the splashscreen enabled we need to destroy the ref.
    mainWindow.on('closed', () => {
      this.handleTrackedWindowClosedBlock(mainWindow);
      if (this.SplashScreen?.getSplashWindow() && !this.SplashScreen.getSplashWindow().isDestroyed()) {
        this.SplashScreen.getSplashWindow().close();
      }
    });

    // When the tray icon is enabled, setup the options.
    if (this.CapacitorFileConfig.electron?.trayIconAndMenuEnabled) {
      this.TrayIcon = new Tray(icon);
      this.TrayIcon.on('double-click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      });
      this.TrayIcon.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      });
      this.TrayIcon.setToolTip(app.getName());
      this.TrayIcon.setContextMenu(Menu.buildFromTemplate(this.TrayMenuTemplate));
    }

    // Setup the main menu bar at the top of our window.
    if (this.shouldHideNativeMenuBar()) {
      Menu.setApplicationMenu(null);
    } else {
      Menu.setApplicationMenu(Menu.buildFromTemplate(this.AppMenuBarMenuTemplate));
    }

    // If the splashscreen is enabled, show it first while the main window loads then switch it out for the main window, or just load the main window from the start.
    if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
      this.SplashScreen = new CapacitorSplashScreen({
        imageFilePath: join(
          app.getAppPath(),
          'assets',
          this.CapacitorFileConfig.electron?.splashScreenImageName ?? 'splash.png'
        ),
        windowWidth: 400,
        windowHeight: 400,
      });
      this.SplashScreen.init(this.loadMainWindow, this);
    } else {
      this.loadMainWindow(this);
    }

    // Security
    mainWindow.webContents.setWindowOpenHandler((details) => {
      if (isCustomSchemeUrlBlock(details.url, this.customScheme) || isTrustedPopupUrlBlock(details.url)) {
        return { action: 'allow' };
      }
      void shell.openExternal(details.url).catch(() => undefined);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, _newURL) => {
      const currentUrl = mainWindow.webContents.getURL();
      if (!currentUrl.includes(this.customScheme) && !this.isLiveSourceUrl(currentUrl)) {
        event.preventDefault();
      }
    });

    // Link electron plugins into the system.
    setupCapacitorElectronPlugins();

    // When the web app is loaded we hide the splashscreen if needed and show the mainwindow.
    mainWindow.webContents.on('dom-ready', () => {
      if (this.CapacitorFileConfig.electron?.splashScreenEnabled) {
        this.SplashScreen.getSplashWindow().hide();
      }
      if (!this.CapacitorFileConfig.electron?.hideMainWindowOnLaunch) {
        mainWindow.show();
      }
      setTimeout(() => {
        if (electronIsDev) {
          mainWindow.webContents.openDevTools();
        }
        CapElectronEventEmitter.emit('CAPELECTRON_DeeplinkListenerInitialized', '');
      }, 400);
    });
  }
}

// The partition used by all <webview> tags in the web tab.
// Must match LINK_WEBVIEW_PARTITION in UrlDocumentBlock.tsx.
const WEBVIEW_PARTITION = 'persist:thinking-space-links';
const WEBVIEW_ALLOWED_PERMISSIONS = new Set([
  'media',
  'mediaKeySystem',
  'notifications',
  'fullscreen',
  'pointerLock',
  'clipboard-read',
  'clipboard-write',
  'clipboard-sanitized-write',
]);
const configuredWebviewSessions = new WeakSet<Session>();

function configureWebviewSessionPermissions(targetSession: Session): void {
  if (configuredWebviewSessions.has(targetSession)) return;
  configuredWebviewSessions.add(targetSession);

  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    return WEBVIEW_ALLOWED_PERMISSIONS.has(permission);
  });

  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(WEBVIEW_ALLOWED_PERMISSIONS.has(permission));
  });
}

/**
 * Forward the native macOS 2-finger swipe gesture (left/right) to the
 * renderer so webviews can call goBack() / goForward().
 *
 * The 'swipe' event fires when "Swipe between pages" is enabled in
 * System Preferences → Trackpad → More Gestures (the macOS default).
 */
export function setupWindowSwipeNavigation(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  win.on('swipe', (_event, direction: string) => {
    if (direction === 'left' || direction === 'right') {
      win.webContents.send('webview:swipe', direction);
    }
  });
}

/**
 * Allow media-related permissions for webview sessions so that
 * sites like Spotify (which use EME/Widevine via the mediaKeySystem API) and
 * YouTube can play audio/video without silent permission denials.
 *
 * We allow: media, mediaKeySystem (DRM/EME), notifications, fullscreen, pointerLock.
 * We deny:  geolocation, camera, microphone, and anything else.
 */
/**
 * Create a popup BrowserWindow that shares the webview session so cookies
 * and auth carry over. Loads the URL directly — no nested webview needed.
 */
function createWebviewPopupWindowBlock(url: string): void {
  const popup = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      session: session.fromPartition(WEBVIEW_PARTITION),
      spellcheck: true,
    },
  });

  const cleanUa = popup.webContents.getUserAgent()
    .replace(/\s*Electron\/[\d.]+/g, '')
    .replace(/\s*Thinking Space\/[\d.]+/g, '')
    .trim();
  popup.webContents.setUserAgent(cleanUa);

  attachWebviewContextMenuBlock(popup.webContents);

  // Show the live URL in the window title so the user can see where they are.
  popup.setTitle(url);
  popup.webContents.on('did-navigate', (_e, newUrl) => { popup.setTitle(newUrl); });
  popup.webContents.on('did-navigate-in-page', (_e, newUrl, isMainFrame) => {
    if (isMainFrame) popup.setTitle(newUrl);
  });

  void popup.loadURL(url);
}

export function setupWebviewSessionPermissions(): void {
  configureWebviewSessionPermissions(session.fromPartition(WEBVIEW_PARTITION));

  app.on('web-contents-created', (_event, webContents) => {
    if (webContents.getType() !== 'webview') return;
    attachWebviewContextMenuBlock(webContents);
    configureWebviewSessionPermissions(webContents.session);

    // Deny Electron's automatic popup (which uses the wrong session) and
    // create our own BrowserWindow with the explicit webview session object.
    webContents.setWindowOpenHandler(({ url }) => {
      setImmediate(() => createWebviewPopupWindowBlock(url));
      return { action: 'deny' };
    });
  });
}

// Build the CSP from the declarative whitelist in `cspWhitelistBlock.ts`.
//
// The third-party hosts the renderer is allowed to talk to live in that
// registry — adding a new outbound origin should be a one-line append there,
// not an edit to this template. The template below only encodes infrastructure
// sources (the app's own scheme, `data:`, `blob:`, `'unsafe-inline'`, etc.) and
// the per-directive base shape.
export function setupContentSecurityPolicy(
  customScheme: string,
  opensourceAiBaseUrl: string | null = null,
): void {
  const userEntry = buildUserAiOriginEntryBlock(opensourceAiBaseUrl)
  const buildCsp = (isDev: boolean): string => {
    const opts: CspBuildOptionsBlock = {
      isDev,
      runtimeEntries: userEntry ? [userEntry] : [],
    }
    const directive = (name: CspDirective, base: string[]): string => {
      const extras = collectCspSourcesForDirectiveBlock(name, opts)
      return `${name} ${[...base, ...extras].join(' ')}`
    }
    const scheme = `${customScheme}://*`
    return [
      directive('default-src', [scheme, 'data:']),
      directive('script-src', [
        scheme,
        "'unsafe-inline'",
        ...(isDev ? ["'unsafe-eval'"] : []),
        "'wasm-unsafe-eval'",
      ]),
      directive('style-src', [scheme, "'unsafe-inline'"]),
      directive('img-src', [scheme, 'data:', 'blob:', 'https:']),
      directive('media-src', [scheme, 'data:', 'blob:', 'https:']),
      directive('connect-src', [scheme]),
      directive('frame-src', [scheme, 'blob:']),
    ].join('; ')
  }

  const devCsp = buildCsp(true)
  const prodCsp = buildCsp(false)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(`${customScheme}://`)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          electronIsDev ? devCsp : prodCsp,
        ],
      },
    });
  });
}
