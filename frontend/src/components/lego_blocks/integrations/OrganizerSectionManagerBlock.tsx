import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  createSectionOrch,
  deleteSectionOrch,
  listManagedSectionsOrch,
  renameSectionOrch,
  reorderSectionOrch,
  type ManagedSection,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// Manage the project's sections — create, rename, reorder, delete. Sections are
// the one level of grouping in the index; this is the only surface that writes
// them (re-filing an undertaking is a separate edit on the undertaking side).
// Deletion is refused while a section still holds undertakings, so nothing is
// silently orphaned into "Unfiled".

interface Props {
  projectId: string
  /** Called after any successful change so the index behind this reloads. */
  onChanged: () => void
}

export default function OrganizerSectionManagerBlock({ projectId, onChanged }: Props) {
  const [sections, setSections] = useState<ManagedSection[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSections(await listManagedSectionsOrch(projectId))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  // Run one mutation, surface its error inline, then refresh both this list and
  // the index behind it.
  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyKey(null)
    }
  }, [load, onChanged])

  const rename = (s: ManagedSection, title: string) => {
    if (title.trim() && title.trim() !== s.title) void run(s.key, () => renameSectionOrch(projectId, s.key, title))
  }
  const move = (s: ManagedSection, direction: 'up' | 'down') =>
    void run(s.key, () => reorderSectionOrch(projectId, s.key, direction))
  const remove = (s: ManagedSection) => void run(s.key, () => deleteSectionOrch(projectId, s.key))
  const add = () => {
    const t = newTitle.trim()
    if (!t) return
    setNewTitle('')
    void run('__new__', () => createSectionOrch(projectId, t))
  }

  return (
    <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sections</h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />}
      </div>

      {error && <p className="mb-2 text-[11px] text-destructive">{error}</p>}

      <ul className="space-y-1">
        {sections.map((s, i) => {
          const busy = busyKey === s.key
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(s, 'up')}
                  disabled={i === 0 || busy}
                  className="text-muted-foreground/50 hover:text-foreground disabled:opacity-25"
                  aria-label="Move up"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => move(s, 'down')}
                  disabled={i === sections.length - 1 || busy}
                  className="text-muted-foreground/50 hover:text-foreground disabled:opacity-25"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              <input
                defaultValue={s.title}
                key={`${s.key}-${s.title}`}
                onBlur={e => rename(s, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                disabled={busy}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-border/60 focus:border-ring focus:bg-background disabled:opacity-60"
              />

              <span
                className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50"
                title={`${s.count} undertaking${s.count === 1 ? '' : 's'} filed here`}
              >
                {s.count}
              </span>

              <button
                type="button"
                onClick={() => remove(s)}
                disabled={busy || s.count > 0}
                title={s.count > 0 ? 'Move its undertakings before deleting' : 'Delete section'}
                className="shrink-0 rounded p-1 text-muted-foreground/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:text-muted-foreground/50"
                aria-label="Delete section"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </li>
          )
        })}
        {!loading && sections.length === 0 && (
          <li className="px-2 py-1 text-[11px] text-muted-foreground/50">No sections yet — add the first below.</li>
        )}
      </ul>

      <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2">
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="New section…"
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={add}
          disabled={!newTitle.trim() || busyKey === '__new__'}
          className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {busyKey === '__new__' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </button>
      </div>
    </div>
  )
}
