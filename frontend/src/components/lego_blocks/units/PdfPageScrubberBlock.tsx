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
  onSeek: (page: number) => void
  className?: string
}) {
  if (numPages <= 0) return null

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        'transition-opacity duration-200 ease-out',
        visible ? 'opacity-100' : 'opacity-0',
        className,
      )}
      /* Hidden from assistive tech and from taps when faded out, so an
         invisible control can never swallow a tap meant for the page. */
      aria-hidden={!visible}
    >
      <div
        className={cn(
          'flex w-full max-w-md items-center gap-3 rounded-full border border-border/60 bg-card/90 px-4 py-2 shadow-lg backdrop-blur',
          visible && 'pointer-events-auto',
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
          onChange={(event) => onSeek(Number(event.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
          aria-label="Page"
        />
      </div>
    </div>
  )
}
