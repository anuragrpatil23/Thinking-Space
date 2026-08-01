import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// The organizer drawer's shared chrome — the panel, its surfaces, and the small
// parts every drawer in this tab is built from.
//
// It exists because there are two drawers now (an undertaking's and a note's)
// and they are the same object seen from the two sides of the seam. Copied
// rather than shared, the second one would start identical and drift within a
// week: one gains a radius, the other keeps a border, and the tab stops reading
// as one place.
//
// The language it encodes, unchanged from the undertaking drawer:
//
//   1. No box inside a box. The drawer *is* the panel. Groups are separated by
//      space and a hairline, never by another bordered card.
//   2. Controls are recessed, not outlined. A field reads as a soft well in the
//      panel surface rather than a boxed form input, so the eye follows content
//      instead of counting borders.

/** A recessed field surface — the well. */
export const FIELD_SURFACE =
  'rounded-[10px] border border-black/[0.06] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03]'

/** Text inputs and textareas. */
export const DRAWER_INPUT = cn(
  FIELD_SURFACE,
  'w-full px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50',
  'focus:border-black/[0.12] focus:bg-black/[0.035] dark:focus:border-white/[0.14] dark:focus:bg-white/[0.05]',
  'disabled:opacity-60',
)

/** Selects — `appearance-none` kills the OS chevron, which was the loudest
 *  unfinished tell in the drawer; ChevronDown is drawn over it instead. */
export const DRAWER_SELECT = cn(DRAWER_INPUT, 'cursor-pointer appearance-none pr-9')

/** The one filled action in a drawer. Everything else is quiet by design. */
export const PRIMARY_BUTTON =
  'inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40'

/** A quiet header action (Copy, and anything that joins it). */
export const DRAWER_HEADER_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

/**
 * The slide-over itself: scrim, panel, Esc to close, and the header row that
 * every drawer opens with — an eyebrow naming what kind of thing this is, and
 * the actions at the far end.
 *
 * Content runs to the panel's own padding rather than a centred measure. The
 * old 52rem cap made sense when the drawer was one reading column, but the body
 * is columns now, and capping it stacked a dead gutter on top of the padding on
 * both sides while squeezing those columns.
 */
export function DrawerShellBlock({
  eyebrow,
  actions,
  onClose,
  children,
}: {
  /** What kind of thing this is — "Undertaking", "Idea", "Question". */
  eyebrow: string
  /** Quiet header actions, placed before the close button. */
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div className="fixed inset-0 z-[120] bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[121] w-[min(96vw,58rem)] overflow-auto border-l border-black/[0.06] bg-background pt-[max(env(safe-area-inset-top),3.5rem)] shadow-[0_8px_40px_rgba(20,20,24,0.14)] animate-slide-in dark:border-white/[0.06] sm:pt-0">
        <div className="flex flex-col gap-5 p-5 sm:px-8 sm:py-7">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </span>
            <div className="flex items-center gap-1">
              {actions}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}

/** A textarea that grows to fit its content. Both the title and the head were
 *  fixed at `rows={2}`, which clipped longer text mid-sentence — the head in
 *  particular is a paragraph and was being cut off with no way to see the rest. */
export function GrowTextarea({
  value,
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      className={cn('resize-none overflow-hidden', className)}
      {...rest}
    />
  )
}

/** Positions a chevron over an `appearance-none` select so it reads as one of
 *  the app's controls rather than an OS dropdown. */
export function SelectShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative', className)}>
      {children}
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  )
}

/** The rail's group label. Quieter than a reading-column heading on purpose —
 *  the rail is reference, and it must not compete with the head or the notes. */
export function RailLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/60">
      {children}
    </h3>
  )
}

/** A titled group: a heading, then content, separated from its neighbour by a
 *  hairline and space — no card. The heading is sentence-case at reading size;
 *  the drawer previously set every label as an identical 11px uppercase eyebrow,
 *  so eight groups all shouted at the same pitch and none read as a heading. */
export function Field({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-t border-black/[0.06] pt-6 first:border-t-0 first:pt-0 dark:border-white/[0.06]">
      <FieldHeading label={label} action={action} />
      {children}
    </section>
  )
}

/** The heading alone, for the groups that share one hairline instead of each
 *  carrying their own — the trail/sessions pair sits inside a single section, so
 *  a second `Field` there would have drawn a rule across the middle of it. */
export function FieldHeading({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground/70">{label}</h2>
      {action}
    </div>
  )
}

/** The initials disc on a note. Colour is derived from the author string so the
 *  same author is always the same colour, and unattributed notes ("You") share
 *  one neutral slot. */
const NOTE_AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-cyan-600',
]

export function NoteAvatar({ author, size = 'md' }: { author: string | null; size?: 'sm' | 'md' }) {
  const name = author?.trim() || ''
  const initials = name
    ? name.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
    : 'YOU'
  const slot = name
    ? NOTE_AVATAR_COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % NOTE_AVATAR_COLORS.length]
    : 'bg-muted-foreground/50'
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        size === 'sm' ? 'h-5 w-5 text-[8px]' : 'mt-0.5 h-7 w-7 text-[10px]',
        slot,
      )}
    >
      {initials.slice(0, 3)}
    </span>
  )
}

/** A linked record's title. Navigable when the drawer was given a way to swap
 *  keys — following an edge should land you on the thing the edge names, not
 *  make you close the drawer and hunt the list for it. */
export function LinkTitle({
  title,
  linkKey,
  onOpen,
  muted = false,
}: {
  title: string
  linkKey: string
  onOpen?: (key: string) => void
  muted?: boolean
}) {
  const tone = muted ? 'text-muted-foreground/75' : 'text-foreground/80'
  if (!onOpen) {
    return (
      <span className={cn('min-w-0 flex-1 leading-snug', tone)} title={linkKey}>
        {title}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(linkKey)}
      className={cn(
        'min-w-0 flex-1 text-left leading-snug underline-offset-2 transition-colors hover:text-foreground hover:underline',
        tone,
      )}
      title={`${linkKey} — ${title}`}
    >
      {title}
    </button>
  )
}

/** A read-only edge list in the Relationships grid. Renders nothing when empty:
 *  an "and nothing led out of this" placeholder in every one of these cells
 *  would be four-fifths of the grid saying nothing. */
export function ReverseLinks({
  label,
  refs,
  onOpen,
  muted = false,
}: {
  label: string
  refs: Array<{ key: string; title: string }>
  onOpen?: (key: string) => void
  muted?: boolean
}) {
  if (refs.length === 0) return null
  return (
    <div className="min-w-0">
      <RailLabel>{label}</RailLabel>
      <ul className="mt-2 space-y-1.5">
        {refs.map(ref => (
          <li key={ref.key} className="flex items-start gap-1.5 text-[13px]">
            <LinkTitle title={ref.title} linkKey={ref.key} onOpen={onOpen} muted={muted} />
          </li>
        ))}
      </ul>
    </div>
  )
}
