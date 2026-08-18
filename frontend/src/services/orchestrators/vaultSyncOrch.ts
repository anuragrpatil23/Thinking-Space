// Vault sync orchestrator — scans vault .md files, parses YAML frontmatter,
// and populates IndexedDB cache. Handles full and incremental syncs.

import { getPlatformName, getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { VaultFS, VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import { getCapabilityFeatureFlags } from '@/services/lego_blocks/integrations/capabilityFeatureFlagsBlock'
import {
  parseNote,
  stringifyNote,
  hasFrontmatter,
  type YAMLFrontmatter,
  type YAMLNote,
} from '@/services/lego_blocks/units/yamlNoteBlock'
import { parseOrganizerBodySections } from '@/services/lego_blocks/integrations/organizerBodyBlock'
import {
  upsertNode,
  bulkUpsertNodes,
  bulkDeleteNodesByPaths,
  bulkDeleteLinksForFiles,
  getAllFilePaths,
  getNodeByKey,
  getNodeByPath,
  getNodesByPaths,
  updateNodeFilePath,
  updateLinkTargets,
  updateLinkSourcePaths,
  clearAll,
  clearAllLinks,
  getNodeCount,
  bulkUpsertLinks,
  replaceLinksForFile,
  replaceVaultFileIndex,
  upsertVaultFileIndexEntry,
  getVaultFileRecordsByPaths,
  type NodeRecord,
  type NodeKeyConflictBlock,
  type LinkRecord,
  type VaultFileRecord,
} from '@/services/lego_blocks/integrations/dbBlock'
import { extractLinksFromContentBlock } from '@/services/lego_blocks/units/linkIndexBlock'
import { startActivity } from '@/services/lego_blocks/units/backgroundActivityBlock'
import {
  getSyncExcludedPathPrefixes,
  isPathSyncExcluded,
} from '@/services/lego_blocks/units/vaultSyncExclusionsBlock'
import { logError } from '@/services/lego_blocks/units/debugLogBlock'
import {
  mergeWikiLinksIntoFrontmatterBlock,
  resolveGeneratedWikiLinksForFrontmatterBlock,
} from '@/services/lego_blocks/units/wikiLinksBlock'

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
  // If set, restricts the sync to entries whose vault-relative path begins
  // with this prefix. Saves CLI write commands from re-parsing the entire
  // vault when only one project is being touched. Caller is responsible for
  // not relying on cross-project state in this run.
  rootPath?: string
}

// ── File paths cache ──
// Avoid re-querying all file paths from IndexedDB on every single-file sync.
// Invalidated after full/incremental sync completes.
// Stable array identity matters: downstream link resolution memoizes per-array
// lookups (WeakMap), so reusing the same array across single-file syncs keeps
// those caches warm.
let _cachedFilePathsArray: string[] | null = null
let _cachedFilePathsAge = 0
const FILE_PATHS_CACHE_TTL_MS = 30_000

function getCachedFilePathsArray(): string[] | null {
  if (_cachedFilePathsArray && (Date.now() - _cachedFilePathsAge) < FILE_PATHS_CACHE_TTL_MS) {
    return _cachedFilePathsArray
  }
  _cachedFilePathsArray = null
  return null
}

function setCachedFilePaths(paths: Set<string>): void {
  _cachedFilePathsArray = [...paths]
  _cachedFilePathsAge = Date.now()
}

// ── Vault-index trust marker ──
// The vault file index is REPLACED at the start of each sync (before files are
// processed), so its (mtime, size) fingerprints are only safe to use for
// skip-decisions if the previous sync actually ran to completion. The marker
// is cleared when a sync starts and set only on a clean finish — a mid-sync
// crash therefore disables fingerprint skipping for exactly one run.
const VAULT_INDEX_TRUST_KEY = 'thinkingspace:vaultIndexTrusted'

function consumeVaultIndexTrustMarker(): boolean {
  try {
    const trusted = localStorage.getItem(VAULT_INDEX_TRUST_KEY) === '1'
    localStorage.removeItem(VAULT_INDEX_TRUST_KEY)
    return trusted
  } catch {
    return false
  }
}

function setVaultIndexTrustMarker(): void {
  try {
    localStorage.setItem(VAULT_INDEX_TRUST_KEY, '1')
  } catch {
    // Storage unavailable — fingerprint skipping just stays off.
  }
}

const IOS_MAX_SYNC_FILE_SIZE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_SYNC_FILE_SIZE_BYTES = 12 * 1024 * 1024
const MAX_REASONABLE_EPOCH_SECONDS = 10_000_000_000

function resolveMaxSyncFileSizeBytes(options?: VaultSyncOptions): number {
  if (typeof options?.maxFileSizeBytes === 'number' && Number.isFinite(options.maxFileSizeBytes)) {
    return Math.max(1, Math.floor(options.maxFileSizeBytes))
  }
  return getPlatformName() === 'ios'
    ? IOS_MAX_SYNC_FILE_SIZE_BYTES
    : DEFAULT_MAX_SYNC_FILE_SIZE_BYTES
}

function normalizeRootPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.replace(/^\/+|\/+$/g, '').trim()
  return trimmed || undefined
}

async function clearNodesAndLinksUnderPath(rootPath: string): Promise<void> {
  const allPaths = await getAllFilePaths()
  const scoped: string[] = []
  for (const p of allPaths) {
    if (p === rootPath || p.startsWith(`${rootPath}/`)) scoped.push(p)
  }
  if (scoped.length > 0) {
    await bulkDeleteNodesByPaths(scoped)
    await bulkDeleteLinksForFiles(scoped)
  }
}

function normalizeEpochSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  // Some adapters can return epoch in milliseconds. Normalize to seconds for sync comparisons.
  return value > MAX_REASONABLE_EPOCH_SECONDS ? (value / 1000) : value
}

function toVaultFileRecords(entries: VaultEntry[]): VaultFileRecord[] {
  return entries.map(e => ({
    path: e.path,
    mtime: normalizeEpochSeconds(e.mtime),
    size: e.size,
  }))
}

// ── Public API ──

/**
 * Full vault sync — clears IndexedDB and rebuilds from all .md files.
 * Use on first load or when cache is suspected corrupt.
 */
export async function fullSync(fs?: VaultFS, options?: VaultSyncOptions): Promise<SyncResult> {
  const vaultFs = fs ?? getVaultFS()
  const start = Date.now()
  const autoHealEnabled = getCapabilityFeatureFlags().yaml_fields_auto_heal_enabled

  const activity = startActivity({
    kind: 'sync',
    channel: 'ambient',
    label: 'Syncing vault…',
    detail: 'Full scan',
  })
  try {
    // Full sync also replaces the vault file index mid-run, so any trust
    // marker left by a previous sync must not survive a crash here.
    consumeVaultIndexTrustMarker()
    const rootPath = normalizeRootPath(options?.rootPath)
    if (!rootPath) {
      await clearAll()
      await clearAllLinks()
    } else {
      // Scoped sync: only wipe nodes under the scope so unrelated projects
      // already in the DB stay intact (useful when persistent cache is on).
      await clearNodesAndLinksUnderPath(rootPath)
    }

    const walked = await vaultFs.walkVault(['.md'])
    const excludedPrefixes = getSyncExcludedPathPrefixes()
    const allEntries = excludedPrefixes.length === 0
      ? walked
      : walked.filter(e => !isPathSyncExcluded(e.path, excludedPrefixes))
    const entries = rootPath
      ? allEntries.filter(e => e.path === rootPath || e.path.startsWith(`${rootPath}/`))
      : allEntries
    activity.update({
      total: entries.length,
      completed: 0,
      detail: rootPath
        ? `Scoped to ${rootPath} — ${entries.length} of ${allEntries.length} files`
        : `Full scan — ${entries.length} files`,
    })
    const candidatePaths = entries.map(e => e.path)
    setCachedFilePaths(new Set(candidatePaths))
    // Refresh the complete file index from the full walk (allEntries, not the
    // rootPath-scoped subset) — unlike `nodes`, this covers files without
    // frontmatter, so path-completeness consumers (command palette) stay whole.
    await replaceVaultFileIndex(toVaultFileRecords(allEntries))
    const parentKeyToPath = autoHealEnabled
      ? await buildParentKeyToPathIndex(vaultFs, entries, resolveMaxSyncFileSizeBytes(options))
      : undefined
    const result = await syncEntries(
      vaultFs,
      entries,
      options,
      candidatePaths,
      parentKeyToPath,
      autoHealEnabled,
      (completed) => activity.update({ completed }),
    )

    result.durationMs = Date.now() - start
    // Scoped full sync writes the FULL walk's fingerprints but only parses
    // the scope subset — trusting that index would let the next incremental
    // fingerprint-skip out-of-scope files that actually changed. Only an
    // unscoped full sync leaves a trustworthy index behind.
    if (!rootPath) setVaultIndexTrustMarker()
    return result
  } finally {
    activity.end()
  }
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
  const autoHealEnabled = getCapabilityFeatureFlags().yaml_fields_auto_heal_enabled

  const activity = startActivity({
    kind: 'sync',
    channel: 'ambient',
    label: 'Syncing vault…',
    detail: 'Checking for changes',
  })
  try {
  const indexTrusted = consumeVaultIndexTrustMarker()
  const walked = await vaultFs.walkVault(['.md'])
  const excludedPrefixes = getSyncExcludedPathPrefixes()
  const allEntries = excludedPrefixes.length === 0
    ? walked
    : walked.filter(e => !isPathSyncExcluded(e.path, excludedPrefixes))

  // Find files modified since last sync
  const sinceSeconds = normalizeEpochSeconds(sinceTimestamp)
  const mtimeSelectedEntries = allEntries.filter(e => normalizeEpochSeconds(e.mtime) > sinceSeconds)

  // Fingerprint skip (iCloud churn absorber): if a selected file's exact
  // (mtime, size) pair is what the PREVIOUS completed sync's walk recorded,
  // that state was already processed — the mtime being past lastSync just
  // means iCloud re-materialized it between syncs. Skipping here avoids the
  // per-file re-read (a bridge round trip on iOS) entirely. Must be read
  // BEFORE replaceVaultFileIndex overwrites the previous walk's records, and
  // only applies when the trust marker says the previous sync finished clean.
  let updatedEntries = mtimeSelectedEntries
  if (indexTrusted && mtimeSelectedEntries.length > 0) {
    const prevIndex = await getVaultFileRecordsByPaths(mtimeSelectedEntries.map(e => e.path))
    updatedEntries = mtimeSelectedEntries.filter((entry) => {
      const prev = prevIndex.get(entry.path)
      const unchanged = prev !== undefined
        && prev.mtime === normalizeEpochSeconds(entry.mtime)
        && prev.size === entry.size
      return !unchanged
    })
  }

  // Detect deleted files — batch delete instead of N individual queries.
  // Excluded paths are ignored on both sides: if a cached entry sits under an
  // excluded prefix (e.g. an older webull node from before exclusion was set)
  // we leave it alone here and rely on the registration-time purge to clear
  // it. Skipping it from "deleted" detection just prevents churn.
  const currentPaths = new Set(allEntries.map(e => e.path))
  const cachedPaths = await getAllFilePaths()
  const suspectedDeletes: string[] = []
  for (const cachedPath of cachedPaths) {
    if (currentPaths.has(cachedPath)) continue
    if (isPathSyncExcluded(cachedPath, excludedPrefixes)) continue
    suspectedDeletes.push(cachedPath)
  }

  // Hybrid reconciliation (uuid-keyed for YAML files, path-keyed otherwise).
  // For each suspected delete, check if its uuid showed up at a new path —
  // if so it's a rename/move, not a delete. Renames don't bump mtime, so the
  // moved file's new path is usually filtered out of `updatedEntries` and
  // would have been silently dropped from the cache by the old path-based
  // logic. The hybrid path treats those as moves and preserves identity.
  const hybridEnabled = getCapabilityFeatureFlags().hybrid_sync_reconciliation_enabled
  const movedPathsToReparse = new Set<string>()
  const deletedPaths: string[] = []
  if (hybridEnabled && suspectedDeletes.length > 0) {
    const reconciled = await reconcileMovesByUuid({
      fs: vaultFs,
      allEntries,
      cachedPaths,
      suspectedDeletes,
      maxFileSizeBytes: resolveMaxSyncFileSizeBytes(options),
    })
    for (const p of reconciled.movedNewPaths) movedPathsToReparse.add(p)
    for (const p of reconciled.trueDeletes) deletedPaths.push(p)
  } else {
    deletedPaths.push(...suspectedDeletes)
  }

  if (deletedPaths.length > 0) {
    await bulkDeleteNodesByPaths(deletedPaths)
    await bulkDeleteLinksForFiles(deletedPaths)
  }
  const deletedCount = deletedPaths.length

  // Force-include moved paths even when mtime didn't change — their content
  // is the same but the cache entry's filePath has been updated and the link
  // index needs to be rebuilt from the new path.
  const updatedEntriesIncludingMoves = movedPathsToReparse.size === 0
    ? updatedEntries
    : (() => {
        const seen = new Set(updatedEntries.map(e => e.path))
        const extra = allEntries.filter(e => movedPathsToReparse.has(e.path) && !seen.has(e.path))
        return extra.length === 0 ? updatedEntries : [...updatedEntries, ...extra]
      })()

  const candidatePaths = allEntries.map(e => e.path)
  setCachedFilePaths(new Set(candidatePaths))
  await replaceVaultFileIndex(toVaultFileRecords(allEntries))

  // Build a path -> cached updated_at map so syncEntries can skip files whose
  // content is unchanged even though the OS bumped their mtime (typical on
  // iCloud-backed vaults). Per-path lookups parallelize cheaply via Dexie.
  const cachedUpdatedAtByPath = new Map<string, string>()
  await Promise.all(
    updatedEntriesIncludingMoves.map(async (entry) => {
      // Don't suppress reparse for moved files even if cached updatedAt matches —
      // the link index keys off filePath and must be rebuilt at the new path.
      if (movedPathsToReparse.has(entry.path)) return
      const node = await getNodeByPath(entry.path)
      if (node?.updatedAt) cachedUpdatedAtByPath.set(entry.path, node.updatedAt)
    }),
  )

  const movedCount = movedPathsToReparse.size
  activity.update({
    total: updatedEntriesIncludingMoves.length,
    completed: 0,
    detail: updatedEntriesIncludingMoves.length === 0
      ? 'Up to date'
      : [
          `${updatedEntriesIncludingMoves.length} changed`,
          movedCount ? `${movedCount} moved` : null,
          deletedCount ? `${deletedCount} removed` : null,
        ].filter(Boolean).join(', '),
  })
  // Incremental sync: skip the full-vault prepass and rely on getNodeByKey lookups
  // against IndexedDB for parent path resolution. Scanning every file here would
  // defeat the purpose of incremental sync.
  const result = await syncEntries(
    vaultFs,
    updatedEntriesIncludingMoves,
    options,
    candidatePaths,
    undefined,
    autoHealEnabled,
    (completed) => activity.update({ completed }),
    cachedUpdatedAtByPath,
  )
  result.deletedNodes = deletedCount
  result.totalFiles = allEntries.length
  result.durationMs = Date.now() - start

  // Clean finish: the index written above now matches the processed state,
  // so the NEXT incremental sync may use its fingerprints for skip-decisions.
  setVaultIndexTrustMarker()
  return result
  } finally {
    activity.end()
  }
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

    // Keep the file index current even for files the node cache will skip
    // (no frontmatter) — the command palette must still find them.
    if (filePath.toLowerCase().endsWith('.md')) {
      void upsertVaultFileIndexEntry({
        path: filePath,
        mtime: normalizeEpochSeconds(stat.mtime),
        size: stat.size,
      }).catch(() => {})
    }

    let content = await vaultFs.read(filePath)
    if (!hasFrontmatter(content)) return false

    const note = parseNote(content)
    if (!note) return false

    if (getCapabilityFeatureFlags().yaml_fields_auto_heal_enabled) {
      const healed = await healWikiLinksForNote(vaultFs, filePath, note)
      if (healed) content = healed
    }

    const record = frontmatterToRecord(note.frontmatter, filePath, note.body)
    await upsertNode(record)

    // Update link index for this file — use cached paths if available
    const candidatePaths = getCachedFilePathsArray() ?? [...await getAllFilePaths()]
    const links = extractLinksFromContentBlock(content, filePath, candidatePaths)
    const linkRecords: Omit<LinkRecord, 'id'>[] = links.map(l => ({
      sourceFilePath: filePath,
      targetFilePath: l.targetFilePath,
      linkType: l.linkType,
      rawText: l.rawText,
    }))
    await replaceLinksForFile(filePath, linkRecords)

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
    const stored = localStorage.getItem('thinkingspace:lastSyncTimestamp')
    return stored ? normalizeEpochSeconds(Number(stored)) : 0
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
      'thinkingspace:lastSyncTimestamp',
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

  // Fire-and-forget cross-device Home snapshot refresh. No-ops on
  // non-Electron platforms, where the snapshot is read-only.
  void regenerateHomeSnapshotAfterSync()

  return result
}

async function regenerateHomeSnapshotAfterSync(): Promise<void> {
  try {
    const { regenerateHomeSnapshot } = await import(
      '@/services/lego_blocks/integrations/homeSnapshotBlock'
    )
    await regenerateHomeSnapshot()
  } catch (err) {
    console.warn('[vaultSyncOrch] home snapshot regenerate failed', err)
  }
}

// ── Internals ──

const LINK_BATCH_SIZE = 500

async function syncEntries(
  fs: VaultFS,
  entries: VaultEntry[],
  options?: VaultSyncOptions,
  candidatePaths?: string[],
  parentKeyToPath?: Map<string, string>,
  autoHealEnabled?: boolean,
  onProgress?: (completed: number) => void,
  skipIfUpdatedAtMatches?: Map<string, string>,
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

  const allCandidatePaths = candidatePaths ?? entries.map(e => e.path)
  const pendingLinks: Omit<LinkRecord, 'id'>[] = []
  const pendingNodes: Omit<NodeRecord, 'id'>[] = []
  const isFullSync = candidatePaths !== undefined

  const NODE_BATCH_SIZE = 200

  async function flushNodes() {
    if (pendingNodes.length === 0) return
    const batch = pendingNodes.splice(0)
    const { conflicts } = await bulkUpsertNodes(batch)
    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        result.errors.push({
          path: conflict.filePath,
          error: formatNodeKeyConflictError(conflict),
        })
        reportNodeKeyConflictToDebugConsole(conflict)
      }
    }
  }

  async function flushLinks() {
    if (pendingLinks.length === 0) return
    if (isFullSync) {
      await bulkUpsertLinks(pendingLinks.splice(0))
    } else {
      // For incremental sync, replace per-file
      const bySource = new Map<string, Omit<LinkRecord, 'id'>[]>()
      for (const link of pendingLinks.splice(0)) {
        const existing = bySource.get(link.sourceFilePath)
        if (existing) existing.push(link)
        else bySource.set(link.sourceFilePath, [link])
      }
      for (const [source, links] of bySource) {
        await replaceLinksForFile(source, links)
      }
    }
  }

  // Process entries in small batches: parallelize the per-file fs.read
  // (each one is a bridge call on iOS / IPC on Electron and benefits from
  // overlap), then yield the event loop between batches so the renderer
  // can paint. Without this, a large incremental sync visibly freezes the
  // iOS UI for seconds at a time.
  const READ_BATCH_SIZE = getPlatformName() === 'ios' ? 8 : 16

  let progressCount = 0
  let nextProgressReport = 0
  for (let batchStart = 0; batchStart < entries.length; batchStart += READ_BATCH_SIZE) {
    const batch = entries.slice(batchStart, batchStart + READ_BATCH_SIZE)

    // Parallel reads. Each slot is either {content}, {error}, or null
    // (skipped because file is too large).
    type ReadSlot = { content: string } | { error: unknown } | null
    const reads: ReadSlot[] = await Promise.all(batch.map(async (entry) => {
      if (entry.size > maxFileSizeBytes) return null
      try {
        return { content: await fs.read(entry.path) }
      } catch (err) {
        return { error: err }
      }
    }))

    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i]
      const slot = reads[i]
      progressCount++
      if (onProgress && progressCount >= nextProgressReport) {
        onProgress(progressCount)
        // Report every ~2% of work, min every 5 files, to avoid bus churn.
        nextProgressReport = progressCount + Math.max(5, Math.floor(entries.length / 50))
      }
      if (slot === null) {
        result.skippedFiles++
        continue
      }
      if ('error' in slot) {
        result.errors.push({
          path: entry.path,
          error: slot.error instanceof Error ? slot.error.message : String(slot.error),
        })
        continue
      }
      try {
      let content = slot.content
      if (!hasFrontmatter(content)) {
        result.skippedFiles++
        continue
      }

      // iCloud-aware fast path: if the file's frontmatter `updated_at` matches
      // what we already cached for this path, skip the full parse + upsert.
      // iCloud frequently bumps mtimes when it re-materializes files in the
      // background, which would otherwise force a redundant reparse on every
      // focus event.
      if (skipIfUpdatedAtMatches && skipIfUpdatedAtMatches.size > 0) {
        const cachedUpdatedAt = skipIfUpdatedAtMatches.get(entry.path)
        if (cachedUpdatedAt) {
          const fileUpdatedAt = peekFrontmatterUpdatedAt(content)
          if (fileUpdatedAt && fileUpdatedAt === cachedUpdatedAt) {
            result.skippedFiles++
            continue
          }
        }
      }

      const note = parseNote(content)
      if (!note) {
        result.skippedFiles++
        continue
      }

      if (autoHealEnabled) {
        const healed = await healWikiLinksForNote(fs, entry.path, note, parentKeyToPath)
        if (healed) content = healed
      }

      const record = frontmatterToRecord(note.frontmatter, entry.path, note.body)
      pendingNodes.push(record)
      result.parsedNodes++

      // Extract links for the index
      const extracted = extractLinksFromContentBlock(content, entry.path, allCandidatePaths)
      for (const link of extracted) {
        pendingLinks.push({
          sourceFilePath: entry.path,
          targetFilePath: link.targetFilePath,
          linkType: link.linkType,
          rawText: link.rawText,
        })
      }

      if (pendingNodes.length >= NODE_BATCH_SIZE) {
        await flushNodes()
      }
      if (pendingLinks.length >= LINK_BATCH_SIZE) {
        await flushLinks()
      }
      } catch (err) {
        result.errors.push({
          path: entry.path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Yield to the event loop between batches so the UI can paint and
    // input events get serviced. On iOS this is the difference between
    // a responsive app and a frozen keyboard.
    if (batchStart + READ_BATCH_SIZE < entries.length) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }

  // Flush remaining batches
  await flushNodes()
  await flushLinks()

  return result
}

// Fast key extractor for the full-sync prepass: avoids a full YAML parse.
// Matches a top-level `key: <value>` line inside the leading frontmatter block.
const FRONTMATTER_KEY_RE = /^key:\s*["']?([^"'\n]+?)["']?\s*$/m

// Fast `updated_at` peek used by incremental sync to skip work on files whose
// content is unchanged despite a new mtime (common on iCloud-backed vaults
// where iCloud re-materializes files in the background).
const FRONTMATTER_UPDATED_AT_RE = /^updated_at:\s*["']?([^"'\n]+?)["']?\s*$/m

function peekFrontmatterUpdatedAt(content: string): string | null {
  if (!hasFrontmatter(content)) return null
  const match = FRONTMATTER_UPDATED_AT_RE.exec(content)
  return match?.[1]?.trim() ?? null
}

// Fast `uuid` peek used by hybrid reconciliation to detect moved files —
// matches a file's stable identity to a cached node even when its path has
// changed. Returns null for files without our YAML frontmatter (loose
// markdown), which correctly falls back to path-based handling.
const FRONTMATTER_UUID_RE = /^uuid:\s*["']?([^"'\n]+?)["']?\s*$/m

function peekFrontmatterUuid(content: string): string | null {
  if (!hasFrontmatter(content)) return null
  const match = FRONTMATTER_UUID_RE.exec(content)
  return match?.[1]?.trim() ?? null
}

interface HybridReconcileResultBlock {
  movedNewPaths: Set<string>
  trueDeletes: string[]
}

async function reconcileMovesByUuid(params: {
  fs: VaultFS
  allEntries: VaultEntry[]
  cachedPaths: Set<string>
  suspectedDeletes: string[]
  maxFileSizeBytes: number
}): Promise<HybridReconcileResultBlock> {
  const { fs, allEntries, cachedPaths, suspectedDeletes, maxFileSizeBytes } = params
  const trueDeletes: string[] = []
  const movedNewPaths = new Set<string>()

  // Candidate destinations = paths in the current walk that the cache has
  // never seen at this location. A move's new path always lands here.
  const newToCache = allEntries.filter(
    e => !cachedPaths.has(e.path) && e.size <= maxFileSizeBytes,
  )
  if (newToCache.length === 0) {
    return { movedNewPaths, trueDeletes: suspectedDeletes }
  }

  // Peek uuid for each new-to-cache path. Files without frontmatter return
  // null and simply don't participate in move detection.
  const newPathByUuid = new Map<string, string>()
  await Promise.all(newToCache.map(async (entry) => {
    try {
      const content = await fs.read(entry.path)
      const uuid = peekFrontmatterUuid(content)
      if (uuid) newPathByUuid.set(uuid, entry.path)
    } catch {
      // Unreadable file; treat as not-a-move-candidate.
    }
  }))

  if (newPathByUuid.size === 0) {
    return { movedNewPaths, trueDeletes: suspectedDeletes }
  }

  // Batch-fetch cached node records for the suspected-delete paths so we
  // can read their uuids in one indexed query.
  const cachedByPath = await getNodesByPaths(suspectedDeletes)

  for (const oldPath of suspectedDeletes) {
    const cachedNode = cachedByPath.get(oldPath)
    const cachedUuid = cachedNode?.uuid
    if (!cachedUuid) {
      // Loose-file row (no uuid) — fall back to path-based deletion. Documented
      // limitation: moves of files without YAML can't be tracked.
      trueDeletes.push(oldPath)
      continue
    }
    const newPath = newPathByUuid.get(cachedUuid)
    if (!newPath) {
      trueDeletes.push(oldPath)
      continue
    }
    // It's a move. Update the cache entry's filePath in place, rewrite the
    // link index so both outgoing (sourceFilePath) and incoming
    // (targetFilePath) link rows reflect the new path, and mark the new
    // path for reparse so the moved file's own outgoing links get
    // re-extracted at the new location.
    //
    // Source files containing markdown-style links like [text](oldPath) are
    // NOT rewritten here — the IndexedDB index is correct (backlinks
    // queries work), but if the user clicks such a link in another note
    // they'll hit a missing file until that linker note is re-saved. See
    // ADR notes / followup: source-file markdown rewrite on move.
    await updateNodeFilePath(cachedUuid, newPath)
    await updateLinkSourcePaths(oldPath, newPath)
    await updateLinkTargets(oldPath, newPath)
    movedNewPaths.add(newPath)
  }

  return { movedNewPaths, trueDeletes }
}

async function buildParentKeyToPathIndex(
  fs: VaultFS,
  entries: VaultEntry[],
  maxFileSizeBytes: number,
): Promise<Map<string, string>> {
  const keyToPath = new Map<string, string>()
  for (const entry of entries) {
    if (entry.size > maxFileSizeBytes) continue
    try {
      const content = await fs.read(entry.path)
      if (!hasFrontmatter(content)) continue
      const match = FRONTMATTER_KEY_RE.exec(content)
      const key = match?.[1]?.trim()
      if (!key) continue
      keyToPath.set(key, entry.path)
    } catch {
      // Ignore index misses; sync will report file-level issues separately.
    }
  }
  return keyToPath
}

/**
 * Heal generated wiki_links on an already-parsed note. Mutates note.frontmatter
 * in place and writes the file when something changed. Returns the rewritten
 * content if a write occurred, otherwise undefined (caller keeps original).
 */
async function healWikiLinksForNote(
  fs: VaultFS,
  filePath: string,
  note: YAMLNote,
  parentKeyToPath?: Map<string, string>,
): Promise<string | undefined> {
  const parentKey = typeof note.frontmatter.parent === 'string'
    ? note.frontmatter.parent.trim()
    : ''
  const parentFilePath = parentKey
    ? (parentKeyToPath?.get(parentKey) ?? (await getNodeByKey(parentKey))?.filePath)
    : undefined
  const { frontmatter: nextFrontmatter, changed } = mergeWikiLinksIntoFrontmatterBlock(
    note.frontmatter as Record<string, unknown>,
    {
      generatedLinks: resolveGeneratedWikiLinksForFrontmatterBlock(
        note.frontmatter as Record<string, unknown>,
        { parentFilePath },
      ),
    },
  )
  if (!changed) return undefined

  note.frontmatter = nextFrontmatter as YAMLFrontmatter
  const rewritten = stringifyNote(note)
  await fs.write(filePath, rewritten)
  return rewritten
}

function formatNodeKeyConflictError(conflict: NodeKeyConflictBlock): string {
  const other = conflict.conflictingFilePath || `[uuid:${conflict.conflictingUuid}]`
  return `Duplicate YAML key "${conflict.key}" — also claimed by "${other}". Rename the YAML \`key:\` field in one file so each node has a unique key.`
}

// De-dupe key for a conflict pair so we only emit one debug-console entry per
// (key, both-paths) per session. The same conflict surfaces on every sync tick
// until the user resolves it; the panel doesn't need 50 copies of it.
const reportedKeyConflictsBlock = new Set<string>()

function reportNodeKeyConflictToDebugConsole(conflict: NodeKeyConflictBlock): void {
  const pair = [conflict.filePath, conflict.conflictingFilePath].sort().join('|')
  const dedupeKey = `${conflict.key}::${pair}`
  if (reportedKeyConflictsBlock.has(dedupeKey)) return
  reportedKeyConflictsBlock.add(dedupeKey)

  const details = [
    `key: ${conflict.key}`,
    `file A: ${conflict.filePath || '[unknown]'} (uuid: ${conflict.uuid})`,
    `file B: ${conflict.conflictingFilePath || '[unknown]'} (uuid: ${conflict.conflictingUuid})`,
    '',
    'Fix: open one of the files and change the `key:` field in its YAML',
    'frontmatter to something unique, then re-sync. If one is a stale',
    'duplicate (e.g. left over from an iCloud move), delete that file.',
  ].join('\n')

  logError(
    `Duplicate YAML key "${conflict.key}" — two files claim it`,
    details,
    'vaultSync',
  )
}

/** Clears the in-session dedupe cache. Call after resolving conflicts. */
export function resetReportedKeyConflictsBlock(): void {
  reportedKeyConflictsBlock.clear()
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
