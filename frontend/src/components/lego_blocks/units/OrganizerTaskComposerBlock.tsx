import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { organizerSectionColorBlock } from '@/components/lego_blocks/units/OrganizerRowShellBlock'

// The last line of a section: how a new record gets written.
//
// It is a *row*, not a form. The index could show 325 authored records and
// offer no way to author the 326th, and the obvious fix — a button above the
// list opening a modal — would have made adding a record feel like a bigger act
// than the record deserves. Capture has to cost less than the thought does.
//
// So the affordance lives where the new row will land, at the foot of the block
// it belongs to, wearing that section's colour. Closed it is one quiet line;
// open it grows into the same two things a record actually has, a title and a
// description, on the same inset surface an expanded row uses. Nothing else is
// asked for: the kind, the parent, the ticket and the project are all facts
// about *where the composer is sitting*, and asking Anurag to restate them
// would be asking him to type what the app already knows.

interface Props {
  /** The section's palette slot, so the composer wears its colour. */
  colorIndex: number
  /** Named in the closed line — "Add to Ideas" — because a bare `+` at the foot
   *  of a long page doesn't say which of several blocks it will add to. */
  sectionTitle: string
  /** Resolves when the record is on disk. Throwing surfaces inline and leaves
   *  what was typed in place — a failed save must never eat the words. */
  onCreate: (draft: { title: string; description: string }) => Promise<void>
}

export default function OrganizerTaskComposerBlock({ colorIndex, sectionTitle, onCreate }: Props) {
  const { spine } = organizerSectionColorBlock(colorIndex)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

  // Grow to fit rather than scroll inside two rows: a description long enough
  // to be worth writing was being read through a slot.
  useEffect(() => {
    const el = descriptionRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [description, open])

  const close = () => {
    setOpen(false)
    setTitle('')
    setDescription('')
    setError('')
  }

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await onCreate({ title: title.trim(), description: description.trim() })
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the record.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative flex w-full items-center gap-2 py-1.5 pl-1.5 pr-3 text-left transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus:outline-none dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60"
      >
        {/* No spine when closed. The spine marks a record, and this line is not
            one yet — a coloured token here would have the block ending on a row
            that isn't there. It appears the moment the composer opens. */}
        <span className="w-4 shrink-0" aria-hidden />
        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground/70" />
        <span className="text-sm text-muted-foreground/50 transition-colors group-hover:text-foreground/70">
          Add to {sectionTitle}
        </span>
      </button>
    )
  }

  return (
    <div className="relative bg-black/[0.035] pl-1.5 pr-3 shadow-[inset_0_1px_0_rgba(0,0,0,0.06)] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <span aria-hidden className={cn('absolute bottom-2 left-0 top-2 w-[3px] rounded-full', spine)} />
      <div className="flex flex-col gap-1 py-2 pl-6">
        {/* Both fields are bare — no wells, no borders. Inside a list of rows a
            boxed input reads as a different kind of object dropped into the
            block; unboxed, what you type sits exactly where the row's title
            will sit, at the same size and weight, so the composer previews its
            own result. */}
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); close() }
            if (e.key === 'Enter') { e.preventDefault(); descriptionRef.current?.focus() }
          }}
          placeholder="Title"
          disabled={saving}
          className="w-full bg-transparent text-sm font-medium leading-tight text-foreground outline-none placeholder:text-muted-foreground/40"
        />
        <textarea
          ref={descriptionRef}
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); close() }
            // Enter stays a newline here — a description is prose. ⌘↵ saves,
            // which is the one shortcut worth teaching in a two-field form.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
          }}
          rows={1}
          placeholder="Description"
          disabled={saving}
          className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-foreground/80 outline-none placeholder:text-muted-foreground/40"
        />

        {error && <p className="pt-0.5 text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-muted-foreground/40">⌘↵ to add · Esc to discard</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-30"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
