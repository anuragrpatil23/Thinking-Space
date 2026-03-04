// Vault sync orchestrator — scans vault .md files, parses YAML frontmatter,
// and populates IndexedDB cache. Handles full and incremental syncs.

import { getPlatformName, getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { VaultFS, VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseNote,
  hasFrontmatter,
  type YAMLFrontmatter,
} from '@/services/lego_blocks/units/yamlNoteBlock'
import { parseOrganizerBodySections } from '@/services/lego_blocks/integrations/organizerBodyBlock'
import {
  upsertNode,
  deleteNodeByPath,
  getAllFilePaths,
  clearAll,
  getNodeCount,
  type NodeRecord,
} from '@/services/lego_blocks/integrations/dbBlock'
import { getSpaceStorageKeyBlock } from '@/services/orchestrators/storageOrch'

// ── Types ──

export interface SyncResult {
  totalFiles: number
  parsedNodes: number
  skippedFiles: number
  deletedNodes: number
  errors: Array<{ path: string; error: string }>
  durationMs: number
}

export interface VaultSyncOptions {
  maxFileSizeBytes?: number
}

const IOS_MAX_SYNC_FILE_SIZE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_SYNC_FILE_SIZE_BYTES = 12 * 1024 * 1024
const MAX_REASONABLE_EPOCH_SECONDS = 10_000_000_000
const LAST_SYNC_STORAGE_SUFFIX_ORCH = 'thinkingspace:lastSyncTimestamp'

function getLastSyncStorageKeyOrch(): string {
  return getSpaceStorageKeyBlock(LAST_SYNC_STORAGE_SUFFIX_ORCH)
}

function resolveMaxSyncFileSizeBytes(options?: VaultSyncOptions): number {
  if (typeof options?.maxFileSizeBytes === 'number' && Number.isFinite(options.maxFileSizeBytes)) {
    return Math.max(1, Math.floor(options.maxFileSizeBytes))
  }
  return getPlatformName() === 'ios'
    ? IOS_MAX_SYNC_FILE_SIZE_BYTES
    : DEFAULT_MAX_SYNC_FILE_SIZE_BYTES
}

function normalizeEpochSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  // Some adapters can return epoch in milliseconds. Normalize to seconds for sync comparisons.
  return value > MAX_REASONABLE_EPOCH_SECONDS ? (value / 1000) : value
}

// ── Public API ──

/**
 * Full vault sync — clears IndexedDB and rebuilds from all .md files.
 * Use on first load or when cache is suspected corrupt.
 */
export async function fullSync(fs?: VaultFS, options?: VaultSyncOptions): Promise<SyncResult> {
  const vaultFs = fs ?? getVaultFS()
  const start = Date.now()

  await clearAll()

  const entries = await vaultFs.walkVault(['.md'])
  const result = await syncEntries(vaultFs, entries, options)

  result.durationMs = Date.now() - start
  return result
}

/**
 * Incremental sync — only process files modified after the given timestamp.
 * Also detects and removes deleted files from cache.
 */
export async function incrementalSync(
  sinceTimestamp: number,
  fs?: VaultFS,
  options?: VaultSyncOptions,
): Promise<SyncResult> {
  const vaultFs = fs ?? getVaultFS()
  const start = Date.now()

  const allEntries = await vaultFs.walkVault(['.md'])

  // Find files modified since last sync
  const sinceSeconds = normalizeEpochSeconds(sinceTimestamp)
  const updatedEntries = allEntries.filter(e => normalizeEpochSeconds(e.mtime) > sinceSeconds)

  // Detect deleted files
  const currentPaths = new Set(allEntries.map(e => e.path))
  const cachedPaths = await getAllFilePaths()
  let deletedCount = 0
  for (const cachedPath of cachedPaths) {
    if (!currentPaths.has(cachedPath)) {
      await deleteNodeByPath(cachedPath)
      deletedCount++
    }
  }

  const result = await syncEntries(vaultFs, updatedEntries, options)
  result.deletedNodes = deletedCount
  result.totalFiles = allEntries.length
  result.durationMs = Date.now() - start

  return result
}

/**
 * Sync a single file — read, parse, and upsert into cache.
 * Useful when a file is saved/created.
 */
export async function syncSingleFile(
  filePath: string,
  fs?: VaultFS,
  options?: VaultSyncOptions,
): Promise<boolean> {
  const vaultFs = fs ?? getVaultFS()
  const maxFileSizeBytes = resolveMaxSyncFileSizeBytes(options)

  try {
    const stat = await vaultFs.stat(filePath)
    if (stat.size > maxFileSizeBytes) return false

    const content = await vaultFs.read(filePath)
    if (!hasFrontmatter(content)) return false

    const note = parseNote(content)
    if (!note) return false

    const record = frontmatterToRecord(note.frontmatter, filePath, note.body)
    await upsertNode(record)
    return true
  } catch {
    return false
  }
}

/**
 * Get the last sync timestamp. Returns 0 if never synced.
 */
export function getLastSyncTimestamp(): number {
  try {
    const scopedKey = getLastSyncStorageKeyOrch()
    const stored = localStorage.getItem(scopedKey)
    if (stored) return normalizeEpochSeconds(Number(stored))

    // Backward compatibility for pre-space-scoped key.
    const legacy = localStorage.getItem(LAST_SYNC_STORAGE_SUFFIX_ORCH)
    if (!legacy) return 0
    localStorage.setItem(scopedKey, legacy)
    localStorage.removeItem(LAST_SYNC_STORAGE_SUFFIX_ORCH)
    return normalizeEpochSeconds(Number(legacy))
  } catch {
    return 0
  }
}

/**
 * Save the last sync timestamp.
 */
export function setLastSyncTimestamp(ts?: number): void {
  try {
    localStorage.setItem(
      getLastSyncStorageKeyOrch(),
      String(normalizeEpochSeconds(ts ?? Math.floor(Date.now() / 1000))),
    )
  } catch {
    // localStorage may not be available in some contexts
  }
}

/**
 * Smart sync — does incremental if we have a previous timestamp,
 * full sync otherwise.
 */
export async function smartSync(fs?: VaultFS, options?: VaultSyncOptions): Promise<SyncResult> {
  const lastSync = getLastSyncTimestamp()
  const nodeCount = await getNodeCount()
  const usedFullSync = lastSync === 0 || nodeCount === 0

  let result: SyncResult
  if (usedFullSync) {
    result = await fullSync(fs, options)
  } else {
    result = await incrementalSync(lastSync, fs, options)
  }

  // Keep retry surface intact on partial failures.
  // For failed full-sync runs, force next run to full sync again.
  if (result.errors.length > 0) {
    if (usedFullSync) {
      setLastSyncTimestamp(0)
    }
    return result
  }

  setLastSyncTimestamp()
  return result
}

// ── Internals ──

async function syncEntries(
  fs: VaultFS,
  entries: VaultEntry[],
  options?: VaultSyncOptions,
): Promise<SyncResult> {
  const maxFileSizeBytes = resolveMaxSyncFileSizeBytes(options)
  const result: SyncResult = {
    totalFiles: entries.length,
    parsedNodes: 0,
    skippedFiles: 0,
    deletedNodes: 0,
    errors: [],
    durationMs: 0,
  }

  for (const entry of entries) {
    try {
      if (entry.size > maxFileSizeBytes) {
        result.skippedFiles++
        continue
      }

      const content = await fs.read(entry.path)

      if (!hasFrontmatter(content)) {
        result.skippedFiles++
        continue
      }

      const note = parseNote(content)
      if (!note) {
        result.skippedFiles++
        continue
      }

      const record = frontmatterToRecord(note.frontmatter, entry.path, note.body)
      await upsertNode(record)
      result.parsedNodes++
    } catch (err) {
      result.errors.push({
        path: entry.path,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

function frontmatterToRecord(
  fm: YAMLFrontmatter,
  filePath: string,
  body: string,
): Omit<NodeRecord, 'id'> {
  const { metadata, metadataKeys, metadataText } = extractGenericMetadata(fm)
  const bodySections = parseOrganizerBodySections(body)
  const yamlComments = Array.isArray(fm.comments)
    ? fm.comments.map(comment => ({
      text: comment.text,
      added_at: comment.added_at,
      added_by: comment.added_by,
    }))
    : []
  return {
    uuid: fm.uuid,
    key: fm.key,
    title: fm.title,
    type: fm.type,
    level: fm.level,
    parent: fm.parent,
    parentUuid: fm.parent_uuid,
    parentType: fm.parent_type,
    filePath,
    projectRoot: fm.project_root,
    ticket: typeof fm.ticket === 'string' ? fm.ticket : undefined,
    description: bodySections.description
      ?? (typeof fm.description === 'string' ? fm.description : undefined),
    comments: bodySections.comments.length > 0 ? bodySections.comments : (yamlComments.length > 0 ? yamlComments : undefined),
    epicCompletedAt: typeof fm.epic_completed_at === 'string' ? fm.epic_completed_at : undefined,
    sortOrder: typeof fm.sort_order === 'number' && Number.isFinite(fm.sort_order) ? fm.sort_order : undefined,
    taskId: typeof fm.task_id === 'string' ? fm.task_id : undefined,
    taskStatus: typeof fm.task_status === 'string' ? fm.task_status : undefined,
    dependsOn: Array.isArray(fm.depends_on) ? fm.depends_on.filter(Boolean) : undefined,
    blockedBy: Array.isArray(fm.blocked_by) ? fm.blocked_by.filter(Boolean) : undefined,
    acceptanceCriteria: Array.isArray(fm.acceptance_criteria) ? fm.acceptance_criteria.filter(Boolean) : undefined,
    owner: typeof fm.owner === 'string' ? fm.owner : undefined,
    runId: typeof fm.run_id === 'string' ? fm.run_id : undefined,
    sessionId: typeof fm.session_id === 'string' ? fm.session_id : undefined,
    agentName: typeof fm.agent_name === 'string' ? fm.agent_name : undefined,
    model: typeof fm.model === 'string' ? fm.model : undefined,
    startedAt: typeof fm.started_at === 'string' ? fm.started_at : undefined,
    endedAt: typeof fm.ended_at === 'string' ? fm.ended_at : undefined,
    result: typeof fm.result === 'string' ? fm.result : undefined,
    sourceRepo: typeof fm.source_repo === 'string' ? fm.source_repo : undefined,
    branch: typeof fm.branch === 'string' ? fm.branch : undefined,
    commit: typeof fm.commit === 'string' ? fm.commit : undefined,
    artifacts: Array.isArray(fm.artifacts) ? fm.artifacts.filter(Boolean) : undefined,
    relatedNodes: Array.isArray(fm.related_nodes) ? fm.related_nodes.filter(Boolean) : undefined,
    schemaVersion: fm.schema_version != null ? String(fm.schema_version) : undefined,
    recordKind: typeof fm.record_kind === 'string' ? fm.record_kind : undefined,
    stateHistory: Array.isArray(fm.state_history)
      ? fm.state_history.map(entry => ({ ...entry }))
      : undefined,
    metadata,
    metadataKeys,
    metadataText,
    tags: fm.tags ?? [],
    projectPresetTags: fm.project_preset_tags ?? [],
    status: fm.status,
    priority: fm.priority,
    progress: fm.progress,
    createdAt: fm.created_at,
    updatedAt: fm.updated_at,
    aiSummary: fm.ai_summary,
    bodyExcerpt: body.slice(0, 200).trim() || undefined,
  }
}

const KNOWN_FRONTMATTER_KEYS = new Set<string>([
  'uuid',
  'key',
  'title',
  'type',
  'level',
  'parent',
  'parent_uuid',
  'parent_type',
  'tags',
  'project_preset_tags',
  'categories',
  'progress',
  'status',
  'priority',
  'created_at',
  'updated_at',
  'ai_summary',
  'ai_generated',
  'last_ai_update',
  'ai_suggestions',
  'excalidraw',
  'project_root',
  'ticket',
  'description',
  'comments',
  'epic_completed_at',
  'sort_order',
  'task_id',
  'task_status',
  'depends_on',
  'blocked_by',
  'acceptance_criteria',
  'owner',
  'run_id',
  'session_id',
  'agent_name',
  'model',
  'started_at',
  'ended_at',
  'result',
  'source_repo',
  'branch',
  'commit',
  'artifacts',
  'related_nodes',
  'schema_version',
  'record_kind',
  'state_history',
])

function extractGenericMetadata(frontmatter: YAMLFrontmatter): {
  metadata?: Record<string, unknown>
  metadataKeys?: string[]
  metadataText?: string
} {
  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (KNOWN_FRONTMATTER_KEYS.has(key)) continue
    if (value === undefined || value === null || value === '') continue
    metadata[key] = value
  }

  const keys = Object.keys(metadata)
  if (keys.length === 0) return {}

  const metadataKeys = collectMetadataKeys(metadata)
  const metadataText = buildMetadataText(metadata)
  return {
    metadata,
    metadataKeys,
    metadataText,
  }
}

function collectMetadataKeys(metadata: Record<string, unknown>): string[] {
  const out = new Set<string>()
  walkMetadata('', metadata, (path) => out.add(path))
  return [...out]
}

function buildMetadataText(metadata: Record<string, unknown>): string {
  const out: string[] = []
  walkMetadata('', metadata, (path, value) => {
    out.push(path)
    if (value !== null && value !== undefined && typeof value !== 'object') {
      out.push(String(value))
    }
  })
  return out.join(' ').toLowerCase()
}

function walkMetadata(
  prefix: string,
  value: unknown,
  visitor: (path: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const path = prefix ? `${prefix}[${i}]` : `[${i}]`
      visitor(path, value[i])
      walkMetadata(path, value[i], visitor)
    }
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const [key, inner] of Object.entries(record)) {
      const path = prefix ? `${prefix}.${key}` : key
      visitor(path, inner)
      walkMetadata(path, inner, visitor)
    }
  }
}
