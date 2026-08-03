import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, FileText, Loader2, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DRAWER_HEADER_BUTTON,
  DRAWER_INPUT,
  DrawerShellBlock,
  Field,
  FIELD_SURFACE,
  GrowTextarea,
  LinkTitle,
  NoteAvatar,
  PRIMARY_BUTTON,
  RailLabel,
} from '@/components/lego_blocks/units/OrganizerDrawerChromeBlock'
import VaultPageListBlock from '@/components/lego_blocks/units/VaultPageListBlock'
import { taskIsReferenceBlock } from '@/services/lego_blocks/units/aiActivityTaskBlock'
import { noteAgeLabelBlock } from '@/services/lego_blocks/units/noteAgeBlock'
import {
  getTaskDetailOrch,
  updateTaskOrch,
  type TaskDetail,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// The page behind a task row — the other half of the seam, in the same drawer
// the undertakings open in.
//
// Task rows were the only inert thing in the index: they carried a title, some
// tags, and a date, and the task's actual writing lived in the vault with no
// way into it from here. This shows the task itself — its description, its
// comment thread, and the doing on the other end of its arrow.
//
// Editable, but only where a human typed. Title, description, tags and
// comments are Anurag's words and are editable here; the disposition, the
// parent, and the `fed_by`/`produced` edges are not — those are derived or
// owned by the undertaking on the other end, and typing into them would be
// inventing facts the deriver is about to overwrite.
//
// This drawer was read-only until the round-trip was measured rather than
// assumed. All 374 records in both stores survive a parse/re-emit with every
// non-blank line intact, which is what made writing to a store with three
// authors (Anurag, the CLI, agents) safe; the eight files that don't are
// refused loudly instead of quietly tidied. The reasoning lives in
// `taskEditBlock`, which owns the decision about what may change.
//
// These are fields, not a markdown editor — no second CM6 engine, no rich
// text. "Open file" remains the escape hatch for everything past a field: the
// vault is one keystroke away, and the editor there is the one engine the whole
// app edits markdown through.

interface Props {
  projectId: string
  taskKey: string
  /** Follow the task's edge into the undertaking drawer. Without it the link
   *  renders as plain text. */
  onOpenUndertaking?: (key: string) => void
  onClose: () => void
}

export default function TaskDetailDrawerBlock({ projectId, taskKey, onOpenUndertaking, onClose }: Props) {
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()

  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // Separate from `error`, which means "this record would not load". A write
  // that fails leaves a perfectly good record on screen, and blanking the
  // drawer to say so would throw away what the user was in the middle of.
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = (): Promise<void> =>
    getTaskDetailOrch(projectId, taskKey)
      .then(next => {
        setDetail(next)
        if (!next) setError('Not found in this project’s organizer.')
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSaveError(null)
    void getTaskDetailOrch(projectId, taskKey)
      .then(next => {
        if (cancelled) return
        setDetail(next)
        if (!next) setError('Not found in this project’s organizer.')
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [projectId, taskKey])

  // Drafts follow the record, so a reload after a save doesn't leave a stale
  // edit sitting in the box — and switching tasks in the same mounted drawer
  // can't carry one record's title onto another.
  useEffect(() => {
    setTitleDraft(detail?.task.title ?? '')
    setDescriptionDraft(detail?.description ?? '')
  }, [detail?.task.key, detail?.task.title, detail?.description])

  // Every write funnels through here: run it, reload, and surface a refusal
  // rather than swallowing it. `taskEditBlock` refuses malformed records by
  // design, and that message is the whole point of the refusal.
  const runEdit = async (edit: Parameters<typeof updateTaskOrch>[2]): Promise<boolean> => {
    if (!detail) return false
    setBusy(true)
    setSaveError(null)
    try {
      await updateTaskOrch(projectId, detail.task.key, edit)
      await load()
      return true
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveTitle = (): void => {
    if (!detail) return
    const next = titleDraft.trim()
    if (!next || next === detail.task.title) { setTitleDraft(detail.task.title); return }
    void runEdit({ title: next })
  }

  const saveDescription = (): void => {
    void runEdit({ description: descriptionDraft.trim() })
  }

  const addTag = (): void => {
    const value = tagDraft.trim()
    if (!detail || !value || detail.task.tags.includes(value)) { setTagDraft(''); return }
    setTagDraft('')
    void runEdit({ tags: [...detail.task.tags, value] })
  }

  const removeTag = (tag: string): void => {
    if (!detail) return
    void runEdit({ tags: detail.task.tags.filter(t => t !== tag) })
  }

  const addComment = async (): Promise<void> => {
    if (!commentDraft.trim()) return
    const ok = await runEdit({ addComment: { text: commentDraft.trim(), author: '' } })
    if (ok) setCommentDraft('')
  }

  const descriptionChanged = Boolean(detail) && descriptionDraft.trim() !== (detail!.description ?? '').trim()

  // The task as markdown, in the order the drawer reads: what it says, then
  // where it sits, then the thread.
  const copyMarkdown = async () => {
    if (!detail) return
    const { task } = detail
    const lines: string[] = [`# ${task.title}`, '']
    if (detail.description) lines.push(detail.description, '')
    lines.push(`- **Kind:** ${task.category}`)
    if (task.openedDate) lines.push(`- **Opened:** ${task.openedDate}`)
    if (task.tags.length) lines.push(`- **Tags:** ${task.tags.join(', ')}`)
    if (detail.fedInto) lines.push(`- **Fed into:** ${detail.fedInto.title}`)
    if (detail.producedBy) lines.push(`- **Produced by:** ${detail.producedBy.title}`)
    if (detail.comments.length) {
      lines.push('', '## Comments', '')
      for (const comment of detail.comments) {
        const by = [comment.added_at?.slice(0, 10), comment.added_by].filter(Boolean).join(' · ')
        lines.push(`- ${by ? `${by} — ` : ''}${comment.text}`)
      }
    }
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const age = detail ? noteAgeLabelBlock(detail.task.openedDate) : ''

  return (
    <DrawerShellBlock
      // The kind *is* what this is — "Idea", "Question to research", "Tasks"
      // where a project has no kinds — so it carries the eyebrow rather than a
      // generic noun with the kind repeated as a field below. No hardcoded
      // fallback: every project names its own records, and the only moment this
      // is empty is the flicker before the read lands.
      eyebrow={detail?.task.category ?? ''}
      onClose={onClose}
      actions={
        detail ? (
          <>
          <button
            type="button"
            onClick={() => navigate(`/thinking-space?file=${encodeURIComponent(detail.path)}`)}
            className={DRAWER_HEADER_BUTTON}
            title={detail.path}
          >
            <FileText className="h-3.5 w-3.5" />
            Open file
          </button>
          <button
            type="button"
            onClick={copyMarkdown}
            className={DRAWER_HEADER_BUTTON}
            title="Copy as markdown"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          </>
        ) : undefined
      }
    >
      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}
      {!loading && error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && detail && (
        <>
          {/* Title — saved on blur / ⌘↵, same as the undertaking drawer. Reads
              as the heading until you touch it: the edit affordance is a
              hover/focus tint, not a permanent input box. The ticket prefix
              stays out of it — the file carries one, and re-applying it is the
              write path's job, not something to make the user retype. */}
          <GrowTextarea
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur() }
            }}
            aria-label="Task title"
            className="-mx-2 w-[calc(100%+1rem)] rounded-lg bg-transparent px-2 py-1 text-[1.6rem] font-semibold leading-[1.25] tracking-[-0.015em] outline-none transition-colors hover:bg-black/[0.03] focus:bg-black/[0.03] dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.04]"
          />

          {/* A refused or failed write, said plainly and in place. The record
              behind it is still on screen and still correct — the file simply
              wasn't changed. */}
          {saveError && (
            <p className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-[13px] text-destructive">
              {saveError}
            </p>
          )}

          {/* One line of provenance under the title rather than a field grid:
              a task's date and ticket are context for reading it, not facts you
              came here to look up. */}
          <p className="-mt-2 flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground/70">
            {detail.task.openedDate && (
              <span className="tabular-nums">
                Opened {detail.task.openedDate}
                {age && <span className="text-muted-foreground/50"> · {age} ago</span>}
              </span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground/50">{detail.task.ticket}</span>
          </p>

          {/* The description edits as plain text and renders as markdown once
              saved — the same trade the undertaking drawer's outcome makes. A
              task whose title is the whole thought is the normal case here, not
              a defect, so the empty state is an invitation rather than a
              placeholder that looks broken.
              Explicit save rather than save-on-blur: this is the field you
              write a paragraph into, and losing it to a stray click elsewhere
              would be the drawer's worst failure. The button only exists once
              there is something to save. */}
          <div className="flex flex-col gap-2">
            <GrowTextarea
              value={descriptionDraft}
              onChange={e => setDescriptionDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveDescription() }
              }}
              placeholder="No body yet — the title may be the whole task…"
              aria-label="Description"
              className="-mx-2 w-[calc(100%+1rem)] rounded-lg bg-transparent px-2 py-1 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-black/[0.03] focus:bg-black/[0.03] dark:hover:bg-white/[0.04] dark:focus:bg-white/[0.04]"
            />
            {descriptionChanged && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveDescription}
                  disabled={busy}
                  className={PRIMARY_BUTTON}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setDescriptionDraft(detail.description ?? '')}
                  className="text-[12px] text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  Discard
                </button>
                <span className="text-[11px] text-muted-foreground/50">⌘↵</span>
              </div>
            )}
          </div>

          <Field label="Relationships">
            {/* Always rendered now, because tags are editable: the old version
                hid this whole block when a task had no tags and no edges, which
                would leave a record with nothing on it no way to get its first
                tag. The edges inside it stay read-only — an undertaking owns
                `fed_by`/`produced`, and a task is only ever named by them. */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
                <div className="min-w-0">
                  <RailLabel>Tags</RailLabel>
                  {detail.task.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {detail.task.tags.map(tag => (
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
                {detail.fedInto && (
                  <div className="min-w-0">
                    <RailLabel>Fed into</RailLabel>
                    <p className="mt-2 flex text-[13px]">
                      <LinkTitle
                        title={detail.fedInto.title}
                        linkKey={detail.fedInto.key}
                        onOpen={onOpenUndertaking}
                      />
                    </p>
                  </div>
                )}
                {detail.producedBy && (
                  <div className="min-w-0">
                    <RailLabel>Produced by</RailLabel>
                    <p className="mt-2 flex text-[13px]">
                      <LinkTitle
                        title={detail.producedBy.title}
                        linkKey={detail.producedBy.key}
                        onOpen={onOpenUndertaking}
                      />
                    </p>
                  </div>
                )}
                {!detail.fedInto && !detail.producedBy && (
                  // A real sentence rather than an empty cell — but not the same
                  // sentence for both kinds. A reference task (a lesson, a thing
                  // to remember) is a record, not a loop, so "still open" would
                  // be calling it late for something it was never going to do.
                  // It sits in the grid's second column so the tags rail keeps
                  // its place whether or not the edges exist.
                  <p className="min-w-0 self-end text-[13px] text-muted-foreground/55 sm:col-span-2">
                    {taskIsReferenceBlock(detail.task.categoryCode)
                      ? 'A record — nothing has drawn on it yet.'
                      : 'Nothing has fed on this yet — it is still open.'}
                  </p>
                )}
              </div>
          </Field>

          <Field
            label="Comments"
            action={
              detail.comments.length > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground/70">
                  {detail.comments.length}
                </span>
              ) : undefined
            }
          >
            {/* The composer sits above the thread, as it does on undertakings.
                Attribution is visible because this thread has more than one
                author — an agent writing through the CLI files into this same
                `## Comments` section under its own name. */}
            <div
              className={cn(
                FIELD_SURFACE,
                'overflow-hidden transition-colors',
                'focus-within:border-black/[0.12] focus-within:bg-black/[0.035]',
                'dark:focus-within:border-white/[0.14] dark:focus-within:bg-white/[0.05]',
              )}
            >
              <textarea
                value={commentDraft}
                onChange={e => setCommentDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void addComment() }
                }}
                rows={4}
                placeholder="Add a comment…"
                aria-label="Add a comment"
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
                  onClick={() => void addComment()}
                  disabled={busy || !commentDraft.trim()}
                  className={PRIMARY_BUTTON}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Add comment
                </button>
              </div>
            </div>

            {detail.comments.length > 0 && (
              <ol className="mt-6 space-y-5">
                {detail.comments.map((comment, index) => (
                  <li key={`${comment.added_at ?? ''}-${index}`} className="flex items-start gap-3">
                    <NoteAvatar author={comment.added_by ?? null} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2 text-[12px] leading-none">
                        <span className="font-medium text-foreground/85">{comment.added_by || 'You'}</span>
                        <span className="tabular-nums text-muted-foreground/55">
                          {comment.added_at?.slice(0, 10) || 'undated'}
                        </span>
                      </p>
                      <div className="prose prose-sm mt-1.5 max-w-none leading-relaxed dark:prose-invert prose-p:my-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.text}</ReactMarkdown>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Field>

          {/* The file is still the record. The drawer edits four fields of it;
              everything else — and any edit past a field — happens there. */}
          <Field label="File">
            <VaultPageListBlock files={[detail.path]} />
          </Field>
        </>
      )}
    </DrawerShellBlock>
  )
}
