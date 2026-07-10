import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { chipColorClassBlock, type ChipColorBlock } from '@/services/lego_blocks/units/chipColorBlock'

export type { ChipColorBlock }

interface ChipBadgeBlockProps {
  /** Semantic pastel color; defaults to a neutral zinc chip. */
  color?: ChipColorBlock
  children: ReactNode
  className?: string
  title?: string
}

/**
 * Universal pastel pill/badge. Every filled "chip" in the app should render
 * through this (or the shared `CHIP_COLOR_CLASS_BLOCK` tokens it uses) so the
 * light/dark recipe stays consistent in one place.
 */
export default function ChipBadgeBlock({ color = 'zinc', children, className, title }: ChipBadgeBlockProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
        chipColorClassBlock(color),
        className,
      )}
      title={title}
    >
      {children}
    </span>
  )
}
