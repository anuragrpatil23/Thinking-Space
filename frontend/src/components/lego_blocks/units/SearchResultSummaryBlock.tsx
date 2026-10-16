// One quiet line under a vault filter: how much matched, and why —
// "24 notes · 2 folders            9 by name · 15 in text".

import { Loader2 } from 'lucide-react'
import type { VaultSearchRanking } from '@/services/lego_blocks/units/vaultSearchRankBlock'

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export default function SearchResultSummaryBlock({ ranking }: { ranking: VaultSearchRanking | null }) {
  if (!ranking) {
    return (
      <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Searching…
      </div>
    )
  }
  const { hits, total } = ranking
  if (total === 0) {
    return <div className="px-2 pt-1.5 text-[11px] text-muted-foreground">No matches</div>
  }
  let notes = 0
  let folders = 0
  let byName = 0
  let inText = 0
  for (const hit of hits) {
    if (hit.kind === 'folder') folders++
    else notes++
    if (hit.reason === 'content') inText++
    else byName++
  }
  const capped = total > hits.length
  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-1.5 text-[11px] tabular-nums text-muted-foreground">
      <span className="truncate">
        {capped
          ? `Best ${hits.length.toLocaleString()} of ${total.toLocaleString()}`
          : [notes > 0 && plural(notes, 'note'), folders > 0 && plural(folders, 'folder')].filter(Boolean).join(' · ')}
      </span>
      <span className="shrink-0 text-muted-foreground/80">
        {[byName > 0 && `${byName.toLocaleString()} by name`, inText > 0 && `${inText.toLocaleString()} in text`]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  )
}
