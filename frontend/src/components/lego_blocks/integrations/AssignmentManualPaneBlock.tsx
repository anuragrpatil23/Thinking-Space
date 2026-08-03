import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Link2, Loader2, Search, Sparkles, Trash2, X } from 'lucide-react'
import {
  disposeChainsOrch,
  mintFromSelectionOrch,
  type QueueChainBlock,
} from '@/services/orchestrators/assignmentQueueOrch'
import {
  listUndertakingSectionsOrch,
  listUndertakingTitlesOrch,
  listUnfedTasksOrch,
} from '@/services/orchestrators/aiActivityUndertakingOrch'
import type { Task } from '@/services/lego_blocks/units/aiActivityTaskBlock'
import { cn } from '@/lib/utils'

/**
 * The other half of the queue: the chains nothing has proposed for.
 *
 * The queue proper could only ever answer a question an AI pass had already
 * asked. Everything else — 251 of 267 undisposed chains on the day this was
 * written — was counted in the header and rendered nowhere, and the only remedy
 * offered was "ask Kai to take a pass". That made an automated pass a
 * prerequisite for human judgement in a feature whose contract says the
 * opposite: AI proposes, **a human mints**, and every chain gets a disposition.
 * A backlog you are not allowed to touch until a model has had an opinion about
 * it is not a queue, it is a waiting room.
 *
 * So this is deliberately not a second queue. It is a selection surface:
 *
 * - **Selection is scoped to one project**, always. A disposition is a
 *   per-project write (chains, undertakings and sections all live under a
 *   project key), so a cross-project selection has no meaning it could be given.
 *   Rather than disable the rows you may not pick, touching a chain in another
 *   project simply starts a fresh selection there — the constraint is enforced
 *   without ever being a dead click.
 * - **Bulk affordances first.** At this scale a per-row pass is the thing that
 *   doesn't happen: select-all-visible plus a duration floor turn "251 chains"
 *   into a handful of decisions, which is the only way the backlog moves.
 * - **A mint here asks for the head.** Granularity is calibrated against it
 *   (ASSIGNMENT.md: 2–4 per active week), and an undertaking minted from a bare
 *   title is the one that later can't be told apart from its neighbours. It is
 *   the slow path on purpose.
 * - **Origin is `manual`.** These records did not come from the queue's
 *   suggestions, and the verdicts log `proposed: null` — which calibration
 *   already skips, so a human's own decision is never counted as evidence for
 *   or against a confidence band that made no claim.
 */

interface Props {
  /** The unproposed backlog, already narrowed by the shell's project filter. */
  chains: QueueChainBlock[]
  onReload: () => Promise<void>
  onOpenChain: (chain: QueueChainBlock) => void
}

type Stage =
  | { kind: 'idle' }
  /** Filing into an undertaking that already exists. */
  | { kind: 'file' }
  /** Minting a new one — title, where it lands, what it is, what fed it. */
  | { kind: 'mint' }

const DURATION_FLOORS = [
  { minutes: 0, label: 'Any length' },
  { minutes: 5, label: '5m+' },
  { minutes: 15, label: '15m+' },
  { minutes: 45, label: '45m+' },
]

export default function AssignmentManualPaneBlock({ chains, onReload, onOpenChain }: Props) {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [floor, setFloor] = useState(0)
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [titles, setTitles] = useState<Array<{ key: string; title: string }>>([])
  const [sections, setSections] = useState<Array<{ key: string; title: string }>>([])
  const [tasks, setTasks] = useState<Task[]>([])

  const [query, setQuery] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftSection, setDraftSection] = useState('')
  const [draftHead, setDraftHead] = useState('')
  const [taskQuery, setTaskQuery] = useState('')
  const [fedBy, setFedBy] = useState<ReadonlySet<string>>(new Set())

  const visible = useMemo(
    () =>
      chains
        .filter(chain => chain.activeMinutes >= floor)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [chains, floor],
  )

  // Only what is *visible and in the selected project* can be acted on. Keeping
  // this derived rather than pruning the set on every filter change means
  // raising the duration floor hides rows without silently dropping them from a
  // selection you already made — lower it again and they are still picked.
  const actionable = useMemo(
    () => visible.filter(chain => chain.projectId === projectId && selected.has(chain.chainId)),
    [visible, projectId, selected],
  )

  // The pickers belong to the project the selection is in, not the page's — the
  // same rule the proposal card follows, and for the same reason: offering one
  // project's undertakings while filing another's chain lets one keystroke stamp
  // across a boundary nothing on screen shows.
  useEffect(() => {
    if (!projectId) return
    let alive = true
    void listUndertakingTitlesOrch(projectId).then(list => { if (alive) setTitles(list) })
    void listUndertakingSectionsOrch(projectId).then(list => {
      if (!alive) return
      setSections(list)
      setDraftSection(current => current || list[0]?.key || '')
    })
    void listUnfedTasksOrch(projectId).then(list => { if (alive) setTasks(list) }).catch(() => {})
    return () => { alive = false }
  }, [projectId])

  const reset = useCallback(() => {
    setSelected(new Set())
    setStage({ kind: 'idle' })
    setQuery('')
    setDraftTitle('')
    setDraftHead('')
    setTaskQuery('')
    setFedBy(new Set())
  }, [])

  const toggle = useCallback((chain: QueueChainBlock) => {
    setStage({ kind: 'idle' })
    setSelected(prev => {
      // A chain from a different project restarts the selection there rather
      // than joining it: one disposition, one project.
      if (chain.projectId !== projectId) {
        setProjectId(chain.projectId)
        return new Set([chain.chainId])
      }
      const next = new Set(prev)
      if (next.has(chain.chainId)) next.delete(chain.chainId)
      else next.add(chain.chainId)
      return next
    })
  }, [projectId])

  const selectAllVisible = useCallback((project: string) => {
    setProjectId(project)
    setSelected(new Set(visible.filter(c => c.projectId === project).map(c => c.chainId)))
    setStage({ kind: 'idle' })
  }, [visible])

  const run = useCallback(
    async (work: () => Promise<void>) => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        await work()
        reset()
        await onReload()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, reset, onReload],
  )

  const chainIds = actionable.map(chain => chain.chainId)

  const fileInto = (key: string) =>
    void run(async () => {
      if (!projectId) return
      await disposeChainsOrch({
        chainIds,
        projectId,
        // No pass claimed these, so there is nothing to score the verdict
        // against. Null is the honest record, and calibration skips it.
        proposed: null,
        confidence: 0,
        target: { kind: 'existing', key },
      })
    })

  const bucket = () =>
    void run(async () => {
      if (!projectId) return
      await disposeChainsOrch({
        chainIds,
        projectId,
        proposed: null,
        confidence: 0,
        target: { kind: 'bucket' },
      })
    })

  const mint = () =>
    void run(async () => {
      if (!projectId) return
      await mintFromSelectionOrch({
        projectId,
        title: draftTitle.trim(),
        section: draftSection || undefined,
        head: draftHead.trim(),
        chainIds,
        fedBy: [...fedBy],
      })
    })

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return titles.slice(0, 8)
    return titles
      .filter(entry => entry.title.toLowerCase().includes(q) || entry.key.toLowerCase().includes(q))
      .slice(0, 8)
  }, [titles, query])

  const taskMatches = useMemo(() => {
    const q = taskQuery.trim().toLowerCase()
    const pool = q
      ? tasks.filter(
          task =>
            task.title.toLowerCase().includes(q) || task.ticket.toLowerCase().includes(q),
        )
      : tasks
    return pool.slice(0, 8)
  }, [tasks, taskQuery])

  const projectsInView = useMemo(
    () => [...new Set(visible.map(chain => chain.projectId))],
    [visible],
  )

  if (chains.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Every chain here has either a suggestion waiting for you or an answer already.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-5 py-2">
        {DURATION_FLOORS.map(entry => (
          <button
            key={entry.minutes}
            onClick={() => setFloor(entry.minutes)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              floor === entry.minutes
                ? 'border-foreground/20 bg-muted font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/60',
            )}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {visible.length} shown
          {selected.size > 0 && <> · {actionable.length} selected</>}
        </span>
      </div>

      {error && (
        <p className="shrink-0 border-b border-border px-5 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {projectsInView.map(project => {
          const rows = visible.filter(chain => chain.projectId === project)
          const allPicked = rows.every(chain => selected.has(chain.chainId)) && project === projectId
          return (
            <section key={project} className="mb-3">
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-2 py-1.5 backdrop-blur">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">{project}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{rows.length}</span>
                <button
                  onClick={() => (allPicked ? reset() : selectAllVisible(project))}
                  className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {allPicked ? 'Clear' : 'Select all shown'}
                </button>
              </div>
              <ul className="space-y-px">
                {rows.map(chain => {
                  const picked = selected.has(chain.chainId) && chain.projectId === projectId
                  return (
                    <li key={chain.chainId} className="group/row flex items-center gap-1">
                      <label
                        className={cn(
                          'flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 rounded px-2 py-1.5 text-sm',
                          picked ? 'bg-primary/10' : 'hover:bg-muted/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => toggle(chain)}
                          className="translate-y-0.5 accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate">{chain.title}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {chain.date} · {chain.activeMinutes}m
                        </span>
                      </label>
                      {/* The transcript, same slide-over the proposal card uses.
                          For a chain from months ago the title alone is not
                          enough to decide what it was. */}
                      <button
                        onClick={() => onOpenChain(chain)}
                        title="Open the transcript"
                        aria-label={`Open the transcript for ${chain.title}`}
                        className="shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/row:opacity-100"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      {actionable.length > 0 && (
        <footer className="shrink-0 border-t border-border px-5 py-3">
          {stage.kind === 'file' ? (
            <div>
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setStage({ kind: 'idle' }) } }}
                  placeholder="Which undertaking?"
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
                />
              </div>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
                {matches.map(entry => (
                  <li key={entry.key}>
                    <button
                      onClick={() => fileInto(entry.key)}
                      className="w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {entry.title}
                    </button>
                  </li>
                ))}
                {matches.length === 0 && (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">
                    Nothing matches — mint one instead.
                  </li>
                )}
              </ul>
            </div>
          ) : stage.kind === 'mint' ? (
            <div className="space-y-2.5">
              <input
                autoFocus
                value={draftTitle}
                onChange={event => setDraftTitle(event.target.value)}
                placeholder="What is this piece of work called?"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium outline-none focus:border-ring"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  in
                  <select
                    value={draftSection}
                    onChange={event => setDraftSection(event.target.value)}
                    className="rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-ring"
                  >
                    {sections.map(entry => (
                      <option key={entry.key} value={entry.key}>{entry.title}</option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-muted-foreground">
                  {actionable.length} chain{actionable.length === 1 ? '' : 's'}
                  {fedBy.size > 0 && <> · {fedBy.size} task{fedBy.size === 1 ? '' : 's'}</>}
                </span>
              </div>
              {/* Required, not optional. The head is the sentence granularity is
                  judged against, and a title alone is what makes two
                  undertakings indistinguishable six months later. */}
              <textarea
                value={draftHead}
                onChange={event => setDraftHead(event.target.value)}
                rows={2}
                placeholder="What is it, in a sentence? (this is what tells it apart later)"
                className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
              />

              {tasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={taskQuery}
                      onChange={event => setTaskQuery(event.target.value)}
                      placeholder="Fed by a task? Search the ones nothing has answered…"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs outline-none focus:border-ring"
                    />
                  </div>
                  <ul className="mt-1.5 max-h-28 space-y-px overflow-y-auto">
                    {taskMatches.map(task => {
                      const picked = fedBy.has(task.ticket)
                      return (
                        <li key={task.ticket}>
                          <button
                            onClick={() =>
                              setFedBy(prev => {
                                const next = new Set(prev)
                                if (next.has(task.ticket)) next.delete(task.ticket)
                                else next.add(task.ticket)
                                return next
                              })
                            }
                            className={cn(
                              'flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs',
                              picked ? 'bg-primary/10 text-foreground' : 'hover:bg-muted',
                            )}
                          >
                            <span className={cn('shrink-0', picked ? 'text-primary' : 'text-muted-foreground/50')}>
                              {picked ? '◆' : '◇'}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{task.title}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground/60">{task.ticket}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={mint}
                  disabled={!draftTitle.trim() || !draftHead.trim() || busy}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Create and file {actionable.length}
                </button>
                <button
                  onClick={() => setStage({ kind: 'idle' })}
                  className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Cancel
                </button>
                {!draftHead.trim() && draftTitle.trim() && (
                  <span className="text-[11px] text-muted-foreground">A sentence, then it can be created.</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                <span className="font-medium tabular-nums">{actionable.length}</span> selected in{' '}
                <span className="font-medium">{projectId}</span>
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <button
                  onClick={() => setStage({ kind: 'mint' })}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
                >
                  <Sparkles className="h-3.5 w-3.5" /> New undertaking
                </button>
                <button
                  onClick={() => setStage({ kind: 'file' })}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <ChevronRight className="h-3.5 w-3.5" /> File into…
                </button>
                <button
                  onClick={bucket}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Not an undertaking
                </button>
                <button
                  onClick={reset}
                  aria-label="Clear the selection"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </footer>
      )}
    </div>
  )
}
