import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import DensitySparklineBlock from '@/components/lego_blocks/units/DensitySparklineBlock'
import { useUndertakingDetailBlock } from '@/components/lego_blocks/hooks/units/useUndertakingDetailBlock'
import { updateUndertakingHeadOrch } from '@/services/orchestrators/aiActivityUndertakingOrch'

// The page behind an index entry: the full trail. The index is the term and its
// page numbers; this is the page. Head is editable here (the design's one
// mutable field — sharpened over time). The session list is read-only for now:
// correcting which undertaking a session belongs to is a real repair path, but
// it has to reconcile two membership models (the record's chain list and the
// chain's own field) and respect multi-threading, which isn't settled yet.

interface Props {
  projectId: string
  undertakingKey: string
  onBack: () => void
}

function humanDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function fmtDate(iso: string): string {
  return iso || '—'
}

export default function UndertakingDetailBlock({ projectId, undertakingKey, onBack }: Props) {
  const { view, loading, error, reload } = useUndertakingDetailBlock(projectId, undertakingKey)

  const [headDraft, setHeadDraft] = useState('')
  const [savingHead, setSavingHead] = useState(false)

  useEffect(() => {
    if (view) setHeadDraft(view.record.head)
  }, [view?.record.key, view?.record.head])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }
  if (error || !view) {
    return (
      <div className="space-y-3">
        <BackButton onBack={onBack} />
        <div className="px-2 text-sm text-destructive">{error ?? 'Undertaking not found.'}</div>
      </div>
    )
  }

  const { record, tail, chains = [] } = view
  const headChanged = headDraft.trim() !== record.head.trim()

  const saveHead = async () => {
    setSavingHead(true)
    try {
      await updateUndertakingHeadOrch(projectId, record.key, headDraft.trim())
      reload()
    } finally {
      setSavingHead(false)
    }
  }

  const sparkBuckets = tail.density.map(d => ({
    startDate: d.date,
    endDate: d.date,
    chains: d.chains,
    activeDurationMs: d.activeDurationMs,
  }))

  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />

      <div>
        <h1 className="text-lg font-semibold tracking-tight">{record.title}</h1>
        {/* Head — the one mutable field, the line stating what came out. */}
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

      {/* Trail stats + sparkline. Active duration, not wall-clock. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{tail.chainCount} session{tail.chainCount === 1 ? '' : 's'}</span>
        <span>{humanDuration(tail.activeDurationMs)} active</span>
        <span>{tail.dayCount} day{tail.dayCount === 1 ? '' : 's'}</span>
        <span>{fmtDate(tail.firstDate)} → {fmtDate(tail.lastDate)}</span>
        <DensitySparklineBlock buckets={sparkBuckets} height={18} />
      </div>

      {(record.tags.length > 0 || record.proposedTags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {record.tags.map(tag => (
            <span key={`t-${tag}`} className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] text-foreground/80">
              {tag}
            </span>
          ))}
          {record.proposedTags.map(tag => (
            <span key={`p-${tag}`} className="rounded-full border border-dashed border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground/70" title="Proposed by Kai — not yet confirmed">
              {tag}
            </span>
          ))}
        </div>
      )}

      {tail.files.length > 0 && (
        <div>
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Pages ({tail.files.length})
          </h2>
          <ul className="space-y-0.5">
            {tail.files.map(f => (
              <li key={f} className="truncate font-mono text-xs text-foreground/70" title={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Sessions ({chains.length})
        </h2>
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
      </div>
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to index
    </button>
  )
}
