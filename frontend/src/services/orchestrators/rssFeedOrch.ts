import { parseFeed } from 'feedsmith'
import * as yaml from 'js-yaml'
import {
  STORAGE_KEYS,
  getJsonStorageItem,
  setJsonStorageItem,
} from '@/services/lego_blocks/units/storageKeyBlock'
import {
  generateFeedIdBlock,
  generateGroupIdBlock,
  extractFirstHtmlImageBlock,
  extractRssItemImageBlock,
  normalizeRssFeedItemIdBlock,
  normalizeRssFeedPreferencesBlock,
  type RssFeedConfigBlock,
  type RssFeedGroupBlock,
  type RssFeedItemBlock,
  type RssFeedPreferencesBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import { getVaultFS, isElectron } from '@/services/lego_blocks/integrations/fsBlock'

// ---------------------------------------------------------------------------
// Feed config persistence — vault-backed so configs sync across devices
// ---------------------------------------------------------------------------

const RSS_DIR = '.thinking-space/preferences'
const RSS_FILE = `${RSS_DIR}/rss-feeds.json`

// ---------------------------------------------------------------------------
// Article persistence — one .md file per article, per feed
// ---------------------------------------------------------------------------

const RSS_ARTICLES_DIR = '.thinking-space/rss-feeds'
const RSS_FETCH_TIMEOUT_MS = 12_000

/** Stable filename for an article derived from its item ID. */
function itemFilenameBlock(itemId: string): string {
  // itemId format: "feed-xxx::hash" — use the hash portion as filename
  const hash = itemId.split('::')[1] ?? itemId.replace(/[^a-z0-9]/gi, '').slice(0, 16)
  return `${hash}.md`
}

interface RssItemFrontmatter {
  id: string
  feedId: string
  feedTitle: string
  title: string
  link: string
  pubDate: string | null
  imageUrl?: string | null
  fetchedAt: string
  read: boolean
  viewedAt?: string | null
  dismissedAt?: string | null
  tags?: string[]
  [key: string]: unknown
}

function serializeRssItemFileBlock(
  item: RssFeedItemBlock,
  feedTitle: string,
  fetchedAt: string,
): string {
  const fm: RssItemFrontmatter = {
    id: item.id,
    feedId: item.feedId,
    feedTitle,
    title: item.title,
    link: item.link,
    pubDate: item.pubDate ?? null,
    imageUrl: item.imageUrl ?? null,
    fetchedAt,
    read: item.read,
    viewedAt: item.viewedAt,
    dismissedAt: item.dismissedAt,
    tags: item.tags ?? [],
    keep: item.keep ?? false,
    important: item.important ?? false,
  }
  const yamlStr = (yaml.dump(fm, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  }) as string).trimEnd()
  return `---\n${yamlStr}\n---\n\n${item.description}`
}

function parseRssItemFileBlock(content: string): RssFeedItemBlock | null {
  if (!content.startsWith('---')) return null
  const closeIdx = content.indexOf('\n---', 4)
  if (closeIdx === -1) return null
  const yamlStr = content.slice(4, closeIdx)
  const body = content.slice(closeIdx + 4).replace(/^\n+/, '')
  let fm: unknown
  try {
    fm = yaml.load(yamlStr)
  } catch {
    return null
  }
  if (!fm || typeof fm !== 'object') return null
  const f = fm as Record<string, unknown>
  const id = typeof f.id === 'string' ? f.id : ''
  if (!id) return null
  const viewedAt = typeof f.viewedAt === 'string' ? f.viewedAt : null
  const dismissedAt = typeof f.dismissedAt === 'string' ? f.dismissedAt : null
  return {
    id,
    feedId: typeof f.feedId === 'string' ? f.feedId : '',
    title: typeof f.title === 'string' ? f.title : '',
    link: typeof f.link === 'string' ? f.link : '',
    description: body,
    pubDate: typeof f.pubDate === 'string' ? f.pubDate : null,
    imageUrl: typeof f.imageUrl === 'string' ? f.imageUrl : null,
    // Legacy `read: true` meant that the reader had engaged with an item. Keep
    // that history as a viewed event instead of silently resurrecting it as new.
    read: f.read === true || viewedAt !== null || dismissedAt !== null,
    viewedAt: viewedAt ?? (f.read === true ? (typeof f.fetchedAt === 'string' ? f.fetchedAt : new Date(0).toISOString()) : null),
    dismissedAt,
    tags: Array.isArray(f.tags) ? (f.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    keep: f.keep === true,
    important: f.important === true,
  }
}

async function ensureRssArticleDirOrch(feedId: string): Promise<void> {
  const fs = getVaultFS()
  try { await fs.mkdir('.thinking-space') } catch { /* exists */ }
  try { await fs.mkdir(RSS_ARTICLES_DIR) } catch { /* exists */ }
  try { await fs.mkdir(`${RSS_ARTICLES_DIR}/${feedId}`) } catch { /* exists */ }
}

async function readStoredFeedFilesOrch(
  dir: string,
  files: string[],
): Promise<Map<string, RssFeedItemBlock>> {
  const fs = getVaultFS()
  const result = new Map<string, RssFeedItemBlock>()
  // Capacitor filesystem calls resolve on the JS thread. Keep the work in
  // small batches so a large live window never monopolizes a scroll frame.
  for (let offset = 0; offset < files.length; offset += 8) {
    await Promise.all(files.slice(offset, offset + 8).map(async filename => {
      try {
        const content = await fs.read(`${dir}/${filename}`)
        const item = parseRssItemFileBlock(content)
        if (item?.id) result.set(item.id, item)
      } catch { /* state file may not exist yet */ }
    }))
    if (offset + 8 < files.length) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
  }
  return result
}

async function listStoredFeedFilesOrch(feedId: string): Promise<string[]> {
  const fs = getVaultFS()
  const dir = `${RSS_ARTICLES_DIR}/${feedId}`
  try {
    const listed = await fs.list(dir)
    return listed.files.filter(f => f.endsWith('.md'))
  } catch {
    return []
  }
}

async function loadStoredFeedItemsOrch(feedId: string, itemIds?: string[]): Promise<Map<string, RssFeedItemBlock>> {
  const dir = `${RSS_ARTICLES_DIR}/${feedId}`
  const files = itemIds
    // A live RSS response normally contains a few dozen items; reading their
    // state is cheap. Reading every retained item on every panel open was not.
    ? [...new Set(itemIds.map(itemFilenameBlock))]
    : await listStoredFeedFilesOrch(feedId)
  return readStoredFeedFilesOrch(dir, files)
}

/** Hydrate cached, feed-expired articles only after the live window is usable.
 * The backlog is important (especially unread items), but it must never block
 * the first scroll. Each page yields to the browser before the next begins. */
async function streamStoredFeedItemsOrch(
  feedId: string,
  onPage: (items: RssFeedItemBlock[]) => void,
): Promise<void> {
  const files = await listStoredFeedFilesOrch(feedId)
  const dir = `${RSS_ARTICLES_DIR}/${feedId}`
  for (let offset = 0; offset < files.length; offset += 24) {
    const page = await readStoredFeedFilesOrch(dir, files.slice(offset, offset + 24))
    if (page.size > 0) onPage([...page.values()])
    // This is a bounded, active feed-hydration task—not a periodic poll. The
    // gap gives scrolling and input a frame between retained-cache pages.
    if (offset + 24 < files.length) await new Promise<void>(resolve => window.setTimeout(resolve, 120))
  }
}

async function writeRssItemFileOrch(
  feedId: string,
  feedTitle: string,
  item: RssFeedItemBlock,
): Promise<void> {
  const fs = getVaultFS()
  const path = `${RSS_ARTICLES_DIR}/${feedId}/${itemFilenameBlock(item.id)}`
  await fs.write(path, serializeRssItemFileBlock(item, feedTitle, new Date().toISOString()))
}

// ---------------------------------------------------------------------------
// Retention settings
// ---------------------------------------------------------------------------

export const RSS_RETENTION_DEFAULT_DAYS = 30

export function getRssRetentionDaysOrch(): number {
  const val = getJsonStorageItem<number>(STORAGE_KEYS.rssFeedRetentionDays, RSS_RETENTION_DEFAULT_DAYS)
  return typeof val === 'number' && val > 0 ? val : RSS_RETENTION_DEFAULT_DAYS
}

export function setRssRetentionDaysOrch(days: number): void {
  setJsonStorageItem(STORAGE_KEYS.rssFeedRetentionDays, days)
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

/** Reads raw frontmatter record from an RSS article file. */
function extractRssFrontmatterBlock(content: string): Record<string, unknown> | null {
  if (!content.startsWith('---')) return null
  const closeIdx = content.indexOf('\n---', 4)
  if (closeIdx === -1) return null
  try {
    const parsed = yaml.load(content.slice(4, closeIdx))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * Deletes stored articles for a feed that are older than retentionDays,
 * unless they have tags or `keep: true` / `important: true` in their frontmatter.
 * Called fire-and-forget after each fetch.
 */
async function purgeOldRssItemsOrch(feedId: string, retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return
  const fs = getVaultFS()
  const dir = `${RSS_ARTICLES_DIR}/${feedId}`
  let files: string[]
  try {
    const listed = await fs.list(dir)
    files = listed.files.filter(f => f.endsWith('.md'))
  } catch {
    return // directory doesn't exist yet
  }

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000

  await Promise.all(files.map(async filename => {
    const path = `${dir}/${filename}`
    try {
      const content = await fs.read(path)
      const fm = extractRssFrontmatterBlock(content)
      if (!fm) return

      // Never purge items the user has flagged
      const tags = Array.isArray(fm.tags) ? fm.tags : []
      if (tags.length > 0 || fm.keep === true || fm.important === true) return

      // Determine age from fetchedAt, falling back to pubDate
      const dateStr = typeof fm.fetchedAt === 'string' ? fm.fetchedAt
        : typeof fm.pubDate === 'string' ? fm.pubDate
        : null
      if (!dateStr) return // can't determine age, keep it safe

      const ageMs = new Date(dateStr).getTime()
      if (isNaN(ageMs) || ageMs >= cutoffMs) return // not old enough

      await fs.delete(path)
    } catch { /* skip files we can't read/delete */ }
  }))
}

async function patchRssItemFrontmatterOrch(
  itemId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const fs = getVaultFS()
  const feedId = itemId.split('::')[0]
  const path = `${RSS_ARTICLES_DIR}/${feedId}/${itemFilenameBlock(itemId)}`
  try {
    const content = await fs.read(path)
    const closeIdx = content.indexOf('\n---', 4)
    if (closeIdx === -1) return
    let fm: unknown
    try { fm = yaml.load(content.slice(4, closeIdx)) } catch { return }
    if (!fm || typeof fm !== 'object') return
    const updated = { ...(fm as Record<string, unknown>), ...patch }
    const newYaml = (yaml.dump(updated, {
      lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"',
    }) as string).trimEnd()
    const body = content.slice(closeIdx + 4).replace(/^\n+/, '')
    await fs.write(path, `---\n${newYaml}\n---\n\n${body}`)
  } catch { /* file may not exist yet; silently ignore */ }
}

async function updateRssItemStateOrch(
  itemId: string,
  patch: { viewedAt?: string | null; dismissedAt?: string | null },
): Promise<void> {
  const read = Boolean(patch.viewedAt || patch.dismissedAt)
  await patchRssItemFrontmatterOrch(itemId, { ...patch, read })
}

export async function updateRssItemMetaOrch(
  itemId: string,
  patch: { tags?: string[]; keep?: boolean; important?: boolean },
): Promise<void> {
  await patchRssItemFrontmatterOrch(itemId, patch as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// Feed config persistence — vault-backed so configs sync across devices
// ---------------------------------------------------------------------------

async function ensureRssDirOrch(): Promise<void> {
  const fs = getVaultFS()
  try { await fs.mkdir('.thinking-space') } catch { /* exists */ }
  try { await fs.mkdir(RSS_DIR) } catch { /* exists */ }
}

// ---------------------------------------------------------------------------
// Preferences persistence — single vault file for feeds, groups, preset tags
// ---------------------------------------------------------------------------

export async function readRssFeedPreferencesOrch(): Promise<RssFeedPreferencesBlock> {
  const fs = getVaultFS()
  try {
    const raw = await fs.read(RSS_FILE)
    return normalizeRssFeedPreferencesBlock(JSON.parse(raw))
  } catch {
    // File missing or unreadable — check localStorage for a one-time migration.
    const legacy = getJsonStorageItem<RssFeedConfigBlock[]>(STORAGE_KEYS.rssFeedConfigs, [])
    if (legacy.length > 0) {
      const prefs = normalizeRssFeedPreferencesBlock(legacy)
      try {
        await ensureRssDirOrch()
        await fs.write(RSS_FILE, JSON.stringify(prefs, null, 2))
        setJsonStorageItem(STORAGE_KEYS.rssFeedConfigs, [])
      } catch {
        // Migration write failed — just return localStorage data.
      }
      return prefs
    }
    return normalizeRssFeedPreferencesBlock(null)
  }
}

async function writeRssFeedPreferencesOrch(prefs: RssFeedPreferencesBlock): Promise<void> {
  const fs = getVaultFS()
  await ensureRssDirOrch()
  await fs.write(RSS_FILE, JSON.stringify(prefs, null, 2))
}

export async function readRssFeedConfigsOrch(): Promise<RssFeedConfigBlock[]> {
  const prefs = await readRssFeedPreferencesOrch()
  return prefs.feeds
}

export async function addRssFeedOrch(
  url: string,
  title?: string,
  groupId?: string | null,
): Promise<RssFeedConfigBlock> {
  const prefs = await readRssFeedPreferencesOrch()
  const entry: RssFeedConfigBlock = {
    id: generateFeedIdBlock(),
    url: url.trim(),
    title: title?.trim() || domainLabel(url),
    groupId: groupId ?? null,
  }
  prefs.feeds.push(entry)
  await writeRssFeedPreferencesOrch(prefs)
  await ensureRssArticleDirOrch(entry.id)
  return entry
}

export async function removeRssFeedOrch(feedId: string): Promise<void> {
  const prefs = await readRssFeedPreferencesOrch()
  prefs.feeds = prefs.feeds.filter(c => c.id !== feedId)
  await writeRssFeedPreferencesOrch(prefs)
}

export async function updateRssFeedOrch(
  feedId: string,
  patch: Partial<Pick<RssFeedConfigBlock, 'url' | 'title' | 'groupId'>>,
): Promise<void> {
  const prefs = await readRssFeedPreferencesOrch()
  prefs.feeds = prefs.feeds.map(c =>
    c.id === feedId ? { ...c, ...patch } : c,
  )
  await writeRssFeedPreferencesOrch(prefs)
}

// ---------------------------------------------------------------------------
// Group CRUD
// ---------------------------------------------------------------------------

export async function addRssFeedGroupOrch(
  name: string,
  parentGroupId?: string | null,
): Promise<RssFeedGroupBlock> {
  const prefs = await readRssFeedPreferencesOrch()
  const group: RssFeedGroupBlock = {
    id: generateGroupIdBlock(),
    name: name.trim(),
    parentGroupId: parentGroupId ?? null,
  }
  prefs.groups.push(group)
  await writeRssFeedPreferencesOrch(prefs)
  return group
}

export async function removeRssFeedGroupOrch(groupId: string): Promise<void> {
  const prefs = await readRssFeedPreferencesOrch()
  // Collect group + all descendant groups
  const idsToRemove = new Set<string>()
  function collect(id: string) {
    idsToRemove.add(id)
    for (const g of prefs.groups) {
      if (g.parentGroupId === id) collect(g.id)
    }
  }
  collect(groupId)
  prefs.groups = prefs.groups.filter(g => !idsToRemove.has(g.id))
  // Ungroup feeds that were in removed groups
  prefs.feeds = prefs.feeds.map(f =>
    f.groupId && idsToRemove.has(f.groupId) ? { ...f, groupId: null } : f,
  )
  await writeRssFeedPreferencesOrch(prefs)
}

export async function updateRssFeedGroupOrch(
  groupId: string,
  patch: Partial<Pick<RssFeedGroupBlock, 'name' | 'parentGroupId'>>,
): Promise<void> {
  const prefs = await readRssFeedPreferencesOrch()
  prefs.groups = prefs.groups.map(g =>
    g.id === groupId ? { ...g, ...patch } : g,
  )
  await writeRssFeedPreferencesOrch(prefs)
}

export async function moveFeedToGroupOrch(
  feedId: string,
  groupId: string | null,
): Promise<void> {
  await updateRssFeedOrch(feedId, { groupId })
}

// ---------------------------------------------------------------------------
// Preset tags CRUD
// ---------------------------------------------------------------------------

export async function updateRssPresetTagsOrch(
  presetTags: string[],
  tagColors: Record<string, string>,
): Promise<void> {
  const prefs = await readRssFeedPreferencesOrch()
  prefs.presetTags = presetTags
  prefs.tagColors = tagColors
  await writeRssFeedPreferencesOrch(prefs)
}

// ---------------------------------------------------------------------------
// Article-state persistence — vault files are the sole cross-device authority
// ---------------------------------------------------------------------------

/**
 * Moves an RSS article file from the RSS articles dir to a vault folder chosen
 * by the user. All frontmatter (tags, keep, important, link, etc.) is preserved.
 * Returns the new vault-relative path.
 */
export async function moveRssArticleToVaultOrch(
  item: RssFeedItemBlock,
  destinationFolderPath: string,
): Promise<string> {
  const fs = getVaultFS()
  const feedId = item.id.split('::')[0]
  const sourcePath = `${RSS_ARTICLES_DIR}/${feedId}/${itemFilenameBlock(item.id)}`

  // Read the stored file; fall back to generating content if not yet persisted.
  let content: string
  try {
    content = await fs.read(sourcePath)
  } catch {
    content = serializeRssItemFileBlock(item, item.feedId, new Date().toISOString())
  }

  // Build a readable destination filename from the article title.
  const safeTitle = item.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'article'
  const shortHash = item.id.split('::')[1]?.slice(0, 6) ?? Date.now().toString(36)
  const filename = `${safeTitle}-${shortHash}.md`
  const destPath = destinationFolderPath ? `${destinationFolderPath}/${filename}` : filename

  await fs.write(destPath, content)
  try { await fs.delete(sourcePath) } catch { /* already gone */ }

  return destPath
}

export async function removeRssItemsOrch(itemIds: string[]): Promise<void> {
  const fs = getVaultFS()
  await Promise.all(itemIds.map(async itemId => {
    const feedId = itemId.split('::')[0]
    const path = `${RSS_ARTICLES_DIR}/${feedId}/${itemFilenameBlock(itemId)}`
    try { await fs.delete(path) } catch { /* already gone */ }
  }))
}

/** Explicit, intentional dismissal. This is the state bulk "Mark read" uses. */
export async function markRssItemReadOrch(itemId: string): Promise<void> {
  await updateRssItemStateOrch(itemId, { dismissedAt: new Date().toISOString() })
}

export async function markRssItemsReadOrch(itemIds: string[]): Promise<void> {
  const dismissedAt = new Date().toISOString()
  await Promise.all(itemIds.map(itemId => updateRssItemStateOrch(itemId, { dismissedAt })))
}

/** Automatic, meaningful on-screen exposure. Kept separate from an explicit
 * dismissal so the timeline can be effortless without pretending a glance was
 * a deliberate skip. */
export async function markRssItemViewedOrch(itemId: string): Promise<void> {
  await updateRssItemStateOrch(itemId, { viewedAt: new Date().toISOString() })
}

/**
 * Put an article back to unread.
 *
 * Clears BOTH timestamps, not just the explicit dismissal: `read` is the
 * projection of `viewedAt || dismissedAt`, so leaving an automatic view behind
 * would silently keep the article read and make the undo look broken. Scrolling
 * past an article marks it viewed, so this is the only way back from a mark the
 * reader never intended.
 */
export async function unmarkRssItemReadOrch(itemId: string): Promise<void> {
  await updateRssItemStateOrch(itemId, { viewedAt: null, dismissedAt: null })
}

// ---------------------------------------------------------------------------
// Fetch and parse
// ---------------------------------------------------------------------------

async function fetchRssFeedTextBlock(url: string): Promise<{ status: number; body: string }> {
  if (isElectron() && window.electronAPI?.fetchText) {
    return await raceTimeoutBlock(
      window.electronAPI.fetchText(url),
      RSS_FETCH_TIMEOUT_MS,
      `RSS fetch timed out after ${Math.round(RSS_FETCH_TIMEOUT_MS / 1000)}s`,
    )
  }

  const controller = new AbortController()
  const timeoutHandle = window.setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`RSS fetch timed out after ${Math.round(RSS_FETCH_TIMEOUT_MS / 1000)}s`)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutHandle)
  }
}

export async function fetchAndParseRssFeedOrch(
  config: RssFeedConfigBlock,
  options?: {
    onStoredResult?: (result: RssFeedResultBlock) => void
    onStoredPage?: (result: RssFeedResultBlock) => void
  },
): Promise<RssFeedResultBlock> {
  // On iOS, Capacitor can surface raw readdir plugin errors for missing folders
  // even when the rejection is handled. Create the per-feed cache directory first.
  await ensureRssArticleDirOrch(config.id)
  try {
    const response = await fetchRssFeedTextBlock(config.url)
    if (response.status < 200 || response.status >= 300) {
      const storedItems = await loadStoredFeedItemsOrch(config.id)
      return buildStoredResultBlock(config, storedItems, `HTTP ${response.status}`)
    }

    const { format, feed } = parseFeed(response.body)
    const feedAny = feed as Record<string, unknown>
    const entries = (
      format === 'atom'
        ? (feedAny.entries as Record<string, unknown>[] | undefined)
        : (feedAny.items as Record<string, unknown>[] | undefined)
    ) ?? []

    const feedTitleRaw = feedAny.title
    const feedTitle = (typeof feedTitleRaw === 'string' ? feedTitleRaw.trim() : '') || config.title

    const parsedLiveItems: RssFeedItemBlock[] = entries.map(item => {
      const guidObj = item.guid as { value?: string } | undefined
      const guid = typeof item.id === 'string' ? item.id : guidObj?.value
      const linkRaw = item.link ?? item.url
      const link = typeof linkRaw === 'string' ? linkRaw
        : (Array.isArray(item.links) ? extractAtomLinkBlock(item.links) : undefined)
      const titleRaw = item.title
      const title = typeof titleRaw === 'string' ? titleRaw
        : (typeof titleRaw === 'object' && titleRaw !== null ? String((titleRaw as { value?: unknown }).value ?? '') : '')
      // Prefer full feed content. The compact reader only showed a short
      // excerpt, but the timeline's job is to let the feed itself carry the
      // decision before someone opens the original page.
      const bodyRaw = item.content ?? item.description ?? item.summary
      const description = typeof bodyRaw === 'string' ? bodyRaw
        : (typeof bodyRaw === 'object' && bodyRaw !== null ? String((bodyRaw as { value?: unknown }).value ?? '') : '')
      // Structured media first; the body's first <img> is the fallback, and has
      // to be read before `description` is stripped to plain text below.
      const imageUrl = extractRssItemImageBlock(item, link ?? '')
        ?? extractFirstHtmlImageBlock(description, link ?? '')
      // Slashdot and other RSS 1.0/RDF feeds carry no <pubDate>; their date is
      // Dublin Core (`dc:date`), which feedsmith exposes under item.dc / dcterms.
      const pubDate = extractDateBlock(
        item.pubDate ?? item.published ?? item.updated
        ?? extractDublinCoreDateBlock(item.dc) ?? extractDublinCoreDateBlock(item.dcterms),
      )
      const id = normalizeRssFeedItemIdBlock(config.id, guid, link, title)

      return {
        id,
        feedId: config.id,
        title,
        link: link ?? '',
        description: stripHtmlBlock(description),
        pubDate,
        imageUrl,
        read: false,
        viewedAt: null,
        dismissedAt: null,
        tags: [],
        keep: false,
        important: false,
      }
    })

    // Fetch/parse first; then only hydrate durable state for articles the feed
    // still publishes. The old path eagerly opened every retained markdown
    // file (often hundreds per feed) before showing one row.
    const storedItems = await loadStoredFeedItemsOrch(config.id, parsedLiveItems.map(item => item.id))
    options?.onStoredResult?.(buildStoredResultBlock(config, storedItems, null))
    const liveItems = parsedLiveItems.map(item => {
      const stored = storedItems.get(item.id)
      const viewedAt = stored?.viewedAt ?? null
      const dismissedAt = stored?.dismissedAt ?? null
      return {
        ...item,
        read: Boolean(viewedAt || dismissedAt),
        viewedAt,
        dismissedAt,
        tags: stored?.tags ?? [],
        keep: stored?.keep ?? false,
        important: stored?.important ?? false,
      }
    })

    // Persist new articles to vault (don't overwrite existing — preserves user edits).
    const newItems = liveItems.filter(item => !storedItems.has(item.id))
    if (newItems.length > 0) {
      await ensureRssArticleDirOrch(config.id)
      await Promise.all(newItems.map(item => writeRssItemFileOrch(config.id, feedTitle, item)))
    }

    // Backfill lead images onto articles persisted before `imageUrl` existed.
    // Only reaches articles the publisher still lists: the stored body was
    // stripped to plain text before it was written, so an older article's
    // <img> is gone for good and cannot be recovered from the cache. Patching
    // one field keeps any user edits to the rest of the frontmatter.
    // Fire-and-forget — this must never delay the first paint.
    const imageBackfill = liveItems.filter(item => {
      const stored = storedItems.get(item.id)
      return Boolean(stored && !stored.imageUrl && item.imageUrl)
    })
    if (imageBackfill.length > 0) {
      void Promise.all(imageBackfill.map(item =>
        patchRssItemFrontmatterOrch(item.id, { imageUrl: item.imageUrl }),
      ))
    }

    sortByPubDateDesc(liveItems)

    // Purge old articles in the background — doesn't block the UI.
    void purgeOldRssItemsOrch(config.id, getRssRetentionDaysOrch())

    // Restore the retained backlog opportunistically. The panel merges these
    // pages as they arrive, so a 1,000-item inbox remains intact without the
    // old eager all-file load on opening the reader.
    if (options?.onStoredPage) {
      void streamStoredFeedItemsOrch(config.id, (items) => {
        options.onStoredPage?.({ feedId: config.id, feedTitle, items, error: null })
      })
    }

    return { feedId: config.id, feedTitle, items: liveItems, error: null }
  } catch (err) {
    // Offline is the only time we pay the full cache read. It preserves the
    // previous offline reader without taxing the normal online timeline.
    const storedItems = await loadStoredFeedItemsOrch(config.id)
    if (storedItems.size > 0) {
      return buildStoredResultBlock(config, storedItems, err instanceof Error ? err.message : 'Fetch failed')
    }
    return {
      feedId: config.id,
      feedTitle: config.title,
      items: [],
      error: err instanceof Error ? err.message : 'Failed to fetch feed',
    }
  }
}

function buildStoredResultBlock(
  config: RssFeedConfigBlock,
  storedItems: Map<string, RssFeedItemBlock>,
  error: string | null,
): RssFeedResultBlock {
  const items = [...storedItems.values()]
  sortByPubDateDesc(items)
  return { feedId: config.id, feedTitle: config.title, items, error }
}

function sortByPubDateDesc(items: RssFeedItemBlock[]): void {
  items.sort((a, b) => {
    if (!a.pubDate && !b.pubDate) return 0
    if (!a.pubDate) return 1
    if (!b.pubDate) return -1
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  })
}

export async function fetchAllRssFeedsOrch(): Promise<RssFeedResultBlock[]> {
  const configs = await readRssFeedConfigsOrch()
  if (configs.length === 0) return []
  const results = await Promise.allSettled(configs.map(config => fetchAndParseRssFeedOrch(config)))
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { feedId: configs[i].id, feedTitle: configs[i].title, items: [], error: 'Fetch failed' },
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function domainLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return 'Feed' }
}

function extractAtomLinkBlock(links: unknown[]): string | undefined {
  for (const link of links) {
    if (typeof link === 'object' && link !== null) {
      const rec = link as Record<string, unknown>
      if (typeof rec.href === 'string') return rec.href
    }
  }
  return undefined
}

function extractDateBlock(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return null
}

/** Pull a date out of a feedsmith Dublin Core namespace object (`dc`/`dcterms`).
 *  Dublin Core fields are repeatable, so prefer the `dates` array and fall back
 *  to the deprecated single `date`. */
function extractDublinCoreDateBlock(dc: unknown): unknown {
  if (!dc || typeof dc !== 'object') return undefined
  const obj = dc as { date?: unknown; dates?: unknown }
  if (Array.isArray(obj.dates) && obj.dates.length > 0) return obj.dates[0]
  return obj.date
}

function stripHtmlBlock(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

async function raceTimeoutBlock<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: number | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = window.setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle)
    }
  }
}
