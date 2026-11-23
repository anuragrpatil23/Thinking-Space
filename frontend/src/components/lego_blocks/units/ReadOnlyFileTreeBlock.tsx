import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { explorerBaseFileIconBlock, explorerFileIconColorBlock } from '@/components/lego_blocks/units/explorerFileIconBlock'

// The Explorer's tree, in its look, for a folder that can only be read: folders
// expand in place and a file is chosen. No rename, drag, menu or new file.

export interface ReadOnlyTreeListingBlock {
  folders: string[]
  files: Array<{ name: string; size: number }>
}

type TreeNodeBlock = { listing?: ReadOnlyTreeListingBlock; error?: string }

/** A folder and every folder above it, from the top down. */
function foldersDownToBlock(path: string, root: string): string[] {
  const inside = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path === root ? '' : path
  const parts = inside.split('/').filter(Boolean)
  return parts.map((_, index) => [root, ...parts.slice(0, index + 1)].filter(Boolean).join('/'))
}

export default function ReadOnlyFileTreeBlock({ root, reveal = null, load, selected, onSelect, formatSize }: {
  root: string
  /** A folder to open on, with the folders above it expanded and it scrolled into view. */
  reveal?: string | null
  load: (path: string) => Promise<ReadOnlyTreeListingBlock>
  selected: string | null
  onSelect: (path: string) => void
  formatSize: (bytes: number) => string
}) {
  const [nodes, setNodes] = useState<Record<string, TreeNodeBlock>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrolledRef = useRef(false)

  const fetchNode = useCallback((path: string) => {
    load(path)
      .then(listing => setNodes(current => ({ ...current, [path]: { listing } })))
      .catch((err: unknown) => setNodes(current => ({ ...current, [path]: { error: err instanceof Error ? err.message : 'This could not be read.' } })))
  }, [load])

  useEffect(() => {
    const opened = reveal === null ? [] : foldersDownToBlock(reveal, root)
    scrolledRef.current = false
    setNodes({})
    setExpanded(new Set(opened))
    for (const path of [root, ...opened]) fetchNode(path)
  }, [root, reveal, fetchNode])

  // Once, when the row it opened on has loaded.
  useEffect(() => {
    const target = selected ?? reveal
    if (scrolledRef.current || !target) return
    const row = containerRef.current?.querySelector(`[data-tree-path="${CSS.escape(target)}"]`)
    if (!row) return
    scrolledRef.current = true
    row.scrollIntoView({ block: 'center' })
  }, [nodes, selected, reveal])

  const toggle = (path: string) => {
    const opening = !expanded.has(path)
    setExpanded((current) => {
      const next = new Set(current)
      if (opening) next.add(path)
      else next.delete(path)
      return next
    })
    if (opening && !nodes[path]?.listing) fetchNode(path)
  }

  const guides = (depth: number) => (depth > 0 ? (
    <span aria-hidden="true">
      {Array.from({ length: depth }, (_, level) => <span key={level} className="ltm-explorer-guide-line" style={{ left: `${15 + level * 14}px` }} />)}
    </span>
  ) : null)

  const renderPath = (path: string, depth: number): ReactNode[] => {
    const node = nodes[path]
    if (node?.error) return [<p key={`${path}-error`} className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${26 + depth * 14}px` }}>{node.error}</p>]
    if (!node?.listing) return [<div key={`${path}-loading`} className="px-2 py-1" style={{ paddingLeft: `${26 + depth * 14}px` }}><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /></div>]
    const rows: ReactNode[] = []
    for (const name of node.listing.folders) {
      const folderPath = path ? `${path}/${name}` : name
      const open = expanded.has(folderPath)
      const Icon = open ? FolderOpen : Folder
      rows.push(
        <button
          key={`folder-${folderPath}`}
          type="button"
          aria-expanded={open}
          data-tree-path={folderPath}
          onClick={() => toggle(folderPath)}
          className={cn('ltm-explorer-row ltm-explorer-folder-row group relative flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/90 transition-colors hover:bg-muted/70', open && 'bg-muted/50')}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <Icon className="ltm-explorer-glyph ltm-explorer-folder-icon h-3.5 w-3.5 shrink-0 text-blue-500" />
          {guides(depth)}
          <span className="truncate">{name}</span>
        </button>,
      )
      if (open) rows.push(...renderPath(folderPath, depth + 1))
    }
    for (const file of node.listing.files) {
      const filePath = path ? `${path}/${file.name}` : file.name
      const isSelected = selected === filePath
      const Icon = explorerBaseFileIconBlock(file.name)
      rows.push(
        <button
          key={`file-${filePath}`}
          type="button"
          aria-current={isSelected ? 'true' : undefined}
          data-tree-path={filePath}
          onClick={() => onSelect(filePath)}
          className={cn(
            'ltm-explorer-row ltm-explorer-file-row group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-muted/70',
            isSelected && 'bg-[var(--ltm-explorer-selected-color,#c73773)] text-white hover:bg-[var(--ltm-explorer-selected-color,#c73773)]',
          )}
          style={{ paddingLeft: `${26 + depth * 14}px` }}
        >
          {guides(depth)}
          <Icon className={cn('ltm-explorer-glyph ltm-explorer-file-icon h-3.5 w-3.5 shrink-0', explorerFileIconColorBlock(file.name, isSelected))} />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className={cn('shrink-0 text-[10px]', isSelected ? 'text-white/80' : 'text-muted-foreground')}>{formatSize(file.size)}</span>
        </button>,
      )
    }
    if (rows.length === 0) rows.push(<p key={`${path}-empty`} className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${26 + depth * 14}px` }}>Nothing to show here.</p>)
    return rows
  }

  return <div ref={containerRef} className="ltm-explorer-compact min-h-full">{renderPath(root, 0)}</div>
}
