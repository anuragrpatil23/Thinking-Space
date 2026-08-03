import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, FileText, Loader2 } from 'lucide-react'
import {
  DRAWER_HEADER_BUTTON,
  DrawerShellBlock,
  Field,
  LinkTitle,
  NoteAvatar,
  RailLabel,
} from '@/components/lego_blocks/units/OrganizerDrawerChromeBlock'
import TagChipListBlock from '@/components/lego_blocks/units/TagChipListBlock'
import VaultPageListBlock from '@/components/lego_blocks/units/VaultPageListBlock'
import { taskIsReferenceBlock } from '@/services/lego_blocks/units/aiActivityTaskBlock'
import { noteAgeLabelBlock } from '@/services/lego_blocks/units/noteAgeBlock'
import { getTaskDetailOrch, type TaskDetail } from '@/services/orchestrators/aiActivityUndertakingOrch'

// The page behind a task row — the other half of the seam, in the same drawer
// the undertakings open in.
//
// Task rows were the only inert thing in the index: they carried a title, some
// tags, and a date, and the task's actual writing lived in the vault with no
// way into it from here. This shows the task itself — its description, its
// comment thread, and the doing on the other end of its arrow.
//
// Read-only, deliberately. These tasks are the old organizer's store, Anurag's
// hand-written half, and nothing in the seam has ever written to it; a drawer
// that quietly started editing them would be the first thing to.
//
// "Open file" is the escape hatch that makes that stance liveable rather than a
// dead end: the vault is one keystroke away, and the editor there is the one
// CM6 engine the whole app edits markdown through. Building a second editing
// surface in this drawer would have meant a second thing that can corrupt these
// files, to save a click.

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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
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
          <h1 className="text-[1.6rem] font-semibold leading-[1.25] tracking-[-0.015em]">
            {detail.task.title}
          </h1>

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

          {detail.description ? (
            <div className="prose prose-sm max-w-none leading-relaxed dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.description}</ReactMarkdown>
            </div>
          ) : (
            // A task whose title *is* the whole thought is the normal case here,
            // not a defect — so this says so plainly instead of looking broken.
            <p className="text-[13px] text-muted-foreground/55">
              No body — the title is the whole task.
            </p>
          )}

          <Field label="Relationships">
            {detail.fedInto || detail.producedBy || detail.task.tags.length > 0 ? (
              <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
                {detail.task.tags.length > 0 && (
                  <div className="min-w-0">
                    <RailLabel>Tags</RailLabel>
                    <TagChipListBlock
                      tags={detail.task.tags}
                      variant="solid"
                      className="mt-2 flex flex-wrap gap-1.5"
                      keyPrefix="task-drawer-tag"
                    />
                  </div>
                )}
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
              </div>
            ) : (
              // A real sentence rather than an empty grid — but not the same
              // sentence for both kinds. A reference task (a lesson, a thing to
              // remember) is a record, not a loop, so "still open" would be
              // calling it late for something it was never going to do.
              <p className="text-[13px] text-muted-foreground/55">
                {taskIsReferenceBlock(detail.task.categoryCode)
                  ? 'A record — nothing has drawn on it yet.'
                  : 'Nothing has fed on this yet — it is still open.'}
              </p>
            )}
          </Field>

          {detail.comments.length > 0 && (
            <Field
              label="Comments"
              action={
                <span className="text-xs tabular-nums text-muted-foreground/70">
                  {detail.comments.length}
                </span>
              }
            >
              <ol className="space-y-5">
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
            </Field>
          )}

          {/* The file is the record. Since nothing here writes, opening it is
              how you get to the thing you'd edit — so it is a link, not a
              path printed at the bottom of the panel. */}
          <Field label="File">
            <VaultPageListBlock files={[detail.path]} />
          </Field>
        </>
      )}
    </DrawerShellBlock>
  )
}
