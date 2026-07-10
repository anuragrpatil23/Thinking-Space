import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/lego_blocks/units/ui/select'
import { cn } from '@/lib/utils'
import ChipBadgeBlock from '@/components/lego_blocks/units/ChipBadgeBlock'
import { CHIP_COLOR_CLASS_BLOCK, type ChipColorBlock } from '@/services/lego_blocks/units/chipColorBlock'
import { NODE_STATUSES, type NodeStatus } from '@/services/lego_blocks/units/yamlNoteBlock'

export const NODE_STATUS_OPTIONS_BLOCK: NodeStatus[] = [...NODE_STATUSES]

// Status → semantic pastel chip color. Actual light/dark classes come from the
// shared CHIP_COLOR_CLASS_BLOCK so status pills match every other chip.
const NODE_STATUS_CHIP_COLOR_BLOCK: Record<NodeStatus, ChipColorBlock> = {
  active: 'emerald',
  paused: 'amber',
  incomplete: 'orange',
  taken: 'emerald',
  planned: 'orange',
  watchlist: 'amber',
  completed: 'blue',
  cancelled: 'rose',
  archived: 'zinc',
}

export const NODE_STATUS_COLOR_CLASSES_BLOCK: Record<NodeStatus, string> = Object.fromEntries(
  (Object.keys(NODE_STATUS_CHIP_COLOR_BLOCK) as NodeStatus[]).map(status => [
    status,
    CHIP_COLOR_CLASS_BLOCK[NODE_STATUS_CHIP_COLOR_BLOCK[status]],
  ]),
) as Record<NodeStatus, string>

export function nodeStatusLabelBlock(status: NodeStatus): string {
  return status.replace(/_/g, ' ')
}

export interface NodeStatusBadgeBlockProps {
  status: NodeStatus
  className?: string
}

export function NodeStatusBadgeBlock({ status, className }: NodeStatusBadgeBlockProps) {
  return (
    <ChipBadgeBlock color={NODE_STATUS_CHIP_COLOR_BLOCK[status]} className={className}>
      {nodeStatusLabelBlock(status)}
    </ChipBadgeBlock>
  )
}

export interface NodeStatusSelectBlockProps {
  status: NodeStatus
  onChange: (status: NodeStatus) => void
  disabled?: boolean
  variant?: 'default' | 'pill'
  title?: string
  className?: string
}

export function NodeStatusSelectBlock({
  status,
  onChange,
  disabled = false,
  variant = 'default',
  title,
  className,
}: NodeStatusSelectBlockProps) {
  const triggerClass = variant === 'pill'
    ? cn(
      'h-6 w-auto gap-1 rounded-full px-2 py-0 text-[10px] font-medium capitalize shadow-none focus:ring-0 focus:ring-offset-0',
      NODE_STATUS_COLOR_CLASSES_BLOCK[status],
    )
    : 'h-8 text-xs capitalize'

  return (
    <Select value={status} onValueChange={(value) => onChange(value as NodeStatus)} disabled={disabled}>
      <SelectTrigger className={cn(triggerClass, className)} title={title}>
        <span>{nodeStatusLabelBlock(status)}</span>
      </SelectTrigger>
      <SelectContent>
        {NODE_STATUS_OPTIONS_BLOCK.map(option => (
          <SelectItem key={option} value={option}>
            {nodeStatusLabelBlock(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
