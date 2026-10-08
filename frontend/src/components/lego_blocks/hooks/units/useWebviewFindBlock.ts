import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { InDocumentFindState } from '@/components/lego_blocks/hooks/units/useInDocumentFindBlock'

export interface FindableWebviewElementBlock extends HTMLElement {
  findInPage?: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number
  stopFindInPage?: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
}

interface FoundInPageEventBlock {
  result?: { matches?: number; activeMatchOrdinal?: number }
}

/**
 * Find-in-page for an Electron `<webview>`, in the same shape as
 * useInDocumentFindBlock so DocumentFindBarBlock drives either. The guest is a
 * separate WebContents — the host's CSS Highlight find cannot see into it, so
 * this delegates to Chromium's own find.
 */
export function useWebviewFindBlock(
  webviewRef: RefObject<FindableWebviewElementBlock | null>,
  options: { active?: boolean } = {},
): InDocumentFindState {
  const active = options.active ?? true
  const [query, setQueryState] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activePosition, setActivePosition] = useState(0)
  const queryRef = useRef('')

  const run = useCallback((text: string, forward: boolean, findNext: boolean) => {
    const webview = webviewRef.current
    if (!webview?.findInPage) return
    try {
      if (!text) {
        webview.stopFindInPage?.('clearSelection')
        setMatchCount(0)
        setActivePosition(0)
        return
      }
      webview.findInPage(text, { forward, findNext })
    } catch {
      // Guest not attached yet (or already gone) — nothing to search.
    }
  }, [webviewRef])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !active) return
    const onFound = (event: Event) => {
      const result = (event as unknown as FoundInPageEventBlock).result
      setMatchCount(result?.matches ?? 0)
      setActivePosition(result?.activeMatchOrdinal ?? 0)
    }
    webview.addEventListener('found-in-page', onFound)
    return () => {
      webview.removeEventListener('found-in-page', onFound)
      try {
        webview.stopFindInPage?.('clearSelection')
      } catch {
        // Guest already detached.
      }
    }
  }, [webviewRef, active])

  const setQuery = useCallback((next: string) => {
    queryRef.current = next
    setQueryState(next)
    run(next, true, false)
  }, [run])

  return {
    query,
    setQuery,
    matchCount,
    activePosition,
    next: () => run(queryRef.current, true, true),
    prev: () => run(queryRef.current, false, true),
    refresh: () => run(queryRef.current, true, false),
    supported: true,
  }
}
