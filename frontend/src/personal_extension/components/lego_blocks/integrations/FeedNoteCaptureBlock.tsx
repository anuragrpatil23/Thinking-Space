import { useEffect, useRef, useState } from 'react'
import type { RssFeedItemBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { addFeedNoteOrch } from '@/personal_extension/services/orchestrators/feedNotesOrch'
import { FeedNoteKindBadgeBlock, FeedNoteLineBlock } from '../units/FeedNoteLineBlock'
import type { FeedNoteKindBlock } from '@/personal_extension/services/lego_blocks/units/feedNoteBlock'
import { useFeedNotesBlock } from '../hooks/useFeedNotesBlock'

type TypedKindBlock = Exclude<FeedNoteKindBlock, 'tagged'>

const PLACEHOLDER_BLOCK: Record<TypedKindBlock, string> = {
  question: 'A question to come back to…',
  comment: 'A comment on this…',
}

/**
 * Questions and comments while reading, without leaving the article: Q or C
 * opens one line under the AI's points, Enter saves it and reading goes on.
 * Leaving the line with text in it saves it too; only Escape throws it away.
 * The article's notes are listed here as well.
 */
export function FeedNoteCaptureBlock({ item, feedTitle }: { item: RssFeedItemBlock; feedTitle: string }) {
  const all = useFeedNotesBlock()
  const notes = all.filter(n => n.itemId === item.id && n.kind !== 'tagged')
  const [kind, setKind] = useState<TypedKindBlock | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Another article: close the line (anything typed was saved on blur)
  useEffect(() => { setKind(null); setText(''); setError(null) }, [item.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      const key = event.key.toLowerCase()
      if (key !== 'q' && key !== 'c') return
      event.preventDefault()
      setKind(key === 'q' ? 'question' : 'comment')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])

  useEffect(() => { if (kind) inputRef.current?.focus() }, [kind])

  const save = (close: boolean) => {
    const value = text.trim()
    if (value && kind) {
      addFeedNoteOrch({ kind, text: value, item, feedTitle }).then(() => setError(null), (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    }
    setText('')
    if (close) setKind(null)
  }

  if (!kind && notes.length === 0) return null

  return (
    <div className="shrink-0 border-b border-border/50 px-4 py-2 text-[12.5px]">
      {notes.map(note => (
        <FeedNoteLineBlock key={note.id} note={note} className="py-0.5 text-zinc-700 dark:text-zinc-200" />
      ))}
      {kind && (
        <div className="flex items-center gap-2 py-1">
          <FeedNoteKindBadgeBlock kind={kind} />
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); save(false) }
              else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setText(''); setKind(null) }
              else if (event.key === 'Tab') { event.preventDefault(); setKind(kind === 'question' ? 'comment' : 'question') }
            }}
            onBlur={() => save(true)}
            placeholder={PLACEHOLDER_BLOCK[kind]}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-400"
          />
          <span className="shrink-0 text-[11px] text-zinc-400">Enter saves · Tab switches · Esc</span>
        </div>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
