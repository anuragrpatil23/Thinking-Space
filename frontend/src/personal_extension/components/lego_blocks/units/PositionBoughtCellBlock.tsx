import type { PositionBoughtViewBlock } from '@/personal_extension/services/lego_blocks/units/webullPositionBoughtBlock'

const dayWords = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const qtyWords = (qty: number) => Number(qty.toFixed(4)).toLocaleString()

const SHOWN = 2

/** When a position was bought: one day, or each buy still held with how many. */
export function PositionBoughtCellBlock({ view }: { view: PositionBoughtViewBlock | null }) {
  if (!view) return null
  const { kind, lots } = view
  const several = kind === 'lots' && lots.length > 1
  const title = kind === 'latest'
    ? 'The latest buy. The buys on record do not add up to what is held (a split, or a trade not on record yet), so the earlier ones are not listed.'
    : lots.map(l => `${dayWords(l.on)}${several ? `: ${qtyWords(l.qty)}` : ''}`).join('\n')
  return (
    <span className="block text-right leading-tight tabular-nums" title={title}>
      {lots.slice(0, SHOWN).map(l => (
        <span key={l.on} className="block whitespace-nowrap">
          {dayWords(l.on)}
          {several && <span className="ml-1 text-[11px] text-zinc-500 dark:text-zinc-400">× {qtyWords(l.qty)}</span>}
        </span>
      ))}
      {lots.length > SHOWN && <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">+{lots.length - SHOWN} more</span>}
      {kind === 'latest' && <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">latest buy</span>}
    </span>
  )
}
