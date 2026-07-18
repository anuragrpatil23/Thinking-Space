// IndexedDB cache layer for fast hierarchy queries.
// Uses Dexie.js. This is a PURE CACHE — source of truth is YAML frontmatter.
// Can be rebuilt from vault files at any time.

import Dexie, { type Table } from 'dexie'
import type {
  NodeType,
  NodeStatus,
  NodePriority,
  YAMLCommentEntry,
  YAMLStateHistoryEntry,
} from '@/services/lego_blocks/units/yamlNoteBlock'
import type { LinkType } from '@/services/lego_blocks/units/linkIndexBlock'

// ── Types ──

export interface NodeRecord {
  id?: number              // auto-increment PK (Dexie internal)
  uuid: string             // from YAML frontmatter
  key: string              // stable slug
  title: string
  type: NodeType
  level: number
  parent?: string          // parent key
  parentUuid?: string
  parentType?: NodeType
  filePath: string         // vault-relative path
  projectRoot?: string
  ticket?: string
  description?: string
  comments?: YAMLCommentEntry[]
  epicCompletedAt?: string
  taskId?: string
  taskStatus?: string
  dependsOn?: string[]
  blockedBy?: string[]
  acceptanceCriteria?: string[]
  owner?: string
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
  schemaVersion?: string
  recordKind?: string
  stateHistory?: YAMLStateHistoryEntry[]
  metadata?: Record<string, unknown>
  metadataKeys?: string[]
  metadataText?: string
  tags: string[]
  projectPresetTags?: string[]
  status: NodeStatus
  priority?: NodePriority
  progress?: number
  sortOrder?: number
  createdAt: string        // ISO string
  updatedAt: string        // ISO string
  aiSummary?: string
  bodyExcerpt?: string     // first ~200 chars of body for search
  searchText?: string      // pre-computed lowercase search text (built during upsert)
}

export interface LinkRecord {
  id?: number
  sourceFilePath: string
  targetFilePath: string
  linkType: LinkType
  rawText: string
}

/**
 * One row per markdown file the vault walk sees — regardless of whether the
 * file has YAML frontmatter. The `nodes` table only holds frontmattered
 * files, so path-completeness queries (command palette, wiki-link targets)
 * must read this table instead.
 */
export interface VaultFileRecord {
  path: string             // vault-relative path (primary key)
  mtime: number            // epoch seconds from the vault walk
  size: number
}

export interface NodeKeyConflictBlock {
  key: string
  uuid: string
  filePath: string
  conflictingUuid: string
  conflictingFilePath: string
}

export interface BulkUpsertNodesResultBlock {
  writtenCount: number
  conflicts: NodeKeyConflictBlock[]
}

// ── Database ──

class ThinkingSpaceDB extends Dexie {
  nodes!: Table<NodeRecord>
  links!: Table<LinkRecord>
  files!: Table<VaultFileRecord>

  constructor() {
    super('ThinkingSpaceDB')
    this.version(1).stores({
      nodes: '++id, &uuid, &key, type, parent, parentUuid, filePath, updatedAt, status, *tags',
    })
    this.version(2).stores({
      nodes: '++id, &uuid, &key, type, parent, parentUuid, filePath, updatedAt, status, taskStatus, owner, runId, sessionId, recordKind, *tags, *dependsOn, *blockedBy, *relatedNodes, *metadataKeys',
    }).upgrade(async tx => {
      const table = tx.table('nodes')
      await table.toCollection().modify((raw: NodeRecord) => {
        const normalized = normalizeRecordForStorage(raw)
        Object.assign(raw, normalized)
      })
    })
    this.version(3).stores({
      nodes: '++id, &uuid, &key, type, parent, parentUuid, filePath, updatedAt, status, taskStatus, owner, runId, sessionId, recordKind, *tags, *dependsOn, *blockedBy, *relatedNodes, *metadataKeys',
      links: '++id, sourceFilePath, targetFilePath, linkType',
    })
    this.version(4).stores({
      nodes: '++id, &uuid, &key, type, parent, parentUuid, filePath, updatedAt, status, taskStatus, owner, runId, sessionId, recordKind, *tags, *dependsOn, *blockedBy, *relatedNodes, *metadataKeys',
      links: '++id, sourceFilePath, targetFilePath, linkType',
      files: '&path, mtime',
    })
  }
}

let _db: ThinkingSpaceDB | null = null

function getDb(): ThinkingSpaceDB {
  if (!_db) _db = new ThinkingSpaceDB()
  return _db
}

// ── Public API ──

/**
 * Upsert a node from parsed YAML frontmatter.
 * Uses uuid as the unique identity — updates if exists, inserts if new.
 */
export async function upsertNode(
  record: Omit<NodeRecord, 'id'>,
): Promise<void> {
  const db = getDb()
  const normalized = normalizeRecordForStorage(record)
  const existing = await db.nodes.where('uuid').equals(record.uuid).first()
  const conflictingByKey = await db.nodes.where('key').equals(normalized.key).first()
  if (conflictingByKey && conflictingByKey.uuid !== normalized.uuid) {
    throw new Error(formatNodeKeyConflictMessage({
      key: normalized.key,
      uuid: normalized.uuid,
      filePath: normalized.filePath,
      conflictingUuid: conflictingByKey.uuid,
      conflictingFilePath: conflictingByKey.filePath,
    }))
  }
  if (existing) {
    await db.nodes.update(existing.id!, normalized)
  } else {
    await db.nodes.add(normalized)
  }
}

/**
 * Bulk upsert nodes — much faster than individual upsertNode calls during full sync.
 * Uses a single transaction with bulkPut for O(1) transaction overhead.
 */
export async function bulkUpsertNodes(
  records: Omit<NodeRecord, 'id'>[],
): Promise<BulkUpsertNodesResultBlock> {
  if (records.length === 0) return { writtenCount: 0, conflicts: [] }
  const db = getDb()
  const dedupedByUuid = new Map<string, Omit<NodeRecord, 'id'>>()
  for (const record of records.map(normalizeRecordForStorage)) {
    dedupedByUuid.set(record.uuid, record)
  }
  const normalized = [...dedupedByUuid.values()]
  // Fetch existing uuids in one indexed query
  const uuids = normalized.map(r => r.uuid)
  const existingNodes = await db.nodes.where('uuid').anyOf(uuids).toArray()
  const existingByUuid = new Map(existingNodes.map(n => [n.uuid, n]))
  const keys = [...new Set(normalized.map(r => r.key).filter(Boolean))]
  const existingKeyNodes = keys.length > 0
    ? await db.nodes.where('key').anyOf(keys).toArray()
    : []
  const existingByKey = new Map(existingKeyNodes.map(n => [n.key, n]))
  const incomingByKey = new Map<string, Omit<NodeRecord, 'id'>>()

  const toUpdate: NodeRecord[] = []
  const toAdd: Omit<NodeRecord, 'id'>[] = []
  const conflicts: NodeKeyConflictBlock[] = []
  for (const record of normalized) {
    // Only real (truthy) keys can collide. A note with no `key:` (or an empty
    // one) is a valid, keyless note — many hand-written vault notes have no
    // YAML key at all — and must never be treated as conflicting with another
    // keyless note, or all but the first would be dropped here.
    if (record.key) {
      const incomingConflict = incomingByKey.get(record.key)
      if (incomingConflict && incomingConflict.uuid !== record.uuid) {
        conflicts.push({
          key: record.key,
          uuid: record.uuid,
          filePath: record.filePath,
          conflictingUuid: incomingConflict.uuid,
          conflictingFilePath: incomingConflict.filePath,
        })
        continue
      }

      const existingKeyNode = existingByKey.get(record.key)
      if (existingKeyNode && existingKeyNode.uuid !== record.uuid) {
        conflicts.push({
          key: record.key,
          uuid: record.uuid,
          filePath: record.filePath,
          conflictingUuid: existingKeyNode.uuid,
          conflictingFilePath: existingKeyNode.filePath,
        })
        continue
      }

      incomingByKey.set(record.key, record)
    }

    const existingNode = existingByUuid.get(record.uuid)
    if (existingNode?.id !== undefined) {
      toUpdate.push({ ...record, id: existingNode.id })
    } else {
      toAdd.push(record)
    }
  }

  await db.transaction('rw', db.nodes, async () => {
    if (toUpdate.length > 0) await db.nodes.bulkPut(toUpdate)
    if (toAdd.length > 0) await db.nodes.bulkAdd(toAdd)
  })

  return {
    writtenCount: toUpdate.length + toAdd.length,
    conflicts,
  }
}

/**
 * Batch delete nodes by file paths — single transaction instead of N individual deletes.
 */
export async function bulkDeleteNodesByPaths(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return
  const db = getDb()
  await db.transaction('rw', db.nodes, async () => {
    for (const path of filePaths) {
      await db.nodes.where('filePath').equals(path).delete()
    }
  })
}

/**
 * Batch delete links for multiple source files — single transaction.
 */
export async function bulkDeleteLinksForFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return
  const db = getDb()
  await db.transaction('rw', db.links, async () => {
    for (const path of filePaths) {
      await db.links.where('sourceFilePath').equals(path).delete()
    }
  })
}

/**
 * Get all children of a parent (by parent key).
 */
export async function getChildren(parentKey: string): Promise<NodeRecord[]> {
  const db = getDb()
  const children = await db.nodes.where('parent').equals(parentKey).toArray()
  return children.sort(compareNodeDisplayOrder)
}

/**
 * Get a single node by key.
 */
export async function getNodeByKey(key: string): Promise<NodeRecord | undefined> {
  const db = getDb()
  return db.nodes.where('key').equals(key).first()
}

/**
 * Get a single node by uuid.
 */
export async function getNodeByUuid(uuid: string): Promise<NodeRecord | undefined> {
  const db = getDb()
  return db.nodes.where('uuid').equals(uuid).first()
}

/**
 * Get a node by its vault-relative file path.
 */
export async function getNodeByPath(filePath: string): Promise<NodeRecord | undefined> {
  const db = getDb()
  return db.nodes.where('filePath').equals(filePath).first()
}

/**
 * Get all root nodes (no parent).
 */
export async function getRootNodes(): Promise<NodeRecord[]> {
  const db = getDb()
  // Use indexed lookup for sentinel value '' (set during normalizeRecordForStorage)
  const roots = await db.nodes.where('parent').equals('').toArray()
  return roots.sort(compareNodeDisplayOrder)
}

/**
 * Build a full tree from the database.
 * Returns a flat array; callers can use `parent` to construct tree structure.
 */
export async function getAllNodes(): Promise<NodeRecord[]> {
  const db = getDb()
  return db.nodes.orderBy('type').toArray()
}

/**
 * Get nodes by type.
 */
export async function getNodesByType(type: NodeType): Promise<NodeRecord[]> {
  const db = getDb()
  return db.nodes.where('type').equals(type).toArray()
}

/**
 * Get nodes by orchestration record kind (for example: task, run, handoff).
 */
export async function getNodesByRecordKind(recordKind: string): Promise<NodeRecord[]> {
  const db = getDb()
  return db.nodes.where('recordKind').equals(recordKind).toArray()
}

/**
 * Get nodes by orchestration task status (for example: ready, in_progress, blocked, done).
 */
export async function getNodesByTaskStatus(taskStatus: string): Promise<NodeRecord[]> {
  const db = getDb()
  return db.nodes.where('taskStatus').equals(taskStatus).toArray()
}

/**
 * Get nodes that include a metadata key in their generic metadata blob.
 */
export async function getNodesByMetadataKey(metadataKey: string): Promise<NodeRecord[]> {
  const db = getDb()
  return db.nodes.where('metadataKeys').equals(metadataKey).toArray()
}

/**
 * Simple text search across title, key, tags, bodyExcerpt, and aiSummary.
 * Returns nodes matching any search term.
 */
export async function searchNodes(query: string, limit: number = 20): Promise<NodeRecord[]> {
  const db = getDb()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  // Use pre-computed searchText field (built during upsert) instead of
  // loading all nodes and constructing search strings on the fly.
  const scored: Array<{ node: NodeRecord; score: number }> = []
  let earlyExitCount = 0
  const maxScan = limit * 50 // scan at most 50x limit to avoid full table scan on huge vaults

  await db.nodes.each(node => {
    if (earlyExitCount >= maxScan) return
    earlyExitCount++

    const searchable = node.searchText || ''
    let score = 0
    for (const term of terms) {
      if (searchable.includes(term)) score++
    }

    if (score > 0) {
      scored.push({ node, score })
    }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.node)
}

/**
 * Vault-relative filePaths of nodes whose pre-computed searchText contains
 * every query term. Powers the explorer filter's content matches (title,
 * tags, body excerpt, metadata) without any full-body indexing.
 */
export async function searchNodeFilePathsByText(query: string): Promise<string[]> {
  const db = getDb()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const paths: string[] = []
  await db.nodes.each(node => {
    const searchable = node.searchText || ''
    if (terms.every(term => searchable.includes(term))) {
      paths.push(node.filePath)
    }
  })
  return paths
}

/**
 * Delete a node by uuid.
 */
export async function deleteNode(uuid: string): Promise<void> {
  const db = getDb()
  await db.nodes.where('uuid').equals(uuid).delete()
}

/**
 * Delete a node by file path (for when files are removed from vault).
 */
export async function deleteNodeByPath(filePath: string): Promise<void> {
  const db = getDb()
  await db.nodes.where('filePath').equals(filePath).delete()
}

/**
 * Clear all cached data. Used when rebuilding from vault.
 */
export async function clearAll(): Promise<void> {
  const db = getDb()
  await db.nodes.clear()
}

/**
 * Get total node count.
 */
export async function getNodeCount(): Promise<number> {
  const db = getDb()
  return db.nodes.count()
}

/**
 * Get all file paths currently in the cache.
 * Useful for detecting deleted files during sync.
 */
export async function getAllFilePaths(): Promise<Set<string>> {
  const db = getDb()
  // Use filePath index to get keys directly — no need to load full records or sort
  const paths = await db.nodes.orderBy('filePath').uniqueKeys()
  return new Set(paths as string[])
}

// ── Vault file index (complete path list, frontmatter or not) ──

/**
 * Replace the whole vault file index with the current walk result.
 * Called after full/incremental sync, both of which walk the entire vault,
 * so a clear+bulkAdd inside one transaction is both correct and cheap.
 */
export async function replaceVaultFileIndex(records: VaultFileRecord[]): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.files, async () => {
    await db.files.clear()
    if (records.length > 0) await db.files.bulkAdd(records)
  })
}

/** Upsert a single file into the index (e.g. after an in-app save). */
export async function upsertVaultFileIndexEntry(record: VaultFileRecord): Promise<void> {
  const db = getDb()
  await db.files.put(record)
}

export async function deleteVaultFileIndexPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const db = getDb()
  await db.files.bulkDelete(paths)
}

/** Key-only read — fastest way to get every known vault file path. */
export async function getVaultFileIndexPaths(): Promise<string[]> {
  const db = getDb()
  const keys = await db.files.orderBy('path').primaryKeys()
  return keys as string[]
}

/** Full records (path + mtime) for ranking by recency. */
export async function getVaultFileIndexRecords(): Promise<VaultFileRecord[]> {
  const db = getDb()
  return db.files.toArray()
}

/**
 * Batch fetch nodes by file path. Returns a Map keyed by filePath. Missing
 * paths simply aren't in the result. Single indexed query — much cheaper than
 * N individual getNodeByPath calls during sync reconciliation.
 */
export async function getNodesByPaths(
  filePaths: string[],
): Promise<Map<string, NodeRecord>> {
  if (filePaths.length === 0) return new Map()
  const db = getDb()
  const rows = await db.nodes.where('filePath').anyOf(filePaths).toArray()
  const out = new Map<string, NodeRecord>()
  for (const row of rows) out.set(row.filePath, row)
  return out
}

/**
 * Update only the filePath of an existing node. Used by hybrid sync when a
 * file has moved (same uuid, different path) so the node keeps its identity
 * — links, comments, history — instead of being deleted and recreated.
 */
export async function updateNodeFilePath(
  uuid: string,
  newFilePath: string,
): Promise<boolean> {
  const db = getDb()
  const existing = await db.nodes.where('uuid').equals(uuid).first()
  if (!existing?.id) return false
  if (existing.filePath === newFilePath) return false
  await db.nodes.update(existing.id, { filePath: newFilePath })
  return true
}

/**
 * Close the database connection. Useful for testing cleanup.
 */
export async function closeDb(): Promise<void> {
  if (_db) {
    _db.close()
    _db = null
  }
}

/**
 * Delete the entire database. Useful for testing or full reset.
 */
export async function deleteDb(): Promise<void> {
  if (_db) {
    _db.close()
    _db = null
  }
  await Dexie.delete('ThinkingSpaceDB')
}

// ── Link Index API ──

/**
 * Replace all links for a source file (atomic delete + insert).
 * Used after parsing a file to update its link records.
 */
export async function replaceLinksForFile(
  sourceFilePath: string,
  links: Omit<LinkRecord, 'id'>[],
): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.links, async () => {
    await db.links.where('sourceFilePath').equals(sourceFilePath).delete()
    if (links.length > 0) await db.links.bulkAdd(links)
  })
}

/**
 * Find all files that link TO the given target path.
 */
export async function getBacklinks(targetFilePath: string): Promise<LinkRecord[]> {
  const db = getDb()
  return db.links.where('targetFilePath').equals(targetFilePath).toArray()
}

/**
 * Find all files that link to the given path or any child path.
 * Used for folder moves where all descendant references need updating.
 */
export async function getBacklinksForPathPrefix(pathPrefix: string): Promise<LinkRecord[]> {
  const db = getDb()
  const exactMatches = await db.links
    .where('targetFilePath')
    .equals(pathPrefix)
    .toArray()
  const childMatches = await db.links
    .where('targetFilePath')
    .startsWith(`${pathPrefix}/`)
    .toArray()
  return [...exactMatches, ...childMatches]
}

/**
 * Bulk insert links (for full sync). Caller should clearAllLinks() first.
 */
export async function bulkUpsertLinks(links: Omit<LinkRecord, 'id'>[]): Promise<void> {
  const db = getDb()
  if (links.length === 0) return
  await db.links.bulkAdd(links)
}

/**
 * Clear all link records. Used during full sync reset.
 */
export async function clearAllLinks(): Promise<void> {
  const db = getDb()
  await db.links.clear()
}

/**
 * Read every link record. Used by the CLI to snapshot the link index to disk
 * so subsequent runs don't have to rebuild it from scratch.
 */
export async function getAllLinks(): Promise<LinkRecord[]> {
  const db = getDb()
  return db.links.toArray()
}

/**
 * Delete all links originating from a source file.
 */
export async function deleteLinksForFile(sourceFilePath: string): Promise<void> {
  const db = getDb()
  await db.links.where('sourceFilePath').equals(sourceFilePath).delete()
}

/**
 * Batch update target paths after a move/rename.
 * Updates all links whose target matches oldPrefix (exact or child).
 */
export async function updateLinkTargets(
  oldPrefix: string,
  newPrefix: string,
): Promise<number> {
  const db = getDb()
  let updated = 0
  await db.transaction('rw', db.links, async () => {
    // Batch update exact matches
    const exact = await db.links.where('targetFilePath').equals(oldPrefix).toArray()
    if (exact.length > 0) {
      await db.links.bulkPut(exact.map(link => ({ ...link, targetFilePath: newPrefix })))
      updated += exact.length
    }
    // Batch update child path matches
    const children = await db.links.where('targetFilePath').startsWith(`${oldPrefix}/`).toArray()
    if (children.length > 0) {
      await db.links.bulkPut(children.map(link => ({
        ...link,
        targetFilePath: `${newPrefix}${link.targetFilePath.slice(oldPrefix.length)}`,
      })))
      updated += children.length
    }
  })
  return updated
}

/**
 * Also update source paths when a file is moved/renamed.
 */
export async function updateLinkSourcePaths(
  oldPrefix: string,
  newPrefix: string,
): Promise<number> {
  const db = getDb()
  let updated = 0
  await db.transaction('rw', db.links, async () => {
    // Batch update exact matches
    const exact = await db.links.where('sourceFilePath').equals(oldPrefix).toArray()
    if (exact.length > 0) {
      await db.links.bulkPut(exact.map(link => ({ ...link, sourceFilePath: newPrefix })))
      updated += exact.length
    }
    // Batch update child path matches
    const children = await db.links.where('sourceFilePath').startsWith(`${oldPrefix}/`).toArray()
    if (children.length > 0) {
      await db.links.bulkPut(children.map(link => ({
        ...link,
        sourceFilePath: `${newPrefix}${link.sourceFilePath.slice(oldPrefix.length)}`,
      })))
      updated += children.length
    }
  })
  return updated
}

function normalizeRecordForStorage(record: Omit<NodeRecord, 'id'>): Omit<NodeRecord, 'id'> {
  // Use structuredClone instead of JSON round-trip for deep copy (faster, handles more types)
  const metadata = record.metadata
    ? structuredClone(record.metadata)
    : undefined

  // Ensure parent has sentinel value '' for indexed root-node queries
  const parent = record.parent || ''

  const tags = (record.tags ?? []).filter(Boolean)
  const projectPresetTags = record.projectPresetTags?.filter(Boolean)
  const metadataText = record.metadataText ?? buildMetadataSearchText(metadata)

  // Pre-compute searchText for fast full-text search without loading all records
  const searchText = buildSearchText(record, tags, projectPresetTags, metadataText)

  // Empty-string uuid/key must not occupy a slot on the unique `&uuid`/`&key`
  // indexes — coerce them to undefined so Dexie excludes them (and so multiple
  // such notes can coexist instead of clobbering one another).
  const uuid = (typeof record.uuid === 'string' && record.uuid.trim()) ? record.uuid : (undefined as unknown as string)
  const key = (typeof record.key === 'string' && record.key.trim()) ? record.key : (undefined as unknown as string)

  return {
    ...record,
    uuid,
    key,
    parent,
    dependsOn: record.dependsOn?.filter(Boolean),
    blockedBy: record.blockedBy?.filter(Boolean),
    acceptanceCriteria: record.acceptanceCriteria?.filter(Boolean),
    artifacts: record.artifacts?.filter(Boolean),
    relatedNodes: record.relatedNodes?.filter(Boolean),
    metadata,
    metadataKeys: (record.metadataKeys ?? extractMetadataKeys(metadata)).filter(Boolean),
    metadataText,
    tags,
    projectPresetTags,
    searchText,
  }
}

function buildSearchText(
  record: Omit<NodeRecord, 'id'>,
  tags: string[],
  projectPresetTags: string[] | undefined,
  metadataText: string,
): string {
  // Build a single lowercase string at upsert time so search never needs to reconstruct it
  const parts: string[] = [
    record.title,
    record.key,
  ]
  if (tags.length > 0) parts.push(tags.join(' '))
  if (projectPresetTags && projectPresetTags.length > 0) parts.push(projectPresetTags.join(' '))
  if (record.bodyExcerpt) parts.push(record.bodyExcerpt)
  if (record.aiSummary) parts.push(record.aiSummary)
  if (record.taskId) parts.push(record.taskId)
  if (record.taskStatus) parts.push(record.taskStatus)
  if (record.owner) parts.push(record.owner)
  if (record.agentName) parts.push(record.agentName)
  if (record.recordKind) parts.push(record.recordKind)
  if (record.description) parts.push(record.description)
  if (metadataText) parts.push(metadataText)
  return parts.join(' ').toLowerCase()
}

function compareNodeDisplayOrder(a: NodeRecord, b: NodeRecord): number {
  const aOrder = typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder)
    ? a.sortOrder
    : Number.POSITIVE_INFINITY
  const bOrder = typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder)
    ? b.sortOrder
    : Number.POSITIVE_INFINITY
  if (aOrder !== bOrder) return aOrder - bOrder
  const byTitle = (a.title ?? '').localeCompare(b.title ?? '')
  if (byTitle !== 0) return byTitle
  return (a.key ?? '').localeCompare(b.key ?? '')
}

function extractMetadataKeys(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) return []
  const keys = new Set<string>()
  collectMetadataKeys('', metadata, keys)
  return [...keys]
}

function collectMetadataKeys(prefix: string, value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMetadataKeys(prefix, item, out)
    }
    return
  }
  if (typeof value !== 'object') return

  const record = value as Record<string, unknown>
  for (const [key, inner] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key
    out.add(path)
    collectMetadataKeys(path, inner, out)
  }
}

function buildMetadataSearchText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return ''
  const values: string[] = []
  collectMetadataValues(metadata, values)
  return values.join(' ').toLowerCase()
}

function collectMetadataValues(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMetadataValues(item, out)
    }
    return
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const [key, inner] of Object.entries(record)) {
      out.push(key)
      collectMetadataValues(inner, out)
    }
    return
  }

  out.push(String(value))
}

function formatNodeKeyConflictMessage(conflict: NodeKeyConflictBlock): string {
  const a = conflict.filePath || `[uuid:${conflict.uuid}]`
  const b = conflictingFilePath(conflict)
  return `Duplicate YAML key "${conflict.key}" — both "${a}" and "${b}" claim it. Rename the YAML \`key:\` field in one of the files (or delete the stale duplicate) so each node has a unique key.`
}

function conflictingFilePath(conflict: NodeKeyConflictBlock): string {
  return conflict.conflictingFilePath || `[uuid:${conflict.conflictingUuid}]`
}
