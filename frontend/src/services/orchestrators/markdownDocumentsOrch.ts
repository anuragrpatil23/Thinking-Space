import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getActiveSpaceIdBlock } from '@/services/orchestrators/storageOrch'

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

function getCacheKey(path: string): string {
  return `${getActiveSpaceIdBlock()}::${path}`
}

function readCacheEntry(path: string): MarkdownReadCacheEntry | null {
  const cacheKey = getCacheKey(path)
  const entry = markdownReadCacheByPath.get(cacheKey)
  if (!entry) return null
  if ((Date.now() - entry.cachedAt) > MARKDOWN_READ_CACHE_TTL_MS) {
    markdownReadCacheByPath.delete(cacheKey)
    return null
  }
  return entry
}

function writeCacheEntry(path: string, entry: Omit<MarkdownReadCacheEntry, 'cachedAt'>): MarkdownReadCacheEntry {
  const cacheKey = getCacheKey(path)
  const next: MarkdownReadCacheEntry = { ...entry, cachedAt: Date.now() }
  markdownReadCacheByPath.set(cacheKey, next)
  while (markdownReadCacheByPath.size > MARKDOWN_READ_CACHE_MAX_ENTRIES) {
    const oldestKey = markdownReadCacheByPath.keys().next().value
    if (typeof oldestKey !== 'string') break
    markdownReadCacheByPath.delete(oldestKey)
  }
  return next
}

async function readMarkdownDocumentShared(path: string): Promise<MarkdownReadCacheEntry> {
  const cacheKey = getCacheKey(path)
  const existing = markdownReadInFlightByPath.get(cacheKey)
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

  markdownReadInFlightByPath.set(cacheKey, request)
  return request.finally(() => {
    if (markdownReadInFlightByPath.get(cacheKey) === request) {
      markdownReadInFlightByPath.delete(cacheKey)
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

  let revisionPath: string | null = null
  if (currentContent !== params.content) {
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

  await fs.write(params.path, params.content)
  const savedStat = await fs.stat(params.path)
  const savedHash = hashContent(params.content)
  writeCacheEntry(params.path, {
    path: params.path,
    content: params.content,
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
