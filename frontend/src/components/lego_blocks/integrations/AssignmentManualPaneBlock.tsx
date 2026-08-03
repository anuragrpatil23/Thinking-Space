import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Link2, Loader2, Search, Sparkles, Trash2, X } from 'lucide-react'
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
import ActionBlock from '@/components/lego_blocks/units/AssignmentActionBlock'
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
 * It is shaped like an inbox, and that is not decoration. The first version put
 * the projects in a chip rail across the top; with 24 project keys it wrapped to
 * three lines and ate half the panel before a single chain, which turned a
 * decision surface into a control panel. Folders on the left is the shape people
 * already know for "one list, many sources", it costs a fixed 224px instead of a
 * variable third of the height, and it makes the per-project pass the default
 * way to work rather than a filter you have to think to apply.
 *
 * The rest follows the queue's rules rather than inventing its own:
 *
 * - **Selection is scoped to one project**, always. A disposition is a
 *   per-project write, so a cross-project selection has no meaning it could be
 *   given. Picking a folder makes that structural; in All, touching a chain in
 *   another project starts a fresh selection there rather than being a dead
 *   click.
 * - **Bulk affordances first.** At this scale a per-row pass is the thing that
 *   doesn't happen: select-all-shown plus a duration floor turn "251 chains"
 *   into a handful of decisions.
 * - **A mint here asks for the head.** Granularity is calibrated against it
 *   (ASSIGNMENT.md: 2–4 per active week), and an undertaking minted from a bare
 *   title is the one that can't be told apart from its neighbours later. It is
 *   the slow path on purpose.
 * - **Origin is `manual`** and the verdicts log `proposed: null`, which
 *   calibration already skips — a human's own decision is never counted as
 *   evidence for or against a band that made no claim.
 */

interface Props {
  /** The whole unproposed backlog, across every project. */
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
  { minutes: 0, label: 'Any' },
  { minutes: 5, label: '5m+' },
  { minutes: 15, label: '15m+' },
  { minutes: 45, label: '45m+' },
]

/** A chain the digest clocked under a minute still happened. Rounding it to
 *  "0m" made a real session read as a broken row. */
function minutesLabelBlock(minutes: number): string {
  return minutes < 1 ? '<1m' : `${minutes}m`
}

export default function AssignmentManualPaneBlock({ chains, onReload, onOpenChain }: Props) {
  const [folder, setFolder] = useState<string | null>(null)
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

  /** The folders: every project with anything unsorted, busiest first. Counted
   *  before the duration floor, so raising the floor never makes a project look
   *  finished when it isn't. */
  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const chain of chains) counts.set(chain.projectId, (counts.get(chain.projectId) ?? 0) + 1)
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
  }, [chains])

  // A folder whose last chain was just disposed of would leave an empty list
  // with no obvious way back. Fall to All.
  useEffect(() => {
    if (folder && !folders.some(entry => entry.id === folder)) setFolder(null)
  }, [folder, folders])

  const visible = useMemo(
    () =>
      chains
        .filter(chain => (!folder || chain.projectId === folder) && chain.activeMinutes >= floor)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [chains, folder, floor],
  )

  // Only what is visible *and* in the selected project can be acted on. Derived
  // rather than pruned on every filter change, so raising the floor hides rows
  // without silently dropping them from a selection you already made — lower it
  // again and they are still picked.
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

  const selectAllIn = useCallback((project: string) => {
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
          task => task.title.toLowerCase().includes(q) || task.ticket.toLowerCase().includes(q),
        )
      : tasks
    return pool.slice(0, 8)
  }, [tasks, taskQuery])

  /** In All, rows carry their project as a heading; inside a folder that would
   *  be the same word 72 times. */
  const groups = useMemo(() => {
    if (folder) return [{ id: folder, rows: visible }]
    const byProject = new Map<string, QueueChainBlock[]>()
    for (const chain of visible) {
      const list = byProject.get(chain.projectId) ?? []
      list.push(chain)
      byProject.set(chain.projectId, list)
    }
    return [...byProject.entries()].map(([id, rows]) => ({ id, rows }))
  }, [visible, folder])

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
    <div className="flex min-h-0 flex-1">
      <nav className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-border py-2 md:flex">
        <FolderBlock
          active={folder === null}
          onClick={() => setFolder(null)}
          label="All chains"
          count={chains.length}
        />
        <div className="my-1.5 border-t border-border" />
        {folders.map(entry => (
          <FolderBlock
            key={entry.id}
            active={folder === entry.id}
            onClick={() => setFolder(entry.id)}
            label={entry.id}
            count={entry.count}
          />
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <h3 className="truncate text-sm font-medium">{folder ?? 'All chains'}</h3>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {visible.length}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {DURATION_FLOORS.map(entry => (
              <button
                key={entry.minutes}
                onClick={() => setFloor(entry.minutes)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] transition-colors',
                  floor === entry.minutes
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="shrink-0 border-b border-border bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nothing that long here. Try a shorter floor.
            </p>
          ) : (
            groups.map(group => (
              <section key={group.id} className="group/section mb-2">
                {!folder && (
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-3 py-1.5 backdrop-blur">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {group.id}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground/50">
                      {group.rows.length}
                    </span>
                  </div>
                )}
                <ul>
                  {group.rows.map(chain => {
                    const picked = selected.has(chain.chainId) && chain.projectId === projectId
                    return (
                      <li key={chain.chainId} className="group/row flex items-center">
                        <button
                          onClick={() => toggle(chain)}
                          aria-pressed={picked}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                            picked ? 'bg-primary/[0.07]' : 'hover:bg-muted/60',
                          )}
                        >
                          {/* Styled, not a native checkbox — the panel it sits in
                              has its own type and tone, and a system control in
                              the middle of it reads as a form someone bolted on. */}
                          <span
                            className={cn(
                              'flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                              picked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border group-hover/row:border-foreground/40',
                            )}
                          >
                            {picked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          <span className={cn('min-w-0 flex-1 truncate', picked && 'font-medium')}>
                            {chain.title}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                            {chain.date}
                          </span>
                          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
                            {minutesLabelBlock(chain.activeMinutes)}
                          </span>
                        </button>
                        {/* The transcript, same slide-over the proposal card
                            uses. For a chain from months ago the title alone is
                            not enough to decide what it was. */}
                        <button
                          onClick={() => onOpenChain(chain)}
                          title="Open the transcript"
                          aria-label={`Open the transcript for ${chain.title}`}
                          className="mr-1 shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/row:opacity-100"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <footer className="shrink-0 border-t border-border px-4 py-2.5">
          {actionable.length === 0 ? (
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Pick the chains that were one piece of work.
              </p>
              {visible.length > 0 && (
                <button
                  onClick={() => selectAllIn(folder ?? groups[0].id)}
                  className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Select all {folder ? 'shown' : `in ${groups[0].id}`}
                </button>
              )}
            </div>
          ) : stage.kind === 'file' ? (
            <div>
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setStage({ kind: 'idle' })
                    }
                  }}
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
                    Nothing matches — create one instead.
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
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-base font-semibold tracking-tight outline-none focus:border-ring"
              />
              {/* Required, not optional. The head is the sentence granularity is
                  judged against, and a title alone is what makes two
                  undertakings indistinguishable six months later. */}
              <textarea
                value={draftHead}
                onChange={event => setDraftHead(event.target.value)}
                rows={2}
                placeholder="What is it, in a sentence? (this is what tells it apart later)"
                className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm leading-relaxed outline-none focus:border-ring"
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{projectId}</span>
                <label className="flex items-center gap-1 normal-case tracking-normal">
                  <span className="text-muted-foreground/70">in</span>
                  <select
                    value={draftSection}
                    onChange={event => setDraftSection(event.target.value)}
                    className="rounded border border-transparent bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground outline-none hover:border-border focus:border-ring"
                  >
                    {sections.map(entry => (
                      <option key={entry.key} value={entry.key}>{entry.title}</option>
                    ))}
                  </select>
                </label>
                <span className="normal-case tracking-normal">
                  {actionable.length} chain{actionable.length === 1 ? '' : 's'}
                  {fedBy.size > 0 && <> · {fedBy.size} task{fedBy.size === 1 ? '' : 's'}</>}
                </span>
              </div>

              {tasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={taskQuery}
                      onChange={event => setTaskQuery(event.target.value)}
                      placeholder="Did a task feed this? Search the ones nothing has answered…"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs outline-none focus:border-ring"
                    />
                  </div>
                  {taskQuery.trim() && (
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
                              {/* The same open/engaged glyph the task rows use —
                                  filled means it is linked. */}
                              <span className={cn('shrink-0', picked ? 'text-primary' : 'text-muted-foreground/50')}>
                                {picked ? '◆' : '◇'}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{task.title}</span>
                              <span className="shrink-0 tabular-nums text-muted-foreground/60">
                                {task.ticket}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                      {taskMatches.length === 0 && (
                        <li className="px-2 py-1 text-xs text-muted-foreground">No task matches.</li>
                      )}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <ActionBlock
                  icon={Sparkles}
                  label={`Create and file ${actionable.length}`}
                  primary
                  disabled={!draftTitle.trim() || !draftHead.trim() || busy}
                  onClick={mint}
                />
                <button
                  onClick={() => setStage({ kind: 'idle' })}
                  className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Cancel
                </button>
                {draftTitle.trim() && !draftHead.trim() && (
                  <span className="text-[11px] text-muted-foreground">
                    A sentence, then it can be created.
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                <span className="font-medium tabular-nums">{actionable.length}</span> selected
                {!folder && <> in <span className="font-medium">{projectId}</span></>}
              </span>
              {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <ActionBlock icon={Sparkles} label="New undertaking" primary onClick={() => setStage({ kind: 'mint' })} />
                <ActionBlock icon={ChevronRight} label="File into…" onClick={() => setStage({ kind: 'file' })} />
                <ActionBlock icon={Trash2} label="Not an undertaking" onClick={bucket} />
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
      </div>
    </div>
  )
}

function FolderBlock({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        active ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground/60">{count}</span>
    </button>
  )
}
