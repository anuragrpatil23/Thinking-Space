import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import BacklogListBlock from '@/components/lego_blocks/integrations/BacklogListBlock'
import FileSelectionViewerBlock from '@/components/lego_blocks/integrations/FileSelectionViewerBlock'
import MarkdownDocumentBlock from '@/components/lego_blocks/integrations/MarkdownDocumentBlock'
import NodeDetailPanelBlock from '@/components/lego_blocks/integrations/NodeDetailPanelBlock'
import PdfDocumentBlock from '@/components/lego_blocks/integrations/PdfDocumentBlock'
import ProjectMemoryFilesBlock from '@/components/lego_blocks/integrations/ProjectMemoryFilesBlock'
import ScrollableZoomSurfaceBlock from '@/components/lego_blocks/integrations/ScrollableZoomSurfaceBlock'
import { TagDisclosureButtonBlock, TagListEditorBlock } from '@/components/lego_blocks/integrations/TagManagerBlock'
import type { BacklogRowColumnBlock } from '@/components/lego_blocks/units/BacklogRowColumnsBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { cn } from '@/lib/utils'
import { getAllNodes, type NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import {
  STORAGE_KEYS,
  getJsonStorageItem,
  getStorageItem,
  setJsonStorageItem,
  setStorageItem,
} from '@/services/orchestrators/storageOrch'
import { readOrganizerUiStateOrch, writeOrganizerUiStateOrch } from '@/services/orchestrators/organizerUiStateOrch'
import {
  normalizeOrganizerUiStateBlock,
  type OrganizerProgramGroupEntryBlock,
} from '@/services/lego_blocks/integrations/organizerUiStateBlock'
import { normalizeTagBlock, normalizeTagListBlock, splitTagInputBlock, tagsEqualBlock } from '@/services/lego_blocks/units/tagBlock'
import type { NodePriority, NodeStatus, YAMLCommentEntry, YAMLFrontmatter } from '@/services/lego_blocks/units/yamlNoteBlock'
import { listMarkdownEntries, listPdfFiles } from '@/services/orchestrators/fileSystemOrch'
import type { F9RuntimeSurfaceOrch, F9SelectedAccountOrch } from '@/personal_extension/services/orchestrators/f9OverallOrch'
import type {
  F9CompanyOverviewBlock,
  F9ExecutionOverviewBlock,
  F9PositionDetailBlock,
  F9PositionSummaryBlock,
} from '@/personal_extension/services/orchestrators/f9ExecutionOrch'

interface F9SubtabBlock {
  id: 'overall' | 'memory'
  label: string
}

interface F9LinkOptionBlock {
  path: string
  label: string
  summary?: string
}

interface F9PdfOptionBlock {
  path: string
  label: string
}

interface F9WorkspaceBlockProps {
  subtabs: F9SubtabBlock[]
  activeSubtabId: 'overall' | 'memory'
  onSelectSubtab: (id: 'overall' | 'memory') => void
  hasConfig: boolean
  liveRefreshAvailable: boolean
  error: string | null
  runtime: F9RuntimeSurfaceOrch | null
  lastRefreshRuntime: F9RuntimeSurfaceOrch | null
  fetchedAt: string | null
  endpoints: {
    accountList: string | null
    accountBalanceLegacy: string | null
    accountPositionsLegacy: string | null
    assetsAccount: string | null
    assetsPositions: string | null
    marketQuotes: string | null
  }
  selectedAccount: F9SelectedAccountOrch | null
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
  executionOverview: F9ExecutionOverviewBlock | null
  activeCompanyTicker: string | null
  onSelectCompanyTicker: (companyTicker: string | null) => void
  activePositionFileName: string | null
  onSelectPositionFileName: (fileName: string) => void
  activePositionDetail: F9PositionDetailBlock | null
  positionDetailLoading: boolean
  positionDetailError: string | null
  workspaceBusy: boolean
  workspaceMessage: string | null
  onCreateCompany: (companyTicker: string) => Promise<void>
  onCreateManualPosition: (input: {
    title?: string
    status?: 'taken' | 'planned' | 'watchlist'
    instrumentType?: 'STOCK' | 'OPTION'
    optionType?: 'CALL' | 'PUT' | null
    optionExpireDate?: string | null
    optionExercisePrice?: string | null
    linkedIdeaId?: string | null
    notes?: string
  }) => Promise<void>
  onUpdatePositionOverlay: (input: {
    fileName?: string
    status?: 'taken' | 'planned' | 'watchlist'
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

const F9_WIDE_TABLE_MIN_WIDTH_CLASS_BLOCK = 'min-w-[1360px]'
const LEGACY_F9_SIDE_TABS_COLLAPSED_STORAGE_KEY_BLOCK = 'f9_workspace_side_tabs_collapsed'
type F9ProjectPresetTagsByRootBlock = Record<string, string[]>
type F9ProjectProgramGroupsByRootBlock = Record<string, OrganizerProgramGroupEntryBlock[]>
type F9ProjectMemoryFilesByRootBlock = Record<string, {
  quotesPath: string | null
  rememberPath: string | null
}>
type F9OverallRememberByProjectRootBlock = Record<string, string>

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

function formatRuntimeLabelBlock(value: F9RuntimeSurfaceOrch | null): string {
  if (value === 'electron') return 'Electron'
  if (value === 'capacitor') return 'Capacitor'
  if (value === 'web') return 'Web'
  return 'Unknown'
}

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

function formatOverallValueBlock(balanceData: unknown): string {
  if (!balanceData || typeof balanceData !== 'object') return '—'
  const row = balanceData as Record<string, unknown>
  const currencyAssets = Array.isArray(row.account_currency_assets)
    ? row.account_currency_assets.find(item => !!item && typeof item === 'object') as Record<string, unknown> | undefined
    : undefined
  const value = firstNumberBlock(
    row.total_market_value,
    row.totalMarketValue,
    currencyAssets?.net_liquidation_value,
    currencyAssets?.positions_market_value,
    row.total_asset,
    row.total_assets,
    row.total_value,
    row.totalValue,
    row.net_liquidation_value,
    row.netLiquidationValue,
  )
  return formatCurrencyBlock(value)
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
  const normalized = (status ?? '').trim().toLowerCase()
  if (normalized === 'taken' || normalized === 'planned' || normalized === 'watchlist') {
    return normalized
  }
  if (normalized === 'active' || normalized === 'completed') return 'taken'
  if (normalized === 'paused') return 'watchlist'
  if (normalized === 'incomplete') return 'planned'
  if (normalized === 'cancelled') return 'cancelled'
  if (normalized === 'archived') return 'archived'
  return 'taken'
}

function mapNodeStatusToPositionStatusBlock(status: NodeStatus): 'taken' | 'planned' | 'watchlist' {
  if (status === 'watchlist' || status === 'planned' || status === 'taken') return status
  if (status === 'paused' || status === 'cancelled' || status === 'archived') return 'watchlist'
  if (status === 'incomplete') return 'planned'
  return 'taken'
}

function normalizePositionStatusBlock(status: string | null | undefined): 'taken' | 'planned' | 'watchlist' {
  const normalized = (status ?? '').trim().toLowerCase()
  if (normalized === 'planned' || normalized === 'watchlist' || normalized === 'taken') return normalized
  return 'taken'
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

function positionTitleFromSummaryBlock(position: F9PositionSummaryBlock): string {
  const symbol = firstStringBlock(position.symbol) || 'UNKNOWN'
  const optionType = firstStringBlock(position.optionType).toUpperCase()
  const optionExpireDate = firstStringBlock(position.optionExpireDate)
  const optionStrike = normalizeStrikeForDisplayBlock(position.optionExercisePrice)
  if (optionType && optionExpireDate && optionStrike) {
    return `${symbol}${optionStrike}-${optionExpireDate}-${optionType}`
  }
  const instrumentType = firstStringBlock(position.instrumentType).toUpperCase()
  if (instrumentType === 'STOCK') {
    return `${symbol}STOCK`
  }
  const fromFileName = firstStringBlock(position.fileName)
  if (fromFileName.toLowerCase().endsWith('.md')) return fromFileName.slice(0, -3)
  return symbol
}

function compareF9PositionsAscendingBlock(a: F9PositionSummaryBlock, b: F9PositionSummaryBlock): number {
  const byTitle = positionTitleFromSummaryBlock(a).localeCompare(
    positionTitleFromSummaryBlock(b),
    undefined,
    { numeric: true, sensitivity: 'base' },
  )
  if (byTitle !== 0) return byTitle
  return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' })
}

function sortF9PositionsAscendingBlock(positions: F9PositionSummaryBlock[]): F9PositionSummaryBlock[] {
  return [...positions].sort(compareF9PositionsAscendingBlock)
}

function buildFallbackCompaniesFromOverallRowsBlock(rows: Array<Record<string, unknown>>): F9CompanyOverviewBlock[] {
  const grouped = new Map<string, F9PositionSummaryBlock[]>()
  for (const row of rows) {
    const ticker = firstStringBlock(row.symbol, row.ticker, row.position_symbol, row.stock_code).toUpperCase()
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
      instrumentType: firstStringBlock(row.instrument_type, row.type) || null,
      optionType: firstStringBlock(row.option_type) || null,
      optionExpireDate: firstStringBlock(row.option_expire_date) || null,
      optionExercisePrice: firstStringBlock(row.option_exercise_price) || null,
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
      positions: sortF9PositionsAscendingBlock(positions),
    }))
}

function toOverallPositionTitleBlock(row: Record<string, unknown>): string {
  const symbol = firstStringBlock(row.symbol, row.ticker, row.position_symbol, row.stock_code) || 'UNKNOWN'
  const optionType = firstStringBlock(row.option_type).toUpperCase()
  const optionExpireDate = firstStringBlock(row.option_expire_date)
  const optionStrike = firstStringBlock(row.option_exercise_price)
  if (optionType && optionExpireDate && optionStrike) {
    return `${symbol} ${optionStrike} ${optionExpireDate} ${optionType}`
  }
  return symbol
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

function resolveUnitCostBlock(payload: Record<string, unknown> | null | undefined): number | null {
  return readNumberFromRecordBlock(payload, 'cost', 'unit_cost', 'avg_cost', 'average_cost', 'cost_price')
}

function resolveTotalCostBlock(payload: Record<string, unknown> | null | undefined): number | null {
  const unitCost = resolveUnitCostBlock(payload)
  if (unitCost === null) return null
  const quantity = readNumberFromRecordBlock(payload, 'quantity', 'qty', 'position', 'position_size', 'held', 'amount')
  const multiplier = readNumberFromRecordBlock(payload, 'option_contract_multiplier') ?? 1
  if (quantity === null || quantity <= 0) return unitCost
  return unitCost * quantity * multiplier
}

function resolveUnrealizedProfitLossBlock(payload: Record<string, unknown> | null | undefined): number | null {
  return readNumberFromRecordBlock(payload, 'unrealized_profit_loss', 'unrealizedProfitLoss', 'upl')
}

function positionPayloadFromSummaryBlock(position: F9PositionSummaryBlock): Record<string, unknown> {
  return {
    id: position.id,
    file_name: position.fileName,
    symbol: position.symbol,
    status: position.status,
    source: position.source,
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

function computeCompanyTotalsBlock(positions: F9PositionSummaryBlock[]): {
  totalCost: number | null
  avgUnitCost: number | null
  totalUnrealizedProfitLoss: number | null
  totalCurrentPrice: number | null
} {
  let totalCost = 0
  let totalCostCount = 0
  let totalUnitCost = 0
  let unitCostCount = 0
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
    const unitCostValue = resolveUnitCostBlock(payload)
    if (unitCostValue !== null) {
      totalUnitCost += unitCostValue
      unitCostCount += 1
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
    avgUnitCost: unitCostCount > 0 ? totalUnitCost / unitCostCount : null,
    totalUnrealizedProfitLoss: unrealizedCount > 0 ? totalUnrealized : null,
    totalCurrentPrice: currentPriceCount > 0 ? totalCurrentPrice : null,
  }
}

function isOptionPositionBlock(position: F9PositionSummaryBlock): boolean {
  const instrumentType = firstStringBlock(position.instrumentType).toUpperCase()
  if (instrumentType === 'OPTION') return true
  if (instrumentType === 'STOCK') return false
  return Boolean(firstStringBlock(position.optionType) || firstStringBlock(position.optionExpireDate))
}

function percentOfBlock(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total === 0) return null
  return (part / total) * 100
}

function computeCompanySummaryMetricsBlock(positions: F9PositionSummaryBlock[]): {
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

export default function F9WorkspaceBlock({
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
  workspaceBusy,
  workspaceMessage,
  onCreateCompany,
  onCreateManualPosition,
  onUpdatePositionOverlay,
  onUpdateCompanyOverlay,
  onSavePositionBody,
  onOpenNodeFile,
}: F9WorkspaceBlockProps) {
  const allWarnings = [...warnings, ...executionSyncWarnings]
  const overallRows = asRecordArrayBlock(assetsPositions).length > 0
    ? asRecordArrayBlock(assetsPositions)
    : asRecordArrayBlock(accountPositionsLegacy)
  const [preserveOverallContext, setPreserveOverallContext] = useState(false)
  const [sideTabsCollapsed, setSideTabsCollapsed] = useState(() => {
    const scoped = getStorageItem(STORAGE_KEYS.f9WorkspaceSideTabsCollapsed)
    if (scoped === '1') return true
    if (scoped === '0') return false
    if (typeof window === 'undefined') return false
    try {
      const legacy = window.localStorage.getItem(LEGACY_F9_SIDE_TABS_COLLAPSED_STORAGE_KEY_BLOCK)
      if (legacy !== '1' && legacy !== '0') return false
      setStorageItem(STORAGE_KEYS.f9WorkspaceSideTabsCollapsed, legacy)
      window.localStorage.removeItem(LEGACY_F9_SIDE_TABS_COLLAPSED_STORAGE_KEY_BLOCK)
      return legacy === '1'
    } catch {
      return false
    }
  })
  const projectRootKey = normalizeRelativePathBlock(executionRoot ?? 'f9-execution') || 'f9-execution'

  useEffect(() => {
    setStorageItem(STORAGE_KEYS.f9WorkspaceSideTabsCollapsed, sideTabsCollapsed ? '1' : '0')
  }, [sideTabsCollapsed])

  const selectedCompany = useMemo(
    () => executionOverview?.companies.find((company) => company.companyTicker === activeCompanyTicker) ?? null,
    [activeCompanyTicker, executionOverview],
  )
  const showCompanyView = !!selectedCompany && !preserveOverallContext
  const selectedCompanyMetrics = useMemo(
    () => (selectedCompany ? computeCompanySummaryMetricsBlock(selectedCompany.positions) : null),
    [selectedCompany],
  )
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

  const companiesForTable = useMemo<F9CompanyOverviewBlock[]>(() => {
    const sourceCompanies = (() => {
      if (showCompanyView && selectedCompany) return [selectedCompany]
      if ((executionOverview?.companies.length ?? 0) > 0) return executionOverview?.companies ?? []
      return buildFallbackCompaniesFromOverallRowsBlock(overallRows)
    })()
    return sourceCompanies.map(company => ({
      ...company,
      positions: sortF9PositionsAscendingBlock(company.positions),
    }))
  }, [executionOverview?.companies, overallRows, selectedCompany, showCompanyView])

  const backlogTableModel = useMemo(() => {
    const now = new Date().toISOString()
    const programs: NodeRecord[] = []
    const nodeByUuid = new Map<string, NodeRecord>()
    const positionNodesByProgramUuid = new Map<string, NodeRecord[]>()
    const companyTickerByProgramUuid = new Map<string, string>()
    const positionRefByNodeUuid = new Map<string, { companyTicker: string; fileName: string }>()
    const nodeUuidByCompanyAndFile = new Map<string, string>()

    for (const company of companiesForTable) {
      const companyTicker = company.companyTicker.toUpperCase()
      const programUuid = `f9-company-${normalizeKeyFragmentBlock(companyTicker)}`
      const companyTotals = computeCompanyTotalsBlock(company.positions)
      companyTickerByProgramUuid.set(programUuid, companyTicker)
      const programNode: NodeRecord = {
        uuid: programUuid,
        key: programUuid,
        title: `${companyTicker} Positions`,
        type: 'program',
        level: 0,
        filePath: company.indexFilePath || `f9/${companyTicker}/${companyTicker}-index.md`,
        projectRoot: executionRoot ?? 'f9-execution',
        tags: ['f9', 'execution', companyTicker.toLowerCase()],
        status: 'active',
        createdAt: now,
        updatedAt: now,
        metadata: {
          f9_company_ticker: companyTicker,
          f9_position_count: company.positions.length,
          f9_total_cost: companyTotals.totalCost,
          f9_avg_unit_cost: companyTotals.avgUnitCost,
          f9_total_unrealized_profit_loss: companyTotals.totalUnrealizedProfitLoss,
          f9_total_current_price: companyTotals.totalCurrentPrice,
          program_group: company.programGroupId,
        },
      }
      programs.push(programNode)
      nodeByUuid.set(programUuid, programNode)

      const nodes = company.positions.map((position, index) => {
        const positionStatus = normalizePositionStatusBlock(position.status)
        const fileName = position.fileName
        const nodeUuid = `f9-pos-${normalizeKeyFragmentBlock(companyTicker)}-${normalizeKeyFragmentBlock(fileName)}`
        const positionProjectPresetTags = normalizeTagListBlock(position.projectPresetTags ?? [])
        const positionRelatedNodes = (position.relatedNodes ?? [])
          .map(path => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
        const positionTags = normalizeTagListBlock([
          'f9',
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
          parent: programUuid,
          parentUuid: programUuid,
          parentType: 'program',
          filePath: executionRoot
            ? `${executionRoot}/${companyTicker}/positions/${fileName}`
            : `f9/${companyTicker}/positions/${fileName}`,
          projectRoot: executionRoot ?? 'f9-execution',
          description: undefined,
          tags: positionTags,
          projectPresetTags: positionProjectPresetTags,
          relatedNodes: positionRelatedNodes,
          status: mapPositionStatusToNodeStatusBlock(positionStatus),
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
          metadata: {
            f9_company_ticker: companyTicker,
            f9_position_file_name: fileName,
            f9_position_status: positionStatus,
            f9_linked_idea_id: position.linkedIdeaId ?? '',
            f9_position_payload: positionPayloadFromSummaryBlock(position),
          },
        }
        nodeByUuid.set(nodeUuid, nodeRecord)
        return nodeRecord
      })

      positionNodesByProgramUuid.set(programUuid, nodes)
    }

    return {
      programs,
      nodeByUuid,
      positionNodesByProgramUuid,
      companyTickerByProgramUuid,
      positionRefByNodeUuid,
      nodeUuidByCompanyAndFile,
    }
  }, [companiesForTable, executionRoot])

  const [detailPanelNodeId, setDetailPanelNodeId] = useState<string | null>(null)
  const [projectPresetTagsByRoot, setProjectPresetTagsByRoot] = useState<F9ProjectPresetTagsByRootBlock>(
    () => getJsonStorageItem<F9ProjectPresetTagsByRootBlock>(STORAGE_KEYS.f9ProjectPresetTags, {}),
  )
  const [projectProgramGroupsByRoot, setProjectProgramGroupsByRoot] = useState<F9ProjectProgramGroupsByRootBlock>(
    () => getJsonStorageItem<F9ProjectProgramGroupsByRootBlock>(STORAGE_KEYS.thinkingOrganizerProjectProgramGroups, {}),
  )
  const [projectMemoryFilesByRoot, setProjectMemoryFilesByRoot] = useState<F9ProjectMemoryFilesByRootBlock>({})
  const [overallRememberByProjectRoot, setOverallRememberByProjectRoot] = useState<F9OverallRememberByProjectRootBlock>(
    () => getJsonStorageItem<F9OverallRememberByProjectRootBlock>(STORAGE_KEYS.f9OverallRememberByProjectRoot, {}),
  )
  const projectMemoryHydratedRootsRef = useRef<Set<string>>(new Set())
  const [linkOptions, setLinkOptions] = useState<F9LinkOptionBlock[]>([])
  const [pdfOptions, setPdfOptions] = useState<F9PdfOptionBlock[]>([])
  const [companyFilePickerOpen, setCompanyFilePickerOpen] = useState(false)
  const [companyFileQuery, setCompanyFileQuery] = useState('')
  const [companyFileViewerNonce, setCompanyFileViewerNonce] = useState(0)
  const [companyFileControlsHidden, setCompanyFileControlsHidden] = useState(false)
  const [companyPdfPickerOpen, setCompanyPdfPickerOpen] = useState(false)
  const [companyPdfQuery, setCompanyPdfQuery] = useState('')
  const [companyPdfViewerNonce, setCompanyPdfViewerNonce] = useState(0)
  const [companyPdfControlsHidden, setCompanyPdfControlsHidden] = useState(false)
  const [overallRememberPickerOpen, setOverallRememberPickerOpen] = useState(false)
  const [overallRememberQuery, setOverallRememberQuery] = useState('')
  const [overallRememberViewerNonce, setOverallRememberViewerNonce] = useState(0)
  const [overallRememberControlsHidden, setOverallRememberControlsHidden] = useState(false)

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
          const options: F9LinkOptionBlock[] = []
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
              } satisfies F9PdfOptionBlock
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

  const f9RowColumns = useMemo<BacklogRowColumnBlock[]>(() => {
    return [
      {
        id: 'cost',
        label: 'Cost',
        widthClassName: 'w-24',
        align: 'right',
        render: (node) => {
          const metadata = asMetadataRecordBlock(node)
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.f9_total_cost)
          const payload = metadata.f9_position_payload as Record<string, unknown> | undefined
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
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.f9_avg_unit_cost)
          const payload = metadata.f9_position_payload as Record<string, unknown> | undefined
          return formatCurrencyBlock(resolveUnitCostBlock(payload))
        },
      },
      {
        id: 'upl',
        label: 'Current P/L',
        widthClassName: 'w-24',
        align: 'right',
        render: (node) => {
          const metadata = asMetadataRecordBlock(node)
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.f9_total_unrealized_profit_loss)
          const payload = metadata.f9_position_payload as Record<string, unknown> | undefined
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
          if (node.type === 'program') return formatCurrencyFromUnknownBlock(metadata.f9_total_current_price)
          const payload = metadata.f9_position_payload as Record<string, unknown> | undefined
          return formatCurrencyFromUnknownBlock(payload?.last_price)
        },
      },
    ]
  }, [])

  const linkOptionsByPath = useMemo(() => {
    const map = new Map<string, F9LinkOptionBlock>()
    for (const option of linkOptions) {
      const normalizedPath = normalizeRelativePathBlock(option.path)
      if (!normalizedPath || map.has(normalizedPath)) continue
      map.set(normalizedPath, option)
    }
    return map
  }, [linkOptions])

  const renderF9InlineDetails = useCallback((node: NodeRecord) => {
    if (node.type !== 'epic') return null
    const metadata = asMetadataRecordBlock(node)
    const payload = metadata.f9_position_payload as Record<string, unknown> | undefined
    const metadataWithoutPayload = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => key !== 'f9_position_payload'),
    ) as Record<string, unknown>
    const metadataEntries = metadataEntriesFromRecordBlock(metadataWithoutPayload)
    const payloadEntries = metadataEntriesFromRecordBlock(payload)
    const status = normalizePositionStatusBlock(firstStringBlock(metadata.f9_position_status, payload?.status))
    const instrumentType = firstStringBlock(payload?.instrument_type, payload?.type) || '—'
    const linkedIdeaId = firstStringBlock(metadata.f9_linked_idea_id, payload?.linked_idea_id)
    const tags = normalizeTagListBlock(node.tags ?? []).filter(tag => tag !== 'f9' && tag !== 'execution')
    const relatedNodePaths = (node.relatedNodes ?? asStringArrayBlock(payload?.related_nodes))
      .map(path => normalizeRelativePathBlock(path))
      .filter(Boolean)

    return (
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Status:</span> {status}
          {' · '}
          <span className="font-medium text-foreground">Type:</span> {instrumentType}
        </p>
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
                    className="text-blue-700 hover:underline"
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
  }, [linkOptionsByPath, onOpenNodeFile])

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
      const next: F9ProjectPresetTagsByRootBlock = { ...prev }
      if (normalizedTags.length > 0) next[normalizedRoot] = normalizedTags
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.f9ProjectPresetTags, next)
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
  const [newPositionStatus, setNewPositionStatus] = useState<'taken' | 'planned' | 'watchlist'>('planned')
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

  useEffect(() => {
    const normalizedRoot = normalizeRelativePathBlock(projectRootKey)
    if (!normalizedRoot) return
    if (projectMemoryHydratedRootsRef.current.has(normalizedRoot)) return

    let cancelled = false
    void (async () => {
      try {
        const state = await readOrganizerUiStateOrch(normalizedRoot)
        if (cancelled) return
        const quotesPath = normalizeRelativePathBlock(state?.projectQuotesPath ?? '') || null
        const rememberPath = normalizeRelativePathBlock(state?.projectRememberPath ?? '') || null
        setProjectMemoryFilesByRoot((prev) => {
          const next: F9ProjectMemoryFilesByRootBlock = { ...prev }
          if (quotesPath || rememberPath) next[normalizedRoot] = { quotesPath, rememberPath }
          else delete next[normalizedRoot]
          return next
        })
      } catch {
        // Ignore read failures and fallback to empty selections for this root.
      } finally {
        projectMemoryHydratedRootsRef.current.add(normalizedRoot)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectRootKey])

  const activeProjectMemoryFiles = useMemo(() => {
    const normalizedRoot = normalizeRelativePathBlock(projectRootKey)
    if (!normalizedRoot) return { quotesPath: null, rememberPath: null }
    return projectMemoryFilesByRoot[normalizedRoot] ?? { quotesPath: null, rememberPath: null }
  }, [projectMemoryFilesByRoot, projectRootKey])

  const updateActiveProjectMemoryFiles = useCallback(async (updates: {
    quotesPath?: string | null
    rememberPath?: string | null
  }) => {
    const normalizedRoot = normalizeRelativePathBlock(projectRootKey)
    if (!normalizedRoot) return

    const current = projectMemoryFilesByRoot[normalizedRoot] ?? { quotesPath: null, rememberPath: null }
    const next = {
      quotesPath: updates.quotesPath !== undefined
        ? (normalizeRelativePathBlock(updates.quotesPath ?? '') || null)
        : current.quotesPath,
      rememberPath: updates.rememberPath !== undefined
        ? (normalizeRelativePathBlock(updates.rememberPath ?? '') || null)
        : current.rememberPath,
    }

    setProjectMemoryFilesByRoot((prev) => {
      const draft: F9ProjectMemoryFilesByRootBlock = { ...prev }
      if (next.quotesPath || next.rememberPath) draft[normalizedRoot] = next
      else delete draft[normalizedRoot]
      return draft
    })

    try {
      const stateFromVault = await readOrganizerUiStateOrch(normalizedRoot)
      const baseState = normalizeOrganizerUiStateBlock(stateFromVault ?? {})
      const persisted = await writeOrganizerUiStateOrch(normalizedRoot, {
        ...baseState,
        updatedAt: new Date().toISOString(),
        projectQuotesPath: next.quotesPath || undefined,
        projectRememberPath: next.rememberPath || undefined,
      })
      const persistedQuotesPath = normalizeRelativePathBlock(persisted.projectQuotesPath ?? '') || null
      const persistedRememberPath = normalizeRelativePathBlock(persisted.projectRememberPath ?? '') || null
      setProjectMemoryFilesByRoot((prev) => {
        const draft: F9ProjectMemoryFilesByRootBlock = { ...prev }
        if (persistedQuotesPath || persistedRememberPath) {
          draft[normalizedRoot] = {
            quotesPath: persistedQuotesPath,
            rememberPath: persistedRememberPath,
          }
        } else {
          delete draft[normalizedRoot]
        }
        return draft
      })
      projectMemoryHydratedRootsRef.current.add(normalizedRoot)
    } catch {
      // Leave local view state as-is even if persistence fails.
    }
  }, [projectMemoryFilesByRoot, projectRootKey])

  const updateActiveOverallRememberPath = useCallback((path: string | null) => {
    const normalizedRoot = normalizeRelativePathBlock(projectRootKey)
    if (!normalizedRoot) return
    const normalizedPath = normalizeRelativePathBlock(path ?? '')

    setOverallRememberByProjectRoot((prev) => {
      const current = normalizeRelativePathBlock(prev[normalizedRoot] ?? '')
      if (current === normalizedPath) return prev
      const next: F9OverallRememberByProjectRootBlock = { ...prev }
      if (normalizedPath) next[normalizedRoot] = normalizedPath
      else delete next[normalizedRoot]
      setJsonStorageItem(STORAGE_KEYS.f9OverallRememberByProjectRoot, next)
      return next
    })
  }, [projectRootKey])

  const companyPortfolioWeight = percentOfBlock(selectedCompanyMetrics?.totalCost ?? null, portfolioTotalCost)
  const stockCostWeight = percentOfBlock(selectedCompanyMetrics?.stockCost ?? null, selectedCompanyMetrics?.totalCost ?? null)
  const optionCostWeight = percentOfBlock(selectedCompanyMetrics?.optionCost ?? null, selectedCompanyMetrics?.totalCost ?? null)
  const stockProfitLossWeight = percentOfBlock(
    selectedCompanyMetrics?.stockProfitLoss ?? null,
    selectedCompanyMetrics?.totalProfitLoss ?? null,
  )
  const optionProfitLossWeight = percentOfBlock(
    selectedCompanyMetrics?.optionProfitLoss ?? null,
    selectedCompanyMetrics?.totalProfitLoss ?? null,
  )
  const selectedCompanyFilePath = normalizeRelativePathBlock(selectedCompany?.valuationNotePath ?? '')
  const selectedCompanyFileLabel = selectedCompanyFilePath
    ? (linkOptionsByPath.get(selectedCompanyFilePath)?.label ?? linkLabelFromPathBlock(selectedCompanyFilePath))
    : ''
  const selectedCompanyPdfPath = normalizeRelativePathBlock(selectedCompany?.companyPdfReportPath ?? '')
  const selectedCompanyPdfLabel = selectedCompanyPdfPath
    ? (pdfOptions.find((option) => option.path === selectedCompanyPdfPath)?.label ?? selectedCompanyPdfPath.split('/').pop() ?? selectedCompanyPdfPath)
    : ''
  const selectedProjectRememberPath = normalizeRelativePathBlock(
    overallRememberByProjectRoot[normalizeRelativePathBlock(projectRootKey)] ?? '',
  )
  const selectedProjectRememberLabel = selectedProjectRememberPath
    ? (linkOptionsByPath.get(selectedProjectRememberPath)?.label ?? linkLabelFromPathBlock(selectedProjectRememberPath))
    : ''
  const memoryTabActive = !showCompanyView && activeSubtabId === 'memory'
  const overallTabActive = !showCompanyView && activeSubtabId === 'overall'
  const workspaceTitle = showCompanyView && selectedCompany
    ? `${selectedCompany.companyTicker} Positions`
    : (memoryTabActive ? 'Quotes + Things To Remember' : 'Overall Positions')
  const workspaceDescription = showCompanyView && selectedCompany
    ? 'Company-specific position rows and overlay edits.'
    : (memoryTabActive
      ? 'Project-level files for quotes and things to remember.'
      : 'Canonical overall positions from Webull sync.')

  return (
    <div className={cn('grid gap-4', sideTabsCollapsed ? 'grid-cols-1' : 'lg:grid-cols-[200px_minmax(0,1fr)]')}>
      {!sideTabsCollapsed && (
        <aside className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border bg-background px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Side Tabs</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSideTabsCollapsed(true)}
              title="Collapse side tabs"
              aria-label="Collapse side tabs"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>

        <div className="space-y-2 rounded-xl border bg-background p-3">
          {subtabs.map((subtab) => {
            const active = activeSubtabId === subtab.id && !showCompanyView
            return (
              <button
                key={subtab.id}
                type="button"
                onClick={() => {
                  onSelectSubtab(subtab.id)
                  setPreserveOverallContext(false)
                  onSelectCompanyTicker(null)
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {subtab.label}
              </button>
            )
          })}

          <div className="pt-2">
            <p className="px-1 pb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Companies</p>
            <div className="space-y-1">
              {(executionOverview?.companies ?? []).map((company, companyIndex) => {
                const active = showCompanyView && activeCompanyTicker === company.companyTicker
                return (
                  <button
                    key={company.companyTicker}
                    type="button"
                    onClick={() => {
                      setPreserveOverallContext(false)
                      onSelectCompanyTicker(company.companyTicker)
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <sup className="mr-1 inline-flex pt-0.5 align-super text-[9px] font-medium opacity-65 tabular-nums">
                      {companyIndex + 1}
                    </sup>
                    {company.companyTicker}
                    <span className="ml-1.5 text-xs opacity-80">({company.positions.length})</span>
                  </button>
                )
              })}
              {(executionOverview?.companies.length ?? 0) === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No companies yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-background p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Add Company</p>
          <div className="space-y-2">
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
        </div>

        </aside>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{workspaceTitle}</CardTitle>
            <CardDescription>{workspaceDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {sideTabsCollapsed && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setSideTabsCollapsed(false)}
              >
                <PanelLeft className="mr-2 h-4 w-4" />
                Show Side Tabs
              </Button>
            )}
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

          {memoryTabActive && (
            <ProjectMemoryFilesBlock
              markdownOptions={linkOptions}
              quotesPath={activeProjectMemoryFiles.quotesPath}
              rememberPath={activeProjectMemoryFiles.rememberPath}
              onSelectQuotesPath={(path) => { void updateActiveProjectMemoryFiles({ quotesPath: path }) }}
              onSelectRememberPath={(path) => { void updateActiveProjectMemoryFiles({ rememberPath: path }) }}
              onOpenFile={onOpenNodeFile}
              disabled={workspaceBusy}
              viewerHeightClassName="h-[700px]"
            />
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
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              {allWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          {workspaceMessage && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {workspaceMessage}
            </div>
          )}

          {overallTabActive && (
            <FileSelectionViewerBlock
              heading="Things To Remember"
              summary="Project-level reminders shown directly in Overall Positions."
              selectedPath={selectedProjectRememberPath || null}
              selectedLabel={selectedProjectRememberLabel}
              emptySelectionMessage="No things-to-remember file selected."
              options={linkOptions}
              query={overallRememberQuery}
              onQueryChange={setOverallRememberQuery}
              pickerOpen={overallRememberPickerOpen}
              onPickerOpenChange={setOverallRememberPickerOpen}
              controlsHidden={overallRememberControlsHidden}
              onControlsHiddenChange={setOverallRememberControlsHidden}
              onSelectPath={(path) => {
                const nextPath = normalizeRelativePathBlock(path ?? '')
                updateActiveOverallRememberPath(nextPath || null)
                setOverallRememberViewerNonce((prev) => prev + 1)
              }}
              onOpenPath={onOpenNodeFile}
              disabled={workspaceBusy}
              searchPlaceholder="Search things-to-remember file"
              searchEmptyMessage="No markdown files found"
              allowCustomValue
              hideDetailsWithSelectionControls
              emptyViewerMessage="Select a file to render it here."
              renderSelectedContent={() => (
                <div className="h-[320px] overflow-hidden rounded-lg border">
                  <MarkdownDocumentBlock
                    key={`overall-remember::${selectedProjectRememberPath}::${overallRememberViewerNonce}`}
                    path={selectedProjectRememberPath}
                    initialMode="view"
                    onOpenPath={(path) => onOpenNodeFile(path)}
                    onOpenPathForEdit={(path) => onOpenNodeFile(path)}
                    className="h-full"
                  />
                </div>
              )}
            />
          )}

          {overallTabActive && (
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Fetched</p>
                <p className="mt-1 font-medium">{formatFetchedTimestampBlock(fetchedAt)}</p>
                <p className="text-xs text-muted-foreground">
                  via {formatRuntimeLabelBlock(lastRefreshRuntime)}
                </p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Overall Value</p>
                <p className="mt-1 font-medium">{formatOverallValueBlock(accountBalanceLegacy ?? assetsAccount)}</p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Indexed Companies</p>
                <p className="mt-1 font-medium">{executionCompanyCount}</p>
              </div>
            </div>
          )}

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
                  <p className="mt-1 text-lg font-semibold">{formatCurrencyKBlock(selectedCompanyMetrics?.totalProfitLoss ?? null)}</p>
                  <p className="text-xs text-muted-foreground">
                    Stock {formatPercentBlock(stockProfitLossWeight)} ({formatCurrencyKBlock(selectedCompanyMetrics?.stockProfitLoss ?? null)})
                    {' · '}
                    Option {formatPercentBlock(optionProfitLossWeight)} ({formatCurrencyKBlock(selectedCompanyMetrics?.optionProfitLoss ?? null)})
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

              <div className="rounded-xl border bg-background p-3">
                <ScrollableZoomSurfaceBlock
                  minWidthClassName={F9_WIDE_TABLE_MIN_WIDTH_CLASS_BLOCK}
                  controlsLabel="Table zoom"
                  showFitColumnsToWidthButton
                  persistStateKey="f9-table-viewport-fit"
                >
                  <BacklogListBlock
                    programs={backlogTableModel.programs}
                    loadEpics={loadBacklogEpics}
                    loadChildren={loadBacklogChildren}
                    selectedNodeId={selectedBacklogNodeId}
                    readOnly
                    allowProgramLayoutEditingInReadOnly
                    onSelectNode={onSelectBacklogNode}
                    programGroups={activeProjectProgramGroups}
                    programGroupIdByProgram={activeProjectProgramGroupIdByProgram}
                    onCreateProgramGroup={createActiveProjectCompanyGroup}
                    onDeleteProgramGroup={deleteActiveProjectCompanyGroup}
                    onToggleProgramGroupCollapsed={toggleActiveProjectCompanyGroupCollapsed}
                    onAssignProgramToGroup={assignProgramToActiveProjectCompanyGroup}
                    onOpenNodeDetails={onOpenBacklogNodeDetails}
                    onUpdateNodeNotes={onUpdateBacklogNodeNotes}
                    relatedNodeOptions={linkOptions}
                    onOpenRelatedNode={(path) => onOpenNodeFile(path)}
                    programLabelSingular="company"
                    programLabelPlural="companies"
                    programGroupLabelSingular="company group"
                    projectPresetTagsByRoot={rowProjectPresetTagsByRoot}
                    canOpenNodeDetails={(node) => node.type === 'epic'}
                    rowColumns={f9RowColumns}
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
                    rowDetailsRenderer={renderF9InlineDetails}
                    titleColumnClassName="w-[20rem]"
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
                    onChange={(event) => setNewPositionStatus(event.target.value as 'taken' | 'planned' | 'watchlist')}
                    className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
                  >
                    <option value="planned">planned</option>
                    <option value="watchlist">watchlist</option>
                    <option value="taken">taken</option>
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
            <div className="rounded-xl border bg-background p-3">
              <ScrollableZoomSurfaceBlock
                minWidthClassName={F9_WIDE_TABLE_MIN_WIDTH_CLASS_BLOCK}
                controlsLabel="Table zoom"
                showFitColumnsToWidthButton
                persistStateKey="f9-table-viewport-fit"
              >
                <BacklogListBlock
                  programs={backlogTableModel.programs}
                  loadEpics={loadBacklogEpics}
                  loadChildren={loadBacklogChildren}
                  selectedNodeId={selectedBacklogNodeId}
                  readOnly
                  allowProgramLayoutEditingInReadOnly
                  onSelectNode={onSelectBacklogNode}
                  programGroups={activeProjectProgramGroups}
                  programGroupIdByProgram={activeProjectProgramGroupIdByProgram}
                  onCreateProgramGroup={createActiveProjectCompanyGroup}
                  onDeleteProgramGroup={deleteActiveProjectCompanyGroup}
                  onToggleProgramGroupCollapsed={toggleActiveProjectCompanyGroupCollapsed}
                  onAssignProgramToGroup={assignProgramToActiveProjectCompanyGroup}
                  onOpenNodeDetails={onOpenBacklogNodeDetails}
                  onUpdateNodeNotes={onUpdateBacklogNodeNotes}
                  relatedNodeOptions={linkOptions}
                  onOpenRelatedNode={(path) => onOpenNodeFile(path)}
                  programLabelSingular="company"
                  programLabelPlural="companies"
                  programGroupLabelSingular="company group"
                  projectPresetTagsByRoot={rowProjectPresetTagsByRoot}
                  canOpenNodeDetails={(node) => node.type === 'epic'}
                  rowColumns={f9RowColumns}
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
                  rowDetailsRenderer={renderF9InlineDetails}
                  titleColumnClassName="w-[20rem]"
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
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                  Live Webull refresh is available only in the Electron app. This runtime shows saved F9 data from your last Electron refresh.
                </div>
              )}
              {liveRefreshAvailable && !hasConfig && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Missing Webull credentials. Open Settings {'>'} F9 and save your Webull app key + app secret to secure device storage.
                </div>
              )}
              <p><span className="font-medium text-foreground">Runtime:</span> {formatRuntimeLabelBlock(runtime)}</p>
              <p><span className="font-medium text-foreground">Fetched:</span> {formatFetchedTimestampBlock(fetchedAt)}</p>
              <p><span className="font-medium text-foreground">Fetched Runtime:</span> {formatRuntimeLabelBlock(lastRefreshRuntime)}</p>
              <p><span className="font-medium text-foreground">Execution Root:</span> {executionRoot ?? 'Not configured'}</p>
              <p><span className="font-medium text-foreground">Execution Companies:</span> {executionCompanyCount}</p>
              <p><span className="font-medium text-foreground">Execution Positions:</span> {executionPositionCount}</p>
              <p><span className="font-medium text-foreground">Execution Source:</span> {executionSyncSource}</p>
              <p><span className="font-medium text-foreground">Account Id:</span> {selectedAccount?.accountId ?? 'Not available'}</p>
              <p><span className="font-medium text-foreground">Account Number:</span> {selectedAccount?.accountNumber ?? 'Not available'}</p>
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
  )
}
