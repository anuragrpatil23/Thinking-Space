import { useEffect, useSyncExternalStore } from 'react'
import {
  fetchAndParseRssFeedOrch,
  markRssItemViewedOrch,
  markRssItemsReadOrch,
  readRssFeedPreferencesOrch,
  removeRssItemsOrch,
  unmarkRssItemReadOrch,
  updateRssItemMetaOrch,
} from '@/services/orchestrators/rssFeedOrch'
import {
  dropRssFeedItemsBlock,
  patchRssFeedItemsBlock,
  unionRssFeedItemsBlock,
  type RssFeedConfigBlock,
  type RssFeedItemBlock,
  type RssFeedPreferencesBlock,
  type RssFeedResultBlock,
} from '@/services/lego_blocks/units/rssFeedBlock'
import {
  hasTagBlock,
  normalizeTagBlock,
  normalizeTagListBlock,
} from '@/services/lego_blocks/units/tagBlock'

/**
 * One feed store for every RSS surface.
 *
 * The reader mounts more than one panel (the inline explorer and the mobile
 * drawer), and each used to own a private copy of this state: two independent
 * fetches of every feed, two divergent read-state ledgers, and a full reload
 * every time a panel remounted. Article read/keep state also lived in the
 * panel, so the timeline and the compact list could disagree about the same
 * article.
 *
 * The store lives at module scope rather than in a context so it survives
 * unmounting — reopening the reader paints cached articles immediately instead
 * of showing a spinner and refetching.
 */

interface RssFeedsStateBlock {
  feeds: RssFeedResultBlock[]
  preferences: RssFeedPreferencesBlock | null
  loading: boolean
  refreshing: boolean
  /** Feeds whose network fetch is still outstanding — drives the per-feed spinner. */
  loadingFeedIds: Set<string>
  /** Articles read since the last explicit refresh. Keeps them pinned in the
   *  unread inbox so the list can't reshuffle mid-read. */
  sessionReadIds: Set<string>
  /** Whether any feed has ever been configured; distinguishes "empty" from "not loaded". */
  hasFeedsConfigured: boolean
}

/** A cached store older than this refetches in the background on remount. Not a
 *  timer — nothing polls; this is only consulted when a surface mounts. */
const STALE_AFTER_MS = 5 * 60 * 1000

/** How many feeds fetch concurrently. Network, XML parsing and native
 *  filesystem hydration all settle on the renderer, so an unbounded fan-out
 *  starves the first cards of frames. */
const FETCH_CONCURRENCY = 3

const EMPTY_STATE: RssFeedsStateBlock = {
  feeds: [],
  preferences: null,
  loading: true,
  refreshing: false,
  loadingFeedIds: new Set(),
  sessionReadIds: new Set(),
  hasFeedsConfigured: false,
}

let state: RssFeedsStateBlock = EMPTY_STATE
const listeners = new Set<() => void>()
let loadRequestId = 0
let lastLoadedAt = 0
let loadedOnce = false

function getStateBlock(): RssFeedsStateBlock {
  return state
}

function setStateBlock(patch: Partial<RssFeedsStateBlock>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

/** Re-key the store onto the configured feed list, keeping whatever each feed
 *  already holds. Feeds are never blanked: emptying them made the list collapse
 *  and regrow as workers reported in, which reads as instability and clamps
 *  every scroller back to the top. */
function alignFeedsToConfigBlock(
  feedConfigs: RssFeedConfigBlock[],
  override?: RssFeedResultBlock,
): RssFeedResultBlock[] {
  const byFeedId = new Map(state.feeds.map(feed => [feed.feedId, feed]))
  if (override) byFeedId.set(override.feedId, override)
  return feedConfigs.map(config => byFeedId.get(config.id) ?? {
    feedId: config.id,
    feedTitle: config.title,
    items: [],
    error: null,
  })
}

/** A freshly fetched result supersedes what is on screen, per article. */
function mergeFeedResultBlock(feedConfigs: RssFeedConfigBlock[], next: RssFeedResultBlock): void {
  const current = state.feeds.find(feed => feed.feedId === next.feedId)
  setStateBlock({
    feeds: alignFeedsToConfigBlock(feedConfigs, {
      ...next,
      items: unionRssFeedItemsBlock(current?.items ?? [], next.items, true),
    }),
  })
}

/** A page of retained cache must not clobber the live copy or an optimistic
 *  update the reader just made. */
function mergeStoredPageBlock(feedConfigs: RssFeedConfigBlock[], page: RssFeedResultBlock): void {
  const current = state.feeds.find(feed => feed.feedId === page.feedId)
  const items = unionRssFeedItemsBlock(current?.items ?? [], page.items, false)
  // Nothing new in this page — don't churn the store and re-render every row.
  if (current && items.length === current.items.length) return
  setStateBlock({
    feeds: alignFeedsToConfigBlock(feedConfigs, {
      feedId: page.feedId,
      feedTitle: current?.feedTitle ?? page.feedTitle,
      items,
      error: current?.error ?? null,
    }),
  })
}

/** Apply an optimistic patch to specific articles. */
function patchItemsBlock(itemIds: Iterable<string>, patch: Partial<RssFeedItemBlock>): void {
  const feeds = patchRssFeedItemsBlock(state.feeds, itemIds, patch)
  if (feeds !== state.feeds) setStateBlock({ feeds })
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * `clearReadSession` defaults to following `isRefresh`, but a background
 * refresh (returning to the app) must not clear it — that evicts everything the
 * reader just read out of the unread inbox and reshuffles the list under them.
 * Only an explicit refresh is that moment.
 */
export async function loadRssFeedsBlock(isRefresh = false, clearReadSession = isRefresh): Promise<void> {
  const requestId = ++loadRequestId
  setStateBlock(isRefresh ? { refreshing: true } : { loading: !loadedOnce })
  try {
    const prefs = await readRssFeedPreferencesOrch()
    if (requestId !== loadRequestId) return

    const feedConfigs = prefs.feeds
    setStateBlock({
      preferences: prefs,
      hasFeedsConfigured: feedConfigs.length > 0,
      loading: false,
      loadingFeedIds: new Set(feedConfigs.map(config => config.id)),
      ...(clearReadSession ? { sessionReadIds: new Set<string>() } : {}),
    })
    setStateBlock({ feeds: alignFeedsToConfigBlock(feedConfigs) })

    let nextConfigIndex = 0
    const loadOne = async (): Promise<void> => {
      const config = feedConfigs[nextConfigIndex++]
      if (!config) return
      try {
        const result = await fetchAndParseRssFeedOrch(config, {
          onStoredResult: (storedResult) => {
            if (requestId !== loadRequestId) return
            mergeFeedResultBlock(feedConfigs, storedResult)
          },
          onStoredPage: (storedPage) => {
            if (requestId !== loadRequestId) return
            mergeStoredPageBlock(feedConfigs, storedPage)
          },
        })
        if (requestId !== loadRequestId) return
        mergeFeedResultBlock(feedConfigs, result)
      } finally {
        if (requestId === loadRequestId && state.loadingFeedIds.has(config.id)) {
          const loadingFeedIds = new Set(state.loadingFeedIds)
          loadingFeedIds.delete(config.id)
          setStateBlock({ loadingFeedIds })
        }
      }
      // Yield a frame between feeds so scrolling stays responsive during load.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      await loadOne()
    }
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, feedConfigs.length) }, loadOne),
    )
  } finally {
    if (requestId === loadRequestId) {
      loadedOnce = true
      lastLoadedAt = Date.now()
      setStateBlock({ loading: false, refreshing: false })
    }
  }
}

/** Called when a surface mounts. Loads once, then only refreshes a stale cache
 *  in the background — a remount never costs the reader a spinner. */
function ensureLoadedBlock(): void {
  if (!loadedOnce) {
    void loadRssFeedsBlock()
    return
  }
  if (Date.now() - lastLoadedAt > STALE_AFTER_MS) void loadRssFeedsBlock(true, false)
}

function onVisibilityChangeBlock(): void {
  // There is deliberately no polling (the reader is commonly open for a long
  // time on battery). Returning to the app is the natural moment to pull
  // vault-backed viewed/dismissed state written on another device.
  if (document.visibilityState === 'visible') void loadRssFeedsBlock(true, false)
}

function subscribeBlock(listener: () => void): () => void {
  listeners.add(listener)
  // One listener for every surface, registered with the first subscriber.
  if (listeners.size === 1) document.addEventListener('visibilitychange', onVisibilityChangeBlock)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) document.removeEventListener('visibilitychange', onVisibilityChangeBlock)
  }
}

// ---------------------------------------------------------------------------
// Mutations — vault write plus optimistic update, in one place
// ---------------------------------------------------------------------------

/** Automatic, meaningful on-screen exposure — a glance, not a decision. */
export function markRssItemViewedBlock(item: RssFeedItemBlock): void {
  if (item.viewedAt || item.dismissedAt) return
  patchItemsBlock([item.id], { viewedAt: new Date().toISOString(), read: true })
  void markRssItemViewedOrch(item.id)
}

/** Explicit, intentional dismissal. */
export function markRssItemsReadBlock(items: RssFeedItemBlock[]): void {
  const pending = items.filter(item => !item.dismissedAt)
  if (pending.length === 0) return
  const ids = pending.map(item => item.id)
  patchItemsBlock(ids, { dismissedAt: new Date().toISOString(), read: true })
  void markRssItemsReadOrch(ids)
}

export function markAllRssItemsReadBlock(feedId?: string): void {
  const items = state.feeds
    .filter(feed => !feedId || feed.feedId === feedId)
    .flatMap(feed => feed.items.filter(item => !item.read))
  markRssItemsReadBlock(items)
}

/** Undo a read mark — whether the reader made it or scrolling did. */
export function unmarkRssItemReadBlock(item: RssFeedItemBlock): void {
  if (!item.read && !item.viewedAt && !item.dismissedAt) return
  patchItemsBlock([item.id], { viewedAt: null, dismissedAt: null, read: false })
  void unmarkRssItemReadOrch(item.id)
}

/** Add or remove one tag. Lives here rather than in a surface so every reader
 *  — article view, reels — writes tags through the same path. */
export function toggleRssItemTagBlock(item: RssFeedItemBlock, tag: string): void {
  const current = item.tags ?? []
  const tags = hasTagBlock(current, tag)
    ? current.filter(existing => normalizeTagBlock(existing).toLowerCase() !== normalizeTagBlock(tag).toLowerCase())
    : normalizeTagListBlock([...current, tag])
  patchItemsBlock([item.id], { tags })
  void updateRssItemMetaOrch(item.id, { tags })
}

export function toggleRssItemSavedBlock(item: RssFeedItemBlock): void {
  const keep = !item.keep
  patchItemsBlock([item.id], { keep })
  void updateRssItemMetaOrch(item.id, { keep })
}

/** Replaces an article wholesale — the reader owns tags/keep/important while
 *  it is open and reports the settled article back. */
export function replaceRssItemBlock(updated: RssFeedItemBlock): void {
  let changed = false
  const feeds = state.feeds.map(feed => {
    if (!feed.items.some(item => item.id === updated.id)) return feed
    changed = true
    return { ...feed, items: feed.items.map(item => (item.id === updated.id ? updated : item)) }
  })
  // Pin anything that just became read into the unread inbox for the rest of
  // this session, so the list doesn't reshuffle under the reader.
  const sessionReadIds = updated.read && !state.sessionReadIds.has(updated.id)
    ? new Set(state.sessionReadIds).add(updated.id)
    : state.sessionReadIds
  if (changed || sessionReadIds !== state.sessionReadIds) setStateBlock({ feeds, sessionReadIds })
}

export function removeRssItemsBlock(itemIds: string[]): void {
  if (itemIds.length === 0) return
  setStateBlock({ feeds: dropRssFeedItemsBlock(state.feeds, itemIds) })
  void removeRssItemsOrch(itemIds)
}

/** Drops an article from the store without deleting it — used when the reader
 *  moves one into the vault, where it now lives as a normal note. */
export function forgetRssItemBlock(itemId: string): void {
  setStateBlock({ feeds: dropRssFeedItemsBlock(state.feeds, [itemId]) })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRssFeedsBlockResult extends RssFeedsStateBlock {
  /** Explicit user refresh — this is the moment read articles leave the inbox. */
  refresh: () => void
}

export function useRssFeedsBlock(): UseRssFeedsBlockResult {
  const snapshot = useSyncExternalStore(subscribeBlock, getStateBlock, getStateBlock)
  useEffect(() => { ensureLoadedBlock() }, [])
  return { ...snapshot, refresh: refreshRssFeedsBlock }
}

function refreshRssFeedsBlock(): void {
  void loadRssFeedsBlock(true)
}
