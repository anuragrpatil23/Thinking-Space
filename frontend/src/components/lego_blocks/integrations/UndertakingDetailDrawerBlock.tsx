import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, Loader2, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import { bucketDensityBlock } from '@/services/lego_blocks/units/aiActivityDensityBlock'
import { useUndertakingDetailBlock } from '@/components/lego_blocks/hooks/units/useUndertakingDetailBlock'
import {
  addUndertakingNoteOrch,
  listUndertakingSectionsOrch,
  listUndertakingTitlesOrch,
  removeUndertakingNoteOrch,
  tagUndertakingOrch,
  updateUndertakingFieldsOrch,
  updateUndertakingHeadOrch,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// The page behind an index entry, as a right-hand drawer — the index stays
// mounted behind it. Everything an undertaking carries that is Anurag's judgment
// is editable here: title, section, tags, the head, its grew_out_of edges, and
// the notes thread. The derived tail (sessions, density, pointers) is read-only
// by construction — it's re-derived from chains, never stored here.

interface Props {
  projectId: string
  undertakingKey: string
  onClose: () => void
}

// The drawer speaks the home canvas's panel language (useCanvasThemeBlock's
// anchor panel: 14px radius, a translucent fill, a near-invisible 0.06 border,
// one soft ambient shadow). Two rules carry it:
//
//   1. No box inside a box. The drawer *is* the panel. Groups are separated by
//      space and a hairline, never by another bordered card — the old drawer's
//      nested-card look is exactly what this replaces.
//   2. Controls are recessed, not outlined. A field reads as a soft well in the
//      panel surface rather than a boxed form input, so the eye follows content
//      instead of counting borders.

/** A recessed field surface — the well. */
const FIELD_SURFACE =
  'rounded-[10px] border border-black/[0.06] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03]'
/** Text inputs and textareas. */
const DRAWER_INPUT = cn(
  FIELD_SURFACE,
  'w-full px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50',
  'focus:border-black/[0.12] focus:bg-black/[0.035] dark:focus:border-white/[0.14] dark:focus:bg-white/[0.05]',
  'disabled:opacity-60',
)
/** Selects — `appearance-none` kills the OS chevron, which was the loudest
 *  unfinished tell in the drawer; ChevronDown is drawn over it instead. */
const DRAWER_SELECT = cn(DRAWER_INPUT, 'cursor-pointer appearance-none pr-9')
/** The one filled action in the drawer. Everything else is quiet by design. */
const PRIMARY_BUTTON =
  'inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40'
/** Buckets in the rail's density strip. Wider than the index's 24 because the
 *  rail strip is the only place you see one undertaking's shape on its own. */
const DRAWER_SPARKLINE_BUCKETS = 40

function humanDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

export default function UndertakingDetailDrawerBlock({ projectId, undertakingKey, onClose }: Props) {
  const { view, loading, error, reload } = useUndertakingDetailBlock(projectId, undertakingKey)

  const [titleDraft, setTitleDraft] = useState('')
  const [headDraft, setHeadDraft] = useState('')
  const [savingHead, setSavingHead] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [removingIndex, setRemovingIndex] = useState<number | null>(null)

  const [sections, setSections] = useState<Array<{ key: string; title: string }>>([])
  const [allTitles, setAllTitles] = useState<Array<{ key: string; title: string }>>([])

  const record = view?.record
  const tail = view?.tail
  const chains = view?.chains ?? []

  useEffect(() => {
    if (record) {
      setTitleDraft(record.title)
      setHeadDraft(record.head)
    }
  }, [record?.key, record?.title, record?.head])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listUndertakingSectionsOrch(projectId),
      listUndertakingTitlesOrch(projectId),
    ]).then(([secs, titles]) => {
      if (cancelled) return
      setSections(secs)
      setAllTitles(titles)
    })
    return () => { cancelled = true }
  }, [projectId])

  // Esc closes, matching every other slide-over in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const titleByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of allTitles) m.set(t.key, t.title)
    return m
  }, [allTitles])

  // Undertakings that could be a new grew_out_of parent — everything but this
  // one and the ones already linked.
  const linkCandidates = useMemo(() => {
    if (!record) return []
    const taken = new Set([record.key, ...record.grewOutOf])
    return allTitles.filter(t => !taken.has(t.key))
  }, [allTitles, record])

  const headChanged = Boolean(record) && headDraft.trim() !== record!.head.trim()

  // Every field write funnels through here: run it, then reload so the derived
  // tail and the index behind the drawer both reflect the change.
  const runEdit = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); reload() } finally { setBusy(false) }
  }

  const saveHead = async () => {
    if (!record) return
    setSavingHead(true)
    try {
      await updateUndertakingHeadOrch(projectId, record.key, headDraft.trim())
      reload()
    } finally {
      setSavingHead(false)
    }
  }

  const saveTitle = () => {
    if (!record) return
    const next = titleDraft.trim()
    if (!next || next === record.title) { setTitleDraft(record.title); return }
    void runEdit(() => updateUndertakingFieldsOrch(projectId, record.key, { title: next }))
  }

  const changeSection = (section: string) => {
    if (!record || section === record.section) return
    void runEdit(() => updateUndertakingFieldsOrch(projectId, record.key, { section }))
  }

  const addTag = () => {
    if (!record || !tagDraft.trim()) return
    const value = tagDraft.trim()
    setTagDraft('')
    void runEdit(() => tagUndertakingOrch(projectId, record.key, { add: [value], allowNew: true }))
  }

  const removeTag = (tag: string) => {
    if (!record) return
    void runEdit(() => tagUndertakingOrch(projectId, record.key, { remove: [tag] }))
  }

  const addParent = (key: string) => {
    if (!record || !key) return
    void runEdit(() => updateUndertakingFieldsOrch(projectId, record.key, { grewOutOf: [...record.grewOutOf, key] }))
  }

  const removeParent = (key: string) => {
    if (!record) return
    void runEdit(() => updateUndertakingFieldsOrch(projectId, record.key, { grewOutOf: record.grewOutOf.filter(k => k !== key) }))
  }

  const addNote = async () => {
    if (!record || !noteDraft.trim()) return
    setBusy(true)
    try {
      await addUndertakingNoteOrch(projectId, record.key, noteDraft.trim())
      setNoteDraft('')
      reload()
    } finally { setBusy(false) }
  }

  const removeNote = async (index: number) => {
    if (!record) return
    setRemovingIndex(index)
    try {
      await removeUndertakingNoteOrch(projectId, record.key, index)
      reload()
    } finally { setRemovingIndex(null) }
  }

  // The density strip has to span a *window*, not the worked days. Mapping
  // `tail.density` straight through gave one bucket per worked day, so a
  // single-day undertaking rendered as a lone tick and a three-day one as three
  // fat bars with no sense of whether those days were a week or a year apart.
  // Bucketing across first→last puts the bars where the calendar puts them.
  const sparkBuckets = useMemo(() => {
    if (!tail?.firstDate || !tail.lastDate) return []
    return bucketDensityBlock(tail.density, {
      from: tail.firstDate,
      to: tail.lastDate,
      buckets: DRAWER_SPARKLINE_BUCKETS,
    })
  }, [tail?.firstDate, tail?.lastDate, tail?.density])

  const dateRange = !tail?.firstDate
    ? null
    : tail.firstDate === tail.lastDate
      ? tail.firstDate
      : `${tail.firstDate} → ${tail.lastDate}`

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[120] bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-[121] w-[min(96vw,58rem)] overflow-auto border-l border-black/[0.06] bg-background pt-[max(env(safe-area-inset-top),3.5rem)] shadow-[0_8px_40px_rgba(20,20,24,0.14)] animate-slide-in dark:border-white/[0.06] sm:pt-0">
        {/* The canvas panel's own padding (20px), with the content measure held
            in from the panel edge so the wider drawer reads as air rather than
            a stretched form. */}
        <div className="mx-auto flex max-w-[52rem] flex-col gap-5 p-5 sm:p-7">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Undertaking
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {!loading && (error || !record || !tail) && (
            <div className="text-sm text-destructive">{error ?? 'Undertaking not found.'}</div>
          )}

          {!loading && record && tail && (
            <>
              {/* Title — editable, saved on blur / ⌘↵. Reads as the drawer's
                  heading until you touch it: the edit affordance is a hover/focus
                  surface rather than a permanent input box. */}
              <GrowTextarea
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur() }
                }}
                aria-label="Undertaking title"
                className="-mx-2 w-[calc(100%+1rem)] rounded-lg bg-transparent px-2 py-1 text-[1.6rem] font-semibold leading-[1.25] tracking-[-0.015em] outline-none transition-colors hover:bg-black/[0.03] focus:bg-black/[0.03] dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.04]"
              />

              {/* "Head" is the internal field name; what it holds is the
                  one-line result of the undertaking, so that is what the label
                  says. Boxing it made the drawer open on a form control — it
                  reads as the standfirst under the title instead, with the same
                  hover/focus tint the title uses to say it is editable. It gets
                  the full panel width: it is the answer to "what was this", and
                  it was previously squeezed into a two-thirds column. */}
              <Field label="Outcome">
                <div className="flex flex-col gap-2">
                  <GrowTextarea
                    value={headDraft}
                    onChange={e => setHeadDraft(e.target.value)}
                    placeholder="What came out of this — one line…"
                    aria-label="Outcome"
                    className="-mx-2 w-[calc(100%+1rem)] rounded-lg bg-transparent px-2 py-1 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-black/[0.03] focus:bg-black/[0.03] dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.04]"
                  />
                  {headChanged && (
                    <button
                      type="button"
                      onClick={() => void saveHead()}
                      disabled={savingHead}
                      className={cn(PRIMARY_BUTTON, 'w-fit')}
                    >
                      {savingHead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Save outcome
                    </button>
                  )}
                </div>
              </Field>

              {/* The trail and the sessions are the same fact at two
                  resolutions — the summary figure and the entries it was
                  summed from — so they sit side by side with a rule between
                  them rather than stacked as unrelated blocks. */}
              <section className="border-t border-black/[0.06] pt-6 dark:border-white/[0.06]">
                <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <FieldHeading label="Trail" />
                    {/* Led by the one figure that actually varies — how much
                        work went in — with everything else as one supporting
                        line. Five label/value rows gave "Days 1" the same
                        weight as "Active 6h 20m", so the block read as a table
                        of five equally unimportant numbers instead of a fact
                        with context. */}
                    <p className="flex items-baseline gap-1.5">
                      <span className="text-[1.75rem] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                        {tail.activeDurationMs > 0 ? humanDuration(tail.activeDurationMs) : '—'}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">active</span>
                    </p>
                    <p className="mt-2.5 text-[12px] text-muted-foreground/75">
                      {tail.chainCount} session{tail.chainCount === 1 ? '' : 's'}
                      <span className="px-1 text-muted-foreground/40">·</span>
                      {tail.dayCount} day{tail.dayCount === 1 ? '' : 's'}
                    </p>
                    {dateRange && (
                      <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground/60">{dateRange}</p>
                    )}
                    {/* A one-bucket strip is a tick with no information in it,
                        so the strip only appears once there is a span to show. */}
                    {tail.dayCount > 1 && sparkBuckets.length > 0 && (
                      <DensitySparklineBlock buckets={sparkBuckets} height={24} barWidth={5} className="mt-4" />
                    )}

                    {tail.files.length > 0 && (
                      <div className="mt-6">
                        <RailLabel>Pages</RailLabel>
                        <ul className="mt-2 space-y-1">
                          {tail.files.map(f => (
                            <li key={f} className="truncate font-mono text-[11px] text-muted-foreground/70" title={f}>
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 lg:border-l lg:border-black/[0.06] lg:pl-10 dark:lg:border-white/[0.06]">
                    <FieldHeading
                      label="Sessions"
                      action={
                        chains.length > 0 ? (
                          <span className="text-xs tabular-nums text-muted-foreground/70">{chains.length}</span>
                        ) : undefined
                      }
                    />
                    {chains.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground/55">No sessions filed here yet.</p>
                    ) : (
                      <ol className="-mx-2">
                        {chains.map(chain => (
                          <li
                            key={chain.chainKey}
                            className="flex items-baseline gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                          >
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/50">
                              {chain.date}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85" title={chain.title}>
                              {chain.title || '(untitled session)'}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">
                              {humanDuration(chain.activeDurationMs > 0 ? chain.activeDurationMs : chain.durationMs)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </section>

              {/* Everything that says where this undertaking sits relative to
                  the rest of them — the section it files under, the tags it
                  shares, and the undertakings it came out of. They were three
                  separate rail blocks; they are one question. */}
              <Field label="Relationships">
                <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
                  <div className="min-w-0">
                    <RailLabel>Section</RailLabel>
                    <SelectShell className="mt-2">
                      <select
                        value={record.section}
                        onChange={e => changeSection(e.target.value)}
                        disabled={busy}
                        className={DRAWER_SELECT}
                      >
                        {sections.every(s => s.key !== record.section) && (
                          <option value={record.section}>{record.section || '(unfiled)'}</option>
                        )}
                        {sections.map(s => (
                          <option key={s.key} value={s.key}>{s.title}</option>
                        ))}
                      </select>
                    </SelectShell>
                  </div>

                  <div className="min-w-0">
                    <RailLabel>Tags</RailLabel>
                    {record.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {record.tags.map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 rounded-full border border-black/[0.07] bg-black/[0.03] py-1 pl-2.5 pr-1.5 text-[11px] text-foreground/80 dark:border-white/[0.08] dark:bg-white/[0.05]"
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => removeTag(tag)}
                              disabled={busy}
                              className="rounded-full text-muted-foreground/50 transition-colors hover:text-destructive"
                              aria-label={`Remove ${tag}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      <input
                        value={tagDraft}
                        onChange={e => setTagDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                        placeholder="Add a tag…"
                        className={cn(DRAWER_INPUT, 'min-w-0 flex-1 px-2.5 py-1.5 text-[13px]')}
                      />
                      <button
                        type="button"
                        onClick={addTag}
                        disabled={busy || !tagDraft.trim()}
                        className={cn(FIELD_SURFACE, 'inline-flex shrink-0 items-center justify-center p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40')}
                        aria-label="Add tag"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <RailLabel>Grew out of</RailLabel>
                    {record.grewOutOf.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {record.grewOutOf.map(key => (
                          <li key={key} className="group flex items-start gap-1.5 text-[13px]">
                            <span className="min-w-0 flex-1 leading-snug text-foreground/80" title={key}>
                              {titleByKey.get(key) ?? key}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeParent(key)}
                              disabled={busy}
                              className="mt-0.5 shrink-0 text-transparent transition-colors hover:!text-destructive group-hover:text-muted-foreground/50"
                              aria-label="Remove link"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {linkCandidates.length > 0 && (
                      <SelectShell className="mt-2">
                        <select
                          value=""
                          onChange={e => { addParent(e.target.value); e.currentTarget.value = '' }}
                          disabled={busy}
                          className={cn(DRAWER_SELECT, 'text-muted-foreground')}
                        >
                          <option value="">Link an undertaking…</option>
                          {linkCandidates.map(c => (
                            <option key={c.key} value={c.key}>{c.title}</option>
                          ))}
                        </select>
                      </SelectShell>
                    )}
                  </div>
                </div>
              </Field>

              {/* Notes live below the two columns, across the full panel. In
                  the reading column they were a narrow box wedged between the
                  outcome and the sessions while the bottom half of the drawer
                  sat empty — and notes are the one thing here you compose at
                  length, so they get the width and the room. The thread itself
                  reads as one: an authored entry with an avatar and a date. */}
              <Field
                label="Notes"
                action={
                  record.notes.length > 0 ? (
                    <span className="text-xs tabular-nums text-muted-foreground/70">
                      {record.notes.length}
                    </span>
                  ) : undefined
                }
              >
                {/* One composer object: the writing surface and its actions
                    share a single well, divided by a hairline, rather than a
                    cramped box with controls floating under it. The avatar
                    moves out of the left gutter and into the footer bar — the
                    note you are writing should be the widest thing on the page,
                    and the attribution still has to be visible, because an
                    agent writing through the CLI files notes into this same
                    thread under its own name. */}
                <div
                  className={cn(
                    FIELD_SURFACE,
                    'overflow-hidden transition-colors',
                    'focus-within:border-black/[0.12] focus-within:bg-black/[0.035]',
                    'dark:focus-within:border-white/[0.14] dark:focus-within:bg-white/[0.05]',
                  )}
                >
                  <textarea
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote() }
                    }}
                    rows={5}
                    placeholder="Add a note…"
                    aria-label="Add a note"
                    className="block w-full resize-y bg-transparent px-3.5 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50"
                  />
                  <div className="flex items-center justify-between gap-2 border-t border-black/[0.05] px-3 py-2 dark:border-white/[0.06]">
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                      <NoteAvatar author={null} size="sm" />
                      Adding as <span className="font-medium text-foreground/75">You</span>
                      <span className="text-muted-foreground/40">·</span>
                      ⌘↵ to add
                    </span>
                    <button
                      type="button"
                      onClick={() => void addNote()}
                      disabled={busy || !noteDraft.trim()}
                      className={PRIMARY_BUTTON}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Add note
                    </button>
                  </div>
                </div>

                {record.notes.length === 0 ? (
                  <p className="mt-4 text-[13px] text-muted-foreground/55">
                    Nothing noted yet.
                  </p>
                ) : (
                  <ol className="mt-6 space-y-5">
                    {record.notes.map((note, index) => (
                      <li key={`${note.date}-${index}`} className="group flex items-start gap-3">
                        <NoteAvatar author={note.author} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline gap-2 text-[12px] leading-none">
                            <span className="font-medium text-foreground/85">{note.author || 'You'}</span>
                            <span className="tabular-nums text-muted-foreground/55">{note.date || 'undated'}</span>
                          </p>
                          <div className="prose prose-sm mt-1.5 max-w-none leading-relaxed dark:prose-invert prose-p:my-0">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.text}</ReactMarkdown>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeNote(index)}
                          disabled={removingIndex === index}
                          className="-mr-1 shrink-0 rounded-md p-1.5 text-transparent transition-colors hover:bg-black/[0.04] hover:!text-destructive focus-visible:text-muted-foreground/60 group-hover:text-muted-foreground/50 dark:hover:bg-white/[0.05]"
                          aria-label="Delete note"
                        >
                          {removingIndex === index
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </Field>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

/** The initials disc on a note. Colour is derived from the author string so the
 *  same author is always the same colour, and unattributed notes ("You") share
 *  one neutral slot. */
const NOTE_AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-cyan-600',
]

function NoteAvatar({ author, size = 'md' }: { author: string | null; size?: 'sm' | 'md' }) {
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

/** A textarea that grows to fit its content. Both the title and the head were
 *  fixed at `rows={2}`, which clipped longer text mid-sentence — the head in
 *  particular is a paragraph and was being cut off with no way to see the rest. */
function GrowTextarea({
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
function SelectShell({ className, children }: { className?: string; children: React.ReactNode }) {
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
function RailLabel({ children }: { children: React.ReactNode }) {
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
function Field({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
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
function FieldHeading({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground/70">{label}</h2>
      {action}
    </div>
  )
}
