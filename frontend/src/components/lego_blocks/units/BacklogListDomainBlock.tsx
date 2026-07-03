import { BookOpen, Folder, FolderTree, Handshake, Layers, Lightbulb, ListChecks, MessageSquare, Play } from 'lucide-react'
import type { ComponentType, DragEvent } from 'react'
import { cn } from '@/lib/utils'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import { normalizeTagBlock, normalizeTagListBlock } from '@/services/lego_blocks/units/tagBlock'
import type { NodePriority, NodeStatus, NodeType, YAMLCommentEntry } from '@/services/lego_blocks/units/yamlNoteBlock'

export function iconForNodeType(type: NodeType): ComponentType<{ className?: string }> {
  if (type === 'program') return FolderTree
  if (type === 'epic') return Layers
  if (type === 'idea_bucket') return BookOpen
  if (type === 'idea') return Lightbulb
  if (type === 'thought_bucket') return Folder
  if (type === 'thought') return MessageSquare
  if (type === 'task') return ListChecks
  if (type === 'run') return Play
  if (type === 'handoff') return Handshake
  return Lightbulb
}

export function iconColorForNodeType(type: NodeType): string {
  if (type === 'program') return 'text-sky-600 dark:text-sky-400'
  if (type === 'epic') return 'text-violet-600 dark:text-violet-400'
  if (type === 'idea_bucket') return 'text-indigo-600 dark:text-indigo-400'
  if (type === 'idea') return 'text-amber-600 dark:text-amber-400'
  if (type === 'thought_bucket') return 'text-emerald-600 dark:text-emerald-400'
  if (type === 'thought') return 'text-cyan-600 dark:text-cyan-400'
  if (type === 'task') return 'text-rose-600 dark:text-rose-400'
  if (type === 'run') return 'text-blue-700 dark:text-blue-300'
  if (type === 'handoff') return 'text-fuchsia-700 dark:text-fuchsia-300'
  return 'text-muted-foreground'
}

export const TASK_STATUS_COLORS = {
  ready: 'bg-indigo-500/15 dark:bg-indigo-500/25 text-indigo-700 dark:text-indigo-300',
  in_progress: 'bg-emerald-500/15 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300',
  blocked: 'bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300',
  done: 'bg-blue-500/15 dark:bg-blue-500/25 text-blue-700 dark:text-blue-300',
  cancelled: 'bg-zinc-500/15 text-zinc-500',
} as const

export const TASK_STATUS_OPTIONS = ['ready', 'in_progress', 'blocked', 'done', 'cancelled'] as const

export type TaskStatusOption = (typeof TASK_STATUS_OPTIONS)[number]

const PRIORITY_COLORS: Record<NonNullable<NodePriority>, string> = {
  low: 'bg-zinc-400',
  medium: 'bg-blue-400',
  high: 'bg-amber-400',
  critical: 'bg-red-500',
}

export function taskStatusLabel(taskStatus: TaskStatusOption): string {
  return taskStatus.replace(/_/g, ' ')
}

export const EPIC_BORDER_PALETTE = [
  'border-l-blue-500',
  'border-l-violet-500',
  'border-l-emerald-500',
  'border-l-amber-500',
  'border-l-rose-500',
  'border-l-cyan-500',
  'border-l-fuchsia-500',
  'border-l-lime-500',
]

export const EPIC_ICON_COLOR_BY_BORDER: Record<string, string> = {
  'border-l-blue-500': 'text-blue-600 dark:text-blue-400',
  'border-l-violet-500': 'text-violet-600 dark:text-violet-400',
  'border-l-emerald-500': 'text-emerald-600 dark:text-emerald-400',
  'border-l-amber-500': 'text-amber-600 dark:text-amber-400',
  'border-l-rose-500': 'text-rose-600 dark:text-rose-400',
  'border-l-cyan-500': 'text-cyan-600 dark:text-cyan-400',
  'border-l-fuchsia-500': 'text-fuchsia-600 dark:text-fuchsia-400',
  'border-l-lime-500': 'text-lime-600 dark:text-lime-400',
  'border-l-sky-500': 'text-sky-600 dark:text-sky-400',
  'border-l-purple-500': 'text-purple-600 dark:text-purple-400',
  'border-l-red-500': 'text-red-600 dark:text-red-400',
  'border-l-teal-500': 'text-teal-600 dark:text-teal-400',
  'border-l-indigo-500': 'text-indigo-600 dark:text-indigo-400',
  'border-l-pink-500': 'text-pink-600 dark:text-pink-400',
  'border-l-orange-500': 'text-orange-600 dark:text-orange-400',
}

export const NEW_ROW_HIGHLIGHT_MS = 2200

export const ROOT_INPUT_KEY = '__root__'

export type DropEdge = 'before' | 'after'

export interface ChildStateBlock {
  loading: boolean
  loaded: boolean
  nodes: NodeRecord[]
  error: string | null
}

export function formatRowOrdinal(index: number): string {
  if (!Number.isFinite(index) || index < 0) return '0'
  return String(index + 1)
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

export function selectedPresetTagsForNode(
  node: NodeRecord,
  projectPresetTagsByRoot: Record<string, string[]>,
): string[] {
  const projectRoot = normalizePath(node.projectRoot ?? '')
  if (!projectRoot) return []
  const presetTags = projectPresetTagsByRoot[projectRoot] ?? []
  if (presetTags.length === 0) return []
  const presetLookup = new Set(presetTags.map(tag => normalizeTagBlock(tag).toLowerCase()).filter(Boolean))
  const assignedProjectPresetTags = normalizeTagListBlock(node.projectPresetTags ?? [])
  if (assignedProjectPresetTags.length > 0) {
    return assignedProjectPresetTags.filter(tag => presetLookup.has(normalizeTagBlock(tag).toLowerCase()))
  }
  // Backward-compat fallback for older notes where project selections were merged into `tags`.
  return (node.tags ?? []).filter(tag => presetLookup.has(normalizeTagBlock(tag).toLowerCase()))
}

export function compactTagList(tags: string[], limit = Infinity): { visible: string[]; hiddenCount: number } {
  if (tags.length <= limit) return { visible: tags, hiddenCount: 0 }
  return {
    visible: tags.slice(0, limit),
    hiddenCount: tags.length - limit,
  }
}

export function TaskStatusBadge({ taskStatus }: { taskStatus: TaskStatusOption }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', TASK_STATUS_COLORS[taskStatus])}>
      {taskStatus}
    </span>
  )
}

export function PriorityDot({ priority }: { priority?: NodePriority }) {
  if (!priority) return null
  return (
    <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', PRIORITY_COLORS[priority])} title={priority} />
  )
}

export function nodeTypeLabel(type: NodeType): string {
  const labels: Record<NodeType, string> = {
    program: 'Program',
    epic: 'Epic',
    idea_bucket: 'Idea Bucket',
    idea: 'Idea',
    thought_bucket: 'Thought Bucket',
    thought: 'Thought',
    task: 'Task',
    run: 'Run',
    handoff: 'Handoff',
  }
  return labels[type]
}

export function allowedCreateTypes(parent: NodeRecord | null): NodeType[] {
  if (!parent) return ['program']
  const all: NodeType[] = ['epic', 'idea_bucket', 'idea', 'thought_bucket', 'thought', 'task', 'run', 'handoff']
  const preferred: NodeType =
    parent.type === 'program' ? 'epic'
      : parent.type === 'epic' ? 'epic'
        : parent.type === 'idea_bucket' ? 'idea'
          : parent.type === 'idea' ? 'thought_bucket'
            : parent.type === 'thought_bucket' ? 'thought'
              : 'thought'
  return [preferred, ...all.filter(type => type !== preferred)]
}

export function hasNodeDragType(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer.types)
  return types.includes('application/x-ltm-node-id') || types.includes('text/ltm-node-id')
}

export function readDroppedNodeId(event: DragEvent): string | null {
  const explicit = event.dataTransfer.getData('application/x-ltm-node-id').trim()
  if (explicit) return explicit
  const textFallback = event.dataTransfer.getData('text/ltm-node-id').trim()
  if (textFallback) return textFallback
  const plain = event.dataTransfer.getData('text/plain').trim()
  if (plain.startsWith('ltm-node:')) return plain.slice('ltm-node:'.length).trim() || null
  return null
}

export function nodeDisplayTitle(node: NodeRecord): string {
  const title = node.title?.trim() ?? ''
  const ticket = node.ticket?.trim() ?? ''
  if (!ticket) return title
  if (!title) return ticket
  if (title.startsWith(ticket)) return title
  return `${ticket} - ${title}`
}

export function nodeTitleWithoutTicket(node: NodeRecord): string {
  const title = node.title?.trim() ?? ''
  const ticket = node.ticket?.trim() ?? ''
  if (!ticket) return title
  if (!title) return ''
  if (title === ticket) return ''
  if (title.startsWith(`${ticket} - `)) return title.slice(ticket.length + 3).trim()
  if (title.startsWith(`${ticket} `)) return title.slice(ticket.length + 1).trim()
  return title
}

export async function copyTextToClipboard(text: string): Promise<void> {
  const normalized = text.trim()
  if (!normalized) return

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized)
    return
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard API is unavailable in this runtime.')
  }

  const textarea = document.createElement('textarea')
  textarea.value = normalized
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) {
    throw new Error('Failed to copy text to clipboard.')
  }
}

export function isTaskNode(node: NodeRecord): boolean {
  return node.type === 'task' || node.recordKind === 'task' || !!node.taskStatus
}

function normalizeTaskStatus(value: string | undefined): keyof typeof TASK_STATUS_COLORS | null {
  if (!value) return null
  const canonical = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (!canonical) return null
  if (canonical === 'inprogress' || canonical === 'doing' || canonical === 'underway') return 'in_progress'
  if (canonical === 'open' || canonical === 'todo' || canonical === 'to_do' || canonical === 'pending' || canonical === 'backlog') return 'ready'
  if (canonical === 'stuck' || canonical === 'waiting' || canonical === 'on_hold' || canonical === 'paused') return 'blocked'
  if (canonical === 'complete' || canonical === 'completed' || canonical === 'closed' || canonical === 'resolved' || canonical === 'shipped') return 'done'
  if (canonical === 'archived' || canonical === 'canceled' || canonical === 'dropped') return 'cancelled'
  if (canonical in TASK_STATUS_COLORS) return canonical as keyof typeof TASK_STATUS_COLORS
  return null
}

function taskStatusFromNodeStatus(status: NodeStatus): TaskStatusOption {
  if (status === 'completed') return 'done'
  if (status === 'archived' || status === 'cancelled') return 'cancelled'
  if (status === 'taken') return 'in_progress'
  if (status === 'planned') return 'ready'
  if (status === 'watchlist') return 'blocked'
  if (status === 'incomplete') return 'ready'
  if (status === 'paused') return 'blocked'
  return 'in_progress'
}

export function getTaskStatusBadge(node: NodeRecord): TaskStatusOption {
  return normalizeTaskStatus(node.taskStatus) ?? taskStatusFromNodeStatus(node.status)
}

export function notesSignature(description: string, comments: YAMLCommentEntry[]): string {
  return JSON.stringify({
    description: description.trim(),
    comments,
  })
}

function displaySortOrder(node: Pick<NodeRecord, 'sortOrder'>): number {
  return typeof node.sortOrder === 'number' && Number.isFinite(node.sortOrder)
    ? node.sortOrder
    : Number.POSITIVE_INFINITY
}

function compareNodeDisplayOrder(a: NodeRecord, b: NodeRecord): number {
  const byOrder = displaySortOrder(a) - displaySortOrder(b)
  if (byOrder !== 0) return byOrder
  const byTitle = (a.title ?? '').localeCompare(b.title ?? '')
  if (byTitle !== 0) return byTitle
  return (a.key ?? '').localeCompare(b.key ?? '')
}

export function sortNodesForDisplay(nodes: NodeRecord[]): NodeRecord[] {
  return [...nodes].sort(compareNodeDisplayOrder)
}

export function reorderNodesWithEdge(
  nodes: NodeRecord[],
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): NodeRecord[] | null {
  const sourceNode = nodes.find(node => node.uuid === sourceId)
  if (!sourceNode) return null
  const withoutSource = nodes.filter(node => node.uuid !== sourceId)
  const targetIndex = withoutSource.findIndex(node => node.uuid === targetId)
  if (targetIndex < 0) return null

  const insertAt = edge === 'after' ? targetIndex + 1 : targetIndex
  withoutSource.splice(insertAt, 0, sourceNode)
  return withoutSource
}
