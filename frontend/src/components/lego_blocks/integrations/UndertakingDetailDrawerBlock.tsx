import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
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

  const sparkBuckets = (tail?.density ?? []).map(d => ({
    startDate: d.date,
    endDate: d.date,
    chains: d.chains,
    activeDurationMs: d.activeDurationMs,
  }))

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[120] bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-[121] w-[min(94vw,40rem)] overflow-auto border-l border-border/60 bg-background pt-[max(env(safe-area-inset-top),3.5rem)] shadow-2xl animate-slide-in sm:pt-0">
        <div className="flex flex-col gap-5 p-5">
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
              {/* Title — editable, saved on blur / ⌘↵. */}
              <textarea
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur() }
                }}
                rows={2}
                className="w-full resize-none border-b border-border/50 bg-transparent pb-1 text-lg font-semibold leading-snug tracking-tight outline-none transition-colors focus:border-ring"
              />

              {/* Section re-file. */}
              <Field label="Section">
                <select
                  value={record.section}
                  onChange={e => changeSection(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring disabled:opacity-60"
                >
                  {sections.every(s => s.key !== record.section) && (
                    <option value={record.section}>{record.section || '(unfiled)'}</option>
                  )}
                  {sections.map(s => (
                    <option key={s.key} value={s.key}>{s.title}</option>
                  ))}
                </select>
              </Field>

              {/* Head — the one line stating what came out. */}
              <Field label="Head">
                <div className="flex flex-col gap-1.5">
                  <textarea
                    value={headDraft}
                    onChange={e => setHeadDraft(e.target.value)}
                    rows={2}
                    placeholder="What came out — one line…"
                    className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
                  />
                  {headChanged && (
                    <button
                      type="button"
                      onClick={() => void saveHead()}
                      disabled={savingHead}
                      className="inline-flex w-fit items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {savingHead ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Save head
                    </button>
                  )}
                </div>
              </Field>

              {/* Derived tail — active duration, not wall-clock. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{tail.chainCount} session{tail.chainCount === 1 ? '' : 's'}</span>
                <span>{humanDuration(tail.activeDurationMs)} active</span>
                <span>{tail.dayCount} day{tail.dayCount === 1 ? '' : 's'}</span>
                <span>{tail.firstDate || '—'} → {tail.lastDate || '—'}</span>
                <DensitySparklineBlock buckets={sparkBuckets} height={18} />
              </div>

              {/* Tags — add / remove. */}
              <Field label="Tags">
                <div className="flex flex-wrap items-center gap-1.5">
                  {record.tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] text-foreground/80">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} disabled={busy} className="text-muted-foreground/60 hover:text-destructive" aria-label={`Remove ${tag}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {record.tags.length === 0 && <span className="text-[11px] text-muted-foreground/50">No tags yet.</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    value={tagDraft}
                    onChange={e => setTagDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                    placeholder="Add a tag…"
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[13px] outline-none focus:border-ring"
                  />
                  <button type="button" onClick={addTag} disabled={busy || !tagDraft.trim()} className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
              </Field>

              {/* Grew out of — the causal edges, editable. */}
              <Field label="Grew out of">
                <ul className="space-y-1">
                  {record.grewOutOf.map(key => (
                    <li key={key} className="flex items-center gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-foreground/80" title={key}>{titleByKey.get(key) ?? key}</span>
                      <button type="button" onClick={() => removeParent(key)} disabled={busy} className="shrink-0 text-muted-foreground/60 hover:text-destructive" aria-label="Remove link">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {record.grewOutOf.length === 0 && <li className="text-[11px] text-muted-foreground/50">No links yet.</li>}
                </ul>
                {linkCandidates.length > 0 && (
                  <select
                    value=""
                    onChange={e => { addParent(e.target.value); e.currentTarget.value = '' }}
                    disabled={busy}
                    className="mt-1.5 w-full rounded-md border border-input bg-background px-2 py-1.5 text-[13px] text-muted-foreground outline-none focus:border-ring disabled:opacity-60"
                  >
                    <option value="">Link an undertaking…</option>
                    {linkCandidates.map(c => (
                      <option key={c.key} value={c.key}>{c.title}</option>
                    ))}
                  </select>
                )}
              </Field>

              {tail.files.length > 0 && (
                <Field label={`Pages (${tail.files.length})`}>
                  <ul className="space-y-0.5">
                    {tail.files.map(f => (
                      <li key={f} className="truncate font-mono text-xs text-foreground/70" title={f}>{f}</li>
                    ))}
                  </ul>
                </Field>
              )}

              {/* Notes — the annotation thread, stored in the body. */}
              <Field label="Notes">
                <div className="rounded-md border border-border/70 bg-card p-2.5">
                  <textarea
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addNote() }
                    }}
                    placeholder="Add a note…"
                    className="min-h-[64px] w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">⌘↵ to add</span>
                    <button
                      type="button"
                      onClick={() => void addNote()}
                      disabled={busy || !noteDraft.trim()}
                      className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Add note
                    </button>
                  </div>
                </div>

                {record.notes.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {record.notes.map((note, index) => (
                      <div key={`${note.date}-${index}`} className="group flex items-start gap-2">
                        <div className="flex-1 space-y-0.5">
                          <p className="text-[11px] text-muted-foreground">
                            {note.date || 'undated'}{note.author ? ` · ${note.author}` : ''}
                          </p>
                          <div className="prose prose-sm max-w-none leading-relaxed dark:prose-invert">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.text}</ReactMarkdown>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeNote(index)}
                          disabled={removingIndex === index}
                          className="rounded p-1 text-muted-foreground/0 transition-colors hover:!text-destructive group-hover:text-muted-foreground/60"
                          aria-label="Delete note"
                        >
                          {removingIndex === index
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>

              <Field label={`Sessions (${chains.length})`}>
                <div className="space-y-1">
                  {chains.map(chain => (
                    <div key={chain.chainKey} className="rounded-md px-2 py-1.5 hover:bg-accent/40">
                      <div className="truncate text-sm text-foreground" title={chain.title}>{chain.title || '(untitled session)'}</div>
                      <div className="text-[11px] text-muted-foreground/70">
                        {chain.date} · {humanDuration(chain.activeDurationMs > 0 ? chain.activeDurationMs : chain.durationMs)} active
                      </div>
                    </div>
                  ))}
                  {chains.length === 0 && (
                    <p className="px-2 py-2 text-xs text-muted-foreground/60">No sessions filed under this undertaking yet.</p>
                  )}
                </div>
              </Field>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</h2>
      {children}
    </div>
  )
}
