import { useCallback, useEffect, useRef, useState } from 'react'
import { articleSummaryPointsBlock } from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'
import { BookOpen, Bookmark, Check, ChevronLeft, ChevronRight, FolderInput, Globe, Loader2, Star, Tag, X } from 'lucide-react'
import { loadReaderViewOrch, readerViewAvailableOrch } from '@/services/orchestrators/rssReaderViewOrch'
import { rssLinkPaywalledBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import {
  markRssItemViewedOrch,
  moveRssArticleToVaultOrch,
  updateRssItemMetaOrch,
} from '@/services/orchestrators/rssFeedOrch'
import {
  hasTagBlock,
  tagColorClassBlock,
  tagColorStyleBlock,
  tagLookupKeyBlock,
} from '@/services/lego_blocks/units/tagBlock'
import type {
  RssArticleNavStateBlock,
  RssFeedItemBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import CascadingFolderPicker, {
  type CascadingFolderPickerChange,
} from './CascadingFolderPickerBlock'
import UrlDocumentBlock, { type UrlDocumentScrollerBlock } from './UrlDocumentBlock'
import { cn } from '@/lib/utils'
import RssItemAnnotationMarksBlock from '@/components/lego_blocks/units/RssItemAnnotationMarksBlock'

const MOVE_RECENTS_KEY = 'ltm-rss-move-to-vault-recents'

/** One arrow press ≈ three mouse-wheel notches; a page key ≈ most of a screen. */
const SCROLL_STEP_PX = 120
const SCROLL_PAGE_PX = 640

/** How long an article has to stay open before we call it read. Arrow keys open
 *  articles as you move through the list, so merely being opened means nothing —
 *  only scrolling it or lingering on it does. */
const DWELL_TO_MARK_READ_MS = 5000


/** Whether the AI's points start open in the reader (this device). */
const AI_POINTS_OPEN_KEY = 'ltm-reader-ai-points-open'

interface RssArticleViewBlockProps {
  item: RssFeedItemBlock
  onClose: () => void
  onItemUpdate: (updated: RssFeedItemBlock) => void
  onMoved: (newPath: string) => void
  presetTags?: string[]
  tagColors?: Record<string, string>
  className?: string
  suspended?: boolean
  hideUrlBar?: boolean
  /** Walks the same queue the feed panel is showing, so the reader can move to
   *  the next article without bouncing back to the list. */
  nav?: RssArticleNavStateBlock | null
  /** 'native': F9's look. The preset tags fold into one Tag menu, and a
   *  cached article reads like a publication (source line, serif text). */
  appearance?: 'default' | 'native'
  /** The source's name, shown above a cached article's title (native). */
  sourceLabel?: string
  /** Shown under the AI's points (the F9 Feed puts its reading notes here) */
  belowSummary?: React.ReactNode
}

export default function RssArticleViewBlock({
  item,
  onClose,
  onItemUpdate,
  onMoved,
  presetTags = [],
  tagColors = {},
  className,
  suspended,
  hideUrlBar,
  nav,
  appearance = 'default',
  sourceLabel,
  belowSummary,
}: RssArticleViewBlockProps) {
  const native = appearance === 'native'
  // Native: the site opens by default (it has the pictures); R or the book
  // button switches to the reader view, clean text pulled from the page on
  // first use. Articles whose text came from the library or a feed behind a
  // paywall open in the reader view, since their site would only show the wall.
  const [readerOn, setReaderOn] = useState(() => native && Boolean(item.textInCache) && (!item.link || rssLinkPaywalledBlock(item.link)))
  const [preparingReader, setPreparingReader] = useState(false)
  const [readerNote, setReaderNote] = useState<string | null>(null)
  useEffect(() => {
    if (!native || !readerOn || item.textInCache) {
      setPreparingReader(false)
      return
    }
    if (!readerViewAvailableOrch(item)) {
      setReaderOn(false)
      setReaderNote('No reader view for this page.')
      return
    }
    let cancelled = false
    setPreparingReader(true)
    setReaderNote(null)
    void loadReaderViewOrch(item).then((withText) => {
      if (cancelled) return
      setPreparingReader(false)
      if (withText) onItemUpdate?.(withText)
      else {
        setReaderOn(false)
        setReaderNote('No reader view for this page.')
      }
    })
    return () => { cancelled = true }
    // One attempt per switch; a change of the article's text is what ends it
  }, [item.id, native, readerOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const readerView = native && readerOn && Boolean(item.textInCache)
  const toggleReader = useCallback(() => {
    setReaderNote(null)
    setReaderOn(prev => !prev)
  }, [])
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const { layout } = useUILayoutBlock()
  const isIos = layout.surface === 'capacitor-ios'
  const [tags, setTags] = useState<string[]>(item.tags ?? [])
  // The AI's points: one line until opened; the choice is remembered on this device
  const [aiOpen, setAiOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(AI_POINTS_OPEN_KEY) === '1' } catch { return false }
  })
  const toggleAiOpen = useCallback(() => {
    setAiOpen((open) => {
      try { localStorage.setItem(AI_POINTS_OPEN_KEY, open ? '0' : '1') } catch { /* a convenience only */ }
      return !open
    })
  }, [])
  const [keep, setKeep] = useState(item.keep ?? false)
  const [important, setImportant] = useState(item.important ?? false)

  // Move-to-vault state
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [moveDestPath, setMoveDestPath] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  // The view stays mounted from article to article (its in-app browser just
  // navigates, rather than a new one being created each time), so per-article
  // state resets here when the article changes — during render, before any
  // effect reads it.
  const [shownItemId, setShownItemId] = useState(item.id)
  if (shownItemId !== item.id) {
    setShownItemId(item.id)
    setTags(item.tags ?? [])
    setKeep(item.keep ?? false)
    setImportant(item.important ?? false)
    setTagMenuOpen(false)
    setShowMoveDialog(false)
    setMoveError(null)
    setReaderOn(native && Boolean(item.textInCache) && (!item.link || rssLinkPaywalledBlock(item.link)))
    setPreparingReader(false)
    setReaderNote(null)
  }

  // Scrolls the embedded article from the host document. Only Electron populates
  // this (see UrlDocumentBlock) — elsewhere the guest page is unscriptable and
  // ↑/↓ fall back to being ignored here.
  const articleScrollerRef = useRef<UrlDocumentScrollerBlock | null>(null)

  // Read state is earned, not granted on open. Keyed by id so stepping to the
  // next article re-arms it, and so a re-render can't double-fire the write.
  const markedReadIdRef = useRef<string | null>(null)
  const markViewed = useCallback(() => {
    if (item.read || markedReadIdRef.current === item.id) return
    markedReadIdRef.current = item.id
    const viewedAt = new Date().toISOString()
    void markRssItemViewedOrch(item.id)
    onItemUpdate({ ...item, tags, keep, important, read: true, viewedAt })
  }, [item, tags, keep, important, onItemUpdate])

  // Dwelling on an article counts as reading it. This is the only signal that
  // works for mouse readers too: scrolling happens inside the webview, where the
  // host document can't observe it.
  useEffect(() => {
    if (item.read) return
    const timer = setTimeout(markViewed, DWELL_TO_MARK_READ_MS)
    return () => { clearTimeout(timer) }
  }, [item.id, item.read, markViewed])

  // Once an article is open the keyboard goes modal: ←/→ walk the queue, ↑/↓
  // scroll the article body, Escape closes. That combination is what makes the
  // reader mouse-free — the user never has to click into the page to scroll it,
  // which matters because key events inside the article webview never reach this
  // document. j/n and k/p stay as aliases for next/prev.
  useEffect(() => {
    if (showMoveDialog) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      const scrollBy = (deltaPx: number) => {
        const scroller = articleScrollerRef.current
        if (!scroller) return
        event.preventDefault()
        scroller(deltaPx)
        // Scrolling is unambiguous engagement — no need to wait out the dwell.
        markViewed()
      }

      switch (event.key) {
        case 'ArrowDown': return scrollBy(SCROLL_STEP_PX)
        case 'ArrowUp': return scrollBy(-SCROLL_STEP_PX)
        case 'PageDown': return scrollBy(SCROLL_PAGE_PX)
        case 'PageUp': return scrollBy(-SCROLL_PAGE_PX)
        case 'Escape':
          event.preventDefault()
          onClose()
          return
      }
      if ((event.key === 'a' || event.key === 'A') && item.aiSummary) {
        event.preventDefault()
        toggleAiOpen()
        return
      }
      if (native && (event.key === 'r' || event.key === 'R') && (item.textInCache || readerViewAvailableOrch(item))) {
        event.preventDefault()
        toggleReader()
        return
      }

      const key = event.key === 'ArrowRight' || event.key === 'ArrowLeft'
        ? event.key
        : event.key.toLowerCase()
      if (!nav) return
      if (key === 'ArrowRight' || key === 'j' || key === 'n') {
        if (!nav.hasNext) return
        event.preventDefault()
        nav.goNext()
      } else if (key === 'ArrowLeft' || key === 'k' || key === 'p') {
        if (!nav.hasPrev) return
        event.preventDefault()
        nav.goPrev()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [nav, showMoveDialog, onClose, markViewed, native, item, toggleReader, toggleAiOpen])

  const applyMeta = useCallback((
    nextTags: string[],
    nextKeep: boolean,
    nextImportant: boolean,
  ) => {
    void updateRssItemMetaOrch(item.id, { tags: nextTags, keep: nextKeep, important: nextImportant })
    onItemUpdate({ ...item, tags: nextTags, keep: nextKeep, important: nextImportant })
  }, [item, onItemUpdate])

  const toggleKeep = useCallback(() => {
    const next = !keep
    setKeep(next)
    applyMeta(tags, next, important)
  }, [keep, tags, important, applyMeta])

  const toggleImportant = useCallback(() => {
    const next = !important
    setImportant(next)
    applyMeta(tags, keep, next)
  }, [important, tags, keep, applyMeta])

  const toggleTag = useCallback((tag: string) => {
    const has = hasTagBlock(tags, tag)
    const next = has ? tags.filter(t => t !== tag) : [...tags, tag]
    setTags(next)
    applyMeta(next, keep, important)
  }, [tags, keep, important, applyMeta])

  const handleMoveConfirm = useCallback(async () => {
    if (!moveDestPath) return
    setMoving(true)
    setMoveError(null)
    try {
      const newPath = await moveRssArticleToVaultOrch(
        { ...item, tags, keep, important },
        moveDestPath,
      )
      setShowMoveDialog(false)
      onMoved(newPath)
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Move failed')
    } finally {
      setMoving(false)
    }
  }, [item, tags, keep, important, moveDestPath, onMoved])

  const hasAnything = keep || important || tags.length > 0

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col', className)}>
      {/* Meta bar — hidden together with the URL bar when header is toggled off */}
      {!hideUrlBar && <div
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-1.5',
          hasAnything ? 'bg-muted/20' : 'bg-muted/10',
        )}
      >
        {/* Keep */}
        <button
          type="button"
          onClick={toggleKeep}
          title={keep ? 'Kept — click to unkeep' : 'Keep forever'}
          className={cn(
            'shrink-0 rounded p-0.5 transition-colors',
            keep ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/50 hover:text-muted-foreground',
          )}
        >
          <Bookmark className={cn('h-3.5 w-3.5', keep && 'fill-amber-500')} />
        </button>

        {/* Important */}
        <button
          type="button"
          onClick={toggleImportant}
          title={important ? 'Important — click to unmark' : 'Mark as important'}
          className={cn(
            'shrink-0 rounded p-0.5 transition-colors',
            important ? 'text-rose-500 hover:text-rose-400' : 'text-muted-foreground/50 hover:text-muted-foreground',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', important && 'fill-rose-500')} />
        </button>

        {(tags.length > 0 || keep || important || presetTags.length > 0) && (
          <div className="h-4 w-px shrink-0 bg-border/50" />
        )}

        {/* Native: one Tag menu instead of a row of chips; applied tags sit beside it */}
        {native && presetTags.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setTagMenuOpen(v => !v)}
              aria-expanded={tagMenuOpen}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <Tag className="h-3.5 w-3.5" /> Tag
            </button>
            {tagMenuOpen && (
              <>
                <button type="button" aria-label="Close tags" className="fixed inset-0 z-40 cursor-default" onClick={() => setTagMenuOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg bg-white p-1 shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.16)] dark:bg-zinc-900 dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.12),0_8px_24px_rgba(0,0,0,0.5)]">
                  {presetTags.map(tag => {
                    const selected = hasTagBlock(tags, tag)
                    return (
                      <button
                        key={`menu-${tag}`}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="flex h-3.5 w-3.5 items-center justify-center">{selected && <Check className="h-3.5 w-3.5" />}</span>
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
        {native && tags.filter(t => presetTags.some(p => p.toLowerCase() === t.toLowerCase())).map(tag => (
          <span key={`applied-${tag}`} className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{tag}</span>
        ))}

        {/* Preset tag chips — toggle on/off */}
        {!native && presetTags.map(tag => {
          const selected = hasTagBlock(tags, tag)
          return (
            <button
              key={`preset-${tag}`}
              type="button"
              onClick={() => toggleTag(tag)}
              title={selected ? `Remove ${tag}` : `Add ${tag}`}
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                tagColorClassBlock(tag, selected ? 'selected' : 'unselected'),
              )}
              style={tagColorStyleBlock(tag, selected ? 'selected' : 'unselected', tagColors[tagLookupKeyBlock(tag)])}
            >
              {tag}
            </button>
          )
        })}

        {/* Show any tags not in presets (legacy free-form) as removable chips */}
        {tags.filter(t => !presetTags.some(p => p.toLowerCase() === t.toLowerCase())).map(tag => (
          <span
            key={`extra-${tag}`}
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium',
              tagColorClassBlock(tag, 'solid'),
            )}
            style={tagColorStyleBlock(tag, 'solid', tagColors[tagLookupKeyBlock(tag)])}
          >
            {tag}
            <button
              type="button"
              onClick={() => toggleTag(tag)}
              className="ml-0.5 rounded-full opacity-60 hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}

        <RssItemAnnotationMarksBlock itemId={item.id} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Next/prev through the feed panel's current queue */}
        {nav && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={nav.goPrev}
              disabled={!nav.hasPrev}
              title="Previous article (← / k / p)"
              className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground/70"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="select-none px-0.5 text-[10px] tabular-nums text-muted-foreground/70">
              {nav.position}/{nav.total}
            </span>
            <button
              type="button"
              onClick={nav.goNext}
              disabled={!nav.hasNext}
              title="Next article (→ / j / n)"
              className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground/70"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="mx-1 h-4 w-px bg-border/50" />
          </div>
        )}

        {/* Reader view ↔ the site itself */}
        {native && (item.textInCache || readerViewAvailableOrch(item)) && (
          <button
            type="button"
            onClick={toggleReader}
            title={readerOn ? 'Show the page itself (R)' : 'Reader view: the article as clean text (R)'}
            className={cn('mr-1 shrink-0 rounded p-0.5 hover:text-muted-foreground', readerOn ? 'text-foreground' : 'text-muted-foreground/60')}
          >
            {readerOn ? <Globe className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* Move to vault */}
        <button
          type="button"
          onClick={() => { setShowMoveDialog(true); setMoveError(null) }}
          title="Move to vault folder"
          className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
        >
          <FolderInput className="h-3.5 w-3.5" />
        </button>
      </div>}

      {/* The AI's summary, when it has read the article: the same record either reader leaves.
           One line until opened (A, or the toggle), so the article keeps the room. */}
      {item.aiSummary && (() => {
        const points = articleSummaryPointsBlock(item.aiSummary.text)
        const more = points.length > 1
        return (
          <div className="shrink-0 border-b border-border/50 bg-violet-50/60 px-4 py-2 text-[12.5px] leading-snug text-zinc-700 dark:bg-violet-500/5 dark:text-zinc-200">
            <div className={cn('flex gap-2', aiOpen && more ? 'items-start' : 'items-center')}>
              <span className="shrink-0 rounded bg-violet-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title={`Summary by ${item.aiSummary.model || 'AI'}`}>AI read</span>
              {!(aiOpen && more) && <span className={cn('min-w-0 flex-1', !aiOpen && 'truncate')}>{points[0]}</span>}
              {aiOpen && more && <span className="min-w-0 flex-1 text-zinc-500 dark:text-zinc-400">{points.length} points</span>}
              {more && (
                <button
                  type="button"
                  // A click leaves the focus with the article (no outline on the toggle)
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={toggleAiOpen}
                  title={aiOpen ? 'Hide the points (A)' : `Show all ${points.length} points (A)`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] leading-none text-violet-700 outline-none hover:bg-violet-100 focus-visible:ring-1 focus-visible:ring-violet-400 dark:text-violet-300 dark:hover:bg-violet-500/15"
                >
                  <span>{aiOpen ? 'Hide' : `+${points.length - 1} more`}</span>
                  <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-violet-200 px-1 font-sans text-[10px] leading-none dark:border-violet-500/30">A</kbd>
                </button>
              )}
            </div>
            {aiOpen && more && (
              <ul className="mt-1.5 max-h-[30vh] list-disc space-y-1 overflow-y-auto pl-4 marker:text-violet-400">
                {points.map(point => <li key={point}>{point}</li>)}
              </ul>
            )}
          </div>
        )
      })()}

      {belowSummary}

      {/* URL content — wrapped so h-full inside UrlDocumentBlock resolves to the
           flex-allocated space, not the full container (fixes iOS WKWebView overlap) */}
      <div className="relative min-h-0 flex-1">
        {readerNote && (
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-zinc-900/85 px-3 py-1 text-[11px] text-white shadow">{readerNote}</div>
        )}
        {(readerView || (!native && item.textInCache)) ? (
          <CachedArticleTextBlock item={item} native={native} sourceLabel={sourceLabel} scrollerRef={articleScrollerRef} />
        ) : preparingReader ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing the reader view…
            <button type="button" onClick={() => setReaderOn(false)} className="text-[12px] text-sky-600 hover:text-sky-700 dark:text-sky-400">Show the page instead</button>
          </div>
        ) : (
        <UrlDocumentBlock
          url={item.link}
          onClose={onClose}
          showCloseButton={!isIos}
          hideHeader={hideUrlBar}
          suspended={suspended}
          scrollerRef={articleScrollerRef}
          className="absolute inset-0"
        />
        )}
      </div>

      {/* Move-to-vault overlay */}
      {showMoveDialog && (
        <div className="absolute inset-0 z-50 flex flex-col bg-background">
          {/* Dialog header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3">
            <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              Move to Vault Folder
            </span>
            <button
              type="button"
              onClick={() => setShowMoveDialog(false)}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Article preview */}
          <div className="shrink-0 border-b border-border/30 bg-muted/30 px-4 py-2">
            <div className="truncate text-xs font-medium">{item.title || '(Untitled)'}</div>
            <div className="truncate text-[11px] text-muted-foreground">{item.link}</div>
          </div>

          {/* Picker */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <CascadingFolderPicker
              onChange={(change: CascadingFolderPickerChange) => {
                setMoveDestPath(change.destinationPath)
                setMoveError(null)
              }}
              storageKey={MOVE_RECENTS_KEY}
              previewLabel="Article will be saved to"
              maxRecents={8}
            />
          </div>

          {/* Error */}
          {moveError && (
            <div className="shrink-0 px-4 py-2 text-xs text-destructive">{moveError}</div>
          )}

          {/* Actions */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
            <button
              type="button"
              onClick={() => setShowMoveDialog(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleMoveConfirm()}
              disabled={!moveDestPath || moving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {moving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {moving ? 'Moving…' : 'Move Here'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The article's own text from the cache, for feeds whose links need a login.
 *  Paragraphs are the blank-line-separated blocks the outside tool wrote. */
function CachedArticleTextBlock({ item, native = false, sourceLabel, scrollerRef }: {
  item: RssFeedItemBlock
  native?: boolean
  sourceLabel?: string
  /** ↑/↓ and Page Up/Down scroll this text, as they scroll a page */
  scrollerRef?: React.MutableRefObject<UrlDocumentScrollerBlock | null>
}) {
  const textScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scrollerRef) return
    scrollerRef.current = (deltaPx: number) => { textScrollRef.current?.scrollBy({ top: deltaPx, behavior: 'smooth' }) }
    return () => { scrollerRef.current = null }
  }, [scrollerRef])
  const paragraphs = item.description.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const when = item.pubDate ? new Date(item.pubDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null
  // Native: read like a publication — source and date in small caps above a
  // serif title, serif body, the original linked quietly at the end
  if (native) {
    return (
      <div ref={textScrollRef} className="absolute inset-0 overflow-y-auto">
        <article className="mx-auto max-w-[680px] px-6 pb-16 pt-10">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            {[sourceLabel, when].filter(Boolean).join(' · ')}
          </p>
          <h1 className="mt-2 font-serif text-[32px] leading-[1.15] tracking-[-0.01em] text-foreground">{item.title}</h1>
          <div className="mt-7 space-y-5 font-serif text-[18px] leading-[1.65] text-zinc-800 dark:text-zinc-200">
            {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          </div>
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" className="mt-10 inline-block text-[12px] text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">
              Open the original ›
            </a>
          )}
        </article>
      </div>
    )
  }
  return (
    <div ref={textScrollRef} className="absolute inset-0 overflow-y-auto">
      <article className="mx-auto max-w-[680px] px-6 py-8">
        <h1 className="text-[24px] font-semibold leading-tight text-foreground">{item.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
          {when && <span>{when}</span>}
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              Open the original
            </a>
          )}
        </div>
        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-foreground">
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </article>
    </div>
  )
}
