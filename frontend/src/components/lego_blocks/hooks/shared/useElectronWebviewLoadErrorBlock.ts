import { type RefObject, useEffect, useState } from 'react'
import { logInfo } from '@/services/lego_blocks/units/debugLogBlock'

interface ElectronWebviewLoadFailureEventBlock {
  errorCode?: number
  errorDescription?: unknown
  validatedURL?: string
  isMainFrame?: boolean
}

interface UseElectronWebviewLoadErrorBlockParams {
  enabled: boolean
  webviewRef: RefObject<HTMLElement | null>
  resolvedUrl?: string | null
  logSource: string
}

/** How long after a failure the guest's own error page may still be loading. */
const ERROR_PAGE_GRACE_MS_BLOCK = 1500

function formatWebviewLoadErrorMessageBlock(description: string): string {
  const normalized = description.trim()
  if (normalized === 'ERR_BLOCKED_BY_RESPONSE') {
    return 'This page blocked being displayed inside Thinking Space. Open it in your browser instead.'
  }
  // The site broke off the connection; it often does this to apps but not to a browser
  if (/^ERR_(HTTP2_PROTOCOL_ERROR|CONNECTION_(RESET|CLOSED)|EMPTY_RESPONSE|TIMED_OUT)$/.test(normalized)) {
    return `The site cut the connection (${normalized}). It may load in your browser.`
  }
  return normalized || 'Failed to load page.'
}

export function useElectronWebviewLoadErrorBlock({
  enabled,
  webviewRef,
  resolvedUrl,
  logSource,
}: UseElectronWebviewLoadErrorBlockParams): string | null {
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoadError(null)
      return
    }
    setLoadError(null)
  }, [enabled, resolvedUrl])

  useEffect(() => {
    if (!enabled) return
    const webview = webviewRef.current
    if (!webview) return

    // A failed load is followed at once by Chromium loading its own error page
    // into the guest, which fires the same start/finish events as a real load.
    // Clearing on those wiped the message the moment it was set, leaving a
    // blank page (seen with ERR_HTTP2_PROTOCOL_ERROR on eetimes.com). A load
    // that starts more than a moment later is the user's (Try again, a link).
    let failedAt = 0
    const clearLoadError = () => {
      if (Date.now() - failedAt < ERROR_PAGE_GRACE_MS_BLOCK) return
      setLoadError(null)
    }

    const handleFailLoad = (event: unknown) => {
      const ev = event as ElectronWebviewLoadFailureEventBlock | null
      const errorCode = ev?.errorCode ?? 0
      // ERR_ABORTED (-3) fires on normal navigation cancellations — not a real error.
      if (errorCode === -3) return
      // Many sites emit guest-frame failures for blocked third-party widgets even when
      // the main page itself loaded correctly. Only surface top-level failures.
      if (ev?.isMainFrame === false) return

      failedAt = Date.now()
      const description = String(ev?.errorDescription ?? 'Failed to load page.')
      const failedUrl = ev?.validatedURL ?? resolvedUrl ?? ''
      setLoadError(formatWebviewLoadErrorMessageBlock(description))
      // A site that will not load is the site's problem, not the app's: shown
      // in place by the caller, and only noted in the debug log (no toast).
      logInfo(description, failedUrl ? `URL: ${failedUrl}` : undefined, logSource)
    }

    webview.addEventListener('did-fail-load', handleFailLoad as EventListener)
    webview.addEventListener('did-start-loading', clearLoadError as EventListener)
    webview.addEventListener('did-finish-load', clearLoadError as EventListener)
    return () => {
      webview.removeEventListener('did-fail-load', handleFailLoad as EventListener)
      webview.removeEventListener('did-start-loading', clearLoadError as EventListener)
      webview.removeEventListener('did-finish-load', clearLoadError as EventListener)
    }
  }, [enabled, logSource, resolvedUrl, webviewRef])

  return loadError
}
