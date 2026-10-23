// Story cards: for a story several publishers carry, what they all report and
// where they differ (storyCardContractBlock). Kept in the vault
// (`.thinking-space/rss-stories.json`), so the phone shows what the desktop
// wrote. A card is derived: it names the articles and the prompt version it
// was made from, and is written again when another publisher joins the story
// (more voices make a better card) or the prompt changes. A week is kept.

import { runContract } from '@/services/orchestrators/intelligenceOrch'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import { plainArticleTextBlock } from '@/services/lego_blocks/units/intelligence/contracts/articleSummaryContractBlock'
import {
  STORY_CARD_MAX_SOURCES_BLOCK,
  STORY_CARD_SOURCE_CHARS_BLOCK,
  storyCardContract,
  type StoryCardOutputBlock,
} from '@/services/lego_blocks/units/intelligence/contracts/storyCardContractBlock'
import { rssStoryPublishersBlock, type RssStoryBlock } from '@/services/lego_blocks/units/rssStoryBlock'

const STORY_CARDS_PATH = '.thinking-space/rss-stories.json'
const KEEP_DAYS = 7

export interface RssStoryCardBlock {
  /** The articles it was made from (item ids) */
  members: string[]
  /** The publishers it was made from */
  publishers: string[]
  common: string
  differ: string | null
  model: string
  version: number
  /** ISO time it was written */
  at: string
}

let cards: RssStoryCardBlock[] = []
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function notifyBlock(): void {
  for (const listener of listeners) listener()
}

export function subscribeStoryCardsOrch(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The cards in memory (a new array whenever they change). */
export function readStoryCardsOrch(): RssStoryCardBlock[] {
  return cards
}

/** Read the vault's cards once per session. */
export function loadStoryCardsOrch(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const parsed = JSON.parse(await getVaultFS().read(STORY_CARDS_PATH)) as { cards?: RssStoryCardBlock[] }
        cards = Array.isArray(parsed.cards) ? parsed.cards.filter(c => Array.isArray(c?.members) && typeof c.common === 'string') : []
        notifyBlock()
      } catch { /* none yet */ }
    })()
  }
  return loading
}

async function saveStoryCardsBlock(): Promise<void> {
  const since = Date.now() - KEEP_DAYS * 86_400_000
  cards = cards.filter(c => Date.parse(c.at) >= since)
  await getVaultFS().write(STORY_CARDS_PATH, `${JSON.stringify({ version: 1, cards }, null, 1)}\n`)
}

const storyMemberIdsBlock = (story: RssStoryBlock) => [story.lead, ...story.others].map(m => m.item.id)

/** The card made for this story: the one sharing the most of its articles. */
export function storyCardForBlock(story: RssStoryBlock, list: RssStoryCardBlock[] = cards): RssStoryCardBlock | null {
  const ids = new Set(storyMemberIdsBlock(story))
  let best: RssStoryCardBlock | null = null
  let bestOverlap = 0
  for (const card of list) {
    const overlap = card.members.reduce((n, id) => n + (ids.has(id) ? 1 : 0), 0)
    if (overlap > bestOverlap) { best = card; bestOverlap = overlap }
  }
  return best
}

/** No card yet, an older prompt, or a publisher the card has not heard from. */
export function storyNeedsCardBlock(story: RssStoryBlock, list: RssStoryCardBlock[] = cards): boolean {
  const publishers = rssStoryPublishersBlock(story).map(p => p.publisher)
  if (publishers.length < 2) return false
  const card = storyCardForBlock(story, list)
  if (!card || card.version < storyCardContract.promptVersion) return true
  const known = new Set(card.publishers)
  return publishers.some(p => !known.has(p))
}

/** Stories whose card failed this session; not asked for again until the app restarts. */
const failedThisSession = new Set<string>()

export interface StoryCardPassBlock {
  made: number
  failed: number
  error: string | null
  /** The provider itself failed: stop asking */
  providerDown: boolean
}

/**
 * Write cards for these stories (already ordered, most publishers first),
 * at most `limit` of them. `onProgress` gets (done, total) as it goes.
 */
export async function runStoryCardPassOrch(
  stories: RssStoryBlock[],
  provider: ProviderId,
  onProgress: (done: number, total: number) => void,
  limit = 12,
): Promise<StoryCardPassBlock> {
  await loadStoryCardsOrch()
  const pass: StoryCardPassBlock = { made: 0, failed: 0, error: null, providerDown: false }
  const work = stories.filter(story => storyNeedsCardBlock(story) && !failedThisSession.has(story.lead.item.id)).slice(0, limit)
  onProgress(0, work.length)
  for (const story of work) {
    const publishers = rssStoryPublishersBlock(story).slice(0, STORY_CARD_MAX_SOURCES_BLOCK)
    const result = await runContract(storyCardContract, {
      storyId: storyMemberIdsBlock(story).sort().join(','),
      sources: publishers.map(({ name, member }) => ({
        publisher: name,
        title: member.item.title,
        text: (member.item.aiSummary?.text.replace(/\n/g, ' ') ?? plainArticleTextBlock(member.item.description ?? '')).slice(0, STORY_CARD_SOURCE_CHARS_BLOCK),
      })),
    }, { provider })
    if (result.ok && result.value) {
      // runContract types the value from the schema (a string); finalize made it this
      const value = result.value as unknown as StoryCardOutputBlock
      const card: RssStoryCardBlock = {
        members: storyMemberIdsBlock(story),
        publishers: rssStoryPublishersBlock(story).map(p => p.publisher),
        common: value.common,
        differ: value.differ,
        model: result.model,
        version: storyCardContract.promptVersion,
        at: new Date().toISOString(),
      }
      const previous = storyCardForBlock(story)
      cards = [...cards.filter(c => c !== previous), card]
      await saveStoryCardsBlock()
      notifyBlock()
      pass.made += 1
    } else {
      pass.failed += 1
      failedThisSession.add(story.lead.item.id)
      pass.error = result.ok ? 'The model gave no usable story card.' : result.error.message
      if (!result.ok && /not configured|no model|unavailable|ECONNREFUSED|fetch failed/i.test(result.error.message)) {
        pass.providerDown = true
        break
      }
    }
    onProgress(pass.made + pass.failed, work.length)
  }
  return pass
}
