import { Loader2 } from 'lucide-react'
import UndertakingIndexRowBlock from '@/components/lego_blocks/units/UndertakingIndexRowBlock'
import { useUndertakingIndexBlock } from '@/components/lego_blocks/hooks/units/useUndertakingIndexBlock'

// The Thinking Organizer index view: undertakings grouped under their section
// headings, one dense line each. This is a *view* over the derived index, not a
// store — the entries come from getUndertakingIndexOrch, which reads the
// hand-written heads and derives the tails from chains on every load.

interface Props {
  /** The ai-activity project id (today the basename of the project root; the
   *  registry will canonicalize this — D9). Null renders the empty state. */
  projectId: string | null
  onOpenUndertaking?: (key: string) => void
}

export default function UndertakingIndexBlock({ projectId, onOpenUndertaking }: Props) {
  const { index, loading, error } = useUndertakingIndexBlock(projectId)

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading index…
      </div>
    )
  }

  if (error) {
    return <div className="px-2 py-8 text-sm text-destructive">Could not load the index: {error}</div>
  }

  if (!index || index.sections.length === 0) {
    return (
      <div className="px-2 py-8 text-sm text-muted-foreground/70">
        No undertakings yet. They fill in as sessions get filed at the end-of-session ask.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {index.sections.map(section => (
        <section key={section.key}>
          <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {section.title}
          </h2>
          <div className="space-y-0.5">
            {section.rows.map(row => (
              <UndertakingIndexRowBlock
                key={row.record.key}
                row={row}
                onOpen={onOpenUndertaking}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
