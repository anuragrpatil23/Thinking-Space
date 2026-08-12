import { memo, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { WebSiteBlock } from '@/services/lego_blocks/units/webSiteBlock'
import {
  buildCodexUsageProbeErrorResultBlock,
  buildCodexUsageProbeLoadingResultBlock,
  codexUsageProbeScriptBlock,
  detectCodexUsageProbeResultBlock,
  parseCodexUsageProbeSnapshotBlock,
  type CodexUsageProbeResultBlock,
} from '@/services/lego_blocks/units/codexUsageProbeBlock'

interface ElectronProbeWebviewElementBlock extends HTMLElement {
  executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
}

interface CodexUsageProbeGuestBlockProps {
  site: WebSiteBlock
  refreshToken: number
  freshResultSiteIds: ReadonlySet<string>
  onResult: (result: CodexUsageProbeResultBlock) => void
}

const PROBE_INTERVAL_MS = 30000

const HIDDEN_PROBE_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  opacity: 0.01,
  pointerEvents: 'none',
  left: -10000,
  top: -10000,
}

function buildProbeUserAgentBlock(): string {
  return navigator.userAgent
    .replace(/\s*Electron\/[\d.]+/g, '')
    .replace(/\s*Thinking Space\/[\d.]+/g, '')
    .trim()
}

const PROBE_USER_AGENT = typeof navigator === 'undefined' ? undefined : buildProbeUserAgentBlock()

const CodexUsageProbeGuestBlock = memo(function CodexUsageProbeGuestBlock({
  site,
  refreshToken,
  freshResultSiteIds,
  onResult,
}: CodexUsageProbeGuestBlockProps) {
  const webviewRef = useRef<ElectronProbeWebviewElementBlock | null>(null)
  const pollInFlightRef = useRef(false)
  const webviewKey = useMemo(() => `${site.id}:${refreshToken}`, [refreshToken, site.id])
  // Capture freshness at mount time — don't re-run effects when parent cache updates
  const isFreshRef = useRef(freshResultSiteIds.has(site.id))

  useEffect(() => {
    // Refresh token bump always means manual refresh — reset freshness guard
    isFreshRef.current = refreshToken === 0 ? freshResultSiteIds.has(site.id) : false
    if (!isFreshRef.current) {
      onResult(buildCodexUsageProbeLoadingResultBlock(site.id))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onResult, refreshToken, site.id])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview?.executeJavaScript) {
      onResult(buildCodexUsageProbeErrorResultBlock(site.id, 'Electron webview probing is unavailable.'))
      return
    }

    let cancelled = false

    const runProbe = async () => {
      if (pollInFlightRef.current || cancelled) return
      pollInFlightRef.current = true
      try {
        const raw = await webview.executeJavaScript?.(codexUsageProbeScriptBlock(), true)
        if (cancelled) return
        const snapshot = parseCodexUsageProbeSnapshotBlock(raw)
        if (!snapshot) {
          onResult(buildCodexUsageProbeErrorResultBlock(site.id, 'Probe script returned an invalid snapshot.'))
          return
        }
        onResult(detectCodexUsageProbeResultBlock(site.id, site.url, snapshot))
      } catch (error) {
        if (!cancelled) {
          onResult(buildCodexUsageProbeErrorResultBlock(site.id, error instanceof Error ? error.message : String(error)))
        }
      } finally {
        pollInFlightRef.current = false
      }
    }

    const handleLoad = () => { void runProbe() }
    const handleFailLoad = (event: Event) => {
      const candidate = event as Event & { errorDescription?: unknown; isMainFrame?: boolean; errorCode?: number }
      if (candidate.isMainFrame === false || candidate.errorCode === -3) return
      onResult(
        buildCodexUsageProbeErrorResultBlock(
          site.id,
          typeof candidate.errorDescription === 'string' ? candidate.errorDescription : 'Failed to load web session.',
        ),
      )
    }

    webview.addEventListener('did-finish-load', handleLoad as EventListener)
    webview.addEventListener('did-navigate-in-page', handleLoad as EventListener)
    webview.addEventListener('did-fail-load', handleFailLoad as EventListener)

    // Usage numbers only matter to someone reading them; don't drive a hidden
    // webview on a timer. Re-probes on return so the panel is never stale.
    let intervalId: number | null = null
    const startProbing = () => {
      if (intervalId !== null) return
      intervalId = window.setInterval(() => { void runProbe() }, PROBE_INTERVAL_MS)
    }
    const stopProbing = () => {
      if (intervalId === null) return
      window.clearInterval(intervalId)
      intervalId = null
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runProbe()
        startProbing()
      } else {
        stopProbing()
      }
    }
    if (document.visibilityState === 'visible') startProbing()
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Skip immediate probe if we have a fresh cached result for this site
    if (!isFreshRef.current) {
      void runProbe()
    }

    return () => {
      cancelled = true
      stopProbing()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      webview.removeEventListener('did-finish-load', handleLoad as EventListener)
      webview.removeEventListener('did-navigate-in-page', handleLoad as EventListener)
      webview.removeEventListener('did-fail-load', handleFailLoad as EventListener)
    }
  }, [onResult, refreshToken, site.id, site.url])

  return (
    <webview
      key={webviewKey}
      ref={(element) => { webviewRef.current = element as ElectronProbeWebviewElementBlock | null }}
      src={site.url}
      partition={site.partition}
      useragent={PROBE_USER_AGENT}
      style={HIDDEN_PROBE_STYLE}
    />
  )
})

export interface CodexUsageProbeBlockProps {
  sites: WebSiteBlock[]
  refreshToken: number
  freshResultSiteIds: ReadonlySet<string>
  onResult: (result: CodexUsageProbeResultBlock) => void
}

export default function CodexUsageProbeBlock({
  sites,
  refreshToken,
  freshResultSiteIds,
  onResult,
}: CodexUsageProbeBlockProps) {
  if (!window.electronAPI?.isElectron || sites.length === 0) return null

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden opacity-0">
      {sites.map((site) => (
        <CodexUsageProbeGuestBlock
          key={`${site.id}:${refreshToken}`}
          site={site}
          refreshToken={refreshToken}
          freshResultSiteIds={freshResultSiteIds}
          onResult={onResult}
        />
      ))}
    </div>
  )
}
