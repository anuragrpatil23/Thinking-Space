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

function formatWebviewLoadErrorMessageBlock(description: string): string {
  const normalized = description.trim()
  if (normalized === 'ERR_BLOCKED_BY_RESPONSE') {
    return 'This page blocked being displayed inside Thinking Space. Open it in your browser instead.'
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

    const clearLoadError = () => {
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
