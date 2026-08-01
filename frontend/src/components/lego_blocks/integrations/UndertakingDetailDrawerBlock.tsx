import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, Loader2, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DRAWER_HEADER_BUTTON,
  DRAWER_INPUT,
  DRAWER_SELECT,
  DrawerShellBlock,
  Field,
  FieldHeading,
  FIELD_SURFACE,
  GrowTextarea,
  LinkTitle,
  NoteAvatar,
  PRIMARY_BUTTON,
  RailLabel,
  ReverseLinks,
  SelectShell,
} from '@/components/lego_blocks/units/OrganizerDrawerChromeBlock'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import VaultPageListBlock from '@/components/lego_blocks/units/VaultPageListBlock'
import { bucketDensityBlock } from '@/services/lego_blocks/units/aiActivityDensityBlock'
import { useUndertakingDetailBlock } from '@/components/lego_blocks/hooks/units/useUndertakingDetailBlock'
import {
  addUndertakingNoteOrch,
  getUndertakingLinksOrch,
  listUndertakingSectionsOrch,
  listUndertakingTitlesOrch,
  removeUndertakingNoteOrch,
  tagUndertakingOrch,
  updateUndertakingFieldsOrch,
  updateUndertakingHeadOrch,
  type UndertakingLinks,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// The page behind an index entry, as a right-hand drawer — the index stays
// mounted behind it. Everything an undertaking carries that is Anurag's judgment
// is editable here: title, section, tags, the head, its grew_out_of edges, and
// the notes thread. The derived tail (sessions, density, pointers) is read-only
// by construction — it's re-derived from chains, never stored here.

interface Props {
  projectId: string
  undertakingKey: string
  /** Swap the drawer to another undertaking — how the relationship links
   *  navigate. Without it they render as plain text. */
  onOpen?: (key: string) => void
  onClose: () => void
}

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

export default function UndertakingDetailDrawerBlock({ projectId, undertakingKey, onOpen, onClose }: Props) {
  const { view, loading, error, reload } = useUndertakingDetailBlock(projectId, undertakingKey)
  const navigate = useNavigate()

  const [titleDraft, setTitleDraft] = useState('')
  const [headDraft, setHeadDraft] = useState('')
  const [savingHead, setSavingHead] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [removingIndex, setRemovingIndex] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const [sections, setSections] = useState<Array<{ key: string; title: string }>>([])
  const [allTitles, setAllTitles] = useState<Array<{ key: string; title: string }>>([])
  // The edges pointing *at* this undertaking. They aren't on the record — they
  // are the reverse of edges other records own — so they have to be resolved
  // separately, and re-resolved after an edit that could have changed one.
  const [links, setLinks] = useState<UndertakingLinks>({
    ledTo: [], answered: [], fedBy: [], produced: [],
  })

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

  // Keyed on `view` rather than the key alone: `reload()` hands back a fresh
  // view after every edit, and an edit here can be the very thing that changes
  // what points at this row.
  useEffect(() => {
    let cancelled = false
    void getUndertakingLinksOrch(projectId, undertakingKey).then(next => {
      if (!cancelled) setLinks(next)
    })
    return () => { cancelled = true }
  }, [projectId, undertakingKey, view])

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

  // The drawer as markdown — headed by the outcome, then the evidence, then the
  // graph, then the notes. Same order the panel reads in, so what lands in the
  // paste is recognisably the thing that was on screen.
  const copyMarkdown = async () => {
    if (!record || !tail) return
    const lines: string[] = [`# ${record.title || record.key}`, '']
    if (record.head) lines.push(record.head, '')
    lines.push(
      `- **Section:** ${record.section || '(unfiled)'}`,
      `- **Trail:** ${humanDuration(tail.activeDurationMs)} active · ` +
        `${tail.chainCount} session${tail.chainCount === 1 ? '' : 's'} · ` +
        `${tail.dayCount} day${tail.dayCount === 1 ? '' : 's'}` +
        (tail.firstDate ? ` · ${tail.firstDate}${tail.lastDate !== tail.firstDate ? ` → ${tail.lastDate}` : ''}` : ''),
    )
    if (record.tags.length) lines.push(`- **Tags:** ${record.tags.join(', ')}`)

    const edgeLine = (label: string, refs: Array<{ key: string; title: string }>) => {
      if (refs.length) lines.push(`- **${label}:** ${refs.map(r => r.title).join('; ')}`)
    }
    edgeLine('Grew out of', record.grewOutOf.map(k => ({ key: k, title: titleByKey.get(k) ?? k })))
    edgeLine('Led to', links.ledTo)
    edgeLine('Fed by', links.fedBy)
    edgeLine('Answered', links.answered)
    edgeLine('Produced', links.produced)

    if (chains.length) {
      lines.push('', '## Sessions', '')
      for (const chain of chains) {
        lines.push(
          `- ${chain.date} — ${chain.title || '(untitled session)'} ` +
            `(${humanDuration(chain.activeDurationMs > 0 ? chain.activeDurationMs : chain.durationMs)})`,
        )
      }
    }
    if (record.notes.length) {
      lines.push('', '## Notes', '')
      for (const note of record.notes) {
        const by = [note.date, note.author].filter(Boolean).join(' · ')
        lines.push(`- ${by ? `${by} — ` : ''}${note.text}`)
      }
    }

    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const dateRange = !tail?.firstDate
    ? null
    : tail.firstDate === tail.lastDate
      ? tail.firstDate
      : `${tail.firstDate} → ${tail.lastDate}`

  return (
    <DrawerShellBlock
      eyebrow="Undertaking"
      onClose={onClose}
      actions={
        // Copies the whole undertaking as markdown, not just the title — the
        // drawer is where you come to have the full picture, and taking it
        // somewhere else meant hand-assembling it from six separate selections.
        record && tail ? (
          <button
            type="button"
            onClick={copyMarkdown}
            className={DRAWER_HEADER_BUTTON}
            title="Copy this undertaking as markdown"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : undefined
      }
    >
      <>
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

                    {/* Always rendered, even empty. Hiding the block on an
                        empty list made a captured gap look like a settled fact:
                        an undertaking that wrote five vault pages read as one
                        that produced nothing, and nothing on screen invited the
                        question. A gap should look like a gap. */}
                    <div className="mt-6">
                      <RailLabel>Pages</RailLabel>
                      {tail.files.length > 0 ? (
                        <VaultPageListBlock files={tail.files} className="mt-1.5" />
                      ) : (
                        <p className="mt-2 text-[11px] text-muted-foreground/55">
                          No file provenance captured.
                        </p>
                      )}
                    </div>
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
                          <li key={chain.chainKey}>
                            {/* A session row looked like a link and did
                                nothing. It opens the chain digest — the written
                                record of that session, its title, summary and
                                the files it touched. */}
                            <button
                              type="button"
                              onClick={() => navigate(`/thinking-space?file=${encodeURIComponent(chain.path)}`)}
                              className="flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
                              title={chain.path}
                            >
                              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/50">
                                {chain.date}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">
                                {chain.title || '(untitled session)'}
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">
                                {humanDuration(chain.activeDurationMs > 0 ? chain.activeDurationMs : chain.durationMs)}
                              </span>
                            </button>
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
                            <LinkTitle
                              title={titleByKey.get(key) ?? key}
                              linkKey={key}
                              onOpen={onOpen}
                            />
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

                  {/* The rest of the graph. `grewOutOf` above is the only edge
                      this record owns; everything here is either another record
                      naming it or a note edge, so the drawer has to be handed
                      them — without them it showed a strictly poorer
                      relationship picture than the one-line peek behind it.
                      Read-only by construction: you edit an edge from the end
                      that owns it.

                      Fed by and Answered are both note edges but not the same
                      fact: a Question migrates out of its section to sit under
                      the doing that answered it, while a standing note (an
                      idea, a thesis, a lesson) keeps its own row and merely
                      fed this one. Collapsing them would claim this undertaking
                      closed something it only drew on. */}
                  <ReverseLinks label="Led to" refs={links.ledTo} onOpen={onOpen} />
                  <ReverseLinks label="Fed by" refs={links.fedBy} muted />
                  <ReverseLinks label="Answered" refs={links.answered} muted />
                  <ReverseLinks label="Produced" refs={links.produced} muted />
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
      </>
    </DrawerShellBlock>
  )
}
