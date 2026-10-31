import { lazy, type ComponentType } from 'react'
import type { WebullUniverseGroupBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyUniverseBlock'
import type { GapPositionLinkBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'

// The Gaps tab lives in a private folder (personal_extension/thinkingspace-personal) that is not
// part of the public repo. When the folder is present the tab is shown; when it
// is missing, this glob matches nothing and the tab is simply left out.
const GAPS_MODULES = import.meta.glob<{ default: ComponentType }>('../../../thinkingspace-personal/index.ts')
const loadGaps = Object.values(GAPS_MODULES)[0]

export const GAPS_TAB_AVAILABLE = Boolean(loadGaps)
export const PrivateGapsBlock = loadGaps ? lazy(loadGaps) : null

// The company page's gaps section lives in the same private folder; without it
// the page simply has no gaps section.
const COMPANY_GAPS_MODULES = import.meta.glob<{ default: ComponentType<PrivateCompanyGapsPropsBlock> }>('../../../thinkingspace-personal/companyGaps.tsx')
const loadCompanyGaps = Object.values(COMPANY_GAPS_MODULES)[0]

export interface PrivateCompanyGapsPropsBlock {
  ticker: string
  executionRoot: string
  onOpenFile: (path: string) => void
}

export const PrivateCompanyGapsBlock = loadCompanyGaps ? lazy(loadCompanyGaps) : null

// Noticed (things seen happening, before they are gaps) lives in the same
// private folder: its own F9 view, and a section on the company page.
const NOTICED_MODULES = import.meta.glob<{ default: ComponentType }>('../../../thinkingspace-personal/noticed.tsx')
const loadNoticed = Object.values(NOTICED_MODULES)[0]
export const NOTICED_TAB_AVAILABLE = Boolean(loadNoticed)
export const PrivateNoticedBlock = loadNoticed ? lazy(loadNoticed) : null

const COMPANY_NOTICED_MODULES = import.meta.glob<{ default: ComponentType<PrivateCompanyGapsPropsBlock> }>('../../../thinkingspace-personal/companyNoticed.tsx')
const loadCompanyNoticed = Object.values(COMPANY_NOTICED_MODULES)[0]
export const PrivateCompanyNoticedBlock = loadCompanyNoticed ? lazy(loadCompanyNoticed) : null

// Sim (replays: the loop at a moment in history) lives in the same private
// folder, all of it; without it there is no Sim tab.
const SIM_MODULES = import.meta.glob<{ default: ComponentType }>('../../../thinkingspace-personal/sim.tsx')
const loadSim = Object.values(SIM_MODULES)[0]
export const PrivateSimBlock = loadSim ? lazy(loadSim) : null

export const SIM_TAB_AVAILABLE = Boolean(loadSim)

// Study (every company studied: its table and timeline) is private too. The
// study records it reads stay public, for the sidebar and the company page.
const STUDY_MODULES = import.meta.glob<{ default: ComponentType }>('../../../thinkingspace-personal/study.tsx')
const loadStudy = Object.values(STUDY_MODULES)[0]
export const STUDY_TAB_AVAILABLE = Boolean(loadStudy)
export const PrivateStudyBlock = loadStudy ? lazy(loadStudy) : null

// The Feed's Drops view and its daily market pass live in the same private
// folder; without them the Feed has no Drops view and the pass does not run.
export interface PrivateFeedDropsPropsBlock {
  /** Ticker → the sidebar's group (held / watchlist / researched), so Drops can put yours first */
  groups: Record<string, WebullUniverseGroupBlock>
  /** A past day the Feed is showing (YYYY-MM-DD), or null for today */
  day?: string | null
}
const FEED_DROPS_MODULES = import.meta.glob<{ default: ComponentType<PrivateFeedDropsPropsBlock> }>('../../../thinkingspace-personal/feedDrops.tsx')
const loadFeedDrops = Object.values(FEED_DROPS_MODULES)[0]
export const FEED_DROPS_AVAILABLE = Boolean(loadFeedDrops)
export const PrivateFeedDropsBlock = loadFeedDrops ? lazy(loadFeedDrops) : null

// Which gap holds which position, read from the gaps' positions logs; without
// the private folder there are no gaps, so every position shows none.
const GAP_LINKS_MODULES = import.meta.glob<{ loadPrivateGapPositionLinks: (executionRoot: string) => Promise<GapPositionLinkBlock[]> }>('../../../thinkingspace-personal/gapLinks.ts')
const loadGapLinks = Object.values(GAP_LINKS_MODULES)[0]

export async function loadPrivateGapPositionLinksBlock(executionRoot: string): Promise<GapPositionLinkBlock[]> {
  if (!loadGapLinks) return []
  return loadGapLinks().then(m => m.loadPrivateGapPositionLinks(executionRoot)).catch(() => [])
}

const MARKET_PASS_MODULES = import.meta.glob<{ runPrivateMarketPassIfDue: () => Promise<void> }>('../../../thinkingspace-personal/marketPass.ts')
const loadMarketPass = Object.values(MARKET_PASS_MODULES)[0]

/** Runs the private market pass if it is present and due; a no-op otherwise. */
export function runPrivateMarketPassIfDueBlock(): void {
  if (!loadMarketPass) return
  void loadMarketPass().then(m => m.runPrivateMarketPassIfDue()).catch(() => undefined)
}
