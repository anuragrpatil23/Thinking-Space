import { useMemo, useRef, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  appendManualSession,
  editManualSession,
  deleteManualSession,
} from '@/services/lego_blocks/integrations/manualSessionBlock'
import type { ManualSessionRecord } from '@/services/lego_blocks/units/manualSessionParserBlock'

interface Props {
  /** Existing record to edit; omit/null to create a new one. */
  record?: ManualSessionRecord | null
  /** Existing project labels for the combobox (noise buckets already excluded). */
  knownProjects: string[]
  /** Day the drill is on (YYYY-MM-DD, local) — the new session defaults to it. */
  defaultDateIso?: string | null
  onClose: () => void
  /** Called after a successful create/edit/delete so the caller refreshes. */
  onSaved: () => void
}

function pad(n: number): string { return String(n).padStart(2, '0') }
function todayLocalIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function nowLocalTime(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function msToLocalDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function msToLocalTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
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

/** Project combobox: filter existing projects, or deliberately create a new
 *  label only when nothing matches — keeps "Painting/painting" from splitting. */
function ProjectCombobox({
  value,
  onChange,
  projects,
}: {
  value: string
  onChange: (v: string) => void
  projects: string[]
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const trimmed = value.trim()
  const matches = useMemo(() => {
    const q = trimmed.toLowerCase()
    return projects.filter(p => p.toLowerCase().includes(q)).slice(0, 8)
  }, [projects, trimmed])
  const exactExists = projects.some(p => p.toLowerCase() === trimmed.toLowerCase())

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder="e.g. Painting"
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className="w-full rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground focus:border-border focus:outline-none"
      />
      {open && (matches.length > 0 || (trimmed && !exactExists)) && (
        <div className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-md border border-border/50 bg-card py-1 shadow-lg">
          {matches.map(p => (
            <button
              key={p}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(p); setOpen(false) }}
              className="flex w-full items-center px-2.5 py-1 text-left text-xs text-foreground/85 hover:bg-foreground/[0.06]"
            >
              {p}
            </button>
          ))}
          {trimmed && !exactExists && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(trimmed); setOpen(false) }}
              className="flex w-full items-center gap-1.5 border-t border-border/30 px-2.5 py-1 text-left text-xs text-foreground/85 hover:bg-foreground/[0.06]"
            >
              <Plus className="h-3 w-3 text-muted-foreground" />
              Create “{trimmed}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function ManualSessionEditModalBlock({
  record,
  knownProjects,
  defaultDateIso,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!record
  const [project, setProject] = useState(record?.project ?? '')
  const [topic, setTopic] = useState(record?.topic ?? '')
  const [note, setNote] = useState(record?.note ?? '')
  const [date, setDate] = useState(record ? msToLocalDate(record.startMs) : (defaultDateIso ?? todayLocalIso()))
  const [startTime, setStartTime] = useState(record ? msToLocalTime(record.startMs) : nowLocalTime())
  const initialDurMin = record ? Math.max(1, Math.round((record.endMs - record.startMs) / 60_000)) : 60
  const [hours, setHours] = useState(String(Math.floor(initialDurMin / 60)))
  const [minutes, setMinutes] = useState(String(initialDurMin % 60))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startMs = useMemo(() => {
    const ms = Date.parse(`${date}T${startTime}`)
    return Number.isFinite(ms) ? ms : null
  }, [date, startTime])
  const durationMs = useMemo(() => {
    const h = Math.max(0, parseInt(hours || '0', 10) || 0)
    const m = Math.max(0, parseInt(minutes || '0', 10) || 0)
    return (h * 60 + m) * 60_000
  }, [hours, minutes])

  const isValid = !!project.trim() && startMs != null && durationMs >= 60_000

  const handleSave = async () => {
    if (!isValid || startMs == null) return
    setSaving(true)
    setError(null)
    const proj = project.trim()
    const top = topic.trim() || proj
    const ok = isEdit
      ? await editManualSession(getVaultFS(), {
          key: record!.key,
          project: proj,
          topic: top,
          note: note.trim() || undefined,
          startMs,
          endMs: startMs + durationMs,
        })
      : await appendManualSession(getVaultFS(), {
          key: (crypto.randomUUID?.() ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          project: proj,
          topic: top,
          note: note.trim() || undefined,
          startMs,
          endMs: startMs + durationMs,
          recordedAt: Date.now(),
        })
    setSaving(false)
    if (!ok) {
      setError('Could not save — enable vault-backed AI Activity in Settings first.')
      return
    }
    onSaved()
    onClose()
  }

  const handleDelete = async () => {
    if (!record) return
    setSaving(true)
    const ok = await deleteManualSession(getVaultFS(), record.key)
    setSaving(false)
    if (!ok) { setError('Could not delete this session.'); return }
    onSaved()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border/60 bg-card shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between border-b border-border/40 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {isEdit ? 'Edit logged session' : 'Log a session'}
          </h3>
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
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Project / activity</span>
            <ProjectCombobox value={project} onChange={setProject} projects={knownProjects} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">What did you do?</span>
            <input
              type="text"
              value={topic}
              placeholder="e.g. Studio session — landscape"
              onChange={e => setTopic(e.target.value)}
              className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground focus:border-border focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Date</span>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground focus:border-border focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Start</span>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground focus:border-border focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Hours</span>
              <input
                type="number" min={0} step={1} value={hours}
                onChange={e => setHours(e.target.value)}
                className="w-20 rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs tabular-nums text-foreground focus:border-border focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Minutes</span>
              <input
                type="number" min={0} max={59} step={5} value={minutes}
                onChange={e => setMinutes(e.target.value)}
                className="w-20 rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs tabular-nums text-foreground focus:border-border focus:outline-none"
              />
            </label>
            <div className="ml-auto flex items-baseline gap-1.5 pb-1.5 text-[11px]">
              <span className="text-muted-foreground">Duration</span>
              <span className="tabular-nums text-foreground/85">{fmtDurationMs(durationMs)}</span>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Note (optional)</span>
            <textarea
              value={note}
              rows={2}
              placeholder="Anything worth remembering later…"
              onChange={e => setNote(e.target.value)}
              className="resize-none rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground focus:border-border focus:outline-none"
            />
          </label>

          {!isValid && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400">
              Pick a project, a start time, and at least a minute of duration.
            </div>
          )}
          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/40 px-4 py-3">
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isValid || saving}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors',
                (!isValid || saving) ? 'cursor-not-allowed bg-foreground/30' : 'bg-foreground hover:bg-foreground/90',
              )}
            >
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Log session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
