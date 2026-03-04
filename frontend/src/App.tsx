import { Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  ChevronDown,
  Compass,
  FolderKanban,
  FileText,
  GitBranch,
  Loader2,
  Menu,
  MessageSquare,
  Eye,
  EyeOff,
  PanelLeft,
  PanelLeftClose,
  PlusSquare,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from 'lucide-react'
import treeOfLifeLogo from './assets/tree-of-life-logo.jpg'
import excalidrawLogo from './assets/excalidraw-logo.svg'
import Home from './pages/Home'
import ExcalidrawPlus from './pages/ExcalidrawPlus'
import FormatExcalidraw from './pages/FormatExcalidraw'
import ExcalidrawPlugin from './pages/ExcalidrawPlugin'
import MindmapBuilder from './pages/MindmapBuilder'
import PdfToMarkdown from './pages/PdfToMarkdown'
import GitInsights from './pages/GitInsights'
import TranscriptCleaner from './pages/TranscriptCleaner'
import NewThought from './pages/NewThought'
import ThinkingSpace from './pages/ThinkingSpace'
import ThinkingOrganizer from './pages/ThinkingOrganizer'
import Chat from './pages/Chat'
import CapabilityDiscovery from './pages/CapabilityDiscovery'
import ExtensionBuilder from './pages/ExtensionBuilder'
import Settings from './pages/Settings'
import F9Page from './personal_extension/pages/F9Page'
import VaultSetup from './components/orchestrators/VaultSetupOrch'
import AppTabsBlock, { type AppWorkspaceTabBlockModel } from './components/lego_blocks/units/AppTabsBlock'
import { Button } from './components/lego_blocks/units/ui/button'
import {
  EXCALIDRAW_PLUS_ROOT_ROUTE,
  EXCALIDRAW_PLUS_TOOL_ROUTES,
  isExcalidrawPlusRoute,
} from './components/lego_blocks/units/ExcalidrawPlusRoutesBlock'
import UniversalSearchBlock from './components/lego_blocks/integrations/UniversalSearchBlock'
import { UNIVERSAL_SEARCH_COMMAND_MODAL_PRESET_BLOCK } from './components/lego_blocks/integrations/universalSearchPresetBlock'
import { useUILayoutBlock } from './components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useUIThemeBlock } from './components/lego_blocks/units/UIThemeBlock'
import { deriveAdaptiveShellStateOrch } from './services/orchestrators/uiNavigationOrch'
import { isElectron, setVaultRoot } from './services/orchestrators/runtimeOrch'
import { fullSync, getLastSyncTimestamp, setLastSyncTimestamp, smartSync, type SyncResult } from './services/orchestrators/vaultSyncOrch'
import { getVaultPathKind, listMarkdownEntries } from './services/orchestrators/fileSystemOrch'
import { dispatchGlobalSyncRefreshBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import {
  gitCommitAllOrch,
  gitPushOrch,
  isGitSyncToolsSupportedOrch,
  readGitSyncStatusOrch,
} from '@/services/orchestrators/gitSyncToolsOrch'
import {
  STORAGE_KEYS,
  getActiveSpaceIdBlock,
  getJsonStorageItem,
  getStoredVaultRoot,
  getStorageItem,
  setJsonStorageItem,
  setStorageItem,
} from './services/orchestrators/storageOrch'
import { getCapabilityFeatureFlags } from './services/orchestrators/capabilityFeatureFlagsOrch'
import { isCapacitorNative, initBrowserVaultFS, setVaultFSInstance } from '@/services/lego_blocks/integrations/fsBlock'
import { getUIShellThemeProfileOrch } from './services/orchestrators/uiThemeOrch'
import { readUserProfileOrch } from './services/orchestrators/userProfileOrch'
import {
  listThinkingSpacesOrch,
  migrateThinkingSpaceRegistryOrch,
  registerThinkingSpaceOrch,
  type ThinkingSpaceRegistryEntryOrch,
} from './services/orchestrators/spaceRegistryOrch'
import {
  setExplorerFolderColorPreferencesOrch,
  type ExplorerFolderColorPreferenceBlock,
  readVaultUiPreferencesOrch,
  setExplorerIconStylePreferenceOrch,
  type ExplorerIconStyleBlock,
} from './services/orchestrators/vaultUiPreferencesOrch'
import {
  shouldCloseDrawerFromSwipeBlock,
  shouldIgnoreEdgeSwipeFromTargetBlock,
  shouldOpenDrawerFromSwipeBlock,
  shouldStartEdgeSwipeOpenBlock,
} from '@/services/lego_blocks/units/uiGestureBlock'
import {
  dispatchThinkingSpaceGoogleWorkspaceToggleExplorerBlock,
  dispatchThinkingSpaceGoogleWorkspaceToggleHeaderBlock,
  THINKING_SPACE_GOOGLE_WORKSPACE_CHROME_STATE_EVENT_BLOCK,
  type ThinkingSpaceGoogleWorkspaceChromeStateBlock,
} from '@/services/lego_blocks/units/thinkingSpaceGoogleWorkspaceChromeBlock'
import { sanitizeWorkspaceTabsForSpaceBlock } from '@/services/lego_blocks/units/spaceRouteSafetyBlock'

type NavIcon = ComponentType<{ className?: string }>

interface NavItem {
  to: string
  label: string
  icon: NavIcon
  activePaths?: string[]
}

interface CommandItem {
  to: string
  label: string
  group: 'Core' | 'Workspace' | 'Excalidraw++' | 'Files'
  activePaths?: string[]
  keywords?: string
  description?: string
}

interface AppWorkspaceTab {
  id: string
  route: string
}

interface PendingWorkspaceTabNavigation {
  tabId: string
  route: string
  sourceRoute: string
}

interface SyncRunSummary {
  mode: 'sync' | 'rebuild'
  finishedAt: number
  result?: SyncResult
  error?: string
}

interface GitActionSummary {
  mode: 'commit' | 'push'
  finishedAt: number
  message?: string
  error?: string
}

interface SyncPanelAnchor {
  top: number
  right: number
}

function formatSyncTimestamp(value: number | null): string {
  if (!value) return 'none yet'
  return new Date(value).toLocaleString()
}

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { to: '/thinking-space', label: 'Thinking Space', icon: Compass },
  { to: '/new-thought', label: 'New Note', icon: PlusSquare },
  { to: '/git-insights', label: 'Insights', icon: GitBranch },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/f9', label: 'F9', icon: F9NavIcon },
  {
    to: '/thinking-organizer',
    label: 'Thinking Organizer',
    icon: FolderKanban,
    activePaths: ['/file-organizer'],
  },
]

function ExcalidrawPlusIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-block`}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url(${excalidrawLogo})`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskImage: `url(${excalidrawLogo})`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}

function F9NavIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`${className} inline-flex items-center justify-center text-[10px] font-semibold leading-none tracking-tight`}>
      f9
    </span>
  )
}

const EXCALIDRAW_NAV_ITEM: NavItem = {
  to: EXCALIDRAW_PLUS_ROOT_ROUTE,
  label: 'Excalidraw++',
  icon: ExcalidrawPlusIcon,
  activePaths: EXCALIDRAW_PLUS_TOOL_ROUTES.flatMap(tool => [tool.route, tool.legacyRoute]),
}

function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.to) return true
  return (item.activePaths ?? []).includes(pathname)
}

function createWorkspaceTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readSidebarCollapsedFromStorageBlock(): boolean {
  const stored = getStorageItem(STORAGE_KEYS.appShellSidebarCollapsed)
  if (stored === null) return true
  return stored === '1'
}

function readWorkspaceTabsFromStorageBlock(currentRoute: string): AppWorkspaceTab[] {
  const savedTabs = getJsonStorageItem<AppWorkspaceTab[]>(STORAGE_KEYS.appShellTabs, [])
    .filter((candidate) => (
      !!candidate
      && typeof candidate.id === 'string'
      && typeof candidate.route === 'string'
      && candidate.id.trim().length > 0
      && candidate.route.trim().length > 0
    ))
    .slice(0, 24)
    .map((candidate) => ({
      id: candidate.id.trim(),
      route: normalizeTabRoute(candidate.route),
    }))

  if (savedTabs.length > 0) return savedTabs
  return [{ id: createWorkspaceTabId(), route: normalizeTabRoute(currentRoute) }]
}

function normalizeTabRoute(route: string): string {
  const trimmed = route.trim()
  if (!trimmed) return '/thinking-space'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function parseTabRoute(route: string): { pathname: string; search: URLSearchParams } {
  try {
    const parsed = new URL(normalizeTabRoute(route), 'https://ltm.local')
    return { pathname: parsed.pathname, search: parsed.searchParams }
  } catch {
    return { pathname: '/thinking-space', search: new URLSearchParams() }
  }
}

function buildPendingWorkspaceTabNavigation(
  tabId: string,
  route: string,
  sourceRoute: string,
): PendingWorkspaceTabNavigation {
  return {
    tabId,
    route: normalizeTabRoute(route),
    sourceRoute: normalizeTabRoute(sourceRoute),
  }
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getTabLabel(route: string, labelByPath: Map<string, string>): string {
  const { pathname, search } = parseTabRoute(route)
  if (pathname === '/thinking-space') {
    const filePath = search.get('file')?.trim()
    if (filePath) {
      const name = safeDecodeURIComponent(filePath).split('/').filter(Boolean).pop() || 'File'
      return `Space · ${name}`
    }
  }

  if (pathname === '/thinking-organizer' || pathname === '/file-organizer') {
    const tab = search.get('tab')?.trim()
    if (tab) return `Organizer · ${toTitleCase(tab)}`
  }

  return labelByPath.get(pathname) ?? 'Workspace'
}

function buildThinkingSpaceFileRoute(path: string): string {
  return `/thinking-space?file=${encodeURIComponent(path)}`
}

function escapeCssAttrValueBlock(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

function buildExplorerFolderColorCssBlock(rules: ExplorerFolderColorPreferenceBlock[]): string {
  if (!Array.isArray(rules) || rules.length === 0) return ''
  const blocks: string[] = []
  for (const rule of rules) {
    const path = rule.folderPath.trim()
    const color = rule.color.trim()
    if (!path || !color) continue
    const escapedPath = escapeCssAttrValueBlock(path)
    const selectors = [
      `.ltm-app-shell .ltm-explorer-folder-row[data-path="${escapedPath}"] .ltm-explorer-folder-icon`,
    ]
    if (rule.includeDescendants) {
      selectors.push(
        `.ltm-app-shell .ltm-explorer-folder-row[data-path^="${escapedPath}/"] .ltm-explorer-folder-icon`,
      )
    }
    blocks.push(`${selectors.join(',\n')} { color: ${color}; }`)
  }
  return blocks.join('\n')
}

function AppBrandGlyph({ className = 'h-[14px] w-[14px]' }: { className?: string }) {
  return (
    <img
      src={treeOfLifeLogo}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`${className} rounded-full object-cover`}
    />
  )
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const { layout } = useUILayoutBlock()
  const { themeId } = useUIThemeBlock()
  const shellThemeProfile = useMemo(() => getUIShellThemeProfileOrch(themeId), [themeId])
  const currentRoute = `${location.pathname}${location.search}${location.hash}`

  const featureFlags = getCapabilityFeatureFlags()
  const extensionBuilderEnabled = featureFlags.extension_host_enabled && featureFlags.extension_builder_enabled
  const gitSyncToolsSupported = useMemo(() => isGitSyncToolsSupportedOrch(), [])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedFromStorageBlock)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandFileItems, setCommandFileItems] = useState<CommandItem[]>([])
  const [commandFilesLastLoadedAt, setCommandFilesLastLoadedAt] = useState(0)
  const [explorerIconStyle, setExplorerIconStyle] = useState<ExplorerIconStyleBlock>('outline')
  const [explorerFolderColorRules, setExplorerFolderColorRules] = useState<ExplorerFolderColorPreferenceBlock[]>([])
  const [refreshRunning, setRefreshRunning] = useState(false)
  const [thinkingSpaceGoogleWorkspaceChromeState, setThinkingSpaceGoogleWorkspaceChromeState] = useState<ThinkingSpaceGoogleWorkspaceChromeStateBlock>({
    enabled: false,
    explorerCollapsed: false,
    headerVisible: true,
  })
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [syncActionRunning, setSyncActionRunning] = useState<'sync' | 'rebuild' | null>(null)
  const [gitActionRunning, setGitActionRunning] = useState<'commit' | 'push' | null>(null)
  const [syncToolsWidth, setSyncToolsWidth] = useState(96)
  const [topChromeMenuWidth, setTopChromeMenuWidth] = useState(0)
  const [syncPanelAnchor, setSyncPanelAnchor] = useState<SyncPanelAnchor>({ top: 52, right: 12 })
  const [lastSyncedAt, setLastSyncedAt] = useState(() => getLastSyncTimestamp())
  const [lastSyncAttemptAt, setLastSyncAttemptAt] = useState<number | null>(null)
  const [lastSyncSummary, setLastSyncSummary] = useState<SyncRunSummary | null>(null)
  const [lastGitCommitAt, setLastGitCommitAt] = useState<number | null>(null)
  const [lastGitPushAt, setLastGitPushAt] = useState<number | null>(null)
  const [lastGitActionSummary, setLastGitActionSummary] = useState<GitActionSummary | null>(null)
  const [gitCommitDialogOpen, setGitCommitDialogOpen] = useState(false)
  const [gitCommitMessageDraft, setGitCommitMessageDraft] = useState('')
  const commandInputRef = useRef<HTMLInputElement | null>(null)
  const gitCommitMessageInputRef = useRef<HTMLInputElement | null>(null)
  const currentRouteRef = useRef(currentRoute)
  const syncToolsRef = useRef<HTMLDivElement | null>(null)
  const topChromeMenuRef = useRef<HTMLDivElement | null>(null)
  const syncPanelRef = useRef<HTMLDivElement | null>(null)
  const syncToggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const scrollbarActivityTimeoutRef = useRef<number | null>(null)
  const pendingWorkspaceTabNavigationRef = useRef<PendingWorkspaceTabNavigation | null>(null)
  const drawerEdgeSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const drawerPanelSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const [activeSpaceId, setActiveSpaceId] = useState(() => getActiveSpaceIdBlock())
  const [registeredThinkingSpaces, setRegisteredThinkingSpaces] = useState<ThinkingSpaceRegistryEntryOrch[]>(
    () => listThinkingSpacesOrch(),
  )
  const [needsVaultSetup, setNeedsVaultSetup] = useState(() => {
    const stored = getStoredVaultRoot()
    if (!stored) return true
    // On Capacitor, reject stale absolute paths from older versions
    if (isCapacitorNative() && stored.startsWith('/')) return true
    return false
  })
  const [workspaceTabs, setWorkspaceTabs] = useState<AppWorkspaceTab[]>(
    () => readWorkspaceTabsFromStorageBlock(currentRoute),
  )
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState(
    () => getStorageItem(STORAGE_KEYS.appShellActiveTabId) ?? '',
  )
  const showGoogleWorkspaceChromeControls = location.pathname === '/thinking-space'
    && thinkingSpaceGoogleWorkspaceChromeState.enabled
  const canToggleGoogleWorkspaceHeader = showGoogleWorkspaceChromeControls
    && thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed

  const utilityNavItems = useMemo(() => {
    const items: NavItem[] = [
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/capabilities', label: 'Capabilities', icon: Bot },
    ]
    if (extensionBuilderEnabled) {
      items.splice(1, 0, { to: '/extension-builder', label: 'Extension Builder', icon: Sparkles })
    }
    return items
  }, [extensionBuilderEnabled])

  const baseCommandItems = useMemo<CommandItem[]>(() => ([
    { to: '/', label: 'Home', group: 'Core', keywords: 'dashboard start' },
    ...PRIMARY_NAV_ITEMS.map(item => ({
      to: item.to,
      label: item.label,
      group: 'Core' as const,
      activePaths: item.activePaths,
      keywords: (item.activePaths ?? []).join(' '),
    })),
    ...utilityNavItems.map(item => ({
      to: item.to,
      label: item.label,
      group: 'Workspace' as const,
      activePaths: item.activePaths,
    })),
    {
      to: EXCALIDRAW_NAV_ITEM.to,
      label: EXCALIDRAW_NAV_ITEM.label,
      group: 'Excalidraw++' as const,
      activePaths: EXCALIDRAW_NAV_ITEM.activePaths,
    },
    ...EXCALIDRAW_PLUS_TOOL_ROUTES.map(tool => ({
      to: tool.route,
      label: tool.label,
      group: 'Excalidraw++' as const,
      activePaths: [tool.legacyRoute],
    })),
  ]), [utilityNavItems])

  const allCommandItems = useMemo<CommandItem[]>(
    () => [...baseCommandItems, ...commandFileItems],
    [baseCommandItems, commandFileItems],
  )

  const routeLabelByPath = useMemo(() => {
    const entries = new Map<string, string>()
    entries.set('/', 'Home')
    entries.set('/file-organizer', 'Thinking Organizer')
    baseCommandItems.forEach((item) => {
      entries.set(item.to, item.label)
    })
    return entries
  }, [baseCommandItems])

  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find(tab => tab.id === activeWorkspaceTabId) ?? null,
    [activeWorkspaceTabId, workspaceTabs],
  )

  const workspaceTabItems = useMemo<AppWorkspaceTabBlockModel[]>(
    () => workspaceTabs.map(tab => ({
      id: tab.id,
      label: getTabLabel(tab.route, routeLabelByPath),
    })),
    [routeLabelByPath, workspaceTabs],
  )

  const shell = useMemo(() => deriveAdaptiveShellStateOrch(layout), [layout])
  const keyboardVisible = layout.keyboardVisible
  const forceCompactNavForIosKeyboard = layout.surface === 'capacitor-ios' && keyboardVisible
  const compactNav = shell.compactNav || forceCompactNavForIosKeyboard
  const showBottomNav = false
  const phoneMode = layout.mode === 'phone'
  const iPhoneMode = layout.surface === 'capacitor-ios' && phoneMode
  const isMacDesktopElectron = layout.surface === 'electron'
    && !phoneMode
    && typeof navigator !== 'undefined'
    && /mac/i.test(navigator.platform || navigator.userAgent || '')
  const iPhoneUserAgent = typeof navigator !== 'undefined' && /iPhone/i.test(navigator.userAgent || '')
  const iPhoneHandsetMode = phoneMode && (iPhoneMode || iPhoneUserAgent)
  const isCapacitorSurface = layout.surface === 'capacitor-ios' || layout.surface === 'capacitor-android'
  const showCapacitorTopChromeMenu = compactNav && !drawerOpen && isCapacitorSurface
  const topChromeMacTrafficLightInsetPx = showGoogleWorkspaceChromeControls && isMacDesktopElectron
    ? 64
    : 0
  const topChromeGoogleWorkspaceControlsWidth = showGoogleWorkspaceChromeControls
    ? (phoneMode ? 76 : 84 + topChromeMacTrafficLightInsetPx)
    : 0
  const topChromeLeftWidth = showCapacitorTopChromeMenu
    ? Math.max(phoneMode ? 42 : 96, topChromeMenuWidth, topChromeGoogleWorkspaceControlsWidth)
    : topChromeGoogleWorkspaceControlsWidth
  const topChromeRightWidth = Math.max(phoneMode ? 86 : 120, syncToolsWidth)
  const topChromeBalancedWidth = Math.max(120, topChromeLeftWidth, topChromeRightWidth)
  const topChromePaddingLeft = phoneMode ? topChromeLeftWidth : topChromeBalancedWidth
  const topChromePaddingRight = phoneMode ? topChromeRightWidth : topChromeBalancedWidth
  const topInset = shell.topInset
  const rightInset = shell.rightInset
  const bottomInset = shell.bottomInset
  const leftInset = shell.leftInset
  const drawerBottomInset = shell.drawerBottomInset
  const shouldUsePhoneSafeBottomPadding = layout.surface === 'capacitor-ios' && layout.mode === 'phone' && !keyboardVisible
  const mainBottomPadding = keyboardVisible
    ? Math.max(0, Math.round(layout.keyboardInset))
    : (shouldUsePhoneSafeBottomPadding ? Math.max(bottomInset, 14) : 0)
  const commandPaletteTopPadding = Math.max(80, topInset + 56)
  const commandPaletteBottomPadding = Math.max(16, bottomInset + 12)
  const compactDrawerBaseOffset = layout.surface === 'capacitor-ios' ? 24 : 16
  const compactDrawerTriggerBottom = Math.max(
    bottomInset + (showBottomNav ? 72 : compactDrawerBaseOffset),
    compactDrawerBaseOffset,
  )
  const compactDrawerTriggerLeft = Math.max(16, leftInset + 16)
  const excalidrawGroupActive = useMemo(
    () => isExcalidrawPlusRoute(location.pathname),
    [location.pathname],
  )
  const shellSafeAreaVars = useMemo<CSSProperties>(() => ({
    '--ltm-safe-top': `${topInset}px`,
    '--ltm-safe-right': `${rightInset}px`,
    '--ltm-safe-bottom': `${bottomInset}px`,
    '--ltm-safe-left': `${leftInset}px`,
  }) as CSSProperties, [bottomInset, leftInset, rightInset, topInset])
  const explorerFolderColorCss = useMemo(
    () => buildExplorerFolderColorCssBlock(explorerFolderColorRules),
    [explorerFolderColorRules],
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (!(viewportMeta instanceof HTMLMetaElement)) return
    const defaultViewport = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
    if (!iPhoneHandsetMode) {
      viewportMeta.setAttribute('content', defaultViewport)
      return
    }
    viewportMeta.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
    )
    return () => {
      viewportMeta.setAttribute('content', defaultViewport)
    }
  }, [iPhoneHandsetMode])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const isElectronDesktopSurface = layout.surface === 'electron' && layout.mode === 'desktop'
    if (!isElectronDesktopSurface) return

    const htmlElement = document.documentElement
    const bodyElement = document.body
    const rootElement = document.getElementById('root')
    const previousHtmlBackground = htmlElement.style.backgroundColor
    const previousBodyBackground = bodyElement.style.backgroundColor
    const previousRootBackground = rootElement?.style.backgroundColor ?? ''

    htmlElement.style.backgroundColor = 'transparent'
    bodyElement.style.backgroundColor = 'transparent'
    if (rootElement) rootElement.style.backgroundColor = 'transparent'

    return () => {
      htmlElement.style.backgroundColor = previousHtmlBackground
      bodyElement.style.backgroundColor = previousBodyBackground
      if (rootElement) rootElement.style.backgroundColor = previousRootBackground
    }
  }, [layout.mode, layout.surface])

  const openCommandPalette = useCallback(() => {
    setCommandQuery('')
    setCommandPaletteOpen(true)
  }, [])

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false)
  }, [])

  const ensureCommandFilesLoaded = useCallback(async () => {
    if (needsVaultSetup) return
    if (Date.now() - commandFilesLastLoadedAt < 20_000) return
    const entries = await listMarkdownEntries()
    const seen = new Set<string>()
    const fileItems: CommandItem[] = []
    for (const entry of entries) {
      const path = entry.path.trim()
      if (!path || seen.has(path)) continue
      seen.add(path)
      const fileName = path.split('/').pop() || path
      const label = fileName.replace(/\.md$/i, '')
      fileItems.push({
        to: buildThinkingSpaceFileRoute(path),
        label,
        description: path,
        group: 'Files',
        keywords: `file note markdown ${path}`,
      })
    }
    setCommandFileItems(fileItems)
    setCommandFilesLastLoadedAt(Date.now())
  }, [commandFilesLastLoadedAt, needsVaultSetup])

  const handleExplorerIconStyleChange = useCallback((nextStyle: ExplorerIconStyleBlock) => {
    setExplorerIconStyle(nextStyle)
    void setExplorerIconStylePreferenceOrch(nextStyle).catch((error) => {
      console.warn('[App] Failed to persist explorer icon style preference:', error)
    })
  }, [])

  const handleExplorerFolderColorRulesChange = useCallback(async (
    nextRules: ExplorerFolderColorPreferenceBlock[],
  ) => {
    setExplorerFolderColorRules(nextRules)
    try {
      await setExplorerFolderColorPreferencesOrch(nextRules)
    } catch (error) {
      console.warn('[App] Failed to persist explorer folder color rules:', error)
      throw error
    }
  }, [])

  const handleRequestVaultSwitch = useCallback(() => {
    setDrawerOpen(false)
    setCommandPaletteOpen(false)
    setNeedsVaultSetup(true)
  }, [])

  const handleSwitchThinkingSpace = useCallback((spaceId: string) => {
    const targetSpace = listThinkingSpacesOrch().find((entry) => entry.spaceId === spaceId)
    if (!targetSpace) return
    const registered = registerThinkingSpaceOrch(targetSpace.root, targetSpace.label)
    setVaultRoot(registered.root)
    setActiveSpaceId(registered.spaceId)
    setNeedsVaultSetup(false)
    setRegisteredThinkingSpaces(listThinkingSpacesOrch())
    setDrawerOpen(false)
    setCommandPaletteOpen(false)
  }, [])

  useEffect(() => {
    if (needsVaultSetup) return
    migrateThinkingSpaceRegistryOrch(getStoredVaultRoot())
    setRegisteredThinkingSpaces(listThinkingSpacesOrch())
  }, [needsVaultSetup])

  useEffect(() => {
    if (needsVaultSetup) return
    void readUserProfileOrch().catch((error) => {
      console.warn('[App] Failed to warm user profile cache:', error)
    })
  }, [needsVaultSetup])

  useEffect(() => {
    if (!needsVaultSetup || !isElectron()) return
    const persistedRoot = getStoredVaultRoot()?.trim()
    if (!persistedRoot) return
    const registered = registerThinkingSpaceOrch(persistedRoot)
    setVaultRoot(registered.root)
    setActiveSpaceId(registered.spaceId)
    setRegisteredThinkingSpaces(listThinkingSpacesOrch())
    setNeedsVaultSetup(false)
  }, [needsVaultSetup])

  useEffect(() => {
    currentRouteRef.current = currentRoute
  }, [currentRoute])

  useEffect(() => {
    if (needsVaultSetup) return

    let cancelled = false

    const resetShellForActiveSpace = async () => {
      setDrawerOpen(false)
      setCommandPaletteOpen(false)
      setCommandQuery('')
      setCommandFileItems([])
      setCommandFilesLastLoadedAt(0)
      setSidebarCollapsed(readSidebarCollapsedFromStorageBlock())
      setSyncPanelOpen(false)
      setSyncActionRunning(null)
      setGitActionRunning(null)
      setLastSyncedAt(getLastSyncTimestamp())
      setLastSyncAttemptAt(null)
      setLastSyncSummary(null)
      setLastGitActionSummary(null)

      const initialTabs = readWorkspaceTabsFromStorageBlock(currentRouteRef.current)
      const sanitizedTabs = await sanitizeWorkspaceTabsForSpaceBlock(initialTabs, {
        getVaultPathKind: (path) => getVaultPathKind(path),
      })
      if (cancelled) return

      setWorkspaceTabs(sanitizedTabs)
      const savedActiveTabId = getStorageItem(STORAGE_KEYS.appShellActiveTabId) ?? ''
      const resolvedActiveTabId = (
        sanitizedTabs.some((tab) => tab.id === savedActiveTabId)
          ? savedActiveTabId
          : sanitizedTabs[0]?.id
      ) ?? ''
      setActiveWorkspaceTabId(resolvedActiveTabId)

      const activeTabRoute = sanitizedTabs.find((tab) => tab.id === resolvedActiveTabId)?.route
      const targetRoute = activeTabRoute ? normalizeTabRoute(activeTabRoute) : '/thinking-space'
      const normalizedCurrentRoute = normalizeTabRoute(currentRouteRef.current)
      if (targetRoute !== normalizedCurrentRoute) {
        pendingWorkspaceTabNavigationRef.current = buildPendingWorkspaceTabNavigation(
          resolvedActiveTabId || (sanitizedTabs[0]?.id ?? ''),
          targetRoute,
          normalizedCurrentRoute,
        )
        navigate(targetRoute, { replace: true })
      } else {
        pendingWorkspaceTabNavigationRef.current = null
      }
    }

    void resetShellForActiveSpace()
    return () => {
      cancelled = true
    }
  }, [activeSpaceId, navigate, needsVaultSetup])

  useEffect(() => {
    if (needsVaultSetup) {
      setLastGitCommitAt(null)
      setLastGitPushAt(null)
      return
    }

    const root = getStoredVaultRoot()
    const status = readGitSyncStatusOrch(root)
    setLastGitCommitAt(status.lastCommitAt)
    setLastGitPushAt(status.lastPushAt)
  }, [needsVaultSetup])

  const handleGlobalRefresh = useCallback(() => {
    if (refreshRunning) return
    setRefreshRunning(true)
    dispatchGlobalSyncRefreshBlock({
      source: 'topbar',
      requestedAt: Date.now(),
      vaultSyncAttempted: false,
      vaultSyncSucceeded: false,
    })
    window.setTimeout(() => setRefreshRunning(false), 500)
  }, [refreshRunning])

  const updateSyncPanelAnchor = useCallback(() => {
    const trigger = syncToggleButtonRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setSyncPanelAnchor({
      top: Math.round(rect.bottom + 8),
      right: Math.max(10, Math.round(window.innerWidth - rect.right)),
    })
  }, [])

  useEffect(() => {
    const syncToolsNode = syncToolsRef.current
    if (!syncToolsNode) return

    const updateSyncToolsWidth = () => {
      setSyncToolsWidth(Math.ceil(syncToolsNode.getBoundingClientRect().width))
    }

    updateSyncToolsWidth()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateSyncToolsWidth())
      observer.observe(syncToolsNode)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateSyncToolsWidth)
    return () => window.removeEventListener('resize', updateSyncToolsWidth)
  }, [])

  useEffect(() => {
    if (!showCapacitorTopChromeMenu) {
      setTopChromeMenuWidth(0)
      return
    }

    const menuNode = topChromeMenuRef.current
    if (!menuNode) return

    const updateMenuWidth = () => {
      setTopChromeMenuWidth(Math.ceil(menuNode.getBoundingClientRect().width))
    }

    updateMenuWidth()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateMenuWidth())
      observer.observe(menuNode)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateMenuWidth)
    return () => window.removeEventListener('resize', updateMenuWidth)
  }, [showCapacitorTopChromeMenu])

  const runSyncAction = useCallback(async (mode: 'sync' | 'rebuild') => {
    if (needsVaultSetup || syncActionRunning) return
    setSyncActionRunning(mode)

    let syncSucceeded = false
    try {
      const result = mode === 'sync'
        ? await smartSync()
        : await fullSync()

      if (mode === 'rebuild') {
        if (result.errors.length === 0) {
          setLastSyncTimestamp()
        } else {
          setLastSyncTimestamp(0)
        }
      }

      setLastSyncedAt(getLastSyncTimestamp())
      setLastSyncAttemptAt(Date.now())
      setLastSyncSummary({
        mode,
        finishedAt: Date.now(),
        result,
      })
      syncSucceeded = result.errors.length === 0
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.'
      setLastSyncSummary({
        mode,
        finishedAt: Date.now(),
        error: message,
      })
      setLastSyncAttemptAt(Date.now())
      console.error('Vault sync action failed', error)
    } finally {
      dispatchGlobalSyncRefreshBlock({
        source: 'topbar',
        requestedAt: Date.now(),
        vaultSyncAttempted: true,
        vaultSyncSucceeded: syncSucceeded,
      })
      setSyncActionRunning(null)
    }
  }, [needsVaultSetup, syncActionRunning])

  const openGitCommitDialog = useCallback(() => {
    if (needsVaultSetup || gitActionRunning || !gitSyncToolsSupported) return
    setGitCommitMessageDraft(`chore: sync checkpoint ${new Date().toLocaleString()}`)
    setGitCommitDialogOpen(true)
  }, [gitActionRunning, gitSyncToolsSupported, needsVaultSetup])

  useEffect(() => {
    if (!gitCommitDialogOpen) return
    const timeout = window.setTimeout(() => {
      gitCommitMessageInputRef.current?.focus()
      gitCommitMessageInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [gitCommitDialogOpen])

  const runGitAction = useCallback(async (
    mode: 'commit' | 'push',
    commitMessageInput?: string | null,
  ) => {
    if (needsVaultSetup || gitActionRunning || !gitSyncToolsSupported) return

    let commitMessage: string | null = null
    if (mode === 'commit') {
      const trimmed = (commitMessageInput ?? '').trim()
      if (!trimmed) {
        setLastGitActionSummary({
          mode,
          finishedAt: Date.now(),
          error: 'Commit message cannot be empty.',
        })
        return
      }
      commitMessage = trimmed
    }

    setGitActionRunning(mode)
    setLastGitActionSummary(null)
    try {
      if (mode === 'commit') {
        if (!commitMessage) {
          throw new Error('Commit message cannot be empty.')
        }
        const result = await gitCommitAllOrch(commitMessage)
        if (result.committed) {
          setLastGitCommitAt(result.finishedAt)
        }
        setLastGitActionSummary({
          mode,
          finishedAt: result.finishedAt,
          message: result.message,
        })
        setGitCommitDialogOpen(false)
        return
      }

      const result = await gitPushOrch()
      setLastGitPushAt(result.finishedAt)
      setLastGitActionSummary({
        mode,
        finishedAt: result.finishedAt,
        message: result.message,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : `Git ${mode} failed.`
      setLastGitActionSummary({
        mode,
        finishedAt: Date.now(),
        error: message,
      })
      console.error(`Git ${mode} failed`, error)
    } finally {
      setGitActionRunning(null)
    }
  }, [gitActionRunning, gitSyncToolsSupported, needsVaultSetup])

  const runCommandItem = useCallback((item: CommandItem) => {
    setCommandPaletteOpen(false)
    setCommandQuery('')
    navigate(item.to)
  }, [navigate])

  const handleCreateWorkspaceTab = useCallback(() => {
    const tab: AppWorkspaceTab = {
      id: createWorkspaceTabId(),
      route: '/thinking-space',
    }
    pendingWorkspaceTabNavigationRef.current = buildPendingWorkspaceTabNavigation(
      tab.id,
      tab.route,
      currentRoute,
    )
    setWorkspaceTabs(prev => [...prev, tab])
    setActiveWorkspaceTabId(tab.id)
    navigate(tab.route)
  }, [currentRoute, navigate])

  const handleSelectWorkspaceTab = useCallback((tabId: string) => {
    if (tabId === activeWorkspaceTabId) return
    const target = workspaceTabs.find(tab => tab.id === tabId)
    if (!target) return
    if (target.route !== currentRoute) {
      pendingWorkspaceTabNavigationRef.current = buildPendingWorkspaceTabNavigation(
        tabId,
        target.route,
        currentRoute,
      )
    } else if (pendingWorkspaceTabNavigationRef.current?.tabId === tabId) {
      pendingWorkspaceTabNavigationRef.current = null
    }
    setActiveWorkspaceTabId(tabId)
    if (target.route !== currentRoute) {
      navigate(target.route)
    }
  }, [activeWorkspaceTabId, currentRoute, navigate, workspaceTabs])

  const handleCloseWorkspaceTab = useCallback((tabId: string) => {
    if (workspaceTabs.length <= 1) return
    if (pendingWorkspaceTabNavigationRef.current?.tabId === tabId) {
      pendingWorkspaceTabNavigationRef.current = null
    }
    const closeIndex = workspaceTabs.findIndex(tab => tab.id === tabId)
    if (closeIndex === -1) return
    const nextTabs = workspaceTabs.filter(tab => tab.id !== tabId)
    setWorkspaceTabs(nextTabs)
    if (tabId !== activeWorkspaceTabId) return
    const nextActive = nextTabs[Math.max(0, closeIndex - 1)] ?? nextTabs[0]
    if (!nextActive) return
    setActiveWorkspaceTabId(nextActive.id)
    if (nextActive.route !== currentRoute) {
      pendingWorkspaceTabNavigationRef.current = buildPendingWorkspaceTabNavigation(
        nextActive.id,
        nextActive.route,
        currentRoute,
      )
      navigate(nextActive.route)
    }
  }, [activeWorkspaceTabId, currentRoute, navigate, workspaceTabs])

  const handleDrawerTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    drawerPanelSwipeStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, [])

  const handleDrawerTouchMove = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const start = drawerPanelSwipeStartRef.current
    if (!start) return
    const touch = event.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (shouldCloseDrawerFromSwipeBlock(deltaX, deltaY)) {
      drawerPanelSwipeStartRef.current = null
      setDrawerOpen(false)
    }
  }, [])

  const handleDrawerTouchEnd = useCallback(() => {
    drawerPanelSwipeStartRef.current = null
  }, [])

  // On mount, restore security-scoped bookmark for picker-selected Capacitor vaults
  useEffect(() => {
    if (needsVaultSetup || !isCapacitorNative()) return
    const stored = getStoredVaultRoot()
    if (!stored?.startsWith('cap-picker:')) return

    import('@capacitor/core').then(({ registerPlugin }) => {
      const FolderPicker = registerPlugin<{
        restoreBookmark(): Promise<{ url: string; accessing: boolean }>
      }>('FolderPicker')
      FolderPicker.restoreBookmark().catch((err: unknown) => {
        console.warn('[App] Failed to restore bookmark, re-prompting vault setup:', err)
        setNeedsVaultSetup(true)
      })
    })
  }, [needsVaultSetup])

  // On mount, try to restore a persisted BrowserVaultFS handle
  useEffect(() => {
    if (needsVaultSetup || isElectron() || isCapacitorNative()) return
    const storedRoot = getStoredVaultRoot()
    if (storedRoot !== 'browser-fs') return

    initBrowserVaultFS()
      .then((fs) => {
        if (fs) {
          setVaultFSInstance(fs)
        } else {
          // Permission denied or handle lost — re-prompt
          setNeedsVaultSetup(true)
        }
      })
      .catch(() => {
        setNeedsVaultSetup(true)
      })
  }, [needsVaultSetup])

  useEffect(() => {
    setDrawerOpen(false)
    setCommandPaletteOpen(false)
  }, [currentRoute])

  useEffect(() => {
    if (!compactNav) {
      setDrawerOpen(false)
    }
  }, [compactNav])

  useEffect(() => {
    if (!compactNav || drawerOpen || keyboardVisible) {
      drawerEdgeSwipeStartRef.current = null
      return
    }

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      if (shouldIgnoreEdgeSwipeFromTargetBlock(event.target)) {
        drawerEdgeSwipeStartRef.current = null
        return
      }
      if (!shouldStartEdgeSwipeOpenBlock(touch.clientX)) return
      drawerEdgeSwipeStartRef.current = { x: touch.clientX, y: touch.clientY }
    }

    const handleTouchMove = (event: TouchEvent) => {
      const start = drawerEdgeSwipeStartRef.current
      if (!start) return
      const touch = event.touches[0]
      if (!touch) return
      const deltaX = touch.clientX - start.x
      const deltaY = touch.clientY - start.y
      if (shouldOpenDrawerFromSwipeBlock(deltaX, deltaY)) {
        drawerEdgeSwipeStartRef.current = null
        setDrawerOpen(true)
      }
    }

    const clearGesture = () => {
      drawerEdgeSwipeStartRef.current = null
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', clearGesture)
    window.addEventListener('touchcancel', clearGesture)

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', clearGesture)
      window.removeEventListener('touchcancel', clearGesture)
    }
  }, [compactNav, drawerOpen, keyboardVisible])

  useEffect(() => {
    if (keyboardVisible) {
      setDrawerOpen(false)
    }
  }, [keyboardVisible])

  useEffect(() => {
    setStorageItem(STORAGE_KEYS.appShellSidebarCollapsed, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!commandPaletteOpen) return
    setDrawerOpen(false)
    const handle = window.setTimeout(() => {
      commandInputRef.current?.focus()
      commandInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [commandPaletteOpen])

  useEffect(() => {
    if (!commandPaletteOpen) return
    if (needsVaultSetup) return
    let cancelled = false
    void ensureCommandFilesLoaded()
      .catch((error) => {
        if (!cancelled) {
          console.warn('[App] Failed to load command palette files:', error)
        }
      })
    return () => {
      cancelled = true
    }
  }, [commandPaletteOpen, ensureCommandFilesLoaded, needsVaultSetup])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const withMeta = event.metaKey || event.ctrlKey
      if (withMeta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandQuery('')
        setCommandPaletteOpen(true)
        return
      }
      if (withMeta && event.key.toLowerCase() === 't') {
        event.preventDefault()
        handleCreateWorkspaceTab()
        return
      }
      if (withMeta && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (activeWorkspaceTab) {
          handleCloseWorkspaceTab(activeWorkspaceTab.id)
        }
        return
      }
      if (withMeta && event.code === 'Backslash' && !compactNav) {
        event.preventDefault()
        setSidebarCollapsed(prev => !prev)
        return
      }
      if (event.key === 'Escape') {
        setCommandPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeWorkspaceTab, compactNav, handleCloseWorkspaceTab, handleCreateWorkspaceTab])

  useEffect(() => {
    if (needsVaultSetup) return
    smartSync()
      .then((result) => {
        setLastSyncedAt(getLastSyncTimestamp())
        setLastSyncAttemptAt(Date.now())
        setLastSyncSummary({
          mode: 'sync',
          finishedAt: Date.now(),
          result,
        })
      })
      .catch((err) => {
        setLastSyncAttemptAt(Date.now())
        setLastSyncSummary({
          mode: 'sync',
          finishedAt: Date.now(),
          error: err instanceof Error ? err.message : 'Sync failed.',
        })
        console.error('Failed to sync vault to IndexedDB cache', err)
      })
  }, [needsVaultSetup])

  useEffect(() => {
    if (!syncPanelOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (syncToolsRef.current?.contains(target)) return
      if (syncPanelRef.current?.contains(target)) return
      setSyncPanelOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [syncPanelOpen])

  useEffect(() => {
    if (!syncPanelOpen) return
    updateSyncPanelAnchor()
    const reposition = () => updateSyncPanelAnchor()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [syncPanelOpen, updateSyncPanelAnchor])

  useEffect(() => {
    if (needsVaultSetup) return
    let cancelled = false
    void readVaultUiPreferencesOrch()
      .then((preferences) => {
        if (cancelled) return
        setExplorerIconStyle(preferences.explorerIconStyle)
        setExplorerFolderColorRules(preferences.explorerFolderColorRules)
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[App] Failed to load vault UI preferences:', error)
        }
      })
    return () => {
      cancelled = true
    }
  }, [needsVaultSetup])

  useEffect(() => {
    if (workspaceTabs.length === 0) {
      const fallbackTab: AppWorkspaceTab = {
        id: createWorkspaceTabId(),
        route: normalizeTabRoute(currentRoute),
      }
      setWorkspaceTabs([fallbackTab])
      setActiveWorkspaceTabId(fallbackTab.id)
      return
    }
    if (activeWorkspaceTabId && workspaceTabs.some(tab => tab.id === activeWorkspaceTabId)) return
    const matchingRouteTab = workspaceTabs.find(tab => tab.route === normalizeTabRoute(currentRoute))
    setActiveWorkspaceTabId((matchingRouteTab ?? workspaceTabs[0]).id)
  }, [activeWorkspaceTabId, currentRoute, workspaceTabs])

  useEffect(() => {
    if (!activeWorkspaceTabId) return
    setWorkspaceTabs((prev) => {
      const index = prev.findIndex(tab => tab.id === activeWorkspaceTabId)
      if (index === -1) return prev
      const pending = pendingWorkspaceTabNavigationRef.current
      const normalizedCurrentRoute = normalizeTabRoute(currentRoute)
      if (pending) {
        if (activeWorkspaceTabId !== pending.tabId) return prev
        if (normalizedCurrentRoute !== pending.route) return prev
      }
      if (prev[index].route === normalizedCurrentRoute) return prev
      const next = prev.slice()
      next[index] = { ...next[index], route: normalizedCurrentRoute }
      return next
    })
  }, [activeWorkspaceTabId, currentRoute])

  useEffect(() => {
    const pending = pendingWorkspaceTabNavigationRef.current
    if (!pending) return
    if (activeWorkspaceTabId !== pending.tabId) {
      pendingWorkspaceTabNavigationRef.current = null
      return
    }
    if (!workspaceTabs.some(tab => tab.id === pending.tabId)) {
      pendingWorkspaceTabNavigationRef.current = null
      return
    }

    const normalizedCurrentRoute = normalizeTabRoute(currentRoute)
    if (normalizedCurrentRoute === pending.route) {
      pendingWorkspaceTabNavigationRef.current = null
      return
    }
    if (normalizedCurrentRoute !== pending.sourceRoute) {
      pendingWorkspaceTabNavigationRef.current = null
    }
  }, [activeWorkspaceTabId, currentRoute, workspaceTabs])

  useEffect(() => {
    setJsonStorageItem(STORAGE_KEYS.appShellTabs, workspaceTabs)
  }, [workspaceTabs])

  useEffect(() => {
    if (!activeWorkspaceTabId) return
    setStorageItem(STORAGE_KEYS.appShellActiveTabId, activeWorkspaceTabId)
  }, [activeWorkspaceTabId])

  useEffect(() => {
    const onOpenRouteInNewTab = (event: Event) => {
      const customEvent = event as CustomEvent<string>
      const route = normalizeTabRoute(customEvent.detail ?? '/thinking-space')
      const tab: AppWorkspaceTab = {
        id: createWorkspaceTabId(),
        route,
      }
      pendingWorkspaceTabNavigationRef.current = buildPendingWorkspaceTabNavigation(
        tab.id,
        route,
        currentRoute,
      )
      setWorkspaceTabs(prev => [...prev, tab])
      setActiveWorkspaceTabId(tab.id)
      navigate(route)
    }

    window.addEventListener('ltm:workspace-open-route-in-new-tab', onOpenRouteInNewTab as EventListener)
    return () => {
      window.removeEventListener('ltm:workspace-open-route-in-new-tab', onOpenRouteInNewTab as EventListener)
    }
  }, [currentRoute, navigate])

  useEffect(() => {
    const handleChromeState = (event: Event) => {
      const customEvent = event as CustomEvent<ThinkingSpaceGoogleWorkspaceChromeStateBlock>
      const detail = customEvent.detail
      if (!detail) return
      setThinkingSpaceGoogleWorkspaceChromeState({
        enabled: Boolean(detail.enabled),
        explorerCollapsed: Boolean(detail.explorerCollapsed),
        headerVisible: Boolean(detail.headerVisible),
      })
    }

    window.addEventListener(THINKING_SPACE_GOOGLE_WORKSPACE_CHROME_STATE_EVENT_BLOCK, handleChromeState as EventListener)
    return () => {
      window.removeEventListener(THINKING_SPACE_GOOGLE_WORKSPACE_CHROME_STATE_EVENT_BLOCK, handleChromeState as EventListener)
    }
  }, [])

  useEffect(() => {
    const appShellNode = appShellRef.current
    if (!appShellNode) return

    const clearScrollbarActivityTimeout = () => {
      if (scrollbarActivityTimeoutRef.current === null) return
      window.clearTimeout(scrollbarActivityTimeoutRef.current)
      scrollbarActivityTimeoutRef.current = null
    }

    const markScrollActivity = () => {
      appShellNode.classList.add('ltm-scrollbar-scrolling')
      clearScrollbarActivityTimeout()
      scrollbarActivityTimeoutRef.current = window.setTimeout(() => {
        appShellNode.classList.remove('ltm-scrollbar-scrolling')
        scrollbarActivityTimeoutRef.current = null
      }, 340)
    }

    appShellNode.addEventListener('scroll', markScrollActivity, { capture: true, passive: true })
    return () => {
      clearScrollbarActivityTimeout()
      appShellNode.classList.remove('ltm-scrollbar-scrolling')
      appShellNode.removeEventListener('scroll', markScrollActivity, true)
    }
  }, [])

  if (needsVaultSetup) {
    return (
      <VaultSetup
        onComplete={(vaultRoot) => {
          const registered = registerThinkingSpaceOrch(vaultRoot)
          setVaultRoot(registered.root)
          setActiveSpaceId(registered.spaceId)
          setRegisteredThinkingSpaces(listThinkingSpacesOrch())
          setNeedsVaultSetup(false)
        }}
      />
    )
  }

  return (
    <div
      ref={appShellRef}
      className="ltm-app-shell"
      style={shellSafeAreaVars}
      data-ltm-mode={layout.mode}
      data-ltm-surface={layout.surface}
      data-ltm-route={location.pathname}
      data-ltm-shell-material={shellThemeProfile.material}
      data-ltm-shell-motion={shellThemeProfile.motion}
      data-ltm-theme={themeId}
      data-ltm-explorer-icon-style={explorerIconStyle}
      data-ltm-ios-phone={iPhoneHandsetMode ? 'true' : 'false'}
      data-ltm-space-id={activeSpaceId}
    >
      {explorerFolderColorCss && <style>{explorerFolderColorCss}</style>}
      <div className="ltm-shell-layer-base">
        <div
          className="ltm-shell-stage"
          style={topInset ? { paddingTop: `calc(${topInset}px + var(--ltm-shell-inset))` } : undefined}
        >
        <section className="ltm-shell-main-stage">
          <header className="ltm-shell-top-chrome ltm-shell-motion-chrome relative">
            <div
              className={`absolute left-0 top-0 z-20 flex h-full items-center justify-start [-webkit-app-region:no-drag] ${
                iPhoneMode ? 'pl-2' : 'pl-0.5'
              }`}
              style={{ width: `${phoneMode ? topChromeLeftWidth : topChromeBalancedWidth}px` }}
            >
              {showCapacitorTopChromeMenu && (
                <div ref={topChromeMenuRef} className="inline-flex">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className={`ltm-mobile-drawer-trigger ltm-motion-fast ltm-shell-field-surface inline-flex h-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase tracking-[0.13em] text-foreground shadow-sm ${
                      phoneMode ? 'w-8 px-0' : 'min-w-[5.5rem] gap-1.5 px-3'
                    }`}
                    aria-label="Open navigation"
                  >
                    <Menu className="h-3 w-3" />
                    {!phoneMode && <span>Menu</span>}
                  </button>
                </div>
              )}

              {showGoogleWorkspaceChromeControls && (
                <div className={`inline-flex items-center gap-2 ${showCapacitorTopChromeMenu ? 'ml-2' : 'ml-1'} ${topChromeMacTrafficLightInsetPx > 0 ? 'pl-16' : ''}`}>
                  <button
                    type="button"
                    onClick={dispatchThinkingSpaceGoogleWorkspaceToggleExplorerBlock}
                    className="ltm-motion-fast inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/85 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed ? 'Show explorer' : 'Hide explorer'}
                    title={thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed ? 'Show explorer' : 'Hide explorer'}
                  >
                    {thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed
                      ? <PanelLeft className="h-3.5 w-3.5" />
                      : <PanelLeftClose className="h-3.5 w-3.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={dispatchThinkingSpaceGoogleWorkspaceToggleHeaderBlock}
                    disabled={!canToggleGoogleWorkspaceHeader}
                    className="ltm-motion-fast inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/85 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
                    aria-label={thinkingSpaceGoogleWorkspaceChromeState.headerVisible ? 'Hide document header' : 'Show document header'}
                    title={canToggleGoogleWorkspaceHeader
                      ? (thinkingSpaceGoogleWorkspaceChromeState.headerVisible ? 'Hide document header' : 'Show document header')
                      : 'Collapse explorer to toggle document header'}
                  >
                    {thinkingSpaceGoogleWorkspaceChromeState.headerVisible
                      ? <EyeOff className="h-3.5 w-3.5" />
                      : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>

            <div
              className="min-w-0 w-full"
              style={{
                paddingLeft: `${topChromePaddingLeft}px`,
                paddingRight: `${topChromePaddingRight}px`,
              }}
            >
              <AppTabsBlock
                tabs={workspaceTabItems}
                activeTabId={activeWorkspaceTabId}
                onSelectTab={handleSelectWorkspaceTab}
                onCreateTab={handleCreateWorkspaceTab}
                onCloseTab={handleCloseWorkspaceTab}
                className="ltm-shell-top-tab-capsule"
              />
            </div>

            <div
              className={`absolute top-0 z-20 flex h-full items-center justify-end gap-2 [-webkit-app-region:no-drag] ${
                iPhoneMode ? 'right-1' : 'right-8'
              }`}
              style={{ width: `${phoneMode ? topChromeRightWidth : topChromeBalancedWidth}px` }}
            >
              <div ref={syncToolsRef} className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGlobalRefresh}
                  disabled={refreshRunning || needsVaultSetup}
                  className={`ltm-motion-fast inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background/85 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 ${
                    phoneMode ? 'w-8 px-0' : 'px-3'
                  }`}
                  aria-label="Refresh current workspace"
                  title="Refresh current workspace"
                >
                  {refreshRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {!phoneMode && <span className="hidden lg:inline">Refresh</span>}
                </button>

                <button
                  type="button"
                  ref={syncToggleButtonRef}
                  onClick={() => {
                    updateSyncPanelAnchor()
                    setSyncPanelOpen(prev => !prev)
                  }}
                  className={`ltm-motion-fast inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background/85 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground ${
                    phoneMode ? 'w-8 px-0' : 'px-3'
                  }`}
                  aria-label="Toggle sync tools"
                  title="Toggle sync tools"
                >
                  {!phoneMode && <span className="hidden lg:inline">Sync Tools</span>}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${syncPanelOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
          </header>
          <div className="ltm-shell-body-stage">
            {!compactNav && (
              <aside className={`ltm-shell-sidebar ltm-shell-nav-surface hidden shrink-0 transition-[width] duration-200 lg:block ${
                sidebarCollapsed ? 'ltm-sidebar-collapsed' : 'ltm-sidebar-expanded'
              } ${
                sidebarCollapsed ? 'w-16' : 'w-64'
              }`} data-ltm-nav-region="rail">
                <div className={`flex h-full flex-col py-3 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
                <div className="ltm-nav-scroll ltm-sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-1">
                    {!sidebarCollapsed && (
                      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Core
                      </div>
                    )}
                    {PRIMARY_NAV_ITEMS.map((item) => {
                      const Icon = item.icon
                      const active = isNavItemActive(location.pathname, item)
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          title={sidebarCollapsed ? item.label : undefined}
                          className={`ltm-motion-fast ltm-touch-row flex items-center rounded-lg py-2 text-sm transition-colors ${
                            sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-2.5'
                          } ${
                            active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                        </Link>
                      )
                    })}
                  </div>

                  <div className="mt-5 space-y-1">
                    {!sidebarCollapsed && (
                      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Workspace
                      </div>
                    )}
                    {utilityNavItems.map((item) => {
                      const Icon = item.icon
                      const active = isNavItemActive(location.pathname, item)
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          title={sidebarCollapsed ? item.label : undefined}
                          className={`ltm-motion-fast ltm-touch-row flex items-center rounded-lg py-2 text-sm transition-colors ${
                            sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-2.5'
                          } ${
                            active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                        </Link>
                      )
                    })}
                  </div>

                  <div className="mt-5 space-y-1">
                    {!sidebarCollapsed && (
                      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Excalidraw++
                      </div>
                    )}
                    {sidebarCollapsed ? (
                      <Link
                        to={EXCALIDRAW_NAV_ITEM.to}
                        title="Excalidraw++"
                        className={`ltm-motion-fast ltm-touch-row flex items-center justify-center rounded-lg px-2 py-2 text-sm transition-colors ${
                          excalidrawGroupActive
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <ExcalidrawPlusIcon className="h-4 w-4" />
                      </Link>
                    ) : (
                      <Link
                        to={EXCALIDRAW_NAV_ITEM.to}
                        className={`ltm-motion-fast ltm-touch-row flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          excalidrawGroupActive
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <ExcalidrawPlusIcon className="h-4 w-4" />
                        <span className="flex-1 truncate text-left">Excalidraw++</span>
                      </Link>
                    )}
                  </div>
                </div>

                <div className="ltm-sidebar-actions space-y-2">
                  <button
                    type="button"
                    onClick={openCommandPalette}
                    className={`ltm-shell-action ltm-shell-nav-action ltm-motion-fast ltm-touch-row inline-flex w-full items-center rounded-lg py-2 text-sm text-muted-foreground transition-colors hover:text-foreground ${
                      sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-2.5'
                    }`}
                    aria-label="Open quick search"
                  >
                    <Search className="h-4 w-4" />
                    {!sidebarCollapsed && <span className="ltm-shell-action-label truncate">Search</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(prev => !prev)}
                    className={`ltm-shell-action ltm-shell-nav-action ltm-motion-fast ltm-touch-row inline-flex w-full items-center rounded-lg py-2 text-sm text-muted-foreground transition-colors hover:text-foreground ${
                      sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-2.5'
                    }`}
                    title={sidebarCollapsed ? 'Expand sidebar (Cmd/Ctrl+\\)' : 'Collapse sidebar (Cmd/Ctrl+\\)'}
                    aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  >
                    {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    {!sidebarCollapsed && <span className="ltm-shell-action-label truncate">{sidebarCollapsed ? 'Expand drawer' : 'Collapse drawer'}</span>}
                  </button>

                  <Link
                    to="/"
                    title={sidebarCollapsed ? 'Home' : undefined}
                    aria-label="Home"
                    className={`ltm-shell-logo ltm-motion-fast mt-2 inline-flex items-center rounded-lg ${
                      sidebarCollapsed
                        ? 'h-10 w-full justify-center'
                        : 'gap-2 px-2.5 py-2 text-sm font-semibold tracking-tight'
                    }`}
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full">
                      <AppBrandGlyph className="h-full w-full" />
                    </span>
                    {!sidebarCollapsed && <span>Home</span>}
                  </Link>
                </div>
                </div>
              </aside>
            )}
          <main
            className="ltm-app-main ltm-shell-main ltm-shell-content-stage"
            style={mainBottomPadding ? { paddingBottom: `${mainBottomPadding}px` } : undefined}
          >
            <Routes key={activeSpaceId}>
              <Route path="/" element={<Home />} />
              <Route path="/thinking-space" element={<ThinkingSpace />} />
              <Route path="/thinking-organizer" element={<ThinkingOrganizer />} />
              <Route path="/file-organizer" element={<ThinkingOrganizer />} />
              <Route path="/excalidraw-plus" element={<ExcalidrawPlus />}>
                <Route index element={<Navigate to="plugin" replace />} />
                <Route path="plugin" element={<ExcalidrawPlugin />} />
                <Route path="format" element={<FormatExcalidraw />} />
                <Route path="mindmap" element={<MindmapBuilder />} />
                <Route path="pdf" element={<PdfToMarkdown />} />
                <Route path="transcript" element={<TranscriptCleaner />} />
              </Route>
              <Route path="/excalidraw-plugin" element={<Navigate to="/excalidraw-plus/plugin" replace />} />
              <Route path="/format-excalidraw" element={<Navigate to="/excalidraw-plus/format" replace />} />
              <Route path="/mindmap-builder" element={<Navigate to="/excalidraw-plus/mindmap" replace />} />
              <Route path="/pdf-to-markdown" element={<Navigate to="/excalidraw-plus/pdf" replace />} />
              <Route path="/transcript-cleaner" element={<Navigate to="/excalidraw-plus/transcript" replace />} />
              <Route path="/git-insights" element={<GitInsights />} />
              <Route path="/new-thought" element={<NewThought />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/f9" element={<F9Page />} />
              <Route path="/personal-extension" element={<Navigate to="/f9" replace />} />
              <Route
                path="/settings"
                element={
                  <Settings
                    explorerIconStyle={explorerIconStyle}
                    onExplorerIconStyleChange={handleExplorerIconStyleChange}
                    explorerFolderColorRules={explorerFolderColorRules}
                    onExplorerFolderColorRulesChange={handleExplorerFolderColorRulesChange}
                    onRequestVaultSwitch={handleRequestVaultSwitch}
                    activeSpaceId={activeSpaceId}
                    thinkingSpaces={registeredThinkingSpaces}
                    onSwitchThinkingSpace={handleSwitchThinkingSpace}
                  />
                }
              />
              <Route path="/ai-settings" element={<Navigate to="/settings?tab=ai" replace />} />
              <Route
                path="/extension-builder"
                element={extensionBuilderEnabled ? <ExtensionBuilder /> : <Navigate to="/capabilities" replace />}
              />
              <Route path="/capabilities" element={<CapabilityDiscovery />} />
            </Routes>
          </main>
          </div>
          </section>
        </div>
      </div>

      {compactNav && !drawerOpen && !isCapacitorSurface && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="ltm-mobile-drawer-trigger ltm-motion-fast ltm-shell-fab-surface ltm-touch-target fixed z-30 inline-flex h-11 w-11 items-center justify-center rounded-full p-0 text-foreground shadow-lg"
          style={{ bottom: `${compactDrawerTriggerBottom}px`, left: `${compactDrawerTriggerLeft}px` }}
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      {compactNav && drawerOpen && (
        <>
          <div
            className="ltm-mobile-drawer-overlay ltm-shell-motion-overlay fixed inset-0 z-40 bg-background/65 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="ltm-mobile-drawer ltm-shell-mobile-drawer ltm-shell-drawer-surface ltm-shell-motion-drawer fixed inset-y-0 left-0 z-50 flex flex-col"
            onTouchStart={handleDrawerTouchStart}
            onTouchMove={handleDrawerTouchMove}
            onTouchEnd={handleDrawerTouchEnd}
            onTouchCancel={handleDrawerTouchEnd}
          >
            <div className="ltm-mobile-drawer-header ltm-shell-segment-header flex h-14 items-center justify-between px-3">
              <Link
                to="/"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full">
                  <AppBrandGlyph />
                </span>
                Home
              </Link>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="ltm-shell-action ltm-touch-target inline-flex h-8 w-8 items-center justify-center rounded-md"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className="ltm-mobile-drawer-content flex min-h-0 flex-1 flex-col p-3"
              style={drawerBottomInset ? { paddingBottom: `${drawerBottomInset + 12}px` } : undefined}
            >
              <div className="ltm-nav-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-1">
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Core
                  </div>
                  {PRIMARY_NAV_ITEMS.map((item) => {
                    const Icon = item.icon
                    const active = isNavItemActive(location.pathname, item)
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setDrawerOpen(false)}
                        className={`ltm-motion-fast ltm-touch-row flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>

                <div className="mt-5 space-y-1">
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Workspace
                  </div>
                  {utilityNavItems.map((item) => {
                    const Icon = item.icon
                    const active = isNavItemActive(location.pathname, item)
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setDrawerOpen(false)}
                        className={`ltm-motion-fast ltm-touch-row flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>

                <div className="mt-5 space-y-1">
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Excalidraw++
                  </div>
                  <Link
                    to={EXCALIDRAW_NAV_ITEM.to}
                    onClick={() => setDrawerOpen(false)}
                    className={`ltm-motion-fast ltm-touch-row flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      excalidrawGroupActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <ExcalidrawPlusIcon className="h-4 w-4" />
                    <span className="truncate">Excalidraw++</span>
                  </Link>
                </div>
              </div>

              <div className="ltm-shell-segment-footer mt-3 space-y-2 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false)
                    openCommandPalette()
                  }}
                  className="ltm-shell-action ltm-motion-fast ltm-touch-row inline-flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Open quick search"
                >
                  <Search className="h-4 w-4" />
                  <span className="truncate">Search</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="ltm-shell-action ltm-motion-fast ltm-touch-row inline-flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Collapse drawer"
                >
                  <X className="h-4 w-4" />
                  <span className="truncate">Collapse drawer</span>
                </button>
              </div>
            </div>
          </aside>
        </>
      )}

      {syncPanelOpen && createPortal(
        <div
          ref={syncPanelRef}
          className="fixed z-[80] w-[380px] rounded-xl bg-white p-3 text-sm text-slate-900 shadow-lg [-webkit-app-region:no-drag]"
          style={{
            top: `${syncPanelAnchor.top}px`,
            right: `${syncPanelAnchor.right}px`,
            backgroundColor: '#ffffff',
            opacity: 1,
            filter: 'none',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
            mixBlendMode: 'normal',
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Sync Tools</p>
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!!syncActionRunning || !!gitActionRunning || needsVaultSetup}
                className="w-full justify-start border-transparent bg-white text-slate-900 hover:bg-slate-50 disabled:border-transparent disabled:bg-white disabled:text-slate-500"
                onClick={() => { void runSyncAction('sync') }}
              >
                {syncActionRunning === 'sync' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Sync Folder
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!!syncActionRunning || !!gitActionRunning || needsVaultSetup}
                className="w-full justify-start border-transparent bg-white text-slate-900 hover:bg-slate-50 disabled:border-transparent disabled:bg-white disabled:text-slate-500"
                onClick={() => { void runSyncAction('rebuild') }}
              >
                {syncActionRunning === 'rebuild' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Rebuild Index + Cache
              </Button>

              <div className="rounded-lg bg-white p-2 text-[11px]">
                <p className="text-slate-600">Sync Folder Root</p>
                <p className="truncate font-mono text-slate-900">
                  {(() => {
                    const root = getStoredVaultRoot() || ''
                    if (!root) return 'Not configured'
                    if (root === 'web-backend') return 'web-backend (browser backend)'
                    return root
                  })()}
                </p>
                <p className="mt-1 text-slate-600">
                  Last Successful Sync:{' '}
                  <span className="text-slate-900">
                    {lastSyncedAt
                      ? new Date(lastSyncedAt * 1000).toLocaleString()
                      : (lastSyncSummary?.result?.errors.length ?? 0) > 0
                        ? 'No successful sync yet (latest sync had errors)'
                        : 'No successful sync yet'}
                  </span>
                </p>
                <p className="text-slate-600">
                  Last Sync Attempt: <span className="text-slate-900">{formatSyncTimestamp(lastSyncAttemptAt)}</span>
                </p>
                {lastSyncSummary && (
                  <>
                    <p className="mt-1 text-slate-600">
                      Last Action: <span className="text-slate-900">{lastSyncSummary.mode === 'sync' ? 'Sync Folder' : 'Rebuild Index + Cache'}</span>
                    </p>
                    {lastSyncSummary.result ? (
                      <>
                        <p className="text-slate-600">
                          Files: <span className="text-slate-900">{lastSyncSummary.result.totalFiles}</span> · Parsed:{' '}
                          <span className="text-slate-900">{lastSyncSummary.result.parsedNodes}</span> · Errors:{' '}
                          <span className="text-slate-900">{lastSyncSummary.result.errors.length}</span>
                        </p>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="my-1 h-px bg-slate-200" />

            <div className="space-y-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!!syncActionRunning || !!gitActionRunning || needsVaultSetup || !gitSyncToolsSupported}
                className="w-full justify-start border-transparent bg-white text-slate-900 hover:bg-slate-50 disabled:border-transparent disabled:bg-white disabled:text-slate-500"
                onClick={openGitCommitDialog}
              >
                {gitActionRunning === 'commit' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Git Commit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!!syncActionRunning || !!gitActionRunning || needsVaultSetup || !gitSyncToolsSupported}
                className="w-full justify-start border-transparent bg-white text-slate-900 hover:bg-slate-50 disabled:border-transparent disabled:bg-white disabled:text-slate-500"
                onClick={() => { void runGitAction('push') }}
              >
                {gitActionRunning === 'push' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Git Push
              </Button>
              {!gitSyncToolsSupported && (
                <p className="px-1 text-[11px] text-slate-600">Git only supported in Electron desktop app.</p>
              )}

              <div className="rounded-lg bg-white p-2 text-[11px]">
                <p className="text-slate-600">
                  Last Git Commit: <span className="text-slate-900">{formatSyncTimestamp(lastGitCommitAt)}</span>
                </p>
                <p className="text-slate-600">
                  Last Git Push: <span className="text-slate-900">{formatSyncTimestamp(lastGitPushAt)}</span>
                </p>
                {lastGitActionSummary && (
                  <p className="mt-1 text-slate-600">
                    Last Git Action:{' '}
                    <span className="text-slate-900">
                      {lastGitActionSummary.mode === 'commit' ? 'Commit' : 'Push'}
                    </span>
                    {' · '}
                    <span className="text-slate-900">
                      {formatSyncTimestamp(lastGitActionSummary.finishedAt)}
                    </span>
                    {lastGitActionSummary.message ? (
                      <>
                        {' · '}
                        <span>{lastGitActionSummary.message}</span>
                      </>
                    ) : null}
                  </p>
                )}
              </div>
            </div>

            {(() => {
              const syncActionError = lastSyncSummary?.error?.trim()
              const syncEntryErrors = lastSyncSummary?.result?.errors ?? []
              const gitError = lastGitActionSummary?.error?.trim()
              const hasAnyError = Boolean(syncActionError || gitError || syncEntryErrors.length > 0)
              if (!hasAnyError) return null

              return (
                <div className="rounded-md bg-red-50 p-2 text-[10px] text-red-700">
                  {(syncActionError || syncEntryErrors.length > 0) && (
                    <div>
                      <p className="font-semibold uppercase tracking-[0.12em]">Sync Errors</p>
                      <div className="mt-1 space-y-1">
                        {syncActionError ? <p>{syncActionError}</p> : null}
                        {syncEntryErrors.slice(0, 5).map((entry, idx) => (
                          <p key={`${entry.path}-${idx}`} className="leading-tight">
                            <span className="font-mono">{entry.path}</span>: {entry.error}
                          </p>
                        ))}
                        {syncEntryErrors.length > 5 ? (
                          <p>+{syncEntryErrors.length - 5} more sync errors</p>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {gitError && (
                    <div className="mt-2">
                      <p className="font-semibold uppercase tracking-[0.12em]">Git Errors</p>
                      <div className="mt-1 space-y-1">
                        <p>{gitError}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>,
        document.body,
      )}

      {commandPaletteOpen && (
        <>
          <div
            className="ltm-cmd-overlay ltm-shell-motion-overlay fixed inset-0 z-50 bg-background/70"
            onClick={closeCommandPalette}
          />
          <div
            className="fixed inset-0 z-[60] flex items-start justify-center p-3 sm:p-4"
            data-ltm-shell-region="command-stage"
            style={{ paddingTop: `${commandPaletteTopPadding}px`, paddingBottom: `${commandPaletteBottomPadding}px` }}
          >
            <div className="ltm-cmd-card ltm-shell-command-card ltm-shell-command-surface ltm-shell-motion-modal max-h-full w-full max-w-3xl overflow-hidden rounded-2xl">
              <div className="p-3">
                <UniversalSearchBlock
                  {...UNIVERSAL_SEARCH_COMMAND_MODAL_PRESET_BLOCK}
                  items={allCommandItems}
                  query={commandQuery}
                  onQueryChange={setCommandQuery}
                  onSelect={runCommandItem}
                  getItemKey={item => `${item.group}:${item.to}`}
                  getItemLabel={item => item.label}
                  getItemDescription={item => item.description}
                  getItemSearchCandidates={(item) => [
                    item.label,
                    item.description ?? '',
                    item.to,
                    item.group,
                    item.keywords ?? '',
                  ]}
                  placeholder="Jump to a page or file..."
                  open
                  onEscapeKeyDown={closeCommandPalette}
                  inputRef={commandInputRef}
                  itemClassName={(item) => {
                    const active = isNavItemActive(location.pathname, {
                      to: item.to,
                      label: item.label,
                      icon: Sparkles,
                      activePaths: item.activePaths,
                    })
                    return active
                      ? 'rounded-lg !bg-foreground !text-background'
                      : 'rounded-lg hover:bg-muted'
                  }}
                  renderItem={(item) => {
                    const active = isNavItemActive(location.pathname, {
                      to: item.to,
                      label: item.label,
                      icon: Sparkles,
                      activePaths: item.activePaths,
                    })
                    return (
                      <div className="ltm-motion-fast ltm-touch-row flex w-full items-center justify-between rounded-lg px-0 py-0 text-left text-sm transition-colors">
                        <div className="min-w-0">
                          <div className="truncate">{item.label}</div>
                          {item.description && (
                            <div className={`mt-0.5 truncate text-[11px] ${active ? 'text-background/80' : 'text-muted-foreground'}`}>
                              {item.description}
                            </div>
                          )}
                        </div>
                        <div className={`ml-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] ${active ? 'text-background/80' : 'text-muted-foreground'}`}>
                          {item.group === 'Files' ? <FileText className="h-3 w-3" /> : null}
                          <span>{item.group}</span>
                        </div>
                      </div>
                    )
                  }}
                />
              </div>
              <div className="ltm-shell-segment-footer px-3 py-2 text-[11px] text-muted-foreground">
                Enter to open first result · Esc to close · Cmd/Ctrl+K to reopen
              </div>
            </div>
          </div>
        </>
      )}

      {gitCommitDialogOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-background/60"
            onClick={() => {
              if (gitActionRunning) return
              setGitCommitDialogOpen(false)
            }}
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <form
              className="w-full max-w-lg rounded-2xl border border-border/70 bg-background p-4 shadow-xl"
              onSubmit={(event) => {
                event.preventDefault()
                void runGitAction('commit', gitCommitMessageDraft)
              }}
            >
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Git Commit</h3>
                <p className="text-xs text-muted-foreground">
                  Enter a commit message for all pending changes in the current vault.
                </p>
              </div>
              <div className="mt-3">
                <input
                  ref={gitCommitMessageInputRef}
                  type="text"
                  value={gitCommitMessageDraft}
                  onChange={(event) => setGitCommitMessageDraft(event.target.value)}
                  disabled={gitActionRunning === 'commit'}
                  placeholder="Commit message"
                  className="h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={gitActionRunning === 'commit'}
                  onClick={() => setGitCommitDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={gitActionRunning === 'commit'}
                >
                  {gitActionRunning === 'commit' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Commit
                </Button>
              </div>
            </form>
          </div>
        </>
      )}

    </div>
  )
}

export default App
