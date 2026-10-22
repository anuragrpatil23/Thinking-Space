import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// A list that opens one item as a page in its place (F9 Gaps, Noticed). Keeps
// the way back calm: the list returns at the scroll position it was left at,
// and the item you came from is named so its row can glow once.
// Pair with the ltm-page-push-in / ltm-page-pop-in / ltm-row-return classes.

function scrollParentBlock(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

export function useListDetailMotionBlock(): {
  /** Put on the list's root element. */
  listRef: (el: HTMLElement | null) => void
  /** Call before opening an item, with its key. */
  rememberOpening: (key: string) => void
  /** The item just returned from: its row gets ltm-row-return. */
  returnedFrom: string | null
  /** Call when the list shows again after a detail page. */
  markReturned: () => void
  /** True once the list has been left at least once: it should pop in, not appear. */
  returning: boolean
} {
  const listEl = useRef<HTMLElement | null>(null)
  const savedScroll = useRef<number | null>(null)
  const openedKey = useRef<string | null>(null)
  const [returnedFrom, setReturnedFrom] = useState<string | null>(null)
  const [returning, setReturning] = useState(false)
  const pendingRestore = useRef(false)

  const listRef = useCallback((el: HTMLElement | null) => { listEl.current = el }, [])

  const rememberOpening = useCallback((key: string) => {
    const parent = scrollParentBlock(listEl.current)
    savedScroll.current = parent ? parent.scrollTop : null
    openedKey.current = key
    // The detail page starts at its top.
    if (parent) parent.scrollTop = 0
  }, [])

  const markReturned = useCallback(() => {
    pendingRestore.current = true
    setReturning(true)
    setReturnedFrom(openedKey.current)
  }, [])

  // After the list is back in the DOM, put the scroll where it was.
  useLayoutEffect(() => {
    if (!pendingRestore.current || !listEl.current) return
    pendingRestore.current = false
    const parent = scrollParentBlock(listEl.current) ?? listEl.current.parentElement
    if (parent && savedScroll.current !== null) parent.scrollTop = savedScroll.current
  })

  return { listRef, rememberOpening, returnedFrom, markReturned, returning }
}
