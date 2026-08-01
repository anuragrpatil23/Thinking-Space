import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  normalizeTagListBlock,
  splitTagInputBlock,
  tagColorClassBlock,
} from '@/services/lego_blocks/units/tagBlock'
import { cn } from '@/lib/utils'

// Tagging is typing, so this is a small popover under its trigger rather than
// the full-surface room the mood picker gets. Deliberately not
// `TagManagerBlock`: that one manages per-tag colours for organizer nodes and
// carries a colour picker per chip, which is a different job from "add a word
// to this note before I keep writing".

export interface NoteTagsPopoverBlockProps {
  tags: string[]
  onChange: (next: string[]) => void
  /** Tags seen elsewhere in the vault, for suggestions. Optional — the input
   *  works standalone, suggestions just make it faster. */
  suggestions?: string[]
  onClose: () => void
}

export default function NoteTagsPopoverBlock({
  tags,
  onChange,
  suggestions = [],
  onClose,
}: NoteTagsPopoverBlockProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Focus on open — the popover exists because you already decided to tag.
  useEffect(() => { inputRef.current?.focus() }, [])

  const matches = useMemo(() => {
    const query = draft.trim().toLowerCase()
    return suggestions
      .filter(tag => !tags.includes(tag))
      .filter(tag => (query ? tag.toLowerCase().includes(query) : true))
      .slice(0, 8)
  }, [draft, suggestions, tags])

  const commit = (raw: string) => {
    // `splitTagInputBlock` handles comma-separated paste in one go.
    const next = normalizeTagListBlock([...tags, ...splitTagInputBlock(raw)])
    if (next.length !== tags.length) onChange(next)
    setDraft('')
  }

  const removeTag = (tag: string) => onChange(tags.filter(entry => entry !== tag))

  return (
    <div className="w-[min(22rem,calc(100vw-2rem))] p-3">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <span className="py-0.5 text-xs text-muted-foreground/70">No tags yet.</span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              'ltm-tag-pop inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
              tagColorClassBlock(tag, 'solid'),
            )}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`Remove tag ${tag}`}
              className="ltm-motion-fast rounded-full opacity-50 transition-opacity hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>

      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(draft)
            return
          }
          // Backspace on an empty input removes the last chip — the standard
          // token-field gesture, and the reason there is no visible delete
          // affordance until you hover.
          if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
            event.preventDefault()
            removeTag(tags[tags.length - 1])
            return
          }
          if (event.key === 'Escape') { event.preventDefault(); onClose() }
        }}
        placeholder="Add a tag, Enter to commit…"
        aria-label="Add a tag"
        className="mt-2.5 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none transition-colors focus:border-foreground/30"
      />

      {matches.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {matches.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => commit(tag)}
              className={cn(
                'ltm-motion-fast rounded-full border px-2 py-0.5 text-xs transition-transform hover:scale-105',
                tagColorClassBlock(tag, 'unselected'),
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
