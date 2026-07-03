import { ArrowDown, ArrowUp, Check, Copy, FolderTree, Info, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import type { NodeStatus } from '@/services/lego_blocks/units/yamlNoteBlock'
import { formatRowOrdinal, nodeDisplayTitle, nodeTitleWithoutTicket, PriorityDot, type DropEdge } from '@/components/lego_blocks/units/BacklogListDomainBlock'
import {
  NodeStatusBadgeBlock,
  NodeStatusSelectBlock,
} from '@/components/lego_blocks/units/NodeStatusBlock'
import TagChipListBlock from '@/components/lego_blocks/units/TagChipListBlock'
import { scaledWidthStyleFromClassBlock, type BacklogRowColumnBlock } from '@/components/lego_blocks/units/BacklogRowColumnsBlock'
import { cn } from '@/lib/utils'

interface ProgramGroupEntryBlock {
  id: string
  name: string
  collapsed?: boolean
}

interface BacklogProgramRowBlockProps {
  program: NodeRecord
  programIndex: number
  programCount: number
  selected: boolean
  dragOver: boolean
  dragOverEdge: DropEdge | null
  newlyCreated: boolean
  allowProgramLayoutEditing: boolean
  readOnly: boolean
  rowPresetTags: { visible: string[]; hiddenCount: number }
  copied: boolean
  detailsOpen: boolean
  inlineNotesSaving: boolean
  statusBusy: boolean
  canEditNodeStatus: boolean
  canToggleDetails: boolean
  linksSlot?: ReactNode
  /** Rendered immediately before the program's title text — used by callers
   * (e.g. Webull workspace) to surface a logo or other per-program marker
   * without coupling this generic row to domain-specific concepts. */
  titlePrefixSlot?: ReactNode
  rowColumns: BacklogRowColumnBlock[]
  showRowColumnsOnCompact?: boolean
  rowPresetTagsClassName?: string
  reserveTagsSlotWhenEmpty?: boolean
  linksBeforeTags?: boolean
  statusRightAligned?: boolean
  titleColumnClassName?: string
  wrapTitleText?: boolean
  actionsRightEdge?: boolean
  showProgramStatus?: boolean
  showProgramCopyButton?: boolean
  showNodeTypeIcon: boolean
  showPriorityDot: boolean
  canAssignToGroup: boolean
  assignedGroupId: string
  programGroups: ProgramGroupEntryBlock[]
  ticketBadge: ReactNode
  lookupTagColor: (node: NodeRecord, tag: string) => string | undefined
  onSelectProgram: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent) => void
  onMoveProgramUp: () => void
  onMoveProgramDown: () => void
  onSetProgramIndex?: (nextIndex: number) => void
  // When provided, overrides the default 1-based display ordinal.
  // Return `null` to fully suppress the ordinal + reorder control on this row.
  resolvedOrdinal?: number | null
  onAssignProgramToGroup: (groupId: string | null) => void
  onToggleInlineNotes: () => void
  onCopyRowLabel: (event: React.MouseEvent<HTMLButtonElement>) => void
  onNodeStatusChange: (nextStatus: NodeStatus) => void
}

function ProgramSortOrdinalInputBlock({
  value,
  onCommit,
}: {
  value: number
  onCommit: (next: number) => void
}) {
  const [text, setText] = useState<string>(String(value))
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setText(String(value))
  }, [value])

  return (
    <input
      type="number"
      min={1}
      value={text}
      title="Sort position"
      className="h-6 w-11 rounded border border-input bg-background px-1 text-center text-xs tabular-nums outline-none focus:border-ring"
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => {
        focusedRef.current = true
        event.currentTarget.select()
      }}
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      onBlur={() => {
        focusedRef.current = false
        const parsed = Number(text)
        if (!Number.isFinite(parsed)) {
          setText(String(value))
          return
        }
        const truncated = Math.max(1, Math.trunc(parsed))
        if (truncated === value) {
          setText(String(value))
          return
        }
        onCommit(truncated)
      }}
    />
  )
}

export function BacklogProgramRowBlock({
  program,
  programIndex,
  programCount,
  selected,
  dragOver,
  dragOverEdge,
  newlyCreated,
  allowProgramLayoutEditing,
  readOnly,
  rowPresetTags,
  copied,
  detailsOpen,
  inlineNotesSaving,
  statusBusy,
  canEditNodeStatus,
  canToggleDetails,
  linksSlot,
  titlePrefixSlot,
  rowColumns,
  showRowColumnsOnCompact = false,
  rowPresetTagsClassName,
  reserveTagsSlotWhenEmpty = false,
  linksBeforeTags = false,
  statusRightAligned = true,
  titleColumnClassName,
  wrapTitleText = false,
  actionsRightEdge = false,
  showProgramStatus = true,
  showProgramCopyButton = true,
  showNodeTypeIcon,
  showPriorityDot,
  canAssignToGroup,
  assignedGroupId,
  programGroups,
  ticketBadge,
  lookupTagColor,
  onSelectProgram,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onMoveProgramUp,
  onMoveProgramDown,
  onSetProgramIndex,
  resolvedOrdinal,
  onAssignProgramToGroup,
  onToggleInlineNotes,
  onCopyRowLabel,
  onNodeStatusChange,
}: BacklogProgramRowBlockProps) {
  const applicableColumns = rowColumns.filter(column => !column.showForTypes || column.showForTypes.includes(program.type))
  const shouldRenderTagSlot = rowPresetTags.visible.length > 0 || reserveTagsSlotWhenEmpty

  return (
    <div
      draggable={allowProgramLayoutEditing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'cursor-pointer overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        'border-b border-border/70 bg-card px-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
        selected && 'bg-accent/40',
        dragOver && 'ring-2 ring-primary/40 bg-primary/5',
        dragOver && dragOverEdge === 'before' && 'shadow-[inset_0_2px_0_rgba(59,130,246,0.7)]',
        dragOver && dragOverEdge === 'after' && 'shadow-[inset_0_-2px_0_rgba(59,130,246,0.7)]',
        newlyCreated && 'bg-emerald-100/80 ring-2 ring-emerald-400/70',
      )}
      onClick={onSelectProgram}
    >
      <div className="flex min-w-max items-center gap-2">
      {resolvedOrdinal !== null && !(allowProgramLayoutEditing && onSetProgramIndex) && (
        <sup
          aria-hidden="true"
          className="-ml-1.5 mr-0.5 mt-0.5 self-start font-mono text-[8px] leading-none tabular-nums text-muted-foreground/45"
        >
          {formatRowOrdinal((resolvedOrdinal ?? (programIndex + 1)) - 1)}
        </sup>
      )}
      {allowProgramLayoutEditing && resolvedOrdinal !== null && (
        onSetProgramIndex ? (
          <div
            className="mr-0.5 flex items-center"
            onClick={(event) => { event.preventDefault(); event.stopPropagation() }}
          >
            <ProgramSortOrdinalInputBlock
              value={resolvedOrdinal ?? (programIndex + 1)}
              onCommit={(next) => onSetProgramIndex(next - 1)}
            />
          </div>
        ) : (
          <div
            className="mr-0.5 flex items-center gap-0.5"
            onClick={(event) => { event.preventDefault(); event.stopPropagation() }}
          >
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title="Move up"
              onClick={onMoveProgramUp}
              disabled={programIndex <= 0}
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title="Move down"
              onClick={onMoveProgramDown}
              disabled={programIndex >= (programCount - 1)}
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
        )
      )}
      {showNodeTypeIcon && <FolderTree className="h-4 w-4 shrink-0 text-sky-600" />}
      <div className={cn(
        'min-w-0 flex gap-2',
        titleColumnClassName ? ['shrink-0', titleColumnClassName] : 'flex-1',
        'items-center',
      )} style={scaledWidthStyleFromClassBlock(titleColumnClassName)}>
        {ticketBadge}
        {titlePrefixSlot}
        <span className={cn(
          'min-w-0 text-sm font-bold',
          wrapTitleText ? 'break-words whitespace-normal leading-snug' : 'flex-1 truncate',
        )}>
          {nodeTitleWithoutTicket(program) || nodeDisplayTitle(program) || 'Untitled'}
        </span>
      </div>
      {applicableColumns.length > 0 && (
        <div className={cn(
          'items-center gap-2',
          showRowColumnsOnCompact ? 'flex' : 'hidden xl:flex',
        )}>
          {applicableColumns.map(column => {
            const content = column.render(program)
            return (
              <div
                key={`${program.uuid}-column-${column.id}`}
                className={cn(
                  'shrink-0 truncate text-xs text-muted-foreground',
                  column.widthClassName ?? 'w-24',
                  column.align === 'center' && 'text-center',
                  column.align === 'right' && 'text-right',
                )}
                style={scaledWidthStyleFromClassBlock(column.widthClassName ?? 'w-24')}
                title={typeof content === 'string' ? content : undefined}
              >
                {content}
              </div>
            )
          })}
        </div>
      )}
      {linksBeforeTags && linksSlot}
      {shouldRenderTagSlot && (
        <div className={cn(
          'flex self-center items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          actionsRightEdge && !statusRightAligned && !linksSlot && 'ml-auto',
          rowPresetTagsClassName ?? (actionsRightEdge ? 'min-w-0 flex-1 justify-end' : 'max-w-[35%]'),
        )} style={scaledWidthStyleFromClassBlock(
          rowPresetTagsClassName ?? (actionsRightEdge ? 'min-w-0 flex-1 justify-end' : 'max-w-[35%]'),
        )}>
          <TagChipListBlock
            tags={rowPresetTags.visible}
            variant="solid"
            className="flex-nowrap"
            chipClassName="truncate"
            overflowCount={rowPresetTags.hiddenCount}
            getTagColor={(tag) => lookupTagColor(program, tag)}
            keyPrefix={`${program.uuid}-preset-row-tag`}
          />
        </div>
      )}
      {!linksBeforeTags && linksSlot}
      {showProgramStatus && (
        readOnly || !canEditNodeStatus ? (
          <div className={cn(
            'shrink-0 self-center',
            actionsRightEdge && (statusRightAligned || (!linksSlot && !shouldRenderTagSlot)) && 'ml-auto',
          )}>
            <NodeStatusBadgeBlock status={program.status} />
          </div>
        ) : (
          <div
            className={cn(
              'flex self-center items-center gap-1',
              actionsRightEdge && (statusRightAligned || (!linksSlot && !shouldRenderTagSlot)) && 'ml-auto',
            )}
            onPointerDown={(event) => { event.stopPropagation() }}
            onMouseDown={(event) => { event.stopPropagation() }}
            onClick={(event) => { event.stopPropagation() }}
          >
            {statusBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <NodeStatusSelectBlock
                status={program.status}
                onChange={onNodeStatusChange}
                variant="pill"
                title="Change status"
              />
            )}
          </div>
        )
      )}
      {canAssignToGroup && (
        <div
          className="hidden self-center items-center md:flex"
          onClick={(event) => { event.preventDefault(); event.stopPropagation() }}
        >
          <select
            value={assignedGroupId}
            onChange={(event) => {
              const nextValue = event.target.value
              onAssignProgramToGroup(nextValue === '__ungrouped__' ? null : nextValue)
            }}
            className="h-6 max-w-[140px] rounded-md border border-input bg-background px-1.5 text-[10px] text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            title="Assign group"
          >
            <option value="__ungrouped__">Ungrouped</option>
            {programGroups.map(group => (
              <option key={`${program.uuid}-group-opt-${group.id}`} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {canToggleDetails && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleInlineNotes()
          }}
          className={cn(
            'self-center rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            detailsOpen
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          title="Details"
          disabled={inlineNotesSaving}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      )}
      {showProgramCopyButton && (
        <button
          type="button"
          draggable={false}
          onClick={onCopyRowLabel}
          className="self-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={copied ? 'Copied' : 'Copy row label'}
          aria-label={copied ? `Copied row label ${nodeDisplayTitle(program)}` : `Copy row label ${nodeDisplayTitle(program)}`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      {showPriorityDot && <span className="self-center"><PriorityDot priority={program.priority} /></span>}
      </div>
    </div>
  )
}
