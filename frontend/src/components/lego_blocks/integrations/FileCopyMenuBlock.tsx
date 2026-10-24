import { useEffect, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'
import ContextMenuBlock, { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

// Right-click a file or folder row to copy it for an agent conversation: the
// full path (an agent reads the file itself, PDFs included) or, for a text
// file, its contents. One host renders the menu; any row opens it with
// openFileCopyMenuBlock(event, target), so rows need no extra props.

export type FileCopyTargetBlock =
  /** A vault file: copy its path, and its contents when it is text */
  | { kind: 'file'; path: string }
  /** A vault folder: copy its path */
  | { kind: 'folder'; path: string }
  /** Not saved yet: fetch it first, then copy the path it was saved at */
  | { kind: 'fetch'; label: string; fetch: () => Promise<string | null> }

const TEXT_FILE_RE = /\.(md|markdown|txt|csv|json|ya?ml)$/i

let open: { x: number; y: number; target: FileCopyTargetBlock } | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const l of listeners) l() }

export function openFileCopyMenuBlock(event: ReactMouseEvent, target: FileCopyTargetBlock): void {
  event.preventDefault()
  event.stopPropagation()
  open = { x: event.clientX, y: event.clientY, target }
  notify()
}

/** The path as the agent needs it: absolute, from the vault root. */
export function absoluteVaultPathBlock(path: string): string {
  if (path.startsWith('/')) return path
  const root = getStoredVaultRoot()?.replace(/\/+$/, '')
  return root ? `${root}/${path.replace(/^\/+/, '')}` : path
}

export default function FileCopyMenuHostBlock() {
  const current = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => open,
  )
  const [flash, setFlash] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(t)
  }, [flash])

  const close = () => { open = null; notify() }
  const copy = async (at: { x: number; y: number }, produce: () => Promise<string | null>, done: string) => {
    try {
      const text = await produce()
      if (!text) { setFlash({ ...at, text: 'Nothing to copy' }); return }
      await navigator.clipboard.writeText(text)
      setFlash({ ...at, text: done })
    } catch (err) {
      setFlash({ ...at, text: err instanceof Error ? err.message : 'Could not copy' })
    }
  }

  let entries: ContextMenuEntryBlock[] = []
  if (current) {
    const at = { x: current.x, y: current.y }
    const { target } = current
    if (target.kind === 'file') {
      entries = [
        { key: 'path', label: 'Copy file path', onClick: () => { void copy(at, async () => absoluteVaultPathBlock(target.path), 'Path copied') } },
        ...(TEXT_FILE_RE.test(target.path)
          ? [{ key: 'contents', label: 'Copy contents', onClick: () => { void copy(at, () => getVaultFS().read(target.path), 'Contents copied') } }]
          : []),
      ]
    } else if (target.kind === 'folder') {
      entries = [{ key: 'path', label: 'Copy folder path', onClick: () => { void copy(at, async () => absoluteVaultPathBlock(target.path), 'Folder path copied') } }]
    } else {
      entries = [{
        key: 'fetch',
        label: target.label,
        onClick: () => { void copy(at, async () => { const path = await target.fetch(); return path ? absoluteVaultPathBlock(path) : null }, 'Saved; path copied') },
      }]
    }
  }

  return (
    <>
      {current && <ContextMenuBlock position={{ x: current.x, y: current.y }} onClose={close} entries={entries.map(e => ('onClick' in e ? { ...e, onClick: () => { close(); e.onClick() } } : e))} />}
      {flash && (
        <div
          role="status"
          className="pointer-events-none fixed z-[100] rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg dark:bg-white dark:text-zinc-900"
          style={{ left: flash.x + 8, top: flash.y + 8 }}
        >
          {flash.text}
        </div>
      )}
    </>
  )
}
