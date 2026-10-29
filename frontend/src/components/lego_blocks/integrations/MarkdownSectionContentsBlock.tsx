import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { ChevronDown, ListTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  parseMarkdownTableOfContentsBlock,
  type MarkdownTableOfContentsItemBlock,
} from '@/services/lego_blocks/units/markdownTableOfContentsBlock'
import {
  buildMarkdownSectionRowsBlock,
  resolveMarkdownSectionLocationBlock,
} from '@/services/lego_blocks/units/markdownSectionOutlineBlock'
import { STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'

interface MarkdownSectionContentsBlockProps {
  content: string
  /** The note's scroll container; headings are read from it as it scrolls. */
  container: HTMLElement | null
  /** The pinned strip this button sits in: a heading counts as "being read"
   *  once it has scrolled up to the strip, and the section rows hang off it. */
  stripRef: RefObject<HTMLElement | null>
  onSelectHeading: (heading: MarkdownTableOfContentsItemBlock) => void
}

type StackScope = 'all' | 'section'

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preference just won't persist.
  }
}

function readStackScopePreference(): StackScope {
  return readPreference(STORAGE_KEYS.markdownSectionStackScope) === 'section' ? 'section' : 'all'
}

// Only the narrow, one-section stack reopens by itself on the next note. The
// whole outline is tall, and dropping it over the top of every note opened
// would hide the note; that one is opened by hand each time.
function readStackOpenPreference(): boolean {
  return readPreference(STORAGE_KEYS.markdownSectionStackOpen) === '1' && readStackScopePreference() === 'section'
}

/**
 * The reading view's Contents button: the label and the heading count. When
 * clicked, it pins the note's outline under the strip as thin rows, the
 * heading being read highlighted. The same rows narrow to just the current
 * section ("This section only") — the whole section, so what is still ahead
 * stays visible — and that choice is remembered. There is no separate menu.
 *
 * Owns the "which heading is being read" state itself: that changes as the
 * note scrolls, and holding it in the document block would re-render — and
 * re-parse — the whole note at every heading.
 */
export default function MarkdownSectionContentsBlock({
  content,
  container,
  stripRef,
  onSelectHeading,
}: MarkdownSectionContentsBlockProps) {
  const rows = useMemo(() => buildMarkdownSectionRowsBlock(parseMarkdownTableOfContentsBlock(content)), [content])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [stackOpen, setStackOpen] = useState(readStackOpenPreference)
  const [scope, setScope] = useState<StackScope>(readStackScopePreference)
  // Opened above the first section while narrowed: there is no section to
  // show yet, so the whole note stands in until the stack is closed.
  const [widened, setWidened] = useState(false)

  useEffect(() => {
    if (!container) return
    let frame = 0
    const compute = () => {
      frame = 0
      const strip = stripRef.current
      // A fixed line just under the strip — deliberately not under the pinned
      // rows, whose height changes with the section and would move the line
      // that decides the section.
      const line = (strip?.getBoundingClientRect().bottom ?? container.getBoundingClientRect().top) + 12
      let next: string | null = null
      for (const heading of Array.from(container.querySelectorAll<HTMLElement>('[data-markdown-heading-id]'))) {
        if (heading.getBoundingClientRect().top > line) break
        next = heading.dataset.markdownHeadingId ?? null
      }
      setActiveId((previous) => (previous === next ? previous : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(compute)
    }
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [container, rows, stripRef])

  const location = useMemo(() => resolveMarkdownSectionLocationBlock(rows, activeId), [rows, activeId])
  const hasSection = location.section.length > 0
  const showAll = scope === 'all' || widened
  const stackRows = showAll ? rows : location.section
  const showStack = stackOpen && stackRows.length > 0

  const rememberStackOpen = useCallback((next: boolean) => {
    setStackOpen(next)
    writePreference(STORAGE_KEYS.markdownSectionStackOpen, next ? '1' : '0')
  }, [])

  const toggleStack = useCallback(() => {
    if (showStack) {
      rememberStackOpen(false)
      setWidened(false)
      return
    }
    rememberStackOpen(true)
    // Narrowed, but with no section to show: the button would otherwise
    // appear to do nothing.
    if (!hasSection) setWidened(true)
  }, [hasSection, rememberStackOpen, showStack])

  const toggleScope = useCallback(() => {
    const next: StackScope = showAll ? 'section' : 'all'
    setScope(next)
    setWidened(false)
    writePreference(STORAGE_KEYS.markdownSectionStackScope, next)
  }, [showAll])

  const pathText = location.path.map((row) => `${row.label} ${row.title}`.trim()).join(' › ')
  const sectionRows = stackRows.filter((row) => !row.isTitle)
  const baseLevel = sectionRows.length > 0 ? Math.min(...sectionRows.map((row) => row.level)) : 1

  // A note with no headings has no contents: "Contents 0" was a button that
  // did nothing.
  if (rows.length === 0) return null

  return (
    <div className="flex min-w-0 items-center">
      <button
        type="button"
        onClick={toggleStack}
        aria-expanded={showStack}
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground',
          showStack && 'bg-muted text-foreground',
        )}
        title={`${hasSection ? `${pathText} — ` : ''}${showStack ? 'hide' : 'pin'} contents`}
      >
        <ListTree className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">Contents</span>
        <span className="shrink-0 rounded bg-background/80 px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
          {rows.length}
        </span>
        {/* The section being read is not named here (decided 2026-10-22: busy, and the
            pinned outline already highlights it); it stays in the tooltip. */}
        {rows.length > 0 && (
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', showStack && 'rotate-180')} />
        )}
      </button>

      {showStack && (
        // Scrolls only if it would outgrow the window, so no row is ever out
        // of reach; there is no cap on rows otherwise.
        <div className="absolute left-0 right-0 top-full z-30 max-h-[75vh] overflow-y-auto border-b border-border/50 bg-card px-2 pb-1 pt-0.5 shadow-sm">
          {stackRows.map((row) => {
            const active = row.id === activeId
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelectHeading(row.item)}
                className={cn(
                  'flex h-[22px] w-full items-center gap-1.5 rounded px-1.5 text-left text-[11px] leading-none',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  row.isTitle && 'font-semibold text-foreground',
                )}
                style={{ paddingLeft: 6 + (row.isTitle ? 0 : Math.max(0, Math.min(row.level - baseLevel, 4)) * 12) }}
              >
                {row.label && (
                  <span className={cn('min-w-[1.1em] shrink-0 text-right font-mono text-[10px]', active ? 'text-primary' : 'text-muted-foreground/70')}>
                    {row.label}
                  </span>
                )}
                <span className="min-w-0 truncate">{row.title}</span>
              </button>
            )
          })}
          {hasSection && rows.length > location.section.length && (
            <button
              type="button"
              onClick={toggleScope}
              className="mt-0.5 flex h-[22px] w-full items-center gap-1.5 rounded border-t border-border/40 px-1.5 text-left text-[11px] leading-none text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <ListTree className="h-3 w-3 shrink-0" />
              {showAll ? 'This section only' : 'All sections'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
