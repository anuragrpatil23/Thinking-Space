import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityChain, ActivitySource } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { editGoodnotesReadingRecord } from '@/services/lego_blocks/integrations/goodnotesReadingBlock'
import { editThinkingspaceReadingRecord } from '@/services/lego_blocks/integrations/thinkingspaceReadingBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'

// Same-source same-doc rows that overlap the edited window with this much
// grace on each side will be absorbed on save. Mirrors the backend constants
// in goodnotesReadingBlock.ts / thinkingspaceReadingBlock.ts so the live
// preview matches what actually happens.
const ABSORB_GRACE_MS = 5 * 60_000

interface Props {
  /** Chain being edited (one row in the day table). */
  chain: ActivityChain
  /** Every chain visible in the current day drill — used to compute the live
   *  "absorbs N records" preview. Caller passes the same array it renders. */
  dayChains: ActivityChain[]
  onClose: () => void
  /** Called after a successful save; the caller refreshes the activity data. */
  onSaved: (info: { absorbed: number }) => void
}

/** Format an epoch-ms timestamp for an <input type="datetime-local">. The
 *  input element expects "YYYY-MM-DDTHH:MM" in *local* time without TZ. */
function msToLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToMs(s: string): number | null {
  if (!s) return null
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : null
}

function fmtDurationMs(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Pick the most-recent underlying session in a chain. For reading chains
 *  this is the one our edit IPC targets — extending it absorbs the earlier
 *  fragments rather than the other way around. */
function pickTargetSession(chain: ActivityChain) {
  return [...chain.sessions].sort(
    (a, b) => Date.parse(b.startedIso) - Date.parse(a.startedIso),
  )[0] ?? chain.sessions[0]
}

/** Count chains in the day that would be absorbed if the user saved with
 *  [startMs, endMs]. Approximate — uses chain.project as a stand-in for
 *  documentId/filePath since same-doc records share a cleaned project name.
 *  The backend re-checks against the true id, so this preview can only
 *  over-count slightly (e.g. two different books with identical titles). */
function countAbsorbedChains(
  target: ActivityChain,
  startMs: number,
  endMs: number,
  dayChains: ActivityChain[],
): number {
  const winStart = startMs - ABSORB_GRACE_MS
  const winEnd = endMs + ABSORB_GRACE_MS
  let n = 0
  for (const c of dayChains) {
    if (c.key === target.key) continue
    if (c.source !== target.source) continue
    if (c.project !== target.project) continue
    const s = Date.parse(c.startedIso)
    const e = Date.parse(c.endedIso)
    if (s <= winEnd && e >= winStart) n += 1
  }
  return n
}

const SUPPORTED_SOURCES: ReadonlySet<ActivitySource> = new Set<ActivitySource>([
  'goodnotes',
  'reading-md',
  'reading-draw',
])

export function isReadingSessionEditableBlock(source: ActivitySource): boolean {
  return SUPPORTED_SOURCES.has(source)
}

export default function ReadingSessionEditModalBlock({
  chain,
  dayChains,
  onClose,
  onSaved,
}: Props) {
  const target = useMemo(() => pickTargetSession(chain), [chain])
  const initialStart = Date.parse(target.startedIso)
  const initialEnd = Date.parse(target.endedIso ?? target.startedIso)
  const initialPages = chain.msgCount

  const [startStr, setStartStr] = useState(() => msToLocalInput(initialStart))
  const [endStr, setEndStr] = useState(() => msToLocalInput(initialEnd))
  const [pages, setPages] = useState<string>(() => String(Math.max(1, initialPages)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startMs = localInputToMs(startStr)
  const endMs = localInputToMs(endStr)
  const pagesNum = Math.max(1, parseInt(pages, 10) || 1)

  const isValid = startMs != null && endMs != null && endMs - startMs >= 60_000

  const absorbCount = useMemo(() => {
    if (!isValid || startMs == null || endMs == null) return 0
    return countAbsorbedChains(chain, startMs, endMs, dayChains)
  }, [chain, dayChains, isValid, startMs, endMs])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleSave = async () => {
    if (!isValid || startMs == null || endMs == null) return
    setSaving(true)
    setError(null)
    const key = target.sessionId
    if (!key) {
      setError('Missing record id for this session — cannot edit.')
      setSaving(false)
      return
    }
    try {
      if (chain.source === 'goodnotes') {
        const result = await editGoodnotesReadingRecord({
          key, startMs, endMs, pages: pagesNum,
        })
        if (!result) {
          setError('Editing GoodNotes sessions requires the desktop app.')
          setSaving(false)
          return
        }
        if (!result.ok) {
          setError('Could not save the edit. The record may have been removed.')
          setSaving(false)
          return
        }
        onSaved({ absorbed: result.absorbed })
      } else {
        const result = await editThinkingspaceReadingRecord(getVaultFS(), {
          key, startMs, endMs, pages: pagesNum,
        })
        if (!result.ok) {
          setError('Could not save the edit. The record may have been removed.')
          setSaving(false)
          return
        }
        onSaved({ absorbed: result.absorbed })
      }
    } catch {
      setError('Save failed unexpectedly.')
      setSaving(false)
    }
  }

  const durationMs = isValid && startMs != null && endMs != null ? endMs - startMs : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border/60 bg-card shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between border-b border-border/40 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Edit reading session</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground" title={chain.project}>
              {chain.project}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Start</span>
              <input
                type="datetime-local"
                value={startStr}
                onChange={e => setStartStr(e.target.value)}
                className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground focus:border-border focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">End</span>
              <input
                type="datetime-local"
                value={endStr}
                onChange={e => setEndStr(e.target.value)}
                className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground focus:border-border focus:outline-none"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Pages</span>
            <input
              type="number"
              min={1}
              step={1}
              value={pages}
              onChange={e => setPages(e.target.value)}
              className="w-24 rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground tabular-nums focus:border-border focus:outline-none"
            />
          </label>

          <div className="flex items-baseline justify-between rounded-md border border-border/30 bg-background/40 px-2.5 py-1.5 text-[11px]">
            <span className="text-muted-foreground">Duration</span>
            <span className="tabular-nums text-foreground/85">{fmtDurationMs(durationMs)}</span>
          </div>

          {absorbCount > 0 && isValid && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              Absorbs {absorbCount} other {absorbCount === 1 ? 'record' : 'records'} of <em>{chain.project}</em> on save.
            </div>
          )}

          {!isValid && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400">
              End must be at least one minute after start.
            </div>
          )}

          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 dark:bg-rose-500/20 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/40 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border/40 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground hover:border-border/70 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isValid || saving}
            className={cn(
              'rounded-md border border-border/60 bg-foreground/[0.08] px-3 py-1.5 text-xs text-foreground transition-colors',
              'hover:border-border/90 hover:bg-foreground/[0.12]',
              (!isValid || saving) && 'cursor-not-allowed opacity-50 hover:bg-foreground/[0.08]',
            )}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
