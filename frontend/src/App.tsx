import { Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Bug,
  MoreHorizontal,
  Compass,
  FileText,
  Loader2,
  Menu,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react'
import {
  MagnifyingGlass as PhosphorMagnifyingGlass,
  TreeView as PhosphorTreeView,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'
import treeOfLifeLogo from './assets/tree-of-life-logo.jpg'
import excalidrawLogo from './assets/excalidraw-logo.svg'
// Core pages — eagerly loaded (used on every session)
import Home from './pages/Home'
import HomeCanvas from './pages/HomeCanvas'
import NewThought from './pages/NewThought'
import ThinkingSpace from './pages/ThinkingSpace'
import ThinkingOrganizer from './pages/ThinkingOrganizer'
import Chat from './pages/Chat'
import Schedules from './pages/Schedules'
import Web from './pages/Web'
import Settings from './pages/Settings'

// Heavy / rarely-used pages — lazy loaded (code-split into separate chunks)
const ExcalidrawPlus = lazy(() => import('./pages/ExcalidrawPlus'))
const FormatExcalidraw = lazy(() => import('./pages/FormatExcalidraw'))
const ExcalidrawPlugin = lazy(() => import('./pages/ExcalidrawPlugin'))
const MindmapBuilder = lazy(() => import('./pages/MindmapBuilder'))
const PdfToMarkdown = lazy(() => import('./pages/PdfToMarkdown'))
const GitInsights = lazy(() => import('./pages/GitInsights'))
const VaultGraph = lazy(() => import('./pages/VaultGraph'))
const TranscriptCleaner = lazy(() => import('./pages/TranscriptCleaner'))
const CapabilityDiscovery = lazy(() => import('./pages/CapabilityDiscovery'))
const ExtensionBuilder = lazy(() => import('./pages/ExtensionBuilder'))
const PasswordManager = lazy(() => import('./pages/PasswordManager'))
const TerminalPage = lazy(() => import('./pages/TerminalPage'))
const WebullPage = lazy(() => import('./personal_extension/pages/WebullPage'))
const PersonalToolsPage = lazy(() => import('./personal_extension/pages/PersonalToolsPage'))
const StewardQueueOrch = lazy(() => import('./components/orchestrators/StewardQueueOrch'))
const OrganizerIntegrityOrch = lazy(() => import('./components/orchestrators/OrganizerIntegrityOrch'))
import ToolsShellBlock, { isToolsShellRoute } from './components/lego_blocks/integrations/ToolsShellBlock'
import ToolsLandingBlock from './components/lego_blocks/units/ui/ToolsLandingBlock'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/lego_blocks/units/ui/tooltip'
import { FrozenRouteBlock } from './components/lego_blocks/units/FrozenRouteBlock'
import RouteActivityProviderBlock from './components/lego_blocks/units/RouteActivityProviderBlock'
import VaultSetup from './components/orchestrators/VaultSetupOrch'
import AppTabsBlock, { type AppWorkspaceTabBlockModel } from './components/lego_blocks/units/AppTabsBlock'
import {
  logPerfTraceBootBanner,
  measureFrameAndSettle,
  perfReport,
  perfTraceEnabled,
} from './services/lego_blocks/units/perfTraceBlock'
import { copyTextToClipboard } from './components/lego_blocks/units/BacklogListDomainBlock'
import { Button } from './components/lego_blocks/units/ui/button'
import RuntimeErrorBoundaryBlock from './components/lego_blocks/integrations/RuntimeErrorBoundaryBlock'
import RuntimeErrorSurfaceBlock from './components/lego_blocks/integrations/RuntimeErrorSurfaceBlock'
import DebugPanelBlock from './components/lego_blocks/integrations/DebugPanelBlock'
import BackgroundActivityBannerBlock from './components/lego_blocks/integrations/BackgroundActivityBannerBlock'
import { startStallDetector } from './services/lego_blocks/units/mainThreadStallBlock'
import DebugToastBlock from './components/lego_blocks/units/DebugToastBlock'
import {
  addDebugLogListenerBlock,
  dispatchDebugLogBlock,
  installConsoleInterceptBlock,
  type DebugLogEntryBlock,
} from './services/lego_blocks/units/debugLogBlock'
import {
  EXCALIDRAW_PLUS_ROOT_ROUTE,
  EXCALIDRAW_PLUS_TOOL_ROUTES,
} from './components/lego_blocks/units/ExcalidrawPlusRoutesBlock'
import UniversalSearchBlock from './components/lego_blocks/integrations/UniversalSearchBlock'
import { UNIVERSAL_SEARCH_COMMAND_MODAL_PRESET_BLOCK } from './components/lego_blocks/integrations/universalSearchPresetBlock'
import { useUILayoutBlock } from './components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useWorkspaceProfileBlock } from './components/lego_blocks/hooks/useWorkspaceProfileBlock'
import { ProfileSwitcherBlock } from './components/lego_blocks/integrations/ProfileSwitcherBlock'
import {
  applyNavRailPrefsBlock,
  getNavRailPrefsBlock,
  hideNavRailItemBlock,
  NAV_RAIL_PREFS_EVENT,
  reorderNavRailItemBlock,
  setNavRailHomePositionBlock,
  type NavRailPrefsBlock,
} from './services/lego_blocks/units/navRailPrefsBlock'
import { useChromeStateEventBlock } from './components/lego_blocks/hooks/shared/useChromeStateEventBlock'
import { useNativeTopChromeBlock } from './components/lego_blocks/hooks/shared/useNativeTopChromeBlock'
import { useNativePushNavigationBlock } from './components/lego_blocks/hooks/shared/useNativePushNavigationBlock'
import { deriveAdaptiveShellStateOrch } from './services/orchestrators/uiNavigationOrch'
import { isElectron, isEmbeddedTerminalSupported, setVaultRoot } from './services/orchestrators/runtimeOrch'
import { fullSync, getLastSyncTimestamp, setLastSyncTimestamp, smartSync, type SyncResult } from './services/orchestrators/vaultSyncOrch'
import { startVaultLiveRefresh } from './services/orchestrators/vaultLiveRefreshOrch'
import { listMarkdownFileIndexEntries } from './services/orchestrators/fileSystemOrch'
import { recencyRankBoostBlock } from './services/lego_blocks/units/fuzzySearchBlock'
import { dispatchGlobalSyncRefreshBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import {
  gitCommitAllOrch,
  gitPushOrch,
  isGitSyncToolsSupportedOrch,
  readGitSyncStatusOrch,
} from '@/services/orchestrators/gitSyncToolsOrch'
import {
  getStoredVaultRoot,
} from './services/orchestrators/storageOrch'
import {
  getTabLabel,
  normalizeTabRoute,
} from './services/lego_blocks/integrations/workspaceTabsBlock'
import { useWorkspaceTabsOrch } from './components/orchestrators/useWorkspaceTabsOrch'
import {
  getWindowContextBlock,
  subscribeWindowContextBlock,
  type WindowContextBlock,
} from './services/lego_blocks/units/windowContextBlock'
import {
  readScheduledTaskLastAttemptByIdOrch,
  readSchedulerSettingsOrch,
  sanitizeSchedulerSettingsOrch,
  writeScheduledTaskLastAttemptAtOrch,
  writeSchedulerSettingsOrch,
  getNextScheduledTaskRunAtOrch,
  getPreviousScheduledTaskRunAtOrch,
  type SchedulerSettingsBlock,
  type ScheduledTaskBlock,
} from './services/orchestrators/schedulerSettingsOrch'
import { getCapabilityFeatureFlags } from './services/orchestrators/capabilityFeatureFlagsOrch'
import { writeFileActivityIgnoredPaths } from './services/orchestrators/fileActivityOrch'
import { isCapacitorNative, initBrowserVaultFS, setVaultFSInstance } from '@/services/lego_blocks/integrations/fsBlock'
import { readUserProfileOrch } from './services/orchestrators/userProfileOrch'
import {
  setExplorerFolderColorPreferencesOrch,
  setWebullTabPreferencesOrch,
  setSchedulerTasksPreferenceOrch,
  type ExplorerFolderColorPreferenceBlock,
  readVaultUiPreferencesOrch,
  setExplorerIconStylePreferenceOrch,
  setExplorerSelectedColorPreferenceOrch,
  DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK,
  type ExplorerIconStyleBlock,
} from './services/orchestrators/vaultUiPreferencesOrch'
import {
  shouldCloseDrawerFromSwipeBlock,
  shouldIgnoreEdgeSwipeFromTargetBlock,
  shouldOpenDrawerFromSwipeBlock,
  shouldStartEdgeSwipeOpenBlock,
} from '@/services/lego_blocks/units/uiGestureBlock'
import {
  thinkingSpaceGoogleWorkspaceChromeBlock,
  type ThinkingSpaceGoogleWorkspaceChromeStateBlock,
} from '@/services/lego_blocks/units/thinkingSpaceGoogleWorkspaceChromeBlock'
import {
  chatSidebarChromeBlock,
  type ChatSidebarChromeStateBlock,
} from '@/services/lego_blocks/units/chatSidebarChromeBlock'
import {
  newThoughtSidebarChromeBlock,
  webSidebarChromeBlock,
  type WebSidebarChromeStateBlock,
} from '@/services/lego_blocks/units/webSidebarChromeBlock'
import {
  organizerSidebarChromeBlock,
  type OrganizerSidebarChromeStateBlock,
} from '@/services/lego_blocks/units/organizerSidebarChromeBlock'
import {
  getTopChromeAppearanceBlock,
  TOP_CHROME_APPEARANCE_EVENT_BLOCK,
  type TopChromeAppearanceStateBlock,
} from '@/services/lego_blocks/units/topChromeAppearanceBlock'
import {
  webullSidebarChromeBlock,
  type WebullSidebarChromeStateBlock,
} from '@/personal_extension/services/lego_blocks/units/webullSidebarChromeBlock'
import {
  toolsSidebarChromeBlock,
  type ToolsSidebarChromeStateBlock,
} from '@/services/lego_blocks/units/toolsSidebarChromeBlock'
import {
  settingsSidebarChromeBlock,
  type SettingsSidebarChromeStateBlock,
} from '@/services/lego_blocks/units/settingsSidebarChromeBlock'
import type { SidebarChromeBlock } from '@/services/lego_blocks/units/sidebarChromeBlock'
import SidebarChromeButtonBlock from '@/components/lego_blocks/units/SidebarChromeButtonBlock'
import {
  captureUnhandledRejectionReportBlock,
  captureWindowErrorReportBlock,
  createRuntimeErrorReportBlock,
  formatRuntimeErrorReportForClipboardBlock,
  formatRuntimeErrorReportsForClipboardBlock,
  type RuntimeErrorReportBlock,
} from '@/services/lego_blocks/units/runtimeErrorBlock'
import { consumeRecentExcalidrawCrashMarkerBlock } from '@/services/lego_blocks/units/excalidrawCrashMarkerBlock'
import { folderPickerPluginBlock } from '@/services/lego_blocks/units/folderPickerPluginBlock'

type NavIcon = ComponentType<{ className?: string }>

// Nav icons stay Phosphor line glyphs in every state — the active pill's
// color inversion alone marks selection.
function phosphorNavIcon(Icon: PhosphorIcon): NavIcon {
  return function PhosphorNavIcon({ className }: { className?: string }) {
    return <Icon className={className} weight="regular" />
  }
}

// Compose glyph — lucide's SquarePen pencil, but on a softer rounded square
// (corner radius 5 instead of 2) to match the ChatGPT-style compose mark.
function NewNoteNavIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3H8a5 5 0 0 0-5 5v8a5 5 0 0 0 5 5h8a5 5 0 0 0 5-5v-4" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .505-.853z" />
    </svg>
  )
}
const OrganizerNavIcon = phosphorNavIcon(PhosphorTreeView)
const SearchNavIcon = phosphorNavIcon(PhosphorMagnifyingGlass)
const ToolsNavIcon = ToolsShapesNavIcon

interface NavItem {
  to: string
  label: string
  icon: NavIcon
  /** Rail icon size override — defaults to the standard 17px; the f9/Webull
   * mark reads smaller than the line glyphs so it keeps 18px. */
  railIconClassName?: string
  activePaths?: string[]
}

const RAIL_ICON_CLASS = 'h-[17px] w-[17px]'

interface CommandItem {
  to: string
  label: string
  group: 'Core' | 'Workspace' | 'Tools' | 'Files'
  activePaths?: string[]
  keywords?: string
  description?: string
  /** File mtime (epoch seconds) — recency boost for ranking file items. */
  mtime?: number
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

function sameRuntimeErrorReport(left: RuntimeErrorReportBlock, right: RuntimeErrorReportBlock): boolean {
  return left.source === right.source
    && left.title === right.title
    && left.message === right.message
    && left.detail === right.detail
    && left.stack === right.stack
    && left.componentStack === right.componentStack
    && left.location === right.location
}

function formatRuntimeErrorDebugDetailsBlock(report: RuntimeErrorReportBlock): string {
  const sections = [
    `Title: ${report.title}`,
    report.location ? `Route: ${report.location}` : null,
    `Captured: ${new Date(report.capturedAt).toLocaleString()}`,
    '',
    report.detail,
    report.stack ? `\nStack:\n${report.stack}` : null,
    report.componentStack ? `\nComponent Stack:\n${report.componentStack}` : null,
  ]
  return sections
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
}

function formatSyncTimestamp(value: number | null): string {
  if (!value) return 'none yet'
  return new Date(value).toLocaleString()
}


const TOOLS_NAV_ACTIVE_PATHS: readonly string[] = [
  '/tools',
  '/ai/chat',
  '/ai/schedules',
  '/web',
  '/git-insights',
  '/excalidraw-plus',
  '/excalidraw-plus/plugin',
  '/excalidraw-plus/format',
  '/excalidraw-plus/mindmap',
  '/excalidraw-plus/pdf',
  '/excalidraw-plus/transcript',
  '/excalidraw-plugin',
  '/format-excalidraw',
  '/mindmap-builder',
  '/pdf-to-markdown',
  '/transcript-cleaner',
  '/capabilities',
  '/extension-builder',
  '/terminal',
  '/password-manager',
  '/personal-tools',
  '/personal-extension',
  '/ai-steward',
  '/ai-integrity',
]

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { to: '/thinking-space', label: 'Thinking Space', icon: Compass },
  { to: '/new-thought', label: 'New Note', icon: NewNoteNavIcon },
  { to: '/webull', label: 'Webull', icon: WebullNavIcon, railIconClassName: 'h-[18px] w-[18px]' },
  {
    to: '/thinking-organizer',
    label: 'Thinking Organizer',
    icon: OrganizerNavIcon,
    activePaths: ['/file-organizer'],
  },
]

const TOOLS_NAV_ITEM: NavItem = {
  to: '/tools',
  label: 'Tools',
  icon: ToolsNavIcon,
  activePaths: TOOLS_NAV_ACTIVE_PATHS as string[],
}

// Vault Graph is a primary destination (a place you explore), not a quick
// utility — so it sits on the main rail right after Tools rather than inside it.
const VAULT_GRAPH_NAV_ITEM: NavItem = {
  to: '/vault-graph',
  label: 'Thinking Space Graph',
  icon: Waypoints,
}

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

// Custom Shapes glyph for Tools — lucide's Shapes layout (triangle top,
// square bottom-left, circle bottom-right) and stroke weight, but with a
// true equilateral triangle (side 7.8, height 7.8 × √3⁄2 ≈ 6.75), which the
// stock glyph doesn't have.
function ToolsShapesNavIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="-1 -1 26 26"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3.2 L15.9 9.95 L8.1 9.95 Z" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <circle cx="17.5" cy="17.5" r="3.5" />
    </svg>
  )
}

function WebullNavIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 70" className={className} fill="currentColor" aria-hidden="true">
      <path d="M4 8 C4 72 96 72 96 8 C72 52 28 52 4 8 Z" />
    </svg>
  )
}

function WebullTextNavIcon({ text, className = 'h-4 w-4' }: { text: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`${className} inline-flex items-center justify-center text-[12px] font-medium leading-none tracking-tight`}>
      {text}
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
  const activePaths = item.activePaths ?? []
  return activePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
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
  const currentRoute = `${location.pathname}${location.search}${location.hash}`
  const terminalSupported = isEmbeddedTerminalSupported()
  // Applies this window's profile accent to the shell (CSS var + data attr).
  useWorkspaceProfileBlock()

  // Per-profile rail customization (order + hidden) with iOS-style jiggle edit
  // mode: press-and-hold a rail icon to enter, drag to reorder, x to hide,
  // Escape / click-away to finish.
  const [navRailPrefs, setNavRailPrefs] = useState<NavRailPrefsBlock>(() => getNavRailPrefsBlock())
  const [railEditMode, setRailEditMode] = useState(false)
  const railLongPressTimerRef = useRef<number | null>(null)
  const railDraggedIdRef = useRef<string | null>(null)
  // The click that fires when the long-press releases must not immediately
  // exit the edit mode it just entered.
  const suppressRailExitClickRef = useRef(false)

  useEffect(() => startStallDetector(), [])

  useEffect(() => {
    const listener = () => setNavRailPrefs(getNavRailPrefsBlock())
    window.addEventListener(NAV_RAIL_PREFS_EVENT, listener)
    return () => window.removeEventListener(NAV_RAIL_PREFS_EVENT, listener)
  }, [])

  useEffect(() => {
    if (!railEditMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRailEditMode(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target?.closest?.("[data-ltm-nav-region='rail']")) setRailEditMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [railEditMode])

  const startRailLongPress = useCallback(() => {
    if (railLongPressTimerRef.current !== null) window.clearTimeout(railLongPressTimerRef.current)
    railLongPressTimerRef.current = window.setTimeout(() => {
      railLongPressTimerRef.current = null
      setRailEditMode(true)
      // Ignore the click that this same press produces on release.
      suppressRailExitClickRef.current = true
      window.setTimeout(() => { suppressRailExitClickRef.current = false }, 500)
    }, 550)
  }, [])

  const cancelRailLongPress = useCallback(() => {
    if (railLongPressTimerRef.current !== null) {
      window.clearTimeout(railLongPressTimerRef.current)
      railLongPressTimerRef.current = null
    }
  }, [])

  // Home can be dragged between the top of the rail and the bottom corner.
  // The two group containers (top nav scroll + bottom actions) are drop zones;
  // they only react when the dragged item is Home ('/'), so normal item
  // reorder drops pass through untouched. The ref is cleared on dragEnd (not in
  // item onDrop) so the bubbled container handler can still read it.
  const allowHomeRailDrop = useCallback((event: React.DragEvent) => {
    if (railDraggedIdRef.current === '/') event.preventDefault()
  }, [])
  const dropHomeRailAt = useCallback(
    (position: 'top' | 'bottom') => (event: React.DragEvent) => {
      if (railDraggedIdRef.current !== '/') return
      event.preventDefault()
      setNavRailHomePositionBlock(position)
    },
    [],
  )
  const clearRailDraggedId = useCallback(() => { railDraggedIdRef.current = null }, [])

  const featureFlags = getCapabilityFeatureFlags()
  const extensionBuilderEnabled = featureFlags.extension_host_enabled && featureFlags.extension_builder_enabled
  const gitSyncToolsSupported = useMemo(() => isGitSyncToolsSupportedOrch(), [])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandFileItems, setCommandFileItems] = useState<CommandItem[]>([])
  const [commandFilesLastLoadedAt, setCommandFilesLastLoadedAt] = useState(0)
  const [explorerIconStyle, setExplorerIconStyle] = useState<ExplorerIconStyleBlock>('outline')
  const [explorerFolderColorRules, setExplorerFolderColorRules] = useState<ExplorerFolderColorPreferenceBlock[]>([])
  const [explorerSelectedColor, setExplorerSelectedColor] = useState<string>(DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK)
  const [refreshRunning, setRefreshRunning] = useState(false)
  const [thinkingSpaceGoogleWorkspaceChromeState, setThinkingSpaceGoogleWorkspaceChromeState] = useState<ThinkingSpaceGoogleWorkspaceChromeStateBlock>({
    enabled: false,
    explorerCollapsed: false,
    headerVisible: true,
    showHeaderToggle: false,
  })
  const [chatSidebarChromeState, setChatSidebarChromeState] = useState<ChatSidebarChromeStateBlock>({
    enabled: false,
    collapsed: false,
    headerVisible: true,
    showHeaderToggle: false,
    label: 'AI',
  })
  const [webullTabLabel, setWebullTabLabel] = useState('Webull')
  const [webullTabIconText, setWebullTabIconText] = useState('')
  const [webSidebarChromeState, setWebSidebarChromeState] = useState<WebSidebarChromeStateBlock>({
    enabled: false,
    collapsed: false,
    headerVisible: true,
    showHeaderToggle: false,
    label: 'Web',
    siteLabels: undefined,
  })
  const [organizerSidebarChromeState, setOrganizerSidebarChromeState] = useState<OrganizerSidebarChromeStateBlock>({
    enabled: false,
    collapsed: false,
    label: 'Organizer',
    headerVisible: true,
    showHeaderToggle: false,
  })
  const [webullSidebarChromeState, setWebullSidebarChromeState] = useState<WebullSidebarChromeStateBlock>({
    enabled: false,
    collapsed: false,
    label: 'webull',
  })
  const [toolsSidebarChromeState, setToolsSidebarChromeState] = useState<ToolsSidebarChromeStateBlock>({
    enabled: false,
    collapsed: false,
    label: 'Tools',
  })
  const [newThoughtSidebarChromeState, setNewThoughtSidebarChromeState] = useState({ enabled: false, collapsed: false })
  const [settingsSidebarChromeState, setSettingsSidebarChromeState] = useState<SettingsSidebarChromeStateBlock>({
    enabled: false,
    collapsed: false,
    label: 'Settings',
  })
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [syncActionRunning, setSyncActionRunning] = useState<'sync' | 'rebuild' | null>(null)
  const [gitActionRunning, setGitActionRunning] = useState<'commit' | 'push' | null>(null)
  const [schedulerSettings, setSchedulerSettings] = useState<SchedulerSettingsBlock>(
    () => readSchedulerSettingsOrch(),
  )
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
  const [runtimeErrorReports, setRuntimeErrorReports] = useState<RuntimeErrorReportBlock[]>([])
  const [runtimeErrorCopiedToken, setRuntimeErrorCopiedToken] = useState<string | null>(null)
  const [debugPanelOpen, setDebugPanelOpen] = useState(false)
  const [debugLogEntries, setDebugLogEntries] = useState<DebugLogEntryBlock[]>([])
  const [debugToast, setDebugToast] = useState<DebugLogEntryBlock | null>(null)
  const [debugUnreadCount, setDebugUnreadCount] = useState(0)
  const [nativeTopBarCollapsed, setNativeTopBarCollapsed] = useState(false)
  const [nativeBottomBarCollapsed, setNativeBottomBarCollapsed] = useState(false)
  const [nativeBottomBarHidden, setNativeBottomBarHidden] = useState(false)
  // Page surfaces (Home's time-of-day backdrop) report when the area under the
  // status bar is dark; forwarded to native so the clock glyphs + top scrim
  // flip appearance instead of rendering light chrome over a dark canvas.
  const [nativeTopBarDark, setNativeTopBarDark] = useState(() => getTopChromeAppearanceBlock().dark)
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TopChromeAppearanceStateBlock>).detail
      setNativeTopBarDark(Boolean(detail?.dark))
    }
    window.addEventListener(TOP_CHROME_APPEARANCE_EVENT_BLOCK, handler)
    return () => window.removeEventListener(TOP_CHROME_APPEARANCE_EVENT_BLOCK, handler)
  }, [])
  const debugToastTimerRef = useRef<number | null>(null)
  const commandInputRef = useRef<HTMLInputElement | null>(null)
  const gitCommitMessageInputRef = useRef<HTMLInputElement | null>(null)
  const schedulerTimeoutRef = useRef<number | null>(null)
  const syncToolsRef = useRef<HTMLDivElement | null>(null)
  const topChromeMenuRef = useRef<HTMLDivElement | null>(null)
  const syncPanelRef = useRef<HTMLDivElement | null>(null)
  const syncToggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const mainContentRef = useRef<HTMLElement | null>(null)
  const scrollbarActivityTimeoutRef = useRef<number | null>(null)
  const nativeChromeScrollTargetRef = useRef<EventTarget | null>(null)
  const nativeChromeLastScrollTopRef = useRef(0)
  const initialWindowContextRef = useRef<WindowContextBlock>(getWindowContextBlock())
  const [windowContext, setWindowContext] = useState<WindowContextBlock>(initialWindowContextRef.current)
  const currentRouteRef = useRef(currentRoute)
  const drawerEdgeSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const drawerPanelSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const runtimeErrorCopyResetTimeoutRef = useRef<number | null>(null)
  const [vaultSwitchHardRefreshPending, setVaultSwitchHardRefreshPending] = useState(false)
  const [needsVaultSetup, setNeedsVaultSetup] = useState(() => {
    const stored = getStoredVaultRoot()
    if (!stored) return true
    // On Capacitor, reject stale absolute paths from older versions
    if (isCapacitorNative() && stored.startsWith('/')) return true
    return false
  })
  const showGoogleWorkspaceChromeControls = location.pathname === '/thinking-space'
    && thinkingSpaceGoogleWorkspaceChromeState.enabled
  const showChatSidebarChromeControl = location.pathname === '/ai/chat'
    && chatSidebarChromeState.enabled
  const showChatHeaderToggle = showChatSidebarChromeControl && chatSidebarChromeState.showHeaderToggle
  const showWebSidebarChromeControl = location.pathname === '/web' && webSidebarChromeState.enabled
  const showWebHeaderToggle = showWebSidebarChromeControl && webSidebarChromeState.showHeaderToggle
  const showOrganizerSidebarChromeControl = (location.pathname === '/thinking-organizer' || location.pathname === '/file-organizer')
    && organizerSidebarChromeState.enabled
  const showOrganizerHeaderToggle = showOrganizerSidebarChromeControl && organizerSidebarChromeState.showHeaderToggle
  const showWebullSidebarChromeControl = location.pathname === '/webull' && webullSidebarChromeState.enabled
  const showToolsSidebarChromeControl = toolsSidebarChromeState.enabled && TOOLS_NAV_ACTIVE_PATHS.includes(location.pathname)
  const showNewThoughtSidebarChromeControl = location.pathname === '/new-thought' && newThoughtSidebarChromeState.enabled
  const showSettingsSidebarChromeControl = location.pathname === '/settings' && settingsSidebarChromeState.enabled
  // On Capacitor, each of these tabs owns its own edge-swipe gesture.
  // Suppress the global nav-drawer swipe so they don't conflict.
  const tabOwnsSidebarSwipe = showGoogleWorkspaceChromeControls
    || showChatSidebarChromeControl
    || showWebSidebarChromeControl
    || showOrganizerSidebarChromeControl
    || showWebullSidebarChromeControl
    || showToolsSidebarChromeControl
    || showNewThoughtSidebarChromeControl
    || showSettingsSidebarChromeControl
  const isElectronDesktopSurface = layout.surface === 'electron' && layout.mode === 'desktop'
  const isMacDesktopSurface = isElectronDesktopSurface
    && typeof navigator !== 'undefined'
    && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent || '')
  // Modifier glyph for rail tooltip shortcut hints (⌘N on mac, Ctrl+N elsewhere).
  const isMacPlatform = typeof navigator !== 'undefined'
    && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent || '')
  const shortcutHint = (digit: number) => (isMacPlatform ? ` (⌘${digit})` : ` (Ctrl+${digit})`)

  // Home glyph as a rail item — draggable in jiggle-edit mode so it can anchor
  // at the top of the rail or the bottom corner (default). Rendered in exactly
  // one of the two slots depending on navRailPrefs.homePosition.
  const renderHomeRailItem = () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/"
          aria-label="Home"
          aria-current={location.pathname === '/' || location.pathname === '/home-canvas' ? 'page' : undefined}
          draggable={railEditMode}
          onPointerDown={startRailLongPress}
          onPointerUp={cancelRailLongPress}
          onPointerLeave={cancelRailLongPress}
          onClick={(event) => { if (railEditMode) event.preventDefault() }}
          onDragStart={() => { railDraggedIdRef.current = '/' }}
          onDragEnd={clearRailDraggedId}
          className={`ltm-shell-logo ltm-motion-fast ltm-rail-item ltm-rail-manageable inline-flex h-10 w-full items-center justify-center rounded-lg transition-colors`}
        >
          <span className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full">
            <AppBrandGlyph className="h-full w-full" />
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{railEditMode ? 'Drag to the top or bottom · click away to finish' : `Home${shortcutHint(0)}`}</TooltipContent>
    </Tooltip>
  )
  // Keep the explorer collapse button in the same left-cluster position as every
  // other surface's chrome button (was previously right-aligned off Electron
  // desktop, which made it jump position on web/PWA). Capacitor still uses its
  // own top-chrome menu variant.
  const showLeftAlignedGoogleWorkspaceChromeControls = showGoogleWorkspaceChromeControls
    && layout.surface !== 'capacitor-ios'
    && layout.surface !== 'capacitor-android'
  const showThinkingSpaceHeaderToggle = showGoogleWorkspaceChromeControls
    && thinkingSpaceGoogleWorkspaceChromeState.showHeaderToggle
  const resolvedWebullIcon = useMemo(() => {
    if (!webullTabIconText) return WebullNavIcon
    const text = webullTabIconText
    return function ResolvedWebullTextIcon({ className = 'h-4 w-4' }: { className?: string }) {
      return <WebullTextNavIcon text={text} className={className} />
    }
  }, [webullTabIconText])

  const primaryNavItems = useMemo(
    () => applyNavRailPrefsBlock(
      PRIMARY_NAV_ITEMS.map(item =>
        item.to === '/webull'
          ? { ...item, label: webullTabLabel, icon: resolvedWebullIcon }
          : item,
      ),
      navRailPrefs,
    ),
    [webullTabLabel, resolvedWebullIcon, navRailPrefs],
  )
  const toolsNavItems = useMemo(
    () => applyNavRailPrefsBlock([TOOLS_NAV_ITEM, VAULT_GRAPH_NAV_ITEM], navRailPrefs),
    [navRailPrefs],
  )
  const utilityNavItems = useMemo<NavItem[]>(
    () => [{ to: '/settings', label: 'Settings', icon: SettingsIcon }],
    [],
  )

  const baseCommandItems = useMemo<CommandItem[]>(() => ([
    { to: '/', label: 'Home', group: 'Core', keywords: 'dashboard start' },
    ...primaryNavItems.map(item => ({
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
      to: TOOLS_NAV_ITEM.to,
      label: TOOLS_NAV_ITEM.label,
      group: 'Tools' as const,
      activePaths: TOOLS_NAV_ITEM.activePaths,
    },
    {
      to: EXCALIDRAW_NAV_ITEM.to,
      label: EXCALIDRAW_NAV_ITEM.label,
      group: 'Tools' as const,
      activePaths: EXCALIDRAW_NAV_ITEM.activePaths,
    },
    ...EXCALIDRAW_PLUS_TOOL_ROUTES.map(tool => ({
      to: tool.route,
      label: tool.label,
      group: 'Tools' as const,
      activePaths: [tool.legacyRoute],
    })),
    { to: '/capabilities', label: 'AI Capabilities', group: 'Tools' as const },
    ...(terminalSupported ? [{ to: '/terminal', label: 'Terminal', group: 'Tools' as const }] : []),
    { to: '/password-manager', label: 'Passwords', group: 'Tools' as const },
    { to: '/personal-tools', label: 'Heading Assignments', group: 'Tools' as const },
    ...(extensionBuilderEnabled ? [{ to: '/extension-builder', label: 'Extension Builder', group: 'Tools' as const }] : []),
  ]), [extensionBuilderEnabled, primaryNavItems, terminalSupported, utilityNavItems])

  const allCommandItems = useMemo<CommandItem[]>(
    () => [...baseCommandItems, ...commandFileItems],
    [baseCommandItems, commandFileItems],
  )

  const routeLabelByPath = useMemo(() => {
    const entries = new Map<string, string>()
    entries.set('/', 'Home')
    entries.set('/tools', 'Tools')
    entries.set('/file-organizer', 'Thinking Organizer')
    baseCommandItems.forEach((item) => {
      entries.set(item.to, item.label)
    })
    return entries
  }, [baseCommandItems])

  useEffect(() => {
    return subscribeWindowContextBlock((nextContext) => {
      setWindowContext((prev) => (
        prev.browserWindowId === nextContext.browserWindowId
          && prev.sessionId === nextContext.sessionId
          && prev.isMainWindow === nextContext.isMainWindow
          && prev.isBackgroundAuthority === nextContext.isBackgroundAuthority
          ? prev
          : nextContext
      ))
    })
  }, [])

  const {
    workspaceTabs,
    activeWorkspaceTabId,
    activeWorkspaceTab,
    persistentWebSiteIdByTabId,
    persistentRouteMounts,
    mountedTabIdSet,
    isChatRoute,
    isWebRoute,
    isOrganizerRoute,
    isNewThoughtRoute,
    isThinkingSpaceRoute,
    isWebullRoute,
    usesPersistentRouteSurface,
    activeChatTabIds: renderedPersistentChatTabIds,
    activeWebTabIds: renderedPersistentWebTabIds,
    activeThinkingSpaceTabIds: renderedPersistentThinkingSpaceTabIds,
    activeOrganizerRoute,
    derivedActiveWorkspaceTabLabel,
    activeWorkspaceTabLabel,
    pendingWorkspaceTabNavigationRef,
    tabSwitchPerfRef,
    handleCreateWorkspaceTab,
    handleSelectWorkspaceTab,
    handleCloseWorkspaceTab,
    getWebSiteSelectCallback,
    syncActiveWorkspaceTabLabel,
  } = useWorkspaceTabsOrch({
    windowContext,
    location,
    currentRoute,
    routeLabelByPath,
    chatChromeLabel: chatSidebarChromeState.label,
    webChromeLabel: webSidebarChromeState.label,
    webChromeSiteLabels: webSidebarChromeState.siteLabels,
    webullTabLabel,
  })
  const organizerNavRoute = activeOrganizerRoute ?? '/thinking-organizer'
  void derivedActiveWorkspaceTabLabel
  void activeWorkspaceTab

  useEffect(() => {
    currentRouteRef.current = currentRoute
  }, [currentRoute])

  const nativeTopDrawerActiveNavItemId = useMemo(() => {
    if (location.pathname === '/thinking-organizer' || location.pathname === '/file-organizer') {
      return '/thinking-organizer'
    }

    switch (location.pathname) {
      case '/':
      case '/thinking-space':
      case '/new-thought':
      case '/webull':
      case '/settings':
        return location.pathname
      case '/tools':
      case '/git-insights':
      case '/ai/chat':
      case '/ai/schedules':
      case '/web':
        return '/tools'
      default:
        if (isToolsShellRoute(location.pathname)) return '/tools'
        return undefined
    }
  }, [location.pathname])
  const resolveWorkspaceNavigationRoute = useCallback((route: string) => (
    route === '/thinking-organizer' ? organizerNavRoute : route
  ), [organizerNavRoute])

  const workspaceTabItems = useMemo<AppWorkspaceTabBlockModel[]>(
    () => workspaceTabs.map(tab => ({
      id: tab.id,
      label: tab.id === activeWorkspaceTabId
        ? activeWorkspaceTabLabel
        : (typeof tab.label === 'string' && tab.label.trim().length > 0
            ? tab.label
            : getTabLabel(tab.route, routeLabelByPath, chatSidebarChromeState.label, webSidebarChromeState.label, webullTabLabel, webSidebarChromeState.siteLabels)),
    })),
    [activeWorkspaceTabId, activeWorkspaceTabLabel, routeLabelByPath, workspaceTabs, chatSidebarChromeState.label, webSidebarChromeState.label, webSidebarChromeState.siteLabels, webullTabLabel],
  )
  const nativeTabItems = useMemo(
    () => workspaceTabItems.map((tab) => ({
      id: tab.id,
      label: tab.label,
      active: tab.id === activeWorkspaceTabId,
    })),
    [activeWorkspaceTabId, workspaceTabItems],
  )

  const shell = useMemo(() => deriveAdaptiveShellStateOrch(layout), [layout])
  const keyboardVisible = layout.keyboardVisible
  const forceCompactNavForIosKeyboard = layout.surface === 'capacitor-ios' && keyboardVisible
  const compactNav = shell.compactNav || forceCompactNavForIosKeyboard
  const showBottomNav = false
  const phoneMode = layout.mode === 'phone'
  const iPhoneMode = layout.surface === 'capacitor-ios' && phoneMode
  const useNativeTopChrome = iPhoneMode
  const iPhoneUserAgent = typeof navigator !== 'undefined' && /iPhone/i.test(navigator.userAgent || '')
  const iPhoneHandsetMode = phoneMode && (iPhoneMode || iPhoneUserAgent)
  const isCapacitorSurface = layout.surface === 'capacitor-ios' || layout.surface === 'capacitor-android'
  const showCapacitorTopChromeMenu = compactNav && !drawerOpen && isCapacitorSurface && !useNativeTopChrome
  const googleWorkspaceChromeLeftOffsetPx = isMacDesktopSurface ? 88 : 8

  interface SidebarChromeButtonConfig {
    id: string
    show: boolean
    block: SidebarChromeBlock<any>
    collapsed: boolean
    headerVisible?: boolean
    showHeaderToggle?: boolean
    toggleLabels: { show: string; hide: string }
    headerToggleLabels?: { show: string; hide: string }
    variant?: 'default' | 'soft'
    /** Where the button is rendered in the top toolbar. */
    position?: 'inline' | 'capacitor-menu' | 'left-aligned'
  }
  const sidebarChromeButtons: SidebarChromeButtonConfig[] = ([
    {
      id: 'thinking-space-explorer-capacitor',
      show: showCapacitorTopChromeMenu && showGoogleWorkspaceChromeControls,
      block: thinkingSpaceGoogleWorkspaceChromeBlock,
      collapsed: thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed,
      headerVisible: thinkingSpaceGoogleWorkspaceChromeState.headerVisible,
      showHeaderToggle: thinkingSpaceGoogleWorkspaceChromeState.showHeaderToggle,
      toggleLabels: { show: 'Show explorer', hide: 'Hide explorer' },
      headerToggleLabels: { show: 'Show URL bar', hide: 'Hide URL bar' },
      variant: 'soft',
      position: 'capacitor-menu',
    },
    {
      id: 'thinking-space-explorer-left',
      show: showLeftAlignedGoogleWorkspaceChromeControls,
      block: thinkingSpaceGoogleWorkspaceChromeBlock,
      collapsed: thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed,
      headerVisible: thinkingSpaceGoogleWorkspaceChromeState.headerVisible,
      showHeaderToggle: thinkingSpaceGoogleWorkspaceChromeState.showHeaderToggle,
      toggleLabels: { show: 'Show explorer', hide: 'Hide explorer' },
      headerToggleLabels: { show: 'Show document header', hide: 'Hide document header' },
      variant: 'soft',
      position: 'left-aligned',
    },
    {
      id: 'chat',
      show: showChatSidebarChromeControl,
      block: chatSidebarChromeBlock,
      collapsed: chatSidebarChromeState.collapsed,
      headerVisible: chatSidebarChromeState.headerVisible,
      showHeaderToggle: chatSidebarChromeState.showHeaderToggle,
      toggleLabels: { show: 'Show chat sidebar', hide: 'Hide chat sidebar' },
      headerToggleLabels: { show: 'Show URL bar', hide: 'Hide URL bar' },
    },
    {
      id: 'web',
      show: showWebSidebarChromeControl,
      block: webSidebarChromeBlock,
      collapsed: webSidebarChromeState.collapsed,
      headerVisible: webSidebarChromeState.headerVisible,
      showHeaderToggle: webSidebarChromeState.showHeaderToggle,
      toggleLabels: { show: 'Show web sidebar', hide: 'Hide web sidebar' },
      headerToggleLabels: { show: 'Show URL bar', hide: 'Hide URL bar' },
    },
    {
      id: 'organizer',
      show: showOrganizerSidebarChromeControl,
      block: organizerSidebarChromeBlock,
      collapsed: organizerSidebarChromeState.collapsed,
      headerVisible: organizerSidebarChromeState.headerVisible,
      showHeaderToggle: organizerSidebarChromeState.showHeaderToggle,
      toggleLabels: { show: 'Show organizer sidebar', hide: 'Hide organizer sidebar' },
      headerToggleLabels: { show: 'Show document headers', hide: 'Hide document headers' },
    },
    {
      id: 'webull',
      show: showWebullSidebarChromeControl,
      block: webullSidebarChromeBlock,
      collapsed: webullSidebarChromeState.collapsed,
      toggleLabels: { show: 'Show sidebar', hide: 'Hide sidebar' },
    },
    {
      id: 'tools',
      show: showToolsSidebarChromeControl,
      block: toolsSidebarChromeBlock,
      collapsed: toolsSidebarChromeState.collapsed,
      toggleLabels: { show: 'Show sidebar', hide: 'Hide sidebar' },
    },
    {
      id: 'new-thought',
      show: showNewThoughtSidebarChromeControl,
      block: newThoughtSidebarChromeBlock,
      collapsed: newThoughtSidebarChromeState.collapsed,
      toggleLabels: { show: 'Show left panel', hide: 'Hide left panel' },
    },
    {
      id: 'settings',
      show: showSettingsSidebarChromeControl,
      block: settingsSidebarChromeBlock,
      collapsed: settingsSidebarChromeState.collapsed,
      toggleLabels: { show: 'Show settings sidebar', hide: 'Hide settings sidebar' },
    },
  ] as SidebarChromeButtonConfig[]).map(cfg => ({ position: 'inline', ...cfg }))
  const inlineSidebarChromeButtons = sidebarChromeButtons.filter(cfg => cfg.position === 'inline')
  const capacitorMenuSidebarChromeButtons = sidebarChromeButtons.filter(cfg => cfg.position === 'capacitor-menu')
  const leftAlignedSidebarChromeButtons = sidebarChromeButtons.filter(cfg => cfg.position === 'left-aligned')
  const leftGoogleWorkspaceChromeControlsWidthPx = showLeftAlignedGoogleWorkspaceChromeControls
    ? googleWorkspaceChromeLeftOffsetPx + 76
    : 0
  const topChromeLeftWidth = showCapacitorTopChromeMenu
    ? Math.max(phoneMode ? 42 : 96, topChromeMenuWidth)
    : leftGoogleWorkspaceChromeControlsWidthPx
  const topChromeRightWidth = Math.max(phoneMode ? 86 : 120, syncToolsWidth)
  const topChromeBalancedWidth = Math.max(120, topChromeLeftWidth, topChromeRightWidth)
  const topChromeRightAnchorInset = iPhoneMode ? 4 : 32
  const topChromePaddingLeft = phoneMode ? topChromeLeftWidth : topChromeBalancedWidth
  const topChromePaddingRight = (phoneMode ? topChromeRightWidth : topChromeBalancedWidth) + topChromeRightAnchorInset
  const topInset = shell.topInset
  const rightInset = shell.rightInset
  const bottomInset = shell.bottomInset
  const leftInset = shell.leftInset
  const drawerBottomInset = shell.drawerBottomInset
  const shouldUsePhoneSafeBottomPadding = layout.surface === 'capacitor-ios' && layout.mode === 'phone' && !keyboardVisible && !useNativeTopChrome
  const mainBottomPadding = keyboardVisible
    ? Math.max(0, Math.round(layout.keyboardInset))
    : (shouldUsePhoneSafeBottomPadding ? Math.max(bottomInset, 14) : 0)
  const routeOwnsMainScroll = !isChatRoute && !isWebRoute
  const mainStageStyle = useMemo<CSSProperties | undefined>(() => {
    const style: CSSProperties = {}
    if (mainBottomPadding) {
      style.paddingBottom = `${mainBottomPadding}px`
    }
    if (!routeOwnsMainScroll) {
      style.overflowY = 'hidden'
    }
    return Object.keys(style).length > 0 ? style : undefined
  }, [mainBottomPadding, routeOwnsMainScroll])
  const commandPaletteTopPadding = Math.max(80, topInset + 56)
  const commandPaletteBottomPadding = Math.max(16, bottomInset + 12)
  const compactDrawerBaseOffset = layout.surface === 'capacitor-ios' ? 24 : 16
  const compactDrawerTriggerBottom = Math.max(
    bottomInset + (showBottomNav ? 72 : compactDrawerBaseOffset),
    compactDrawerBaseOffset,
  )
  const compactDrawerTriggerLeft = Math.max(16, leftInset + 16)
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
  // Drive the explorer selected-row highlight via a root CSS var so it applies
  // across every shell surface (including the native iPhone frame) and updates
  // live when the color is changed in Settings.
  useEffect(() => {
    document.documentElement.style.setProperty('--ltm-explorer-selected-color', explorerSelectedColor)
  }, [explorerSelectedColor])
  // Mirror the safe-area insets onto the document root as well: fixed overlays
  // that mount OUTSIDE .ltm-app-shell (BackgroundActivityBannerBlock, runtime
  // error surface, portals) otherwise resolve `var(--ltm-safe-top, 0px)` to the
  // 0px fallback and slide under the iOS status bar.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--ltm-safe-top', `${topInset}px`)
    root.setProperty('--ltm-safe-right', `${rightInset}px`)
    root.setProperty('--ltm-safe-bottom', `${bottomInset}px`)
    root.setProperty('--ltm-safe-left', `${leftInset}px`)
  }, [topInset, rightInset, bottomInset, leftInset])
  const nativeSidebarControl = useMemo(() => {
    if (showGoogleWorkspaceChromeControls) {
      return {
        kind: 'thinking-space-sidebar',
        enabled: true,
        active: !thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed,
        label: thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed ? 'Show side panel' : 'Hide side panel',
      }
    }
    if (showChatSidebarChromeControl) {
      return {
        kind: 'chat-sidebar',
        enabled: true,
        active: !chatSidebarChromeState.collapsed,
        label: chatSidebarChromeState.collapsed ? 'Show side panel' : 'Hide side panel',
      }
    }
    if (showWebSidebarChromeControl) {
      return {
        kind: 'web-sidebar',
        enabled: true,
        active: !webSidebarChromeState.collapsed,
        label: webSidebarChromeState.collapsed ? 'Show side panel' : 'Hide side panel',
      }
    }
    if (showOrganizerSidebarChromeControl) {
      return {
        kind: 'organizer-sidebar',
        enabled: true,
        active: !organizerSidebarChromeState.collapsed,
        label: organizerSidebarChromeState.collapsed ? 'Show side panel' : 'Hide side panel',
      }
    }
    if (showWebullSidebarChromeControl) {
      return {
        kind: 'webull-sidebar',
        enabled: true,
        active: !webullSidebarChromeState.collapsed,
        label: webullSidebarChromeState.collapsed ? 'Show side panel' : 'Hide side panel',
      }
    }
    if (showNewThoughtSidebarChromeControl) {
      return {
        kind: 'new-thought-sidebar',
        enabled: true,
        active: !newThoughtSidebarChromeState.collapsed,
        label: newThoughtSidebarChromeState.collapsed ? 'Show side panel' : 'Hide side panel',
      }
    }
    if (showSettingsSidebarChromeControl) {
      return {
        kind: 'settings-sidebar',
        enabled: true,
        active: !settingsSidebarChromeState.collapsed,
        label: settingsSidebarChromeState.collapsed ? 'Show side panel' : 'Hide side panel',
      }
    }
    if (compactNav) {
      return {
        kind: 'drawer',
        // On Capacitor iOS the SwiftUI native drawer handles navigation;
        // setting enabled=false causes the native sidebar button to open
        // the SwiftUI drawer instead of the React web nav menu.
        enabled: !isCapacitorSurface,
        active: drawerOpen,
        label: drawerOpen ? 'Hide navigation' : 'Show navigation',
      }
    }
    return {
      kind: 'none',
      enabled: false,
      active: false,
      label: 'Side panel',
    }
  }, [
    chatSidebarChromeState.collapsed,
    compactNav,
    drawerOpen,
    newThoughtSidebarChromeState.collapsed,
    organizerSidebarChromeState.collapsed,
    showChatSidebarChromeControl,
    showGoogleWorkspaceChromeControls,
    showNewThoughtSidebarChromeControl,
    showOrganizerSidebarChromeControl,
    showSettingsSidebarChromeControl,
    showWebSidebarChromeControl,
    showWebullSidebarChromeControl,
    settingsSidebarChromeState.collapsed,
    thinkingSpaceGoogleWorkspaceChromeState.explorerCollapsed,
    webSidebarChromeState.collapsed,
    webullSidebarChromeState.collapsed,
  ])
  const nativeHeaderToolControl = useMemo(() => {
    if (showThinkingSpaceHeaderToggle) {
      return {
        kind: 'thinking-space-header',
        enabled: true,
        label: thinkingSpaceGoogleWorkspaceChromeState.headerVisible ? 'Hide URL bar' : 'Show URL bar',
      }
    }
    if (showChatHeaderToggle) {
      return {
        kind: 'chat-header',
        enabled: true,
        label: chatSidebarChromeState.headerVisible ? 'Hide URL bar' : 'Show URL bar',
      }
    }
    if (showWebHeaderToggle) {
      return {
        kind: 'web-header',
        enabled: true,
        label: webSidebarChromeState.headerVisible ? 'Hide URL bar' : 'Show URL bar',
      }
    }
    if (showOrganizerHeaderToggle) {
      return {
        kind: 'organizer-header',
        enabled: true,
        label: organizerSidebarChromeState.headerVisible ? 'Hide document headers' : 'Show document headers',
      }
    }
    return {
      kind: 'none',
      enabled: false,
      label: 'Toggle Header',
    }
  }, [
    chatSidebarChromeState.headerVisible,
    organizerSidebarChromeState.headerVisible,
    showChatHeaderToggle,
    showOrganizerHeaderToggle,
    showThinkingSpaceHeaderToggle,
    showWebHeaderToggle,
    thinkingSpaceGoogleWorkspaceChromeState.headerVisible,
    webSidebarChromeState.headerVisible,
  ])

  const pushRuntimeErrorReport = useCallback((report: RuntimeErrorReportBlock) => {
    setRuntimeErrorReports((prev) => {
      if (prev.some(existing => sameRuntimeErrorReport(existing, report))) return prev
      dispatchDebugLogBlock({
        level: 'error',
        message: report.message,
        details: formatRuntimeErrorDebugDetailsBlock(report),
        stack: report.stack ?? report.componentStack ?? undefined,
        source: `runtime:${report.source}`,
      })
      return [report, ...prev].slice(0, 12)
    })
  }, [])

  const copyRuntimeErrorText = useCallback(async (text: string, token: string) => {
    try {
      await copyTextToClipboard(text)
      setRuntimeErrorCopiedToken(token)
      if (runtimeErrorCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(runtimeErrorCopyResetTimeoutRef.current)
      }
      runtimeErrorCopyResetTimeoutRef.current = window.setTimeout(() => {
        setRuntimeErrorCopiedToken((current) => (current === token ? null : current))
        runtimeErrorCopyResetTimeoutRef.current = null
      }, 2200)
    } catch (error) {
      pushRuntimeErrorReport(createRuntimeErrorReportBlock(error, {
        source: 'clipboard',
        title: 'Failed to copy runtime error',
        location: currentRoute,
      }))
    }
  }, [currentRoute, pushRuntimeErrorReport])

  const handleCopyRuntimeErrorReport = useCallback((reportId: string) => {
    const report = runtimeErrorReports.find((candidate) => candidate.id === reportId)
    if (!report) return
    void copyRuntimeErrorText(formatRuntimeErrorReportForClipboardBlock(report), report.id)
  }, [copyRuntimeErrorText, runtimeErrorReports])

  const handleCopyAllRuntimeErrors = useCallback(() => {
    if (runtimeErrorReports.length === 0) return
    void copyRuntimeErrorText(formatRuntimeErrorReportsForClipboardBlock(runtimeErrorReports), 'all')
  }, [copyRuntimeErrorText, runtimeErrorReports])

  const handleDismissRuntimeErrorReport = useCallback((reportId: string) => {
    setRuntimeErrorReports(prev => prev.filter(report => report.id !== reportId))
    setRuntimeErrorCopiedToken(prev => (prev === reportId ? null : prev))
  }, [])

  const handleClearRuntimeErrors = useCallback(() => {
    setRuntimeErrorReports([])
    setRuntimeErrorCopiedToken(null)
  }, [])

  const handleFatalRuntimeError = useCallback((report: RuntimeErrorReportBlock) => {
    pushRuntimeErrorReport(report)
  }, [pushRuntimeErrorReport])

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
  }, [isElectronDesktopSurface])

  useEffect(() => {
    return () => {
      if (runtimeErrorCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(runtimeErrorCopyResetTimeoutRef.current)
        runtimeErrorCopyResetTimeoutRef.current = null
      }
      if (debugToastTimerRef.current !== null) {
        window.clearTimeout(debugToastTimerRef.current)
        debugToastTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleWindowError = (event: Event) => {
      pushRuntimeErrorReport(captureWindowErrorReportBlock(event, currentRoute))
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      pushRuntimeErrorReport(captureUnhandledRejectionReportBlock(event, currentRoute))
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [currentRoute, pushRuntimeErrorReport])

  useEffect(() => {
    const marker = consumeRecentExcalidrawCrashMarkerBlock()
    if (!marker) return
    pushRuntimeErrorReport(createRuntimeErrorReportBlock(
      new Error(
        `Excalidraw edit mode exited unexpectedly while opening "${marker.path}" during stage "${marker.stage}". ` +
        'The app appears to have restarted before the editor finished stabilizing.'
      ),
      {
        source: 'session-recovery',
        title: 'Excalidraw edit mode exited unexpectedly',
        location: marker.path,
      },
    ))
  }, [pushRuntimeErrorReport])

  // Install console intercept + subscribe to debug log events
  useEffect(() => {
    installConsoleInterceptBlock()
    return addDebugLogListenerBlock((entry) => {
      setDebugLogEntries(prev => [...prev, entry].slice(-500))
      if (entry.level === 'error' || entry.level === 'warn') {
        setDebugUnreadCount(prev => prev + 1)
        setDebugToast(entry)
        if (debugToastTimerRef.current !== null) window.clearTimeout(debugToastTimerRef.current)
        debugToastTimerRef.current = window.setTimeout(() => {
          setDebugToast(null)
          debugToastTimerRef.current = null
        }, 5000)
      }
    })
  }, [])

  const openDebugPanel = useCallback(() => {
    setDebugPanelOpen(true)
    setDebugUnreadCount(0)
    setDebugToast(null)
    if (debugToastTimerRef.current !== null) {
      window.clearTimeout(debugToastTimerRef.current)
      debugToastTimerRef.current = null
    }
  }, [])

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
    const entries = await listMarkdownFileIndexEntries()
    // Recent-first so the empty-query palette surfaces what you touched last.
    entries.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
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
        mtime: entry.mtime || undefined,
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

  const handleExplorerSelectedColorChange = useCallback((nextColor: string) => {
    const normalized = nextColor.trim() || DEFAULT_EXPLORER_SELECTED_COLOR_BLOCK
    setExplorerSelectedColor(normalized)
    void setExplorerSelectedColorPreferenceOrch(normalized).catch((error) => {
      console.warn('[App] Failed to persist explorer selected color preference:', error)
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

  const handleWebullTabPreferencesChange = useCallback(async (label: string, iconText: string) => {
    const normalized = label.trim() || 'Webull'
    setWebullTabLabel(normalized)
    setWebullTabIconText(iconText.trim())
    try {
      await setWebullTabPreferencesOrch(normalized, iconText.trim())
    } catch (error) {
      console.warn('[App] Failed to persist Webull tab preferences:', error)
      throw error
    }
  }, [])

  const handleRequestVaultSwitch = useCallback(() => {
    setDrawerOpen(false)
    setCommandPaletteOpen(false)
    setVaultSwitchHardRefreshPending(true)
    setNeedsVaultSetup(true)
  }, [])

  useEffect(() => {
    if (needsVaultSetup) return
    void readUserProfileOrch().catch((error) => {
      console.warn('[App] Failed to warm user profile cache:', error)
    })
  }, [needsVaultSetup])

  useEffect(() => {
    if (!needsVaultSetup || !isElectron()) return
    if (vaultSwitchHardRefreshPending) return
    const persistedRoot = getStoredVaultRoot()?.trim()
    if (!persistedRoot) return
    setVaultRoot(persistedRoot)
    setNeedsVaultSetup(false)
  }, [needsVaultSetup, vaultSwitchHardRefreshPending])

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

  const runSyncAction = useCallback(async (
    mode: 'sync' | 'rebuild',
    options?: { source?: 'topbar' | 'background' },
  ) => {
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
        source: options?.source ?? 'topbar',
        requestedAt: Date.now(),
        vaultSyncAttempted: true,
        vaultSyncSucceeded: syncSucceeded,
      })
      setSyncActionRunning(null)
    }
  }, [needsVaultSetup, syncActionRunning])

  const handleSchedulerSettingsChange = useCallback((nextSettings: SchedulerSettingsBlock) => {
    const saved = writeSchedulerSettingsOrch(nextSettings)
    setSchedulerSettings(saved)
    // Persist to vault for cross-device sync
    void setSchedulerTasksPreferenceOrch(saved.tasks)
  }, [])

  const runScheduledTask = useCallback((task: ScheduledTaskBlock) => {
    writeScheduledTaskLastAttemptAtOrch(task.id, Date.now())
    if (task.action === 'vault_sync') {
      void runSyncAction('sync', { source: 'background' })
    }
  }, [runSyncAction])

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

  const handleNativeSync = useCallback(() => {
    void runSyncAction('sync')
  }, [runSyncAction])

  const handleNativeRebuild = useCallback(() => {
    void runSyncAction('rebuild')
  }, [runSyncAction])

  const handleNativeGitPush = useCallback(() => {
    void runGitAction('push')
  }, [runGitAction])

  const runCommandItem = useCallback((item: CommandItem) => {
    setCommandPaletteOpen(false)
    setCommandQuery('')
    navigate(resolveWorkspaceNavigationRoute(item.to))
  }, [navigate, resolveWorkspaceNavigationRoute])

  const openNativeCreateSurface = useCallback(() => {
    handleCreateWorkspaceTab()
    navigate('/new-thought')
  }, [handleCreateWorkspaceTab, navigate])

  const handleNativeTopDrawerNavItemTap = useCallback((navItemId: string) => {
    switch (navItemId) {
      case '/':
      case '/thinking-space':
      case '/new-thought':
      case '/git-insights':
      case '/ai/chat':
      case '/web':
      case '/webull':
      case '/thinking-organizer':
      case '/terminal':
      case '/settings':
      case '/tools':
      case '/personal-tools':
        navigate(resolveWorkspaceNavigationRoute(navItemId))
        return
      case 'search':
        openCommandPalette()
        return
      default:
        console.warn('[App] Unhandled native top drawer nav item:', navItemId)
    }
  }, [navigate, openCommandPalette, resolveWorkspaceNavigationRoute])

  const handleNativeSidebarToggle = useCallback(() => {
    switch (nativeSidebarControl.kind) {
      case 'thinking-space-sidebar':
        thinkingSpaceGoogleWorkspaceChromeBlock.dispatchToggle()
        return
      case 'chat-sidebar':
        chatSidebarChromeBlock.dispatchToggle()
        return
      case 'web-sidebar':
        webSidebarChromeBlock.dispatchToggle()
        return
      case 'organizer-sidebar':
        organizerSidebarChromeBlock.dispatchToggle()
        return
      case 'webull-sidebar':
        webullSidebarChromeBlock.dispatchToggle()
        return
      case 'new-thought-sidebar':
        newThoughtSidebarChromeBlock.dispatchToggle()
        return
      case 'settings-sidebar':
        settingsSidebarChromeBlock.dispatchToggle()
        return
      case 'drawer':
        setDrawerOpen(prev => !prev)
        return
      default:
        return
    }
  }, [nativeSidebarControl.kind])

  const handleNativeHeaderToggle = useCallback(() => {
    switch (nativeHeaderToolControl.kind) {
      case 'thinking-space-header':
        thinkingSpaceGoogleWorkspaceChromeBlock.dispatchToggleHeader()
        return
      case 'chat-header':
        chatSidebarChromeBlock.dispatchToggleHeader()
        return
      case 'web-header':
        webSidebarChromeBlock.dispatchToggleHeader()
        return
      case 'organizer-header':
        organizerSidebarChromeBlock.dispatchToggleHeader()
        return
      default:
        return
    }
  }, [nativeHeaderToolControl.kind])

  // Tab-switch perf tracing. Fires on ANY pathname change (catches tab
  // strip, sidebar nav, command palette). Logged via perfTraceBlock — gated
  // by `localStorage.thinkspc.perfTrace = '1'` or `?perfTrace=1`, so this is
  // safe to leave in production paths and zero-cost when disabled.
  const lastPathRef = useRef<string>(location.pathname)
  useLayoutEffect(() => {
    if (location.pathname === lastPathRef.current) return
    const prevPath = lastPathRef.current
    lastPathRef.current = location.pathname
    if (!perfTraceEnabled()) {
      tabSwitchPerfRef.current = null
      return
    }
    const click = tabSwitchPerfRef.current
    tabSwitchPerfRef.current = null
    const commitAt = performance.now()
    const startAt = click?.clickAt ?? commitAt
    const renderMs = commitAt - startAt
    const sourceLabel = click ? 'click→commit' : 'detect→commit'
    void measureFrameAndSettle(commitAt).then(({ paintMs, settleMs, settleCapped, mutationCount, topMutators, byAncestor }) => {
      const mutatorsLine = topMutators.length
        ? '\n  top mutators:\n' +
          topMutators.map(m =>
            `    ${String(m.count).padStart(4)}×  ${m.target}  [${m.kinds}]`,
          ).join('\n')
        : ''
      const ancestorsLine = byAncestor.length
        ? '\n  by surface ancestor:\n' +
          byAncestor.map(a => `    ${String(a.count).padStart(4)}×  ${a.ancestor}`).join('\n')
        : ''
      perfReport(`tab-switch ${prevPath} → ${location.pathname}`, {
        [sourceLabel]: renderMs,
        'commit→paint': paintMs,
        'commit→settle': settleCapped
          ? `${settleMs.toFixed(1)}ms (CAPPED — ongoing mutations)`
          : settleMs,
        mutations: `${mutationCount} total${mutatorsLine}${ancestorsLine}`,
        total: settleMs + renderMs,
      })
    })
  }, [location.pathname])

  // Boot banner — only logs if perf tracing is enabled. Makes it obvious that
  // the instrumented bundle is live without polluting normal sessions.
  useEffect(() => {
    logPerfTraceBootBanner()
  }, [])

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

    folderPickerPluginBlock.restoreBookmark().catch((err: unknown) => {
      console.warn('[App] Failed to restore bookmark, re-prompting vault setup:', err)
      setNeedsVaultSetup(true)
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
    if (routeOwnsMainScroll) return
    const mainElement = mainContentRef.current
    if (!mainElement) return
    mainElement.scrollTop = 0
    mainElement.scrollLeft = 0
  }, [activeWorkspaceTabId, currentRoute, routeOwnsMainScroll])

  useEffect(() => {
    if (!compactNav) {
      setDrawerOpen(false)
    }
  }, [compactNav])

  useEffect(() => {
    if (!compactNav || drawerOpen || keyboardVisible || tabOwnsSidebarSwipe || iPhoneMode) {
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
  }, [compactNav, drawerOpen, keyboardVisible, tabOwnsSidebarSwipe, iPhoneMode])

  useEffect(() => {
    if (keyboardVisible) {
      setDrawerOpen(false)
    }
  }, [keyboardVisible])

  useEffect(() => {
    if (!useNativeTopChrome) {
      setNativeTopBarCollapsed(false)
      setNativeBottomBarCollapsed(false)
      setNativeBottomBarHidden(false)
      nativeChromeScrollTargetRef.current = null
      nativeChromeLastScrollTopRef.current = 0
      return
    }

    if (keyboardVisible) {
      setNativeTopBarCollapsed(false)
      setNativeBottomBarCollapsed(false)
      setNativeBottomBarHidden(true)
      nativeChromeScrollTargetRef.current = null
      nativeChromeLastScrollTopRef.current = 0
      return
    }

    setNativeTopBarCollapsed(false)
    setNativeBottomBarCollapsed(false)
    setNativeBottomBarHidden(false)
    nativeChromeScrollTargetRef.current = null
    nativeChromeLastScrollTopRef.current = 0
  }, [currentRoute, keyboardVisible, useNativeTopChrome])


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
      if (withMeta && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        handleGlobalRefresh()
        return
      }
      // Cmd/Ctrl + <digit> jumps to a side-rail tab: 1..N follow rail order
      // (primary nav + Tools), 0 is Home. Driven by the same nav source as the
      // rail so they stay in sync. Works cleanly in Electron; on web the
      // browser may reserve these (tab switching / zoom reset).
      if (withMeta && /^Digit[0-9]$/.test(event.code)) {
        const digit = Number(event.code.slice(5))
        if (digit === 0) {
          event.preventDefault()
          navigate('/')
          return
        }
        const railTab = [...primaryNavItems, ...toolsNavItems][digit - 1]
        if (railTab) {
          event.preventDefault()
          navigate(resolveWorkspaceNavigationRoute(railTab.to))
        }
        return
      }
      if (event.key === 'Escape') {
        setCommandPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeWorkspaceTab, compactNav, handleCloseWorkspaceTab, handleCreateWorkspaceTab, handleGlobalRefresh, navigate, primaryNavItems, toolsNavItems])

  useNativeTopChromeBlock({
    enabled: useNativeTopChrome && !needsVaultSetup,
    title: activeWorkspaceTabLabel,
    activeNavItemId: nativeTopDrawerActiveNavItemId,
    topBarCollapsed: nativeTopBarCollapsed,
    topBarDark: nativeTopBarDark,
    bottomBarCollapsed: nativeBottomBarCollapsed,
    showSearch: true,
    showTools: true,
    toolsBadgeCount: debugUnreadCount,
    canToggleSidebar: nativeSidebarControl.enabled,
    sidebarToggleActive: nativeSidebarControl.active,
    sidebarToggleLabel: nativeSidebarControl.label,
    canToggleHeader: nativeHeaderToolControl.enabled,
    headerToggleLabel: nativeHeaderToolControl.label,
    tabs: nativeTabItems,
    bottomBarHidden: nativeBottomBarHidden || keyboardVisible,
    canRefresh: !refreshRunning && !needsVaultSetup,
    canSync: !syncActionRunning && !gitActionRunning && !needsVaultSetup,
    canRebuild: !syncActionRunning && !gitActionRunning && !needsVaultSetup,
    canGitCommit: !syncActionRunning && !gitActionRunning && !needsVaultSetup && gitSyncToolsSupported,
    canGitPush: !syncActionRunning && !gitActionRunning && !needsVaultSetup && gitSyncToolsSupported,
    webullTabLabel,
    onMenuTap: () => {
      // The mobile drawer is intentionally disabled on iPhone; iPad still
      // opens it from the native menu button. iPhone uses the bottom tab
      // bar + per-page sidebars for navigation instead.
      if (iPhoneMode) return
      setDrawerOpen(true)
    },
    onNavItemTap: handleNativeTopDrawerNavItemTap,
    onSearchTap: openCommandPalette,
    onOpenDebugTap: openDebugPanel,
    onRefreshTap: handleGlobalRefresh,
    onSyncTap: handleNativeSync,
    onRebuildTap: handleNativeRebuild,
    onGitCommitTap: openGitCommitDialog,
    onGitPushTap: handleNativeGitPush,
    onHeaderToggleTap: handleNativeHeaderToggle,
    onSidebarToggleTap: handleNativeSidebarToggle,
    onCreateTap: openNativeCreateSurface,
    onExpandBottomTap: () => setNativeBottomBarCollapsed(false),
    onSelectTab: handleSelectWorkspaceTab,
    onCloseTab: handleCloseWorkspaceTab,
  })

  // Native push transition bridge (iPhone shell). On non-Capacitor runtimes
  // this is a no-op subscription; the bridge calls just reject and never fire.
  // onRequestRender is what Swift asks for when it starts a push animation —
  // we delegate to react-router so the URL changes, ThinkingSpaceOrch (or any
  // other route consumer) updates, and the hook auto-commits to unblock Swift.
  useNativePushNavigationBlock({
    enabled: useNativeTopChrome,
    onRequestRender: (path) => {
      navigate(path)
    },
  })

  useEffect(() => {
    if (needsVaultSetup || !windowContext.isBackgroundAuthority) return
    return startVaultLiveRefresh(() => getStoredVaultRoot(), {
      onSynced: () => {
        setLastSyncedAt(getLastSyncTimestamp())
        setLastSyncAttemptAt(Date.now())
      },
    })
  }, [needsVaultSetup, windowContext.isBackgroundAuthority])

  useEffect(() => {
    if (needsVaultSetup || !windowContext.isBackgroundAuthority) return
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
  }, [needsVaultSetup, windowContext.isBackgroundAuthority])

  useEffect(() => {
    return () => {
      if (schedulerTimeoutRef.current !== null) {
        window.clearTimeout(schedulerTimeoutRef.current)
        schedulerTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (schedulerTimeoutRef.current !== null) {
      window.clearTimeout(schedulerTimeoutRef.current)
      schedulerTimeoutRef.current = null
    }

    if (needsVaultSetup || syncActionRunning || !windowContext.isBackgroundAuthority) return

    const enabledTasks = schedulerSettings.tasks.filter(task => task.enabled)
    if (enabledTasks.length === 0) return

    const nowMs = Date.now()
    const lastAttemptById = readScheduledTaskLastAttemptByIdOrch()
    let overdueTask: ScheduledTaskBlock | null = null
    let overdueRunAt = Number.POSITIVE_INFINITY
    let nextTask: ScheduledTaskBlock | null = null
    let nextRunAt = Number.POSITIVE_INFINITY

    for (const task of enabledTasks) {
      const previousRunAt = getPreviousScheduledTaskRunAtOrch(task, nowMs)
      const latestRecordedAttemptAt = task.action === 'vault_sync'
        ? Math.max(
            lastAttemptById[task.id] ?? 0,
            lastSyncAttemptAt ?? 0,
            lastSyncedAt ? lastSyncedAt * 1000 : 0,
          )
        : (lastAttemptById[task.id] ?? 0)

      if (previousRunAt && latestRecordedAttemptAt < previousRunAt && previousRunAt < overdueRunAt) {
        overdueRunAt = previousRunAt
        overdueTask = task
      }

      const candidateNextRunAt = getNextScheduledTaskRunAtOrch(task, nowMs)
      if (candidateNextRunAt && candidateNextRunAt < nextRunAt) {
        nextRunAt = candidateNextRunAt
        nextTask = task
      }
    }

    if (overdueTask) {
      runScheduledTask(overdueTask)
      return
    }

    if (!nextTask || !Number.isFinite(nextRunAt)) return

    schedulerTimeoutRef.current = window.setTimeout(() => {
      schedulerTimeoutRef.current = null
      runScheduledTask(nextTask)
    }, Math.max(1000, nextRunAt - nowMs))

    return () => {
      if (schedulerTimeoutRef.current !== null) {
        window.clearTimeout(schedulerTimeoutRef.current)
        schedulerTimeoutRef.current = null
      }
    }
  }, [lastSyncAttemptAt, lastSyncedAt, needsVaultSetup, runScheduledTask, schedulerSettings, syncActionRunning, windowContext.isBackgroundAuthority])

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
        setExplorerSelectedColor(preferences.explorerSelectedColor)
        setWebullTabLabel(preferences.webullTabLabel || 'Webull')
        setWebullTabIconText(preferences.webullTabIconText || '')
        // Sync scheduler tasks from vault (overrides localStorage)
        if (preferences.schedulerTasks.length > 0) {
          const vaultSchedulerSettings = sanitizeSchedulerSettingsOrch({
            tasks: preferences.schedulerTasks as unknown as ScheduledTaskBlock[],
          })
          setSchedulerSettings(vaultSchedulerSettings)
          writeSchedulerSettingsOrch(vaultSchedulerSettings)
        }
        // Sync file activity ignored paths from vault
        if (preferences.fileActivityIgnoredPaths.length > 0) {
          writeFileActivityIgnoredPaths(preferences.fileActivityIgnoredPaths)
        }
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

  useChromeStateEventBlock<ThinkingSpaceGoogleWorkspaceChromeStateBlock>(
    thinkingSpaceGoogleWorkspaceChromeBlock.stateEvent,
    (detail) => {
      setThinkingSpaceGoogleWorkspaceChromeState({
        enabled: Boolean(detail.enabled),
        explorerCollapsed: Boolean(detail.explorerCollapsed),
        headerVisible: Boolean(detail.headerVisible),
        showHeaderToggle: Boolean(detail.showHeaderToggle),
      })
    },
  )

  useChromeStateEventBlock<ChatSidebarChromeStateBlock>(
    chatSidebarChromeBlock.stateEvent,
    (detail) => {
      const nextLabel = typeof detail.label === 'string' ? detail.label : 'AI'
      setChatSidebarChromeState({
        enabled: Boolean(detail.enabled),
        collapsed: Boolean(detail.collapsed),
        headerVisible: detail.headerVisible !== false,
        showHeaderToggle: Boolean(detail.showHeaderToggle),
        label: nextLabel,
      })
      syncActiveWorkspaceTabLabel('/ai/chat', nextLabel)
    },
  )

  useChromeStateEventBlock<WebSidebarChromeStateBlock>(
    webSidebarChromeBlock.stateEvent,
    (detail) => {
      const nextLabel = typeof detail.label === 'string' ? detail.label : 'Web'
      setWebSidebarChromeState(prev => ({
        enabled: Boolean(detail.enabled),
        collapsed: Boolean(detail.collapsed),
        headerVisible: detail.headerVisible !== false,
        showHeaderToggle: Boolean(detail.showHeaderToggle),
        label: nextLabel,
        siteLabels: (detail.siteLabels && typeof detail.siteLabels === 'object') ? detail.siteLabels : prev.siteLabels,
      }))
      const currentNormalizedRoute = normalizeTabRoute(currentRouteRef.current)
      const pending = pendingWorkspaceTabNavigationRef.current
      if (pending && currentNormalizedRoute !== pending.route) return
      syncActiveWorkspaceTabLabel('/web', nextLabel)
    },
  )

  useChromeStateEventBlock<OrganizerSidebarChromeStateBlock>(
    organizerSidebarChromeBlock.stateEvent,
    (detail) => {
      setOrganizerSidebarChromeState({
        enabled: Boolean(detail.enabled),
        collapsed: Boolean(detail.collapsed),
        label: typeof detail.label === 'string' ? detail.label : 'Organizer',
        headerVisible: detail.headerVisible !== false,
        showHeaderToggle: Boolean(detail.showHeaderToggle),
      })
    },
  )

  useChromeStateEventBlock<WebullSidebarChromeStateBlock>(
    webullSidebarChromeBlock.stateEvent,
    (detail) => {
      setWebullSidebarChromeState({
        enabled: Boolean(detail.enabled),
        collapsed: Boolean(detail.collapsed),
        label: typeof detail.label === 'string' ? detail.label : 'webull',
      })
    },
  )

  useChromeStateEventBlock<ToolsSidebarChromeStateBlock>(
    toolsSidebarChromeBlock.stateEvent,
    (detail) => {
      setToolsSidebarChromeState({
        enabled: Boolean(detail.enabled),
        collapsed: Boolean(detail.collapsed),
        label: typeof detail.label === 'string' ? detail.label : 'Tools',
      })
    },
  )

  useChromeStateEventBlock<{ enabled: boolean; collapsed: boolean }>(
    newThoughtSidebarChromeBlock.stateEvent,
    (detail) => {
      setNewThoughtSidebarChromeState({
        enabled: Boolean(detail.enabled),
        collapsed: Boolean(detail.collapsed),
      })
    },
  )

  useChromeStateEventBlock<SettingsSidebarChromeStateBlock>(
    settingsSidebarChromeBlock.stateEvent,
    (detail) => {
      setSettingsSidebarChromeState({
        enabled: Boolean(detail.enabled),
        collapsed: Boolean(detail.collapsed),
        label: typeof detail.label === 'string' ? detail.label : 'Settings',
      })
    },
  )

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

  useEffect(() => {
    const appShellNode = appShellRef.current
    if (!appShellNode || !useNativeTopChrome || keyboardVisible) return

    const handleNativeChromeScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.scrollHeight <= target.clientHeight + 24) return

      const nextTop = Math.max(0, target.scrollTop)
      if (nativeChromeScrollTargetRef.current !== target) {
        nativeChromeScrollTargetRef.current = target
        nativeChromeLastScrollTopRef.current = nextTop
        if (nextTop < 24) {
          setNativeTopBarCollapsed(false)
          setNativeBottomBarCollapsed(false)
          setNativeBottomBarHidden(false)
        }
        return
      }

      const delta = nextTop - nativeChromeLastScrollTopRef.current
      nativeChromeLastScrollTopRef.current = nextTop

      if (nextTop < 24) {
        setNativeTopBarCollapsed(false)
        setNativeBottomBarCollapsed(false)
        setNativeBottomBarHidden(false)
        return
      }

      if (delta > 10 && nextTop > 72) {
        setNativeTopBarCollapsed(true)
        setNativeBottomBarCollapsed(true)
        setNativeBottomBarHidden(false)
      } else if (delta < -8) {
        setNativeTopBarCollapsed(false)
        setNativeBottomBarCollapsed(false)
        setNativeBottomBarHidden(false)
      }
    }

    appShellNode.addEventListener('scroll', handleNativeChromeScroll, { capture: true, passive: true })
    return () => {
      appShellNode.removeEventListener('scroll', handleNativeChromeScroll, true)
    }
  }, [keyboardVisible, useNativeTopChrome])

  const appContent = needsVaultSetup ? (
      <VaultSetup
        onComplete={(vaultRoot) => {
          setVaultRoot(vaultRoot)
          if (vaultSwitchHardRefreshPending) {
            window.location.reload()
            return
          }
          setNeedsVaultSetup(false)
        }}
      />
  ) : (
    <div
      ref={appShellRef}
      className="ltm-app-shell"
      style={shellSafeAreaVars}
      data-ltm-mode={layout.mode}
      data-ltm-surface={layout.surface}
      data-ltm-route={location.pathname}
      data-ltm-explorer-icon-style={explorerIconStyle}
      data-ltm-ios-phone={iPhoneHandsetMode ? 'true' : 'false'}
    >
      {explorerFolderColorCss && <style>{explorerFolderColorCss}</style>}
      <div className="ltm-shell-layer-base">
        <div
          className="ltm-shell-stage"
          style={topInset && !useNativeTopChrome ? { paddingTop: `calc(${topInset}px + var(--ltm-shell-inset))` } : undefined}
        >
        <section className="ltm-shell-main-stage">
          {!useNativeTopChrome && (
          <header className="ltm-shell-top-chrome ltm-shell-motion-chrome relative">
            <div
              className={`absolute left-0 top-0 z-20 flex h-full items-center justify-start [-webkit-app-region:drag] ${
                iPhoneMode ? 'pl-2' : 'pl-0.5'
              }`}
              style={{ width: `${phoneMode ? topChromeLeftWidth : topChromeBalancedWidth}px` }}
            >
              {showCapacitorTopChromeMenu && (
                <div ref={topChromeMenuRef} className="inline-flex items-center gap-2">
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

                  {capacitorMenuSidebarChromeButtons.map(cfg => cfg.show && (
                    <SidebarChromeButtonBlock
                      key={cfg.id}
                      block={cfg.block}
                      collapsed={cfg.collapsed}
                      headerVisible={cfg.headerVisible}
                      showHeaderToggle={cfg.showHeaderToggle}
                      toggleLabels={cfg.toggleLabels}
                      headerToggleLabels={cfg.headerToggleLabels}
                      variant={cfg.variant}
                      wrap={false}
                    />
                  ))}
                </div>
              )}

              {inlineSidebarChromeButtons.map(cfg => cfg.show && (
                <div
                  key={cfg.id}
                  className="inline-flex items-center gap-2"
                  style={{ marginLeft: `${googleWorkspaceChromeLeftOffsetPx}px` }}
                >
                  <SidebarChromeButtonBlock
                    block={cfg.block}
                    collapsed={cfg.collapsed}
                    headerVisible={cfg.headerVisible}
                    showHeaderToggle={cfg.showHeaderToggle}
                    toggleLabels={cfg.toggleLabels}
                    headerToggleLabels={cfg.headerToggleLabels}
                    variant={cfg.variant}
                    wrap={false}
                  />
                </div>
              ))}

              {leftAlignedSidebarChromeButtons.map(cfg => cfg.show && (
                <div
                  key={cfg.id}
                  className="inline-flex items-center gap-2"
                  style={{ marginLeft: `${googleWorkspaceChromeLeftOffsetPx}px` }}
                >
                  <SidebarChromeButtonBlock
                    block={cfg.block}
                    collapsed={cfg.collapsed}
                    headerVisible={cfg.headerVisible}
                    showHeaderToggle={cfg.showHeaderToggle}
                    toggleLabels={cfg.toggleLabels}
                    headerToggleLabels={cfg.headerToggleLabels}
                    variant={cfg.variant}
                    wrap={false}
                  />
                </div>
              ))}
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
              className="absolute top-0 z-20 flex h-full items-center justify-end gap-2 [-webkit-app-region:drag]"
              style={{
                right: `${topChromeRightAnchorInset}px`,
                width: `${phoneMode ? topChromeRightWidth : topChromeBalancedWidth}px`,
              }}
            >
              <div ref={syncToolsRef} className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={openCommandPalette}
                  className="ltm-top-chrome-capsule ltm-motion-fast inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/85 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Open quick search"
                  title={`Search (${isMacPlatform ? '\u2318K' : 'Ctrl+K'})`}
                >
                  <SearchNavIcon className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={handleGlobalRefresh}
                  disabled={refreshRunning || needsVaultSetup}
                  className={`ltm-top-chrome-capsule ltm-motion-fast inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background/85 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 ${
                    phoneMode ? 'w-8 px-0' : 'px-3'
                  }`}
                  aria-label="Refresh current workspace"
                  title={`Refresh current workspace (${isMacPlatform ? '⌘R' : 'Ctrl+R'})`}
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
                  className="ltm-top-chrome-capsule ltm-motion-fast relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/85 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="More tools"
                  title="More tools"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  {debugUnreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
                  )}
                </button>
              </div>
            </div>
          </header>
          )}
          <div className="ltm-shell-body-stage">
            {!compactNav && (
              <aside
                className={`ltm-shell-sidebar ltm-shell-nav-surface ltm-sidebar-collapsed hidden w-16 shrink-0 lg:block ${railEditMode ? 'ltm-rail-edit-mode' : ''}`}
                data-ltm-nav-region="rail"
                onClick={() => {
                  // Click anywhere in the rail finishes edit mode — except the
                  // × hide buttons (they stopPropagation) and the press that
                  // just entered it (suppressed above).
                  if (!railEditMode) return
                  if (suppressRailExitClickRef.current) { suppressRailExitClickRef.current = false; return }
                  setRailEditMode(false)
                }}
              >
                <TooltipProvider delayDuration={0}>
                <div className="flex h-full flex-col px-2 py-3">
                <div
                  className="ltm-nav-scroll ltm-sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto"
                  onDragOver={allowHomeRailDrop}
                  onDrop={dropHomeRailAt('top')}
                >
                  <div className="ltm-sidebar-nav-group space-y-1">
                    {navRailPrefs.homePosition !== 'bottom' && renderHomeRailItem()}
                    {primaryNavItems.map((item, index) => {
                      const Icon = item.icon
                      const active = isNavItemActive(location.pathname, item)
                      return (
                        <Tooltip key={item.to}>
                          <TooltipTrigger asChild>
                            <Link
                              to={resolveWorkspaceNavigationRoute(item.to)}
                              draggable={railEditMode}
                              onPointerDown={startRailLongPress}
                              onPointerUp={cancelRailLongPress}
                              onPointerLeave={cancelRailLongPress}
                              onClick={(event) => { if (railEditMode) event.preventDefault() }}
                              onDragStart={() => { railDraggedIdRef.current = item.to }}
                              onDragEnd={clearRailDraggedId}
                              onDragOver={(event) => { if (railEditMode) event.preventDefault() }}
                              onDrop={(event) => {
                                event.preventDefault()
                                const dragged = railDraggedIdRef.current
                                if (dragged && dragged !== '/') reorderNavRailItemBlock(primaryNavItems.map(entry => entry.to), dragged, item.to)
                              }}
                              className={`ltm-motion-fast ltm-touch-row ltm-rail-item ltm-rail-manageable relative flex items-center justify-center rounded-lg px-2 py-2 transition-colors ${
                                active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              }`}
                            >
                              <span className="relative inline-flex">
                                <Icon className={item.railIconClassName ?? RAIL_ICON_CLASS} />
                                {railEditMode && (
                                  <button
                                    type="button"
                                    aria-label={`Hide ${item.label} from this profile`}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      hideNavRailItemBlock(item.to)
                                    }}
                                    className="absolute -right-2.5 -top-2.5 z-10 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-neutral-700 text-[11px] font-bold leading-none text-white shadow-md ring-2 ring-[hsl(var(--background))]"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">{railEditMode ? 'Drag to reorder · × to hide · click away to finish' : `${item.label}${shortcutHint(index + 1)}`}</TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>

                  <div className="ltm-sidebar-nav-group space-y-1">
                    {toolsNavItems.map((item, index) => {
                      const Icon = item.icon
                      const active = isNavItemActive(location.pathname, item)
                      return (
                        <Tooltip key={item.to}>
                          <TooltipTrigger asChild>
                            <Link
                              to={item.to}
                              draggable={railEditMode}
                              onPointerDown={startRailLongPress}
                              onPointerUp={cancelRailLongPress}
                              onPointerLeave={cancelRailLongPress}
                              onClick={(event) => { if (railEditMode) event.preventDefault() }}
                              onDragStart={() => { railDraggedIdRef.current = item.to }}
                              onDragEnd={clearRailDraggedId}
                              onDragOver={(event) => { if (railEditMode) event.preventDefault() }}
                              onDrop={(event) => {
                                event.preventDefault()
                                const dragged = railDraggedIdRef.current
                                if (dragged && dragged !== '/') reorderNavRailItemBlock(toolsNavItems.map(entry => entry.to), dragged, item.to)
                              }}
                              className={`ltm-motion-fast ltm-touch-row ltm-rail-item ltm-rail-manageable relative flex items-center justify-center rounded-lg px-2 py-2 transition-colors ${
                                active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              }`}
                            >
                              <span className="relative inline-flex">
                                <Icon className="h-[18px] w-[18px]" />
                                {railEditMode && (
                                  <button
                                    type="button"
                                    aria-label={`Hide ${item.label} from this profile`}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      hideNavRailItemBlock(item.to)
                                    }}
                                    className="absolute -right-2.5 -top-2.5 z-10 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-neutral-700 text-[11px] font-bold leading-none text-white shadow-md ring-2 ring-[hsl(var(--background))]"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">{railEditMode ? 'Drag to reorder · × to hide · click away to finish' : `${item.label}${shortcutHint(primaryNavItems.length + 1 + index)}`}</TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                </div>

                <div
                  className="ltm-sidebar-actions"
                  onDragOver={allowHomeRailDrop}
                  onDrop={dropHomeRailAt('bottom')}
                >
                  <div className="ltm-sidebar-actions-group space-y-1">
                    {utilityNavItems.map((item) => {
                      const Icon = item.icon
                      const active = isNavItemActive(location.pathname, item)
                      return (
                        <Tooltip key={item.to}>
                          <TooltipTrigger asChild>
                            <Link
                              to={item.to}
                              className={`ltm-motion-fast ltm-touch-row ltm-rail-item flex items-center justify-center rounded-lg px-2 py-2 transition-colors ${
                                active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                              }`}
                            >
                              <Icon className={item.railIconClassName ?? RAIL_ICON_CLASS} />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      )
                    })}
                    <div className="mt-2">
                      <ProfileSwitcherBlock />
                    </div>
                    {navRailPrefs.homePosition === 'bottom' && renderHomeRailItem()}
                  </div>
                </div>
                </div>
                </TooltipProvider>
              </aside>
            )}
          <main
            ref={mainContentRef}
            className="ltm-app-main ltm-shell-main ltm-shell-content-stage"
            style={mainStageStyle}
          >
            <div className="relative h-full min-h-0">
              {renderedPersistentChatTabIds.map((tabId) => {
                const chatTabMounted = mountedTabIdSet.has(tabId)
                if (!chatTabMounted) return null
                const chatSurfaceActive = isChatRoute && activeWorkspaceTabId === tabId
                return (
                  <div
                    key={`chat-surface:${tabId}`}
                    className="absolute inset-0 overflow-hidden"
                    style={{ visibility: chatSurfaceActive ? 'visible' : 'hidden', pointerEvents: chatSurfaceActive ? 'auto' : 'none' }}
                    aria-hidden={!chatSurfaceActive}
                  >
                    <RouteActivityProviderBlock active={chatSurfaceActive}>
                      <FrozenRouteBlock active={chatSurfaceActive}>
                        <Chat active={chatSurfaceActive} />
                      </FrozenRouteBlock>
                    </RouteActivityProviderBlock>
                  </div>
                )
              })}
              {renderedPersistentWebTabIds.map((tabId) => {
                const webTabMounted = mountedTabIdSet.has(tabId)
                if (!webTabMounted) return null
                const webSurfaceActive = isWebRoute && activeWorkspaceTabId === tabId
                return (
                  <div
                    key={`web-surface:${tabId}`}
                    className="absolute inset-0 overflow-hidden"
                    style={{
                      visibility: webSurfaceActive ? 'visible' : 'hidden',
                      pointerEvents: webSurfaceActive ? 'auto' : 'none',
                    }}
                    aria-hidden={!webSurfaceActive}
                  >
                    <RouteActivityProviderBlock active={webSurfaceActive}>
                      <FrozenRouteBlock active={webSurfaceActive}>
                        <Web
                          active={webSurfaceActive}
                          selectedSiteId={persistentWebSiteIdByTabId[tabId] ?? null}
                          onSelectSiteId={getWebSiteSelectCallback(tabId)}
                        />
                      </FrozenRouteBlock>
                    </RouteActivityProviderBlock>
                  </div>
                )
              })}
              {persistentRouteMounts.organizer && (
                <div
                  className="absolute inset-0 min-h-0 overflow-y-auto overflow-x-hidden"
                  style={{ visibility: isOrganizerRoute ? 'visible' : 'hidden', pointerEvents: isOrganizerRoute ? 'auto' : 'none' }}
                  aria-hidden={!isOrganizerRoute}
                >
                  <RouteActivityProviderBlock active={isOrganizerRoute}>
                    <FrozenRouteBlock active={isOrganizerRoute}>
                      <ThinkingOrganizer active={isOrganizerRoute} />
                    </FrozenRouteBlock>
                  </RouteActivityProviderBlock>
                </div>
              )}
              {persistentRouteMounts.newThought && (
                <div
                  className="absolute inset-0 min-h-0 overflow-y-auto overflow-x-hidden"
                  style={{ visibility: isNewThoughtRoute ? 'visible' : 'hidden', pointerEvents: isNewThoughtRoute ? 'auto' : 'none' }}
                  aria-hidden={!isNewThoughtRoute}
                >
                  <RouteActivityProviderBlock active={isNewThoughtRoute}>
                    <FrozenRouteBlock active={isNewThoughtRoute}>
                      <NewThought />
                    </FrozenRouteBlock>
                  </RouteActivityProviderBlock>
                </div>
              )}
              {renderedPersistentThinkingSpaceTabIds.map((tabId) => {
                const thinkingSpaceTabMounted = mountedTabIdSet.has(tabId)
                if (!thinkingSpaceTabMounted) return null
                const thinkingSpaceSurfaceActive = isThinkingSpaceRoute && activeWorkspaceTabId === tabId
                const thinkingSpaceTabRoute = workspaceTabs.find((tab) => tab.id === tabId)?.route ?? '/thinking-space'
                return (
                  <div
                    key={`thinking-space-surface:${tabId}`}
                    className="absolute inset-0 min-h-0 overflow-hidden"
                    style={{ visibility: thinkingSpaceSurfaceActive ? 'visible' : 'hidden', pointerEvents: thinkingSpaceSurfaceActive ? 'auto' : 'none' }}
                    aria-hidden={!thinkingSpaceSurfaceActive}
                  >
                    <RouteActivityProviderBlock active={thinkingSpaceSurfaceActive}>
                      <FrozenRouteBlock active={thinkingSpaceSurfaceActive}>
                        <ThinkingSpace active={thinkingSpaceSurfaceActive} routeOverride={thinkingSpaceTabRoute} />
                      </FrozenRouteBlock>
                    </RouteActivityProviderBlock>
                  </div>
                )
              })}
              {persistentRouteMounts.webull && (
                <div
                  className="absolute inset-0 min-h-0 overflow-y-auto overflow-x-hidden"
                  style={{ visibility: isWebullRoute ? 'visible' : 'hidden', pointerEvents: isWebullRoute ? 'auto' : 'none' }}
                  aria-hidden={!isWebullRoute}
                >
                  <RouteActivityProviderBlock active={isWebullRoute}>
                    <FrozenRouteBlock active={isWebullRoute}>
                      <WebullPage pageLabel={webullTabLabel} />
                    </FrozenRouteBlock>
                  </RouteActivityProviderBlock>
                </div>
              )}
              {!usesPersistentRouteSurface && (
                <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
                <Routes>
                  {/* Electron uses the canvas home; web + iPhone keep
                      the classic dashboard home.
                      The /home-canvas route stays accessible on all platforms
                      so the canvas can be tested from any client. */}
                  <Route path="/" element={isElectron() ? <HomeCanvas /> : <Home />} />
                  <Route path="/home-canvas" element={<HomeCanvas />} />
                  <Route path="/ai" element={<Navigate to="/ai/chat" replace />} />
                  <Route path="/ai/schedules/*" element={<Schedules />} />
                  <Route path="/chat" element={<Navigate to="/ai/chat" replace />} />
                  <Route path="/thinking-space" element={<ThinkingSpace />} />
                  {/* Vault Graph is a top-level rail destination — standalone,
                      outside the Tools shell so it carries no tools subtab bar. */}
                  <Route path="/vault-graph" element={<VaultGraph />} />
                  <Route element={<ToolsShellBlock />}>
                    <Route path="/tools" element={<ToolsLandingBlock />} />
                    <Route path="/excalidraw-plus" element={<ExcalidrawPlus />}>
                      <Route index element={<Navigate to="plugin" replace />} />
                      <Route path="plugin" element={<ExcalidrawPlugin />} />
                      <Route path="format" element={<FormatExcalidraw />} />
                      <Route path="mindmap" element={<MindmapBuilder />} />
                      <Route path="pdf" element={<PdfToMarkdown />} />
                      <Route path="transcript" element={<TranscriptCleaner />} />
                    </Route>
                    <Route path="/terminal" element={terminalSupported ? <TerminalPage /> : <Navigate to="/settings?tab=developer" replace />} />
                    <Route path="/password-manager" element={<PasswordManager />} />
                    <Route path="/personal-tools" element={<PersonalToolsPage />} />
                    <Route path="/personal-extension" element={<Navigate to="/personal-tools" replace />} />
                    <Route path="/git-insights" element={<GitInsights />} />
                    <Route path="/capabilities" element={<CapabilityDiscovery />} />
                    <Route
                      path="/extension-builder"
                      element={extensionBuilderEnabled ? <ExtensionBuilder /> : <Navigate to="/capabilities" replace />}
                    />
                    <Route
                      path="/ai-steward"
                      element={
                        <div className="ltm-page">
                          <div className="ltm-page-shell ltm-shell-wide">
                            <header className="mb-6">
                              <h1 className="text-2xl font-semibold tracking-tight">AI Steward</h1>
                              <p className="text-muted-foreground">Review and act on steward proposals across the vault.</p>
                            </header>
                            <StewardQueueOrch />
                          </div>
                        </div>
                      }
                    />
                    <Route
                      path="/ai-integrity"
                      element={
                        <div className="ltm-page">
                          <div className="ltm-page-shell ltm-shell-wide">
                            <header className="mb-6">
                              <h1 className="text-2xl font-semibold tracking-tight">AI Integrity Fix</h1>
                              <p className="text-muted-foreground">Detect and repair organizer integrity issues.</p>
                            </header>
                            <OrganizerIntegrityOrch />
                          </div>
                        </div>
                      }
                    />
                  </Route>
                  <Route path="/excalidraw-plugin" element={<Navigate to="/excalidraw-plus/plugin" replace />} />
                  <Route path="/format-excalidraw" element={<Navigate to="/excalidraw-plus/format" replace />} />
                  <Route path="/mindmap-builder" element={<Navigate to="/excalidraw-plus/mindmap" replace />} />
                  <Route path="/pdf-to-markdown" element={<Navigate to="/excalidraw-plus/pdf" replace />} />
                  <Route path="/transcript-cleaner" element={<Navigate to="/excalidraw-plus/transcript" replace />} />
                  <Route path="/webull" element={<WebullPage pageLabel={webullTabLabel} />} />
                  <Route
                    path="/settings"
                    element={
                      <Settings
                        explorerIconStyle={explorerIconStyle}
                        onExplorerIconStyleChange={handleExplorerIconStyleChange}
                        explorerFolderColorRules={explorerFolderColorRules}
                        onExplorerFolderColorRulesChange={handleExplorerFolderColorRulesChange}
                        explorerSelectedColor={explorerSelectedColor}
                        onExplorerSelectedColorChange={handleExplorerSelectedColorChange}
                        schedulerSettings={schedulerSettings}
                        onSchedulerSettingsChange={handleSchedulerSettingsChange}
                        onRequestVaultSwitch={handleRequestVaultSwitch}
                        webullTabLabel={webullTabLabel}
                        webullTabIconText={webullTabIconText}
                        onWebullTabPreferencesChange={handleWebullTabPreferencesChange}
                      />
                    }
                  />
                  <Route path="/ai-settings" element={<Navigate to="/settings?tab=ai" replace />} />
                </Routes>
                </Suspense>
              )}
            </div>
          </main>
          </div>
          </section>
        </div>
      </div>

      {compactNav && !drawerOpen && !isCapacitorSurface && !iPhoneMode && (
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

      {compactNav && drawerOpen && !iPhoneMode && (
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
                  {primaryNavItems.map((item) => {
                    const Icon = item.icon
                    const active = isNavItemActive(location.pathname, item)
                    return (
                      <Link
                        key={item.to}
                        to={resolveWorkspaceNavigationRoute(item.to)}
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

                <div className="mt-5 space-y-1 border-t border-border/60 pt-3">
                  {(() => {
                    const Icon = TOOLS_NAV_ITEM.icon
                    const active = isNavItemActive(location.pathname, TOOLS_NAV_ITEM)
                    return (
                      <Link
                        to={TOOLS_NAV_ITEM.to}
                        onClick={() => setDrawerOpen(false)}
                        className={`ltm-motion-fast ltm-touch-row flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="truncate">{TOOLS_NAV_ITEM.label}</span>
                      </Link>
                    )
                  })()}
                  {(() => {
                    const Icon = VAULT_GRAPH_NAV_ITEM.icon
                    const active = isNavItemActive(location.pathname, VAULT_GRAPH_NAV_ITEM)
                    return (
                      <Link
                        to={VAULT_GRAPH_NAV_ITEM.to}
                        onClick={() => setDrawerOpen(false)}
                        className={`ltm-motion-fast ltm-touch-row flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="truncate">{VAULT_GRAPH_NAV_ITEM.label}</span>
                      </Link>
                    )
                  })()}
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
                  <SearchNavIcon className="h-4 w-4" />
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Sync</p>
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

            <div className="my-1 h-px bg-slate-200" />

            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Developer</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full justify-start border-transparent bg-white text-slate-900 hover:bg-slate-50"
                onClick={() => {
                  setSyncPanelOpen(false)
                  openDebugPanel()
                }}
              >
                <Bug className="mr-1.5 h-3.5 w-3.5" />
                Debug Console
                {debugUnreadCount > 0 && (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {debugUnreadCount > 99 ? '99+' : debugUnreadCount}
                  </span>
                )}
              </Button>
            </div>

            {(() => {
              const syncActionError = lastSyncSummary?.error?.trim()
              const syncEntryErrors = lastSyncSummary?.result?.errors ?? []
              const gitError = lastGitActionSummary?.error?.trim()
              const hasAnyError = Boolean(syncActionError || gitError || syncEntryErrors.length > 0)
              if (!hasAnyError) return null

              return (
                <div className="rounded-md bg-red-50 dark:bg-red-500/20 p-2 text-[10px] text-red-700 dark:text-red-300">
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
            onClick={closeCommandPalette}
          >
            <div
              className={`ltm-cmd-card ltm-shell-command-card ltm-shell-command-surface ltm-shell-motion-modal w-full max-w-3xl overflow-hidden rounded-2xl ${iPhoneMode ? 'max-h-[55vh]' : 'max-h-full'}`}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-3">
                <UniversalSearchBlock
                  {...UNIVERSAL_SEARCH_COMMAND_MODAL_PRESET_BLOCK}
                  items={iPhoneMode && !commandQuery.trim() ? [] : allCommandItems}
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
                  getItemRankBoost={(item) => recencyRankBoostBlock(item.mtime)}
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

  return (
    <RuntimeErrorBoundaryBlock
      location={currentRoute}
      onError={handleFatalRuntimeError}
      renderFallback={(report) => {
        const fallbackReports = runtimeErrorReports.some(existing => sameRuntimeErrorReport(existing, report))
          ? runtimeErrorReports
          : [report, ...runtimeErrorReports]
        return (
          <RuntimeErrorSurfaceBlock
            reports={fallbackReports}
            fatalReport={report}
            copiedToken={runtimeErrorCopiedToken}
            onCopyReport={(reportId) => {
              const matched = reportId === report.id
                ? report
                : fallbackReports.find((candidate) => candidate.id === reportId)
              if (!matched) return
              void copyRuntimeErrorText(formatRuntimeErrorReportForClipboardBlock(matched), matched.id)
            }}
            onCopyAll={() => {
              void copyRuntimeErrorText(formatRuntimeErrorReportsForClipboardBlock(fallbackReports), 'all')
            }}
            onDismissReport={handleDismissRuntimeErrorReport}
            onClearReports={handleClearRuntimeErrors}
            onReloadApp={() => window.location.reload()}
          />
        )
      }}
    >
      <>
        {appContent}
        <BackgroundActivityBannerBlock />
        <RuntimeErrorSurfaceBlock
          reports={runtimeErrorReports}
          copiedToken={runtimeErrorCopiedToken}
          onCopyReport={handleCopyRuntimeErrorReport}
          onCopyAll={handleCopyAllRuntimeErrors}
          onDismissReport={handleDismissRuntimeErrorReport}
          onClearReports={handleClearRuntimeErrors}
        />
        <DebugPanelBlock
          entries={debugLogEntries}
          isOpen={debugPanelOpen}
          onClose={() => setDebugPanelOpen(false)}
          onClear={() => { setDebugLogEntries([]); setDebugUnreadCount(0) }}
        />
        {debugToast && (
          <div
            className="pointer-events-none fixed right-4 z-[100]"
            style={{ bottom: 'calc(var(--ltm-safe-bottom, 0px) + 5.5rem)' }}
          >
            <DebugToastBlock
              entry={debugToast}
              onDismiss={() => {
                setDebugToast(null)
                if (debugToastTimerRef.current !== null) {
                  window.clearTimeout(debugToastTimerRef.current)
                  debugToastTimerRef.current = null
                }
              }}
              onOpenPanel={openDebugPanel}
            />
          </div>
        )}
      </>
    </RuntimeErrorBoundaryBlock>
  )
}

export default App
