import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { pruneRevisionHistoryBlock } from '@/services/lego_blocks/integrations/revisionRetentionBlock'
import { splitFrontmatterDocumentBlock } from '@/services/lego_blocks/units/linkIndexBlock'

/**
 * Stamp `updated_at` into a note's YAML frontmatter so tooltips and downstream
 * consumers reflect the real last-edit time. This is the shared chokepoint every
 * in-app editor save flows through, so it's where "updated_at is automatic" lives.
 *
 * Only touches files that already have a frontmatter block — loose markdown is
 * written untouched (its "updated" falls back to filesystem mtime in the tooltip).
 * Surgical text edit: replaces an existing `updated_at:` line, else inserts it after
 * `created_at:`, else before the closing fence — preserving the user's frontmatter
 * formatting and key order rather than round-tripping through a YAML serializer.
 */
function stampUpdatedAtBlock(content: string, nowIso: string): string {
  const { frontmatter, body } = splitFrontmatterDocumentBlock(content)
  if (!frontmatter) return content
  const line = `updated_at: "${nowIso}"`
  if (/^updated_at:.*$/m.test(frontmatter)) {
    return frontmatter.replace(/^updated_at:.*$/m, line) + body
  }
  if (/^created_at:.*$/m.test(frontmatter)) {
    return frontmatter.replace(/^(created_at:.*)$/m, `$1\n${line}`) + body
  }
  const withLine = frontmatter.replace(/(\r?\n)(---\r?\n?)$/, `$1${line}$1$2`)
  return withLine === frontmatter ? content : withLine + body
}

function hashContent(content: string): string {
  // FNV-1a 32-bit hash is fast and stable enough for local conflict detection.
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

interface MarkdownReadCacheEntry {
  path: string
  content: string
  mtime: number
  ctime: number
  size: number
  hash: string
  cachedAt: number
}

const MARKDOWN_READ_CACHE_TTL_MS = 4_000
const MARKDOWN_READ_CACHE_MAX_ENTRIES = 8
const markdownReadCacheByPath = new Map<string, MarkdownReadCacheEntry>()
const markdownReadInFlightByPath = new Map<string, Promise<MarkdownReadCacheEntry>>()

function readCacheEntry(path: string): MarkdownReadCacheEntry | null {
  const entry = markdownReadCacheByPath.get(path)
  if (!entry) return null
  if ((Date.now() - entry.cachedAt) > MARKDOWN_READ_CACHE_TTL_MS) {
    markdownReadCacheByPath.delete(path)
    return null
  }
  return entry
}

function writeCacheEntry(path: string, entry: Omit<MarkdownReadCacheEntry, 'cachedAt'>): MarkdownReadCacheEntry {
  const next: MarkdownReadCacheEntry = { ...entry, cachedAt: Date.now() }
  markdownReadCacheByPath.set(path, next)
  while (markdownReadCacheByPath.size > MARKDOWN_READ_CACHE_MAX_ENTRIES) {
    const oldestKey = markdownReadCacheByPath.keys().next().value
    if (typeof oldestKey !== 'string') break
    markdownReadCacheByPath.delete(oldestKey)
  }
  return next
}

async function readMarkdownDocumentShared(path: string): Promise<MarkdownReadCacheEntry> {
  const existing = markdownReadInFlightByPath.get(path)
  if (existing) return existing

  const request = (async (): Promise<MarkdownReadCacheEntry> => {
    const fs = getVaultFS()
    const stat = await fs.stat(path)
    const cached = readCacheEntry(path)
    if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
      return cached
    }

    const content = await fs.read(path)
    const ctime = stat.ctime ?? stat.mtime
    return writeCacheEntry(path, {
      path,
      content,
      mtime: stat.mtime,
      ctime,
      size: stat.size,
      hash: hashContent(content),
    })
  })()

  markdownReadInFlightByPath.set(path, request)
  return request.finally(() => {
    if (markdownReadInFlightByPath.get(path) === request) {
      markdownReadInFlightByPath.delete(path)
    }
  })
}

function buildRevisionPath(filePath: string): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  const day = `${y}-${m}-${d}`
  const time = `${hh}${mm}${ss}-${ms}`

  const safePath = filePath
    .replace(/\//g, '__')
    .replace(/\\/g, '__')
    .replace(/ /g, '_')

  // iOS/APFS has a 255-byte filename limit. The prefix (time--) is ~14 chars,
  // so cap the safePath portion to keep the total filename under 200 chars.
  // When truncated, append a short hash of the full path for uniqueness.
  const MAX_SAFE_PATH_LEN = 180
  const truncatedPath = safePath.length > MAX_SAFE_PATH_LEN
    ? safePath.slice(0, MAX_SAFE_PATH_LEN) + '--' + hashContent(safePath).slice(0, 8)
    : safePath

  return `.thinking-space/revisions/${day}/${time}--${truncatedPath}`
}

function isAlreadyExistsFsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return normalized.includes('already exists')
    || normalized.includes('cannot be overwritten')
    || normalized.includes('eexist')
}

export class MarkdownDocumentConflictError extends Error {
  readonly code = 'MARKDOWN_DOCUMENT_CONFLICT'
  readonly currentMtime: number
  readonly currentHash: string
  readonly currentContent: string

  constructor(message: string, details: { currentMtime: number; currentHash: string; currentContent: string }) {
    super(message)
    this.name = 'MarkdownDocumentConflictError'
    this.currentMtime = details.currentMtime
    this.currentHash = details.currentHash
    this.currentContent = details.currentContent
  }
}

export async function readMarkdownDocument(path: string): Promise<{
  path: string
  content: string
  mtime: number
  ctime: number
  size: number
  hash: string
}>
export async function readMarkdownDocument(
  path: string,
  options: { includeHash: false },
): Promise<{
  path: string
  content: string
  mtime: number
  ctime: number
  size: number
  hash: null
}>
export async function readMarkdownDocument(
  path: string,
  options?: { includeHash?: boolean },
): Promise<{
  path: string
  content: string
  mtime: number
  ctime: number
  size: number
  hash: string | null
}> {
  const cached = await readMarkdownDocumentShared(path)
  const includeHash = options?.includeHash ?? true
  return {
    path,
    content: cached.content,
    mtime: cached.mtime,
    ctime: cached.ctime,
    size: cached.size,
    hash: includeHash ? cached.hash : null,
  }
}

export async function saveMarkdownDocument(params: {
  path: string
  content: string
  baseMtime: number
  baseHash?: string | null
  baseContent?: string | null
}): Promise<{ output_path: string; revision_path: string | null; mtime: number; ctime: number; size: number; hash: string }> {
  const fs = getVaultFS()

  const current = await readMarkdownDocumentShared(params.path)
  const currentContent = current.content
  const mtimeChanged = current.mtime !== params.baseMtime
  const hashProvided = typeof params.baseHash === 'string' && params.baseHash.length > 0
  const contentProvided = typeof params.baseContent === 'string'
  const hashChanged = hashProvided ? current.hash !== params.baseHash : false
  const contentChanged = contentProvided ? currentContent !== params.baseContent : false

  if (mtimeChanged || hashChanged || (!hashProvided && contentProvided && contentChanged)) {
    throw new MarkdownDocumentConflictError(
      'This file changed since you opened it. Reload latest content before saving.',
      {
        currentMtime: current.mtime,
        currentHash: current.hash,
        currentContent,
      },
    )
  }

  // Auto-stamp updated_at, but only on a real content change (not open-and-close
  // no-op saves) so the timestamp tracks edits, not opens.
  const finalContent = currentContent !== params.content
    ? stampUpdatedAtBlock(params.content, new Date().toISOString())
    : params.content

  let revisionPath: string | null = null
  if (currentContent !== finalContent) {
    revisionPath = buildRevisionPath(params.path)
    const revisionDir = revisionPath.includes('/')
      ? revisionPath.slice(0, revisionPath.lastIndexOf('/'))
      : ''
    if (revisionDir) {
      const exists = await fs.exists(revisionDir).catch(() => false)
      if (!exists) {
        try {
          await fs.mkdir(revisionDir)
        } catch (error) {
          const appeared = await fs.exists(revisionDir).catch(() => false)
          if (!appeared && !isAlreadyExistsFsError(error)) {
            throw error
          }
        }
      }
    }
    await fs.write(revisionPath, currentContent)
  }

  await fs.write(params.path, finalContent)
  if (revisionPath) {
    await pruneRevisionHistoryBlock(revisionPath).catch((error) => {
      console.warn('[markdownDocumentsOrch] Failed to prune revision history:', error)
    })
  }
  const savedStat = await fs.stat(params.path)
  const savedHash = hashContent(finalContent)
  writeCacheEntry(params.path, {
    path: params.path,
    content: finalContent,
    mtime: savedStat.mtime,
    ctime: savedStat.ctime ?? savedStat.mtime,
    size: savedStat.size,
    hash: savedHash,
  })
  return {
    output_path: params.path,
    revision_path: revisionPath,
    mtime: savedStat.mtime,
    ctime: savedStat.ctime ?? savedStat.mtime,
    size: savedStat.size,
    hash: savedHash,
  }
}
