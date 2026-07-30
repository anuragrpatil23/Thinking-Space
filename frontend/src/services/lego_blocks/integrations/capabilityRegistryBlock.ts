import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import type {
  NodePriority,
  NodeStatus,
  NodeType,
  YAMLCommentEntry,
  YAMLFrontmatter,
} from '@/services/lego_blocks/units/yamlNoteBlock'
import type {
  CleanResult,
  ConvertOptions,
  FormatOptions,
  FormatPreviewData,
  FormatResult,
  PdfConvertResult,
  PdfPreviewData,
  TranscriptOptions,
} from '@/services/lego_blocks/units/typesBlock'
import type { ExcalidrawHighlightsExtractBlock } from '@/services/lego_blocks/units/excalidrawHighlightExtractBlock'
import type { UndertakingRecord } from '@/services/lego_blocks/units/aiActivityUndertakingBlock'
import type { ChainEntry } from '@/services/lego_blocks/integrations/aiActivityChainIndexBlock'
import type { UndertakingView } from '@/services/orchestrators/aiActivityUndertakingOrch'

export interface CapabilityActor {
  kind: 'human' | 'agent' | 'system'
  id?: string
}

export type CapabilityName =
  | 'read_note'
  | 'write_note'
  | 'patch_note_frontmatter'
  | 'resolve_ai_synthesis_path'
  | 'create_ai_synthesis_note'
  | 'get_impacted_ai_synthesis_notes'
  | 'update_ai_synthesis_compile_state'
  | 'list_domain_ai_synthesis_health'
  | 'organizer.nodes.list_roots'
  | 'organizer.nodes.list_children'
  | 'organizer.nodes.list_all'
  | 'organizer.nodes.search'
  | 'organizer.node.get'
  | 'organizer.node.get_by_key'
  | 'organizer.node.read_frontmatter'
  | 'organizer.node.create'
  | 'organizer.node.rename'
  | 'organizer.node.update'
  | 'organizer.node.move'
  | 'organizer.node.delete'
  | 'task.claim'
  | 'task.update_status'
  | 'run.log'
  | 'handoff.create'
  | 'comment.add'
  | 'thoughts.create'
  | 'daily.log_insight'
  | 'todos.create'
  | 'todos.toggle'
  | 'tools.files.list_markdown'
  | 'tools.files.list_pdf'
  | 'tools.folders.list'
  | 'tools.excalidraw.preview'
  | 'tools.excalidraw.format'
  | 'tools.excalidraw.highlights'
  | 'tools.pdf.preview'
  | 'tools.pdf.convert'
  | 'tools.transcript.preview'
  | 'tools.transcript.clean_save'
  | 'telegram.send_message'
  | 'telegram.open_conversation'
  | 'telegram.close_conversation'
  | 'ai_activity.undertakings.list'
  | 'ai_activity.undertaking.get'
  | 'ai_activity.undertaking.update_head'
  | 'ai_activity.undertaking.tag'
  | 'ai_activity.assignment.record'
  | 'ai_activity.chains.list'
  | 'ai_activity.chain.set_project'
  | 'ai_activity.chain.set_files'

export interface CapabilityInputMap {
  'read_note': {
    path: string
  }
  'write_note': {
    path: string
    frontmatter?: Record<string, unknown>
    body?: string
    overwrite?: boolean
  }
  'patch_note_frontmatter': {
    path: string
    set?: Record<string, unknown>
    append_unique?: Record<string, unknown>
  }
  'resolve_ai_synthesis_path': {
    domain_root: string
    layer?: 'reference' | 'experiential' | 'operational' | 'integrated'
    synthesis_type: string
    source_title?: string
    concept_root?: string
    concept_subpath?: string[]
    slug: string
  }
  'create_ai_synthesis_note': {
    domain_root: string
    layer: 'reference' | 'experiential' | 'operational' | 'integrated'
    synthesis_type: string
    title?: string
    slug?: string
    source_title?: string
    concept_root?: string
    concept_subpath?: string[]
    derived_from: string[]
    if_exists?: 'error' | 'return_existing' | 'overwrite'
  }
  'get_impacted_ai_synthesis_notes': {
    changed_paths: string[]
  }
  'update_ai_synthesis_compile_state': {
    path: string
    last_compiled_at?: string
    compile_status: string
  }
  'list_domain_ai_synthesis_health': {
    domain_root: string
  }
  'organizer.nodes.list_roots': {
    typeFilter?: NodeType
  }
  'organizer.nodes.list_children': {
    parentKey: string
  }
  'organizer.nodes.list_all': Record<string, never>
  'organizer.nodes.search': {
    query: string
    limit?: number
  }
  'organizer.node.get': {
    uuid: string
  }
  'organizer.node.get_by_key': {
    key: string
  }
  'organizer.node.read_frontmatter': {
    filePath: string
  }
  'organizer.node.create': {
    type: NodeType
    title: string
    parentKey?: string
    parentUuid?: string
    parentType?: NodeType
    tags?: string[]
    body?: string
    description?: string
    comments?: Array<string | YAMLCommentEntry>
    projectRoot?: string
    extraFields?: Record<string, unknown>
  }
  'organizer.node.rename': {
    uuid: string
    newTitle: string
  }
  'organizer.node.update': {
    uuid: string
    updates: {
      type?: NodeType
      title?: string
      tags?: string[]
      projectPresetTags?: string[]
      status?: NodeStatus
      priority?: NodePriority
      description?: string
      comments?: Array<string | YAMLCommentEntry>
      extraFields?: Record<string, unknown>
    }
  }
  'organizer.node.move': {
    uuid: string
    newParentKey: string | null
  }
  'organizer.node.delete': {
    uuid: string
  }
  'task.claim': {
    uuid: string
    owner: string
    taskStatus?: string
    note?: string
  }
  'task.update_status': {
    uuid: string
    taskStatus: string
    note?: string
  }
  'run.log': {
    title: string
    projectRoot: string
    parentKey?: string
    parentUuid?: string
    parentType?: NodeType
    runId?: string
    sessionId?: string
    agentName?: string
    model?: string
    startedAt?: string
    endedAt?: string
    result?: string
    sourceRepo?: string
    branch?: string
    commit?: string
    artifacts?: string[]
    relatedNodes?: string[]
    body?: string
  }
  'handoff.create': {
    title: string
    projectRoot: string
    parentKey?: string
    parentUuid?: string
    parentType?: NodeType
    fromAgent?: string
    toAgent?: string
    summary: string
    sourceRepo?: string
    branch?: string
    commit?: string
    artifacts?: string[]
    relatedNodes?: string[]
    body?: string
  }
  'comment.add': {
    uuid: string
    text: string
    addedBy?: string
  }
  'thoughts.create': {
    folder_path: string
    filename: string
    content: string
    title: string | null
    date_header: boolean
    emotions: string[]
  }
  'daily.log_insight': {
    insights: string[]
    files_touched?: string[]
    linked_notes?: string[]
    teachers_note?: string
    conversation?: string
    date?: string
    mode?: 'append' | 'replace'
  }
  'todos.create': {
    folderPath: string
    date: string
    items: string[]
  }
  'todos.toggle': {
    filePath: string
    lineNumber: number
  }
  'tools.files.list_markdown': {
    limit?: number
  }
  'tools.files.list_pdf': {
    limit?: number
  }
  'tools.folders.list': {
    limit?: number
  }
  'tools.excalidraw.preview': {
    inputPath: string
    options: FormatOptions
  }
  'tools.excalidraw.format': {
    inputPath: string
    options: FormatOptions
  }
  'tools.excalidraw.highlights': {
    inputPath: string
  }
  'tools.pdf.preview': {
    inputPath: string
    options: ConvertOptions
  }
  'tools.pdf.convert': {
    inputPath: string
    options: ConvertOptions
  }
  'tools.transcript.preview': {
    inputText: string
    headingsText: string
    options: TranscriptOptions
  }
  'tools.transcript.clean_save': {
    input_text: string
    headings_text: string
    output_folder: string
    output_name: string
    base_folder: string | null
    options: TranscriptOptions
  }
  'telegram.send_message': {
    text: string
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML'
    chatId?: number | string
  }
  'telegram.open_conversation': {
    scheduleKey: string
    sessionId: string
    convId?: string
    chatId?: number | string
    cwd?: string
    ttlAt?: string
  }
  'telegram.close_conversation': {
    convId: string
    reason?: 'wrap_up' | 'ttl' | 'error' | 'manual'
    deleteClaudeSession?: boolean
  }
  'ai_activity.undertakings.list': {
    projectId: string
    section?: string
  }
  'ai_activity.undertaking.get': {
    projectId: string
    key: string
  }
  'ai_activity.undertaking.update_head': {
    projectId: string
    key: string
    text: string
  }
  'ai_activity.undertaking.tag': {
    projectId: string
    key: string
    add?: string[]
    remove?: string[]
    accept?: string[]
    reject?: string[]
    /** Add tags outside the vocabulary. Off by default — see the tag rule. */
    allowNew?: boolean
  }
  'ai_activity.assignment.record': {
    sessionId: string
    /** One or more undertaking keys — a session commonly feeds several. */
    undertakings: string[]
    /** Set when the session opened an undertaking that did not exist before. */
    newTitle?: string
    /** One-line "what came out", captured now rather than batched later. */
    head?: string
    section?: string
    projectId?: string
  }
  'ai_activity.chains.list': {
    projectId: string
    from?: string
    to?: string
    undertaking?: string
  }
  'ai_activity.chain.set_project': {
    projectId: string
    chainKey: string
    toProjectId: string
  }
  'ai_activity.chain.set_files': {
    projectId: string
    chainKey: string
    written?: string[]
    read?: string[]
  }
}

export interface CapabilityOutputMap {
  'read_note': {
    path: string
    exists: boolean
    frontmatter: Record<string, unknown>
    body: string
    raw: string
  }
  'write_note': {
    path: string
    written: true
    created: boolean
    frontmatter: Record<string, unknown>
    body: string
  }
  'patch_note_frontmatter': {
    path: string
    patched: true
    frontmatter: Record<string, unknown>
  }
  'resolve_ai_synthesis_path': {
    path: string
    domain_root: string
    domain: string
  }
  'create_ai_synthesis_note': {
    created: boolean
    path: string
    frontmatter: Record<string, unknown>
    body: string
  }
  'get_impacted_ai_synthesis_notes': {
    domain_root: string
    likely_impacted: string[]
    missing_candidates: string[]
  }
  'update_ai_synthesis_compile_state': {
    path: string
    updated: true
    frontmatter: Record<string, unknown>
  }
  'list_domain_ai_synthesis_health': {
    domain_root: string
    missing_canonical_pages: string[]
    stale_pages: string[]
    missing_required_metadata: Array<{ path: string; missing_fields: string[] }>
    unanswered_questions: string[]
    orphan_outputs: string[]
  }
  'organizer.nodes.list_roots': {
    nodes: NodeRecord[]
  }
  'organizer.nodes.list_children': {
    nodes: NodeRecord[]
  }
  'organizer.nodes.list_all': {
    nodes: NodeRecord[]
  }
  'organizer.nodes.search': {
    nodes: NodeRecord[]
  }
  'organizer.node.get': {
    node: NodeRecord | null
  }
  'organizer.node.get_by_key': {
    node: NodeRecord | null
  }
  'organizer.node.read_frontmatter': {
    frontmatter: YAMLFrontmatter | null
  }
  'organizer.node.create': {
    node: NodeRecord
  }
  'organizer.node.rename': {
    node: NodeRecord
  }
  'organizer.node.update': {
    node: NodeRecord
  }
  'organizer.node.move': {
    node: NodeRecord
    preview?: {
      nodeUuid: string
      fromParentKey: string | null
      toParentKey: string | null
      touchedPaths: string[]
    }
  }
  'organizer.node.delete': {
    deleted: true
    preview?: {
      nodeUuid: string
      filePath?: string
      parentKey: string | null
      childCount: number
      touchedPaths: string[]
    }
  }
  'task.claim': {
    node: NodeRecord
  }
  'task.update_status': {
    node: NodeRecord
  }
  'run.log': {
    node: NodeRecord
  }
  'handoff.create': {
    node: NodeRecord
  }
  'comment.add': {
    node: NodeRecord
  }
  'thoughts.create': {
    output_path: string
  }
  'daily.log_insight': {
    output_path: string
    was_created: boolean
    insights_count: number
  }
  'todos.create': {
    output_path: string
    items_added: number
  }
  'todos.toggle': {
    toggled: true
    filePath: string
  }
  'tools.files.list_markdown': {
    files: string[]
  }
  'tools.files.list_pdf': {
    files: string[]
  }
  'tools.folders.list': {
    folders: string[]
  }
  'tools.excalidraw.preview': {
    preview: FormatPreviewData
  }
  'tools.excalidraw.format': {
    result: FormatResult
  }
  'tools.excalidraw.highlights': {
    result: ExcalidrawHighlightsExtractBlock & { inputPath: string }
  }
  'tools.pdf.preview': {
    preview: PdfPreviewData
  }
  'tools.pdf.convert': {
    result: PdfConvertResult
  }
  'tools.transcript.preview': {
    result: CleanResult
  }
  'tools.transcript.clean_save': {
    result: CleanResult
  }
  'telegram.send_message': {
    messageId: number
    chatId: number | string
    sentAt: string
  }
  'telegram.open_conversation': {
    convId: string
    convPath: string
    activePath: string
    replacedConvId: string | null
  }
  'telegram.close_conversation': {
    convId: string
    status: 'closed'
    claudeSessionDeleted: boolean
    claudeSessionPaths: string[]
    activeCleared: boolean
  }
  'ai_activity.undertakings.list': {
    undertakings: UndertakingView[]
  }
  'ai_activity.undertaking.get': {
    undertaking: UndertakingView | null
  }
  'ai_activity.undertaking.update_head': {
    path: string
    record: UndertakingRecord
  }
  'ai_activity.undertaking.tag': {
    path: string
    record: UndertakingRecord
    /** Tags refused for not being in the vocabulary. Empty on a clean call. */
    rejected: string[]
    /** Tags newly appended to the vocabulary because `allowNew` was set. */
    added: string[]
  }
  'ai_activity.assignment.record': {
    path: string
  }
  'ai_activity.chains.list': {
    chains: ChainEntry[]
  }
  'ai_activity.chain.set_project': {
    path: string
  }
  'ai_activity.chain.set_files': {
    path: string
  }
}

export interface CapabilityDefinition {
  name: CapabilityName
  description: string
  readOnly: boolean
}

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  {
    name: 'read_note',
    description: 'Read a markdown note as structured frontmatter plus body.',
    readOnly: true,
  },
  {
    name: 'write_note',
    description: 'Write a markdown note with optional frontmatter and safe overwrite control.',
    readOnly: false,
  },
  {
    name: 'patch_note_frontmatter',
    description: 'Patch selected frontmatter fields without rewriting the note body manually.',
    readOnly: false,
  },
  {
    name: 'resolve_ai_synthesis_path',
    description: 'Resolve the canonical destination path for an AI Synthesis note.',
    readOnly: true,
  },
  {
    name: 'create_ai_synthesis_note',
    description: 'Create an AI Synthesis scaffold note with mechanical metadata and template body.',
    readOnly: false,
  },
  {
    name: 'get_impacted_ai_synthesis_notes',
    description: 'Return likely impacted AI Synthesis notes and missing canonical pages for changed notes.',
    readOnly: true,
  },
  {
    name: 'update_ai_synthesis_compile_state',
    description: 'Update AI Synthesis compile timestamps and compile_status metadata.',
    readOnly: false,
  },
  {
    name: 'list_domain_ai_synthesis_health',
    description: 'Scan a domain AI Synthesis area for missing, stale, or inconsistent notes.',
    readOnly: true,
  },
  {
    name: 'organizer.nodes.list_roots',
    description: 'List root nodes in the organizer hierarchy, optionally filtered by type.',
    readOnly: true,
  },
  {
    name: 'organizer.nodes.list_children',
    description: 'List children for a parent node key.',
    readOnly: true,
  },
  {
    name: 'organizer.nodes.list_all',
    description: 'List all organizer nodes from cache.',
    readOnly: true,
  },
  {
    name: 'organizer.nodes.search',
    description: 'Search organizer nodes by lexical query.',
    readOnly: true,
  },
  {
    name: 'organizer.node.get',
    description: 'Get an organizer node by uuid.',
    readOnly: true,
  },
  {
    name: 'organizer.node.get_by_key',
    description: 'Get an organizer node by key.',
    readOnly: true,
  },
  {
    name: 'organizer.node.read_frontmatter',
    description: 'Read YAML frontmatter by file path.',
    readOnly: true,
  },
  {
    name: 'organizer.node.create',
    description: 'Create a hierarchy node and persist it to YAML + cache.',
    readOnly: false,
  },
  {
    name: 'organizer.node.rename',
    description: 'Rename a node title.',
    readOnly: false,
  },
  {
    name: 'organizer.node.update',
    description: 'Update node metadata fields.',
    readOnly: false,
  },
  {
    name: 'organizer.node.move',
    description: 'Move a node to a new parent key.',
    readOnly: false,
  },
  {
    name: 'organizer.node.delete',
    description: 'Delete a node from cache/source of truth workflow.',
    readOnly: false,
  },
  {
    name: 'task.claim',
    description: 'Claim a task node for an owner and set task status.',
    readOnly: false,
  },
  {
    name: 'task.update_status',
    description: 'Update status of an existing task node.',
    readOnly: false,
  },
  {
    name: 'run.log',
    description: 'Create a run log node with traceability metadata.',
    readOnly: false,
  },
  {
    name: 'handoff.create',
    description: 'Create a handoff node with source and artifact references.',
    readOnly: false,
  },
  {
    name: 'comment.add',
    description: 'Append a comment entry to an existing organizer node.',
    readOnly: false,
  },
  {
    name: 'thoughts.create',
    description: 'Create a thought markdown note with YAML metadata.',
    readOnly: false,
  },
  {
    name: 'daily.log_insight',
    description: 'Upsert today’s daily insights note (record_kind: insight) with insights, files touched, linked notes, and a teacher’s note.',
    readOnly: false,
  },
  {
    name: 'todos.create',
    description: 'Create or append todos into a daily todo markdown note.',
    readOnly: false,
  },
  {
    name: 'todos.toggle',
    description: 'Toggle a single todo checkbox in a file.',
    readOnly: false,
  },
  {
    name: 'tools.files.list_markdown',
    description: 'List markdown files in the vault.',
    readOnly: true,
  },
  {
    name: 'tools.files.list_pdf',
    description: 'List PDF files in the vault.',
    readOnly: true,
  },
  {
    name: 'tools.folders.list',
    description: 'List folder paths in the vault.',
    readOnly: true,
  },
  {
    name: 'tools.excalidraw.preview',
    description: 'Preview markdown formatting for Excalidraw import.',
    readOnly: true,
  },
  {
    name: 'tools.excalidraw.format',
    description: 'Format markdown for Excalidraw and persist output file.',
    readOnly: false,
  },
  {
    name: 'tools.excalidraw.highlights',
    description: 'Extract highlighted text from an Excalidraw mindmap, grouped by tree node and color.',
    readOnly: true,
  },
  {
    name: 'tools.pdf.preview',
    description: 'Preview PDF to markdown conversion.',
    readOnly: true,
  },
  {
    name: 'tools.pdf.convert',
    description: 'Convert PDF to markdown and persist output file.',
    readOnly: false,
  },
  {
    name: 'tools.transcript.preview',
    description: 'Preview transcript cleanup output.',
    readOnly: true,
  },
  {
    name: 'tools.transcript.clean_save',
    description: 'Clean a transcript and save markdown output.',
    readOnly: false,
  },
  {
    name: 'telegram.send_message',
    description: 'Send a Telegram message to the configured chat via the Kai bot.',
    readOnly: false,
  },
  {
    name: 'telegram.open_conversation',
    description: 'Open a Telegram⇄Claude conversation: pin a sessionId to the active chat for poller-driven turn-taking.',
    readOnly: false,
  },
  {
    name: 'telegram.close_conversation',
    description: 'Close a Telegram conversation, clear the active pointer, and delete the Claude Code session JSONL.',
    readOnly: false,
  },
  {
    name: 'ai_activity.undertakings.list',
    description: 'List a project\'s undertakings with their derived tails — the Thinking Organizer index view.',
    readOnly: true,
  },
  {
    name: 'ai_activity.undertaking.get',
    description: 'Get one undertaking: stored head plus the tail derived from its chains.',
    readOnly: true,
  },
  {
    name: 'ai_activity.undertaking.update_head',
    description: 'Rewrite an undertaking\'s head — the one line stating what came out.',
    readOnly: false,
  },
  {
    name: 'ai_activity.undertaking.tag',
    description: 'Add, remove, accept, or reject tags on an undertaking, validated against the project vocabulary.',
    readOnly: false,
  },
  {
    name: 'ai_activity.assignment.record',
    description: 'Record which undertaking(s) a session belongs to, keyed on session id before the chain exists.',
    readOnly: false,
  },
  {
    name: 'ai_activity.chains.list',
    description: 'List stored chain digests for a project, optionally by date range or undertaking.',
    readOnly: true,
  },
  {
    name: 'ai_activity.chain.set_project',
    description: 'Re-file a chain under the correct project — the repair path for projectId misattribution.',
    readOnly: false,
  },
  {
    name: 'ai_activity.chain.set_files',
    description: 'Backfill file pointers onto a chain that predates structured extraction.',
    readOnly: false,
  },
]

export function getCapabilityDefinition(name: CapabilityName): CapabilityDefinition | undefined {
  return CAPABILITY_REGISTRY.find(capability => capability.name === name)
}
