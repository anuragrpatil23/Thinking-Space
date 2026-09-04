/* Mouse text selection for a raw pdf.js `TextLayer`.

   `PdfPageCanvasBlock` builds `TextLayer` directly rather than going through
   pdf.js's `TextLayerBuilder`, which is the right call — the builder drags in
   the whole default viewer — but selection is the one behaviour the builder
   owned that the layer itself does not.

   The problem it solves: text-layer spans are absolutely positioned, so DOM
   order and visual order are only loosely related, and there is nothing after
   the last span for a drag to land on. Dragging past the end of a line, or
   through the gaps between spans, therefore makes the browser anchor the
   selection on the page container instead of on text — which is why a drag
   highlighted whole blocks of the page rather than the words under the cursor.

   The fix is pdf.js's: keep an `.endOfContent` element in the layer, move it to
   sit right after the current selection anchor while a drag is in flight, and
   flag the layer as `.selecting` so CSS can stretch it over the page. The drag
   then always has real, selectable geometry under it, and the selection follows
   the text.

   This is a direct port of `TextLayerBuilder`'s selection wiring, kept to the
   parts that apply here (no permissions-aware copy handler, no highlighter). */

const textLayerEndsBlock = new Map<HTMLElement, HTMLElement>()
let globalSelectionListenersBlock: AbortController | null = null

function resetTextLayerBlock(end: HTMLElement, layer: HTMLElement): void {
  layer.append(end)
  end.style.width = ''
  end.style.height = ''
  layer.classList.remove('selecting')
}

function enableGlobalSelectionListenersBlock(): void {
  if (globalSelectionListenersBlock) return

  globalSelectionListenersBlock = new AbortController()
  const { signal } = globalSelectionListenersBlock

  let pointerDown = false
  document.addEventListener('pointerdown', () => { pointerDown = true }, { signal })
  document.addEventListener('pointerup', () => {
    pointerDown = false
    textLayerEndsBlock.forEach(resetTextLayerBlock)
  }, { signal })
  window.addEventListener('blur', () => {
    pointerDown = false
    textLayerEndsBlock.forEach(resetTextLayerBlock)
  }, { signal })
  document.addEventListener('keyup', () => {
    if (!pointerDown) textLayerEndsBlock.forEach(resetTextLayerBlock)
  }, { signal })

  /* Firefox positions the caret through absolutely positioned spans on its
     own, so moving the anchor there fights its native behaviour. */
  let isFirefox: boolean | undefined
  let previousRange: Range | null = null

  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) {
      textLayerEndsBlock.forEach(resetTextLayerBlock)
      return
    }

    /* Only the layers the selection actually touches are "selecting"; the rest
       put their end element back so it stops covering their page. */
    const activeLayers = new Set<HTMLElement>()
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index)
      for (const layer of textLayerEndsBlock.keys()) {
        if (!activeLayers.has(layer) && range.intersectsNode(layer)) activeLayers.add(layer)
      }
    }
    for (const [layer, end] of textLayerEndsBlock) {
      if (activeLayers.has(layer)) layer.classList.add('selecting')
      else resetTextLayerBlock(end, layer)
    }

    const first = textLayerEndsBlock.keys().next().value
    if (!first) return
    isFirefox ??= getComputedStyle(first).getPropertyValue('-moz-user-select') === 'none'
    if (isFirefox) return

    const range = selection.getRangeAt(0)
    /* An unmoved end boundary means the drag is extending backwards, so the
       element belongs before the anchor rather than after it. */
    const modifyStart = Boolean(previousRange) && (
      range.compareBoundaryPoints(Range.END_TO_END, previousRange!) === 0
      || range.compareBoundaryPoints(Range.START_TO_END, previousRange!) === 0
    )

    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
    if (!anchor) return

    if (!modifyStart && range.endOffset === 0) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
        if (!anchor) return
        anchor = anchor.previousSibling
      } while (anchor && anchor.childNodes.length === 0)
      if (!anchor) return
    }

    const anchorElement = anchor.parentElement
    const layer = anchorElement?.closest<HTMLElement>('.textLayer')
    const end = layer ? textLayerEndsBlock.get(layer) : undefined
    if (anchorElement && layer && end) {
      end.style.width = layer.style.width
      end.style.height = layer.style.height
      anchorElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling)
    }

    previousRange = range.cloneRange()
  }, { signal })
}

/** Wire one rendered text layer for selection. Returns the detach function. */
export function attachPdfTextLayerSelectionBlock(layer: HTMLElement): () => void {
  const end = document.createElement('div')
  end.className = 'endOfContent'
  layer.append(end)

  const controller = new AbortController()
  layer.addEventListener('mousedown', () => {
    layer.classList.add('selecting')
  }, { signal: controller.signal })

  textLayerEndsBlock.set(layer, end)
  enableGlobalSelectionListenersBlock()

  return () => {
    controller.abort()
    textLayerEndsBlock.delete(layer)
    end.remove()
    layer.classList.remove('selecting')
    if (textLayerEndsBlock.size === 0) {
      globalSelectionListenersBlock?.abort()
      globalSelectionListenersBlock = null
    }
  }
}
