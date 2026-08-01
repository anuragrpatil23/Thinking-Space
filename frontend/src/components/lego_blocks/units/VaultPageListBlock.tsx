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

interface Props {
  /** Vault-relative paths. */
  files: string[]
  className?: string
}

export default function VaultPageListBlock({ files, className }: Props) {
  const navigate = useNavigate()
  const shared = useMemo(() => commonVaultFolderBlock(files), [files])
  const entries = useMemo(
    () => files.map(path => ({ path, ...vaultPathLabelBlock(path, shared) })),
    [files, shared],
  )

  if (entries.length === 0) return null

  return (
    <ul className={cn('-mx-2 space-y-0.5', className)}>
      {entries.map(entry => (
        <li key={entry.path}>
          <button
            type="button"
            onClick={() => navigate(`/thinking-space?file=${encodeURIComponent(entry.path)}`)}
            className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"
            title={entry.path}
          >
            <span className="block truncate text-[13px] leading-snug text-foreground/85">
              {entry.name}
            </span>
            {entry.folder && (
              <span className="block truncate text-[11px] leading-snug text-muted-foreground/50">
                {entry.folder}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
