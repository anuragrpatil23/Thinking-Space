/* A 3D page turn for the EPUB reader: the real leaf, with its text, lifts and
   turns over the spine.

   foliate-js pages by scrolling one wide, column-laid-out section document.
   There is no page to rotate — so the turn is staged with copies:

   1. The section document is serialized once (it already carries foliate's
      column layout as inline styles, the reader's <style> elements, the
      content guard's CSP, and blob: URLs for its images and fonts) and loaded
      into a few iframes. They are sandboxed with no scripts at all; each is
      clipped to show one page.
   2. The real view turns instantly underneath.
   3. The copy of the outgoing page (front) and the incoming page (back) rotate
      as one leaf around the spine; a copy of the page that stays put covers
      the side the live view has already changed.
   4. The copies are removed. What remains is the live view, already on the
      new page.

   Only a turn within one section is staged; at a chapter boundary the next
   page is a different document that is not loaded yet, so foliate's own turn
   plays. Copies are made per turn and dropped after, so no extra document
   stays in memory between turns (docs/contracts/IOS-MEMORY.md). */

export interface EpubPageFlipRendererBlock extends HTMLElement {
  readonly start: number
  readonly size: number
  readonly page: number
  readonly pages: number
  getContents(): Array<{ doc: Document; index: number }>
}

const FLIP_DURATION_MS_BLOCK = 620
/* Leaves the page promptly: a slow start left it hanging a few degrees off
   flat, which read as the page warping rather than turning. */
const FLIP_EASING_BLOCK = 'cubic-bezier(0.3, 0.15, 0.2, 1)'
const GHOST_LOAD_TIMEOUT_MS_BLOCK = 400

let activeFlipCleanupBlock: (() => void) | null = null

/** Ends any running flip at once; the live view is already on its page. */
export function finishActiveEpubFlipBlock(): void {
  activeFlipCleanupBlock?.()
  activeFlipCleanupBlock = null
}

function serializeDocumentBlock(doc: Document): { markup: string; type: string } {
  const type = doc.contentType || 'text/html'
  if (type === 'text/html') return { markup: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, type }
  return { markup: new XMLSerializer().serializeToString(doc), type }
}

interface GhostSpecBlock {
  /** Where the clipped page sits, relative to the stage. */
  left: number
  width: number
  /** Which part of the section document it shows, in document px. */
  offset: number
}

export async function flipEpubPageBlock(params: {
  renderer: EpubPageFlipRendererBlock
  /** Positioned element the staged layers go into (the book). */
  stage: HTMLElement
  direction: 1 | -1
  spread: boolean
  paper: string
  night: boolean
  /** Turns the live view without animation. */
  turn: () => Promise<void>
}): Promise<void> {
  const { renderer, stage, direction, spread, paper, night, turn } = params
  finishActiveEpubFlipBlock()

  const doc = renderer.getContents()[0]?.doc
  const frame = doc?.defaultView?.frameElement as HTMLElement | null | undefined
  /* foliate leaves a blank page before and after each section's content;
     a turn into either is a chapter change. */
  const withinSection = direction > 0 ? renderer.page + 1 <= renderer.pages - 2 : renderer.page - 1 >= 1
  if (!doc || !frame || !withinSection) {
    await turn()
    return
  }

  const size = renderer.size
  const frameRect = frame.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  /* foliate centres its page container in the renderer (equal margins either
     side), so the visible pages start half the leftover width in. The frame's
     own rect is not usable for this: it does not move as the pages scroll. */
  const rendererRect = renderer.getBoundingClientRect()
  const viewLeft = rendererRect.left + (rendererRect.width - size) / 2 - stageRect.left
  const top = frameRect.top - stageRect.top
  const height = frameRect.height
  /* Every copy is a whole sheet — the book's full height, with the text set
     at the live page's margins. Cut to the text block, a copy showed its own
     top and bottom edges and the turning leaf looked like floating type. */
  const sheetHeight = stageRect.height
  const docWidth = frameRect.width
  const half = size / 2
  /* Where the visible spread starts in the section document. foliate keeps a
     blank page ahead of each section's content, so the document sits one
     page-width behind its scroll offset. Using `start` itself put every copy
     one spread ahead, and the landed leaf showed a page the live view was
     not on — the "refresh" at the end of a turn. Measured, not assumed. */
  /* Measured from the live frame rather than computed as `start - size`:
     the copies must put every glyph on exactly the live page's (fractional)
     pixel position, or text shimmers by a sub-pixel as a copy appears over
     the live page and again as it goes. */
  const docStart = stageRect.left + viewLeft - frameRect.left

  const { markup, type } = serializeDocumentBlock(doc)
  const url = URL.createObjectURL(new Blob([markup], { type }))
  const created: HTMLElement[] = []
  const loads: Promise<void>[] = []

  const makeGhostBlock = (spec: GhostSpecBlock, parent: HTMLElement = stage): HTMLElement => {
    const clip = document.createElement('div')
    Object.assign(clip.style, {
      position: 'absolute',
      left: `${spec.left}px`,
      top: '0',
      width: `${spec.width}px`,
      height: `${sheetHeight}px`,
      overflow: 'hidden',
      background: paper,
      pointerEvents: 'none',
      /* Under the spine shadow, which stays drawn across every page,
         turning or not — see EpubDocumentBlock. */
      zIndex: parent === stage ? '1' : 'auto',
      /* Hidden until every copy has loaded: shown at once, an unloaded copy
         is a blank sheet laid over the page for a few frames. */
      visibility: 'hidden',
    })
    const iframe = document.createElement('iframe')
    /* No allow-scripts: nothing in a copy can run, whatever the book holds.
       Same origin only so the copy can load the section's blob: resources. */
    iframe.setAttribute('sandbox', 'allow-same-origin')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    Object.assign(iframe.style, {
      position: 'absolute',
      left: `${-spec.offset}px`,
      top: `${top}px`,
      width: `${docWidth}px`,
      height: `${height}px`,
      border: '0',
      pointerEvents: 'none',
    })
    loads.push(new Promise((resolve) => { iframe.addEventListener('load', () => resolve(), { once: true }) }))
    iframe.src = url
    clip.append(iframe)
    parent.append(clip)
    created.push(clip)
    return clip
  }

  /* The leaf: turns around the spine (its left edge going forward, its right
     edge going back), with the outgoing page on the front and the incoming
     page on the back. */
  const leafWidth = spread ? half : size
  const leafLeft = spread && direction < 0 ? viewLeft : spread ? viewLeft + half : viewLeft
  const leaf = document.createElement('div')
  Object.assign(leaf.style, {
    position: 'absolute',
    left: `${leafLeft}px`,
    top: '0',
    width: `${leafWidth}px`,
    height: `${sheetHeight}px`,
    transformStyle: 'preserve-3d',
    transformOrigin: direction > 0 ? 'left center' : 'right center',
    pointerEvents: 'none',
    zIndex: '3',
    visibility: 'hidden',
  })
  stage.append(leaf)
  created.push(leaf)
  stage.style.perspective = `${Math.round(size * 2.2)}px`

  const faceBlock = (spec: GhostSpecBlock | null, back: boolean): HTMLElement => {
    const face = spec
      ? makeGhostBlock({ ...spec, left: 0 }, leaf)
      : (() => {
        const blank = document.createElement('div')
        Object.assign(blank.style, { position: 'absolute', left: '0', top: '0', width: `${leafWidth}px`, height: `${sheetHeight}px`, background: paper })
        leaf.append(blank)
        return blank
      })()
    face.style.backfaceVisibility = 'hidden'
    if (back) face.style.transform = 'rotateY(180deg)'
    /* Shading, played with the turn: the lifted part of the page darkens,
       the way light falls across a curving sheet. */
    const shade = document.createElement('div')
    Object.assign(shade.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      opacity: '0',
      /* Darkest at the page's outer edge, the part lifting off the book.
         Darkened at the binding instead, the shade faded out as the page
         landed and the spine read as going light at the end of a turn; the
         binding's shadow is the book's own spine layer, which never changes. */
      background: `linear-gradient(to ${(direction > 0) !== back ? 'right' : 'left'}, rgba(0,0,0,0) 40%, rgba(0,0,0,${night ? 0.5 : 0.22}))`,
    })
    face.append(shade)
    return shade
  }

  let frontShade: HTMLElement
  let backShade: HTMLElement
  if (direction > 0) {
    if (spread) {
      /* The current left page stays; the live view behind it has moved on. */
      makeGhostBlock({ left: viewLeft, width: half, offset: docStart })
      frontShade = faceBlock({ left: 0, width: half, offset: docStart + half }, false)
      backShade = faceBlock({ left: 0, width: half, offset: docStart + size }, true)
    } else {
      frontShade = faceBlock({ left: 0, width: size, offset: docStart }, false)
      backShade = faceBlock(null, true)
    }
  } else if (spread) {
    makeGhostBlock({ left: viewLeft + half, width: half, offset: docStart + half })
    frontShade = faceBlock({ left: 0, width: half, offset: docStart }, false)
    backShade = faceBlock({ left: 0, width: half, offset: docStart - half }, true)
  } else {
    /* Going back a single page: the previous page comes back over the
       current one, from edge-on to flat. */
    makeGhostBlock({ left: viewLeft, width: size, offset: docStart })
    frontShade = faceBlock({ left: 0, width: size, offset: docStart - size }, false)
    backShade = faceBlock(null, true)
    leaf.style.transformOrigin = 'left center'
  }

  const cleanupBlock = () => {
    for (const element of created) element.remove()
    URL.revokeObjectURL(url)
    stage.style.perspective = ''
  }
  activeFlipCleanupBlock = cleanupBlock

  const loaded = await Promise.race([
    Promise.all(loads).then(() => true),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), GHOST_LOAD_TIMEOUT_MS_BLOCK)),
  ])
  if (activeFlipCleanupBlock !== cleanupBlock) return
  if (!loaded) {
    finishActiveEpubFlipBlock()
    await turn()
    return
  }
  /* Reveal every copy in one frame — over the live page they are
     indistinguishable from it — and only then turn the live view beneath. */
  for (const element of created) element.style.visibility = ''
  await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
  if (activeFlipCleanupBlock !== cleanupBlock) return

  const startBefore = renderer.start
  await turn()
  if (activeFlipCleanupBlock !== cleanupBlock) return
  /* foliate ignores a turn while it is still settling (just after a chapter
     loads); animating a leaf then shows a turn that did not happen. */
  if (Math.abs(renderer.start - startBefore) < 1) {
    finishActiveEpubFlipBlock()
    return
  }

  const singleBack = direction < 0 && !spread
  const from = singleBack ? 'rotateY(-180deg)' : 'rotateY(0deg)'
  const to = singleBack ? 'rotateY(0deg)' : `rotateY(${direction > 0 ? -180 : 180}deg)`
  const timing = { duration: FLIP_DURATION_MS_BLOCK, easing: FLIP_EASING_BLOCK }
  const motion = leaf.animate([{ transform: from }, { transform: to }], timing)
  frontShade.animate([{ opacity: singleBack ? 1 : 0 }, { opacity: 1, offset: 0.5 }, { opacity: singleBack ? 0 : 1 }], timing)
  backShade.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], timing)

  await motion.finished.catch(() => undefined)
  if (activeFlipCleanupBlock === cleanupBlock) finishActiveEpubFlipBlock()
}
