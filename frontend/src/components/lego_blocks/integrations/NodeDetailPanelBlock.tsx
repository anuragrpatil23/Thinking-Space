import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Folder,
  FolderTree,
  Layers,
  Lightbulb,
  Loader2,
  ListChecks,
  MessageSquare,
  Reply,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Handshake,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  markdownMathRehypePluginsBlock,
  markdownMathRemarkPluginsBlock,
} from '@/services/lego_blocks/integrations/markdownMathPluginsBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/lego_blocks/units/ui/select'
import ExtensionSlotBlock from '@/components/lego_blocks/integrations/ExtensionSlotBlock'
import MarkdownRichEditorBlock from '@/components/lego_blocks/integrations/MarkdownRichEditorLazyBlock'
import UniversalSearchBlock from '@/components/lego_blocks/integrations/UniversalSearchBlock'
import { buildPathSearchCandidatesBlock } from '@/components/lego_blocks/integrations/universalSearchPresetBlock'
import LinkedItemChipsBlock from '@/components/lego_blocks/units/LinkedItemChipsBlock'
import { NodeStatusSelectBlock } from '@/components/lego_blocks/units/NodeStatusBlock'
import {
  TagListEditorBlock,
  TagPresetSelectorBlock,
} from '@/components/lego_blocks/integrations/TagManagerBlock'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import type { NodeType, NodePriority, NodeStatus, YAMLCommentEntry, YAMLFrontmatter } from '@/services/lego_blocks/units/yamlNoteBlock'
import {
  normalizeTagBlock,
  normalizeTagListBlock,
  splitTagInputBlock,
  tagsEqualBlock,
} from '@/services/lego_blocks/units/tagBlock'
import {
  getCommentAuthorSymbolBlock,
  getUserCommentAuthorBlock,
} from '@/services/lego_blocks/units/userProfileBlock'

function iconForNodeType(type: NodeType) {
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

function labelForNodeType(type: NodeType): string {
  const map: Record<NodeType, string> = {
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
  return map[type] ?? 'Node'
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return 'time unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'time unknown'
  return date.toLocaleString()
}

function toDateInputValue(value: string | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function initialsForAuthor(value: string | undefined): string {
  const currentUserSymbol = getCommentAuthorSymbolBlock(value)
  if (currentUserSymbol) return currentUserSymbol
  const normalized = (value ?? '').trim()
  if (!normalized) return 'NA'
  const tokens = normalized.split(/[\s._-]+/).filter(Boolean)
  if (tokens.length === 0) return normalized.slice(0, 2).toUpperCase()
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase()
  return `${tokens[0][0] ?? ''}${tokens[1][0] ?? ''}`.toUpperCase()
}

const PRIORITY_OPTIONS: NodePriority[] = ['low', 'medium', 'high', 'critical']
const TASK_STATUS_OPTIONS = ['ready', 'in_progress', 'blocked', 'done', 'cancelled'] as const

function normalizeTaskStatus(value: string | undefined): (typeof TASK_STATUS_OPTIONS)[number] | null {
  if (!value) return null
  const canonical = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (!canonical) return null
  if (canonical === 'inprogress' || canonical === 'doing' || canonical === 'underway') return 'in_progress'
  if (canonical === 'open' || canonical === 'todo' || canonical === 'to_do' || canonical === 'pending' || canonical === 'backlog') return 'ready'
  if (canonical === 'stuck' || canonical === 'waiting' || canonical === 'on_hold' || canonical === 'paused') return 'blocked'
  if (canonical === 'complete' || canonical === 'completed' || canonical === 'closed' || canonical === 'resolved' || canonical === 'shipped') return 'done'
  if (canonical === 'archived' || canonical === 'canceled' || canonical === 'dropped') return 'cancelled'
  if (TASK_STATUS_OPTIONS.includes(canonical as (typeof TASK_STATUS_OPTIONS)[number])) {
    return canonical as (typeof TASK_STATUS_OPTIONS)[number]
  }
  return null
}

function taskStatusFromNodeStatus(status: NodeStatus): (typeof TASK_STATUS_OPTIONS)[number] {
  if (status === 'completed') return 'done'
  if (status === 'archived' || status === 'cancelled') return 'cancelled'
  if (status === 'taken') return 'in_progress'
  if (status === 'planned') return 'ready'
  if (status === 'watchlist') return 'blocked'
  if (status === 'incomplete') return 'ready'
  if (status === 'paused') return 'blocked'
  return 'in_progress'
}

function normalizeRelatedNodePathBlock(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
}

function relatedNodeLabelFromPathBlock(path: string): string {
  const normalized = normalizeRelatedNodePathBlock(path)
  const base = normalized.split('/').pop() || normalized
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base
}

function relatedNodesEqualBlock(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export interface NodeDetailPanelBlockProps {
  node: NodeRecord
  frontmatter?: YAMLFrontmatter | null
  onClose: () => void
  onRename: (newTitle: string) => Promise<void>
  onUpdateStatus: (status: string) => Promise<void>
  onUpdateTaskStatus: (taskStatus: string) => Promise<void>
  onUpdatePriority: (priority: string) => Promise<void>
  onUpdateTags: (tags: string[]) => Promise<void>
  onUpdateProjectPresetTags: (tags: string[]) => Promise<void>
  presetTags?: string[]
  projectTagColors?: Record<string, string>
  allowProjectPresetTagCreation?: boolean
  relatedNodeOptions?: Array<{
    path: string
    label: string
    summary?: string
  }>
  onUpdateRelatedNodes?: (relatedNodes: string[]) => Promise<void>
  onOpenRelatedNode?: (path: string) => void
  onUpdateNotes: (description: string, comments: YAMLCommentEntry[]) => Promise<void>
  noteBody?: string
  onUpdateNoteBody?: (body: string) => Promise<void>
  noteBodyLabel?: string
  noteBodyPlaceholder?: string
  onUpdateEpicCompletedAt?: (completionDate: string | null) => Promise<void>
  onOpenFile: () => void
  onDelete?: () => Promise<void>
}

export default function NodeDetailPanelBlock({
  node,
  frontmatter,
  onClose,
  onRename,
  onUpdateStatus,
  onUpdateTaskStatus,
  onUpdatePriority,
  onUpdateTags,
  onUpdateProjectPresetTags,
  presetTags = [],
  projectTagColors = {},
  allowProjectPresetTagCreation = false,
  relatedNodeOptions = [],
  onUpdateRelatedNodes,
  onOpenRelatedNode,
  onUpdateNotes,
  noteBody,
  onUpdateNoteBody,
  noteBodyLabel = 'Note',
  noteBodyPlaceholder = 'Add notes...',
  onUpdateEpicCompletedAt,
  onOpenFile,
  onDelete,
}: NodeDetailPanelBlockProps) {
  const separatorBorderClassName = 'border-border/70'
  const [titleDraft, setTitleDraft] = useState(node.title)
  const [busy, setBusy] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [commentsDraft, setCommentsDraft] = useState<YAMLCommentEntry[]>([])
  const [newCommentDraft, setNewCommentDraft] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesAutoSaving, setNotesAutoSaving] = useState(false)
  const [manualSaveFeedbackVisible, setManualSaveFeedbackVisible] = useState(false)
  const [epicCompletionDateDraft, setEpicCompletionDateDraft] = useState('')
  const [epicCompletionSaving, setEpicCompletionSaving] = useState(false)
  const [userTagDraft, setUserTagDraft] = useState('')
  const [projectPresetTagDraft, setProjectPresetTagDraft] = useState('')
  const [tagsSaving, setTagsSaving] = useState(false)
  const [relatedNodeQuery, setRelatedNodeQuery] = useState('')
  const [relatedNodesSaving, setRelatedNodesSaving] = useState(false)
  const [noteBodyDraft, setNoteBodyDraft] = useState('')
  const [noteBodySaving, setNoteBodySaving] = useState(false)
  const [noteBodyEditMode, setNoteBodyEditMode] = useState(false)
  const [activityTab, setActivityTab] = useState<'all' | 'comments' | 'history' | 'worklog'>('comments')
  const [descriptionEditMode, setDescriptionEditMode] = useState(false)
  const notesAutoSaveSignatureRef = useRef<string | null>(null)
  const manualSaveFeedbackTimeoutRef = useRef<number | null>(null)
  const lastNodeUuidRef = useRef<string | null>(null)

  useEffect(() => {
    setTitleDraft(node.title)
  }, [node.title])

  const sourceDescription = useMemo(
    () => (node.description ?? frontmatter?.description ?? '').trim(),
    [frontmatter?.description, node.description],
  )
  const sourceComments = useMemo(
    () => (node.comments ?? frontmatter?.comments ?? []),
    [frontmatter?.comments, node.comments],
  )
  const sourceEpicCompletionDate = useMemo(() => {
    const fromFrontmatter = typeof frontmatter?.epic_completed_at === 'string'
      ? frontmatter.epic_completed_at
      : undefined
    return toDateInputValue(fromFrontmatter ?? node.epicCompletedAt)
  }, [frontmatter?.epic_completed_at, node.epicCompletedAt])
  const sourceAllTags = useMemo(
    () => normalizeTagListBlock(frontmatter?.tags ?? node.tags ?? []),
    [frontmatter?.tags, node.tags],
  )
  const sourcePresetTags = useMemo(() => normalizeTagListBlock(presetTags), [presetTags])
  const sourceProjectPresetTags = useMemo(() => {
    const explicit = normalizeTagListBlock(frontmatter?.project_preset_tags ?? node.projectPresetTags ?? [])
    if (explicit.length > 0) return explicit
    // Backward-compat fallback for older notes where project selections were merged into tags.
    const presetLookup = new Set(sourcePresetTags.map(tag => normalizeTagBlock(tag).toLowerCase()).filter(Boolean))
    return sourceAllTags.filter(tag => presetLookup.has(normalizeTagBlock(tag).toLowerCase()))
  }, [frontmatter?.project_preset_tags, node.projectPresetTags, sourceAllTags, sourcePresetTags])
  const sourceUserTags = useMemo(() => {
    const projectPresetLookup = new Set(sourceProjectPresetTags.map(tag => normalizeTagBlock(tag).toLowerCase()).filter(Boolean))
    return sourceAllTags.filter(tag => !projectPresetLookup.has(normalizeTagBlock(tag).toLowerCase()))
  }, [sourceAllTags, sourceProjectPresetTags])
  const sourceRelatedNodes = useMemo(() => {
    const fromFrontmatter = Array.isArray(frontmatter?.related_nodes)
      ? frontmatter.related_nodes.filter((value): value is string => typeof value === 'string')
      : []
    const raw = fromFrontmatter.length > 0 ? fromFrontmatter : (node.relatedNodes ?? [])
    const normalized = raw
      .map(value => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim())
      .filter(Boolean)
    return [...new Set(normalized)]
  }, [frontmatter?.related_nodes, node.relatedNodes])
  const sourceNoteBody = useMemo(() => noteBody ?? '', [noteBody])

  useEffect(() => {
    const nodeChanged = lastNodeUuidRef.current !== node.uuid
    lastNodeUuidRef.current = node.uuid
    setDescriptionDraft(sourceDescription)
    setCommentsDraft(sourceComments)
    setNewCommentDraft('')
    setNotesSaving(false)
    setNotesAutoSaving(false)
    setManualSaveFeedbackVisible(false)
    setEpicCompletionDateDraft(sourceEpicCompletionDate)
    setEpicCompletionSaving(false)
    setActivityTab('comments')
    if (nodeChanged) {
      setDescriptionEditMode(false)
      setNoteBodyEditMode(false)
    }
    notesAutoSaveSignatureRef.current = null
  }, [node.uuid, sourceComments, sourceDescription, sourceEpicCompletionDate])

  useEffect(() => {
    return () => {
      if (manualSaveFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(manualSaveFeedbackTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setUserTagDraft('')
    setProjectPresetTagDraft('')
    setTagsSaving(false)
    setRelatedNodeQuery('')
    setRelatedNodesSaving(false)
  }, [node.uuid])

  useEffect(() => {
    setNoteBodyDraft(sourceNoteBody)
    setNoteBodySaving(false)
  }, [node.uuid, sourceNoteBody])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const commitRename = useCallback(async () => {
    const next = titleDraft.replace(/\s+/g, ' ').trim()
    if (!next || next === node.title) return
    setBusy(true)
    try {
      await onRename(next)
    } finally {
      setBusy(false)
    }
  }, [node.title, onRename, titleDraft])

  const handleDelete = useCallback(async () => {
    if (!onDelete) return
    setBusy(true)
    try {
      await onDelete()
      onClose()
    } finally {
      setBusy(false)
    }
  }, [onClose, onDelete])

  const Icon = iconForNodeType(node.type)
  const taskLikeNode = node.type === 'task' || node.recordKind === 'task' || !!node.taskStatus
  const statusEditable = !taskLikeNode
  const currentTaskStatus = useMemo(() => (
    normalizeTaskStatus(node.taskStatus) ?? taskStatusFromNodeStatus(node.status)
  ), [node.status, node.taskStatus])
  const commentsDirty = useMemo(() => {
    if (commentsDraft.length !== sourceComments.length) return true
    for (let i = 0; i < commentsDraft.length; i += 1) {
      if (commentsDraft[i].text !== sourceComments[i].text) return true
      if ((commentsDraft[i].added_at ?? '') !== (sourceComments[i].added_at ?? '')) return true
      if ((commentsDraft[i].added_by ?? '') !== (sourceComments[i].added_by ?? '')) return true
    }
    return false
  }, [commentsDraft, sourceComments])
  const notesDirty = descriptionDraft.trim() !== sourceDescription || commentsDirty
  const noteBodyDirty = onUpdateNoteBody ? noteBodyDraft !== sourceNoteBody : false
  const notesPayloadSignature = useMemo(() => JSON.stringify({
    description: descriptionDraft.trim(),
    comments: commentsDraft,
  }), [commentsDraft, descriptionDraft])
  const orderedComments = useMemo(() => (
    commentsDraft.map((comment, index) => ({ comment, index })).reverse()
  ), [commentsDraft])
  const yamlFields = useMemo(() => {
    if (!frontmatter) return []
    return Object.entries(frontmatter)
      .filter(([key, value]) => (
        key !== 'description' &&
        key !== 'comments' &&
        key !== 'tags' &&
        key !== 'project_preset_tags' &&
        key !== 'related_nodes' &&
        value !== undefined &&
        value !== null &&
        value !== ''
      ))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [frontmatter])

  function renderYamlInlineValue(value: unknown): string {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return value.map(renderYamlInlineValue).join(', ')
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const addComment = useCallback(() => {
    const next = newCommentDraft.trim()
    if (!next) return
    setCommentsDraft(prev => [
      ...prev,
      {
        text: next,
        added_at: new Date().toISOString(),
        added_by: getUserCommentAuthorBlock(),
      },
    ])
    setNewCommentDraft('')
  }, [newCommentDraft])

  const removeComment = useCallback((index: number) => {
    setCommentsDraft(prev => prev.filter((_, idx) => idx !== index))
  }, [])

  const triggerManualSaveFeedback = useCallback(() => {
    if (manualSaveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(manualSaveFeedbackTimeoutRef.current)
    }
    setManualSaveFeedbackVisible(true)
    manualSaveFeedbackTimeoutRef.current = window.setTimeout(() => {
      setManualSaveFeedbackVisible(false)
      manualSaveFeedbackTimeoutRef.current = null
    }, 1600)
  }, [])

  const commitNotes = useCallback(async (mode: 'auto' | 'manual' = 'manual') => {
    if (!notesDirty || notesSaving) return
    setNotesSaving(true)
    setNotesAutoSaving(mode === 'auto')
    try {
      await onUpdateNotes(descriptionDraft.trim(), commentsDraft)
      if (mode === 'manual') {
        triggerManualSaveFeedback()
      }
    } finally {
      setNotesAutoSaving(false)
      setNotesSaving(false)
    }
  }, [commentsDraft, descriptionDraft, notesDirty, notesSaving, onUpdateNotes, triggerManualSaveFeedback])

  const handleManualSaveClick = useCallback(() => {
    if (notesSaving) return
    if (!notesDirty) {
      triggerManualSaveFeedback()
      return
    }
    notesAutoSaveSignatureRef.current = notesPayloadSignature
    void commitNotes('manual')
  }, [commitNotes, notesDirty, notesPayloadSignature, notesSaving, triggerManualSaveFeedback])

  const handleOpenFile = useCallback(() => {
    onOpenFile()
    onClose()
  }, [onClose, onOpenFile])

  const commitEpicCompletionDate = useCallback(async () => {
    if (node.type !== 'epic' || !onUpdateEpicCompletedAt) return
    const normalizedDate = epicCompletionDateDraft.trim()
    if (normalizedDate === sourceEpicCompletionDate) return
    setBusy(true)
    setEpicCompletionSaving(true)
    try {
      await onUpdateEpicCompletedAt(normalizedDate || null)
    } finally {
      setEpicCompletionSaving(false)
      setBusy(false)
    }
  }, [epicCompletionDateDraft, node.type, onUpdateEpicCompletedAt, sourceEpicCompletionDate])

  const commitUserTags = useCallback(async (nextTags: string[]) => {
    const normalizedNextTags = normalizeTagListBlock(nextTags)
    if (tagsEqualBlock(normalizedNextTags, sourceUserTags)) return
    setBusy(true)
    setTagsSaving(true)
    try {
      await onUpdateTags(normalizedNextTags)
    } finally {
      setTagsSaving(false)
      setBusy(false)
    }
  }, [onUpdateTags, sourceUserTags])

  const commitProjectPresetTags = useCallback(async (nextTags: string[]) => {
    const normalizedNextTags = normalizeTagListBlock(nextTags)
    if (tagsEqualBlock(normalizedNextTags, sourceProjectPresetTags)) return
    setBusy(true)
    setTagsSaving(true)
    try {
      await onUpdateProjectPresetTags(normalizedNextTags)
    } finally {
      setTagsSaving(false)
      setBusy(false)
    }
  }, [onUpdateProjectPresetTags, sourceProjectPresetTags])

  const addUserTags = useCallback(async () => {
    const additions = splitTagInputBlock(userTagDraft)
    if (additions.length === 0) return
    const next = normalizeTagListBlock([...sourceUserTags, ...additions])
    await commitUserTags(next)
    setUserTagDraft('')
  }, [commitUserTags, sourceUserTags, userTagDraft])

  const removeUserTag = useCallback(async (tag: string) => {
    const target = normalizeTagBlock(tag).toLowerCase()
    if (!target) return
    const next = sourceUserTags.filter(item => normalizeTagBlock(item).toLowerCase() !== target)
    await commitUserTags(next)
  }, [commitUserTags, sourceUserTags])

  const togglePresetTagOnNode = useCallback(async (tag: string) => {
    const normalizedTag = normalizeTagBlock(tag)
    if (!normalizedTag) return
    const target = normalizedTag.toLowerCase()
    const next = sourceProjectPresetTags.some(item => normalizeTagBlock(item).toLowerCase() === target)
      ? sourceProjectPresetTags.filter(item => normalizeTagBlock(item).toLowerCase() !== target)
      : normalizeTagListBlock([...sourceProjectPresetTags, normalizedTag])
    await commitProjectPresetTags(next)
  }, [commitProjectPresetTags, sourceProjectPresetTags])

  const addProjectPresetTags = useCallback(async () => {
    if (!allowProjectPresetTagCreation) return
    const additions = splitTagInputBlock(projectPresetTagDraft)
    if (additions.length === 0) return
    const next = normalizeTagListBlock([...sourceProjectPresetTags, ...additions])
    await commitProjectPresetTags(next)
    setProjectPresetTagDraft('')
  }, [allowProjectPresetTagCreation, commitProjectPresetTags, projectPresetTagDraft, sourceProjectPresetTags])

  const relatedNodeOptionsByPath = useMemo(() => {
    const map = new Map<string, { path: string; label: string; summary?: string }>()
    for (const option of relatedNodeOptions) {
      const path = normalizeRelatedNodePathBlock(option.path)
      if (!path || map.has(path)) continue
      map.set(path, {
        path,
        label: option.label?.trim() || relatedNodeLabelFromPathBlock(path),
        summary: option.summary?.trim() || undefined,
      })
    }
    return map
  }, [relatedNodeOptions])

  const selectableRelatedNodeOptions = useMemo(() => {
    const selected = new Set(sourceRelatedNodes)
    return [...relatedNodeOptionsByPath.values()].filter(option => !selected.has(option.path))
  }, [relatedNodeOptionsByPath, sourceRelatedNodes])

  const sourceRelatedNodeEntries = useMemo(() => (
    sourceRelatedNodes.map(path => {
      const option = relatedNodeOptionsByPath.get(path)
      return {
        path,
        label: option?.label || relatedNodeLabelFromPathBlock(path),
        summary: option?.summary,
      }
    })
  ), [relatedNodeOptionsByPath, sourceRelatedNodes])

  const commitRelatedNodes = useCallback(async (nextRelatedNodes: string[]) => {
    if (!onUpdateRelatedNodes) return
    const normalizedNext = [...new Set(
      nextRelatedNodes
        .map(value => normalizeRelatedNodePathBlock(value))
        .filter(Boolean),
    )]
    if (relatedNodesEqualBlock(normalizedNext, sourceRelatedNodes)) return
    setBusy(true)
    setRelatedNodesSaving(true)
    try {
      await onUpdateRelatedNodes(normalizedNext)
    } finally {
      setRelatedNodesSaving(false)
      setBusy(false)
    }
  }, [onUpdateRelatedNodes, sourceRelatedNodes])

  const addRelatedNode = useCallback(async (path: string) => {
    const nextPath = normalizeRelatedNodePathBlock(path)
    if (!nextPath || sourceRelatedNodes.includes(nextPath)) {
      setRelatedNodeQuery('')
      return
    }
    await commitRelatedNodes([...sourceRelatedNodes, nextPath])
    setRelatedNodeQuery('')
  }, [commitRelatedNodes, sourceRelatedNodes])

  const removeRelatedNode = useCallback(async (path: string) => {
    const target = normalizeRelatedNodePathBlock(path)
    if (!target) return
    await commitRelatedNodes(sourceRelatedNodes.filter(value => value !== target))
  }, [commitRelatedNodes, sourceRelatedNodes])

  const commitNoteBody = useCallback(async () => {
    if (!onUpdateNoteBody || !noteBodyDirty || noteBodySaving) return
    setBusy(true)
    setNoteBodySaving(true)
    try {
      await onUpdateNoteBody(noteBodyDraft)
    } finally {
      setNoteBodySaving(false)
      setBusy(false)
    }
  }, [noteBodyDirty, noteBodyDraft, noteBodySaving, onUpdateNoteBody])

  const availableProjectPresetTags = useMemo(
    () => normalizeTagListBlock([...sourcePresetTags, ...sourceProjectPresetTags]),
    [sourcePresetTags, sourceProjectPresetTags],
  )

  useEffect(() => {
    if (!notesDirty || busy || notesSaving) return
    if (notesAutoSaveSignatureRef.current === notesPayloadSignature) return

    const timeoutId = window.setTimeout(() => {
      notesAutoSaveSignatureRef.current = notesPayloadSignature
      void commitNotes('auto')
    }, 900)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [busy, commitNotes, notesDirty, notesPayloadSignature, notesSaving])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[120] bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`fixed inset-y-0 right-0 z-[121] w-[min(96vw,58rem)] overflow-auto border-l bg-background pt-[max(env(safe-area-inset-top),3.5rem)] shadow-2xl animate-slide-in sm:pt-0 ${separatorBorderClassName}`}>
        <div className="flex flex-col gap-5 p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className="h-5 w-5 shrink-0" />
              <span className="text-xs font-medium uppercase tracking-wider">{labelForNodeType(node.type)}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Title input */}
          <textarea
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => { void commitRename() }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void commitRename()
              }
            }}
            rows={2}
            className={`w-full resize-none border-b bg-transparent pb-1 text-lg font-semibold leading-snug outline-none transition-colors focus:border-primary ${separatorBorderClassName}`}
            disabled={busy}
          />

          <div className={`flex flex-wrap items-center gap-2 border-b pb-3 ${separatorBorderClassName}`}>
            <Button
              size="sm"
              variant="outline"
              onClick={handleManualSaveClick}
              disabled={notesSaving}
              className={manualSaveFeedbackVisible && !notesSaving ? 'border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15' : undefined}
            >
              {notesSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : manualSaveFeedbackVisible ? 'Saved' : 'Save'}
            </Button>
            <Button size="sm" variant="outline" onClick={handleOpenFile}>
              Open File
            </Button>
            {onDelete ? (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => { void handleDelete() }}
                disabled={busy}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            ) : null}
            <span className="text-[11px] text-muted-foreground">
              {notesAutoSaving ? 'Auto-saving...' : (notesDirty ? 'Unsaved changes' : 'Auto-save on')}
            </span>
          </div>

          <div className="grid gap-3 rounded-md border border-border/60 bg-muted/20 p-3 md:grid-cols-3">
            {taskLikeNode ? (
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Task State</label>
                <Select
                  value={currentTaskStatus}
                  onValueChange={val => { void onUpdateTaskStatus(val) }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUS_OPTIONS.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</label>
                <NodeStatusSelectBlock
                  status={node.status}
                  onChange={val => { if (statusEditable) void onUpdateStatus(val) }}
                  disabled={!statusEditable}
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Priority</label>
              <Select
                value={node.priority ?? 'medium'}
                onValueChange={val => { void onUpdatePriority(val) }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {node.type === 'epic' && onUpdateEpicCompletedAt ? (
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Completion Date</label>
                <input
                  type="date"
                  value={epicCompletionDateDraft}
                  onChange={event => setEpicCompletionDateDraft(event.target.value)}
                  onBlur={() => { void commitEpicCompletionDate() }}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={busy}
                />
                <p className="text-[10px] text-muted-foreground">
                  {epicCompletionSaving ? 'Saving...' : 'Auto-set on completion. Cleared when marked incomplete.'}
                </p>
              </div>
            ) : (
              <div className="flex items-end">
                <ExtensionSlotBlock
                  slotId="thought-context-actions"
                  context={{
                    nodeUuid: node.uuid,
                    nodeKey: node.key,
                    nodeTitle: node.title,
                    nodeType: node.type,
                    filePath: node.filePath,
                    projectRoot: node.projectRoot ?? null,
                    parentKey: node.parent ?? null,
                  }}
                />
              </div>
            )}
          </div>

          {onUpdateNoteBody ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground">{noteBodyLabel}</label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {noteBodyDirty ? 'Unsaved note changes' : 'Saved'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setNoteBodyEditMode(prev => !prev)}
                  >
                    {noteBodyEditMode ? 'Done' : 'Edit'}
                  </Button>
                </div>
              </div>
              {noteBodyEditMode ? (
                <>
                  <MarkdownRichEditorBlock
                    value={noteBodyDraft}
                    onChange={setNoteBodyDraft}
                    currentPath={node.filePath}
                    placeholder={noteBodyPlaceholder}
                    className="min-h-[220px] rounded-md border border-input overflow-hidden"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setNoteBodyDraft(sourceNoteBody)}
                      disabled={busy || noteBodySaving || !noteBodyDirty}
                    >
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { void commitNoteBody() }}
                      disabled={busy || noteBodySaving || !noteBodyDirty}
                    >
                      {noteBodySaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save Note'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="prose prose-sm max-w-none rounded-md border border-border/60 bg-card p-3 leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm, ...markdownMathRemarkPluginsBlock]} rehypePlugins={markdownMathRehypePluginsBlock as any}>
                    {noteBodyDraft || '_No notes yet._'}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-foreground">Description</label>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setDescriptionEditMode(prev => !prev)}
              >
                {descriptionEditMode ? 'Done' : 'Edit'}
              </Button>
            </div>
            {descriptionEditMode ? (
              <MarkdownRichEditorBlock
                value={descriptionDraft}
                onChange={setDescriptionDraft}
                currentPath={node.filePath}
                placeholder="Add description..."
                className="min-h-[120px] rounded-md border border-input overflow-hidden"
              />
            ) : (
              <div className="prose prose-sm max-w-none rounded-md border border-border/60 bg-card p-3 leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm, ...markdownMathRemarkPluginsBlock]} rehypePlugins={markdownMathRehypePluginsBlock as any}>
                  {descriptionDraft || '_No description yet._'}
                </ReactMarkdown>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-md border border-border/60 bg-card p-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-foreground">Tags</label>
              <span className="text-[11px] text-muted-foreground">Shown in detail panel only</span>
            </div>

            <TagListEditorBlock
              heading="User Tags"
              tags={sourceUserTags}
              tagColors={projectTagColors}
              emptyMessage="No user tags yet."
              draftValue={userTagDraft}
              onDraftValueChange={setUserTagDraft}
              onAddTag={() => { void addUserTags() }}
              addPlaceholder="Add user tags (comma separated)"
              addDisabled={splitTagInputBlock(userTagDraft).length === 0}
              disabled={busy || tagsSaving}
              busy={tagsSaving}
              onRemoveTag={(tag) => { void removeUserTag(tag) }}
            />

            <TagPresetSelectorBlock
              heading="Project Tags"
              description="Project-scoped presets"
              tags={availableProjectPresetTags}
              tagColors={projectTagColors}
              selectedTags={sourceProjectPresetTags}
              emptyMessage="No preset tags yet for this project."
              onToggleTag={(tag) => { void togglePresetTagOnNode(tag) }}
              disabled={busy || tagsSaving}
              busy={tagsSaving}
            />
            {allowProjectPresetTagCreation ? (
              <TagListEditorBlock
                heading="Add Project Tags"
                tags={[]}
                emptyMessage="Add tags to this node's project-tag list."
                draftValue={projectPresetTagDraft}
                onDraftValueChange={setProjectPresetTagDraft}
                onAddTag={() => { void addProjectPresetTags() }}
                addPlaceholder="Add project tags (comma separated)"
                addDisabled={splitTagInputBlock(projectPresetTagDraft).length === 0}
                disabled={busy || tagsSaving}
                busy={tagsSaving}
              />
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-foreground">Subtasks</label>
            <p className="text-sm text-muted-foreground">Add subtask</p>
          </div>

          <div className="space-y-3 rounded-md border border-border/60 bg-card p-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-foreground">Linked items</label>
              <span className="text-[11px] text-muted-foreground">
                {relatedNodesSaving ? 'Saving...' : `${sourceRelatedNodes.length} linked`}
              </span>
            </div>
            {onUpdateRelatedNodes ? (
              <div className="space-y-1">
                <UniversalSearchBlock
                  items={selectableRelatedNodeOptions}
                  query={relatedNodeQuery}
                  onQueryChange={setRelatedNodeQuery}
                  onSelect={(item) => { void addRelatedNode(item.path) }}
                  getItemKey={(item) => item.path}
                  getItemLabel={(item) => item.label}
                  getItemDescription={(item) => item.summary}
                  getItemSearchCandidates={(item) => [
                    item.label,
                    item.path,
                    item.summary ?? '',
                    ...buildPathSearchCandidatesBlock(item.path),
                  ]}
                  placeholder={selectableRelatedNodeOptions.length > 0 ? 'Search note to link' : 'No available notes'}
                  emptyMessage="No available notes"
                  inputClassName="h-8 text-xs"
                  disabled={busy || relatedNodesSaving || selectableRelatedNodeOptions.length === 0}
                />
                <p className="text-[11px] text-muted-foreground">
                  Select a result to link it.
                </p>
              </div>
            ) : null}
            <LinkedItemChipsBlock
              items={sourceRelatedNodeEntries}
              onOpenItem={onOpenRelatedNode ? (path) => onOpenRelatedNode(path) : undefined}
              onRemoveItem={onUpdateRelatedNodes
                ? (path) => { void removeRelatedNode(path) }
                : undefined}
              removeDisabled={busy || relatedNodesSaving}
              emptyMessage="No linked items yet."
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-foreground">Activity</label>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>

            <div className="inline-flex rounded-md border border-border/70 bg-muted/30 p-0.5 text-xs">
              {[
                { key: 'all', label: 'All' },
                { key: 'comments', label: 'Comments' },
                { key: 'history', label: 'History' },
                { key: 'worklog', label: 'Work log' },
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  className={`rounded px-2 py-1 ${activityTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setActivityTab(tab.key as typeof activityTab)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="rounded-md border border-border/70 bg-card p-2.5">
              <div className="flex items-start gap-2">
                <div className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">
                  {initialsForAuthor(getUserCommentAuthorBlock())}
                </div>
                <div className="flex-1 space-y-2">
                  <textarea
                    value={newCommentDraft}
                    onChange={e => setNewCommentDraft(e.target.value)}
                    placeholder="Add a comment..."
                    className="min-h-[72px] w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                    disabled={busy}
                  />
                  <div className="flex flex-wrap gap-1">
                    {['Looks good!', 'Need help?', 'This is blocked...', 'Can you clarify...?', 'This is on track'].map(template => (
                      <button
                        key={template}
                        type="button"
                        className="rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => setNewCommentDraft(prev => (prev.trim() ? `${prev}\n\n${template}` : template))}
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Pro tip: press M to comment</span>
                    <Button size="sm" variant="outline" onClick={addComment} disabled={busy || !newCommentDraft.trim()}>
                      Add Comment
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {(activityTab === 'comments' || activityTab === 'all') ? (
              orderedComments.length > 0 ? (
                <div className="space-y-4">
                  {orderedComments.map(({ comment, index }) => (
                    <div key={`${comment.text}-${comment.added_at ?? index}`} className="space-y-1.5">
                      <div className="flex items-start gap-2">
                        <div className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-semibold text-white">
                          {initialsForAuthor(comment.added_by)}
                        </div>
                        <div className="flex-1 space-y-1">
                          <p className="text-sm font-semibold text-foreground">{comment.added_by ?? 'Unknown'}</p>
                          <p className="text-[11px] text-muted-foreground">{formatTimestamp(comment.added_at)}</p>
                          <div className="prose prose-sm max-w-none leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm, ...markdownMathRemarkPluginsBlock]} rehypePlugins={markdownMathRehypePluginsBlock as any}>
                              {comment.text}
                            </ReactMarkdown>
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <ThumbsUp className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                              <Reply className="h-3 w-3" />
                              Reply
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => removeComment(index)}
                              disabled={busy}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">No entries in this tab yet.</p>
            )}
          </div>

          <details className="rounded-md border border-border/60 bg-muted/15 p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Advanced metadata</summary>
            <div className="mt-2 space-y-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">File Path</label>
                <p className="break-all font-mono text-xs text-foreground/80">{node.filePath}</p>
              </div>
              {node.aiSummary && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">AI Summary</label>
                  <p className="text-sm text-muted-foreground">{node.aiSummary}</p>
                </div>
              )}
              {yamlFields.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Metadata</label>
                  <div className="space-y-1.5">
                    {yamlFields.map(([key, value]) => (
                      <p key={key} className="break-words text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{key}:</span> {renderYamlInlineValue(value)}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>

        </div>
      </div>
    </>,
    document.body,
  )
}
