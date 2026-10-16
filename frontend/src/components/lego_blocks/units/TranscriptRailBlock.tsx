import { useCallback, useEffect, useState, type RefObject } from 'react'
import { cn } from '@/lib/utils'

/**
 * A thin timeline down the edge of a transcript pane: a tick per prompt, a
 * green dot per edit, a red one per failure, amber for search hits, and a
 * thumb for what is on screen. A 3-hour session is a very long scroll; the
 * rail is where you see its shape — where the edits clustered, where it went
 * wrong — and jump there.
 *
 * It reads the `data-tx-*` marks `TranscriptViewBlock` puts on its rows, so it
 * spans every session in the pane. Recomputed on resize and scroll events
 * only — no polling (ENERGY.md).
 */

type MarkKind = 'prompt' | 'edit' | 'error' | 'hit'
interface Mark { kind: MarkKind; y: number; el: HTMLElement }

const SELECTOR: Record<MarkKind, string> = {
  prompt: '[data-tx-prompt]',
  edit: '[data-tx-edit]',
  error: '[data-tx-error]',
  hit: '[data-tx-hit]',
}

interface TranscriptRailBlockProps {
  /** The scrolling pane. */
  scrollRef: RefObject<HTMLElement | null>
  /** Changes whenever the content does (parts loaded, query changed). */
  version: unknown
}

export default function TranscriptRailBlock({ scrollRef, version }: TranscriptRailBlockProps) {
  const [marks, setMarks] = useState<Mark[]>([])
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null)

  const measure = useCallback(() => {
    const pane = scrollRef.current
    if (!pane || pane.scrollHeight <= 0) return
    const paneTop = pane.getBoundingClientRect().top
    const total = pane.scrollHeight
    const next: Mark[] = []
    for (const kind of Object.keys(SELECTOR) as MarkKind[]) {
      pane.querySelectorAll<HTMLElement>(SELECTOR[kind]).forEach(el => {
        const top = el.getBoundingClientRect().top - paneTop + pane.scrollTop
        next.push({ kind, y: top / total, el })
      })
    }
    setMarks(next)
  }, [scrollRef])

  const track = useCallback(() => {
    const pane = scrollRef.current
    if (!pane || pane.scrollHeight <= pane.clientHeight) { setThumb(null); return }
    setThumb({
      top: pane.scrollTop / pane.scrollHeight,
      height: pane.clientHeight / pane.scrollHeight,
    })
  }, [scrollRef])

  useEffect(() => {
    const pane = scrollRef.current
    if (!pane) return
    const content = pane.firstElementChild
    const ro = new ResizeObserver(() => { measure(); track() })
    ro.observe(pane)
    if (content) ro.observe(content)
    pane.addEventListener('scroll', track, { passive: true })
    const raf = requestAnimationFrame(() => { measure(); track() })
    return () => {
      ro.disconnect()
      pane.removeEventListener('scroll', track)
      cancelAnimationFrame(raf)
    }
  }, [scrollRef, measure, track, version])

  if (!thumb) return null

  const onRailClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const pane = scrollRef.current
    if (!pane) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientY - rect.top) / rect.height
    pane.scrollTo({ top: frac * pane.scrollHeight - pane.clientHeight / 2, behavior: 'smooth' })
  }

  return (
    <div
      className="absolute bottom-2 right-1 top-2 w-3 cursor-pointer"
      onClick={onRailClick}
      title="Timeline — prompts, edits (green), failures (red)"
    >
      <div
        className="absolute inset-x-0 rounded-sm bg-foreground/[0.06]"
        style={{ top: `${thumb.top * 100}%`, height: `${Math.max(thumb.height * 100, 2)}%` }}
      />
      {marks.map((m, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Jump to ${m.kind}`}
          onClick={e => { e.stopPropagation(); m.el.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}
          className={cn(
            'absolute -translate-y-1/2',
            m.kind === 'prompt' && 'left-0 h-px w-3 bg-foreground/35',
            m.kind === 'edit' && 'left-[3px] h-1.5 w-1.5 rounded-full bg-emerald-500/70',
            m.kind === 'error' && 'left-[3px] h-1.5 w-1.5 rounded-full bg-destructive/70',
            m.kind === 'hit' && 'left-0 h-0.5 w-3 bg-amber-400',
          )}
          style={{ top: `${m.y * 100}%` }}
        />
      ))}
    </div>
  )
}
