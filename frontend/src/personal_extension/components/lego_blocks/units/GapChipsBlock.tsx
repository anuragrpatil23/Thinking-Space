import type { GapOfPositionBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'

/** The gaps a position belongs to, as small chips; click one to open the gap. At most two, then "+n". */
export function GapChipsBlock({ gaps, onOpen }: { gaps: GapOfPositionBlock[]; onOpen?: (filePath: string) => void }) {
  // No gap is an empty cell, not a dash: most positions have none
  if (gaps.length === 0) return null
  const shown = gaps.slice(0, 2)
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={gaps.map(g => `${g.gapId} · ${g.title}`).join('\n')}>
      {shown.map(g => (
        <button
          key={g.gapId}
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen?.(g.filePath) }}
          className="max-w-[9rem] truncate rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30"
        >
          {g.gapId}
        </button>
      ))}
      {gaps.length > shown.length && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">+{gaps.length - shown.length}</span>}
    </span>
  )
}
