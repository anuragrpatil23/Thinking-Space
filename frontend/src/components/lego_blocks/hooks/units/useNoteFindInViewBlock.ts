// Find-in-note matches in a rendered (view-mode) note, painted with the CSS
// Custom Highlight API: ranges registered with the browser and styled by
// `::highlight(ltm-find…)` in index.css. Nothing in the rendered DOM changes —
// no wrapper spans, no React re-render, no reflow — the same "paint, don't
// touch" rule as the editor's findMatchLayerBlock. Where the API is missing,
// matches are still counted and stepped through; they just aren't tinted.
//
// Several notes can be mounted at once (hidden tabs) and the highlight
// registry is global, so every instance adds its ranges to two shared
// Highlight objects rather than owning (and clobbering) a registry entry.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  findNoteMatchesBlock,
  sameNoteFindQueryBlock,
  type NoteFindQuery,
} from '@/services/lego_blocks/units/searchHighlightTermsBlock'

type SharedHighlights = { all: Highlight; current: Highlight } | null
let _shared: SharedHighlights | undefined

function shared(): SharedHighlights {
  if (_shared !== undefined) return _shared
  _shared = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
    ? { all: new Highlight(), current: new Highlight() }
    : null
  if (_shared) {
    _shared.current.priority = 1
    CSS.highlights.set('ltm-find', _shared.all)
    CSS.highlights.set('ltm-find-current', _shared.current)
  }
  return _shared
}

function findRanges(root: HTMLElement, query: NoteFindQuery): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const tag = node.parentElement?.tagName
      return tag === 'SCRIPT' || tag === 'STYLE' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const { from, to } of findNoteMatchesBlock(node.nodeValue ?? '', query)) {
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, to)
      ranges.push(range)
    }
  }
  return ranges
}

/** The first jump on opening is instant — an animated scroll while the note
 *  is still settling (images, numbered headings) reads as jitter. Stepping
 *  with ↑/↓ animates. */
function reveal(range: Range | undefined, behavior: ScrollBehavior): void {
  const el = range?.startContainer.parentElement
  // A hidden (background-tab) note has no layout; don't yank its scroller.
  if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'center', behavior })
}

const sameMatches = (a: NoteFindMatches | null, b: NoteFindMatches) =>
  a !== null && a.count === b.count && a.current === b.current

export interface NoteFindMatches {
  count: number
  /** Index of the match being looked at; -1 when none. */
  current: number
}

/**
 * Attach `ref` to the element the note renders into. Matches are found when
 * that element appears, when the query changes, and whenever the rendered
 * content changes (a MutationObserver — late renders like diagrams or a note
 * finishing loading are seen without the caller saying so; painting never
 * mutates the DOM, so it can't retrigger itself). `matches` is null until a
 * search has actually run, so nothing claims "no matches" before looking.
 */
export function useNoteFindInViewBlock(enabled: boolean, queryInput: NoteFindQuery | null): {
  ref: (el: HTMLElement | null) => void
  matches: NoteFindMatches | null
  step: (direction: 1 | -1) => void
} {
  // Compare queries by content: an equal query built fresh on a re-render
  // must not restart the search (and jump back to the first match).
  const queryRef = useRef(queryInput)
  if (!sameNoteFindQueryBlock(queryRef.current, queryInput)) queryRef.current = queryInput
  const query = queryRef.current
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [matches, setMatches] = useState<NoteFindMatches | null>(null)
  const rangesRef = useRef<Range[]>([])
  const currentRef = useRef(-1)

  const paintCurrent = useCallback((index: number, scroll: ScrollBehavior | null) => {
    const paint = shared()
    const prev = rangesRef.current[currentRef.current]
    if (paint && prev) paint.current.delete(prev)
    currentRef.current = index
    const next = rangesRef.current[index]
    if (paint && next) paint.current.add(next)
    if (scroll) reveal(next, scroll)
  }, [])

  // Only re-render the note when what the bar shows actually changed: a
  // re-scan that finds the same thing must not re-render (re-renders can
  // touch the DOM, the observer would see it, and the two would loop).
  const publish = useCallback((count: number) => {
    const next = { count, current: currentRef.current }
    setMatches(prev => (sameMatches(prev, next) ? prev : next))
  }, [])

  useEffect(() => {
    setMatches(null)
    if (!enabled || !root || !query) return undefined
    const paint = shared()
    let frame = 0
    let revealed = false

    const unpaint = () => {
      if (!paint) return
      for (const r of rangesRef.current) {
        paint.all.delete(r)
        paint.current.delete(r)
      }
    }
    const scan = () => {
      frame = 0
      const keep = currentRef.current
      unpaint()
      const ranges = findRanges(root, query)
      rangesRef.current = ranges
      currentRef.current = -1
      if (paint) for (const r of ranges) paint.all.add(r)
      // Bring the first match in once per query, not on every re-render.
      if (ranges.length > 0) {
        paintCurrent(revealed ? Math.min(Math.max(keep, 0), ranges.length - 1) : 0, revealed ? null : 'auto')
        revealed = true
      }
      publish(ranges.length)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(scan)
    }

    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      unpaint()
      rangesRef.current = []
      currentRef.current = -1
    }
  }, [enabled, paintCurrent, publish, query, root])

  const step = useCallback((direction: 1 | -1) => {
    const count = rangesRef.current.length
    if (count === 0) return
    paintCurrent((currentRef.current + direction + count) % count, 'smooth')
    publish(count)
  }, [paintCurrent, publish])

  return { ref: setRoot, matches: enabled && query ? matches : null, step }
}
