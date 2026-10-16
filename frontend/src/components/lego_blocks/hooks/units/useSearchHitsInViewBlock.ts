// Vault-search hits in a rendered (view-mode) note, painted with the CSS
// Custom Highlight API: ranges registered with the browser and styled by
// `::highlight(...)` in index.css. Nothing in the rendered DOM changes — no
// wrapper spans, no React re-render, no reflow — the same "paint, don't
// touch" rule the editor layer follows. Where the API is missing, hits are
// still counted and stepped through; they just aren't tinted.
//
// Several notes can be mounted at once (hidden tabs), and the highlight
// registry is global, so every instance adds its ranges to two shared
// Highlight objects instead of owning a registry entry.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  findSearchWordMatchesBlock,
  getSearchHighlightWordsBlock,
  onSearchHighlightWordsBlock,
  setSearchHighlightQueryBlock,
} from '@/services/lego_blocks/units/searchHighlightTermsBlock'

const HIT = 'ltm-search-hit'
const CURRENT = 'ltm-search-hit-current'

type SharedHighlights = { all: Highlight; current: Highlight } | null
let _shared: SharedHighlights | undefined

function shared(): SharedHighlights {
  if (_shared !== undefined) return _shared
  _shared = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
    ? { all: new Highlight(), current: new Highlight() }
    : null
  if (_shared) {
    CSS.highlights.set(HIT, _shared.all)
    CSS.highlights.set(CURRENT, _shared.current)
  }
  return _shared
}

function findRanges(root: HTMLElement, words: readonly string[]): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const { from, to } of findSearchWordMatchesBlock(node.nodeValue ?? '', words)) {
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, to)
      ranges.push(range)
    }
  }
  return ranges
}

function reveal(range: Range | undefined): void {
  const el = range?.startContainer.parentElement
  // A hidden (unmounted-tab) note has no layout; don't yank its scroller.
  if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export interface SearchHitsInView {
  words: readonly string[]
  count: number
  current: number
  step: (direction: 1 | -1) => void
  clear: () => void
}

/**
 * @param renderKey changes whenever the rendered content does (the markdown
 *   string), so hits are re-found after each render.
 */
export function useSearchHitsInViewBlock(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  renderKey: unknown,
): SearchHitsInView | null {
  const [words, setWords] = useState<readonly string[]>(getSearchHighlightWordsBlock)
  const [hits, setHits] = useState({ count: 0, current: -1 })
  const rangesRef = useRef<Range[]>([])
  const currentRef = useRef(-1)

  useEffect(() => onSearchHighlightWordsBlock(setWords), [])

  const paintCurrent = useCallback((index: number) => {
    const paint = shared()
    const prev = rangesRef.current[currentRef.current]
    if (paint && prev) paint.current.delete(prev)
    currentRef.current = index
    const next = rangesRef.current[index]
    if (paint && next) paint.current.add(next)
    setHits(h => ({ ...h, current: index }))
    reveal(next)
  }, [])

  useEffect(() => {
    const root = containerRef.current
    if (!enabled || !root || words.length === 0) return undefined
    const paint = shared()
    // Paint after the render settles (markdown renders can land in passes).
    const frame = requestAnimationFrame(() => {
      const ranges = findRanges(root, words)
      rangesRef.current = ranges
      currentRef.current = -1
      if (paint) for (const r of ranges) paint.all.add(r)
      setHits({ count: ranges.length, current: -1 })
      if (ranges.length > 0) paintCurrent(0)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (paint) {
        for (const r of rangesRef.current) {
          paint.all.delete(r)
          paint.current.delete(r)
        }
      }
      rangesRef.current = []
      currentRef.current = -1
    }
  }, [containerRef, enabled, paintCurrent, renderKey, words])

  const step = useCallback((direction: 1 | -1) => {
    const count = rangesRef.current.length
    if (count === 0) return
    paintCurrent((currentRef.current + direction + count) % count)
  }, [paintCurrent])

  // ⌘G / ⇧⌘G, as in the editor — only the note actually on screen answers.
  useEffect(() => {
    if (!enabled || words.length === 0) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'g' || !(event.metaKey || event.ctrlKey)) return
      if (containerRef.current?.offsetParent == null || rangesRef.current.length === 0) return
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [containerRef, enabled, step, words])

  const clear = useCallback(() => setSearchHighlightQueryBlock(null), [])

  if (!enabled || words.length === 0) return null
  return { words, count: hits.count, current: hits.current, step, clear }
}
