import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PanelLeftClose, FileText, Rss as RssIcon } from 'lucide-react'
import VaultExplorerBlock, { type VaultExplorerHandle } from '@/components/lego_blocks/integrations/VaultExplorerBlock'
import MarkdownDocumentBlock, { type MarkdownViewerMode } from '@/components/lego_blocks/integrations/MarkdownDocumentLazyBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useIosSidebarSwipeBlock } from '@/components/lego_blocks/hooks/shared/useIosSidebarSwipeBlock'
import { useNativeBackHandlerBlock } from '@/components/lego_blocks/hooks/shared/useNativeBackHandlerBlock'
import { useSessionTelemetryBlock } from '@/components/lego_blocks/hooks/units/useSessionTelemetryBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/lego_blocks/units/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  createDrawingOrch,
  createFileOrch,
  createFolderOrch,
  deleteVaultPathOrch,
  duplicateFileOrch,
  getAbsolutePathForClipboardOrch,
  listFolderEntries,
  readFileTooltipMeta,
  moveVaultPathOrch,
  openFileInNewTabOrch,
  openFileInNewWindowOrch,
  renameVaultPathOrch,
  revealVaultPathOrch,
} from '@/services/orchestrators/fileSystemOrch'
import { STORAGE_KEYS, getStorageItem, setStorageItem } from '@/services/orchestrators/storageOrch'
import { isCapacitorNative } from '@/services/lego_blocks/integrations/fsBlock'
import {
  popNativeNavigationBlock,
  pushNativeNavigationBlock,
  pushNativeWithForwardBlock,
  setNativeNavigationStackBlock,
} from '@/services/lego_blocks/units/topChromeNativeBridgeBlock'
import {
  shouldCloseDrawerFromSwipeBlock,
  shouldIgnoreEdgeSwipeFromTargetBlock,
  shouldOpenDrawerFromSwipeBlock,
  shouldStartEdgeSwipeOpenBlock,
} from '@/services/lego_blocks/units/uiGestureBlock'
import {
  dispatchThinkingSpaceGoogleWorkspaceChromeStateBlock,
  THINKING_SPACE_GOOGLE_WORKSPACE_TOGGLE_EXPLORER_EVENT_BLOCK,
  THINKING_SPACE_GOOGLE_WORKSPACE_TOGGLE_HEADER_EVENT_BLOCK,
} from '@/services/lego_blocks/units/thinkingSpaceGoogleWorkspaceChromeBlock'
import { dispatchGlobalSyncRefreshBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import { createUrlShortcutOrch } from '@/services/orchestrators/urlShortcutOrch'
import { getNodeByPath } from '@/services/lego_blocks/integrations/dbBlock'
import RssFeedPanelBlock from '@/components/lego_blocks/integrations/RssFeedPanelBlock'
import RssArticleViewBlock from '@/components/lego_blocks/integrations/RssArticleViewBlock'
import UrlDocumentBlock from '@/components/lego_blocks/integrations/UrlDocumentBlock'
import RuledNotebookDocumentBlock from '@/components/lego_blocks/integrations/RuledNotebookDocumentBlock'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import type { UILayoutState } from '@/services/lego_blocks/units/uiLayoutBlock'
import NotebookViewOrch from '@/components/orchestrators/NotebookViewOrch'
import type { PathGraphTarget } from '@/components/lego_blocks/integrations/PathGraphSlideOverBlock'

// Lazy — pulls VaultGraphCanvasBlock (which dynamically imports force-graph),
// so the graph never enters the eager Thinking Space chunk.
const PathGraphSlideOverBlock = lazy(() => import('@/components/lego_blocks/integrations/PathGraphSlideOverBlock'))

function dispatchFileOpRefresh(): void {
  dispatchGlobalSyncRefreshBlock({
    source: 'unknown',
    requestedAt: Date.now(),
    vaultSyncAttempted: false,
    vaultSyncSucceeded: false,
  })
}

const FILE_QUERY_PARAM = 'file'
const NOTEBOOK_QUERY_PARAM = 'notebook'
const RULED_NOTEBOOK_QUERY_PARAM = 'ruledNotebook'
const MAX_MOUNTED_INLINE_DOCS = 3
const EXPLORER_DEFAULT_WIDTH_PX = 320
const EXPLORER_MIN_WIDTH_PX = 220
const IPHONE_EXPLORER_DEFAULT_WIDTH_PX = 380
const IPHONE_EXPLORER_MIN_WIDTH_PX = 300
const IPHONE_EXPLORER_RIGHT_GUTTER_PX = 36

function leafNameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? path : path.slice(idx + 1)
}

function remapPathAfterMove(path: string, sourcePath: string, targetPath: string): string {
  if (path === sourcePath) return targetPath
  if (!path.startsWith(`${sourcePath}/`)) return path
  const suffix = path.slice(sourcePath.length + 1)
  return suffix ? `${targetPath}/${suffix}` : targetPath
}

function isSameOrChildPath(path: string, candidateParent: string): boolean {
  if (!candidateParent) return true
  return path === candidateParent || path.startsWith(`${candidateParent}/`)
}

function resolveExplorerDefaultWidthPx(layout: UILayoutState): number {
  if (layout.surface === 'capacitor-ios' && layout.mode === 'phone') {
    return Math.min(IPHONE_EXPLORER_DEFAULT_WIDTH_PX, Math.max(IPHONE_EXPLORER_MIN_WIDTH_PX, layout.viewport.width - IPHONE_EXPLORER_RIGHT_GUTTER_PX))
  }
  return EXPLORER_DEFAULT_WIDTH_PX
}

function clampExplorerWidthPx(value: number, layout?: UILayoutState): number {
  const defaultWidth = layout ? resolveExplorerDefaultWidthPx(layout) : EXPLORER_DEFAULT_WIDTH_PX
  if (!Number.isFinite(value)) return defaultWidth

  if (layout?.surface === 'capacitor-ios' && layout.mode === 'phone') {
    const maxWidth = Math.max(IPHONE_EXPLORER_MIN_WIDTH_PX, layout.viewport.width - IPHONE_EXPLORER_RIGHT_GUTTER_PX)
    return Math.min(maxWidth, Math.max(IPHONE_EXPLORER_MIN_WIDTH_PX, value))
  }

  return Math.max(EXPLORER_MIN_WIDTH_PX, value)
}

function isGoogleWorkspacePathBlock(path: string | null): boolean {
  if (!path) return false
  return /\.(gdoc|gdoc\.json|gsheet|gsheet\.json)$/i.test(path)
}

function readThinkingSpaceRouteParamBlock(route: string | null | undefined, key: string): string | null {
  if (!route) return null
  try {
    const parsed = new URL(route.startsWith('/') ? route : `/${route}`, 'https://ltm.local')
    return parsed.searchParams.get(key)?.trim() || null
  } catch {
    return null
  }
}

interface ThinkingSpaceOrchProps {
  routeOverride?: string
}

/** The last path segment of an absolute vault root, for the vault footer label. */
function getVaultDisplayName(root: string): string {
  const segments = root.replace(/[\\/]+$/, '').split(/[\\/]+/)
  return segments[segments.length - 1] || root
}

/**
 * The bottom bar under the explorer tree. Shows the current vault's name (no
 * icon); hovering reveals the full path + hint, clicking collapses the whole
 * tree. Falls back to an empty spacer when there's no vault root, so the bar's
 * reserved height is preserved.
 */
function VaultFooterBar({ vaultRoot, onCollapse }: { vaultRoot: string | null; onCollapse: () => void }) {
  if (!vaultRoot) {
    return (
      <div className="shrink-0 border-t border-border/50 px-2 py-1.5">
        <div className="h-7" aria-hidden="true" />
      </div>
    )
  }
  const name = getVaultDisplayName(vaultRoot)
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onCollapse}
            aria-label={`${name} — collapse all folders`}
            className="flex h-10 w-full shrink-0 items-center border-t border-border/50 px-4 text-left text-xs text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-muted-foreground"
          >
            <span className="truncate font-normal">{name}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-0.5">
            <div>Your Thinking Space folder: {name}</div>
            <div className="break-all text-[11px] text-muted-foreground">{vaultRoot}</div>
            <div className="pt-0.5 text-[11px] text-muted-foreground">Click to collapse all folders</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function ThinkingSpaceOrch({ routeOverride }: ThinkingSpaceOrchProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const inlinePathFromRoute = routeOverride !== undefined
    ? readThinkingSpaceRouteParamBlock(routeOverride, FILE_QUERY_PARAM)
    : (searchParams.get(FILE_QUERY_PARAM)?.trim() || null)
  const { layout } = useUILayoutBlock()
  // Latest-AI-session dots + count strip for the explorer trees.
  const sessionTelemetry = useSessionTelemetryBlock()
  const [inlinePath, setInlinePath] = useState<string | null>(inlinePathFromRoute)
  const [mountedInlinePaths, setMountedInlinePaths] = useState<string[]>(
    () => (inlinePathFromRoute ? [inlinePathFromRoute] : []),
  )
  const [inlineInitialModeByPath, setInlineInitialModeByPath] = useState<Record<string, MarkdownViewerMode>>(
    () => (inlinePathFromRoute ? { [inlinePathFromRoute]: 'view' } : {}),
  )
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false)
  const [graphPeekTarget, setGraphPeekTarget] = useState<PathGraphTarget | null>(null)
  const [rssPanelOpen, setRssPanelOpen] = useState(false)
  const [browserUrl, setBrowserUrl] = useState<string | null>(null)
  const [rssActiveArticle, setRssActiveArticle] = useState<{
    item: RssFeedItemBlock
    onItemUpdate: (updated: RssFeedItemBlock) => void
    onItemRemove: () => void
    presetTags: string[]
    tagColors: Record<string, string>
  } | null>(null)
  const notebookPathFromRoute = routeOverride !== undefined
    ? readThinkingSpaceRouteParamBlock(routeOverride, NOTEBOOK_QUERY_PARAM)
    : (searchParams.get(NOTEBOOK_QUERY_PARAM)?.trim() || null)
  const [notebookFolderPath, setNotebookFolderPath] = useState<string | null>(notebookPathFromRoute)
  const ruledNotebookPathFromRoute = routeOverride !== undefined
    ? readThinkingSpaceRouteParamBlock(routeOverride, RULED_NOTEBOOK_QUERY_PARAM)
    : (searchParams.get(RULED_NOTEBOOK_QUERY_PARAM)?.trim() || null)
  const [ruledNotebookFilePath, setRuledNotebookFilePath] = useState<string | null>(ruledNotebookPathFromRoute)
  const [linkPromptOpen, setLinkPromptOpen] = useState(false)
  const linkPromptResolveRef = useRef<((url: string | null) => void) | null>(null)
  const [isExplorerResizing, setIsExplorerResizing] = useState(false)
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)
  // This window's vault root (per-profile). Read once — a profile/vault switch
  // reloads the window — and shown as an unintrusive footer below the explorer.
  const [vaultRootPath] = useState<string | null>(() => getStorageItem(STORAGE_KEYS.vaultRoot))
  const explorerHandleRef = useRef<VaultExplorerHandle>(null)
  const [inlineDocHeaderHidden, setInlineDocHeaderHidden] = useState(false)
  const [explorerWidthPx, setExplorerWidthPx] = useState(() => {
    const raw = getStorageItem(STORAGE_KEYS.thinkingSpaceExplorerWidthPx)
    if (!raw) return resolveExplorerDefaultWidthPx(layout)
    const parsed = Number.parseInt(raw, 10)
    return clampExplorerWidthPx(parsed, layout)
  })
  const edgeSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const drawerSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const explorerResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const isIosSurface = layout.surface === 'capacitor-ios'
  const isIPhoneIosSurface = isIosSurface && layout.mode === 'phone'
  const forceCompactForIosKeyboard = isIosSurface && layout.keyboardVisible
  const showInlineSidebar = layout.hasSidebar && !forceCompactForIosKeyboard
  // On iOS, always use the inline sidebar regardless of hasSidebar (portrait iPad, etc.)
  const iosInlineMode = isIosSurface && !forceCompactForIosKeyboard
  const showCollapsedInlineExplorer = (showInlineSidebar || iosInlineMode) && !explorerCollapsed

  // iPhone push-nav UX: the orchestrator is either showing the explorer (list
  // mode) or showing a single document/page (detail mode) — never split. The
  // push transition slides between these full-screen states. This collapses
  // the desktop split layout into two mutually-exclusive iPhone screens.
  const hasInlineContentForPhone = !!(inlinePath || ruledNotebookFilePath || notebookFolderPath || rssActiveArticle || browserUrl)
  const phoneListMode = isIPhoneIosSurface && !hasInlineContentForPhone
  const phoneDetailMode = isIPhoneIosSurface && hasInlineContentForPhone

  // Generic "go back" for the iPhone push-nav system. Closes whatever
  // content is currently showing in the document stage, in display-priority
  // order (matches the conditional render below). The native back chevron +
  // edge-swipe invoke this via the back-handler registry; each tab
  // orchestrator registers its own cascade so back works for every content
  // type, not just URL-routed ones.
  useNativeBackHandlerBlock({
    active: phoneDetailMode,
    onBack: () => {
      if (rssActiveArticle) {
        setRssActiveArticle(null)
        return
      }
      if (browserUrl) {
        setBrowserUrl(null)
        return
      }
      if (ruledNotebookFilePath) {
        setRuledNotebookFilePath(null)
        return
      }
      if (notebookFolderPath) {
        setNotebookFolderPath(null)
        return
      }
      if (inlinePath) {
        setInlinePath(null)
        setMountedInlinePaths([])
        setInlineInitialModeByPath({})
      }
    },
  })

  const isGoogleWorkspaceInlinePath = isGoogleWorkspacePathBlock(inlinePath)
  const useInstantExplorerToggle = showInlineSidebar && isGoogleWorkspaceInlinePath
  const [rssUrlBarVisible, setRssUrlBarVisible] = useState(!isIosSurface)
  const inlineExplorerTitle = isIPhoneIosSurface ? 'Explorer' : 'Thinking Space Explorer'

  const rememberMountedInlinePath = useCallback((path: string, initialMode: MarkdownViewerMode) => {
    setMountedInlinePaths((prev) => {
      if (prev.includes(path)) return prev
      const next = [...prev, path]
      return next.length > MAX_MOUNTED_INLINE_DOCS ? next.slice(1) : next
    })
    setInlineInitialModeByPath((prev) => (prev[path] ? prev : { ...prev, [path]: initialMode }))
  }, [])

  const removeMountedInlinePath = useCallback((path: string) => {
    setMountedInlinePaths((prev) => prev.filter((item) => item !== path))
    setInlineInitialModeByPath((prev) => {
      if (!(path in prev)) return prev
      const next = { ...prev }
      delete next[path]
      return next
    })
  }, [])

  const replaceMountedInlinePath = useCallback((fromPath: string, toPath: string) => {
    setMountedInlinePaths((prev) => {
      let changed = false
      const replaced = prev.map((item) => {
        if (item !== fromPath) return item
        changed = true
        return toPath
      })
      if (!changed) return prev
      const deduped: string[] = []
      for (const item of replaced) {
        if (!deduped.includes(item)) deduped.push(item)
      }
      return deduped
    })
    setInlineInitialModeByPath((prev) => {
      if (!(fromPath in prev)) return prev
      if (toPath in prev) {
        const next = { ...prev }
        delete next[fromPath]
        return next
      }
      const next = { ...prev, [toPath]: prev[fromPath] }
      delete next[fromPath]
      return next
    })
  }, [])

  useEffect(() => {
    setInlineInitialModeByPath((prev) => {
      const mounted = new Set(mountedInlinePaths)
      let changed = false
      const next: Record<string, MarkdownViewerMode> = {}
      for (const [path, mode] of Object.entries(prev)) {
        if (!mounted.has(path)) {
          changed = true
          continue
        }
        next[path] = mode
      }
      return changed ? next : prev
    })
  }, [mountedInlinePaths])

  useEffect(() => {
    if (inlinePathFromRoute === inlinePath) return
    setInlinePath(inlinePathFromRoute)
    if (inlinePathFromRoute) {
      rememberMountedInlinePath(inlinePathFromRoute, 'view')
    }
  }, [inlinePath, inlinePathFromRoute, rememberMountedInlinePath])

  useEffect(() => {
    if (notebookPathFromRoute === notebookFolderPath) return
    setNotebookFolderPath(notebookPathFromRoute)
  }, [notebookFolderPath, notebookPathFromRoute])

  useEffect(() => {
    if (ruledNotebookPathFromRoute === ruledNotebookFilePath) return
    setRuledNotebookFilePath(ruledNotebookPathFromRoute)
  }, [ruledNotebookFilePath, ruledNotebookPathFromRoute])

  const setInlinePathAndSyncUrl = useCallback((path: string | null, mode: MarkdownViewerMode = 'view') => {
    if (path) {
      rememberMountedInlinePath(path, mode)
      setBrowserUrl(null) // clear browser URL when opening a file
      setRssActiveArticle(null)
    }
    setInlinePath(path)
    setNotebookFolderPath(null)
    setRuledNotebookFilePath(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (path) {
        next.set(FILE_QUERY_PARAM, path)
      } else {
        next.delete(FILE_QUERY_PARAM)
      }
      next.delete(NOTEBOOK_QUERY_PARAM)
      next.delete(RULED_NOTEBOOK_QUERY_PARAM)
      return next
    }, { replace: true })
  }, [rememberMountedInlinePath, setSearchParams])

  const handleInlineDocumentClose = useCallback(() => {
    // iPhone: pop the native stack so the file viewer slides off to the right
    // with the UIKit animation. React state cleanup happens automatically when
    // Swift fires topChromeNavRequestRender and the URL changes back to the
    // base /thinking-space (clearing the ?file= param).
    if (isCapacitorNative() && isIPhoneIosSurface) {
      void popNativeNavigationBlock().catch((err) => {
        console.warn('[ThinkingSpace] popNativeNavigation failed, falling back to instant close', err)
        setInlinePathAndSyncUrl(null)
        setMountedInlinePaths([])
        setInlineInitialModeByPath({})
      })
      return
    }
    setInlinePathAndSyncUrl(null)
    setMountedInlinePaths([])
    setInlineInitialModeByPath({})
  }, [isIPhoneIosSurface, setInlinePathAndSyncUrl])

  const handleInlineOpenPath = useCallback((nextPath: string) => {
    setInlinePathAndSyncUrl(nextPath)
  }, [setInlinePathAndSyncUrl])

  // iPhone: route file taps through the native push transition so the file
  // viewer slides in with a UIKit animation instead of appearing in place.
  // On non-Capacitor runtimes (web, Electron) we keep the existing direct
  // behavior — onOpenFile receives the path and opens inline immediately.
  //
  // Pre-seeds the base ('/thinking-space') on the Swift stack before pushing
  // so the back button (handleInlineDocumentClose → pop) has somewhere to
  // pop to. Without this, the first push leaves a single-entry stack and
  // pop() silently no-ops.
  // Phone-only helper: open a state-mutation detail screen with the native
  // push animation. The cascade handler registered above will close it on
  // pop. On non-iPhone surfaces, runs the mutation synchronously.
  const phonePushDetail = useCallback((mutateForward: () => void) => {
    if (!(isCapacitorNative() && isIPhoneIosSurface)) {
      mutateForward()
      return
    }
    void (async () => {
      try {
        await setNativeNavigationStackBlock(['/thinking-space'])
        await pushNativeWithForwardBlock('/thinking-space', mutateForward)
      } catch (err) {
        console.warn('[ThinkingSpace] phonePushDetail failed, falling back', err)
        mutateForward()
      }
    })()
  }, [isIPhoneIosSurface])

  const handleExplorerCollapseAll = useCallback(() => {
    explorerHandleRef.current?.collapseAll()
  }, [])

  const handleExplorerOpenFile = useCallback((path: string) => {
    if (isCapacitorNative() && isIPhoneIosSurface) {
      const url = `/thinking-space?file=${encodeURIComponent(path)}`
      // Await setStack before push so Swift's stack is guaranteed to be
      // [base, file] (count > 1) after push completes — that's what
      // canPop checks for back-swipe gesture + chevron morph. Without the
      // await, Capacitor's bridge can land setStack AFTER push, leaving
      // stack at count == 1. The earlier flash issue was fixed by the
      // snapshot-layer-order + afterScreenUpdates:true changes in the
      // coordinator, not by removing this await; the ~10-30ms latency
      // here is invisible because the snapshot already covers the screen.
      void (async () => {
        try {
          await setNativeNavigationStackBlock(['/thinking-space'])
          await pushNativeNavigationBlock(url)
        } catch (err) {
          console.warn('[ThinkingSpace] pushNativeNavigation failed, falling back to inline', err)
          setInlinePathAndSyncUrl(path)
        }
      })()
      return
    }
    setInlinePathAndSyncUrl(path)
  }, [isIPhoneIosSurface, setInlinePathAndSyncUrl])

  const handleInlineOpenPathForEdit = useCallback((nextPath: string) => {
    setInlinePathAndSyncUrl(nextPath, 'edit')
  }, [setInlinePathAndSyncUrl])

  const applyNotebookView = useCallback((folderPath: string | null) => {
    setInlinePath(null)
    setMountedInlinePaths([])
    setInlineInitialModeByPath({})
    setNotebookFolderPath(folderPath)
    setBrowserUrl(null)
    setRssActiveArticle(null)
    setRuledNotebookFilePath(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete(FILE_QUERY_PARAM)
      next.delete(RULED_NOTEBOOK_QUERY_PARAM)
      if (folderPath) {
        next.set(NOTEBOOK_QUERY_PARAM, folderPath)
      } else {
        next.delete(NOTEBOOK_QUERY_PARAM)
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const openNotebookView = useCallback((folderPath: string | null) => {
    // Opening goes through the native push animation on iPhone; clearing
    // (folderPath === null) skips it since the cascade-handler / inline
    // close path handles those teardowns.
    if (folderPath) {
      phonePushDetail(() => applyNotebookView(folderPath))
      return
    }
    applyNotebookView(null)
  }, [applyNotebookView, phonePushDetail])

  const applyRuledNotebookView = useCallback((filePath: string | null) => {
    setInlinePath(null)
    setMountedInlinePaths([])
    setInlineInitialModeByPath({})
    setNotebookFolderPath(null)
    setBrowserUrl(null)
    setRssActiveArticle(null)
    setRuledNotebookFilePath(filePath)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete(FILE_QUERY_PARAM)
      next.delete(NOTEBOOK_QUERY_PARAM)
      if (filePath) {
        next.set(RULED_NOTEBOOK_QUERY_PARAM, filePath)
      } else {
        next.delete(RULED_NOTEBOOK_QUERY_PARAM)
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const openRuledNotebookView = useCallback((filePath: string | null) => {
    if (filePath) {
      phonePushDetail(() => applyRuledNotebookView(filePath))
      return
    }
    applyRuledNotebookView(null)
  }, [applyRuledNotebookView, phonePushDetail])

  const handleNotebookOpenFile = useCallback((path: string) => {
    openNotebookView(null)
    setInlinePathAndSyncUrl(path)
  }, [openNotebookView, setInlinePathAndSyncUrl])

  const handleDrawerFileOpen = useCallback((path: string) => {
    setInlinePathAndSyncUrl(path)
    setMobileExplorerOpen(false)
  }, [setInlinePathAndSyncUrl])

  const copyToClipboard = useCallback(async (value: string): Promise<boolean> => {
    if (!value.trim()) return false
    await navigator.clipboard.writeText(value)
    return true
  }, [])

  const handleExplorerCreateFolder = useCallback(async (parentPath: string): Promise<string> => {
    // Avoid prompt dependency in Electron; create then rename inline.
    // Note: do NOT dispatch a global sync refresh here — VaultExplorerBlock's
    // runContextAction already reloads the parent path directly.  Firing a
    // global refresh on top causes every loaded folder to be re-read in
    // parallel (iCloud FS), which is what makes the UI hang.
    const outputPath = await createFolderOrch(parentPath, 'New Folder')
    return outputPath
  }, [])

  const handleExplorerCreateFile = useCallback(async (parentPath: string): Promise<string> => {
    const outputPath = await createFileOrch(parentPath, 'New File.md')
    setInlinePathAndSyncUrl(outputPath, 'edit')
    dispatchFileOpRefresh()
    return outputPath
  }, [setInlinePathAndSyncUrl])

  const handleExplorerCreateCsvFile = useCallback(async (parentPath: string): Promise<string> => {
    const outputPath = await createFileOrch(parentPath, 'New Table.csv')
    setInlinePathAndSyncUrl(outputPath, 'edit')
    dispatchFileOpRefresh()
    return outputPath
  }, [setInlinePathAndSyncUrl])

  const handleExplorerCreateDrawing = useCallback(async (parentPath: string): Promise<string | boolean> => {
    // Avoid window.prompt() — not supported in Capacitor WebView.
    // Create with default name; user can rename inline like folders.
    const outputPath = await createDrawingOrch(parentPath, 'New Drawing.excalidraw.md')
    setInlinePathAndSyncUrl(outputPath)
    dispatchFileOpRefresh()
    return outputPath
  }, [setInlinePathAndSyncUrl])

  const handleExplorerCreateLink = useCallback(async (parentPath: string): Promise<string | boolean> => {
    const url = await new Promise<string | null>((resolve) => {
      linkPromptResolveRef.current = resolve
      setLinkPromptOpen(true)
    })
    setLinkPromptOpen(false)
    if (!url?.trim()) return false
    const outputPath = await createUrlShortcutOrch(parentPath, url.trim())
    setInlinePathAndSyncUrl(outputPath)
    dispatchFileOpRefresh()
    return outputPath
  }, [setInlinePathAndSyncUrl])

  const handleRssOpenArticle = useCallback((
    item: RssFeedItemBlock,
    onItemUpdate: (updated: RssFeedItemBlock) => void,
    onItemRemove: () => void,
    presetTags: string[],
    tagColors: Record<string, string>,
  ) => {
    const article = { item, onItemUpdate, onItemRemove, presetTags, tagColors }
    phonePushDetail(() => {
      setRssActiveArticle(article)
      setRssUrlBarVisible(!isIosSurface)
      setBrowserUrl(null)
      setMobileExplorerOpen(false)
    })
  }, [isIosSurface, phonePushDetail])

  const handleExplorerShowInGraph = useCallback((path: string, kind: 'file' | 'folder') => {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    setGraphPeekTarget({ path: normalized, kind })
  }, [])

  const handleExplorerCopyAbsolutePath = useCallback(async (path: string): Promise<boolean> => {
    const absolute = getAbsolutePathForClipboardOrch(path)
    if (!absolute) {
      throw new Error('Absolute path is unavailable for this runtime.')
    }
    return copyToClipboard(absolute)
  }, [copyToClipboard])

  const handleExplorerOpenInNewTab = useCallback((path: string): boolean => {
    openFileInNewTabOrch(path)
    return true
  }, [])

  const handleExplorerOpenInNewWindow = useCallback((path: string): boolean => {
    openFileInNewWindowOrch(path)
    return true
  }, [])

  const handleExplorerDuplicateFile = useCallback(async (path: string): Promise<boolean> => {
    const duplicatePath = await duplicateFileOrch(path)
    setInlinePathAndSyncUrl(duplicatePath)
    dispatchFileOpRefresh()
    return true
  }, [setInlinePathAndSyncUrl])

  const handleExplorerRenamePath = useCallback(async (
    path: string,
    kind: 'file' | 'folder',
    nextName: string,
  ): Promise<string> => {
    const nextPath = await renameVaultPathOrch(path, nextName)
    if (kind === 'file') {
      replaceMountedInlinePath(path, nextPath)
    }
    if (kind === 'file' && inlinePath === path) {
      setInlinePathAndSyncUrl(nextPath)
    }
    dispatchFileOpRefresh()
    return nextPath
  }, [inlinePath, replaceMountedInlinePath, setInlinePathAndSyncUrl])

  const handleExplorerDeleteFile = useCallback(async (path: string): Promise<boolean> => {
    const confirmed = window.confirm(`Delete file "${leafNameOf(path)}"?`)
    if (!confirmed) return false
    await deleteVaultPathOrch(path)
    removeMountedInlinePath(path)
    if (inlinePath === path) {
      setInlinePathAndSyncUrl(null)
    }
    dispatchFileOpRefresh()
    return true
  }, [inlinePath, removeMountedInlinePath, setInlinePathAndSyncUrl])

  const handleExplorerDeleteFolder = useCallback(async (path: string): Promise<boolean> => {
    const confirmed = window.confirm(`Delete folder "${leafNameOf(path)}" and all its contents?`)
    if (!confirmed) return false
    await deleteVaultPathOrch(path)
    dispatchFileOpRefresh()
    setMountedInlinePaths((prev) => prev.filter((item) => !isSameOrChildPath(item, path)))
    setInlineInitialModeByPath((prev) => {
      let changed = false
      const next: Record<string, MarkdownViewerMode> = {}
      for (const [itemPath, mode] of Object.entries(prev)) {
        if (isSameOrChildPath(itemPath, path)) {
          changed = true
          continue
        }
        next[itemPath] = mode
      }
      return changed ? next : prev
    })
    if (inlinePath && isSameOrChildPath(inlinePath, path)) {
      setInlinePathAndSyncUrl(null)
    }
    return true
  }, [inlinePath, setInlinePathAndSyncUrl])

  const handleExplorerOpenInFinder = useCallback(async (path: string): Promise<boolean> => {
    await revealVaultPathOrch(path)
    return true
  }, [])

  const handleExplorerLoadFileTags = useCallback(async (path: string): Promise<string[]> => {
    const node = await getNodeByPath(path)
    return node?.tags ?? []
  }, [])

  const handleExplorerMovePath = useCallback(async (
    sourcePath: string,
    _sourceKind: 'file' | 'folder',
    targetFolderPath: string,
  ): Promise<string> => {
    const nextPath = await moveVaultPathOrch(sourcePath, targetFolderPath)
    if (nextPath === sourcePath) return sourcePath

    setMountedInlinePaths((prev) => {
      const remapped = prev.map(path => remapPathAfterMove(path, sourcePath, nextPath))
      const deduped: string[] = []
      for (const path of remapped) {
        if (!deduped.includes(path)) deduped.push(path)
      }
      return deduped
    })
    setInlineInitialModeByPath((prev) => {
      const next: Record<string, MarkdownViewerMode> = {}
      for (const [path, mode] of Object.entries(prev)) {
        const remappedPath = remapPathAfterMove(path, sourcePath, nextPath)
        if (!(remappedPath in next)) next[remappedPath] = mode
      }
      return next
    })

    if (inlinePath) {
      const remappedInlinePath = remapPathAfterMove(inlinePath, sourcePath, nextPath)
      if (remappedInlinePath !== inlinePath) {
        setInlinePathAndSyncUrl(remappedInlinePath)
      }
    }

    dispatchFileOpRefresh()
    return nextPath
  }, [inlinePath, setInlinePathAndSyncUrl])

  const handleExplorerResizeMove = useCallback((event: PointerEvent) => {
    const state = explorerResizeRef.current
    if (!state) return
    const deltaX = event.clientX - state.startX
    const nextWidth = clampExplorerWidthPx(state.startWidth + deltaX, layout)
    setExplorerWidthPx(nextWidth)
  }, [layout])

  const stopExplorerResize = useCallback(() => {
    explorerResizeRef.current = null
    setIsExplorerResizing(false)
    window.removeEventListener('pointermove', handleExplorerResizeMove)
    window.removeEventListener('pointerup', stopExplorerResize)
    window.removeEventListener('pointercancel', stopExplorerResize)
    document.body.style.removeProperty('user-select')
    document.body.style.removeProperty('cursor')
  }, [handleExplorerResizeMove])

  const handleExplorerResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!showCollapsedInlineExplorer) return
    event.preventDefault()
    setIsExplorerResizing(true)
    explorerResizeRef.current = { startX: event.clientX, startWidth: explorerWidthPx }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', handleExplorerResizeMove)
    window.addEventListener('pointerup', stopExplorerResize)
    window.addEventListener('pointercancel', stopExplorerResize)
  }, [explorerWidthPx, handleExplorerResizeMove, showCollapsedInlineExplorer, stopExplorerResize])

  const handleExplorerResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 16
    const delta = event.key === 'ArrowLeft' ? -step : step
    setExplorerWidthPx((prev) => clampExplorerWidthPx(prev + delta, layout))
  }, [layout])

  useEffect(() => {
    if (showInlineSidebar) setMobileExplorerOpen(false)
  }, [showInlineSidebar])

  useEffect(() => {
    if (layout.keyboardVisible) {
      setMobileExplorerOpen(false)
    }
  }, [layout.keyboardVisible])

  useEffect(() => {
    setStorageItem(STORAGE_KEYS.thinkingSpaceExplorerCollapsed, explorerCollapsed ? '1' : '0')
  }, [explorerCollapsed])

  useEffect(() => {
    setStorageItem(STORAGE_KEYS.thinkingSpaceExplorerWidthPx, String(explorerWidthPx))
  }, [explorerWidthPx])

  useEffect(() => {
    const explorerCollapsedForChrome = explorerCollapsed

    if (rssActiveArticle) {
      dispatchThinkingSpaceGoogleWorkspaceChromeStateBlock({
        enabled: true,
        explorerCollapsed: explorerCollapsedForChrome,
        headerVisible: rssUrlBarVisible,
        showHeaderToggle: true,
      })
      return
    }
    if (isIosSurface) {
      // Always show explorer toggle in top chrome on iOS
      dispatchThinkingSpaceGoogleWorkspaceChromeStateBlock({
        enabled: true,
        explorerCollapsed: explorerCollapsedForChrome,
        headerVisible: true,
        showHeaderToggle: false,
      })
      return
    }
    dispatchThinkingSpaceGoogleWorkspaceChromeStateBlock({
      enabled: true,
      explorerCollapsed,
      headerVisible: !inlineDocHeaderHidden,
      showHeaderToggle: Boolean(inlinePath || notebookFolderPath || ruledNotebookFilePath),
    })
  }, [explorerCollapsed, inlineDocHeaderHidden, inlinePath, notebookFolderPath, ruledNotebookFilePath, rssActiveArticle, rssUrlBarVisible, isIosSurface])

  useEffect(() => {
    return () => {
      dispatchThinkingSpaceGoogleWorkspaceChromeStateBlock({
        enabled: false,
        explorerCollapsed: false,
        headerVisible: true,
        showHeaderToggle: false,
      })
    }
  }, [])

  useEffect(() => {
    const onToggleExplorer = () => {
      if (showInlineSidebar || iosInlineMode) {
        setExplorerCollapsed(prev => !prev)
        return
      }
      setMobileExplorerOpen(prev => !prev)
    }
    const onToggleHeader = () => {
      if (rssActiveArticle) {
        setRssUrlBarVisible(prev => !prev)
        return
      }
      setInlineDocHeaderHidden(prev => !prev)
    }

    window.addEventListener(THINKING_SPACE_GOOGLE_WORKSPACE_TOGGLE_EXPLORER_EVENT_BLOCK, onToggleExplorer as EventListener)
    window.addEventListener(THINKING_SPACE_GOOGLE_WORKSPACE_TOGGLE_HEADER_EVENT_BLOCK, onToggleHeader as EventListener)
    return () => {
      window.removeEventListener(THINKING_SPACE_GOOGLE_WORKSPACE_TOGGLE_EXPLORER_EVENT_BLOCK, onToggleExplorer as EventListener)
      window.removeEventListener(THINKING_SPACE_GOOGLE_WORKSPACE_TOGGLE_HEADER_EVENT_BLOCK, onToggleHeader as EventListener)
    }
  }, [iosInlineMode, showInlineSidebar, rssActiveArticle])

  useEffect(() => {
    const handleResize = () => {
      setExplorerWidthPx((prev) => clampExplorerWidthPx(prev, layout))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [layout])

  useEffect(() => {
    setExplorerWidthPx((prev) => clampExplorerWidthPx(prev, layout))
  }, [layout])

  useEffect(() => {
    return () => {
      stopExplorerResize()
    }
  }, [stopExplorerResize])

  // iOS inline sidebar: use shared hook for both open (edge swipe) and close (swipe left)
  const handleToggleExplorerIos = useCallback(() => setExplorerCollapsed(prev => !prev), [])
  useIosSidebarSwipeBlock({
    isIos: iosInlineMode,
    isOpen: !explorerCollapsed,
    keyboardVisible: layout.keyboardVisible,
    onToggle: handleToggleExplorerIos,
  })

  // Non-iOS: edge swipe to open drawer or inline sidebar
  useEffect(() => {
    if (iosInlineMode) return
    const explorerOpen = showInlineSidebar ? !explorerCollapsed : mobileExplorerOpen
    if (explorerOpen || layout.keyboardVisible) {
      edgeSwipeStartRef.current = null
      return
    }

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      if (shouldIgnoreEdgeSwipeFromTargetBlock(event.target)) {
        edgeSwipeStartRef.current = null
        return
      }
      if (!shouldStartEdgeSwipeOpenBlock(touch.clientX)) return
      edgeSwipeStartRef.current = { x: touch.clientX, y: touch.clientY }
    }

    const handleTouchMove = (event: TouchEvent) => {
      const start = edgeSwipeStartRef.current
      if (!start) return
      const touch = event.touches[0]
      if (!touch) return
      if (shouldOpenDrawerFromSwipeBlock(touch.clientX - start.x, touch.clientY - start.y)) {
        edgeSwipeStartRef.current = null
        if (showInlineSidebar) {
          setExplorerCollapsed(false)
        } else {
          setMobileExplorerOpen(true)
        }
      }
    }

    const clearGesture = () => {
      edgeSwipeStartRef.current = null
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
  }, [explorerCollapsed, iosInlineMode, layout.keyboardVisible, mobileExplorerOpen, showInlineSidebar])

  const handleExplorerDrawerTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    drawerSwipeStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleExplorerDrawerTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    const start = drawerSwipeStartRef.current
    if (!start) return
    const touch = event.touches[0]
    if (!touch) return
    if (shouldCloseDrawerFromSwipeBlock(touch.clientX - start.x, touch.clientY - start.y)) {
      drawerSwipeStartRef.current = null
      setMobileExplorerOpen(false)
    }
  }

  const handleExplorerDrawerTouchEnd = () => {
    drawerSwipeStartRef.current = null
  }

  const rssExplorerToggleButton = (
    <button
      type="button"
      onClick={() => setRssPanelOpen(prev => { if (prev) setRssActiveArticle(null); return !prev })}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
        rssPanelOpen
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted/70',
      )}
    >
      <RssIcon className="h-3.5 w-3.5" />
      RSS Feeds
    </button>
  )
  // Icon-only variant that lives inline in the explorer top toolbar (desktop).
  const rssExplorerToolbarButton = (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="RSS Feeds"
            onClick={() => setRssPanelOpen(prev => { if (prev) setRssActiveArticle(null); return !prev })}
            className={cn(
              'ltm-touch-target flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
              rssPanelOpen ? 'bg-muted text-foreground' : 'hover:bg-muted hover:text-foreground',
            )}
          >
            <RssIcon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">RSS Feeds</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
  const useTopRssExplorerToggle = isIPhoneIosSurface

  const inlineExplorerContent = useMemo(() => (
    <>
      <div className="ltm-shell-segment-header ltm-thinking-space-explorer-chrome flex h-11 shrink-0 items-center px-2">
        <span className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {inlineExplorerTitle}
        </span>
      </div>
      {useTopRssExplorerToggle ? (
        <div className="shrink-0 px-3 py-2">
          {rssExplorerToggleButton}
        </div>
      ) : null}
      {rssPanelOpen ? (
        <div className="min-h-0 flex-1">
          <RssFeedPanelBlock
            onOpenArticle={handleRssOpenArticle}
            onClose={() => { setRssPanelOpen(false); setRssActiveArticle(null) }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <VaultExplorerBlock
            ref={explorerHandleRef}
            loadEntries={listFolderEntries}
            selectedPath={ruledNotebookFilePath ?? inlinePath}
            sessionTelemetry={sessionTelemetry}
            listenToGlobalSyncRefresh
            onOpenFile={handleExplorerOpenFile}
            onOpenFileAsRuledNotebook={openRuledNotebookView}
            onCreateFolder={handleExplorerCreateFolder}
            onCreateFile={handleExplorerCreateFile}
            onCreateCsvFile={handleExplorerCreateCsvFile}
            onCreateDrawing={handleExplorerCreateDrawing}
            onCreateLink={handleExplorerCreateLink}
            onCopyAbsolutePath={handleExplorerCopyAbsolutePath}
            onOpenInNewTab={handleExplorerOpenInNewTab}
            onOpenInNewWindow={handleExplorerOpenInNewWindow}
            onDuplicateFile={handleExplorerDuplicateFile}
            onRenamePath={handleExplorerRenamePath}
            onDeleteFile={handleExplorerDeleteFile}
            onDeleteFolder={handleExplorerDeleteFolder}
            onOpenInFinder={handleExplorerOpenInFinder}
            loadFileTags={handleExplorerLoadFileTags}
            loadFileMeta={readFileTooltipMeta}
            onMovePath={handleExplorerMovePath}
            onOpenFolderAsNotebook={openNotebookView}
            onShowInGraph={handleExplorerShowInGraph}
            toolbarActionsSlot={!useTopRssExplorerToggle ? rssExplorerToolbarButton : null}
            draggableFiles
            draggableFolders
            title=""
          />
        </div>
      )}
      {!useTopRssExplorerToggle ? (
        <VaultFooterBar vaultRoot={vaultRootPath} onCollapse={handleExplorerCollapseAll} />
      ) : null}
    </>
  ), [handleExplorerCollapseAll, handleExplorerCreateCsvFile, handleExplorerShowInGraph, inlinePath, openRuledNotebookView, rssExplorerToggleButton, rssExplorerToolbarButton, rssPanelOpen, ruledNotebookFilePath, setInlinePathAndSyncUrl, useTopRssExplorerToggle, vaultRootPath])

  const inlineDocumentContent = useMemo(() => {
    if (mountedInlinePaths.length === 0) return null
    return mountedInlinePaths.map((path) => (
      <section
        key={path}
        hidden={inlinePath !== path}
        aria-hidden={inlinePath !== path}
        className="h-full min-h-0"
      >
        <MarkdownDocumentBlock
          path={path}
          active={inlinePath === path}
          initialMode={inlineInitialModeByPath[path] ?? 'view'}
          onOpenPath={handleInlineOpenPath}
          onOpenPathForEdit={handleInlineOpenPathForEdit}
          onOpenAsNotebook={openRuledNotebookView}
          onClose={handleInlineDocumentClose}
          showCloseButton
          className="h-full min-h-0"
          topBarHidden={inlineDocHeaderHidden}
        />
      </section>
    ))
  }, [
    handleInlineDocumentClose,
    handleInlineOpenPath,
    handleInlineOpenPathForEdit,
    openRuledNotebookView,
    inlineDocHeaderHidden,
    inlineInitialModeByPath,
    inlinePath,
    mountedInlinePaths,
  ])

  return (
    <div
      className="ltm-thinking-space-shell flex h-full min-h-0 flex-col overflow-hidden"
      data-ltm-explorer-open={showCollapsedInlineExplorer ? 'true' : 'false'}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {(showInlineSidebar || iosInlineMode) && (
          <aside
            className={cn(
              'ltm-thinking-space-explorer-surface flex min-h-0 flex-col overflow-hidden',
              phoneListMode ? 'flex-1' : 'shrink-0',
              (isExplorerResizing || useInstantExplorerToggle || isIPhoneIosSurface)
                ? 'transition-none'
                : 'transition-[width,opacity] duration-200 ease-out',
              phoneListMode
                ? 'opacity-100'
                : (phoneDetailMode ? 'opacity-0' : (showCollapsedInlineExplorer ? 'opacity-100' : 'opacity-0')),
            )}
            style={
              phoneListMode
                ? undefined  // flex-1 handles width
                : { width: phoneDetailMode ? '0px' : (showCollapsedInlineExplorer ? `${explorerWidthPx}px` : '0px') }
            }
            data-ltm-nav-region="explorer"
          >
            <div
              className={cn(
                'flex h-full min-h-0 flex-col',
                (phoneDetailMode || (!phoneListMode && !showCollapsedInlineExplorer)) && 'pointer-events-none',
              )}
              aria-hidden={phoneDetailMode || (!phoneListMode && !showCollapsedInlineExplorer)}
            >
              {inlineExplorerContent}
            </div>
          </aside>
        )}

        {(showInlineSidebar || iosInlineMode) && showCollapsedInlineExplorer && !isIPhoneIosSurface && (
          <div
            role="separator"
            aria-label="Resize explorer"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={handleExplorerResizeStart}
            onDoubleClick={() => setExplorerWidthPx(resolveExplorerDefaultWidthPx(layout))}
            onKeyDown={handleExplorerResizeKeyDown}
            className="ltm-thinking-space-explorer-resizer group relative hidden w-2 shrink-0 cursor-col-resize items-stretch md:flex"
          >
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent" />
          </div>
        )}

        <section
          className={cn(
            'ltm-thinking-space-document-stage relative min-h-0 flex-1',
            phoneListMode && 'hidden',
          )}
        >
          {/* Tap-outside-to-close overlay was for the old iPhone explorer-as-overlay UX.
              In the new push-nav UX iPhone is always single-screen, never overlapped,
              so this overlay isn't needed and would intercept clicks on the file viewer. */}
          {rssActiveArticle ? (
            <div className="h-full min-h-0">
              <RssArticleViewBlock
                key={rssActiveArticle.item.id}
                item={rssActiveArticle.item}
                onClose={() => setRssActiveArticle(null)}
                onItemUpdate={(updated) => {
                  setRssActiveArticle(prev => prev ? { ...prev, item: updated } : null)
                  rssActiveArticle.onItemUpdate(updated)
                }}
                onMoved={(newPath) => {
                  rssActiveArticle.onItemRemove()
                  setRssActiveArticle(null)
                  setInlinePathAndSyncUrl(newPath)
                }}
                presetTags={rssActiveArticle.presetTags}
                tagColors={rssActiveArticle.tagColors}
                suspended={mobileExplorerOpen}
                hideUrlBar={!rssUrlBarVisible}
              />
            </div>
          ) : browserUrl ? (
            <div className="h-full min-h-0">
              <UrlDocumentBlock
                url={browserUrl}
                onClose={() => setBrowserUrl(null)}
                showCloseButton
              />
            </div>
          ) : ruledNotebookFilePath ? (
            <div className="h-full min-h-0">
              <RuledNotebookDocumentBlock
                path={ruledNotebookFilePath}
                onClose={() => openRuledNotebookView(null)}
                className="h-full min-h-0"
                topBarHidden={inlineDocHeaderHidden}
              />
            </div>
          ) : notebookFolderPath ? (
            <div className="h-full min-h-0">
              <NotebookViewOrch
                folderPath={notebookFolderPath}
                onOpenFile={handleNotebookOpenFile}
                onClose={() => openNotebookView(null)}
                className="h-full min-h-0"
                topBarHidden={inlineDocHeaderHidden}
              />
            </div>
          ) : inlinePath && inlineDocumentContent ? (
            <div className="h-full min-h-0">
              {inlineDocumentContent}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center md:px-8">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background">
                <FileText className="h-7 w-7 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">Open a File to Start</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Pick a file from the explorer.
              </p>
            </div>
          )}
        </section>
      </div>

      {!showInlineSidebar && mobileExplorerOpen && (
        <>
          <div
            className="ltm-shell-motion-overlay fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileExplorerOpen(false)}
          />
          <aside
            className="ltm-mobile-drawer ltm-shell-mobile-drawer ltm-shell-drawer-surface ltm-shell-motion-drawer fixed inset-y-0 left-0 z-50 flex flex-col"
            onTouchStart={handleExplorerDrawerTouchStart}
            onTouchMove={handleExplorerDrawerTouchMove}
            onTouchEnd={handleExplorerDrawerTouchEnd}
            onTouchCancel={handleExplorerDrawerTouchEnd}
          >
            <div className="ltm-shell-segment-header ltm-thinking-space-explorer-chrome flex h-11 shrink-0 items-center justify-between px-2">
              <span className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Explorer
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="ltm-touch-target h-8 w-8"
                onClick={() => setMobileExplorerOpen(false)}
                title="Close explorer"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            {useTopRssExplorerToggle ? (
              <div className="shrink-0 px-3 py-2">
                {rssExplorerToggleButton}
              </div>
            ) : null}
            {rssPanelOpen ? (
              <div className="min-h-0 flex-1">
                <RssFeedPanelBlock
                  onOpenArticle={handleRssOpenArticle}
                  onClose={() => { setRssPanelOpen(false); setRssActiveArticle(null) }}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1">
                <VaultExplorerBlock
                  ref={explorerHandleRef}
                  loadEntries={listFolderEntries}
                  loadFileMeta={readFileTooltipMeta}
                  selectedPath={inlinePath}
                  sessionTelemetry={sessionTelemetry}
                  listenToGlobalSyncRefresh
                  onOpenFile={handleDrawerFileOpen}
                  onCreateFolder={handleExplorerCreateFolder}
                  onCreateFile={handleExplorerCreateFile}
                  onCreateCsvFile={handleExplorerCreateCsvFile}
                  onCreateDrawing={handleExplorerCreateDrawing}
                  onCreateLink={handleExplorerCreateLink}
                  onCopyAbsolutePath={handleExplorerCopyAbsolutePath}
                  onOpenInNewTab={handleExplorerOpenInNewTab}
                  onOpenInNewWindow={handleExplorerOpenInNewWindow}
                  onDuplicateFile={handleExplorerDuplicateFile}
                  onRenamePath={handleExplorerRenamePath}
                  onDeleteFile={handleExplorerDeleteFile}
                  onDeleteFolder={handleExplorerDeleteFolder}
                  onOpenInFinder={handleExplorerOpenInFinder}
                  onMovePath={handleExplorerMovePath}
                  onShowInGraph={handleExplorerShowInGraph}
                  toolbarActionsSlot={!useTopRssExplorerToggle ? rssExplorerToolbarButton : null}
                  draggableFiles
                  draggableFolders
                  title=""
                />
              </div>
            )}
            {!useTopRssExplorerToggle ? (
              <VaultFooterBar vaultRoot={vaultRootPath} onCollapse={handleExplorerCollapseAll} />
            ) : null}
          </aside>
        </>
      )}
      {linkPromptOpen && (
        <LinkUrlPromptOverlay
          onSubmit={(url) => { linkPromptResolveRef.current?.(url); linkPromptResolveRef.current = null }}
          onCancel={() => { linkPromptResolveRef.current?.(null); linkPromptResolveRef.current = null }}
        />
      )}
      {graphPeekTarget && (
        <Suspense fallback={null}>
          <PathGraphSlideOverBlock target={graphPeekTarget} onClose={() => setGraphPeekTarget(null)} />
        </Suspense>
      )}
    </div>
  )
}

function LinkUrlPromptOverlay({
  onSubmit,
  onCancel,
}: {
  onSubmit: (url: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) onSubmit(trimmed)
    else onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-sm font-medium">Add Link</p>
        <input
          ref={inputRef}
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSubmit() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
          placeholder="https://example.com"
          className="mb-3 h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm outline-none focus:border-ring"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
