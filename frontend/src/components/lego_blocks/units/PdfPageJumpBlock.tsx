import { useEffect, useRef, useState } from 'react'

/* "5 / 23", where the 5 is a field: click it, type a page, press Enter.

   The current page is the one number a reader cannot get from the page itself,
   so it earns a place in the toolbar; making it editable in place saves a
   separate "go to page" control. Typing never navigates on its own — only Enter
   or leaving the field does, so a half-typed "1" on the way to "17" does not
   send the reader to page 1. Escape restores the live page. */
export default function PdfPageJumpBlock({
  pageNumber,
  numPages,
  onJump,
}: {
  pageNumber: number
  numPages: number
  onJump: (page: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  /* Escape blurs the field, and blur commits — the flag stops the blur from
     committing the draft Escape just discarded (state has not flushed yet). */
  const cancelledRef = useRef(false)

  /* The live page wins whenever the field is not being edited. */
  useEffect(() => {
    setDraft(null)
  }, [pageNumber])

  const commitBlock = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false
      return
    }
    if (draft === null) return
    const parsed = Number.parseInt(draft, 10)
    setDraft(null)
    if (!Number.isFinite(parsed) || numPages <= 0) return
    const next = Math.max(1, Math.min(parsed, numPages))
    if (next !== pageNumber) onJump(next)
  }

  const shown = draft ?? String(pageNumber)
  const width = `${Math.max(String(numPages || pageNumber).length, 1) + 0.5}ch`

  return (
    <span className="flex items-center gap-1 px-1 text-xs tabular-nums text-muted-foreground">
      <input
        type="text"
        inputMode="numeric"
        aria-label="Page number"
        title="Go to page"
        value={shown}
        style={{ width }}
        className="rounded-md bg-transparent py-1 text-center text-foreground outline-none transition-colors hover:bg-muted focus:bg-muted"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commitBlock}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitBlock()
            cancelledRef.current = true
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancelledRef.current = true
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
      {numPages > 0 && <span>/ {numPages}</span>}
    </span>
  )
}
