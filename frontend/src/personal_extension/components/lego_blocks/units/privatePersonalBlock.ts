import type { SecFilingBlock } from '@/personal_extension/services/lego_blocks/units/secFilingsBlock'
import type { F9SyncEngineBlock } from '@/personal_extension/services/orchestrators/f9SyncOrch'
import { lazy, type ComponentType } from 'react'
import type { WebullUniverseGroupBlock } from '@/personal_extension/services/lego_blocks/units/webullCompanyUniverseBlock'
import type { GapPositionLinkBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'
import type { TimedPriceBandBlock } from './F9PriceChartBlock'

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

// More private company-page panels, from the same folder: one module rendered
// in two spots (the main column, and inside the study panel). Without the
// folder the page has neither.
export interface PrivateCompanyPanelsPropsBlock {
  ticker: string
  executionRoot: string
  slot: 'main' | 'study' | 'closed-row' | 'price-range'
  /** slot 'price-range' only: the first day the chart shows; null for all. */
  windowFrom?: string | null
  /** slot 'closed-row' only: the closed position's file; the slot renders that row's two sale cells. */
  rowFilePath?: string | null
  /** Daily prices, oldest first. */
  prices: Array<{ date: string; price: number }>
  /** The price shown at the top of the page and its day. */
  livePrice: { price: number; date: string } | null
  /** The study record's frontmatter, as read; null without a study. */
  studyFrontmatter: Record<string, unknown> | null
  /** The study record's file; null without a study. */
  studyFilePath?: string | null
  onOpenFile: (path: string) => void
  /** Bands to draw on the page's price chart. */
  onChartBands?: (bands: TimedPriceBandBlock[]) => void
}
const COMPANY_PANELS_MODULES = import.meta.glob<{ default: ComponentType<PrivateCompanyPanelsPropsBlock> }>('../../../thinkingspace-personal/companyPanels.tsx')
const loadCompanyPanels = Object.values(COMPANY_PANELS_MODULES)[0]
export const PrivateCompanyPanelsBlock = loadCompanyPanels ? lazy(loadCompanyPanels) : null

// A position's detail panel, when the private folder provides one; without it,
// clicking a position opens the generic node panel as before.
export interface PrivatePositionPanelPropsBlock {
  /** The position's file (open or archived). */
  filePath: string
  ticker: string
  executionRoot: string
  onClose: () => void
  onOpenFile: (path: string) => void
  /** The account's name ("Traditional IRA") for an account id or number, when known. */
  accountLabel?: (accountId: string | null, accountNumber: string | null) => string | null
  /** Switch the panel to another position's file (a swap's other half). */
  onOpenPosition?: (path: string) => void
}
const POSITION_PANEL_MODULES = import.meta.glob<{ default: ComponentType<PrivatePositionPanelPropsBlock> }>('../../../thinkingspace-personal/positionPanel.tsx')
const loadPositionPanel = Object.values(POSITION_PANEL_MODULES)[0]
export const PrivatePositionPanelBlock = loadPositionPanel ? lazy(loadPositionPanel) : null

// A mark beside a position's name in the positions table (it has comments,
// they are shared), when the private folder provides one.
export interface PrivatePositionMarkPropsBlock {
  /** The position's file. */
  filePath: string
}
const POSITION_MARK_MODULES = import.meta.glob<{ default: ComponentType<PrivatePositionMarkPropsBlock> }>('../../../thinkingspace-personal/positionMark.tsx')
const loadPositionMark = Object.values(POSITION_MARK_MODULES)[0]
export const PrivatePositionMarkBlock = loadPositionMark ? lazy(loadPositionMark) : null

// Overall Positions → Buys and sells (every trade, linked to the gap behind it),
// when the private folder provides it; without it the page shows positions only.
export interface PrivateBuysSellsPropsBlock {
  executionRoot: string
  onOpenFile: (path: string) => void
}
const BUYS_SELLS_MODULES = import.meta.glob<{ default: ComponentType<PrivateBuysSellsPropsBlock> }>('../../../thinkingspace-personal/buysSells.tsx')
const loadBuysSells = Object.values(BUYS_SELLS_MODULES)[0]
export const PrivateBuysSellsBlock = loadBuysSells ? lazy(loadBuysSells) : null

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
  /** One company only (a company page's side panel): just its row, and only its files are read */
  only?: string | null
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

// Feed → Value Line: fetch every missing back issue, paced like a reader.
const VALUE_LINE_BACKFILL_MODULES = import.meta.glob<{ default: ComponentType }>('../../../thinkingspace-personal/valueLineBackfill.tsx')
const loadValueLineBackfill = Object.values(VALUE_LINE_BACKFILL_MODULES)[0]
export const PrivateValueLineBackfillBlock = loadValueLineBackfill ? lazy(loadValueLineBackfill) : null

// Feed → Overview: your companies' coming earnings reports, from the same
// private folder (its daily pass records them); without it there is no panel.
const EARNINGS_CALENDAR_MODULES = import.meta.glob<{ default: ComponentType<PrivateFeedDropsPropsBlock> }>('../../../thinkingspace-personal/earningsCalendar.tsx')
const loadEarningsCalendar = Object.values(EARNINGS_CALENDAR_MODULES)[0]
export const PrivateEarningsCalendarBlock = loadEarningsCalendar ? lazy(loadEarningsCalendar) : null

// Feed → Calendar: the same reports as a month, from the same private folder.
const EARNINGS_CALENDAR_VIEW_MODULES = import.meta.glob<{ default: ComponentType<PrivateFeedDropsPropsBlock> }>('../../../thinkingspace-personal/earningsCalendarView.tsx')
const loadEarningsCalendarView = Object.values(EARNINGS_CALENDAR_VIEW_MODULES)[0]
export const PrivateEarningsCalendarViewBlock = loadEarningsCalendarView ? lazy(loadEarningsCalendarView) : null

// F9 sync: the private folder's datasets and its roster of watched companies,
// added to the public engine by loadF9SyncEngineBlock; nothing without the folder.
type PrivateF9SyncModuleBlock = { registerPrivateF9SyncOrch(engine: F9SyncEngineBlock): void }
const SYNC_DATASET_MODULES = import.meta.glob<PrivateF9SyncModuleBlock>('../../../thinkingspace-personal/syncDatasets.ts')
const loadSyncDatasets = Object.values(SYNC_DATASET_MODULES)[0]
export async function registerPrivateF9SyncBlock(engine: F9SyncEngineBlock): Promise<void> {
  if (!loadSyncDatasets) return
  const module = await loadSyncDatasets().catch(() => null)
  module?.registerPrivateF9SyncOrch(engine)
}

// Reading an SEC filing in the app (fetched once into the company's folder); without the folder, sec.gov opens instead.
type PrivateSecFilingsModuleBlock = { readSecFilingOrch(companyFolder: string, ticker: string, filing: SecFilingBlock): Promise<string> }
const SEC_FILINGS_MODULES = import.meta.glob<PrivateSecFilingsModuleBlock>('../../../thinkingspace-personal/secFilings.ts')
const loadSecFilings = Object.values(SEC_FILINGS_MODULES)[0]
export async function readPrivateSecFilingBlock(companyFolder: string, ticker: string, filing: SecFilingBlock): Promise<string | null> {
  if (!loadSecFilings) return null
  return (await loadSecFilings()).readSecFilingOrch(companyFolder, ticker, filing)
}
