import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { useProjectsBlock } from '@/components/lego_blocks/hooks/shared/useProjectsBlock'
import {
  addProjectBlock,
  removeProjectBlock,
  updateProjectBlock,
} from '@/services/lego_blocks/integrations/projectsStorageBlock'
import { loadProjectRegistryBlock } from '@/services/lego_blocks/integrations/projectRegistryLoaderBlock'
import {
  isValidProjectKeyBlock,
  suggestProjectKeyBlock,
  type ProjectBlock,
} from '@/services/lego_blocks/units/projectBlock'

const CLOBBER_GUARD_MESSAGE =
  'Could not read projects.json — it may have been written by a newer version on another device. ' +
  'Nothing was changed. Open the app on that device, or fix the file, then retry.'

const UNGROUPED_LABEL = 'Ungrouped'

interface ProjectDraft {
  name: string
  key: string
  mission: string
  description: string
  /** One entry per line — the plainest editor for a list that is usually 1-3
   *  entries and is occasionally pasted in from a terminal. */
  rootsText: string
  aliasesText: string
  group: string
  color: string
}

function linesToTextBlock(values: string[]): string {
  return values.join('\n')
}

function textToLinesBlock(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

function toDraft(project: ProjectBlock): ProjectDraft {
  return {
    name: project.name,
    key: project.key,
    mission: project.mission,
    description: project.description,
    rootsText: linesToTextBlock(project.roots),
    aliasesText: linesToTextBlock(project.aliases),
    group: project.group,
    color: project.color,
  }
}

function draftDiffersBlock(project: ProjectBlock, draft: ProjectDraft): boolean {
  return (
    draft.name !== project.name ||
    draft.key !== project.key ||
    draft.mission !== project.mission ||
    draft.description !== project.description ||
    draft.rootsText !== linesToTextBlock(project.roots) ||
    draft.aliasesText !== linesToTextBlock(project.aliases) ||
    draft.group !== project.group ||
    draft.color !== project.color
  )
}

/** Stable group order: the order groups first appear in the list, with
 *  ungrouped projects last so an unfiled project is never buried mid-page. */
function groupProjectsBlock(projects: ProjectBlock[]): Array<[string, ProjectBlock[]]> {
  const groups = new Map<string, ProjectBlock[]>()
  for (const project of projects) {
    const label = project.group.trim() || UNGROUPED_LABEL
    const bucket = groups.get(label)
    if (bucket) bucket.push(project)
    else groups.set(label, [project])
  }
  const ungrouped = groups.get(UNGROUPED_LABEL)
  groups.delete(UNGROUPED_LABEL)
  const out = [...groups.entries()]
  if (ungrouped) out.push([UNGROUPED_LABEL, ungrouped])
  return out
}

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring'
const AREA_CLASS =
  'w-full rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground outline-none focus:border-ring'
const MONO_AREA_CLASS =
  'w-full rounded-md border border-input bg-background px-2 py-2 font-mono text-xs text-foreground outline-none focus:border-ring'
const HINT_CLASS = 'text-[11px] text-muted-foreground'
const LABEL_CLASS = 'text-[11px] font-medium text-muted-foreground'

/**
 * ProjectsSettingsBlock — Projects sub-page rendered inside the existing
 * SettingsOrch, and the single place a project is defined.
 *
 * Source of truth: `.thinking-space/projects.json` via projectsStorageBlock.
 * On every write the storage block dispatches a window event that all
 * `useProjectsBlock` consumers (this page + canvas anchors + pickers) listen
 * to, so edits propagate live.
 *
 * The list collapses. A real vault has ~20 projects, and rendering twenty
 * always-open forms made the page a wall no one could scan — which is part of
 * how `vaultPath` sat here for months with no reader and nobody noticed. One
 * row per project, one open at a time.
 */
export default function ProjectsSettingsBlock() {
  const { projects, loading } = useProjectsBlock()
  const [drafts, setDrafts] = useState<Record<string, ProjectDraft>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMission, setNewMission] = useState('')

  // Sync draft buffers when the persisted list changes (covers external edits +
  // post-save echoes from the change event).
  useEffect(() => {
    setDrafts(prev => {
      const next: Record<string, ProjectDraft> = {}
      for (const project of projects) {
        next[project.uuid] = prev[project.uuid] ?? toDraft(project)
      }
      return next
    })
  }, [projects])

  const grouped = useMemo(() => groupProjectsBlock(projects), [projects])

  const isDirtyBlock = (project: ProjectBlock) => {
    const draft = drafts[project.uuid]
    return draft ? draftDiffersBlock(project, draft) : false
  }

  const updateDraft = (id: string, patch: Partial<ProjectDraft>) => {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setMessage(null)
    setError(null)
  }

  const onSave = async (project: ProjectBlock) => {
    const draft = drafts[project.uuid]
    if (!draft) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await updateProjectBlock(project.uuid, {
        name: draft.name,
        // Ignored by the storage layer once set — sent so a project that has
        // never had one can be given its address here.
        key: draft.key,
        mission: draft.mission,
        description: draft.description,
        roots: textToLinesBlock(draft.rootsText),
        aliases: textToLinesBlock(draft.aliasesText),
        group: draft.group,
        color: draft.color,
      })
      // null means the storage layer refused to write rather than clobber an
      // unreadable file. Silence here would look like a successful save.
      if (!saved) {
        setError(CLOBBER_GUARD_MESSAGE)
        return
      }
      // Re-warm the registry caches so a renamed project is labelled correctly
      // the next time an activity view renders, without an app restart.
      await loadProjectRegistryBlock()
      setMessage(`Saved "${draft.name.trim() || project.name}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project.')
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (project: ProjectBlock) => {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`Delete project "${project.name}"? Canvases bound to it will fall back to the first project.`)
      : true
    if (!confirmed) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await removeProjectBlock(project.uuid)
      await loadProjectRegistryBlock()
      setMessage(`Deleted "${project.name}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project.')
    } finally {
      setBusy(false)
    }
  }

  const onAdd = async () => {
    const name = newName.trim()
    if (!name) {
      setError('Project name cannot be empty.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const added = await addProjectBlock({
        name,
        mission: newMission,
        key: suggestProjectKeyBlock(name),
      })
      if (!added) {
        setError(CLOBBER_GUARD_MESSAGE)
        return
      }
      setNewName('')
      setNewMission('')
      setAdding(false)
      // Open the new project straight away: it has no folders yet, and a project
      // with no folders matches no session, so the next step is never optional.
      setOpenId(added.uuid)
      setMessage(`Added "${name}". Add its folders below so its sessions find it.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add project.')
    } finally {
      setBusy(false)
    }
  }

  const renderEditor = (project: ProjectBlock, draft: ProjectDraft) => (
    <div className="space-y-3 border-t border-border/60 px-3 py-3">
      <div className="space-y-1">
        <label className={LABEL_CLASS}>Name</label>
        <input
          type="text"
          value={draft.name}
          onChange={e => updateDraft(project.uuid, { name: e.target.value })}
          placeholder="Project name"
          className={FIELD_CLASS}
        />
      </div>
      <div className="space-y-1">
        <label className={LABEL_CLASS}>Mission</label>
        <textarea
          value={draft.mission}
          onChange={e => updateDraft(project.uuid, { mission: e.target.value })}
          placeholder="A one- or two-line statement of what this project is about."
          rows={2}
          className={AREA_CLASS}
        />
      </div>
      <div className="space-y-1">
        <label className={LABEL_CLASS}>Description</label>
        <textarea
          value={draft.description}
          onChange={e => updateDraft(project.uuid, { description: e.target.value })}
          placeholder="The longer context — what this project covers, and anything a reader (or an agent) needs to know before working in it."
          rows={3}
          className={AREA_CLASS}
        />
      </div>
      <div className="space-y-1">
        <label className={LABEL_CLASS}>Folders</label>
        <textarea
          value={draft.rootsText}
          onChange={e => updateDraft(project.uuid, { rootsText: e.target.value })}
          placeholder={'acceleration_core/F9\n/Users/you/code/some-repo'}
          rows={3}
          className={MONO_AREA_CLASS}
        />
        <p className={HINT_CLASS}>
          One per line — every folder whose work belongs to this project. Vault-relative, or absolute
          for a code checkout outside the vault. This is how a session's working directory finds its
          project, so a repo listed here stops showing up as its own folder name.
        </p>
      </div>
      <div className="space-y-1">
        <label className={LABEL_CLASS}>Also known as</label>
        <textarea
          value={draft.aliasesText}
          onChange={e => updateDraft(project.uuid, { aliasesText: e.target.value })}
          placeholder={'Thinking-Space\nfrontend'}
          rows={2}
          className={MONO_AREA_CLASS}
        />
        <p className={HINT_CLASS}>
          One per line. Folders are the better fix and are tried first — reach for these only when a
          session has no working directory to match, or ran somewhere that will never be listed above.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className={LABEL_CLASS}>Group</label>
          <input
            type="text"
            value={draft.group}
            onChange={e => updateDraft(project.uuid, { group: e.target.value })}
            placeholder="Optional heading"
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1">
          <label className={LABEL_CLASS}>Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#888888'}
              onChange={e => updateDraft(project.uuid, { color: e.target.value })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-background"
              aria-label={`Color for ${project.name}`}
            />
            <input
              type="text"
              value={draft.color}
              onChange={e => updateDraft(project.uuid, { color: e.target.value })}
              placeholder="auto"
              className={`${FIELD_CLASS} font-mono text-xs`}
            />
          </div>
          <p className={HINT_CLASS}>Empty derives one.</p>
        </div>
        <div className="space-y-1">
          <label className={LABEL_CLASS}>Id</label>
          {project.key ? (
            <p className="flex h-9 items-center rounded-md border border-dashed border-border/60 px-2 font-mono text-xs text-muted-foreground">
              {project.key}
            </p>
          ) : (
            <input
              type="text"
              value={draft.key}
              onChange={e => updateDraft(project.uuid, { key: e.target.value })}
              placeholder="F9"
              className={`${FIELD_CLASS} font-mono text-xs`}
            />
          )}
          <p className={HINT_CLASS}>
            {project.key
              ? 'Fixed. This names the folders holding this project’s chains and organizer records.'
              : 'Set once, then fixed — it names the folders that will hold this project’s records.'}
          </p>
          {!project.key && draft.key.trim() !== '' && !isValidProjectKeyBlock(draft.key.trim()) && (
            <p className="text-[11px] text-destructive">No slashes, and no leading or trailing spaces.</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          onClick={() => { void onSave(project) }}
          disabled={busy || !isDirtyBlock(project)}
        >
          {busy ? 'Saving...' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => updateDraft(project.uuid, toDraft(project))}
          disabled={busy || !isDirtyBlock(project)}
        >
          Reset
        </Button>
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => { void onRemove(project) }}
          disabled={busy}
        >
          Delete
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            What you're working on, defined once. A project's folders are how a session's working
            directory finds it, so the activity views, the organizer and the canvas surfaces all read
            the same definition instead of three different ones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
              Loading projects...
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
              No projects yet. Add one below — canvas surfaces will pick it up automatically.
            </div>
          )}

          {grouped.map(([label, members]) => (
            <div key={label} className="space-y-1.5">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </h3>
              <div className="overflow-hidden rounded-md border border-border/60">
                {members.map((project, index) => {
                  const draft = drafts[project.uuid] ?? toDraft(project)
                  const isOpen = openId === project.uuid
                  const dirty = isDirtyBlock(project)
                  return (
                    <div
                      key={project.uuid}
                      className={index > 0 ? 'border-t border-border/60' : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : project.uuid)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                      >
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border/60"
                          style={project.color ? { backgroundColor: project.color } : undefined}
                        />
                        <span className="truncate text-sm text-foreground">{project.name}</span>
                        {dirty && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">unsaved</span>
                        )}
                        <span className="flex-1" />
                        {/* The count, not the paths: a project with none matches
                            no session, and that is the thing worth spotting. */}
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {project.roots.length === 0
                            ? 'no folders'
                            : `${project.roots.length} folder${project.roots.length === 1 ? '' : 's'}`}
                        </span>
                      </button>
                      {isOpen && renderEditor(project, draft)}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="border-t border-border/60 pt-4">
            {adding ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Add Project</h3>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Project name"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                />
                <textarea
                  value={newMission}
                  onChange={e => setNewMission(e.target.value)}
                  placeholder="Mission (optional)"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                />
                <div className="flex items-center gap-2">
                  <Button type="button" onClick={() => { void onAdd() }} disabled={busy || !newName.trim()}>
                    {busy ? 'Adding...' : 'Add Project'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setAdding(false)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setAdding(true)} disabled={busy}>
                Add Project
              </Button>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
