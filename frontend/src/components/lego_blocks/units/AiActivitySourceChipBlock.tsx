import { cn } from '@/lib/utils'
import type { GenerationSource } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

// Tiny "who generated this" marker. Shares the colour language with the range-
// summary provider badge (claude → orange, local → emerald, rule-based →
// muted) so the whole AI-Activity surface reads consistently. Legacy records
// with no recorded source ('') render nothing — better a missing chip than a
// misleading one.
function descriptor(
  generator: GenerationSource | '',
): { label: string; className: string } | null {
  switch (generator) {
    case 'claude':
      return { label: 'claude', className: 'text-orange-600 dark:text-orange-300' }
    case 'local':
      return { label: 'local', className: 'text-emerald-600 dark:text-emerald-300' }
    case 'rule-based':
      return { label: 'rules based', className: 'text-muted-foreground' }
    default:
      return null
  }
}

interface Props {
  generator: GenerationSource | ''
  className?: string
}

/** Small uppercase source label (e.g. the generator behind a chain digest).
 *  Returns null when the source is unknown so callers can render it inline
 *  without guarding. */
export default function AiActivitySourceChipBlock({ generator, className }: Props) {
  const d = descriptor(generator)
  if (!d) return null
  return (
    <span
      className={cn('text-[9px] uppercase tracking-[0.08em]', d.className, className)}
      title={`Generated via ${d.label}`}
    >
      {d.label}
    </span>
  )
}
