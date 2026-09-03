import { useState } from 'react'
import { cn } from '@/lib/utils'

/* The whole navigation surface for a touch reader: where you are, and a way to
   get somewhere else.

   It replaces a six-button zoom toolbar because on a tablet pinch already is
   the zoom control, and page position is the only thing a reader cannot
   discover from the page itself. It floats over the bottom of the page rather
   than occupying a bar, so a full-bleed page stays full-bleed. */
export default function PdfPageScrubberBlock({
  pageNumber,
  numPages,
  visible,
  onSeek,
  className,
}: {
  pageNumber: number
  numPages: number
  visible: boolean
  onSeek: (page: number, immediate: boolean) => void
  className?: string
}) {
  /* Scrubbing scrolls, scrolling hides the chrome, and hiding the chrome faded
     out the control being dragged — so the scrubber disappeared under the
     finger every time it was used. While a drag is in progress the bar pins
     itself visible and ignores the auto-hide entirely. */
  const [scrubbing, setScrubbing] = useState(false)
  const shown = visible || scrubbing

  if (numPages <= 0) return null

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        'transition-opacity duration-200 ease-out',
        shown ? 'opacity-100' : 'opacity-0',
        className,
      )}
      /* Hidden from assistive tech and from taps when faded out, so an
         invisible control can never swallow a tap meant for the page. */
      aria-hidden={!shown}
    >
      <div
        className={cn(
          'flex w-full max-w-md items-center gap-3 rounded-full border border-border/60 bg-card/90 px-4 py-2 shadow-lg backdrop-blur',
          shown && 'pointer-events-auto',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {pageNumber} / {numPages}
        </span>
        <input
          type="range"
          min={1}
          max={numPages}
          value={pageNumber}
          onPointerDown={() => setScrubbing(true)}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
          onKeyDown={() => setScrubbing(true)}
          onBlur={() => setScrubbing(false)}
          /* Jump instantly while dragging: a smooth scroll per input event
             queues dozens of competing animations and the page never settles
             where the thumb is. */
          onChange={(event) => onSeek(Number(event.target.value), scrubbing)}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
          aria-label="Page"
        />
      </div>
    </div>
  )
}
