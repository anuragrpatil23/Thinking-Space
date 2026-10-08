import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Minus, Plus, RotateCw, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import DocumentFindBarBlock from '@/components/lego_blocks/integrations/DocumentFindBarBlock'
import {
  useWebviewFindBlock,
  type FindableWebviewElementBlock,
} from '@/components/lego_blocks/hooks/units/useWebviewFindBlock'

interface HtmlDocumentBlockProps {
  html: string
  /** Vault path of the page. With it (Electron) the page loads from a real
   *  URL scoped to its own folder, so relative scripts/data and localStorage
   *  work; without it the page falls back to an address-less data: URL. */
  path?: string
  /** Whether this document owns keyboard shortcuts (Cmd/Ctrl+F). */
  active?: boolean
  className?: string
}

// Must match VAULT_HTML_PAGE_PARTITION_BLOCK in electron vaultHtmlPageBlock.ts.
const HTML_PAGE_WEBVIEW_PARTITION = 'persist:thinking-space-html-pages'
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

interface HtmlPageWebviewElementBlock extends FindableWebviewElementBlock {
  reload?: () => void
  setZoomFactor?: (factor: number) => void
}

function encodeHtmlAsDataUrl(html: string): string {
  const utf8 = new TextEncoder().encode(html)
  let binary = ''
  for (let i = 0; i < utf8.length; i += 1) {
    binary += String.fromCharCode(utf8[i])
  }
  return `data:text/html;charset=utf-8;base64,${btoa(binary)}`
}

const toolButtonClassName =
  'rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'

export default function HtmlDocumentBlock({
  html,
  path,
  active = true,
  className,
}: HtmlDocumentBlockProps) {
  const electron = isElectron()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // undefined = still asking main; null = unavailable, use the data: fallback.
  const [pageUrl, setPageUrl] = useState<string | null | undefined>(undefined)
  const webviewRef = useRef<HtmlPageWebviewElementBlock | null>(null)
  const guestReadyRef = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [findOpen, setFindOpen] = useState(false)
  const find = useWebviewFindBlock(webviewRef, { active: findOpen })

  useEffect(() => {
    if (!electron) return
    const root = getStoredVaultRoot()
    const mint = window.electronAPI?.vaultHtmlPageUrl
    if (!path || !root || !mint) {
      setPageUrl(null)
      return
    }
    let cancelled = false
    setPageUrl(undefined)
    mint(root, path)
      .then((url) => { if (!cancelled) setPageUrl(url) })
      .catch(() => { if (!cancelled) setPageUrl(null) })
    return () => { cancelled = true }
  }, [electron, path])

  const dataUrl = useMemo(
    () => (electron && pageUrl === null ? encodeHtmlAsDataUrl(html) : null),
    [electron, pageUrl, html],
  )
  const webviewSrc = pageUrl ?? dataUrl

  useEffect(() => {
    if (electron) {
      setPreviewUrl(null)
      return
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    setPreviewUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [electron, html])

  const reload = useCallback(() => {
    if (!guestReadyRef.current) return
    try {
      webviewRef.current?.reload?.()
    } catch {
      // Guest detached between the ready event and now.
    }
  }, [])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !webviewSrc) return
    guestReadyRef.current = false
    const onReady = () => {
      guestReadyRef.current = true
      // Chromium keeps zoom per origin; re-assert ours so the control and the
      // page never disagree after a reload or a remount.
      try {
        webview.setZoomFactor?.(zoomRef.current)
      } catch {
        // Guest detached.
      }
    }
    webview.addEventListener('dom-ready', onReady)
    return () => webview.removeEventListener('dom-ready', onReady)
  }, [webviewSrc])

  // The page URL is stable while the file changes underneath it, so a saved
  // edit (ours or an agent's) needs an explicit reload to show up.
  const loadedHtmlRef = useRef(html)
  useEffect(() => {
    if (loadedHtmlRef.current === html) return
    loadedHtmlRef.current = html
    if (pageUrl) reload()
  }, [html, pageUrl, reload])

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const stepZoom = useCallback((direction: 1 | -1) => {
    const current = ZOOM_STEPS.findIndex((step) => step >= zoomRef.current - 0.001)
    const index = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (current < 0 ? ZOOM_STEPS.length - 1 : current) + direction))
    const next = ZOOM_STEPS[index]
    setZoom(next)
    if (!guestReadyRef.current) return
    try {
      webviewRef.current?.setZoomFactor?.(next)
    } catch {
      // Guest detached.
    }
  }, [])

  const showWebview = electron && Boolean(webviewSrc)
  useEffect(() => {
    if (!showWebview || !active) return
    // Only reaches us while focus is in the app chrome: keystrokes typed
    // inside the page stay in the guest. The toolbar button covers that case.
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showWebview, active])

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {showWebview && (
        <div className="flex shrink-0 items-center justify-end gap-0.5 border-b border-border/50 px-3 py-1">
          <button type="button" className={toolButtonClassName} onClick={() => setFindOpen(true)} aria-label="Find in page" title="Find in page">
            <Search className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={toolButtonClassName} onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0]} aria-label="Zoom out" title="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[2.75rem] text-center text-[11px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" className={toolButtonClassName} onClick={() => stepZoom(1)} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Zoom in" title="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={toolButtonClassName} onClick={reload} aria-label="Reload page" title="Reload page">
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {/* Edge to edge: every pixel of inset narrows the page's own viewport
          and can tip it into its small-screen layout. */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {findOpen && showWebview && (
          <div className="absolute right-3 top-3 z-10">
            <DocumentFindBarBlock find={find} onClose={() => setFindOpen(false)} />
          </div>
        )}
        {electron && webviewSrc ? (
          // <webview> runs in a separate WebContents with its own session, so
          // the renderer CSP isn't inherited. Required for HTML docs that pull
          // scripts from CDNs (three.js, etc.). Keyed on the address, not the
          // content: a content change reloads in place instead of remounting.
          <webview
            key={webviewSrc}
            ref={(node: HTMLElement | null) => {
              webviewRef.current = node as HtmlPageWebviewElementBlock | null
            }}
            src={webviewSrc}
            partition={HTML_PAGE_WEBVIEW_PARTITION}
            allowpopups
            className="h-full w-full bg-white"
          />
        ) : !electron && previewUrl ? (
          <iframe
            title="HTML preview"
            src={previewUrl}
            className="h-full w-full bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex h-full min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading HTML preview...
          </div>
        )}
      </div>
    </div>
  )
}
