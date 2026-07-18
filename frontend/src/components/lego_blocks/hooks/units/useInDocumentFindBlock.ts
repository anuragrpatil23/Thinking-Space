import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

/**
 * Browser-style "find in this document" over a rendered container, backed by
 * the CSS Custom Highlight API — so matches are highlighted without mutating
 * the DOM (safe under React's rendered markdown). One find session is active
 * at a time; the highlights are global (document-scoped) by design.
 */

const HIGHLIGHT_ALL = 'ltm-find'
const HIGHLIGHT_CURRENT = 'ltm-find-current'

interface CSSHighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

function getHighlightsRegistry(): CSSHighlightRegistry | null {
  if (typeof CSS === 'undefined') return null
  const registry = (CSS as unknown as { highlights?: CSSHighlightRegistry }).highlights
  return registry ?? null
}

function getHighlightCtor(): (new (...ranges: Range[]) => unknown) | null {
  const ctor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  return ctor ?? null
}

/** All (start-offset) match positions of `needle` inside a single text node. */
function collectMatchesInNode(text: string, needle: string): number[] {
  const offsets: number[] = []
  if (!needle) return offsets
  const haystack = text.toLowerCase()
  const target = needle.toLowerCase()
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(target, from)
    if (idx < 0) break
    offsets.push(idx)
    from = idx + target.length
  }
  return offsets
}

export interface InDocumentFindState {
  query: string
  setQuery: (query: string) => void
  matchCount: number
  /** 1-based position of the current match, or 0 when there are none. */
  activePosition: number
  next: () => void
  prev: () => void
  /** Recompute matches — call after the container's content changes. */
  refresh: () => void
  supported: boolean
}

export function useInDocumentFindBlock(
  containerRef: RefObject<HTMLElement | null>,
  options: { active?: boolean } = {},
): InDocumentFindState {
  const active = options.active ?? true
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rangesRef = useRef<Range[]>([])
  const supported = useMemo(() => Boolean(getHighlightsRegistry() && getHighlightCtor()), [])

  const paintHighlights = useCallback((activeIdx: number) => {
    const registry = getHighlightsRegistry()
    const HighlightCtor = getHighlightCtor()
    if (!registry || !HighlightCtor) return
    const ranges = rangesRef.current
    if (ranges.length === 0) {
      registry.delete(HIGHLIGHT_ALL)
      registry.delete(HIGHLIGHT_CURRENT)
      return
    }
    registry.set(HIGHLIGHT_ALL, new HighlightCtor(...ranges))
    const current = ranges[activeIdx]
    if (current) {
      const currentHighlight = new HighlightCtor(current) as { priority?: number }
      currentHighlight.priority = 1
      registry.set(HIGHLIGHT_CURRENT, currentHighlight)
    } else {
      registry.delete(HIGHLIGHT_CURRENT)
    }
  }, [])

  const clearHighlights = useCallback(() => {
    const registry = getHighlightsRegistry()
    if (!registry) return
    registry.delete(HIGHLIGHT_ALL)
    registry.delete(HIGHLIGHT_CURRENT)
  }, [])

  const compute = useCallback(() => {
    const container = containerRef.current
    const needle = query.trim()
    if (!container || needle.length === 0 || !supported) {
      rangesRef.current = []
      setMatchCount(0)
      setActiveIndex(-1)
      clearHighlights()
      return
    }
    // Prefer the rendered document body so chrome (header, TOC, buttons)
    // outside it never counts as a match.
    const searchRoot = (container.querySelector('[data-markdown-nav-root]') as HTMLElement | null) ?? container
    const ranges: Range[] = []
    const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT
        return node.nodeValue && node.nodeValue.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      },
    })
    let node = walker.nextNode()
    while (node) {
      const text = node.nodeValue ?? ''
      for (const offset of collectMatchesInNode(text, needle)) {
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + needle.length)
        ranges.push(range)
      }
      node = walker.nextNode()
    }
    rangesRef.current = ranges
    setMatchCount(ranges.length)
    setActiveIndex((prev) => {
      if (ranges.length === 0) return -1
      const clamped = prev < 0 ? 0 : Math.min(prev, ranges.length - 1)
      return clamped
    })
  }, [clearHighlights, containerRef, query, supported])

  // Recompute whenever the query changes (or find becomes active).
  useEffect(() => {
    if (!active) return
    compute()
  }, [active, compute])

  // Repaint + scroll the active match into view whenever it moves.
  useEffect(() => {
    if (!active) return
    paintHighlights(activeIndex)
    const range = rangesRef.current[activeIndex]
    if (range) {
      const rect = range.getBoundingClientRect()
      const el = range.startContainer.parentElement
      if (rect.height > 0 && el && (rect.top < 0 || rect.bottom > window.innerHeight)) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
  }, [active, activeIndex, matchCount, paintHighlights])

  // Tear down highlights when find closes or the component unmounts.
  useEffect(() => {
    if (active) return
    clearHighlights()
    rangesRef.current = []
  }, [active, clearHighlights])

  useEffect(() => () => clearHighlights(), [clearHighlights])

  const next = useCallback(() => {
    setActiveIndex((prev) => {
      const count = rangesRef.current.length
      if (count === 0) return -1
      return (prev + 1) % count
    })
  }, [])

  const prev = useCallback(() => {
    setActiveIndex((prevIdx) => {
      const count = rangesRef.current.length
      if (count === 0) return -1
      return (prevIdx - 1 + count) % count
    })
  }, [])

  return {
    query,
    setQuery,
    matchCount,
    activePosition: activeIndex < 0 ? 0 : activeIndex + 1,
    next,
    prev,
    refresh: compute,
    supported,
  }
}
