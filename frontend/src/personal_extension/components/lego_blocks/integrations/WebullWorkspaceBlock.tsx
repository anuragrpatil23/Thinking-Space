import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Building2, Clock, Eye, EyeOff, Layers, Wallet, type LucideIcon } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import {
  dispatchWebullSidebarChromeStateBlock,
  Webull_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK,
} from '@/personal_extension/services/lego_blocks/units/webullSidebarChromeBlock'
import BacklogListBlock from '@/components/lego_blocks/integrations/BacklogListBlock'
import FileSelectionViewerBlock from '@/components/lego_blocks/integrations/FileSelectionViewerBlock'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentBlock'
import NodeDetailPanelBlock from '@/components/lego_blocks/integrations/NodeDetailPanelBlock'
import PdfDocumentBlock from '@/components/lego_blocks/integrations/PdfDocumentBlock'
import WebullStudyBlock from './WebullStudyBlock'
import { scanWebullStudyVaultBlock } from '@/personal_extension/services/lego_blocks/integrations/webullStudyVaultBlock'
import TickerLogoBlock from '@/personal_extension/components/lego_blocks/units/TickerLogoBlock'
import WebullF9CanvasOrch from '@/personal_extension/components/orchestrators/WebullF9CanvasOrch'
import ScrollableZoomSurfaceBlock from '@/components/lego_blocks/integrations/ScrollableZoomSurfaceBlock'
import { TagDisclosureButtonBlock, TagListEditorBlock } from '@/components/lego_blocks/integrations/TagManagerBlock'
import type { BacklogRowColumnBlock } from '@/components/lego_blocks/units/BacklogRowColumnsBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { cn } from '@/lib/utils'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useIosSidebarSwipeBlock } from '@/components/lego_blocks/hooks/shared/useIosSidebarSwipeBlock'
import { useNativeBackHandlerBlock } from '@/components/lego_blocks/hooks/shared/useNativeBackHandlerBlock'
import { isCapacitorNative } from '@/services/lego_blocks/integrations/fsBlock'
import {
  pushNativeWithForwardBlock,
  setNativeNavigationStackBlock,
} from '@/services/lego_blocks/units/topChromeNativeBridgeBlock'
import { getAllNodes, type NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/orchestrators/storageOrch'
import {
  normalizeOrganizerUiStateBlock,
  type OrganizerProgramGroupEntryBlock,
} from '@/services/lego_blocks/integrations/organizerUiStateBlock'
import { normalizeTagBlock, normalizeTagListBlock, splitTagInputBlock, tagsEqualBlock } from '@/services/lego_blocks/units/tagBlock'
import { NODE_STATUSES, type NodePriority, type NodeStatus, type YAMLCommentEntry, type YAMLFrontmatter } from '@/services/lego_blocks/units/yamlNoteBlock'
import { listMarkdownEntries, listPdfFiles } from '@/services/orchestrators/fileSystemOrch'
import type {
  WebullAccountSnapshotOrch,
  WebullRuntimeSurfaceOrch,
  WebullSelectedAccountOrch,
} from '@/personal_extension/services/orchestrators/webullOverallOrch'
import type {
  WebullCompanyOverviewBlock,
  WebullExecutionOverviewBlock,
  WebullPositionDetailBlock,
  WebullPositionSummaryBlock,
} from '@/personal_extension/services/orchestrators/webullExecutionOrch'

type WebullSubtabIdBlock = 'overall' | 'study'

interface WebullSubtabBlock {
  id: WebullSubtabIdBlock
  label: string
}

const WEBULL_SUBTAB_ICONS: Record<WebullSubtabIdBlock, LucideIcon> = {
  overall: Wallet,
  study: BookOpen,
}

interface WebullLinkOptionBlock {
  path: string
  label: string
  summary?: string
}

interface WebullPdfOptionBlock {
  path: string
  label: string
}

interface WebullWorkspaceBlockProps {
  pageTitle?: string
  subtabs: WebullSubtabBlock[]
  activeSubtabId: WebullSubtabIdBlock
  onSelectSubtab: (id: WebullSubtabIdBlock) => void
  hasConfig: boolean
  liveRefreshAvailable: boolean
  error: string | null
  runtime: WebullRuntimeSurfaceOrch | null
  lastRefreshRuntime: WebullRuntimeSurfaceOrch | null
  fetchedAt: string | null
  endpoints: {
    accountList: string | null
    accountBalanceLegacy: string | null
    accountPositionsLegacy: string | null
    assetsAccount: string | null
    assetsPositions: string | null
    marketQuotes: string | null
  }
  selectedAccount: WebullSelectedAccountOrch | null
  accounts: WebullAccountSnapshotOrch[]
  accountList: unknown
  accountBalanceLegacy: unknown | null
  accountPositionsLegacy: unknown | null
  assetsAccount: unknown | null
  assetsPositions: unknown | null
  marketQuotes: unknown | null
  warnings: string[]
  attempts: string[]
  executionRoot: string | null
  executionCompanyCount: number
  executionPositionCount: number
  executionSyncSource: 'assets_positions' | 'legacy_positions' | 'none'
  executionSyncWarnings: string[]
  executionSyncError: string | null
  executionOverview: WebullExecutionOverviewBlock | null
  activeCompanyTicker: string | null
  onSelectCompanyTicker: (companyTicker: string | null) => void
  activePositionFileName: string | null
  onSelectPositionFileName: (fileName: string) => void
  activePositionDetail: WebullPositionDetailBlock | null
  positionDetailLoading: boolean
  positionDetailError: string | null
  loading: boolean
  workspaceBusy: boolean
  workspaceMessage: string | null
  onCreateCompany: (companyTicker: string) => Promise<void>
  onCreateManualPosition: (input: {
    title?: string
    status?: NodeStatus
    instrumentType?: 'STOCK' | 'OPTION'
    optionType?: 'CALL' | 'PUT' | null
    optionExpireDate?: string | null
    optionExercisePrice?: string | null
    linkedIdeaId?: string | null
    notes?: string
  }) => Promise<void>
  onUpdatePositionOverlay: (input: {
    fileName?: string
    status?: NodeStatus
    linkedIdeaId?: string | null
    title?: string | null
    priority?: NodePriority | null
    description?: string | null
    comments?: YAMLCommentEntry[]
    relatedNodes?: string[]
    tags?: string[]
    projectPresetTags?: string[]
  }) => Promise<void>
  onUpdateCompanyOverlay: (input: {
    companyTicker?: string | null
    strategyNotes?: string | null
    relatedIdeaIds?: string[]
    programGroupId?: string | null
    valuationNotePath?: string | null
    companyPdfReportPath?: string | null
  }) => Promise<void>
  onSavePositionBody: (body: string) => Promise<void>
  onOpenNodeFile: (filePath: string) => void
}

const CASH_EQUIVALENT_SYMBOLS = new Set<string>(['JPST'])

const COMPANY_PIE_PALETTE = [
  '#10b981', '#0ea5e9', '#a855f7', '#f59e0b', '#ef4444', '#14b8a6',
  '#6366f1', '#ec4899', '#84cc16', '#f97316', '#06b6d4', '#8b5cf6',
]

// Parallel to COMPANY_PIE_PALETTE, expressed as Tailwind border classes so the
// position-table left stripe matches the donut wedge for the same business.
const COMPANY_PIE_BORDER_PALETTE = [
  'border-l-emerald-500', 'border-l-sky-500', 'border-l-purple-500',
  'border-l-amber-500', 'border-l-red-500', 'border-l-teal-500',
  'border-l-indigo-500', 'border-l-pink-500', 'border-l-lime-500',
  'border-l-orange-500', 'border-l-cyan-500', 'border-l-violet-500',
]

interface CompanyPieSliceBlock {
  key: string
  ticker: string
  kind: 'STOCK' | 'OPTION' | 'CASH' | 'OTHER'
  value: number
  color: string
  fillOpacity: number
  isFirstForTicker: boolean
}

function buildCompanyPieDataBlock(companies: WebullCompanyOverviewBlock[]): {
  slices: CompanyPieSliceBlock[]
  total: number
} {
  const tickerTotals: Array<{ ticker: string; stock: number; option: number; total: number }> = []
  for (const company of companies) {
    const ticker = company.companyTicker.toUpperCase()
    const activePositions = company.positions.filter(p => normalizePositionStatusBlock(p.status) !== 'archived')
    const metrics = computeCompanySummaryMetricsBlock(activePositions)
    const stock = Math.max(0, metrics.stockCost ?? 0)
    const option = Math.max(0, metrics.optionCost ?? 0)
    const total = stock + option
    if (total <= 0) continue
    tickerTotals.push({ ticker, stock, option, total })
  }
  tickerTotals.sort((a, b) => b.total - a.total)

  const slices: CompanyPieSliceBlock[] = []
  let total = 0
  tickerTotals.forEach((entry, index) => {
    const color = COMPANY_PIE_PALETTE[index % COMPANY_PIE_PALETTE.length]
    let first = true
    const push = (kind: CompanyPieSliceBlock['kind'], value: number, opacity: number) => {
      slices.push({
        key: `${entry.ticker}-${kind.toLowerCase()}`,
        ticker: entry.ticker,
        kind,
        value,
        color,
        fillOpacity: opacity,
        isFirstForTicker: first,
      })
      first = false
    }
    if (entry.stock > 0) push('STOCK', entry.stock, 1)
    if (entry.option > 0) push('OPTION', entry.option, 0.45)
    total += entry.total
  })

  return { slices, total }
}

const Webull_SIDE_TABS_COLLAPSED_STORAGE_KEY_BLOCK = 'webull_workspace_side_tabs_collapsed'
const Webull_COMPANY_ORDER_STORAGE_KEY_BLOCK = 'webull_workspace_company_order_v1'
const Webull_ARCHIVED_DEFAULT_STORAGE_KEY_BLOCK = 'webull_workspace_show_archived_default_v1'
const Webull_ARCHIVED_OVERRIDES_STORAGE_KEY_BLOCK = 'webull_workspace_archived_overrides_v1'

function readPersistedShowArchivedDefaultBlock(): boolean {
  if (typeof window === 'undefined') return false
  const raw = window.localStorage.getItem(Webull_ARCHIVED_DEFAULT_STORAGE_KEY_BLOCK)
  if (raw === null) return false
  return raw === '1'
}

function writePersistedShowArchivedDefaultBlock(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(Webull_ARCHIVED_DEFAULT_STORAGE_KEY_BLOCK, value ? '1' : '0')
  } catch {
    // ignore
  }
}

function readPersistedArchivedOverridesBlock(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(Webull_ARCHIVED_OVERRIDES_STORAGE_KEY_BLOCK)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [ticker, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[ticker.toUpperCase()] = value
    }
    return out
  } catch {
    return {}
  }
}

function writePersistedArchivedOverridesBlock(overrides: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(Webull_ARCHIVED_OVERRIDES_STORAGE_KEY_BLOCK, JSON.stringify(overrides))
  } catch {
    // ignore
  }
}

function readPersistedCompanyOrderBlock(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(Webull_COMPANY_ORDER_STORAGE_KEY_BLOCK)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  } catch {
    return []
  }
}

function writePersistedCompanyOrderBlock(order: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(Webull_COMPANY_ORDER_STORAGE_KEY_BLOCK, JSON.stringify(order))
  } catch {
    // ignore quota / disabled storage errors
  }
}
const Webull_WIDE_TABLE_MIN_WIDTH_CLASS_BLOCK = 'min-w-[1360px]'
type WebullProjectPresetTagsByRootBlock = Record<string, string[]>
type WebullProjectProgramGroupsByRootBlock = Record<string, OrganizerProgramGroupEntryBlock[]>

function makeProgramGroupIdBlock(): string {
  return `program-group-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeProgramGroupsBlock(groups: OrganizerProgramGroupEntryBlock[]): OrganizerProgramGroupEntryBlock[] {
  return normalizeOrganizerUiStateBlock({ programGroups: groups }).programGroups
}

function readProgramGroupFromNodeBlock(node: NodeRecord): string | null {
  const metadata = asMetadataRecordBlock(node)
  const value = firstStringBlock(metadata.program_group)
  return value ? value.trim() : null
}

function mergeProgramGroupsWithAssignmentsBlock(
  groups: OrganizerProgramGroupEntryBlock[],
  programs: NodeRecord[],
  assignedGroupByProgram: Record<string, string>,
): OrganizerProgramGroupEntryBlock[] {
  const normalizedGroups = normalizeProgramGroupsBlock(groups)
  const groupOrder = normalizedGroups.map(group => group.id)
  const groupMeta = new Map<string, Pick<OrganizerProgramGroupEntryBlock, 'name' | 'collapsed'>>(
    normalizedGroups.map(group => [group.id, { name: group.name, collapsed: !!group.collapsed }]),
  )
  const programIdsByGroup = new Map<string, string[]>(
    normalizedGroups.map(group => [group.id, []]),
  )

  for (const groupIdRaw of Object.values(assignedGroupByProgram)) {
    const groupId = groupIdRaw.trim()
    if (!groupId) continue
    if (!groupMeta.has(groupId)) {
      groupMeta.set(groupId, { name: groupId, collapsed: false })
      groupOrder.push(groupId)
      programIdsByGroup.set(groupId, [])
    }
  }

  for (const program of programs) {
    const groupId = assignedGroupByProgram[program.uuid]?.trim()
    if (!groupId) continue
    const bucket = programIdsByGroup.get(groupId)
    if (!bucket) continue
    bucket.push(program.uuid)
  }

  return groupOrder.map((groupId) => {
    const meta = groupMeta.get(groupId) ?? { name: groupId, collapsed: false }
    return {
      id: groupId,
      name: meta.name,
      collapsed: !!meta.collapsed,
      programIds: programIdsByGroup.get(groupId) ?? [],
    }
  })
}

function formatRuntimeLabelBlock(value: WebullRuntimeSurfaceOrch | null): string {
  if (value === 'electron') return 'Electron'
  if (value === 'capacitor') return 'Capacitor'
  if (value === 'web') return 'Web'
  return 'Unknown'
}

const SYNTHETIC_NODE_TIMESTAMP_BLOCK = '1970-01-01T00:00:00.000Z'

function asRecordArrayBlock(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  }
  if (value && typeof value === 'object') {
    const candidateLists = ['holdings', 'positions', 'items', 'rows', 'data', 'list', 'quotes', 'result']
    for (const key of candidateLists) {
      const nested = (value as Record<string, unknown>)[key]
      if (Array.isArray(nested)) {
        return nested.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      }
    }
  }
  return []
}

function firstStringBlock(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized) return normalized
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function firstNumberBlock(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function firstNumberFromRecordBlock(record: Record<string, unknown>, ...keys: string[]): number | null {
  return firstNumberBlock(...keys.map((key) => record[key]))
}

function sumRecordNumberFieldsBlock(records: Array<Record<string, unknown>>, ...keys: string[]): number | null {
  let total = 0
  let hasValue = false
  for (const record of records) {
    const value = firstNumberFromRecordBlock(record, ...keys)
    if (value === null) continue
    total += value
    hasValue = true
  }
  return hasValue ? total : null
}

function formatCurrencyBlock(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function formatCurrencyFromUnknownBlock(value: unknown): string {
  return formatCurrencyBlock(firstNumberBlock(value))
}

function formatCurrencyKBlock(value: number | null): string {
  if (value === null) return '—'
  const sign = value < 0 ? '-' : ''
  const inK = Math.abs(value) / 1000
  return `${sign}$${inK.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}K`
}

function formatPercentBlock(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function resolveOverallValueNumberBlock(balanceData: unknown): number | null {
  if (!balanceData || typeof balanceData !== 'object' || Array.isArray(balanceData)) return null
  const row = balanceData as Record<string, unknown>
  const currencyAssets = asRecordArrayBlock(row.account_currency_assets)
  const explicitOverallValue = firstNumberBlock(
    row.net_liquidation_value,
    row.netLiquidationValue,
    row.total_asset,
    row.total_assets,
    row.total_value,
    row.totalValue,
  )
  if (explicitOverallValue !== null) return explicitOverallValue

  const summedCurrencyOverallValue = sumRecordNumberFieldsBlock(
    currencyAssets,
    'net_liquidation_value',
    'netLiquidationValue',
    'total_asset',
    'total_assets',
    'total_value',
    'totalValue',
  )
  if (summedCurrencyOverallValue !== null) return summedCurrencyOverallValue

  const totalCash = resolveOverallCashValueBlock(balanceData)
  const marketValuePlusCash = firstNumberBlock(row.total_market_value, row.totalMarketValue)
  if (marketValuePlusCash !== null && totalCash !== null) return marketValuePlusCash + totalCash

  const summedCurrencyMarketValue = sumRecordNumberFieldsBlock(
    currencyAssets,
    'positions_market_value',
    'positionsMarketValue',
    'total_market_value',
    'totalMarketValue',
  )
  if (summedCurrencyMarketValue !== null && totalCash !== null) return summedCurrencyMarketValue + totalCash

  return firstNumberBlock(
    row.total_market_value,
    row.totalMarketValue,
    summedCurrencyMarketValue,
  )
}

function formatOverallValueBlock(balanceData: unknown): string {
  return formatCurrencyBlock(resolveOverallValueNumberBlock(balanceData))
}

function resolveOverallCashValueBlock(balanceData: unknown): number | null {
  if (!balanceData || typeof balanceData !== 'object' || Array.isArray(balanceData)) return null
  const row = balanceData as Record<string, unknown>
  const topLevelCash = firstNumberBlock(row.total_cash, row.totalCash)
  if (topLevelCash !== null) return topLevelCash
  const currencyAssets = asRecordArrayBlock(row.account_currency_assets)
  let total = 0
  let hasCash = false
  for (const asset of currencyAssets) {
    const cashValue = firstNumberBlock(
      asset.total_cash,
      asset.totalCash,
      asset.cash_balance,
      asset.cashBalance,
      asset.settled_cash,
      asset.settledCash,
      asset.available_cash,
      asset.availableCash,
      asset.withdrawable_cash,
      asset.withdrawableCash,
      asset.cash,
      asset.balance,
    )
    if (cashValue === null) continue
    total += cashValue
    hasCash = true
  }
  return hasCash ? total : null
}

function formatFetchedTimestampBlock(value: string | null): string {
  if (!value) return 'No saved refresh yet'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function normalizeKeyFragmentBlock(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return normalized || 'item'
}

function normalizeStrikeForDisplayBlock(value: string | null | undefined): string {
  const normalized = firstStringBlock(value)
  if (!normalized) return ''
  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) {
    if (Number.isInteger(numeric)) return String(numeric)
    return String(numeric)
  }
  return normalized
}

function mapPositionStatusToNodeStatusBlock(status: string | null | undefined): NodeRecord['status'] {
  return normalizePositionStatusBlock(status)
}

function mapNodeStatusToPositionStatusBlock(status: NodeStatus): NodeStatus {
  return normalizePositionStatusBlock(status)
}

function normalizePositionStatusBlock(status: string | null | undefined): NodeStatus {
  const normalized = (status ?? '').trim().toLowerCase()
  if (!normalized) return 'taken'
  if (normalized === 'done' || normalized === 'complete' || normalized === 'completed' || normalized === 'closed' || normalized === 'resolved' || normalized === 'shipped') {
    return 'completed'
  }
  if (normalized === 'ready') return 'planned'
  if (normalized === 'in_progress') return 'active'
  if (normalized === 'blocked') return 'paused'
  if ((NODE_STATUSES as readonly string[]).includes(normalized)) return normalized as NodeStatus
  return 'taken'
}

interface WebullAccountLabelEntryBlock {
  label: string
  accountId: string | null
  accountNumber: string | null
}

// Friendly personal-account display names. These are now derived primarily from
// the stable Webull `account_class` / `account_label` carried on each account, so
// labels follow account identity rather than discovery order (which previously
// crossed the two labels whenever Webull returned accounts in a different order).
// The order-based list below is only a last-resort fallback for accounts that
// arrive without any class/label; any account beyond it falls back to "Account N".
const PERSONAL_WEBULL_ACCOUNT_CLASS_LABELS_BLOCK: Record<string, string> = {
  ROTH_IRA: 'Roth IRA',
  INDIVIDUAL_CASH: 'Individual Cash',
  TRADITIONAL_IRA: 'Traditional IRA',
  MARGIN: 'Margin',
}
const PERSONAL_WEBULL_ACCOUNT_LABELS_BLOCK = ['Individual Cash', 'Roth IRA']

// Resolve a friendly label for a single account, preferring stable identity
// (account_class, then Webull's own account_label) and only falling back to the
// discovery-order list when neither is present.
function resolveFriendlyAccountLabelBlock(
  account: { accountClass?: string | null; accountLabel?: string | null },
  orderIndex: number,
): string {
  const normalizedClass = (account.accountClass ?? '').trim().toUpperCase()
  if (normalizedClass && PERSONAL_WEBULL_ACCOUNT_CLASS_LABELS_BLOCK[normalizedClass]) {
    return PERSONAL_WEBULL_ACCOUNT_CLASS_LABELS_BLOCK[normalizedClass]
  }
  const apiLabel = (account.accountLabel ?? '').trim()
  if (apiLabel) return apiLabel
  return PERSONAL_WEBULL_ACCOUNT_LABELS_BLOCK[orderIndex] ?? `Account ${orderIndex + 1}`
}

function buildAccountLabelEntriesBlock(
  accounts: WebullAccountSnapshotOrch[],
  selectedAccount: WebullSelectedAccountOrch | null,
): WebullAccountLabelEntryBlock[] {
  const sourceAccounts = accounts.length > 0
    ? accounts.map((snapshot) => snapshot.account)
    : (selectedAccount ? [selectedAccount] : [])
  const seen = new Set<string>()
  const entries: WebullAccountLabelEntryBlock[] = []

  for (const account of sourceAccounts) {
    const accountId = firstStringBlock(account.accountId) || null
    const accountNumber = firstStringBlock(account.accountNumber) || null
    if (!accountId && !accountNumber) continue
    const dedupeKey = `${accountId ?? ''}::${accountNumber ?? ''}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    entries.push({
      label: resolveFriendlyAccountLabelBlock(account, entries.length),
      accountId,
      accountNumber,
    })
  }

  return entries
}

function resolveAccountLabelBlock(
  accountLabels: WebullAccountLabelEntryBlock[],
  accountId: unknown,
  accountNumber: unknown,
): string | null {
  const normalizedAccountId = firstStringBlock(accountId) || null
  const normalizedAccountNumber = firstStringBlock(accountNumber) || null
  for (const entry of accountLabels) {
    if (normalizedAccountId && entry.accountId === normalizedAccountId) return entry.label
    if (normalizedAccountNumber && entry.accountNumber === normalizedAccountNumber) return entry.label
  }
  return null
}

function formatAccountDescriptorBlock(entry: WebullAccountLabelEntryBlock): string {
  const suffix = entry.accountNumber ?? entry.accountId
  return suffix ? `${entry.label} (${suffix})` : entry.label
}

// Pastel account chip colors: Roth IRA = bright amber, Individual Cash (and any other) = soft blue.
function accountPillClassBlock(label: string | null): string {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium'
  const tone = label === 'Roth IRA'
    ? 'bg-amber-300/25 text-amber-700 dark:text-amber-200'
    : 'bg-sky-300/25 text-sky-700 dark:text-sky-200'
  return `${base} ${tone}`
}

function normalizePriorityFromUnknownBlock(value: unknown): NodePriority | null {
  const normalized = firstStringBlock(value).toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'critical') {
    return normalized
  }
  return null
}

function asStringArrayBlock(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return normalizeTagListBlock(
    value
      .map(entry => firstStringBlock(entry))
      .filter(Boolean),
  )
}

function asYamlCommentsBlock(value: unknown): YAMLCommentEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    const text = firstStringBlock(row.text)
    if (!text) return []
    const next: YAMLCommentEntry = { text }
    const addedAt = firstStringBlock(row.added_at)
    if (addedAt) next.added_at = addedAt
    const addedBy = firstStringBlock(row.added_by)
    if (addedBy) next.added_by = addedBy
    return [next]
  })
}

function positionTitleFromSummaryBlock(position: WebullPositionSummaryBlock): string {
  const symbol = firstStringBlock(position.symbol) || 'UNKNOWN'
  const instrumentType = firstStringBlock(position.instrumentType).toUpperCase()
  if (instrumentType === 'CASH') {
    const cashCurrency = firstStringBlock(position.cashCurrency).toUpperCase() || 'USD'
    return cashCurrency === 'USD' ? 'Cash' : `${cashCurrency} Cash`
  }
  const optionType = firstStringBlock(position.optionType).toUpperCase()
  const optionExpireDate = firstStringBlock(position.optionExpireDate)
  const optionStrike = normalizeStrikeForDisplayBlock(position.optionExercisePrice)
  if (optionType && optionExpireDate && optionStrike) {
    return `${symbol}${optionStrike}-${optionExpireDate}-${optionType}`
  }
  // Stocks/ETFs (EQUITY, STOCK, …) display as just the ticker, e.g. "TSLA" not "TSLASTOCK".
  return symbol
}

function compareWebullPositionsAscendingBlock(a: WebullPositionSummaryBlock, b: WebullPositionSummaryBlock): number {
  const byTitle = positionTitleFromSummaryBlock(a).localeCompare(
    positionTitleFromSummaryBlock(b),
    undefined,
    { numeric: true, sensitivity: 'base' },
  )
  if (byTitle !== 0) return byTitle
  return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' })
}

function sortWebullPositionsAscendingBlock(positions: WebullPositionSummaryBlock[]): WebullPositionSummaryBlock[] {
  return [...positions].sort(compareWebullPositionsAscendingBlock)
}

function buildFallbackCompaniesFromOverallRowsBlock(rows: Array<Record<string, unknown>>): WebullCompanyOverviewBlock[] {
  const grouped = new Map<string, WebullPositionSummaryBlock[]>()
  for (const row of rows) {
    const instrumentType = firstStringBlock(row.instrument_type, row.type).toUpperCase()
    const ticker = firstStringBlock(
      row.symbol,
      row.ticker,
      row.position_symbol,
      row.stock_code,
      instrumentType === 'CASH' ? 'CASH' : '',
    ).toUpperCase()
    if (!ticker) continue
    const legId = firstStringBlock(row.leg_id, row.id) || `${ticker}-${grouped.get(ticker)?.length ?? 0}`
    const fileName = `${toOverallPositionTitleBlock(row).replace(/\s+/g, '-')}.md`
    const status = normalizePositionStatusBlock(firstStringBlock(row.status, row.position_status))
    const list = grouped.get(ticker) ?? []
    list.push({
      id: legId,
      fileName,
      symbol: ticker,
      status,
      source: 'overall_payload',
      accountId: firstStringBlock(row.account_id, row.accountId) || null,
      accountNumber: firstStringBlock(row.account_number, row.accountNumber) || null,
      cashCurrency: firstStringBlock(row.cash_currency, row.cashCurrency, row.currency, row.currency_code, row.currencyCode) || null,
      instrumentType: firstStringBlock(row.instrument_type, row.type) || null,
      optionType: firstStringBlock(row.option_type) || null,
      optionExpireDate: firstStringBlock(row.option_expire_date) || null,
      optionExercisePrice: firstStringBlock(row.option_exercise_price) || null,
      quantity: firstStringBlock(row.quantity, row.qty, row.position, row.shares) || null,
      cost: firstStringBlock(row.cost) || null,
      proportion: firstStringBlock(row.proportion) || null,
      lastPrice: firstStringBlock(row.last_price) || null,
      unrealizedProfitLoss: firstStringBlock(row.unrealized_profit_loss) || null,
      dayProfitLoss: firstStringBlock(row.day_profit_loss) || null,
      linkedIdeaId: null,
      relatedNodes: [],
      tags: [],
      projectPresetTags: [],
    })
    grouped.set(ticker, list)
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ticker, positions]) => ({
      companyTicker: ticker,
      indexFilePath: '',
      indexId: `${ticker}-index`,
      strategyNotes: '',
      relatedIdeaIds: [],
      programGroupId: null,
      valuationNotePath: null,
      companyPdfReportPath: null,
      positions: sortWebullPositionsAscendingBlock(positions),
    }))
}

function toOverallPositionTitleBlock(row: Record<string, unknown>): string {
  const instrumentType = firstStringBlock(row.instrument_type, row.type).toUpperCase()
  const accountSuffix = firstStringBlock(row.account_number, row.account_id)
  if (instrumentType === 'CASH') {
    const cashCurrency = firstStringBlock(row.cash_currency, row.cashCurrency, row.currency, row.currency_code, row.currencyCode).toUpperCase() || 'USD'
    const title = cashCurrency === 'USD' ? 'Cash' : `${cashCurrency} Cash`
    return accountSuffix ? `${title} ${accountSuffix}` : title
  }
  const symbol = firstStringBlock(row.symbol, row.ticker, row.position_symbol, row.stock_code) || 'UNKNOWN'
  const optionType = firstStringBlock(row.option_type).toUpperCase()
  const optionExpireDate = firstStringBlock(row.option_expire_date)
  const optionStrike = firstStringBlock(row.option_exercise_price)
  if (optionType && optionExpireDate && optionStrike) {
    const title = `${symbol} ${optionStrike} ${optionExpireDate} ${optionType}`
    return accountSuffix ? `${title} ${accountSuffix}` : title
  }
  return accountSuffix ? `${symbol} ${accountSuffix}` : symbol
}

function toJsonBlock(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

function normalizeRelativePathBlock(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function linkLabelFromPathBlock(path: string): string {
  const normalized = normalizeRelativePathBlock(path)
  const fileName = normalized.split('/').pop() || normalized
  return fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -3) : fileName
}

function inlineMetadataValueBlock(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function metadataEntriesFromRecordBlock(record: Record<string, unknown> | null | undefined): Array<[string, unknown]> {
  if (!record) return []
  return Object.entries(record)
    .filter(([, value]) => (
      value !== undefined
      && value !== null
      && !(typeof value === 'string' && value.trim().length === 0)
    ))
    .sort(([a], [b]) => a.localeCompare(b))
}

function asMetadataRecordBlock(node: NodeRecord): Record<string, unknown> {
  const metadata = node.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  return metadata as Record<string, unknown>
}

function readNumberFromRecordBlock(record: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  if (!record) return null
  for (const key of keys) {
    const value = firstNumberBlock(record[key])
    if (value !== null) return value
  }
  return null
}

// Per-share / per-contract cost (premium per share for options). Webull stores
// this as `cost_price`; the bare `cost` field is the TOTAL dollar basis and is
// intentionally NOT consulted here so totals don't get over-multiplied.
function resolveUnitCostBlock(payload: Record<string, unknown> | null | undefined): number | null {
  return readNumberFromRecordBlock(payload, 'cost_price', 'unit_cost', 'avg_cost', 'average_cost')
}

// Share/contract count held for a position, using the same field aliases the cost math relies on.
function resolveQuantityBlock(payload: Record<string, unknown> | null | undefined): number | null {
  return readNumberFromRecordBlock(payload, 'quantity', 'qty', 'position', 'position_size', 'held', 'amount')
}

function formatQuantityBlock(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

// Total dollar cost basis for a position. Webull's `cost` already factors in
// the option contract multiplier (e.g. 1 MU contract: cost=$24,200, cost_price=$242),
// so prefer it directly. Fall back to cost_price × quantity × multiplier only
// when the broker omits the total.
function resolveTotalCostBlock(payload: Record<string, unknown> | null | undefined): number | null {
  const directTotal = readNumberFromRecordBlock(payload, 'cost')
  if (directTotal !== null) return directTotal
  const unitCost = resolveUnitCostBlock(payload)
  if (unitCost === null) return null
  const quantity = resolveQuantityBlock(payload)
  const multiplier = readNumberFromRecordBlock(payload, 'option_contract_multiplier') ?? 1
  if (quantity === null || quantity <= 0) return unitCost
  return unitCost * quantity * multiplier
}

// True per-share/per-contract cost. The stored `cost` field is the TOTAL cost basis,
// so the per-unit cost is total / quantity (e.g. $800 over 5 shares = $160/share).
function resolvePerUnitCostBlock(totalCost: number | null, quantity: number | null): number | null {
  if (totalCost === null) return null
  if (quantity === null || quantity <= 0) return totalCost
  return totalCost / quantity
}

function resolveUnrealizedProfitLossBlock(payload: Record<string, unknown> | null | undefined): number | null {
  return readNumberFromRecordBlock(payload, 'unrealized_profit_loss', 'unrealizedProfitLoss', 'upl')
}

function positionPayloadFromSummaryBlock(position: WebullPositionSummaryBlock): Record<string, unknown> {
  return {
    id: position.id,
    file_name: position.fileName,
    symbol: position.symbol,
    status: position.status,
    source: position.source,
    account_id: position.accountId,
    account_number: position.accountNumber,
    cash_currency: position.cashCurrency,
    instrument_type: position.instrumentType,
    option_type: position.optionType,
    option_expire_date: position.optionExpireDate,
    option_exercise_price: position.optionExercisePrice,
    cost: position.cost,
    proportion: position.proportion,
    last_price: position.lastPrice,
    unrealized_profit_loss: position.unrealizedProfitLoss,
    day_profit_loss: position.dayProfitLoss,
    linked_idea_id: position.linkedIdeaId,
    related_nodes: position.relatedNodes,
  }
}

function computeCompanyTotalsBlock(positions: WebullPositionSummaryBlock[]): {
  totalCost: number | null
  avgUnitCost: number | null
  totalUnrealizedProfitLoss: number | null
  totalCurrentPrice: number | null
} {
  let totalCost = 0
  let totalCostCount = 0
  let totalQuantity = 0
  let totalUnrealized = 0
  let unrealizedCount = 0
  let totalCurrentPrice = 0
  let currentPriceCount = 0

  for (const position of positions) {
    const payload = positionPayloadFromSummaryBlock(position)
    const totalCostValue = resolveTotalCostBlock(payload)
    if (totalCostValue !== null) {
      totalCost += totalCostValue
      totalCostCount += 1
    }
    const quantityValue = firstNumberBlock(position.quantity)
    if (quantityValue !== null && quantityValue > 0) {
      totalQuantity += quantityValue
    }
    const unrealizedValue = firstNumberBlock(payload.unrealized_profit_loss)
    if (unrealizedValue !== null) {
      totalUnrealized += unrealizedValue
      unrealizedCount += 1
    }
    const currentPriceValue = firstNumberBlock(payload.last_price)
    if (currentPriceValue !== null) {
      totalCurrentPrice += currentPriceValue
      currentPriceCount += 1
    }
  }

  return {
    totalCost: totalCostCount > 0 ? totalCost : null,
    avgUnitCost: totalCostCount > 0 && totalQuantity > 0 ? totalCost / totalQuantity : null,
    totalUnrealizedProfitLoss: unrealizedCount > 0 ? totalUnrealized : null,
    totalCurrentPrice: currentPriceCount > 0 ? totalCurrentPrice : null,
  }
}

function isOptionPositionBlock(position: WebullPositionSummaryBlock): boolean {
  const instrumentType = firstStringBlock(position.instrumentType).toUpperCase()
  if (instrumentType === 'OPTION') return true
  if (instrumentType === 'STOCK') return false
  return Boolean(firstStringBlock(position.optionType) || firstStringBlock(position.optionExpireDate))
}

function percentOfBlock(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total === 0) return null
  return (part / total) * 100
}

function computeCompanySummaryMetricsBlock(positions: WebullPositionSummaryBlock[]): {
  totalCost: number | null
  stockCost: number | null
  optionCost: number | null
  totalProfitLoss: number | null
  stockProfitLoss: number | null
  optionProfitLoss: number | null
} {
  let totalCost = 0
  let stockCost = 0
  let optionCost = 0
  let totalProfitLoss = 0
  let stockProfitLoss = 0
  let optionProfitLoss = 0

  let hasTotalCost = false
  let hasStockCost = false
  let hasOptionCost = false
  let hasTotalProfitLoss = false
  let hasStockProfitLoss = false
  let hasOptionProfitLoss = false

  for (const position of positions) {
    const payload = positionPayloadFromSummaryBlock(position)
    const optionPosition = isOptionPositionBlock(position)

    const costValue = resolveTotalCostBlock(payload)
    if (costValue !== null) {
      totalCost += costValue
      hasTotalCost = true
      if (optionPosition) {
        optionCost += costValue
        hasOptionCost = true
      } else {
        stockCost += costValue
        hasStockCost = true
      }
    }

    const profitLossValue = resolveUnrealizedProfitLossBlock(payload)
    if (profitLossValue !== null) {
      totalProfitLoss += profitLossValue
      hasTotalProfitLoss = true
      if (optionPosition) {
        optionProfitLoss += profitLossValue
        hasOptionProfitLoss = true
      } else {
        stockProfitLoss += profitLossValue
        hasStockProfitLoss = true
      }
    }
  }

  return {
    totalCost: hasTotalCost ? totalCost : null,
    stockCost: hasStockCost ? stockCost : null,
    optionCost: hasOptionCost ? optionCost : null,
    totalProfitLoss: hasTotalProfitLoss ? totalProfitLoss : null,
    stockProfitLoss: hasStockProfitLoss ? stockProfitLoss : null,
    optionProfitLoss: hasOptionProfitLoss ? optionProfitLoss : null,
  }
}

export default function WebullWorkspaceBlock({
  pageTitle,
  subtabs,
  activeSubtabId,
  onSelectSubtab,
  hasConfig,
  liveRefreshAvailable,
  error,
  runtime,
  lastRefreshRuntime,
  fetchedAt,
  endpoints,
  selectedAccount,
  accounts,
  accountBalanceLegacy,
  accountPositionsLegacy,
  assetsAccount,
  assetsPositions,
  warnings,
  attempts,
  executionRoot,
  executionCompanyCount,
  executionPositionCount,
  executionSyncSource,
  executionSyncWarnings,
  executionSyncError,
  executionOverview,
  activeCompanyTicker,
  onSelectCompanyTicker,
  activePositionFileName,
  onSelectPositionFileName,
  activePositionDetail,
  positionDetailLoading,
  positionDetailError,
  loading,
  workspaceBusy,
  workspaceMessage,
  onCreateCompany,
  onCreateManualPosition,
  onUpdatePositionOverlay,
  onUpdateCompanyOverlay,
  onSavePositionBody,
  onOpenNodeFile,
}: WebullWorkspaceBlockProps) {
  const { layout } = useUILayoutBlock()
  const isIos = layout.surface === 'capacitor-ios'
  const isElectron = layout.surface === 'electron'
  const isIPhoneIosSurface = isIos && layout.mode === 'phone'

  // iPhone list/detail: Webull sidebar (subtabs + companies + add) is the
  // list page; tapping a subtab or company pushes into its content view.
  // Back returns to list. Add-company input stays in the list.
  const [phonePickedItem, setPhonePickedItem] = useState(false)
  const phoneListMode = isIPhoneIosSurface && !phonePickedItem
  const phoneDetailMode = isIPhoneIosSurface && phonePickedItem
  useNativeBackHandlerBlock({
    active: phoneDetailMode,
    onBack: () => setPhonePickedItem(false),
  })
  const pushDetailIfPhone = useCallback((mutation: () => void) => {
    if (!(isCapacitorNative() && isIPhoneIosSurface)) {
      mutation()
      return
    }
    void (async () => {
      try {
        await setNativeNavigationStackBlock(['/webull'])
        await pushNativeWithForwardBlock('/webull', () => {
          mutation()
          setPhonePickedItem(true)
        })
      } catch (err) {
        console.warn('[Webull] phone push failed, falling back', err)
        mutation()
        setPhonePickedItem(true)
      }
    })()
  }, [isIPhoneIosSurface])

  const allWarnings = [...warnings, ...executionSyncWarnings]
  const overallRows = useMemo(() => {
    const fromAssets = asRecordArrayBlock(assetsPositions)
    return fromAssets.length > 0 ? fromAssets : asRecordArrayBlock(accountPositionsLegacy)
  }, [assetsPositions, accountPositionsLegacy])
  const overallCashValue = useMemo(
    () => resolveOverallCashValueBlock(accountBalanceLegacy ?? assetsAccount),
    [accountBalanceLegacy, assetsAccount],
  )
  const [preserveOverallContext, setPreserveOverallContext] = useState(false)
  const [sideTabsCollapsed, setSideTabsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(Webull_SIDE_TABS_COLLAPSED_STORAGE_KEY_BLOCK) === '1'
  })
  const [companyOrder, setCompanyOrder] = useState<string[]>(() => readPersistedCompanyOrderBlock())
  const [showArchivedByDefault, setShowArchivedByDefault] = useState<boolean>(() => readPersistedShowArchivedDefaultBlock())
  const [archivedOverrides, setArchivedOverrides] = useState<Record<string, boolean>>(() => readPersistedArchivedOverridesBlock())
  const [backlogLayoutEditMode, setBacklogLayoutEditMode] = useState(false)

  const isArchivedVisibleForTickerBlock = useCallback((ticker: string) => {
    const upper = ticker.toUpperCase()
    if (Object.prototype.hasOwnProperty.call(archivedOverrides, upper)) return archivedOverrides[upper]
    return showArchivedByDefault
  }, [archivedOverrides, showArchivedByDefault])

  const toggleShowArchivedByDefault = useCallback(() => {
    setShowArchivedByDefault(prev => {
      const next = !prev
      writePersistedShowArchivedDefaultBlock(next)
      return next
    })
  }, [])

  const toggleArchivedOverrideForTicker = useCallback((ticker: string) => {
    const upper = ticker.toUpperCase()
    setArchivedOverrides(prev => {
      const currentEffective = Object.prototype.hasOwnProperty.call(prev, upper) ? prev[upper] : showArchivedByDefault
      const nextEffective = !currentEffective
      const next = { ...prev }
      if (nextEffective === showArchivedByDefault) {
        delete next[upper]
      } else {
        next[upper] = nextEffective
      }
      writePersistedArchivedOverridesBlock(next)
      return next
    })
  }, [showArchivedByDefault])
  const projectRootKey = normalizeRelativePathBlock(executionRoot ?? 'webull-execution') || 'webull-execution'

  // Ticker → display name (e.g. "AAPL" → "Apple"). Sourced from each study
  // record's `company` frontmatter field; section titles fall back to the
  // ticker when absent.
  const [tickerToCompanyName, setTickerToCompanyName] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    if (!executionRoot) {
      setTickerToCompanyName(new Map())
      return
    }
    let cancelled = false
    void scanWebullStudyVaultBlock(executionRoot).then((scan) => {
      if (cancelled) return
      const next = new Map<string, string>()
      for (const loaded of scan.records) {
        if (loaded.record.company) {
          next.set(loaded.record.ticker.toUpperCase(), loaded.record.company)
        }
      }
      setTickerToCompanyName(next)
    })
    return () => { cancelled = true }
  }, [executionRoot])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(Webull_SIDE_TABS_COLLAPSED_STORAGE_KEY_BLOCK, sideTabsCollapsed ? '1' : '0')
  }, [sideTabsCollapsed])

  useEffect(() => {
    dispatchWebullSidebarChromeStateBlock({
      enabled: true,
      collapsed: sideTabsCollapsed,
      label: 'webull',
    })
  }, [sideTabsCollapsed])

  useEffect(() => {
    const handler = () => setSideTabsCollapsed(prev => !prev)
    window.addEventListener(Webull_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
    return () => window.removeEventListener(Webull_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
  }, [])

  const handleToggleSidebar = useCallback(() => setSideTabsCollapsed(prev => !prev), [])
  // Stable callbacks for BacklogListBlock — without these, the inline arrows
  // at the call sites broke React.memo on BacklogListBlock and forced the
  // full hierarchy list to re-render on every parent render.
  const handleBacklogOpenRelated = useCallback((path: string) => {
    onOpenNodeFile(path)
  }, [onOpenNodeFile])
  const handleBacklogCanOpenDetails = useCallback((node: NodeRecord) => node.type === 'epic', [])
  const renderProgramTitlePrefix = useCallback((program: NodeRecord) => {
    const ticker = typeof program.metadata?.webull_company_ticker === 'string'
      ? program.metadata.webull_company_ticker
      : null
    if (!ticker) return null
    const isActive = program.status !== 'archived'
    const archivedVisible = isArchivedVisibleForTickerBlock(ticker)
    const showOverrideButton = backlogLayoutEditMode && isActive
    return (
      <div className="flex items-center gap-1.5">
        {executionRoot && <TickerLogoBlock ticker={ticker} executionRoot={executionRoot} />}
        {showOverrideButton && (
          <button
            type="button"
            aria-label={archivedVisible ? 'Hide archived positions' : 'Show archived positions'}
            title={archivedVisible ? 'Hide archived positions for this company' : 'Show archived positions for this company'}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleArchivedOverrideForTicker(ticker)
            }}
          >
            {archivedVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    )
  }, [backlogLayoutEditMode, executionRoot, isArchivedVisibleForTickerBlock, toggleArchivedOverrideForTicker])
  useIosSidebarSwipeBlock({
    isIos,
    isOpen: !sideTabsCollapsed,
    keyboardVisible: layout.keyboardVisible,
    onToggle: handleToggleSidebar,
  })

  const selectedCompany = useMemo(
    () => executionOverview?.companies.find((company) => company.companyTicker === activeCompanyTicker) ?? null,
    [activeCompanyTicker, executionOverview],
  )
  const showCompanyView = !!selectedCompany && !preserveOverallContext
  const selectedCompanyMetrics = useMemo(() => {
    if (!selectedCompany) return null
    const activePositions = selectedCompany.positions.filter(
      p => normalizePositionStatusBlock(p.status) !== 'archived',
    )
    return computeCompanySummaryMetricsBlock(activePositions)
  }, [selectedCompany])
  const portfolioTotalCost = useMemo(() => {
    if (!executionOverview) return null
    let total = 0
    let hasAny = false
    for (const company of executionOverview.companies) {
      const companyTotals = computeCompanyTotalsBlock(company.positions)
      if (companyTotals.totalCost === null) continue
      total += companyTotals.totalCost
      hasAny = true
    }
    return hasAny ? total : null
  }, [executionOverview])

  const companiesForTable = useMemo<WebullCompanyOverviewBlock[]>(() => {
    const sourceCompanies = (() => {
      if (showCompanyView && selectedCompany) return [selectedCompany]
      if ((executionOverview?.companies.length ?? 0) > 0) return executionOverview?.companies ?? []
      return buildFallbackCompaniesFromOverallRowsBlock(overallRows)
    })()
    const mapped = sourceCompanies.map(company => ({
      ...company,
      positions: sortWebullPositionsAscendingBlock(company.positions),
    }))
    if (companyOrder.length === 0 || showCompanyView) return mapped
    const indexByTicker = new Map<string, number>()
    companyOrder.forEach((ticker, idx) => { indexByTicker.set(ticker.toUpperCase(), idx) })
    return [...mapped].sort((a, b) => {
      const aIdx = indexByTicker.get(a.companyTicker.toUpperCase())
      const bIdx = indexByTicker.get(b.companyTicker.toUpperCase())
      if (aIdx === undefined && bIdx === undefined) return 0
      if (aIdx === undefined) return 1
      if (bIdx === undefined) return -1
      return aIdx - bIdx
    })
  }, [companyOrder, executionOverview?.companies, overallRows, selectedCompany, showCompanyView])

  const backlogTableModel = useMemo(() => {
    // Stable synthetic timestamp — recomputing `new Date()` here would mutate
    // every program's updatedAt on each re-run, which makes BacklogListBlock's
    // programFingerprint change and wipe its expanded/children state, causing
    // the Overall Positions table to flicker.
    const now = SYNTHETIC_NODE_TIMESTAMP_BLOCK
    const programs: NodeRecord[] = []
    const nodeByUuid = new Map<string, NodeRecord>()
    const positionNodesByProgramUuid = new Map<string, NodeRecord[]>()
    const companyTickerByProgramUuid = new Map<string, string>()
    const positionRefByNodeUuid = new Map<string, { companyTicker: string; fileName: string }>()
    const nodeUuidByCompanyAndFile = new Map<string, string>()

    for (const company of companiesForTable) {
      const companyTicker = company.companyTicker.toUpperCase()
      const activePositions = company.positions.filter(p => normalizePositionStatusBlock(p.status) !== 'archived')
      const archivedPositions = company.positions.filter(p => normalizePositionStatusBlock(p.status) === 'archived')

      const buildPositionNodes = (
        positions: WebullPositionSummaryBlock[],
        parentProgramUuid: string,
        positionsSubdir: 'positions' | 'archived_positions',
      ): NodeRecord[] => positions.map((position, index) => {
        const positionStatus = normalizePositionStatusBlock(position.status)
        const fileName = position.fileName
        const nodeUuid = `webull-pos-${normalizeKeyFragmentBlock(companyTicker)}-${normalizeKeyFragmentBlock(fileName)}`
        const positionProjectPresetTags = normalizeTagListBlock(position.projectPresetTags ?? [])
        const positionRelatedNodes = (position.relatedNodes ?? [])
          .map(path => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
        const positionTags = normalizeTagListBlock([
          'webull',
          'execution',
          companyTicker.toLowerCase(),
          firstStringBlock(position.instrumentType).toLowerCase() || 'position',
          ...(position.tags ?? []),
        ])
        positionRefByNodeUuid.set(nodeUuid, { companyTicker, fileName })
        nodeUuidByCompanyAndFile.set(`${companyTicker}::${fileName}`, nodeUuid)
        const nodeRecord: NodeRecord = {
          uuid: nodeUuid,
          key: nodeUuid,
          title: positionTitleFromSummaryBlock(position),
          type: 'epic',
          level: 1,
          parent: parentProgramUuid,
          parentUuid: parentProgramUuid,
          parentType: 'program',
          filePath: executionRoot
            ? `${executionRoot}/${companyTicker}/${positionsSubdir}/${fileName}`
            : `webull/${companyTicker}/${positionsSubdir}/${fileName}`,
          projectRoot: executionRoot ?? 'webull-execution',
          description: undefined,
          tags: positionTags,
          projectPresetTags: positionProjectPresetTags,
          relatedNodes: positionRelatedNodes,
          status: mapPositionStatusToNodeStatusBlock(positionStatus),
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
          metadata: {
            webull_company_ticker: companyTicker,
            webull_position_file_name: fileName,
            webull_position_status: positionStatus,
            webull_linked_idea_id: position.linkedIdeaId ?? '',
            webull_position_quantity: position.quantity ?? '',
            webull_position_payload: positionPayloadFromSummaryBlock(position),
          },
        }
        nodeByUuid.set(nodeUuid, nodeRecord)
        return nodeRecord
      })

      const programUuid = `webull-company-${normalizeKeyFragmentBlock(companyTicker)}`
      const companyTotals = computeCompanyTotalsBlock(activePositions)
      companyTickerByProgramUuid.set(programUuid, companyTicker)
      const programNode: NodeRecord = {
        uuid: programUuid,
        key: programUuid,
        title: `${tickerToCompanyName.get(companyTicker) ?? companyTicker} Positions`,
        type: 'program',
        level: 0,
        filePath: company.indexFilePath || `webull/${companyTicker}/${companyTicker}-index.md`,
        projectRoot: executionRoot ?? 'webull-execution',
        tags: ['webull', 'execution', companyTicker.toLowerCase()],
        status: 'active',
        createdAt: now,
        updatedAt: now,
        metadata: {
          webull_company_ticker: companyTicker,
          webull_position_count: activePositions.length,
          webull_total_cost: companyTotals.totalCost,
          webull_avg_unit_cost: companyTotals.avgUnitCost,
          webull_total_unrealized_profit_loss: companyTotals.totalUnrealizedProfitLoss,
          webull_total_current_price: companyTotals.totalCurrentPrice,
          program_group: company.programGroupId,
        },
      }
      programs.push(programNode)
      nodeByUuid.set(programUuid, programNode)
      positionNodesByProgramUuid.set(programUuid, buildPositionNodes(activePositions, programUuid, 'positions'))

      if (archivedPositions.length > 0 && isArchivedVisibleForTickerBlock(companyTicker)) {
        const archivedProgramUuid = `webull-company-archived-${normalizeKeyFragmentBlock(companyTicker)}`
        companyTickerByProgramUuid.set(archivedProgramUuid, companyTicker)
        const archivedProgramNode: NodeRecord = {
          uuid: archivedProgramUuid,
          key: archivedProgramUuid,
          title: `${tickerToCompanyName.get(companyTicker) ?? companyTicker} Archived`,
          type: 'program',
          level: 0,
          filePath: company.indexFilePath || `webull/${companyTicker}/${companyTicker}-index.md`,
          projectRoot: executionRoot ?? 'webull-execution',
          tags: ['webull', 'execution', 'archived', companyTicker.toLowerCase()],
          status: 'archived',
          createdAt: now,
          updatedAt: now,
          metadata: {
            webull_company_ticker: companyTicker,
            webull_position_count: archivedPositions.length,
            webull_archived_section: true,
            program_group: company.programGroupId,
          },
        }
        programs.push(archivedProgramNode)
        nodeByUuid.set(archivedProgramUuid, archivedProgramNode)
        positionNodesByProgramUuid.set(
          archivedProgramUuid,
          buildPositionNodes(archivedPositions, archivedProgramUuid, 'archived_positions'),
        )
      }
    }

    return {
      programs,
      nodeByUuid,
      positionNodesByProgramUuid,
      companyTickerByProgramUuid,
      positionRefByNodeUuid,
      nodeUuidByCompanyAndFile,
    }
  }, [companiesForTable, executionRoot, isArchivedVisibleForTickerBlock, tickerToCompanyName])

  // Sort companies by active cost-basis to match the Allocation pie ordering,
  // then map each program (live + archived) to the same Tailwind border class
  // the pie wedge uses. Keeps the position-table left stripe visually anchored
  // to the donut.
  const companyBorderClassByProgramUuid = useMemo(() => {
    const sourceCompanies = (executionOverview?.companies.length ?? 0) > 0
      ? executionOverview!.companies
      : companiesForTable
    const tickerTotals = sourceCompanies
      .map((company) => {
        const ticker = company.companyTicker.toUpperCase()
        const activePositions = company.positions.filter(
          p => normalizePositionStatusBlock(p.status) !== 'archived',
        )
        const metrics = computeCompanySummaryMetricsBlock(activePositions)
        const total = Math.max(0, metrics.stockCost ?? 0) + Math.max(0, metrics.optionCost ?? 0)
        return { ticker, total }
      })
      .filter(entry => entry.total > 0)
      .sort((a, b) => b.total - a.total)
    const borderByTicker = new Map<string, string>()
    tickerTotals.forEach((entry, index) => {
      borderByTicker.set(entry.ticker, COMPANY_PIE_BORDER_PALETTE[index % COMPANY_PIE_BORDER_PALETTE.length])
    })
    const map: Record<string, string> = {}
    for (const [programUuid, ticker] of backlogTableModel.companyTickerByProgramUuid) {
      const borderClass = borderByTicker.get(ticker.toUpperCase())
      if (borderClass) map[programUuid] = borderClass
    }
    return map
  }, [backlogTableModel.companyTickerByProgramUuid, companiesForTable, executionOverview])

  const [detailPanelNodeId, setDetailPanelNodeId] = useState<string | null>(null)
  const [projectPresetTagsByRoot, setProjectPresetTagsByRoot] = useState<WebullProjectPresetTagsByRootBlock>(
    () => getJsonStorageItem<WebullProjectPresetTagsByRootBlock>(STORAGE_KEYS.webullProjectPresetTags, {}),
  )
  const [projectProgramGroupsByRoot, setProjectProgramGroupsByRoot] = useState<WebullProjectProgramGroupsByRootBlock>(
    () => getJsonStorageItem<WebullProjectProgramGroupsByRootBlock>(STORAGE_KEYS.thinkingOrganizerProjectProgramGroups, {}),
  )
  const [linkOptions, setLinkOptions] = useState<WebullLinkOptionBlock[]>([])
  const [pdfOptions, setPdfOptions] = useState<WebullPdfOptionBlock[]>([])
  const [companyFilePickerOpen, setCompanyFilePickerOpen] = useState(false)
  const [companyFileQuery, setCompanyFileQuery] = useState('')
  const [companyFileViewerNonce, setCompanyFileViewerNonce] = useState(0)
  const [companyFileControlsHidden, setCompanyFileControlsHidden] = useState(false)
  const [companyPdfPickerOpen, setCompanyPdfPickerOpen] = useState(false)
  const [companyPdfQuery, setCompanyPdfQuery] = useState('')
  const [companyPdfViewerNonce, setCompanyPdfViewerNonce] = useState(0)
  const [companyPdfControlsHidden, setCompanyPdfControlsHidden] = useState(false)

  const updateProjectProgramGroups = useCallback((
    root: string,
    updater: (groups: OrganizerProgramGroupEntryBlock[]) => OrganizerProgramGroupEntryBlock[],
  ) => {
    const normalizedRoot = normalizeRelativePathBlock(root)
    if (!normalizedRoot) return

    setProjectProgramGroupsByRoot((prev) => {
      const current = normalizeProgramGroupsBlock(prev[normalizedRoot] ?? [])
      const nextGroups = normalizeProgramGroupsBlock(updater(current))
      const next = { ...prev }
      if (nextGroups.length > 0) next[normalizedRoot] = nextGroups
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.thinkingOrganizerProjectProgramGroups, next)
      return next
    })
  }, [])

  const activeProjectProgramGroupIdByProgram = useMemo(() => {
    const byProgram: Record<string, string> = {}
    for (const program of backlogTableModel.programs) {
      const groupId = readProgramGroupFromNodeBlock(program)
      if (!groupId) continue
      byProgram[program.uuid] = groupId
    }
    return byProgram
  }, [backlogTableModel.programs])

  const activeProjectProgramGroups = useMemo(() => {
    return mergeProgramGroupsWithAssignmentsBlock(
      projectProgramGroupsByRoot[projectRootKey] ?? [],
      backlogTableModel.programs,
      activeProjectProgramGroupIdByProgram,
    )
  }, [
    activeProjectProgramGroupIdByProgram,
    backlogTableModel.programs,
    projectProgramGroupsByRoot,
    projectRootKey,
  ])

  const createActiveProjectCompanyGroup = useCallback((name: string) => {
    const nextName = name.trim()
    if (!nextName) return
    updateProjectProgramGroups(projectRootKey, (groups) => [
      ...groups,
      {
        id: makeProgramGroupIdBlock(),
        name: nextName,
        collapsed: false,
        programIds: [],
      },
    ])
  }, [projectRootKey, updateProjectProgramGroups])

  const deleteActiveProjectCompanyGroup = useCallback((groupId: string) => {
    const normalizedGroupId = groupId.trim()
    if (!normalizedGroupId) return
    const removedProgramIds = Object.entries(activeProjectProgramGroupIdByProgram)
      .flatMap(([programUuid, assignedGroupId]) => (assignedGroupId === normalizedGroupId ? [programUuid] : []))

    updateProjectProgramGroups(projectRootKey, groups => groups.filter(group => group.id !== normalizedGroupId))

    for (const programUuid of removedProgramIds) {
      const companyTicker = backlogTableModel.companyTickerByProgramUuid.get(programUuid)
      if (!companyTicker) continue
      void onUpdateCompanyOverlay({
        companyTicker,
        programGroupId: null,
      })
    }
  }, [
    activeProjectProgramGroupIdByProgram,
    backlogTableModel.companyTickerByProgramUuid,
    onUpdateCompanyOverlay,
    projectRootKey,
    updateProjectProgramGroups,
  ])

  const toggleActiveProjectCompanyGroupCollapsed = useCallback((groupId: string) => {
    const normalizedGroupId = groupId.trim()
    if (!normalizedGroupId) return
    updateProjectProgramGroups(projectRootKey, groups =>
      groups.map(group => (
        group.id === normalizedGroupId
          ? { ...group, collapsed: !group.collapsed }
          : group
      )),
    )
  }, [projectRootKey, updateProjectProgramGroups])

  const assignProgramToActiveProjectCompanyGroup = useCallback((program: NodeRecord, groupId: string | null) => {
    const companyTicker = backlogTableModel.companyTickerByProgramUuid.get(program.uuid)
    if (!companyTicker) return
    const normalizedGroupId = groupId?.trim() || null
    updateProjectProgramGroups(projectRootKey, (groups) => {
      const stripped = groups.map(group => ({
        ...group,
        programIds: group.programIds.filter(existing => existing !== program.uuid),
      }))
      if (!normalizedGroupId) return stripped
      return stripped.map(group => (
        group.id === normalizedGroupId
          ? { ...group, programIds: [...group.programIds, program.uuid] }
          : group
      ))
    })
    void onUpdateCompanyOverlay({
      companyTicker,
      programGroupId: normalizedGroupId,
    })
  }, [
    backlogTableModel.companyTickerByProgramUuid,
    onUpdateCompanyOverlay,
    projectRootKey,
    updateProjectProgramGroups,
  ])

  const selectedBacklogNodeId = useMemo(() => {
    if (!activeCompanyTicker || !activePositionFileName) return null
    return backlogTableModel.nodeUuidByCompanyAndFile.get(`${activeCompanyTicker.toUpperCase()}::${activePositionFileName}`) ?? null
  }, [activeCompanyTicker, activePositionFileName, backlogTableModel.nodeUuidByCompanyAndFile])

  const loadBacklogEpics = useCallback(async (program: NodeRecord): Promise<NodeRecord[]> => {
    return backlogTableModel.positionNodesByProgramUuid.get(program.uuid) ?? []
  }, [backlogTableModel.positionNodesByProgramUuid])

  const loadBacklogChildren = useCallback(async (): Promise<NodeRecord[]> => [], [])

  const handleReorderBacklogPrograms = useCallback(async (params: {
    parentKey: string | null
    orderedNodes: NodeRecord[]
  }): Promise<void> => {
    const seen = new Set<string>()
    const nextOrder: string[] = []
    for (const node of params.orderedNodes) {
      if (node.status === 'archived') continue
      const ticker = backlogTableModel.companyTickerByProgramUuid.get(node.uuid)
      if (!ticker) continue
      const upper = ticker.toUpperCase()
      if (seen.has(upper)) continue
      seen.add(upper)
      nextOrder.push(upper)
    }
    setCompanyOrder(nextOrder)
    writePersistedCompanyOrderBlock(nextOrder)
  }, [backlogTableModel.companyTickerByProgramUuid])

  // 1-based company rank per active program (ignores archived rows entirely).
  const activeCompanyRankByProgramUuid = useMemo(() => {
    const map = new Map<string, number>()
    let rank = 0
    for (const program of backlogTableModel.programs) {
      if (program.status === 'archived') continue
      rank += 1
      map.set(program.uuid, rank)
    }
    return map
  }, [backlogTableModel.programs])

  const resolveBacklogProgramOrdinal = useCallback((program: NodeRecord): number | null => {
    if (program.status === 'archived') return null
    return activeCompanyRankByProgramUuid.get(program.uuid) ?? null
  }, [activeCompanyRankByProgramUuid])

  const handleSetBacklogProgramOrdinal = useCallback((program: NodeRecord, nextOrdinal: number): void => {
    if (program.status === 'archived') return
    const ticker = backlogTableModel.companyTickerByProgramUuid.get(program.uuid)
    if (!ticker) return
    const upper = ticker.toUpperCase()

    // Rebuild the ticker order from the current visible active companies, then
    // move `upper` to the requested 1-based rank.
    const currentTickers: string[] = []
    for (const p of backlogTableModel.programs) {
      if (p.status === 'archived') continue
      const t = backlogTableModel.companyTickerByProgramUuid.get(p.uuid)
      if (!t) continue
      const up = t.toUpperCase()
      if (!currentTickers.includes(up)) currentTickers.push(up)
    }
    const withoutTarget = currentTickers.filter(t => t !== upper)
    const clamped = Math.max(1, Math.min(currentTickers.length, Math.trunc(nextOrdinal)))
    withoutTarget.splice(clamped - 1, 0, upper)
    setCompanyOrder(withoutTarget)
    writePersistedCompanyOrderBlock(withoutTarget)
  }, [backlogTableModel.companyTickerByProgramUuid, backlogTableModel.programs])

  const onSelectBacklogNode = useCallback((node: NodeRecord) => {
    if (node.type === 'program') {
      setPreserveOverallContext(false)
      const companyTicker = backlogTableModel.companyTickerByProgramUuid.get(node.uuid)
      if (companyTicker) onSelectCompanyTicker(companyTicker)
      setDetailPanelNodeId(null)
      return
    }
    const positionRef = backlogTableModel.positionRefByNodeUuid.get(node.uuid)
    if (!positionRef) return
    if (!showCompanyView) {
      setPreserveOverallContext(true)
    }
    onSelectCompanyTicker(positionRef.companyTicker)
    onSelectPositionFileName(positionRef.fileName)
    setDetailPanelNodeId(node.uuid)
  }, [
    backlogTableModel.companyTickerByProgramUuid,
    backlogTableModel.positionRefByNodeUuid,
    onSelectCompanyTicker,
    onSelectPositionFileName,
    showCompanyView,
  ])

  const onOpenBacklogNodeDetails = useCallback((node: NodeRecord) => {
    if (node.type !== 'epic') return
    onSelectBacklogNode(node)
  }, [onSelectBacklogNode])

  const onUpdateBacklogNodeNotes = useCallback(async (
    node: NodeRecord,
    description: string,
    comments: YAMLCommentEntry[],
  ): Promise<NodeRecord | void> => {
    if (node.type !== 'epic') return node
    const positionRef = backlogTableModel.positionRefByNodeUuid.get(node.uuid)
    if (!positionRef) return node
    await onUpdatePositionOverlay({
      fileName: positionRef.fileName,
      description,
      comments,
    })
    return {
      ...node,
      description,
      comments,
    }
  }, [backlogTableModel.positionRefByNodeUuid, onUpdatePositionOverlay])

  const onUpdateBacklogNodeRelatedNodes = useCallback(async (
    node: NodeRecord,
    relatedNodes: string[],
  ): Promise<NodeRecord | void> => {
    if (node.type !== 'epic') return node
    const positionRef = backlogTableModel.positionRefByNodeUuid.get(node.uuid)
    if (!positionRef) return node
    const normalizedRelatedNodes = relatedNodes
      .map(path => normalizeRelativePathBlock(path))
      .filter(Boolean)
    await onUpdatePositionOverlay({
      fileName: positionRef.fileName,
      relatedNodes: normalizedRelatedNodes,
    })
    return {
      ...node,
      relatedNodes: normalizedRelatedNodes,
    }
  }, [backlogTableModel.positionRefByNodeUuid, onUpdatePositionOverlay])

  const onUpdateBacklogNodeStatus = useCallback(async (
    node: NodeRecord,
    status: NodeStatus,
  ): Promise<NodeRecord | void> => {
    if (node.type !== 'epic') return node
    const positionRef = backlogTableModel.positionRefByNodeUuid.get(node.uuid)
    if (!positionRef) return node
    await onUpdatePositionOverlay({
      fileName: positionRef.fileName,
      status,
    })
    return {
      ...node,
      status,
    }
  }, [backlogTableModel.positionRefByNodeUuid, onUpdatePositionOverlay])

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      listMarkdownEntries(),
      listPdfFiles(),
      getAllNodes(),
    ])
      .then((results) => {
        if (cancelled) return

        const markdownResult = results[0]
        const pdfResult = results[1]
        const nodesResult = results[2]

        const nodes = (nodesResult.status === 'fulfilled') ? nodesResult.value : []
        const nodeByPath = new Map(
          nodes.map(node => [normalizeRelativePathBlock(node.filePath), node] as const),
        )

        if (markdownResult.status === 'fulfilled') {
          const options: WebullLinkOptionBlock[] = []
          for (const entry of markdownResult.value) {
            const path = normalizeRelativePathBlock(entry.path)
            if (!path) continue
            const node = nodeByPath.get(path)
            options.push({
              path,
              label: node?.title?.trim() || linkLabelFromPathBlock(path),
              summary: node?.aiSummary?.trim() || node?.bodyExcerpt?.trim() || node?.description?.trim() || undefined,
            })
          }
          options.sort((a, b) => a.label.localeCompare(b.label))
          setLinkOptions(options)
        } else {
          setLinkOptions([])
        }

        if (pdfResult.status === 'fulfilled') {
          const pdfFileOptions = pdfResult.value
            .map((path) => {
              const normalizedPath = normalizeRelativePathBlock(path)
              return {
                path: normalizedPath,
                label: path.split('/').pop() || normalizedPath,
              } satisfies WebullPdfOptionBlock
            })
            .filter((option) => option.path.length > 0)
            .sort((a, b) => a.label.localeCompare(b.label))
          setPdfOptions(pdfFileOptions)
        } else {
          setPdfOptions([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!detailPanelNodeId) return
    if (backlogTableModel.nodeByUuid.has(detailPanelNodeId)) return
    setDetailPanelNodeId(null)
  }, [backlogTableModel.nodeByUuid, detailPanelNodeId])

  useEffect(() => {
    setCompanyFilePickerOpen(false)
    setCompanyFileQuery('')
    setCompanyPdfPickerOpen(false)
    setCompanyPdfQuery('')
  }, [selectedCompany?.companyTicker])

  const selectCompanyFilePath = useCallback(async (rawPath: string) => {
    if (!selectedCompany) return
    const normalizedPath = normalizeRelativePathBlock(rawPath)
    const currentPath = normalizeRelativePathBlock(selectedCompany.valuationNotePath ?? '')
    setCompanyFilePickerOpen(false)
    setCompanyFileQuery('')
    if (normalizedPath === currentPath) return
    await onUpdateCompanyOverlay({
      valuationNotePath: normalizedPath || null,
    })
    setCompanyFileViewerNonce((prev) => prev + 1)
  }, [onUpdateCompanyOverlay, selectedCompany])

  const selectCompanyPdfPath = useCallback(async (rawPath: string) => {
    if (!selectedCompany) return
    const normalizedPath = normalizeRelativePathBlock(rawPath)
    const currentPath = normalizeRelativePathBlock(selectedCompany.companyPdfReportPath ?? '')
    setCompanyPdfPickerOpen(false)
    setCompanyPdfQuery('')
    if (normalizedPath === currentPath) return
    await onUpdateCompanyOverlay({
      companyPdfReportPath: normalizedPath || null,
    })
    setCompanyPdfViewerNonce((prev) => prev + 1)
  }, [onUpdateCompanyOverlay, selectedCompany])

  const accountLabelEntries = useMemo(
    () => buildAccountLabelEntriesBlock(accounts, selectedAccount),
    [accounts, selectedAccount],
  )

  const webullRowColumns = useMemo<BacklogRowColumnBlock[]>(() => {
    return [
      {
        id: 'account',
        label: 'Account',
        widthClassName: 'w-[7rem]',
        align: 'center',
        render: (node) => {
          if (node.type !== 'epic') return '—'
          const metadata = asMetadataRecordBlock(node)
          const payload = metadata.webull_position_payload as Record<string, unknown> | undefined
          const accountLabel = resolveAccountLabelBlock(
            accountLabelEntries,
            payload?.account_id ?? payload?.accountId,
            payload?.account_number ?? payload?.accountNumber,
          )
          return accountLabel ? (
            <span className={accountPillClassBlock(accountLabel)}>
              {accountLabel}
            </span>
          ) : '—'
        },
      },
      {
        id: 'quantity',
        label: 'Quantity',
        widthClassName: 'w-20',
        align: 'right',
        render: (node) => {
          if (node.type !== 'epic') return '—'
          const metadata = asMetadataRecordBlock(node)
          const payload = metadata.webull_position_payload as Record<string, unknown> | undefined
          const instrumentType = firstStringBlock(payload?.instrument_type, payload?.type).toUpperCase()
          if (instrumentType === 'CASH') return '—' // cash balances aren't a share count
          return formatQuantityBlock(readNumberFromRecordBlock(metadata, 'webull_position_quantity'))
        },
      },
      {
        id: 'cost',
        label: 'Cost',
        widthClassName: 'w-24',
        align: 'right',
        render: (node) => {
          const metadata = asMetadataRecordBlock(node)
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.webull_total_cost)
          const payload = metadata.webull_position_payload as Record<string, unknown> | undefined
          return formatCurrencyBlock(resolveTotalCostBlock(payload))
        },
      },
      {
        id: 'unit-cost',
        label: 'Unit Cost',
        widthClassName: 'w-24',
        align: 'right',
        render: (node) => {
          const metadata = asMetadataRecordBlock(node)
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.webull_avg_unit_cost)
          const payload = metadata.webull_position_payload as Record<string, unknown> | undefined
          const totalCost = resolveTotalCostBlock(payload)
          const quantity = readNumberFromRecordBlock(metadata, 'webull_position_quantity')
          return formatCurrencyBlock(resolvePerUnitCostBlock(totalCost, quantity))
        },
      },
      {
        id: 'upl',
        label: 'Current P/L',
        widthClassName: 'w-24',
        align: 'right',
        render: (node) => {
          const metadata = asMetadataRecordBlock(node)
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.webull_total_unrealized_profit_loss)
          const payload = metadata.webull_position_payload as Record<string, unknown> | undefined
          return formatCurrencyFromUnknownBlock(payload?.unrealized_profit_loss)
        },
      },
      {
        id: 'current-price',
        label: 'Current Price',
        widthClassName: 'w-24',
        align: 'right',
        render: (node) => {
          const metadata = asMetadataRecordBlock(node)
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.webull_total_current_price)
          const payload = metadata.webull_position_payload as Record<string, unknown> | undefined
          return formatCurrencyFromUnknownBlock(payload?.last_price)
        },
      },
    ]
  }, [accountLabelEntries])

  const linkOptionsByPath = useMemo(() => {
    const map = new Map<string, WebullLinkOptionBlock>()
    for (const option of linkOptions) {
      const normalizedPath = normalizeRelativePathBlock(option.path)
      if (!normalizedPath || map.has(normalizedPath)) continue
      map.set(normalizedPath, option)
    }
    return map
  }, [linkOptions])

  const renderWebullInlineDetails = useCallback((node: NodeRecord) => {
    if (node.type !== 'epic') return null
    const metadata = asMetadataRecordBlock(node)
    const payload = metadata.webull_position_payload as Record<string, unknown> | undefined
    const metadataWithoutPayload = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => key !== 'webull_position_payload'),
    ) as Record<string, unknown>
    const metadataEntries = metadataEntriesFromRecordBlock(metadataWithoutPayload)
    const payloadEntries = metadataEntriesFromRecordBlock(payload)
    const status = normalizePositionStatusBlock(firstStringBlock(metadata.webull_position_status, payload?.status))
    const instrumentType = firstStringBlock(payload?.instrument_type, payload?.type) || '—'
    const accountLabel = resolveAccountLabelBlock(
      accountLabelEntries,
      payload?.account_id ?? payload?.accountId,
      payload?.account_number ?? payload?.accountNumber,
    )
    const linkedIdeaId = firstStringBlock(metadata.webull_linked_idea_id, payload?.linked_idea_id)
    const tags = normalizeTagListBlock(node.tags ?? []).filter(tag => tag !== 'webull' && tag !== 'execution')
    const relatedNodePaths = (node.relatedNodes ?? asStringArrayBlock(payload?.related_nodes))
      .map(path => normalizeRelativePathBlock(path))
      .filter(Boolean)

    return (
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {accountLabel && (
            <span className={accountPillClassBlock(accountLabel)}>
              {accountLabel}
            </span>
          )}
          <p>
            <span className="font-medium text-foreground">Status:</span> {status}
            {' · '}
            <span className="font-medium text-foreground">Type:</span> {instrumentType}
          </p>
        </div>
        <p>
          <span className="font-medium text-foreground">Current Price:</span> {formatCurrencyFromUnknownBlock(payload?.last_price)}
          {' · '}
          <span className="font-medium text-foreground">Cost:</span> {formatCurrencyBlock(resolveTotalCostBlock(payload))}
          {' · '}
          <span className="font-medium text-foreground">P/L:</span> {formatCurrencyFromUnknownBlock(payload?.unrealized_profit_loss)}
        </p>
        {linkedIdeaId && (
          <p>
            <span className="font-medium text-foreground">Linked Idea:</span> {linkedIdeaId}
          </p>
        )}
        {tags.length > 0 && (
          <p>
            <span className="font-medium text-foreground">Tags:</span> {tags.join(', ')}
          </p>
        )}
        {relatedNodePaths.length > 0 && (
          <div className="space-y-1">
            <p><span className="font-medium text-foreground">Links:</span></p>
            {relatedNodePaths.map((path) => {
              const option = linkOptionsByPath.get(path)
              const label = option?.label || linkLabelFromPathBlock(path)
              const summary = option?.summary
              return (
                <p key={`${node.uuid}-related-${path}`} className="break-words">
                  <button
                    type="button"
                    className="text-blue-700 dark:text-blue-300 hover:underline"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onOpenNodeFile(path)
                    }}
                  >
                    {label}
                  </button>
                  {summary ? <span> — {summary}</span> : null}
                </p>
              )
            })}
          </div>
        )}
        {metadataEntries.map(([key, value]) => (
          <p key={`${node.uuid}-meta-${key}`} className="break-words">
            <span className="font-medium text-foreground">{key}:</span> {inlineMetadataValueBlock(value)}
          </p>
        ))}
        {payloadEntries.map(([key, value]) => (
          <p key={`${node.uuid}-payload-${key}`} className="break-words">
            <span className="font-medium text-foreground">{key}:</span> {inlineMetadataValueBlock(value)}
          </p>
        ))}
        {metadataEntries.length === 0 && payloadEntries.length === 0 && (
          <p className="text-muted-foreground">No metadata fields.</p>
        )}
      </div>
    )
  }, [accountLabelEntries, linkOptionsByPath, onOpenNodeFile])

  const detailPanelNodeBase = useMemo(
    () => (detailPanelNodeId ? backlogTableModel.nodeByUuid.get(detailPanelNodeId) ?? null : null),
    [backlogTableModel.nodeByUuid, detailPanelNodeId],
  )
  const detailPanelPositionRef = useMemo(
    () => (detailPanelNodeBase?.type === 'epic' ? backlogTableModel.positionRefByNodeUuid.get(detailPanelNodeBase.uuid) ?? null : null),
    [backlogTableModel.positionRefByNodeUuid, detailPanelNodeBase],
  )
  const detailPanelPositionDetail = useMemo(() => {
    if (!detailPanelPositionRef || !activePositionDetail) return null
    if (activePositionDetail.companyTicker !== detailPanelPositionRef.companyTicker) return null
    if (activePositionDetail.summary.fileName !== detailPanelPositionRef.fileName) return null
    return activePositionDetail
  }, [activePositionDetail, detailPanelPositionRef])

  const detailPanelNode = useMemo(() => {
    if (!detailPanelNodeBase) return null
    if (!detailPanelPositionDetail) return detailPanelNodeBase
    const frontmatter = detailPanelPositionDetail.frontmatter as Record<string, unknown>
    return {
      ...detailPanelNodeBase,
      title: firstStringBlock(frontmatter.title) || detailPanelNodeBase.title,
      description: firstStringBlock(frontmatter.description) || undefined,
      comments: asYamlCommentsBlock(frontmatter.comments),
      tags: asStringArrayBlock(frontmatter.tags),
      projectPresetTags: asStringArrayBlock(frontmatter.project_preset_tags),
      relatedNodes: asStringArrayBlock(frontmatter.related_nodes),
      priority: normalizePriorityFromUnknownBlock(frontmatter.priority) ?? detailPanelNodeBase.priority,
      status: mapPositionStatusToNodeStatusBlock(firstStringBlock(frontmatter.status) || detailPanelPositionDetail.summary.status),
      updatedAt: firstStringBlock(frontmatter.updated_at) || detailPanelNodeBase.updatedAt,
    } satisfies NodeRecord
  }, [detailPanelNodeBase, detailPanelPositionDetail])

  const detailPanelFrontmatter = useMemo(
    () => (detailPanelPositionDetail?.frontmatter as YAMLFrontmatter | undefined) ?? null,
    [detailPanelPositionDetail?.frontmatter],
  )

  const availableProjectPresetTags = useMemo(
    () => normalizeTagListBlock(projectPresetTagsByRoot[projectRootKey] ?? []),
    [projectPresetTagsByRoot, projectRootKey],
  )

  const updateProjectPresetTags = useCallback((root: string, tags: string[]) => {
    const normalizedRoot = normalizeRelativePathBlock(root)
    if (!normalizedRoot) return
    const normalizedTags = normalizeTagListBlock(tags)
    setProjectPresetTagsByRoot((prev) => {
      const existingTags = normalizeTagListBlock(prev[normalizedRoot] ?? [])
      if (tagsEqualBlock(existingTags, normalizedTags)) return prev
      const next: WebullProjectPresetTagsByRootBlock = { ...prev }
      if (normalizedTags.length > 0) next[normalizedRoot] = normalizedTags
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.webullProjectPresetTags, next)
      return next
    })
  }, [])

  useEffect(() => {
    const fromFrontmatter = asStringArrayBlock(detailPanelPositionDetail?.frontmatter?.project_preset_tags)
    if (fromFrontmatter.length === 0) return
    updateProjectPresetTags(projectRootKey, [...availableProjectPresetTags, ...fromFrontmatter])
  }, [availableProjectPresetTags, detailPanelPositionDetail?.frontmatter?.project_preset_tags, projectRootKey, updateProjectPresetTags])

  const detailPanelPresetTags = useMemo(
    () => normalizeTagListBlock([...availableProjectPresetTags, ...(detailPanelNode?.projectPresetTags ?? [])]),
    [availableProjectPresetTags, detailPanelNode?.projectPresetTags],
  )

  const [newCompanyTicker, setNewCompanyTicker] = useState('')
  const [newPositionTitle, setNewPositionTitle] = useState('')
  const [newPositionStatus, setNewPositionStatus] = useState<NodeStatus>('planned')
  const [newInstrumentType, setNewInstrumentType] = useState<'STOCK' | 'OPTION'>('STOCK')
  const [newOptionType, setNewOptionType] = useState<'CALL' | 'PUT'>('CALL')
  const [newOptionExpiry, setNewOptionExpiry] = useState('')
  const [newOptionStrike, setNewOptionStrike] = useState('')
  const [newLinkedIdeaId, setNewLinkedIdeaId] = useState('')
  const [newPositionNotes, setNewPositionNotes] = useState('')
  const [projectPresetTagDraft, setProjectPresetTagDraft] = useState('')
  const [projectTagsOpen, setProjectTagsOpen] = useState(false)

  const addProjectPresetTags = useCallback(() => {
    const additions = splitTagInputBlock(projectPresetTagDraft)
    if (additions.length === 0) return
    updateProjectPresetTags(projectRootKey, [...availableProjectPresetTags, ...additions])
    setProjectPresetTagDraft('')
  }, [availableProjectPresetTags, projectPresetTagDraft, projectRootKey, updateProjectPresetTags])

  const removeProjectPresetTag = useCallback((tag: string) => {
    const target = normalizeTagBlock(tag).toLowerCase()
    if (!target) return
    const next = availableProjectPresetTags.filter(
      existing => normalizeTagBlock(existing).toLowerCase() !== target,
    )
    updateProjectPresetTags(projectRootKey, next)
  }, [availableProjectPresetTags, projectRootKey, updateProjectPresetTags])

  useEffect(() => {
    const tagsFromOverview = normalizeTagListBlock(
      (executionOverview?.companies ?? [])
        .flatMap(company => company.positions)
        .flatMap(position => position.projectPresetTags ?? []),
    )
    if (tagsFromOverview.length === 0) return
    updateProjectPresetTags(projectRootKey, [...availableProjectPresetTags, ...tagsFromOverview])
  }, [availableProjectPresetTags, executionOverview, projectRootKey, updateProjectPresetTags])

  const rowProjectPresetTagsByRoot = useMemo<Record<string, string[]>>(() => {
    if (!projectRootKey) return {}
    const tagsFromRows = Array.from(backlogTableModel.nodeByUuid.values()).flatMap(node => node.projectPresetTags ?? [])
    const allTags = normalizeTagListBlock([...availableProjectPresetTags, ...tagsFromRows])
    if (allTags.length === 0) return {}
    return { [projectRootKey]: allTags }
  }, [availableProjectPresetTags, backlogTableModel.nodeByUuid, projectRootKey])

  const companyPortfolioWeight = percentOfBlock(selectedCompanyMetrics?.totalCost ?? null, portfolioTotalCost)
  const stockCostWeight = percentOfBlock(selectedCompanyMetrics?.stockCost ?? null, selectedCompanyMetrics?.totalCost ?? null)
  const optionCostWeight = percentOfBlock(selectedCompanyMetrics?.optionCost ?? null, selectedCompanyMetrics?.totalCost ?? null)
  const stockProfitLossReturn = percentOfBlock(
    selectedCompanyMetrics?.stockProfitLoss ?? null,
    selectedCompanyMetrics?.stockCost ?? null,
  )
  const optionProfitLossReturn = percentOfBlock(
    selectedCompanyMetrics?.optionProfitLoss ?? null,
    selectedCompanyMetrics?.optionCost ?? null,
  )
  const totalProfitLossReturn = percentOfBlock(
    selectedCompanyMetrics?.totalProfitLoss ?? null,
    selectedCompanyMetrics?.totalCost ?? null,
  )
  const selectedCompanyFilePath = normalizeRelativePathBlock(selectedCompany?.valuationNotePath ?? '')
  const selectedCompanyFileLabel = selectedCompanyFilePath
    ? (linkOptionsByPath.get(selectedCompanyFilePath)?.label ?? linkLabelFromPathBlock(selectedCompanyFilePath))
    : ''
  const selectedCompanyPdfPath = normalizeRelativePathBlock(selectedCompany?.companyPdfReportPath ?? '')
  const selectedCompanyPdfLabel = selectedCompanyPdfPath
    ? (pdfOptions.find((option) => option.path === selectedCompanyPdfPath)?.label ?? selectedCompanyPdfPath.split('/').pop() ?? selectedCompanyPdfPath)
    : ''
  const overallTabActive = !showCompanyView && activeSubtabId === 'overall'
  const studyTabActive = !showCompanyView && activeSubtabId === 'study'
  const workspaceTitle = showCompanyView && selectedCompany
    ? `${selectedCompany.companyTicker} Positions`
    : (studyTabActive ? 'Study' : 'Overall Positions')
  const workspaceDescription = showCompanyView && selectedCompany
    ? 'Company-specific position rows and overlay edits.'
    : (studyTabActive
      ? 'Company study records (watchlist + held) with live prices.'
      : 'Canonical overall positions from Webull sync.')

  return (
    <div className="ltm-webull-shell flex h-full min-h-0 w-full">
      {/* On iPhone, the desktop collapse state is ignored — list/detail mode
          is the sole authority. Sidebar always shows in list mode. */}
      {((phoneListMode || !sideTabsCollapsed) && !phoneDetailMode) && (
        <aside className={cn(
          'ltm-webull-shell-nav bg-background/40 px-3 py-4 overflow-y-auto',
          phoneListMode ? 'flex-1' : 'w-[220px] shrink-0 border-r border-border/60',
        )}>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Webull
          </p>
          <nav className="space-y-1">
            {subtabs.map((subtab) => {
              const active = activeSubtabId === subtab.id && !showCompanyView
              const Icon = WEBULL_SUBTAB_ICONS[subtab.id]
              return (
                <button
                  key={subtab.id}
                  type="button"
                  onClick={() => pushDetailIfPhone(() => {
                    onSelectSubtab(subtab.id)
                    setPreserveOverallContext(false)
                    onSelectCompanyTicker(null)
                  })}
                  className={cn(
                    'ltm-motion-fast flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    active && !phoneListMode
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{subtab.label}</span>
                </button>
              )
            })}
          </nav>

          <p className="mb-2 mt-5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Companies
          </p>
          <nav className="space-y-1">
            {(executionOverview?.companies ?? []).map((company, companyIndex) => {
              const active = showCompanyView && activeCompanyTicker === company.companyTicker
              return (
                <button
                  key={company.companyTicker}
                  type="button"
                  onClick={() => pushDetailIfPhone(() => {
                    setPreserveOverallContext(false)
                    onSelectCompanyTicker(company.companyTicker)
                  })}
                  className={cn(
                    'ltm-motion-fast flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    active && !phoneListMode
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  <sup className="-ml-1 inline-flex pt-0.5 align-super text-[9px] font-medium opacity-65 tabular-nums">
                    {companyIndex + 1}
                  </sup>
                  <span className="truncate">{company.companyTicker}</span>
                  <span className="ml-auto text-xs opacity-80">
                    {company.positions.filter(p => normalizePositionStatusBlock(p.status) !== 'archived').length}
                  </span>
                </button>
              )
            })}
            {(executionOverview?.companies.length ?? 0) === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground/60">No companies yet.</p>
            )}
          </nav>

          <p className="mb-2 mt-5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Add Company
          </p>
          <div className="space-y-2 px-1">
            <input
              type="text"
              value={newCompanyTicker}
              onChange={(event) => setNewCompanyTicker(event.target.value.toUpperCase())}
              placeholder="Ticker (e.g. TSLA)"
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
            />
            <Button
              type="button"
              className="w-full"
              size="sm"
              variant="outline"
              disabled={workspaceBusy || !newCompanyTicker.trim()}
              onClick={() => {
                const ticker = newCompanyTicker.trim()
                if (!ticker) return
                void onCreateCompany(ticker).then(() => setNewCompanyTicker(''))
              }}
            >
              Add Company
            </Button>
          </div>
        </aside>
      )}

      {studyTabActive && isElectron && !showCompanyView ? (
        <div className={cn(
          'min-w-0 overflow-hidden',
          phoneListMode ? 'hidden' : 'flex-1',
        )}>
          <WebullF9CanvasOrch />
        </div>
      ) : (
      <div className={cn(
        'min-w-0 overflow-auto px-6 py-5',
        phoneListMode ? 'hidden' : 'flex-1',
      )}>
      {pageTitle && (
        <div className="mb-4">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground">
            Personal market workspace with Webull-backed views.
          </p>
        </div>
      )}
      <Card className="border-foreground/[0.06] bg-white shadow-[0_2px_10px_-4px_rgba(20,20,24,0.08)] hover:shadow-[0_2px_10px_-4px_rgba(20,20,24,0.08)] dark:bg-background">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{workspaceTitle}</CardTitle>
            <CardDescription>{workspaceDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <TagDisclosureButtonBlock
              label="Project Tags"
              expanded={projectTagsOpen}
              onToggle={() => setProjectTagsOpen(prev => !prev)}
              count={availableProjectPresetTags.length}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {projectTagsOpen && (
            <div className="rounded-xl border bg-background p-3">
              <TagListEditorBlock
                heading="Project Tags"
                tags={availableProjectPresetTags}
                emptyMessage="No project tags yet."
                draftValue={projectPresetTagDraft}
                onDraftValueChange={setProjectPresetTagDraft}
                onAddTag={addProjectPresetTags}
                addPlaceholder="Add project tags (comma separated)"
                addDisabled={splitTagInputBlock(projectPresetTagDraft).length === 0}
                onRemoveTag={removeProjectPresetTag}
                chipTone="sky"
                disabled={workspaceBusy}
              />
            </div>
          )}

          {studyTabActive && !isElectron && (
            <WebullStudyBlock />
          )}

          {loading && (
            <div className="overflow-hidden rounded-full">
              <div className="h-1 w-full animate-pulse rounded-full bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {executionSyncError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {executionSyncError}
            </div>
          )}

          {allWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/20 p-3 text-sm text-amber-800 dark:text-amber-300">
              {allWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          {workspaceMessage && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-500/20 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {workspaceMessage}
            </div>
          )}

          {overallTabActive && (() => {
            const overallValueNumber = resolveOverallValueNumberBlock(accountBalanceLegacy ?? assetsAccount)
            let cashEquivalentExtra = 0
            let cashEquivalentHasAny = false
            for (const row of overallRows) {
              const symbol = firstStringBlock(row.symbol, row.ticker, row.position_symbol, row.stock_code).toUpperCase()
              if (!CASH_EQUIVALENT_SYMBOLS.has(symbol)) continue
              const marketValue = firstNumberBlock(row.market_value, row.marketValue, row.position_value, row.positionValue)
                ?? (() => {
                  const lastPrice = firstNumberBlock(row.last_price, row.lastPrice)
                  const quantity = firstNumberBlock(row.quantity, row.qty, row.position, row.position_size)
                  return (lastPrice !== null && quantity !== null) ? lastPrice * quantity : null
                })()
              if (marketValue === null) continue
              cashEquivalentExtra += marketValue
              cashEquivalentHasAny = true
            }
            const cashAndEquivalents = (overallCashValue !== null || cashEquivalentHasAny)
              ? (overallCashValue ?? 0) + cashEquivalentExtra
              : null
            const investedNumber = (overallValueNumber !== null && cashAndEquivalents !== null)
              ? Math.max(0, overallValueNumber - cashAndEquivalents)
              : null
            const investedShare = (investedNumber !== null && overallValueNumber && overallValueNumber > 0)
              ? Math.min(100, Math.max(0, (investedNumber / overallValueNumber) * 100))
              : null
            const cashShare = investedShare !== null ? 100 - investedShare : null
            const accountCount = accounts.length || (selectedAccount ? 1 : 0)
            const accountDescriptor = accountLabelEntries.length > 0
              ? accountLabelEntries.map(formatAccountDescriptorBlock).join(' · ')
              : (selectedAccount?.accountNumber ?? selectedAccount?.accountId ?? 'No account metadata')
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-foreground">{formatFetchedTimestampBlock(fetchedAt)}</span>
                    <span className="text-muted-foreground">· {formatRuntimeLabelBlock(lastRefreshRuntime)}</span>
                  </span>
                  <span className="hidden h-3 w-px bg-border sm:inline-block" />
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate" title={accountDescriptor}>{accountDescriptor}</span>
                  </span>
                  <span className="hidden h-3 w-px bg-border sm:inline-block" />
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    <span className="text-foreground">{executionCompanyCount}</span> indexed
                  </span>
                </div>
                <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-background to-sky-500/10 p-5 shadow-sm">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 blur-3xl" />
                  <div className="pointer-events-none absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-sky-500/10 dark:bg-sky-500/20 blur-3xl" />
                  <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        <Wallet className="h-3.5 w-3.5" />
                        Overall Value
                      </div>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                        {formatOverallValueBlock(accountBalanceLegacy ?? assetsAccount)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Across {accountCount || '—'} {accountCount === 1 ? 'account' : 'accounts'}
                        {executionCompanyCount > 0 ? ` · ${executionCompanyCount} indexed ${executionCompanyCount === 1 ? 'company' : 'companies'}` : ''}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm sm:max-w-sm sm:flex-1">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Invested</p>
                        <p className="mt-0.5 font-semibold text-emerald-500">
                          {formatCurrencyBlock(investedNumber)}
                          {investedShare !== null && (
                            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{investedShare.toFixed(1)}%</span>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Cash &amp; Equivalents</p>
                        <p className="mt-0.5 font-semibold text-sky-500">
                          {formatCurrencyBlock(cashAndEquivalents)}
                          {cashShare !== null && (
                            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{cashShare.toFixed(1)}%</span>
                          )}
                        </p>
                        {cashEquivalentHasAny && (
                          <p className="text-[11px] text-muted-foreground">
                            incl. {formatCurrencyBlock(cashEquivalentExtra)} JPST
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {(() => {
                  const pieCompanies = (executionOverview?.companies.length ?? 0) > 0
                    ? executionOverview!.companies
                    : companiesForTable
                  const { slices, total } = buildCompanyPieDataBlock(pieCompanies)
                  if (slices.length === 0 || total <= 0) return null
                  const profitLossByTicker = new Map<string, number | null>()
                  for (const company of pieCompanies) {
                    const ticker = company.companyTicker.toUpperCase()
                    const activePositions = company.positions.filter(p => normalizePositionStatusBlock(p.status) !== 'archived')
                    const metrics = computeCompanySummaryMetricsBlock(activePositions)
                    profitLossByTicker.set(ticker, metrics.totalProfitLoss)
                  }
                  const byTicker = new Map<string, { color: string; stock: number; option: number; other: number; total: number }>()
                  for (const slice of slices) {
                    const entry = byTicker.get(slice.ticker) ?? { color: slice.color, stock: 0, option: 0, other: 0, total: 0 }
                    if (slice.kind === 'STOCK') entry.stock += slice.value
                    else if (slice.kind === 'OPTION') entry.option += slice.value
                    else entry.other += slice.value
                    entry.total += slice.value
                    entry.color = slice.color
                    byTicker.set(slice.ticker, entry)
                  }
                  const legend = [...byTicker.entries()]
                    .map(([ticker, agg]) => {
                      const pl = profitLossByTicker.get(ticker) ?? null
                      const plPercent = (pl !== null && agg.total > 0) ? (pl / agg.total) * 100 : null
                      return { ticker, ...agg, share: (agg.total / total) * 100, plPercent }
                    })
                    .sort((a, b) => b.total - a.total)
                  const renderTickerLabel = (props: {
                    cx?: number; cy?: number; midAngle?: number; outerRadius?: number;
                    payload?: CompanyPieSliceBlock;
                  }) => {
                    const { cx, cy, midAngle, outerRadius, payload } = props
                    if (cx === undefined || cy === undefined || midAngle === undefined || outerRadius === undefined || !payload) return null
                    if (!payload.isFirstForTicker) return null
                    const tickerShare = total > 0 ? (byTicker.get(payload.ticker)?.total ?? 0) / total : 0
                    if (tickerShare < 0.025) return null
                    const RADIAN = Math.PI / 180
                    const sin = Math.sin(-midAngle * RADIAN)
                    const cos = Math.cos(-midAngle * RADIAN)
                    const x = cx + (outerRadius + 14) * cos
                    const y = cy + (outerRadius + 14) * sin
                    const anchor = cos >= 0 ? 'start' : 'end'
                    return (
                      <g>
                        <text
                          x={x}
                          y={y - 6}
                          textAnchor={anchor}
                          dominantBaseline="central"
                          fontSize={11}
                          fontWeight={600}
                          fill={payload.color}
                        >
                          {payload.ticker}
                        </text>
                        <text
                          x={x}
                          y={y + 6}
                          textAnchor={anchor}
                          dominantBaseline="central"
                          fontSize={10}
                          fontWeight={500}
                          fill="hsl(var(--muted-foreground))"
                        >
                          {(tickerShare * 100).toFixed(1)}%
                        </text>
                      </g>
                    )
                  }
                  return (
                    <div className="rounded-2xl border bg-background/40 p-5">
                      <div className="mb-4 flex items-baseline justify-between border-b border-border/40 pb-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Allocation by Businesses</p>
                          <p className="text-[11px] text-muted-foreground">by cost basis</p>
                        </div>
                        <p className="text-base font-semibold tracking-tight text-foreground">{formatCurrencyBlock(total)}</p>
                      </div>
                      <div className="flex flex-col gap-6 md:flex-row md:items-center">
                        <div className="relative h-[260px] w-full md:w-[320px] md:shrink-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={slices}
                                dataKey="value"
                                nameKey="key"
                                innerRadius={70}
                                outerRadius={105}
                                paddingAngle={0}
                                stroke="hsl(var(--background))"
                                strokeWidth={1}
                                label={renderTickerLabel}
                                labelLine={false}
                                isAnimationActive={false}
                              >
                                {slices.map((slice) => (
                                  <Cell key={slice.key} fill={slice.color} fillOpacity={slice.fillOpacity} />
                                ))}
                              </Pie>
                              <Tooltip
                                cursor={false}
                                contentStyle={{
                                  background: 'hsl(var(--background))',
                                  border: '1px solid hsl(var(--border))',
                                  borderRadius: 8,
                                  fontSize: 12,
                                }}
                                formatter={(value, _name, item) => {
                                  const numeric = typeof value === 'number' ? value : Number(value)
                                  const share = total > 0 ? (numeric / total) * 100 : 0
                                  const payload = (item as { payload?: CompanyPieSliceBlock } | undefined)?.payload
                                  const label = payload ? `${payload.ticker} · ${payload.kind.toLowerCase()}` : ''
                                  return [`${formatCurrencyBlock(numeric)} (${share.toFixed(1)}%)`, label]
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="relative flex-1">
                          <ul className="grid grid-cols-1 justify-center gap-x-16 gap-y-0.5 text-xs sm:grid-cols-[max-content_max-content] md:max-h-[260px] md:overflow-y-auto md:pr-2">
                          {legend.map((entry) => (
                            <li key={entry.ticker} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/[0.04]">
                              <div className="flex w-16 min-w-0 items-center gap-2">
                                <span
                                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: entry.color }}
                                />
                                <span className="truncate font-medium text-foreground">{entry.ticker}</span>
                                {entry.option > 0 && (
                                  <span
                                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: 'transparent', boxShadow: `inset 0 0 0 1px ${entry.color}` }}
                                    title={entry.stock > 0 ? 'Has stock and options' : 'Options only'}
                                  />
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-3 tabular-nums">
                                <span className="w-12 text-right text-muted-foreground">{entry.share.toFixed(1)}%</span>
                                <span className="w-14 text-right text-foreground/80">{formatCurrencyKBlock(entry.total)}</span>
                                <span
                                  className={cn(
                                    'w-12 text-right text-[10px]',
                                    entry.plPercent === null
                                      ? 'text-muted-foreground/60'
                                      : entry.plPercent >= 0
                                        ? 'text-emerald-500'
                                        : 'text-rose-500',
                                  )}
                                >
                                  {entry.plPercent === null
                                    ? '—'
                                    : `${entry.plPercent >= 0 ? '+' : ''}${entry.plPercent.toFixed(1)}%`}
                                </span>
                              </div>
                            </li>
                          ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {showCompanyView ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Total Cost</p>
                  <p className="mt-1 text-lg font-semibold">{formatCurrencyKBlock(selectedCompanyMetrics?.totalCost ?? null)}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrencyBlock(selectedCompanyMetrics?.totalCost ?? null)}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">% Of Portfolio</p>
                  <p className="mt-1 text-lg font-semibold">{formatPercentBlock(companyPortfolioWeight)}</p>
                  <p className="text-xs text-muted-foreground">
                    Stock {formatPercentBlock(stockCostWeight)} ({formatCurrencyKBlock(selectedCompanyMetrics?.stockCost ?? null)})
                    {' · '}
                    Option {formatPercentBlock(optionCostWeight)} ({formatCurrencyKBlock(selectedCompanyMetrics?.optionCost ?? null)})
                  </p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Current P/L</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatCurrencyKBlock(selectedCompanyMetrics?.totalProfitLoss ?? null)}
                    {totalProfitLossReturn !== null && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        ({totalProfitLossReturn >= 0 ? '+' : ''}{totalProfitLossReturn.toFixed(1)}%)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Stock {formatPercentBlock(stockProfitLossReturn)} ({formatCurrencyKBlock(selectedCompanyMetrics?.stockProfitLoss ?? null)})
                    {' · '}
                    Option {formatPercentBlock(optionProfitLossReturn)} ({formatCurrencyKBlock(selectedCompanyMetrics?.optionProfitLoss ?? null)})
                  </p>
                </div>
              </div>

              <FileSelectionViewerBlock
                heading="Company File"
                summary="Your most important notes on company, e.g. valuations, quick things to always remember, etc."
                selectedPath={selectedCompanyFilePath || null}
                selectedLabel={selectedCompanyFileLabel}
                emptySelectionMessage="No company file selected."
                options={linkOptions}
                query={companyFileQuery}
                onQueryChange={setCompanyFileQuery}
                pickerOpen={companyFilePickerOpen}
                onPickerOpenChange={setCompanyFilePickerOpen}
                controlsHidden={companyFileControlsHidden}
                onControlsHiddenChange={setCompanyFileControlsHidden}
                onSelectPath={(path) => { void selectCompanyFilePath(path ?? '') }}
                onOpenPath={onOpenNodeFile}
                disabled={workspaceBusy}
                searchPlaceholder="Search markdown file"
                searchEmptyMessage="No markdown files found"
                allowCustomValue
                hideDetailsWithSelectionControls
                searchHelperText="Select a file to set it as the company file."
                emptyViewerMessage="Select a company file to display it here with the full markdown viewer."
                renderSelectedContent={() => (
                  <div className="h-[700px] overflow-hidden rounded-lg border">
                    <MarkdownDocumentBlock
                      key={`${selectedCompanyFilePath}::${companyFileViewerNonce}`}
                      path={selectedCompanyFilePath}
                      initialMode="view"
                      onOpenPath={(path) => onOpenNodeFile(path)}
                      onOpenPathForEdit={(path) => onOpenNodeFile(path)}
                      className="h-full"
                    />
                  </div>
                )}
              />

              <div className="rounded-2xl border p-5">
                <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
                  {backlogLayoutEditMode && (
                    <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={showArchivedByDefault}
                        onChange={toggleShowArchivedByDefault}
                        className="h-3.5 w-3.5"
                      />
                      Show archived positions by default
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => setBacklogLayoutEditMode(prev => !prev)}
                    className={backlogLayoutEditMode
                      ? 'inline-flex h-8 items-center rounded-md bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90'
                      : 'inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted'}
                  >
                    {backlogLayoutEditMode ? 'Done' : 'Edit'}
                  </button>
                </div>
                <ScrollableZoomSurfaceBlock
                  minWidthClassName={Webull_WIDE_TABLE_MIN_WIDTH_CLASS_BLOCK}
                  controlsLabel="Table zoom"
                  showFitColumnsToWidthButton
                  persistStateKey="webull-table-viewport-fit"
                >
                  <BacklogListBlock
                    programs={backlogTableModel.programs}
                    onReorderSiblings={handleReorderBacklogPrograms}
                    resolveProgramOrdinal={resolveBacklogProgramOrdinal}
                    onSetProgramOrdinal={handleSetBacklogProgramOrdinal}
                    renderProgramTitlePrefix={renderProgramTitlePrefix}
                    programLayoutEditMode={backlogLayoutEditMode}
                    onProgramLayoutEditModeChange={setBacklogLayoutEditMode}
                    showProgramLayoutToggle={false}
                    epicBorderClassByProgramUuid={companyBorderClassByProgramUuid}
                    loadEpics={loadBacklogEpics}
                    loadChildren={loadBacklogChildren}
                    selectedNodeId={selectedBacklogNodeId}
                    readOnly
                    allowStatusEditingInReadOnly
                    allowProgramLayoutEditingInReadOnly
                    onSelectNode={onSelectBacklogNode}
                    programGroups={activeProjectProgramGroups}
                    programGroupIdByProgram={activeProjectProgramGroupIdByProgram}
                    onCreateProgramGroup={createActiveProjectCompanyGroup}
                    onDeleteProgramGroup={deleteActiveProjectCompanyGroup}
                    onToggleProgramGroupCollapsed={toggleActiveProjectCompanyGroupCollapsed}
                    onAssignProgramToGroup={assignProgramToActiveProjectCompanyGroup}
                    onOpenNodeDetails={onOpenBacklogNodeDetails}
                    onUpdateNodeStatus={onUpdateBacklogNodeStatus}
                    onUpdateNodeNotes={onUpdateBacklogNodeNotes}
                    relatedNodeOptions={linkOptions}
                    onOpenRelatedNode={handleBacklogOpenRelated}
                    programLabelSingular="company"
                    programLabelPlural="companies"
                    programGroupLabelSingular="company group"
                    projectPresetTagsByRoot={rowProjectPresetTagsByRoot}
                    canOpenNodeDetails={handleBacklogCanOpenDetails}
                    rowColumns={webullRowColumns}
                    showRowColumnsOnCompact
                    rowPresetTagLimit={5}
                    rowPresetTagsClassName="ml-auto w-[18rem] justify-end"
                    reserveTagsSlotWhenEmpty
                    linksColumnLabel="Links"
                    linksColumnWidthClassName="w-[8rem] mx-6"
                    linksColumnAlign="left"
                    linksColumnPaddingClassName="px-0"
                    linksBeforeTags
                    statusRightAligned={false}
                    rowDetailsRenderer={renderWebullInlineDetails}
                    titleColumnClassName="w-[11rem]"
                    wrapTitleText
                    actionsRightEdge
                    showProgramStatus={false}
                    showProgramCopyButton={false}
                    preferInlineDetailsButton
                    allowInlineNotesInReadOnly
                    showNodeTypeIcons={false}
                    showExpandToggles={false}
                    showPriorityDots={false}
                  />
                </ScrollableZoomSurfaceBlock>
              </div>

              <div className="rounded-xl border bg-background p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Create Position</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    type="text"
                    value={newPositionTitle}
                    onChange={(event) => setNewPositionTitle(event.target.value)}
                    placeholder="Position title"
                    className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
                  />
                  <select
                    value={newPositionStatus}
                    onChange={(event) => setNewPositionStatus(event.target.value as NodeStatus)}
                    className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
                  >
                    <option value="planned">planned</option>
                    <option value="watchlist">watchlist</option>
                    <option value="taken">taken</option>
                    <option value="completed">completed</option>
                  </select>
                  <select
                    value={newInstrumentType}
                    onChange={(event) => setNewInstrumentType(event.target.value as 'STOCK' | 'OPTION')}
                    className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
                  >
                    <option value="STOCK">STOCK</option>
                    <option value="OPTION">OPTION</option>
                  </select>
                  <input
                    type="text"
                    value={newLinkedIdeaId}
                    onChange={(event) => setNewLinkedIdeaId(event.target.value)}
                    placeholder="Linked idea UUID (optional)"
                    className="h-9 rounded-md border border-input bg-background px-2.5 font-mono text-xs outline-none focus:border-ring"
                  />
                  {newInstrumentType === 'OPTION' && (
                    <>
                      <select
                        value={newOptionType}
                        onChange={(event) => setNewOptionType(event.target.value as 'CALL' | 'PUT')}
                        className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
                      >
                        <option value="CALL">CALL</option>
                        <option value="PUT">PUT</option>
                      </select>
                      <input
                        type="date"
                        value={newOptionExpiry}
                        onChange={(event) => setNewOptionExpiry(event.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
                      />
                      <input
                        type="text"
                        value={newOptionStrike}
                        onChange={(event) => setNewOptionStrike(event.target.value)}
                        placeholder="Strike price"
                        className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring md:col-span-2"
                      />
                    </>
                  )}
                  <textarea
                    value={newPositionNotes}
                    onChange={(event) => setNewPositionNotes(event.target.value)}
                    placeholder="Initial notes (optional)"
                    className="min-h-[90px] rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-ring md:col-span-2"
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={workspaceBusy}
                    onClick={() => {
                      void onCreateManualPosition({
                        title: newPositionTitle,
                        status: newPositionStatus,
                        instrumentType: newInstrumentType,
                        optionType: newInstrumentType === 'OPTION' ? newOptionType : null,
                        optionExpireDate: newInstrumentType === 'OPTION' ? newOptionExpiry : null,
                        optionExercisePrice: newInstrumentType === 'OPTION' ? newOptionStrike : null,
                        linkedIdeaId: newLinkedIdeaId || null,
                        notes: newPositionNotes || '',
                      }).then(() => {
                        setNewPositionTitle('')
                        setNewPositionStatus('planned')
                        setNewInstrumentType('STOCK')
                        setNewOptionType('CALL')
                        setNewOptionExpiry('')
                        setNewOptionStrike('')
                        setNewLinkedIdeaId('')
                        setNewPositionNotes('')
                      })
                    }}
                  >
                    Add Position
                  </Button>
                </div>
              </div>

              <p className="rounded-xl border border-border/60 bg-muted/15 px-3 py-2 text-sm text-muted-foreground">
                {positionDetailError
                  ? `Detail load warning: ${positionDetailError}`
                  : (positionDetailLoading
                    ? 'Loading selected row details...'
                    : 'Click a position row (or its details icon) to open the shared details panel with note, description, comments, and tags.')}
              </p>

              <FileSelectionViewerBlock
                heading="ValueLine PDF Report"
                summary="Keep your core external research report for this company here."
                selectedPath={selectedCompanyPdfPath || null}
                selectedLabel={selectedCompanyPdfLabel}
                emptySelectionMessage="No PDF report selected."
                options={pdfOptions}
                query={companyPdfQuery}
                onQueryChange={setCompanyPdfQuery}
                pickerOpen={companyPdfPickerOpen}
                onPickerOpenChange={setCompanyPdfPickerOpen}
                controlsHidden={companyPdfControlsHidden}
                onControlsHiddenChange={setCompanyPdfControlsHidden}
                onSelectPath={(path) => { void selectCompanyPdfPath(path ?? '') }}
                onOpenPath={onOpenNodeFile}
                disabled={workspaceBusy}
                selectButtonLabel="Select PDF"
                searchPlaceholder="Search PDF report"
                searchEmptyMessage="No PDF files found"
                allowCustomValue
                hideDetailsWithSelectionControls
                searchHelperText="Select a PDF report file to view it inline."
                emptyViewerMessage="Select a PDF report to display it here."
                renderSelectedContent={() => (
                  <div className="h-[820px] overflow-hidden rounded-lg border">
                    <PdfDocumentBlock
                      key={`${selectedCompanyPdfPath}::${companyPdfViewerNonce}`}
                      path={selectedCompanyPdfPath}
                      className="h-full"
                    />
                  </div>
                )}
              />
            </>
          ) : overallTabActive ? (
            <div className="rounded-2xl border p-5">
              <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
                {backlogLayoutEditMode && (
                  <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showArchivedByDefault}
                      onChange={toggleShowArchivedByDefault}
                      className="h-3.5 w-3.5"
                    />
                    Show archived positions by default
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setBacklogLayoutEditMode(prev => !prev)}
                  className={backlogLayoutEditMode
                    ? 'inline-flex h-8 items-center rounded-md bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90'
                    : 'inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted'}
                >
                  {backlogLayoutEditMode ? 'Done' : 'Edit'}
                </button>
              </div>
              <ScrollableZoomSurfaceBlock
                minWidthClassName={Webull_WIDE_TABLE_MIN_WIDTH_CLASS_BLOCK}
                controlsLabel="Table zoom"
                showFitColumnsToWidthButton
                persistStateKey="webull-table-viewport-fit"
              >
                <BacklogListBlock
                  programs={backlogTableModel.programs}
                  onReorderSiblings={handleReorderBacklogPrograms}
                  resolveProgramOrdinal={resolveBacklogProgramOrdinal}
                  onSetProgramOrdinal={handleSetBacklogProgramOrdinal}
                  renderProgramTitlePrefix={renderProgramTitlePrefix}
                  programLayoutEditMode={backlogLayoutEditMode}
                  onProgramLayoutEditModeChange={setBacklogLayoutEditMode}
                  showProgramLayoutToggle={false}
                  epicBorderClassByProgramUuid={companyBorderClassByProgramUuid}
                  loadEpics={loadBacklogEpics}
                  loadChildren={loadBacklogChildren}
                  selectedNodeId={selectedBacklogNodeId}
                  readOnly
                  allowStatusEditingInReadOnly
                  allowProgramLayoutEditingInReadOnly
                  onSelectNode={onSelectBacklogNode}
                  programGroups={activeProjectProgramGroups}
                  programGroupIdByProgram={activeProjectProgramGroupIdByProgram}
                  onCreateProgramGroup={createActiveProjectCompanyGroup}
                  onDeleteProgramGroup={deleteActiveProjectCompanyGroup}
                  onToggleProgramGroupCollapsed={toggleActiveProjectCompanyGroupCollapsed}
                  onAssignProgramToGroup={assignProgramToActiveProjectCompanyGroup}
                  onOpenNodeDetails={onOpenBacklogNodeDetails}
                  onUpdateNodeStatus={onUpdateBacklogNodeStatus}
                  onUpdateNodeNotes={onUpdateBacklogNodeNotes}
                  relatedNodeOptions={linkOptions}
                  onOpenRelatedNode={handleBacklogOpenRelated}
                  programLabelSingular="company"
                  programLabelPlural="companies"
                  programGroupLabelSingular="company group"
                  projectPresetTagsByRoot={rowProjectPresetTagsByRoot}
                  canOpenNodeDetails={handleBacklogCanOpenDetails}
                  rowColumns={webullRowColumns}
                  showRowColumnsOnCompact
                  rowPresetTagLimit={5}
                  rowPresetTagsClassName="ml-auto w-[18rem] justify-end"
                  reserveTagsSlotWhenEmpty
                  linksColumnLabel="Links"
                  linksColumnWidthClassName="w-[8rem] mx-6"
                  linksColumnAlign="left"
                  linksColumnPaddingClassName="px-0"
                  linksBeforeTags
                  statusRightAligned={false}
                  rowDetailsRenderer={renderWebullInlineDetails}
                  titleColumnClassName="w-[11rem]"
                  wrapTitleText
                  actionsRightEdge
                  showProgramStatus={false}
                  showProgramCopyButton={false}
                  preferInlineDetailsButton
                  allowInlineNotesInReadOnly
                  showNodeTypeIcons={false}
                  showExpandToggles={false}
                  showPriorityDots={false}
                />
              </ScrollableZoomSurfaceBlock>
            </div>
          ) : null}

          <details className="rounded-xl border bg-background">
            <summary className="cursor-pointer border-b px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Diagnostics
            </summary>
            <div className="space-y-2 p-3 text-xs text-muted-foreground">
              {!liveRefreshAvailable && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                  Live Webull refresh is available only in the Electron app. This runtime shows saved Webull data from your last Electron refresh.
                </div>
              )}
              {liveRefreshAvailable && !hasConfig && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/20 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Missing Webull credentials. Open Settings {'>'} Webull and save your Webull app key + app secret to secure device storage.
                </div>
              )}
              <p><span className="font-medium text-foreground">Runtime:</span> {formatRuntimeLabelBlock(runtime)}</p>
              <p><span className="font-medium text-foreground">Fetched:</span> {formatFetchedTimestampBlock(fetchedAt)}</p>
              <p><span className="font-medium text-foreground">Fetched Runtime:</span> {formatRuntimeLabelBlock(lastRefreshRuntime)}</p>
              <p><span className="font-medium text-foreground">Execution Root:</span> {executionRoot ?? 'Not configured'}</p>
              <p><span className="font-medium text-foreground">Execution Companies:</span> {executionCompanyCount}</p>
              <p><span className="font-medium text-foreground">Execution Positions:</span> {executionPositionCount}</p>
              <p><span className="font-medium text-foreground">Execution Source:</span> {executionSyncSource}</p>
              <p><span className="font-medium text-foreground">Account Count:</span> {accounts.length || (selectedAccount ? 1 : 0)}</p>
              {accountLabelEntries.length > 0 ? (
                <div className="space-y-1">
                  {accountLabelEntries.map((entry) => (
                    <p key={entry.accountId ?? entry.accountNumber ?? entry.label}>
                      <span className="font-medium text-foreground">{entry.label}:</span>{' '}
                      {entry.accountNumber ?? entry.accountId ?? 'Unknown'}
                      {entry.accountId && entry.accountNumber ? ` · ${entry.accountId}` : ''}
                    </p>
                  ))}
                </div>
              ) : (
                <>
                  <p><span className="font-medium text-foreground">Account Id:</span> {selectedAccount?.accountId ?? 'Not available'}</p>
                  <p><span className="font-medium text-foreground">Account Number:</span> {selectedAccount?.accountNumber ?? 'Not available'}</p>
                </>
              )}
              <p><span className="font-medium text-foreground">Endpoint Account list:</span> {endpoints.accountList ?? 'Not requested'}</p>
              <p><span className="font-medium text-foreground">Endpoint Legacy balance:</span> {endpoints.accountBalanceLegacy ?? 'Not requested'}</p>
              <p><span className="font-medium text-foreground">Endpoint Legacy positions:</span> {endpoints.accountPositionsLegacy ?? 'Not requested'}</p>
              <p><span className="font-medium text-foreground">Endpoint OpenAPI positions:</span> {endpoints.assetsPositions ?? 'Not requested'}</p>
              {attempts.length > 0 && (
                <pre className="max-h-48 overflow-auto rounded border p-2 text-xs leading-5">{attempts.join('\n')}</pre>
              )}
              <details>
                <summary className="cursor-pointer">Raw account positions payloads</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded border p-2 text-xs leading-5">{toJsonBlock({
                  accountPositionsLegacy,
                  assetsPositions,
                })}</pre>
              </details>
            </div>
          </details>
        </CardContent>
      </Card>

      {detailPanelNode && (
        <NodeDetailPanelBlock
          node={detailPanelNode}
          frontmatter={detailPanelFrontmatter}
          onClose={() => setDetailPanelNodeId(null)}
          onRename={async (newTitle) => {
            if (!detailPanelPositionRef) return
            await onUpdatePositionOverlay({
              fileName: detailPanelPositionRef.fileName,
              title: newTitle,
            })
          }}
          onUpdateStatus={async (status) => {
            if (!detailPanelPositionRef) return
            await onUpdatePositionOverlay({
              fileName: detailPanelPositionRef.fileName,
              status: mapNodeStatusToPositionStatusBlock(status as NodeStatus),
            })
          }}
          onUpdateTaskStatus={async () => {}}
          onUpdatePriority={async (priority) => {
            if (!detailPanelPositionRef) return
            await onUpdatePositionOverlay({
              fileName: detailPanelPositionRef.fileName,
              priority: normalizePriorityFromUnknownBlock(priority),
            })
          }}
          onUpdateTags={async (tags) => {
            if (!detailPanelPositionRef) return
            await onUpdatePositionOverlay({
              fileName: detailPanelPositionRef.fileName,
              tags,
            })
          }}
          onUpdateProjectPresetTags={async (tags) => {
            if (!detailPanelPositionRef) return
            updateProjectPresetTags(projectRootKey, [...availableProjectPresetTags, ...tags])
            await onUpdatePositionOverlay({
              fileName: detailPanelPositionRef.fileName,
              projectPresetTags: tags,
            })
          }}
          presetTags={detailPanelPresetTags}
          relatedNodeOptions={linkOptions}
          onUpdateRelatedNodes={detailPanelNode
            ? async (relatedNodes) => { await onUpdateBacklogNodeRelatedNodes(detailPanelNode, relatedNodes) }
            : undefined}
          onOpenRelatedNode={(path) => onOpenNodeFile(path)}
          onUpdateNotes={async (description, comments) => {
            if (!detailPanelPositionRef) return
            await onUpdatePositionOverlay({
              fileName: detailPanelPositionRef.fileName,
              description,
              comments,
            })
          }}
          noteBody={detailPanelPositionDetail?.body ?? ''}
          onUpdateNoteBody={detailPanelPositionDetail
            ? async (body) => { await onSavePositionBody(body) }
            : undefined}
          noteBodyLabel="Position Note"
          noteBodyPlaceholder="Add the position thesis, updates, and execution notes..."
          onOpenFile={() => onOpenNodeFile(detailPanelNode.filePath)}
        />
      )}
      </div>
      )}
    </div>
  )
}
