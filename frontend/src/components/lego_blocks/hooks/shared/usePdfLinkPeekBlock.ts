import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  resolvePdfLinkPeekTargetBlock,
  type PdfLinkPeekTargetBlock,
  type PdfPageLinkBlock,
} from '@/components/lego_blocks/units/pdfPageLinksBlock'

/* Hover timing for link peeks.

   Open waits a beat so a pointer crossing a paragraph full of citations does
   not strobe cards; close waits a beat so the pointer can travel from the link
   into the card without it vanishing on the way. A token discards resolutions
   that finish after the pointer has already moved on. Timers here run only in
   response to pointer movement (docs/contracts/ENERGY.md). */

const OPEN_DELAY_MS_BLOCK = 280
const CLOSE_DELAY_MS_BLOCK = 220

export interface PdfLinkPeekStateBlock {
  target: PdfLinkPeekTargetBlock
  anchor: DOMRect
  touch: boolean
}

export function usePdfLinkPeekBlock(doc: PDFDocumentProxy | null) {
  const [peek, setPeek] = useState<PdfLinkPeekStateBlock | null>(null)
  const timerRef = useRef<number | null>(null)
  const tokenRef = useRef(0)

  const clearTimerBlock = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clearTimerBlock, [clearTimerBlock])

  const openPeek = useCallback((
    link: Extract<PdfPageLinkBlock, { kind: 'internal' }>,
    anchor: DOMRect,
    options: { immediate?: boolean; touch?: boolean } = {},
  ) => {
    if (!doc) return
    clearTimerBlock()
    const token = ++tokenRef.current
    const runBlock = async () => {
      const target = await resolvePdfLinkPeekTargetBlock(doc, link).catch(() => null)
      if (token !== tokenRef.current || !target) return
      setPeek({ target, anchor, touch: options.touch ?? false })
    }
    if (options.immediate) void runBlock()
    else timerRef.current = window.setTimeout(() => { timerRef.current = null; void runBlock() }, OPEN_DELAY_MS_BLOCK)
  }, [clearTimerBlock, doc])

  const leavePeek = useCallback(() => {
    clearTimerBlock()
    tokenRef.current += 1
    timerRef.current = window.setTimeout(() => { timerRef.current = null; setPeek(null) }, CLOSE_DELAY_MS_BLOCK)
  }, [clearTimerBlock])

  const holdPeek = clearTimerBlock

  const closePeek = useCallback(() => {
    clearTimerBlock()
    tokenRef.current += 1
    setPeek(null)
  }, [clearTimerBlock])

  return { peek, openPeek, leavePeek, holdPeek, closePeek }
}
