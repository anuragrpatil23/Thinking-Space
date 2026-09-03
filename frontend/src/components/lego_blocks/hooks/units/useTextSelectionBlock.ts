import { useCallback, useEffect, useRef, useState } from 'react'

/* Tracks a live text selection inside a container.

   Driven by `selectionchange` with a settle delay rather than by `pointerup`,
   because on iOS those are not the same moment. A touch selection begins with a
   long press and is then adjusted by dragging the grab handles — the pointer
   goes up many times during that, usually while the selection is still partial
   or briefly collapsed. Acting on `pointerup` therefore fires early, sees the
   wrong range, and then never fires again once the reader is happy with what
   they have selected. `selectionchange` fires for handle drags too, so waiting
   for it to go quiet is the only signal that means "this is the selection". */

const SELECTION_SETTLE_MS_BLOCK = 220

export interface TextSelectionStateBlock {
  /** Bounding rect of the selection in client coordinates. */
  rect: DOMRect | null
  text: string
  clearSelection: () => void
}

export function useTextSelectionBlock(params: {
  containerRef: React.RefObject<HTMLElement | null>
  enabled: boolean
}): TextSelectionStateBlock {
  const { containerRef, enabled } = params
  const [state, setState] = useState<{ rect: DOMRect | null; text: string }>({ rect: null, text: '' })
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setState({ rect: null, text: '' })
      return
    }

    const sampleBlock = () => {
      timerRef.current = null
      const selection = window.getSelection()
      const container = containerRef.current

      if (!selection || !container || selection.isCollapsed || selection.rangeCount === 0) {
        setState((prev) => (prev.rect === null ? prev : { rect: null, text: '' }))
        return
      }

      const range = selection.getRangeAt(0)
      /* A selection in the sidebar or a dialog is not ours to act on. */
      if (!container.contains(range.commonAncestorContainer)) {
        setState((prev) => (prev.rect === null ? prev : { rect: null, text: '' }))
        return
      }

      const rect = range.getBoundingClientRect()
      if (rect.width < 1 && rect.height < 1) return

      setState({ rect, text: selection.toString() })
    }

    const scheduleBlock = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(sampleBlock, SELECTION_SETTLE_MS_BLOCK)
    }

    document.addEventListener('selectionchange', scheduleBlock)
    return () => {
      document.removeEventListener('selectionchange', scheduleBlock)
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [containerRef, enabled])

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setState({ rect: null, text: '' })
  }, [])

  return { rect: state.rect, text: state.text, clearSelection }
}
