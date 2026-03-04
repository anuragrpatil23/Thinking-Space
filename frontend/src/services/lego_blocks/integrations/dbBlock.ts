// IndexedDB cache layer for fast hierarchy queries.
// Uses Dexie.js. This is a PURE CACHE — source of truth is YAML frontmatter.
// Can be rebuilt from vault files at any time.

import Dexie, { type Table } from 'dexie'
import { getActiveSpaceIdBlock } from '@/services/lego_blocks/units/storageKeyBlock'
import type {
  NodeType,
  NodeStatus,
  NodePriority,
  YAMLCommentEntry,
  YAMLStateHistoryEntry,
} from '@/services/lego_blocks/units/yamlNoteBlock'

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
}

// ── Database ──

class ThinkingSpaceDB extends Dexie {
  nodes!: Table<NodeRecord>

  constructor(dbName: string) {
    super(dbName)
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
  }
}

const THINKING_SPACE_DB_NAME_BLOCK = 'ThinkingSpaceDB'
const _dbByName = new Map<string, ThinkingSpaceDB>()

function getCurrentDbNameBlock(): string {
  return `${THINKING_SPACE_DB_NAME_BLOCK}::${getActiveSpaceIdBlock()}`
}

function getDb(): ThinkingSpaceDB {
  const dbName = getCurrentDbNameBlock()
  const existing = _dbByName.get(dbName)
  if (existing) return existing
  const next = new ThinkingSpaceDB(dbName)
  _dbByName.set(dbName, next)
  return next
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
  if (existing) {
    await db.nodes.update(existing.id!, normalized)
  } else {
    await db.nodes.add(normalized)
  }
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
  // Nodes without a parent field — filter manually since Dexie can't index undefined
  const roots = (await db.nodes.toArray()).filter(n => !n.parent)
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

  const all = await db.nodes.toArray()
  const scored: Array<{ node: NodeRecord; score: number }> = []

  for (const node of all) {
    let score = 0
    const searchable = [
      node.title,
      node.key,
      ...(node.tags || []),
      ...(node.projectPresetTags || []),
      node.bodyExcerpt || '',
      node.aiSummary || '',
      node.taskId || '',
      node.taskStatus || '',
      node.epicCompletedAt || '',
      ...(node.dependsOn || []),
      ...(node.blockedBy || []),
      ...(node.acceptanceCriteria || []),
      node.owner || '',
      node.runId || '',
      node.sessionId || '',
      node.agentName || '',
      node.model || '',
      node.result || '',
      node.sourceRepo || '',
      node.branch || '',
      node.commit || '',
      ...(node.artifacts || []),
      ...(node.relatedNodes || []),
      node.schemaVersion || '',
      node.recordKind || '',
      node.metadataText || '',
    ].join(' ').toLowerCase()

    for (const term of terms) {
      if (searchable.includes(term)) score++
    }

    if (score > 0) scored.push({ node, score })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.node)
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
  const paths = await db.nodes.orderBy('filePath').keys()
  return new Set(paths as string[])
}

/**
 * Close the database connection. Useful for testing cleanup.
 */
export async function closeDb(): Promise<void> {
  for (const db of _dbByName.values()) {
    db.close()
  }
  _dbByName.clear()
}

/**
 * Delete the entire database. Useful for testing or full reset.
 */
export async function deleteDb(): Promise<void> {
  const dbName = getCurrentDbNameBlock()
  const existing = _dbByName.get(dbName)
  if (existing) {
    existing.close()
    _dbByName.delete(dbName)
  }
  await Dexie.delete(dbName)
}

/**
 * Delete all Thinking Space databases across all spaces.
 */
export async function deleteAllThinkingSpaceDbs(): Promise<void> {
  await closeDb()
  const names = await Dexie.getDatabaseNames()
  const targets = names.filter(
    name => name === THINKING_SPACE_DB_NAME_BLOCK || name.startsWith(`${THINKING_SPACE_DB_NAME_BLOCK}::`),
  )
  await Promise.all(targets.map(name => Dexie.delete(name)))
}

function normalizeRecordForStorage(record: Omit<NodeRecord, 'id'>): Omit<NodeRecord, 'id'> {
  const metadata = record.metadata
    ? JSON.parse(JSON.stringify(record.metadata)) as Record<string, unknown>
    : undefined

  return {
    ...record,
    dependsOn: record.dependsOn?.filter(Boolean),
    blockedBy: record.blockedBy?.filter(Boolean),
    acceptanceCriteria: record.acceptanceCriteria?.filter(Boolean),
    artifacts: record.artifacts?.filter(Boolean),
    relatedNodes: record.relatedNodes?.filter(Boolean),
    metadata,
    metadataKeys: (record.metadataKeys ?? extractMetadataKeys(metadata)).filter(Boolean),
    metadataText: record.metadataText ?? buildMetadataSearchText(metadata),
    tags: (record.tags ?? []).filter(Boolean),
    projectPresetTags: record.projectPresetTags?.filter(Boolean),
  }
}

function compareNodeDisplayOrder(a: NodeRecord, b: NodeRecord): number {
  const aOrder = typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder)
    ? a.sortOrder
    : Number.POSITIVE_INFINITY
  const bOrder = typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder)
    ? b.sortOrder
    : Number.POSITIVE_INFINITY
  if (aOrder !== bOrder) return aOrder - bOrder
  const byTitle = a.title.localeCompare(b.title)
  if (byTitle !== 0) return byTitle
  return a.key.localeCompare(b.key)
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
