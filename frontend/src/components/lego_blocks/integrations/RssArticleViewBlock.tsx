import { useCallback, useEffect, useState } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, FolderInput, Loader2, Star, X } from 'lucide-react'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { updateRssItemMetaOrch, moveRssArticleToVaultOrch } from '@/services/orchestrators/rssFeedOrch'
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
import UrlDocumentBlock from './UrlDocumentBlock'
import { cn } from '@/lib/utils'

const MOVE_RECENTS_KEY = 'ltm-rss-move-to-vault-recents'

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
}: RssArticleViewBlockProps) {
  const { layout } = useUILayoutBlock()
  const isIos = layout.surface === 'capacitor-ios'
  const [tags, setTags] = useState<string[]>(item.tags ?? [])
  const [keep, setKeep] = useState(item.keep ?? false)
  const [important, setImportant] = useState(item.important ?? false)

  // Move-to-vault state
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [moveDestPath, setMoveDestPath] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  // j/n → next, k/p → previous. Deliberately not the arrow keys: those scroll
  // the article. Note these only fire while focus is in the app chrome — key
  // events inside the article webview don't reach this document, so the on-screen
  // buttons stay the reliable path once you've clicked into the page.
  useEffect(() => {
    if (!nav || showMoveDialog) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      const key = event.key.toLowerCase()
      if (key === 'j' || key === 'n') {
        if (!nav.hasNext) return
        event.preventDefault()
        nav.goNext()
      } else if (key === 'k' || key === 'p') {
        if (!nav.hasPrev) return
        event.preventDefault()
        nav.goPrev()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [nav, showMoveDialog])

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

        {/* Preset tag chips — toggle on/off */}
        {presetTags.map(tag => {
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Next/prev through the feed panel's current queue */}
        {nav && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={nav.goPrev}
              disabled={!nav.hasPrev}
              title="Previous article (k or p)"
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
              title="Next article (j or n)"
              className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground/70"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="mx-1 h-4 w-px bg-border/50" />
          </div>
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

      {/* URL content — wrapped so h-full inside UrlDocumentBlock resolves to the
           flex-allocated space, not the full container (fixes iOS WKWebView overlap) */}
      <div className="relative min-h-0 flex-1">
        <UrlDocumentBlock
          url={item.link}
          onClose={onClose}
          showCloseButton={!isIos}
          hideHeader={hideUrlBar}
          suspended={suspended}
          className="absolute inset-0"
        />
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
