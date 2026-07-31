import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Loader2, Trash2, X } from 'lucide-react'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import { useUndertakingDetailBlock } from '@/components/lego_blocks/hooks/units/useUndertakingDetailBlock'
import {
  addUndertakingNoteOrch,
  removeUndertakingNoteOrch,
  updateUndertakingHeadOrch,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// The page behind an index entry, as a right-hand drawer — the index stays
// mounted behind it so a peek doesn't cost your place in the scan. Shell copied
// from the old NodeDetailPanelBlock (portal + backdrop + slide-in panel); the
// content is the undertaking's head (editable), its derived tail, and the notes
// thread — Anurag's margin annotations, stored in the body, not YAML.

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

  const [headDraft, setHeadDraft] = useState('')
  const [savingHead, setSavingHead] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [removingIndex, setRemovingIndex] = useState<number | null>(null)

  useEffect(() => {
    if (view) setHeadDraft(view.record.head)
  }, [view?.record.key, view?.record.head])

  // Esc closes, matching every other slide-over in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const record = view?.record
  const tail = view?.tail
  const chains = view?.chains ?? []
  const headChanged = Boolean(record) && headDraft.trim() !== record!.head.trim()

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

  const addNote = async () => {
    if (!record || !noteDraft.trim()) return
    setAddingNote(true)
    try {
      await addUndertakingNoteOrch(projectId, record.key, noteDraft.trim())
      setNoteDraft('')
      reload()
    } finally {
      setAddingNote(false)
    }
  }

  const removeNote = async (index: number) => {
    if (!record) return
    setRemovingIndex(index)
    try {
      await removeUndertakingNoteOrch(projectId, record.key, index)
      reload()
    } finally {
      setRemovingIndex(null)
    }
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
              <div>
                <h1 className="text-lg font-semibold leading-snug tracking-tight">{record.title}</h1>
                {/* Head — the one mutable field: what came out, in one line. */}
                <div className="mt-2 flex flex-col gap-1.5">
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
              </div>

              {/* Derived tail — active duration, not wall-clock. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{tail.chainCount} session{tail.chainCount === 1 ? '' : 's'}</span>
                <span>{humanDuration(tail.activeDurationMs)} active</span>
                <span>{tail.dayCount} day{tail.dayCount === 1 ? '' : 's'}</span>
                <span>{tail.firstDate || '—'} → {tail.lastDate || '—'}</span>
                <DensitySparklineBlock buckets={sparkBuckets} height={18} />
              </div>

              {record.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {record.tags.map(tag => (
                    <span key={tag} className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] text-foreground/80">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {tail.files.length > 0 && (
                <Section title={`Pages (${tail.files.length})`}>
                  <ul className="space-y-0.5">
                    {tail.files.map(f => (
                      <li key={f} className="truncate font-mono text-xs text-foreground/70" title={f}>{f}</li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Notes — the annotation thread, stored in the body. */}
              <Section title="Notes">
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
                      disabled={addingNote || !noteDraft.trim()}
                      className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {addingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
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
              </Section>

              <Section title={`Sessions (${chains.length})`}>
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
              </Section>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      {children}
    </div>
  )
}
