import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { FoliateRelocateDetail, FoliateTocItem, View } from '@/vendor/foliate-js/view.js'
import { Button } from '@/components/lego_blocks/units/ui/button'
import PdfToolbarMenuBlock from '@/components/lego_blocks/units/PdfToolbarMenuBlock'
import type { ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import { cn } from '@/lib/utils'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import {
  finishActiveEpubFlipBlock,
  flipEpubPageBlock,
  type EpubPageFlipRendererBlock,
} from '@/components/lego_blocks/units/epubPageFlipBlock'
import { readEpubDocumentOrch } from '@/services/orchestrators/epubDocumentsOrch'
import { openExternalUrlOrch } from '@/services/orchestrators/fileSystemOrch'
import { guardEpubMarkupBlock, isEpubMarkupTypeBlock } from '@/services/lego_blocks/units/epubContentGuardBlock'
import {
  EPUB_LINE_HEIGHTS_BLOCK,
  buildEpubReaderCssBlock,
  readEpubReaderPrefsBlock,
  formatEpubChapterLabelBlock,
  readEpubReadingPositionBlock,
  stepEpubFontScaleBlock,
  writeEpubReaderPrefsBlock,
  writeEpubReadingPositionBlock,
  type EpubReaderPrefsBlock,
} from '@/services/lego_blocks/units/epubReaderBlock'
import {
  PDF_PAPER_THEME_BACKGROUNDS_BLOCK,
  PDF_PAPER_THEME_LABELS_BLOCK,
  PDF_PAPER_THEMES_BLOCK,
  readPdfPaperThemeBlock,
  writePdfPaperThemeBlock,
  type PdfPaperThemeBlock,
} from '@/services/lego_blocks/units/pdfPaperThemeBlock'

/* The EPUB reader: foliate-js for layout, the PDF reader's chrome around it.

   foliate-js does the hard parts — unzipping, pagination into CSS columns,
   CFI addresses, the table of contents. This block owns three things:

   - Safety. Every section passes through guardEpubMarkupBlock before it
     becomes a blob: URL, and script resources are refused outright. A book
     whose loader exposes no hook to do that is not opened at all.
   - Chrome. The same toolbar row (docked under the header) or floating pill
     as the PDF reader, with the same paper tones, so the two formats are one
     reader to the person using it.
   - Memory of place. The CFI is saved on every move, so a book reopens where
     it was left whatever the window size or type settings are now.

   foliate-js is imported only when a book opens, so none of it is reachable
   from the app's startup path (docs/contracts/STARTUP-PERFORMANCE.md). */

/* The book as an object on a desk, after the original iBooks: a warm surround,
   the pages as one physical block with stacked page edges at its sides, and a
   shadowed spine down the middle of a two-page spread. All of it is drawn
   around and over the engine's page, never inside the book's own markup. */
/* A white desk in the light tones: the book is the only object on it, and
   its shadow and page edges are what give it depth. */
const DESK_BLOCK: Record<PdfPaperThemeBlock, string> = {
  original: '#ffffff',
  warm: '#ffffff',
  sepia: '#ffffff',
  night: '#0e0f12',
}
const PAGE_EDGE_BLOCK: Record<PdfPaperThemeBlock, string> = {
  original: '#d9d5cb',
  warm: '#dcd1bc',
  sepia: '#cfbe9c',
  night: '#2b2d33',
}
const DESK_PADDING_PX_BLOCK = 20
/* Below this the window holds one comfortable page, not a spread. */
const SPREAD_MIN_WIDTH_PX_BLOCK = 900
const SPREAD_MAX_WIDTH_PX_BLOCK = 1280
const SINGLE_MAX_WIDTH_PX_BLOCK = 720
/* The book's shape follows the window's. A spread only when the space is
   clearly landscape, so each of its pages stays page-shaped; otherwise one
   page. Either way the book is sized from the height too, so it never turns
   into tall slivers or a letterbox in between aspect ratios. */
const SPREAD_MIN_ASPECT_BLOCK = 1.15
const SPREAD_MAX_ASPECT_BLOCK = 1.5
const SINGLE_MAX_ASPECT_BLOCK = 0.8

/* Stacked page edges: alternating paper and edge strokes off both sides. */
function pageEdgesShadowBlock(paper: string, edge: string, night: boolean): string {
  const strokes: string[] = []
  for (let i = 1; i <= 6; i += 1) {
    const color = i % 2 === 0 ? edge : paper
    strokes.push(`${-i}px 0 0 ${color}`, `${i}px 0 0 ${color}`)
  }
  /* On white the book needs a little more lift than on a toned desk. */
  strokes.push(night
    ? '0 18px 40px -12px rgba(0,0,0,0.7)'
    : '0 1px 3px rgba(0,0,0,0.08), 0 20px 44px -14px rgba(40,30,15,0.32)')
  return strokes.join(', ')
}

/* Two-finger swipe (or wheel) turns one page per gesture. A gesture is a run of
   wheel events with no gap longer than this; the momentum tail after a turn
   belongs to the same gesture, so a flick never turns several pages. */
const PAGE_TURN_GESTURE_GAP_MS_BLOCK = 220
const PAGE_TURN_TRAVEL_PX_BLOCK = 40

interface EpubDocumentBlockProps {
  path: string
  active?: boolean
  /** Where the document header wants the toolbar docked; null floats it. */
  toolbarHost?: HTMLElement | null
  /** Height of header chrome laid over the top of this area, in px. */
  topInset?: number
  className?: string
}

interface TocEntryBlock {
  label: string
  href: string
  depth: number
}

function flattenTocBlock(items: readonly FoliateTocItem[] | undefined, depth = 0, out: TocEntryBlock[] = []): TocEntryBlock[] {
  for (const item of items ?? []) {
    if (item.href) out.push({ label: (item.label ?? '').trim() || 'Untitled', href: item.href, depth })
    flattenTocBlock(item.subitems, depth + 1, out)
  }
  return out
}

export default function EpubDocumentBlock({
  path,
  active = true,
  toolbarHost = null,
  topInset = 0,
  className,
}: EpubDocumentBlockProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const deskRef = useRef<HTMLDivElement | null>(null)
  const bookRef = useRef<HTMLDivElement | null>(null)
  /* Every page turn goes through here; assigned once the look is known. */
  const turnPageRef = useRef<(direction: 1 | -1) => void>(() => undefined)
  const viewRef = useRef<View | null>(null)
  /* The desk's content box (inside its padding), where the book sits. */
  const [deskSize, setDeskSize] = useState({ width: 0, height: 0 })
  const turnRef = useRef({ travel: 0, locked: false, lastAt: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<TocEntryBlock[]>([])
  const [location, setLocation] = useState<{ fraction: number; chapter: string; href: string | null }>({
    fraction: readEpubReadingPositionBlock(path)?.fraction ?? 0,
    chapter: '',
    href: null,
  })
  const [prefs, setPrefs] = useState<EpubReaderPrefsBlock>(readEpubReaderPrefsBlock)
  const [paperTheme, setPaperTheme] = useState<PdfPaperThemeBlock>(readPdfPaperThemeBlock)
  /* Original paper follows the app: in dark mode the book reads as Night, and
     returns to white with the app. A tone picked on purpose (Warm, Sepia,
     Night) is left as chosen. `paperTheme` is the stored choice; `look` is
     what is drawn. */
  const { hostRef: themeScopeRef, isDark } = useDarkModeClassBlock<HTMLDivElement>()
  const look: PdfPaperThemeBlock = isDark && paperTheme === 'original' ? 'night' : paperTheme

  const flowRef = useRef(prefs.flow)
  flowRef.current = prefs.flow
  const handleTurnWheelBlock = useCallback((event: WheelEvent) => {
    if (flowRef.current !== 'paginated' || event.ctrlKey) return
    event.preventDefault()
    const turn = turnRef.current
    const now = performance.now()
    if (now - turn.lastAt > PAGE_TURN_GESTURE_GAP_MS_BLOCK) {
      turn.travel = 0
      turn.locked = false
    }
    turn.lastAt = now
    if (turn.locked) return
    turn.travel += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(turn.travel) < PAGE_TURN_TRAVEL_PX_BLOCK) return
    turn.locked = true
    turnPageRef.current(turn.travel > 0 ? 1 : -1)
  }, [])
  const turnWheelRef = useRef(handleTurnWheelBlock)
  turnWheelRef.current = handleTurnWheelBlock

  useEffect(() => {
    const desk = deskRef.current
    if (!desk) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setDeskSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(desk)
    desk.addEventListener('wheel', handleTurnWheelBlock, { passive: false })
    return () => {
      observer.disconnect()
      desk.removeEventListener('wheel', handleTurnWheelBlock)
    }
  }, [handleTurnWheelBlock])

  /* The latest look, read by the open effect without re-opening the book. */
  const available = Math.max(0, deskSize.width - DESK_PADDING_PX_BLOCK * 2)
  const availableHeight = Math.max(1, deskSize.height)
  const paged = prefs.flow === 'paginated'
  const spread = paged
    && available >= SPREAD_MIN_WIDTH_PX_BLOCK
    && available / availableHeight >= SPREAD_MIN_ASPECT_BLOCK
  const bookWidth = spread
    ? Math.min(available, SPREAD_MAX_WIDTH_PX_BLOCK, availableHeight * SPREAD_MAX_ASPECT_BLOCK)
    : Math.min(available, SINGLE_MAX_WIDTH_PX_BLOCK, paged ? availableHeight * SINGLE_MAX_ASPECT_BLOCK : Infinity)
  const lookRef = useRef({ prefs, paperTheme: look, spread })
  lookRef.current = { prefs, paperTheme: look, spread }

  /* Paged reading turns with the 3D leaf (epubPageFlipBlock). Left to
     foliate's own slide: continuous scroll, right-to-left books (the leaf is
     staged left-to-right), and touch-first devices, where per-turn page
     copies cost memory the iOS budget does not have. */
  turnPageRef.current = (direction) => {
    const view = viewRef.current
    if (!view?.renderer) return
    const live = () => (direction > 0 ? view.next() : view.prev())
    const stage = bookRef.current
    const rtl = (view.book as { dir?: string } | undefined)?.dir === 'rtl'
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
    if (!stage || prefs.flow !== 'paginated' || rtl || coarse) {
      void live()
      return
    }
    void flipEpubPageBlock({
      renderer: view.renderer as unknown as EpubPageFlipRendererBlock,
      stage,
      direction,
      spread,
      paper: PDF_PAPER_THEME_BACKGROUNDS_BLOCK[look],
      night: look === 'night',
      turn: async () => {
        /* The leaf is the animation; the live view underneath jumps. */
        view.renderer.removeAttribute('animated')
        try {
          await live()
        } finally {
          view.renderer.setAttribute('animated', '')
        }
      },
    })
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let view: View | null = null
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const [file, foliate] = await Promise.all([
          readEpubDocumentOrch(path),
          import('@/vendor/foliate-js/view.js'),
        ])
        if (cancelled) return
        const book = await foliate.makeBook(file)
        if (cancelled) return

        /* Safety before anything renders. No hook, no book. */
        const transform = book.transformTarget
        if (!transform) throw new Error('This book format cannot be opened safely.')
        transform.addEventListener('load', (event) => {
          const detail = (event as CustomEvent<{ isScript: boolean; allow: boolean }>).detail
          if (detail.isScript) detail.allow = false
        })
        transform.addEventListener('data', (event) => {
          const detail = (event as CustomEvent<{ data: unknown; type: string }>).detail
          if (!isEpubMarkupTypeBlock(detail.type)) return
          detail.data = Promise.resolve(detail.data).then((data) =>
            typeof data === 'string' ? guardEpubMarkupBlock(data, detail.type) : data)
        })

        view = document.createElement('foliate-view') as View
        view.style.display = 'block'
        view.style.width = '100%'
        view.style.height = '100%'
        host.replaceChildren(view)
        viewRef.current = view

        view.addEventListener('relocate', (event) => {
          const detail = (event as CustomEvent<FoliateRelocateDetail>).detail
          const fraction = detail.fraction ?? 0
          setLocation({ fraction, chapter: detail.tocItem?.label?.trim() ?? '', href: detail.tocItem?.href ?? null })
          if (detail.cfi) writeEpubReadingPositionBlock(path, detail.cfi, fraction)
        })
        /* Links out of the book leave through the same gate as every other
           external URL (http/https only), never window.open. */
        view.addEventListener('external-link', (event) => {
          event.preventDefault()
          const href = (event as CustomEvent<{ href_?: string }>).detail.href_ ?? ''
          void openExternalUrlOrch(href).catch(() => undefined)
        })
        /* Keys pressed while the page iframe has focus never reach the window. */
        view.addEventListener('load', (event) => {
          const doc = (event as CustomEvent<{ doc: Document }>).detail.doc
          doc.addEventListener('wheel', (wheelEvent) => turnWheelRef.current(wheelEvent), { passive: false })
          doc.addEventListener('keydown', (keyEvent) => {
            if (keyEvent.key === 'ArrowLeft') turnPageRef.current(-1)
            if (keyEvent.key === 'ArrowRight') turnPageRef.current(1)
          })
        })

        await view.open(book)
        if (cancelled) return
        const { prefs: currentPrefs, paperTheme: currentTheme } = lookRef.current
        view.renderer.setAttribute('flow', currentPrefs.flow)
        /* foliate's own page slide: a 300ms ease between pages instead of a
           jump cut. */
        view.renderer.setAttribute('animated', '')
        view.renderer.setAttribute('margin', '36px')
        view.renderer.setAttribute('gap', '8%')
        view.renderer.setAttribute('max-inline-size', '600px')
        view.renderer.setAttribute('max-column-count', lookRef.current.spread ? '2' : '1')
        view.renderer.setStyles?.(buildEpubReaderCssBlock(currentPrefs, currentTheme))
        setToc(flattenTocBlock(book.toc))

        const saved = readEpubReadingPositionBlock(path)
        await view.init({ lastLocation: saved?.cfi ?? null, showTextStart: !saved })
        if (!cancelled) setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to open this book.')
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      finishActiveEpubFlipBlock()
      viewRef.current = null
      view?.close()
      view?.remove()
    }
  }, [path])

  /* Look changes restyle the open book in place; no re-open, and the CFI
     keeps the reader on the same sentence through the reflow. */
  useEffect(() => {
    const view = viewRef.current
    if (!view?.renderer) return
    view.renderer.setAttribute('flow', prefs.flow)
    view.renderer.setAttribute('max-column-count', spread ? '2' : '1')
    view.renderer.setStyles?.(buildEpubReaderCssBlock(prefs, look))
  }, [prefs, look, spread])

  const applyPrefsBlock = useCallback((next: EpubReaderPrefsBlock) => {
    setPrefs(next)
    writeEpubReaderPrefsBlock(next)
  }, [])

  const applyPaperThemeBlock = useCallback((next: PdfPaperThemeBlock) => {
    setPaperTheme(next)
    writePdfPaperThemeBlock(next)
  }, [])

  useEffect(() => {
    if (!active) return
    const onKeyDownBlock = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowLeft') turnPageRef.current(-1)
      else if (event.key === 'ArrowRight') turnPageRef.current(1)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDownBlock)
    return () => window.removeEventListener('keydown', onKeyDownBlock)
  }, [active])

  const tocEntries = useMemo<ContextMenuEntryBlock[]>(() => toc.map((entry, index) => ({
    key: `${index}:${entry.href}`,
    label: `${' '.repeat(Math.min(entry.depth, 3))}${entry.label}`,
    checked: location.href !== null && entry.href === location.href,
    onClick: () => { void viewRef.current?.goTo(entry.href) },
  })), [location.href, toc])

  const typeEntries = useMemo<ContextMenuEntryBlock[]>(() => [
    { key: 'larger', label: 'Larger text', onClick: () => applyPrefsBlock({ ...prefs, fontScale: stepEpubFontScaleBlock(prefs.fontScale, 1) }) },
    { key: 'smaller', label: 'Smaller text', onClick: () => applyPrefsBlock({ ...prefs, fontScale: stepEpubFontScaleBlock(prefs.fontScale, -1) }) },
    { key: 'sep-face', kind: 'separator' },
    { key: 'publisher', label: 'Book’s font', checked: prefs.fontFace === 'publisher', onClick: () => applyPrefsBlock({ ...prefs, fontFace: 'publisher' }) },
    { key: 'serif', label: 'Serif', checked: prefs.fontFace === 'serif', onClick: () => applyPrefsBlock({ ...prefs, fontFace: 'serif' }) },
    { key: 'sans', label: 'Sans serif', checked: prefs.fontFace === 'sans', onClick: () => applyPrefsBlock({ ...prefs, fontFace: 'sans' }) },
    { key: 'sep-spacing', kind: 'separator' },
    ...EPUB_LINE_HEIGHTS_BLOCK.map((lineHeight, index) => ({
      key: `lh-${lineHeight}`,
      label: ['Compact spacing', 'Comfortable spacing', 'Airy spacing'][index] ?? `Spacing ${lineHeight}`,
      checked: prefs.lineHeight === lineHeight,
      onClick: () => applyPrefsBlock({ ...prefs, lineHeight }),
    })),
    { key: 'sep-flow', kind: 'separator' },
    { key: 'paginated', label: 'Pages', checked: prefs.flow === 'paginated', onClick: () => applyPrefsBlock({ ...prefs, flow: 'paginated' }) },
    { key: 'scrolled', label: 'Continuous scroll', checked: prefs.flow === 'scrolled', onClick: () => applyPrefsBlock({ ...prefs, flow: 'scrolled' }) },
  ], [applyPrefsBlock, prefs])

  const percent = Math.round(location.fraction * 100)

  const toolbarControls = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-8 border border-transparent px-0"
        onClick={() => turnPageRef.current(-1)}
        title="Previous page (←)"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
      </Button>
      {/* Where you are: the chapter, which is how people talk about a book,
          and how far through it. Opens the table of contents. */}
      <PdfToolbarMenuBlock
        title="Contents"
        className="px-2.5 text-[13px] font-medium"
        label={(
          <span className="flex min-w-0 items-center gap-2">
            {/* Never cut short: "Chapter 3", or a section's own short name;
                the full title is on hover and in the contents. */}
            <span className="whitespace-nowrap" title={location.chapter || undefined}>
              {location.chapter ? formatEpubChapterLabelBlock(location.chapter) : 'Contents'}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{percent}%</span>
          </span>
        )}
        entries={tocEntries.length > 0 ? tocEntries : [{ key: 'none', label: 'No table of contents', disabled: true, onClick: () => undefined }]}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-8 border border-transparent px-0"
        onClick={() => turnPageRef.current(1)}
        title="Next page (→)"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </Button>

      <div className="mx-1.5 h-4 w-px shrink-0 bg-border/60" />

      <PdfToolbarMenuBlock
        title="Text"
        className="px-2.5 text-[13px] font-medium"
        label={<span className="font-serif text-[15px] leading-none">Aa</span>}
        entries={typeEntries}
      />
      <PdfToolbarMenuBlock
        title="Paper tone"
        className="px-2.5 text-[13px] font-medium"
        label={(
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-[14px] w-[11px] rounded-[2px] ring-1 ring-inset ring-black/15 dark:ring-white/20"
              style={{ background: PDF_PAPER_THEME_BACKGROUNDS_BLOCK[look] }}
            />
            {PDF_PAPER_THEME_LABELS_BLOCK[look]}
          </span>
        )}
        entries={PDF_PAPER_THEMES_BLOCK.map((theme) => ({
          key: theme,
          label: PDF_PAPER_THEME_LABELS_BLOCK[theme],
          checked: paperTheme === theme,
          onClick: () => applyPaperThemeBlock(theme),
        }))}
      />
    </>
  )

  const docked = toolbarHost !== null

  return (
    <div
      ref={themeScopeRef}
      className={cn('relative flex h-full min-h-0 flex-col overflow-hidden', className)}
      style={{ background: DESK_BLOCK[look] }}
    >
      {docked ? createPortal(
        <div className="flex items-center gap-0.5 [&_button]:h-8 [&_button]:rounded-full">{toolbarControls}</div>,
        toolbarHost,
      ) : (
        <div
          className={cn(
            'absolute left-1/2 top-2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full border border-border/60 bg-background/85 px-1.5 py-1 shadow-[0_6px_24px_-8px_rgba(0,0,0,0.18)] backdrop-blur-xl [scrollbar-width:none]',
            'dark:bg-[#2a2a2d]/85 [&_button]:h-8 [&_button]:rounded-full',
          )}
        >
          {toolbarControls}
        </div>
      )}

      <div
        ref={deskRef}
        className="relative flex min-h-0 flex-1 justify-center"
        style={{
          paddingTop: (docked ? topInset : 52) + DESK_PADDING_PX_BLOCK,
          paddingBottom: DESK_PADDING_PX_BLOCK,
        }}
      >
        <div
          ref={bookRef}
          className="relative h-full overflow-hidden rounded-[3px]"
          style={{
            width: bookWidth || '100%',
            background: PDF_PAPER_THEME_BACKGROUNDS_BLOCK[look],
            boxShadow: pageEdgesShadowBlock(PDF_PAPER_THEME_BACKGROUNDS_BLOCK[look], PAGE_EDGE_BLOCK[look], look === 'night'),
          }}
        >
          <div ref={hostRef} className="h-full w-full" />
          {spread && (
            /* The spine: a soft fold shadow as if the pages curve down into
               the binding. Above everything, a turning leaf included — the
               shadow belongs to the binding, so it must not change while a
               page turns; carried on the leaf it thinned as the page rotated
               and the spine went light at the start of every turn. */
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-1/2 z-[4] w-32 -translate-x-1/2"
              style={{
                background: look === 'night'
                  ? 'linear-gradient(to right, transparent, rgba(0,0,0,0.25) 42%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.25) 58%, transparent)'
                  : 'linear-gradient(to right, transparent, rgba(60,45,20,0.03) 30%, rgba(60,45,20,0.08) 42%, rgba(60,45,20,0.16) 49%, rgba(60,45,20,0.16) 51%, rgba(60,45,20,0.08) 58%, rgba(60,45,20,0.03) 70%, transparent)',
              }}
            />
          )}
        </div>
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Opening book…
          </div>
        )}
        {error && (
          <div className="absolute inset-x-6 top-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
