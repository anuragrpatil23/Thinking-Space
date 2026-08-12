import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { ChevronLeft, ExternalLink, Globe, Loader2, RotateCw, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useElectronWebviewLoadErrorBlock } from '@/components/lego_blocks/hooks/shared/useElectronWebviewLoadErrorBlock'
import { useRouteActivityBlock } from '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
import { useWindowActivityBlock } from '@/components/lego_blocks/hooks/shared/useWindowActivityBlock'
import PasswordAutofillOverlayBlock from '@/components/lego_blocks/integrations/PasswordAutofillOverlayBlock'
import { readUrlShortcutOrch } from '@/services/orchestrators/urlShortcutOrch'
import { isValidHttpUrlBlock } from '@/services/lego_blocks/units/urlShortcutBlock'
import { isCapacitorNative } from '@/services/lego_blocks/integrations/fsBlock'
import { createPasswordVaultEntryIdOrch } from '@/services/orchestrators/passwordManagerOrch'
import {
  getPasswordVaultSessionSnapshotOrch,
  savePasswordVaultSessionVaultOrch,
  subscribePasswordVaultSessionOrch,
  unlockPasswordVaultSessionOrch,
} from '@/services/orchestrators/passwordManagerSessionOrch'
import type { PasswordVaultEntryBlock } from '@/services/orchestrators/passwordManagerOrch'
import {
  openInlineWebViewBlock,
  closeInlineWebViewBlock,
  suspendInlineWebViewBlock,
  resumeInlineWebViewBlock,
  updateInlineWebViewFrameBlock,
  setInlineWebViewThemeBlock,
  type InlineWebViewTheme,
} from '@/services/lego_blocks/units/inlineWebViewBlock'
import { useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import {
  derivePasswordEntryTitleBlock,
  findMatchingPasswordEntriesBlock,
  findPasswordSaveTargetBlock,
  type PasswordAutofillWebContextBlock,
} from '@/services/lego_blocks/units/passwordAutofillMatchBlock'
import {
  buildPasswordAutofillFillScriptBlock,
  probePasswordAutofillContextBlock,
} from '@/services/lego_blocks/units/passwordAutofillWebviewBlock'
import { cn } from '@/lib/utils'
import { getCurrentWorkspaceProfileBlock } from '@/services/lego_blocks/units/profileContextBlock'

// Per-profile web partition: the default profile keeps the historic partition
// (existing logins survive), other profiles get their own cookie jar so e.g.
// work and personal Gmail can stay signed in side by side.
const LINK_WEBVIEW_PARTITION = getCurrentWorkspaceProfileBlock().webviewPartition
const ELECTRON_WEBVIEW_UNLOAD_DELAY_MS = 3 * 60 * 60 * 1000
type ElectronWebviewRefBlock = React.MutableRefObject<ElectronWebviewElementBlock | null>

interface ElectronWebviewElementBlock extends HTMLElement {
  canGoBack?: () => boolean
  goBack?: () => void
  goForward?: () => void
  reload?: () => void
  executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
  getAttribute: (qualifiedName: string) => string | null
  setAttribute: (qualifiedName: string, value: string) => void
}

interface UrlDocumentBlockProps {
  /** Path to a .url file, OR a direct URL to display. */
  path?: string
  url?: string
  onClose?: () => void
  showCloseButton?: boolean
  className?: string
  /** Override the Electron webview partition. Defaults to the shared links partition. */
  partition?: string
  /** Hide the URL bar (e.g. when top chrome provides a header toggle). */
  hideHeader?: boolean
  /** Suspend the native WKWebView (iOS) — use when a native-layer overlay (e.g. drawer) is open. */
  suspended?: boolean
  /** Receives a scroller for the embedded page, letting a keyboard-driven
   *  parent scroll the document without the user clicking into it.
   *
   *  Only wired on Electron, where the <webview> exposes executeJavaScript.
   *  Stays null for the iOS native overlay and for the plain <iframe> fallback
   *  (cross-origin — the parent cannot script it). */
  scrollerRef?: MutableRefObject<UrlDocumentScrollerBlock | null>
}

/** Scrolls the embedded document by `deltaPx` (negative scrolls up). */
export type UrlDocumentScrollerBlock = (deltaPx: number) => void

const ElectronPersistentWebviewBlock = memo(function ElectronPersistentWebviewBlock({
  webviewRef,
  title,
  partition,
  useragent,
  className,
}: {
  webviewRef: ElectronWebviewRefBlock
  title: string
  partition: string
  useragent?: string
  className?: string
}) {
  return (
    <webview
      ref={(node) => {
        webviewRef.current = node as ElectronWebviewElementBlock | null
      }}
      title={title}
      partition={partition}
      useragent={useragent}
      // Spotify relies on Widevine/EME, which Electron only exposes to
      // guest content when browser plugins are explicitly enabled.
      plugins
      allowpopups
      className={className}
    />
  )
})

function UrlDocumentBlock({
  path,
  url: directUrl,
  onClose,
  showCloseButton,
  className,
  partition,
  hideHeader,
  suspended,
  scrollerRef,
}: UrlDocumentBlockProps) {
  const navigate = useNavigate()
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(directUrl ?? null)
  const [loading, setLoading] = useState(!directUrl)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [canGoBack, setCanGoBack] = useState(false)
  const [electronWebviewInstanceKey, setElectronWebviewInstanceKey] = useState(0)
  const webviewRef = useRef<ElectronWebviewElementBlock | null>(null)
  const contentAreaRef = useRef<HTMLDivElement | null>(null)
  const passwordProbeInFlightRef = useRef(false)
  const isElectronRuntime = Boolean(window.electronAPI?.isElectron)
  // Force the guest site's prefers-color-scheme to match the app. Electron
  // webviews already inherit this via nativeTheme.themeSource (uiThemeOrch);
  // iOS needs it pushed to the native WKWebView's overrideUserInterfaceStyle.
  const { resolvedColorMode } = useUIThemeBlock()
  const inlineWebViewTheme: InlineWebViewTheme = resolvedColorMode === 'dark' ? 'dark' : 'light'
  // Latest theme, read at open time without re-triggering the mount effect.
  const inlineWebViewThemeRef = useRef(inlineWebViewTheme)
  inlineWebViewThemeRef.current = inlineWebViewTheme
  const routeActive = useRouteActivityBlock()
  const windowActive = useWindowActivityBlock()
  // InlineWebView is iOS-only; exclude Electron even though Capacitor reports isNativePlatform() there
  const isCapacitorRuntime = isCapacitorNative() && !isElectronRuntime
  const shouldPauseElectronGuest = isElectronRuntime && (!routeActive || !windowActive || Boolean(suspended))
  const [electronGuestMounted, setElectronGuestMounted] = useState(() => !shouldPauseElectronGuest)

  // Resolve URL from .url file
  useEffect(() => {
    if (directUrl) {
      setResolvedUrl(directUrl)
      setLoading(false)
      setError(null)
      return
    }
    if (!path) {
      setError('No file path or URL provided')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    readUrlShortcutOrch(path)
      .then(result => {
        if (!cancelled) {
          setResolvedUrl(result.url)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to read .url file')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [path, directUrl])

  const isTrusted = useMemo(
    () => resolvedUrl !== null && isValidHttpUrlBlock(resolvedUrl),
    [resolvedUrl],
  )
  useElectronWebviewLoadErrorBlock({
    enabled: isElectronRuntime && isTrusted && electronGuestMounted,
    webviewRef,
    resolvedUrl,
    logSource: 'webview',
  })

  // Strip Electron/app tokens so webview looks like a plain Chrome browser to sites like Gmail.
  const webviewUserAgent = useMemo(() => {
    if (!isElectronRuntime) return undefined
    return navigator.userAgent
      .replace(/\s*Electron\/[\d.]+/g, '')
      .replace(/\s*Thinking Space\/[\d.]+/g, '')
      .trim()
  }, [isElectronRuntime])

  const displayUrl = resolvedUrl ?? ''
  const [passwordSession, setPasswordSession] = useState(() => getPasswordVaultSessionSnapshotOrch())
  const [passwordAutofillContext, setPasswordAutofillContext] = useState<PasswordAutofillWebContextBlock | null>(null)
  const [passwordAutofillUnlockInput, setPasswordAutofillUnlockInput] = useState('')
  const [passwordAutofillBusyAction, setPasswordAutofillBusyAction] = useState<'unlock' | 'fill' | 'save' | null>(null)
  const [passwordAutofillError, setPasswordAutofillError] = useState<string | null>(null)
  const displayTitle = useMemo(() => {
    try { return new URL(displayUrl).hostname }
    catch { return 'Website' }
  }, [displayUrl])
  const passwordAutofillEnabled = isElectronRuntime && isTrusted && !shouldPauseElectronGuest
  const passwordAutofillMatches = useMemo(
    () => passwordAutofillContext && passwordSession.vaultState
      ? findMatchingPasswordEntriesBlock(passwordSession.vaultState.vault.entries, passwordAutofillContext)
      : [],
    [passwordAutofillContext, passwordSession.vaultState],
  )
  const passwordAutofillSaveTarget = useMemo(
    () => passwordAutofillContext && passwordSession.vaultState
      ? findPasswordSaveTargetBlock(passwordSession.vaultState.vault.entries, passwordAutofillContext)
      : null,
    [passwordAutofillContext, passwordSession.vaultState],
  )
  const passwordAutofillCanSave = Boolean(
    passwordSession.unlocked
    && passwordAutofillContext
    && passwordAutofillContext.passwordValue.trim(),
  )
  const passwordAutofillStyle = useMemo(() => {
    const containerWidth = contentAreaRef.current?.clientWidth ?? 0
    const containerHeight = contentAreaRef.current?.clientHeight ?? 0
    const cardWidth = 320
    const cardHeight = passwordSession.unlocked ? 260 : 220
    const fallbackLeft = 16
    const fallbackTop = 16
    const rect = passwordAutofillContext?.rect
    if (!rect || containerWidth <= 0 || containerHeight <= 0) {
      return { left: fallbackLeft, top: fallbackTop }
    }
    const maxLeft = Math.max(fallbackLeft, containerWidth - cardWidth - 12)
    const maxTop = Math.max(fallbackTop, containerHeight - cardHeight - 12)
    return {
      left: Math.min(Math.max(rect.left, fallbackLeft), maxLeft),
      top: Math.min(Math.max(rect.bottom + 10, fallbackTop), maxTop),
    }
  }, [passwordAutofillContext, passwordSession.unlocked])

  useEffect(() => {
    if (!isElectronRuntime) return
    if (!shouldPauseElectronGuest) {
      setElectronGuestMounted(true)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setElectronGuestMounted(false)
      setCanGoBack(false)
    }, ELECTRON_WEBVIEW_UNLOAD_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isElectronRuntime, shouldPauseElectronGuest])

  const getElectronWebviewBlock = useCallback((): ElectronWebviewElementBlock | null => {
    if (!isElectronRuntime) return null
    return webviewRef.current
  }, [isElectronRuntime])

  // Hand the parent a way to scroll the guest page from the host document.
  // Keyboard-driven readers need this: the user never clicks into the webview,
  // so the guest never receives the arrow keys itself.
  useEffect(() => {
    if (!scrollerRef) return
    if (!isElectronRuntime || !electronGuestMounted) {
      scrollerRef.current = null
      return
    }
    scrollerRef.current = (deltaPx: number) => {
      const webview = getElectronWebviewBlock()
      if (!webview?.executeJavaScript) return
      void webview
        .executeJavaScript(`window.scrollBy({ top: ${Number(deltaPx)}, behavior: 'instant' })`)
        .catch(() => { /* guest navigated or was destroyed mid-keypress */ })
    }
    return () => { scrollerRef.current = null }
  }, [scrollerRef, isElectronRuntime, electronGuestMounted, getElectronWebviewBlock])

  const remountElectronWebviewBlock = useCallback(() => {
    setCanGoBack(false)
    setElectronGuestMounted(true)
    setElectronWebviewInstanceKey(value => value + 1)
  }, [])

  // Electron guest views can reload when React re-applies the same `src`
  // during parent re-renders. Set `src` imperatively only when the target URL
  // actually changes so workspace-tab switches preserve the live page state.
  useEffect(() => {
    if (!isElectronRuntime || !resolvedUrl) return
    const webview = getElectronWebviewBlock()
    if (!webview) return
    if (webview.getAttribute('src') === resolvedUrl) return
    webview.setAttribute('src', resolvedUrl)
  }, [getElectronWebviewBlock, isElectronRuntime, resolvedUrl])

  useEffect(() => subscribePasswordVaultSessionOrch(setPasswordSession), [])

  // iOS: track whether the native WKWebView was created by this component
  // instance so we can use suspend/resume to preserve full session state
  // (cookies, scroll, forms, auth) instead of destroying and recreating.
  const iosWebViewMountedRef = useRef(false)

  // iOS: suspend the native WKWebView offscreen (before paint) when the
  // component is hidden, preserving all session state.
  useLayoutEffect(() => {
    if (!isCapacitorRuntime || !isTrusted || !resolvedUrl || !suspended) return
    if (iosWebViewMountedRef.current) {
      void suspendInlineWebViewBlock()
    }
  }, [isCapacitorRuntime, isTrusted, resolvedUrl, suspended])

  // iOS: overlay a native WKWebView over the content area div, kept in sync
  // via ResizeObserver so it survives panel resizes and layout changes.
  // Uses resume (no reload) if the webview was previously suspended.
  useEffect(() => {
    if (!isCapacitorRuntime || !isTrusted || !resolvedUrl || suspended) return
    const el = contentAreaRef.current
    if (!el) return

    const getRect = () => el.getBoundingClientRect()

    if (iosWebViewMountedRef.current) {
      // Webview was suspended — restore it at the correct frame (no reload).
      void resumeInlineWebViewBlock(getRect()).then((resumed) => {
        // If resume failed (webview was destroyed externally), fall back to open.
        if (!resumed) void openInlineWebViewBlock(resolvedUrl, getRect(), inlineWebViewThemeRef.current)
      })
    } else {
      // First open — create and load.
      void openInlineWebViewBlock(resolvedUrl, getRect(), inlineWebViewThemeRef.current)
      iosWebViewMountedRef.current = true
    }

    const observer = new ResizeObserver(() => {
      void updateInlineWebViewFrameBlock(getRect())
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      // Component unmounting — truly destroy the webview.
      void closeInlineWebViewBlock()
      iosWebViewMountedRef.current = false
    }
  }, [isCapacitorRuntime, isTrusted, resolvedUrl, suspended])

  // Push app theme changes to the live iOS webview so an open article re-themes
  // when the user flips dark/light without needing a reload.
  useEffect(() => {
    if (!isCapacitorRuntime || !iosWebViewMountedRef.current || suspended) return
    void setInlineWebViewThemeBlock(inlineWebViewTheme)
  }, [isCapacitorRuntime, inlineWebViewTheme, suspended])

  // Webview back-state tracking (Electron only)
  useEffect(() => {
    setCanGoBack(false)
  }, [resolvedUrl])

  useEffect(() => {
    if (!isElectronRuntime || !isTrusted || !electronGuestMounted) return
    const webview = getElectronWebviewBlock()
    if (!webview) return

    const updateCanGoBack = () => {
      setCanGoBack(Boolean(webview.canGoBack?.()))
    }

    webview.addEventListener('did-navigate', updateCanGoBack)
    webview.addEventListener('did-navigate-in-page', updateCanGoBack)
    webview.addEventListener('did-finish-load', updateCanGoBack as EventListener)
    return () => {
      webview.removeEventListener('did-navigate', updateCanGoBack)
      webview.removeEventListener('did-navigate-in-page', updateCanGoBack)
      webview.removeEventListener('did-finish-load', updateCanGoBack as EventListener)
    }
  }, [electronGuestMounted, getElectronWebviewBlock, isElectronRuntime, isTrusted])

  // macOS 2-finger swipe gesture forwarded from BrowserWindow 'swipe' event
  useEffect(() => {
    if (!isElectronRuntime) return
    const cleanup = (window.electronAPI as unknown as {
      onWebviewSwipe?: (cb: (dir: 'left' | 'right') => void) => () => void
    })?.onWebviewSwipe?.((direction) => {
      const wv = getElectronWebviewBlock()
      if (direction === 'left') wv?.goBack?.()
      else wv?.goForward?.()
    })
    return cleanup
  }, [getElectronWebviewBlock, isElectronRuntime])

  const handleGoBack = useCallback(() => {
    getElectronWebviewBlock()?.goBack?.()
  }, [getElectronWebviewBlock])

  const handleReload = useCallback(() => {
    if (isElectronRuntime) {
      const webview = getElectronWebviewBlock()
      if (!electronGuestMounted || !webview?.reload) {
        remountElectronWebviewBlock()
        return
      }
      try {
        webview.reload()
      } catch (error) {
        if (error instanceof Error && error.message.includes('dom-ready')) {
          remountElectronWebviewBlock()
          return
        }
        throw error
      }
    } else {
      setReloadKey(k => k + 1)
    }
  }, [electronGuestMounted, getElectronWebviewBlock, isElectronRuntime, remountElectronWebviewBlock])

  useEffect(() => {
    if (!passwordAutofillEnabled) {
      setPasswordAutofillContext(null)
      setPasswordAutofillError(null)
      return
    }

    let cancelled = false
    const probe = async () => {
      const webview = getElectronWebviewBlock()
      if (!webview?.executeJavaScript || passwordProbeInFlightRef.current) return
      passwordProbeInFlightRef.current = true
      try {
        const context = await probePasswordAutofillContextBlock(webview)
        if (!cancelled) {
          setPasswordAutofillContext(context)
        }
      } catch {
        if (!cancelled) {
          setPasswordAutofillContext(null)
        }
      } finally {
        passwordProbeInFlightRef.current = false
      }
    }

    // 700ms `executeJavaScript` into a live webview is the most expensive
    // recurring timer in the app, and it exists purely to notice that a login
    // form appeared. Nothing can appear on a document nobody is looking at, so
    // the timer stops while hidden and re-probes immediately on return.
    let intervalId: number | null = null
    const startProbing = () => {
      if (intervalId !== null) return
      intervalId = window.setInterval(() => { void probe() }, 700)
    }
    const stopProbing = () => {
      if (intervalId === null) return
      window.clearInterval(intervalId)
      intervalId = null
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void probe()
        startProbing()
      } else {
        stopProbing()
      }
    }
    if (document.visibilityState === 'visible') startProbing()
    document.addEventListener('visibilitychange', onVisibilityChange)

    const webview = getElectronWebviewBlock()
    const handleLoad = () => {
      setPasswordAutofillError(null)
      void probe()
    }
    webview?.addEventListener('did-finish-load', handleLoad as EventListener)
    webview?.addEventListener('did-navigate-in-page', handleLoad as EventListener)
    void probe()

    return () => {
      cancelled = true
      stopProbing()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      webview?.removeEventListener('did-finish-load', handleLoad as EventListener)
      webview?.removeEventListener('did-navigate-in-page', handleLoad as EventListener)
    }
  }, [getElectronWebviewBlock, passwordAutofillEnabled, resolvedUrl])

  const handlePasswordAutofillUnlock = useCallback(async () => {
    const normalized = passwordAutofillUnlockInput.trim()
    if (!normalized) {
      setPasswordAutofillError('Enter your password vault passphrase.')
      return
    }
    setPasswordAutofillBusyAction('unlock')
    setPasswordAutofillError(null)
    try {
      await unlockPasswordVaultSessionOrch(normalized)
      setPasswordAutofillUnlockInput('')
    } catch (err) {
      setPasswordAutofillError(err instanceof Error ? err.message : 'Failed to unlock passwords.')
    } finally {
      setPasswordAutofillBusyAction(null)
    }
  }, [passwordAutofillUnlockInput])

  const handlePasswordAutofillFill = useCallback(async (entry: PasswordVaultEntryBlock) => {
    const webview = getElectronWebviewBlock()
    if (!webview?.executeJavaScript) return
    setPasswordAutofillBusyAction('fill')
    setPasswordAutofillError(null)
    try {
      const result = await webview.executeJavaScript(
        buildPasswordAutofillFillScriptBlock({
          username: entry.username,
          password: entry.password,
        }),
        true,
      )
      if (!result) {
        throw new Error('Could not fill the active login form.')
      }
    } catch (err) {
      setPasswordAutofillError(err instanceof Error ? err.message : 'Failed to fill saved password.')
    } finally {
      setPasswordAutofillBusyAction(null)
    }
  }, [getElectronWebviewBlock])

  const handlePasswordAutofillSave = useCallback(async () => {
    if (!passwordSession.vaultState || !passwordAutofillContext) return
    const password = passwordAutofillContext.passwordValue.trim()
    if (!password) {
      setPasswordAutofillError('Type a password in the site first.')
      return
    }

    const now = new Date().toISOString()
    const existing = passwordAutofillSaveTarget
    const nextEntry: PasswordVaultEntryBlock = {
      id: existing?.id ?? createPasswordVaultEntryIdOrch(),
      title: existing?.title ?? derivePasswordEntryTitleBlock(
        passwordAutofillContext.pageTitle,
        passwordAutofillContext.hostname,
      ),
      username: passwordAutofillContext.usernameValue.trim(),
      password,
      website: passwordAutofillContext.origin || passwordAutofillContext.url,
      notes: existing?.notes,
      tags: existing?.tags ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    const nextEntries = existing
      ? passwordSession.vaultState.vault.entries.map((entry) => entry.id === existing.id ? nextEntry : entry)
      : [nextEntry, ...passwordSession.vaultState.vault.entries]

    setPasswordAutofillBusyAction('save')
    setPasswordAutofillError(null)
    try {
      await savePasswordVaultSessionVaultOrch({
        ...passwordSession.vaultState.vault,
        updatedAt: now,
        entries: nextEntries,
      })
    } catch (err) {
      setPasswordAutofillError(err instanceof Error ? err.message : 'Failed to save password.')
    } finally {
      setPasswordAutofillBusyAction(null)
    }
  }, [passwordAutofillContext, passwordAutofillSaveTarget, passwordSession.vaultState])

  const openExternal = useCallback(() => {
    if (!resolvedUrl) return
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(resolvedUrl)
    } else {
      window.open(resolvedUrl, '_blank', 'noopener,noreferrer')
    }
  }, [resolvedUrl])

  if (loading) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !isTrusted) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 p-8', className)}>
        <Globe className="h-8 w-8 text-muted-foreground/50" />
        <div className="text-sm text-destructive">{error ?? 'Invalid or unsupported URL.'}</div>
        {showCloseButton && onClose && (
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Close
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* URL bar */}
      {!hideHeader && (
        <div className="ts-doc-header flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2">
          {isElectronRuntime && (
            <button
              type="button"
              onClick={handleGoBack}
              disabled={!canGoBack}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              title="Go back"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <Globe className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{displayUrl}</span>
          <button
            type="button"
            onClick={handleReload}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            title="Reload"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={openExternal}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            title="Open in external browser"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          {showCloseButton && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Content area */}
      <div ref={contentAreaRef} className="relative min-h-0 flex-1 overflow-hidden">
        {isElectronRuntime ? (
          electronGuestMounted ? (
            <ElectronPersistentWebviewBlock
              key={electronWebviewInstanceKey}
              webviewRef={webviewRef}
              title={displayTitle}
              partition={partition ?? LINK_WEBVIEW_PARTITION}
              useragent={webviewUserAgent}
              className="absolute inset-0 bg-background"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-background p-6">
              <div className="w-full max-w-md rounded-2xl border border-border/50 bg-muted/20 p-6 text-center">
                <div className="text-sm font-medium text-foreground">Webview inactive</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  This page was suspended after inactivity. Reload to restore it.
                </p>
                <button
                  type="button"
                  onClick={handleReload}
                  className="mt-4 inline-flex rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Reload webview
                </button>
              </div>
            </div>
          )
        ) : isCapacitorRuntime ? (
          // Native WKWebView is overlaid by the plugin — render a transparent
          // placeholder so the React layout reserves the same space.
          <div className="absolute inset-0" />
        ) : (
          <iframe
            key={reloadKey}
            title={displayTitle}
            src={resolvedUrl!}
            className="absolute inset-0 bg-background"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
        {passwordAutofillEnabled && passwordAutofillContext && (
          <div className="pointer-events-none absolute inset-0 z-20">
            <div
              className="pointer-events-auto absolute"
              style={{
                left: `${passwordAutofillStyle.left}px`,
                top: `${passwordAutofillStyle.top}px`,
              }}
            >
              <PasswordAutofillOverlayBlock
                hostname={passwordAutofillContext.hostname || displayTitle}
                locked={!passwordSession.unlocked}
                unlockPassphrase={passwordAutofillUnlockInput}
                onUnlockPassphraseChange={setPasswordAutofillUnlockInput}
                onUnlock={() => { void handlePasswordAutofillUnlock() }}
                unlocking={passwordAutofillBusyAction === 'unlock'}
                matches={passwordAutofillMatches}
                onFill={(entry) => { void handlePasswordAutofillFill(entry) }}
                filling={passwordAutofillBusyAction === 'fill'}
                canSave={passwordAutofillCanSave}
                saveLabel={passwordAutofillSaveTarget ? 'Update' : 'Save'}
                onSave={() => { void handlePasswordAutofillSave() }}
                saving={passwordAutofillBusyAction === 'save'}
                onOpenManager={() => navigate('/password-manager')}
                usernameValue={passwordAutofillContext.usernameValue}
                error={passwordAutofillError}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(UrlDocumentBlock)
