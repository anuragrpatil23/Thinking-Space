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
/* A single page's leaf goes a quarter turn, not a half. */
const SINGLE_FLIP_DURATION_MS_BLOCK = 460
/* Leaves the page promptly: a slow start left it hanging a few degrees off
   flat, which read as the page warping rather than turning. */
const FLIP_EASING_BLOCK = 'cubic-bezier(0.3, 0.15, 0.2, 1)'
const GHOST_LOAD_TIMEOUT_MS_BLOCK = 400

/** The binding's fold shadow, drawn across a band centred on the spine. */
export function epubSpineGradientBlock(night: boolean): string {
  return night
    ? 'linear-gradient(to right, transparent, rgba(0,0,0,0.25) 42%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.25) 58%, transparent)'
    : 'linear-gradient(to right, transparent, rgba(60,45,20,0.03) 30%, rgba(60,45,20,0.08) 42%, rgba(60,45,20,0.16) 49%, rgba(60,45,20,0.16) 51%, rgba(60,45,20,0.08) 58%, rgba(60,45,20,0.03) 70%, transparent)'
}
export const EPUB_SPINE_BAND_PX_BLOCK = 128
/** Marks the book's own spine layers; a single-page turn hides them while it
    carries the spine across the page itself. */
export const EPUB_SPINE_ATTR_BLOCK = 'data-epub-spine'
/** Marks layers the reader draws over the page (live slots); every turn hides
    them, since they are not part of the copies that turn. */
export const EPUB_TURN_HIDDEN_ATTR_BLOCK = 'data-epub-turn-hidden'

/** Shown one at a time, a book's pages still face each other: odd pages are
    left-hand pages (spine on their right), even pages right-hand ones — the
    same pairing the two-page spread shows. */
export function epubSinglePageSideBlock(page: number): 'left' | 'right' {
  return page % 2 === 1 ? 'left' : 'right'
}

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
  /** The document x showing at the sheet's left edge. */
  offset: number
  /** The page's text column within the sheet. Only this shows text; the
      rest of the sheet is paper, as on the live page, which crops to its
      column — uncropped, a full-width sheet showed strips of the
      neighbouring pages in its margins. */
  window: { left: number; width: number }
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
    const win = document.createElement('div')
    Object.assign(win.style, {
      position: 'absolute',
      left: `${spec.window.left}px`,
      top: '0',
      width: `${spec.window.width}px`,
      height: `${sheetHeight}px`,
      overflow: 'hidden',
    })
    clip.append(win)
    const iframe = document.createElement('iframe')
    /* No allow-scripts: nothing in a copy can run, whatever the book holds.
       Same origin only so the copy can load the section's blob: resources. */
    iframe.setAttribute('sandbox', 'allow-same-origin')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    Object.assign(iframe.style, {
      position: 'absolute',
      left: `${-(spec.offset + spec.window.left)}px`,
      top: `${top}px`,
      width: `${docWidth}px`,
      height: `${height}px`,
      border: '0',
      pointerEvents: 'none',
    })
    loads.push(new Promise((resolve) => { iframe.addEventListener('load', () => resolve(), { once: true }) }))
    iframe.src = url
    win.append(iframe)
    parent.append(clip)
    created.push(clip)
    return clip
  }

  /* The leaf: turns around the spine (its left edge going forward, its right
     edge going back), with the outgoing page on the front and the incoming
     page on the back. */
  /* Sheets run from the spine to the book's edge, not just across the text
     column: a leaf the width of the column landed with its outer edge inside
     the page's real edge. The spine is the book's centre. */
  const sheetWidth = spread ? stageRect.width / 2 : stageRect.width
  const spine = spread ? sheetWidth : 0
  const leafWidth = sheetWidth
  const leafLeft = spread && direction > 0 ? spine : 0
  /** The document x showing at a stage x, shifted by whole spreads. */
  const docAtBlock = (stageX: number, shift: number) => docStart + (stageX - viewLeft) + shift
  /** The text column of the page on the sheet whose left edge is at stage x
      `sheetLeft`, in that sheet's coordinates. */
  const windowForBlock = (sheetLeft: number) => {
    if (!spread) return { left: viewLeft - sheetLeft, width: size }
    const pageStart = sheetLeft < spine ? viewLeft : viewLeft + size / 2
    return { left: pageStart - sheetLeft, width: size / 2 }
  }
  const buildSpreadBlock = () => {
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
    /* From the book's larger side: scaled to width alone, a tall narrow book
       put the eye so close that a turning page ballooned toward it. */
    stage.style.perspective = `${Math.round(Math.max(stageRect.width, stageRect.height) * 2.4)}px`

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

    if (direction > 0) {
      /* The current left page stays; the live view behind it has moved on. */
      makeGhostBlock({ left: 0, width: sheetWidth, offset: docAtBlock(0, 0), window: windowForBlock(0) })
      const frontShade = faceBlock({ left: 0, width: sheetWidth, offset: docAtBlock(spine, 0), window: windowForBlock(spine) }, false)
      const backShade = faceBlock({ left: 0, width: sheetWidth, offset: docAtBlock(0, size), window: windowForBlock(0) }, true)
      return { leaf, frontShade, backShade }
    }
    makeGhostBlock({ left: spine, width: sheetWidth, offset: docAtBlock(spine, 0), window: windowForBlock(spine) })
    const frontShade = faceBlock({ left: 0, width: sheetWidth, offset: docAtBlock(0, 0), window: windowForBlock(0) }, false)
    const backShade = faceBlock({ left: 0, width: sheetWidth, offset: docAtBlock(spine, -size), window: windowForBlock(spine) }, true)
    return { leaf, frontShade, backShade }
  }

  const timing = { duration: FLIP_DURATION_MS_BLOCK, easing: FLIP_EASING_BLOCK }
  const hiddenSpines: HTMLElement[] = [...stage.querySelectorAll<HTMLElement>(`[${EPUB_TURN_HIDDEN_ATTR_BLOCK}]`)]

  /* One page at a time. Every turn is the same leaf, hinged on the book's
     left edge: forward, the page showing folds away to the left and the next
     is under it; back, the previous page unfolds from the left over the one
     showing. The page is still drawn as one side of a spread — its spine
     shadow and page stack switch edges page by page — but the hinge does not
     follow the spine: hinged at the spine, the turn came from one edge on
     one swipe and the other edge on the next, and read as erratic.

     Drawn flat (no perspective): a leaf as wide as the whole book, swung in
     perspective, grew toward the reader and was cut off at the book's top and
     bottom. Also gone (all 2026-11-27): a slide across the spine alternating
     with a leaf turn, and a leaf carried across the view, which left a blank
     sheet showing at the middle of the turn. */
  const buildSingleBlock = (): (() => Animation) => {
    const width = stageRect.width
    const pageSpec = (shift: number): GhostSpecBlock => (
      { left: 0, width, offset: docAtBlock(0, shift), window: windowForBlock(0) }
    )
    const boxBlock = (parent: HTMLElement, style: Partial<CSSStyleDeclaration>): HTMLElement => {
      const box = document.createElement('div')
      Object.assign(box.style, { position: 'absolute', top: '0', height: `${sheetHeight}px`, pointerEvents: 'none' }, style)
      parent.append(box)
      return box
    }
    hiddenSpines.push(...stage.querySelectorAll<HTMLElement>(`[${EPUB_SPINE_ATTR_BLOCK}]`))
    const spineLeft = epubSinglePageSideBlock(renderer.page) === 'right'
    const foldsAway = direction > 0

    /* The live view turns at once. A leaf folding away uncovers it; a leaf
       unfolding needs the page showing kept still beneath it. */
    if (!foldsAway) makeGhostBlock(pageSpec(0))
    const leaf = boxBlock(stage, {
      left: '0',
      width: `${width}px`,
      transformOrigin: 'left center',
      zIndex: '3',
      visibility: 'hidden',
    })
    created.push(leaf)
    const face = makeGhostBlock(pageSpec(foldsAway ? 0 : direction * size), leaf)
    /* Darkest at the free edge, the part lifted highest off the book. */
    const shade = boxBlock(face, {
      left: '0',
      width: `${width}px`,
      opacity: '0',
      background: `linear-gradient(to right, rgba(0,0,0,${night ? 0.25 : 0.08}), rgba(0,0,0,${night ? 0.6 : 0.3}))`,
    })
    /* The spine stays where the page showing has it for the whole turn; the
       book's own layer, already on the other edge, fades in after. */
    const turnSpine = boxBlock(stage, {
      left: `${(spineLeft ? 0 : width) - EPUB_SPINE_BAND_PX_BLOCK / 2}px`,
      width: `${EPUB_SPINE_BAND_PX_BLOCK}px`,
      background: epubSpineGradientBlock(night),
      zIndex: '4',
      visibility: 'hidden',
    })
    created.push(turnSpine)

    const edgeOn = 'rotateY(-90deg)'
    const flat = 'rotateY(0deg)'
    const from = foldsAway ? flat : edgeOn
    const to = foldsAway ? edgeOn : flat
    leaf.style.transform = from
    shade.style.opacity = foldsAway ? '0' : '1'
    const singleTiming = { duration: SINGLE_FLIP_DURATION_MS_BLOCK, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' as const }
    return () => {
      shade.animate([{ opacity: foldsAway ? 0 : 1 }, { opacity: foldsAway ? 1 : 0 }], singleTiming)
      turnSpine.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], singleTiming)
      return leaf.animate([{ transform: from }, { transform: to }], singleTiming)
    }
  }

  const spreadParts = spread ? buildSpreadBlock() : null
  const playSingle = spread ? null : buildSingleBlock()

  const cleanupBlock = () => {
    for (const element of created) element.remove()
    for (const element of hiddenSpines) {
      element.style.visibility = ''
      /* The book's spine comes back on the edge the new page binds at. */
      if (element.hasAttribute(EPUB_SPINE_ATTR_BLOCK)) element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    }
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
  for (const element of hiddenSpines) element.style.visibility = 'hidden'
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

  let motion: Animation
  if (playSingle) {
    motion = playSingle()
  } else {
    const { leaf, frontShade, backShade } = spreadParts!
    motion = leaf.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${direction > 0 ? -180 : 180}deg)` }], timing)
    frontShade.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], timing)
    backShade.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], timing)
  }

  await motion.finished.catch(() => undefined)
  if (activeFlipCleanupBlock === cleanupBlock) finishActiveEpubFlipBlock()
}
