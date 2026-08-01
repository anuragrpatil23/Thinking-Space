import type { ReactNode } from 'react'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import OrganizerRowShellBlock, {
  organizerSectionColorBlock,
} from '@/components/lego_blocks/units/OrganizerRowShellBlock'
import { useUndertakingDetailBlock } from '@/components/lego_blocks/hooks/units/useUndertakingDetailBlock'
import type { NoteRef, UndertakingIndexRow } from '@/services/orchestrators/aiActivityUndertakingOrch'

// One undertaking (a doing) in the index, rendered through the shared row shell
// — the List row's look, minus its work-item chrome. The head is the title; the
// tags are the same coloured pills the List uses; the attention gutter (density
// sparkline + pointer count) sits where a List row keeps its status control.
//
// Clicking the row toggles an inline *peek*: the head, a short trail glance, the
// sessions that built it, and the rows this one is logically linked to (what it
// grew out of, what grew out of it, the questions it answered). The peek is the
// "see the linked rows in the row" affordance — visual grouping read off the
// edge graph, never a hand-built tree. Going deeper (editing the head, writing
// notes) is the drawer, opened from the peek. The section's colour spine
// continues down through the peek, so it reads as the row unfolding rather than
// a detached card.

/** An undertaking this row links to, resolved to a title for display. */
export interface LinkedUndertakings {
  /** Undertakings this one grew out of (its causes). */
  parents: NoteRef[]
  /** Undertakings that grew out of this one (its effects). */
  children: NoteRef[]
}

interface Props {
  row: UndertakingIndexRow
  /** The ai-activity project id — threaded so the peek can lazy-load sessions. */
  projectId: string | null
  /** The section's palette slot (shared by all rows in the grouping). */
  colorIndex: number
  /** 1-based row number within the section. */
  ordinal: number
  expanded: boolean
  onToggle: () => void
  /** Open the full detail drawer for a key (this row, or a linked one). */
  onOpenDrawer?: (key: string) => void
  /** Linked undertakings, resolved by the index block. */
  linked: LinkedUndertakings
}

function humanDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

export default function UndertakingIndexRowBlock({
  row,
  projectId,
  colorIndex,
  ordinal,
  expanded,
  onToggle,
  onOpenDrawer,
  linked,
}: Props) {
  const { record, tail, buckets } = row
  const pointerCount = tail.files.length

  return (
    <OrganizerRowShellBlock
      colorIndex={colorIndex}
      ordinal={ordinal}
      leadGlyph={
        <ChevronRight
          className={cn('h-3 w-3 text-muted-foreground/40 transition-transform duration-200', expanded && 'rotate-90 text-muted-foreground/70')}
        />
      }
      title={record.title || record.head || '(untitled undertaking)'}
      tags={[...record.tags, ...record.proposedTags]}
      active={expanded}
      onClick={onToggle}
      rightSlot={
        <>
          <DensitySparklineBlock buckets={buckets} />
          {/* The strip says *when* the work happened; this says *how much*. It
              used to be the file-pointer count, which is 0 for almost every
              undertaking — a column of identical placeholder dots that never
              told you anything. Pointer count survives in the tooltip. */}
          <span
            className="w-14 text-right text-xs tabular-nums text-muted-foreground/70"
            title={
              `${humanDuration(tail.activeDurationMs)} of active work · ` +
              `${pointerCount} file pointer${pointerCount === 1 ? '' : 's'}`
            }
          >
            {tail.activeDurationMs > 0 ? humanDuration(tail.activeDurationMs) : '—'}
          </span>
        </>
      }
      subRows={
        <>
          {row.fedNotes.length > 0 && !expanded && (
            <ul className="mb-0.5 ml-7 mt-px space-y-px">
              {row.fedNotes.map(note => (
                <li key={note.key} className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground/60">
                  <span className="shrink-0 text-muted-foreground/50" aria-hidden>◆→</span>
                  <span className="truncate" title={`${note.key} — ${note.title}`}>{note.title}</span>
                </li>
              ))}
            </ul>
          )}
          {expanded && (
            <PeekPanel
              row={row}
              projectId={projectId}
              colorIndex={colorIndex}
              linked={linked}
              onOpenDrawer={onOpenDrawer}
            />
          )}
        </>
      }
    />
  )
}

const DOT = <span className="text-muted-foreground/30" aria-hidden>·</span>

// The peek's whole type scale — three steps, and every size in the panel comes
// from one of them. It previously ran eight sizes between 10px and 13px, which
// is too fine a gradient to read as hierarchy: it just looked imprecise.
/** Eyebrow — the label column. */
const PEEK_EYEBROW = 'text-[10px] font-medium uppercase tracking-[0.12em]'
/** Body — anything you actually read: the head, link titles, session titles. */
const PEEK_BODY = 'text-[13px]'
/** Meta — counts, dates, durations, empty states. */
const PEEK_META = 'text-[11px]'

function PeekPanel({
  row,
  projectId,
  colorIndex,
  linked,
  onOpenDrawer,
}: {
  row: UndertakingIndexRow
  projectId: string | null
  colorIndex: number
  linked: LinkedUndertakings
  onOpenDrawer?: (key: string) => void
}) {
  const { record, tail } = row
  const answered = row.fedNotes
  const { border } = organizerSectionColorBlock(colorIndex)
  const hasHeadPreview = Boolean(record.head) && record.head !== record.title

  // Sessions lazy-load only when the peek is open — the index list omits them
  // for weight, so we fetch the collapsed chain set the same way the drawer does.
  const { view, loading } = useUndertakingDetailBlock(projectId, record.key)
  const chains = view?.chains ?? []

  return (
    // The open row has to read as a different plane from the closed rows around
    // it, not a slightly tinted continuation of them. Three things do that: a
    // recessed surface, an inset hairline at the top edge so the panel looks
    // pressed into the list, and the section's colour spine continuing down.
    <div
      className={cn(
        'ltm-animate-peek-in border-l-[3px] bg-black/[0.035] dark:bg-white/[0.035]',
        'shadow-[inset_0_1px_0_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(0,0,0,0.06)]',
        'dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(255,255,255,0.06)]',
        border,
      )}
    >
      <div className="ml-[2.25rem] mr-4 space-y-3 py-4">
        {hasHeadPreview && (
          <PeekRow label="Head">
            <p className={cn(PEEK_BODY, 'leading-relaxed text-foreground/85')}>{record.head}</p>
          </PeekRow>
        )}

        <PeekRow label="Trail">
          <div className={cn(PEEK_META, 'flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums')}>
            <span>{tail.chainCount} session{tail.chainCount === 1 ? '' : 's'}</span>
            {DOT}
            <span>{humanDuration(tail.activeDurationMs)} active</span>
            {DOT}
            <span>{tail.dayCount} day{tail.dayCount === 1 ? '' : 's'}</span>
            {tail.firstDate && (<>{DOT}<span>{tail.firstDate} → {tail.lastDate}</span></>)}
          </div>
        </PeekRow>

        {(linked.parents.length > 0 || linked.children.length > 0 || answered.length > 0) && (
          <div className="space-y-2">
            <LinkGroup label="Grew from" refs={linked.parents} onOpen={onOpenDrawer} />
            <LinkGroup label="Led to" refs={linked.children} onOpen={onOpenDrawer} />
            <LinkGroup label="Answered" refs={answered} onOpen={onOpenDrawer} muted />
          </div>
        )}

        <PeekRow label="Sessions">
          {loading && chains.length === 0 ? (
            <p className={cn(PEEK_META, 'text-muted-foreground/45')}>Loading…</p>
          ) : chains.length === 0 ? (
            <p className={cn(PEEK_META, 'italic text-muted-foreground/40')}>None filed yet.</p>
          ) : (
            <ul className="space-y-1">
              {chains.map(chain => (
                <li key={chain.chainKey} className={cn(PEEK_BODY, 'flex items-baseline gap-2')}>
                  <span className={cn(PEEK_META, 'shrink-0 font-mono tabular-nums text-muted-foreground/45')}>{chain.date}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground/75" title={chain.title}>
                    {chain.title || '(untitled session)'}
                  </span>
                  <span className={cn(PEEK_META, 'shrink-0 tabular-nums text-muted-foreground/45')}>
                    {humanDuration(chain.activeDurationMs > 0 ? chain.activeDurationMs : chain.durationMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PeekRow>

        {/* The footer action rides the content column rather than a PeekRow with
            an empty label — an eyebrow slot with nothing in it still reserved its
            width, which read as an unexplained indent. */}
        {onOpenDrawer && (
          <div className="pl-[calc(4.25rem+0.75rem)]">
            <button
              type="button"
              onClick={() => onOpenDrawer(record.key)}
              className={cn(PEEK_BODY, 'inline-flex items-center gap-1 font-medium text-foreground/65 transition-colors hover:text-foreground')}
            >
              Open details
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The peek's label/content rhythm — a fixed eyebrow column, then the content.
 *  Every group (links, sessions, the footer action) rides the same grid, so the
 *  panel reads as one aligned column rather than a stack of unrelated bits. */
function PeekRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className={cn(PEEK_EYEBROW, 'w-[4.25rem] shrink-0 select-none pt-[2px] text-muted-foreground/45')}>
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function LinkGroup({
  label,
  refs,
  onOpen,
  muted = false,
}: {
  label: string
  refs: NoteRef[]
  onOpen?: (key: string) => void
  muted?: boolean
}) {
  if (refs.length === 0) return null
  return (
    <PeekRow label={label}>
      <ul className="space-y-1">
        {refs.map(ref => (
          <li key={ref.key}>
            <button
              type="button"
              onClick={() => onOpen?.(ref.key)}
              disabled={!onOpen}
              className={cn(
                PEEK_BODY,
                'block max-w-full truncate text-left underline-offset-2 hover:underline disabled:no-underline',
                muted ? 'text-muted-foreground/70 hover:text-muted-foreground' : 'text-foreground/80 hover:text-foreground',
              )}
              title={`${ref.key} — ${ref.title}`}
            >
              {ref.title}
            </button>
          </li>
        ))}
      </ul>
    </PeekRow>
  )
}
