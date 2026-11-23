import { File, FileText, Link2, type LucideIcon } from 'lucide-react'
import { isExcalidrawPathBlock } from '@/services/lego_blocks/units/excalidrawPathBlock'

// How the Explorer marks a file, shared with the read-only tree.

export function explorerBaseFileIconBlock(name: string): LucideIcon {
  const lower = name.toLowerCase()
  if (lower.endsWith('.md')) return FileText
  if (lower.endsWith('.url')) return Link2
  return File
}

export function explorerFileIconColorBlock(name: string, isSelected: boolean): string {
  if (isSelected) return 'text-white'
  const lower = name.toLowerCase()
  if (lower.endsWith('.url')) return 'text-blue-400'
  if (isExcalidrawPathBlock(lower)) return 'text-violet-400'
  if (lower.endsWith('.pdf')) return 'text-red-400'
  if (lower.endsWith('.epub')) return 'text-amber-500'
  return 'text-muted-foreground'
}
