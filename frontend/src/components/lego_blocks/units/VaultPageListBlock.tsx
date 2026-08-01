import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  commonVaultFolderBlock,
  vaultPathLabelBlock,
} from '@/services/lego_blocks/units/vaultPathLabelBlock'

// The vault pages an undertaking wrote, as a list you can actually read and
// open.
//
// They were rendered as raw paths, one per line, truncated to the column: five
// entries all reading `acceleration_core/F9/AI Synthesis/I…`, identical for the
// first thirty characters and cut before the part that differs. So the block
// said "five pages" and nothing else — and the pages are the output, the most
// openable thing on the panel.
//
// The file's name leads; the folder is a second line, and only the part that
// isn't shared by every row in the list (a project folder repeated five times
// is width spent saying nothing). Clicking opens the file in the Thinking Space
// viewer — the same route the explorer uses.

/** One sitting's output, when the caller can attribute pages to sittings. */
export interface VaultPageGroup {
  /** Stable across renders — the chain's id, not its index. */
  id: string
  /** What the reader sees above the group, e.g. `2026-07-14 · Coherent vs Lumentum`. */
  label: string
  /** Vault-relative paths. */
  files: string[]
}

interface Props {
  /** Vault-relative paths. Ignored when `groups` carries anything. */
  files: string[]
  /** Optional per-sitting breakdown. Headings appear only when two or more
   *  groups have files — a single heading over the whole list is a label saying
   *  what the panel already says. */
  groups?: VaultPageGroup[]
  className?: string
}

export default function VaultPageListBlock({ files, groups, className }: Props) {
  const navigate = useNavigate()

  const filled = useMemo(() => (groups ?? []).filter(g => g.files.length > 0), [groups])
  const showHeadings = filled.length > 1
  // Grouped or flat, the shared folder is computed over *every* path on screen.
  // Per-group would strip a different prefix in each group, so two rows for the
  // same folder would read differently depending on what sat beside them.
  const allFiles = useMemo(
    () => (filled.length > 0 ? filled.flatMap(g => g.files) : files),
    [filled, files],
  )
  const shared = useMemo(() => commonVaultFolderBlock(allFiles), [allFiles])

  if (allFiles.length === 0) return null

  const row = (path: string, key: string) => {
    const { name, folder } = vaultPathLabelBlock(path, shared)
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => navigate(`/thinking-space?file=${encodeURIComponent(path)}`)}
          className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
          title={path}
        >
          <span className="block truncate text-[13px] leading-snug text-foreground/85">{name}</span>
          {folder && (
            <span className="block truncate text-[11px] leading-snug text-muted-foreground/50">
              {folder}
            </span>
          )}
        </button>
      </li>
    )
  }

  if (!showHeadings) {
    return <ul className={cn('-mx-2 space-y-0.5', className)}>{allFiles.map(p => row(p, p))}</ul>
  }

  // Headed groups exist for the case a chain spans two sittings: the pages are
  // right, but *which* sitting made them is the part that was missing, and it is
  // what lets a wrong attribution be seen rather than quietly believed. Keys are
  // scoped by group because one page can legitimately be written in two.
  return (
    <div className={cn('-mx-2 space-y-3', className)}>
      {filled.map(group => (
        <div key={group.id}>
          <p
            className="truncate px-2 text-[11px] leading-snug text-muted-foreground/45"
            title={group.label}
          >
            {group.label}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {group.files.map(p => row(p, `${group.id}::${p}`))}
          </ul>
        </div>
      ))}
    </div>
  )
}
