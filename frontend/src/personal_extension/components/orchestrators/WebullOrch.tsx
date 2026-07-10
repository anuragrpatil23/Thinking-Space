import { useCallback, useEffect, useMemo, useState } from 'react'
import WebullWorkspaceBlock from '../lego_blocks/integrations/WebullWorkspaceBlock'
import {
  fetchWebullOverallSnapshotOrch,
  getWebullRuntimeSurfaceOrch,
  type WebullRuntimeSurfaceOrch,
  type WebullAccountSnapshotOrch,
  type WebullOverallSnapshotOrch,
  type WebullSelectedAccountOrch,
} from '../../services/orchestrators/webullOverallOrch'
import {
  createWebullCompanyOrch,
  createWebullManualPositionOrch,
  loadWebullOverallCacheOrch,
  loadWebullExecutionOverviewOrch,
  loadWebullPositionDetailOrch,
  saveWebullPositionBodyOrch,
  syncWebullExecutionFromOverallOrch,
  updateWebullCompanyOverlayOrch,
  updateWebullPositionOverlayOrch,
  type WebullCompanyOverviewBlock,
  type WebullExecutionOverviewBlock,
  type WebullOverallCacheBlock,
  type WebullPositionDetailBlock,
  type SyncWebullExecutionResultBlock,
} from '../../services/orchestrators/webullExecutionOrch'
import { readWebullCredentialStatusBlock } from '../../services/lego_blocks/units/webullConfigBlock'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import { readVaultUiPreferencesOrch } from '@/services/orchestrators/vaultUiPreferencesOrch'
import type { NodeStatus } from '@/services/lego_blocks/units/yamlNoteBlock'

type WebullSubtabId = 'overall' | 'study' | 'sim'

const Webull_BASE_SUBTABS: Array<{ id: WebullSubtabId; label: string }> = [
  { id: 'study', label: 'Study' },
  { id: 'overall', label: 'Overall Positions' },
]

// The Sim subtab is gated behind a Settings → Webull toggle. Inserted right
// after Study (its sibling practice surface) when enabled.
const Webull_SIM_SUBTAB: { id: WebullSubtabId; label: string } = { id: 'sim', label: 'Sim' }

const WEBULL_AUTO_REFRESH_STALENESS_MS = 60_000

function parseSelectedAccountBlock(value: unknown): WebullSelectedAccountOrch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const accountId = String(record.accountId ?? record.account_id ?? '').trim()
  if (!accountId) return null
  const accountNumber = String(record.accountNumber ?? record.account_number ?? '').trim()
  const subscriptionId = String(record.subscriptionId ?? record.subscription_id ?? '').trim()
  const accountClass = String(record.accountClass ?? record.account_class ?? '').trim()
  const accountLabel = String(record.accountLabel ?? record.account_label ?? '').trim()
  return {
    accountId,
    accountNumber: accountNumber || null,
    subscriptionId: subscriptionId || null,
    accountClass: accountClass || null,
    accountLabel: accountLabel || null,
  }
}

/**
 * Webull's normalized `accounts[].account` snapshots drop the stable
 * account_class/account_label fields, but the raw `account_list` payload keeps
 * them. Backfill the friendly identity onto an account by matching id/number so
 * labels stay correct regardless of account discovery order.
 */
function enrichAccountIdentityFromListBlock(
  account: WebullSelectedAccountOrch,
  accountList: unknown,
): WebullSelectedAccountOrch {
  if (account.accountClass || account.accountLabel) return account
  if (!Array.isArray(accountList)) return account
  for (const value of accountList) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    const listId = String(record.account_id ?? record.accountId ?? '').trim()
    const listNumber = String(record.account_number ?? record.accountNumber ?? '').trim()
    const matches = (listId && listId === account.accountId)
      || (listNumber && listNumber === (account.accountNumber ?? ''))
    if (!matches) continue
    const accountClass = String(record.account_class ?? record.accountClass ?? '').trim()
    const accountLabel = String(record.account_label ?? record.accountLabel ?? '').trim()
    return {
      ...account,
      accountClass: accountClass || account.accountClass,
      accountLabel: accountLabel || account.accountLabel,
    }
  }
  return account
}

function parseAccountSnapshotsFromCacheBlock(cache: WebullOverallCacheBlock): WebullAccountSnapshotOrch[] {
  if (Array.isArray(cache.accounts)) {
    return cache.accounts.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const record = value as Record<string, unknown>
      const parsedAccount = parseSelectedAccountBlock(record.account)
      if (!parsedAccount) return []
      const account = enrichAccountIdentityFromListBlock(parsedAccount, cache.accountList)
      return [{
        account,
        accountBalanceLegacy: record.accountBalanceLegacy ?? record.account_balance_legacy ?? null,
        accountPositionsLegacy: record.accountPositionsLegacy ?? record.account_positions_legacy ?? null,
        assetsPositions: record.assetsPositions ?? record.assets_positions ?? null,
        warnings: Array.isArray(record.warnings)
          ? record.warnings.map((warning) => String(warning))
          : [],
      }]
    })
  }

  const parsedSelected = parseSelectedAccountBlock(cache.selectedAccount)
  if (!parsedSelected) return []
  const selectedAccount = enrichAccountIdentityFromListBlock(parsedSelected, cache.accountList)
  return [{
    account: selectedAccount,
    accountBalanceLegacy: cache.accountBalanceLegacy,
    accountPositionsLegacy: cache.accountPositionsLegacy,
    assetsPositions: cache.assetsPositions,
    warnings: [],
  }]
}

function toSnapshotFromCacheBlock(
  cache: WebullOverallCacheBlock,
  runtime: WebullRuntimeSurfaceOrch,
): WebullOverallSnapshotOrch {
  const refreshRuntime = cache.runtime === 'electron' || cache.runtime === 'capacitor' || cache.runtime === 'web'
    ? cache.runtime
    : null
  const runtimeHint = refreshRuntime ?? 'unknown runtime'
  const warning = runtime === 'electron'
    ? `Loaded saved Webull data from ${cache.overallPath}.`
    : `Showing saved Webull data from ${cache.overallPath}. Refresh from Electron app (last refresh runtime: ${runtimeHint}).`
  const accounts = parseAccountSnapshotsFromCacheBlock(cache)
  const selectedAccount = accounts[0]?.account ?? parseSelectedAccountBlock(cache.selectedAccount)

  return {
    runtime: refreshRuntime ?? runtime,
    fetchedAt: cache.fetchedAt || 'Unknown',
    endpoints: {
      accountList: null,
      accountBalanceLegacy: null,
      accountPositionsLegacy: null,
      assetsAccount: null,
      assetsPositions: null,
      marketQuotes: null,
    },
    selectedAccount,
    accounts,
    accountList: cache.accountList,
    accountBalanceLegacy: cache.accountBalanceLegacy,
    accountPositionsLegacy: cache.accountPositionsLegacy,
    assetsAccount: null,
    assetsPositions: cache.assetsPositions,
    marketQuotes: null,
    attempts: [
      `Loaded cache file: ${cache.overallPath}`,
      `Cache source: ${cache.source}`,
      `Cache fetched_at: ${cache.fetchedAt || 'unknown'}`,
      `Cache runtime: ${cache.runtime || 'unknown'}`,
    ],
    warnings: [warning],
  }
}

interface WebullOrchProps {
  pageTitle?: string
}

export default function WebullOrch({ pageTitle }: WebullOrchProps = {}) {
  const { openFile } = useMarkdownViewer()
  const [activeSubtabId, setActiveSubtabId] = useState<WebullSubtabId>('study')
  const [simTabEnabled, setSimTabEnabled] = useState(false)
  const [snapshot, setSnapshot] = useState<WebullOverallSnapshotOrch | null>(null)
  const [executionOverview, setExecutionOverview] = useState<WebullExecutionOverviewBlock | null>(null)
  const [executionSync, setExecutionSync] = useState<SyncWebullExecutionResultBlock | null>(null)
  const [, setExecutionOverviewLoading] = useState(false)
  const [activeCompanyTicker, setActiveCompanyTicker] = useState<string | null>(null)
  const [activePositionFileName, setActivePositionFileName] = useState<string | null>(null)
  const [activePositionDetail, setActivePositionDetail] = useState<WebullPositionDetailBlock | null>(null)
  const [positionDetailLoading, setPositionDetailLoading] = useState(false)
  const [positionDetailError, setPositionDetailError] = useState<string | null>(null)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null)
  const [executionSyncError, setExecutionSyncError] = useState<string | null>(null)
  const [runtime] = useState<WebullRuntimeSurfaceOrch>(getWebullRuntimeSurfaceOrch())
  const [hasConfig, setHasConfig] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subtabs = useMemo(() => (
    simTabEnabled
      ? [Webull_BASE_SUBTABS[0], Webull_SIM_SUBTAB, Webull_BASE_SUBTABS[1]]
      : Webull_BASE_SUBTABS
  ), [simTabEnabled])

  // Read the Sim-subtab gate from vault UI preferences. When it flips off while
  // Sim is active, fall back to Study so the workspace never shows a dead tab.
  useEffect(() => {
    let cancelled = false
    void readVaultUiPreferencesOrch()
      .then((prefs) => {
        if (cancelled) return
        setSimTabEnabled(prefs.webullSimTabEnabled)
        if (!prefs.webullSimTabEnabled) {
          setActiveSubtabId((current) => (current === 'sim' ? 'study' : current))
        }
      })
      .catch(() => { /* leave default (disabled) */ })
    return () => {
      cancelled = true
    }
  }, [])

  const executionRoot = executionOverview?.executionRoot?.trim()
    ? executionOverview.executionRoot
    : (executionSync?.executionRoot?.trim() ? executionSync.executionRoot : null)

  const activeCompany: WebullCompanyOverviewBlock | null = executionOverview?.companies.find(
    (company) => company.companyTicker === activeCompanyTicker,
  ) ?? null

  const loadExecutionOverview = useCallback(async (): Promise<WebullExecutionOverviewBlock | null> => {
    setExecutionOverviewLoading(true)
    try {
      const overview = await loadWebullExecutionOverviewOrch()
      setExecutionOverview(overview)
      return overview
    } catch (overviewErr) {
      setExecutionSyncError(
        overviewErr instanceof Error
          ? overviewErr.message
          : 'Failed to read Webull execution company index files.',
      )
      return null
    } finally {
      setExecutionOverviewLoading(false)
    }
  }, [])

  const loadSavedOverallSnapshot = useCallback(async (): Promise<WebullOverallSnapshotOrch | null> => {
    try {
      const cached = await loadWebullOverallCacheOrch()
      if (!cached) return null
      const cachedSnapshot = toSnapshotFromCacheBlock(cached, runtime)
      setSnapshot(cachedSnapshot)
      return cachedSnapshot
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read saved Webull overall.json cache.')
      return null
    }
  }, [runtime])

  const refreshOverall = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExecutionSyncError(null)
    setWorkspaceMessage(null)
    try {
      if (runtime !== 'electron') {
        const cachedSnapshot = await loadSavedOverallSnapshot()
        await loadExecutionOverview()
        if (cachedSnapshot) {
          setWorkspaceMessage(null)
        } else {
          setError('No saved Webull data found. Refresh once from the Electron app to generate overall.json.')
        }
        return
      }

      const next = await fetchWebullOverallSnapshotOrch()
      setSnapshot(next)
      let syncErrorMessage: string | null = null
      try {
        const syncResult = await syncWebullExecutionFromOverallOrch(next)
        setExecutionSync(syncResult)
      } catch (syncErr) {
        syncErrorMessage = syncErr instanceof Error ? syncErr.message : 'Failed to sync Webull execution files.'
        setExecutionSyncError(syncErrorMessage)
      }
      try {
        const overview = await loadWebullExecutionOverviewOrch()
        setExecutionOverview(overview)
      } catch (overviewErr) {
        if (!syncErrorMessage) {
          setExecutionSyncError(
            overviewErr instanceof Error
              ? overviewErr.message
              : 'Failed to read Webull execution company index files.',
          )
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Webull Overall data.')
    } finally {
      setLoading(false)
    }
  }, [loadExecutionOverview, loadSavedOverallSnapshot, runtime])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadWebullExecutionOverviewOrch(),
      loadWebullOverallCacheOrch(),
      readWebullCredentialStatusBlock(),
    ])
      .then(([overview, cached, credentialStatus]) => {
        if (cancelled) return
        setExecutionOverview(overview)
        setHasConfig(credentialStatus.configured)
        if (cached) {
          setSnapshot(toSnapshotFromCacheBlock(cached, runtime))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasConfig(false)
          // Ignore initial load failures; refresh flow surfaces actionable errors.
        }
      })
    return () => {
      cancelled = true
    }
  }, [runtime])

  useEffect(() => {
    if (activeSubtabId !== 'overall') return
    let cancelled = false
    void readWebullCredentialStatusBlock()
      .then((status) => {
        if (!cancelled) {
          setHasConfig(status.configured)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasConfig(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeSubtabId])

  useEffect(() => {
    if (!executionOverview || executionOverview.companies.length === 0) {
      setActiveCompanyTicker(null)
      return
    }
    if (!activeCompanyTicker) return
    const exists = executionOverview.companies.some((company) => company.companyTicker === activeCompanyTicker)
    if (!exists) {
      setActiveCompanyTicker(null)
    }
  }, [activeCompanyTicker, executionOverview])

  useEffect(() => {
    if (!activeCompany) {
      setActivePositionFileName(null)
      setActivePositionDetail(null)
      setPositionDetailError(null)
      return
    }
    if (activeCompany.positions.length === 0) {
      setActivePositionFileName(null)
      setActivePositionDetail(null)
      setPositionDetailError(null)
      return
    }
    if (!activePositionFileName) {
      setActivePositionFileName(activeCompany.positions[0].fileName)
      return
    }
    const exists = activeCompany.positions.some((position) => position.fileName === activePositionFileName)
    if (!exists) {
      setActivePositionFileName(activeCompany.positions[0].fileName)
    }
  }, [activeCompany, activePositionFileName])

  useEffect(() => {
    if (!activeCompanyTicker || !activePositionFileName) {
      setActivePositionDetail(null)
      setPositionDetailError(null)
      return
    }
    let cancelled = false
    setPositionDetailLoading(true)
    setPositionDetailError(null)
    void loadWebullPositionDetailOrch(activeCompanyTicker, activePositionFileName)
      .then((detail) => {
        if (cancelled) return
        setActivePositionDetail(detail)
      })
      .catch((detailErr) => {
        if (cancelled) return
        setActivePositionDetail(null)
        setPositionDetailError(detailErr instanceof Error ? detailErr.message : 'Failed to load position detail.')
      })
      .finally(() => {
        if (!cancelled) setPositionDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeCompanyTicker, activePositionFileName])

  const onCreateCompany = useCallback(async (companyTicker: string) => {
    setWorkspaceBusy(true)
    setWorkspaceMessage(null)
    setExecutionSyncError(null)
    try {
      const company = await createWebullCompanyOrch(companyTicker)
      await loadExecutionOverview()
      setActiveCompanyTicker(company.companyTicker)
      setWorkspaceMessage(`Added company ${company.companyTicker}.`)
    } catch (err) {
      setExecutionSyncError(err instanceof Error ? err.message : 'Failed to create company.')
    } finally {
      setWorkspaceBusy(false)
    }
  }, [loadExecutionOverview])

  const onCreateManualPosition = useCallback(async (input: {
    title?: string
    status?: NodeStatus
    instrumentType?: 'STOCK' | 'OPTION'
    optionType?: 'CALL' | 'PUT' | null
    optionExpireDate?: string | null
    optionExercisePrice?: string | null
    linkedIdeaId?: string | null
    notes?: string
  }) => {
    if (!activeCompanyTicker) return
    setWorkspaceBusy(true)
    setWorkspaceMessage(null)
    setExecutionSyncError(null)
    try {
      const created = await createWebullManualPositionOrch({
        companyTicker: activeCompanyTicker,
        ...input,
      })
      await loadExecutionOverview()
      setActivePositionFileName(created.fileName)
      setWorkspaceMessage(`Added position ${created.fileName}.`)
    } catch (err) {
      setExecutionSyncError(err instanceof Error ? err.message : 'Failed to create position.')
    } finally {
      setWorkspaceBusy(false)
    }
  }, [activeCompanyTicker, loadExecutionOverview])

  const onUpdatePositionOverlay = useCallback(async (input: {
    fileName?: string
    status?: NodeStatus
    linkedIdeaId?: string | null
    title?: string | null
    priority?: 'low' | 'medium' | 'high' | 'critical' | null
    description?: string | null
    comments?: Array<{
      text: string
      added_at?: string
      added_by?: string
    }>
    relatedNodes?: string[]
    tags?: string[]
    projectPresetTags?: string[]
  }) => {
    if (!activeCompanyTicker) return
    const fileName = input.fileName ?? activePositionFileName
    if (!fileName) return
    setWorkspaceBusy(true)
    setWorkspaceMessage(null)
    setExecutionSyncError(null)
    try {
      const detail = await updateWebullPositionOverlayOrch({
        companyTicker: activeCompanyTicker,
        fileName,
        ...input,
      })
      setActivePositionFileName(fileName)
      setActivePositionDetail(detail)
      await loadExecutionOverview()
      setWorkspaceMessage('Position metadata updated.')
    } catch (err) {
      setExecutionSyncError(err instanceof Error ? err.message : 'Failed to update position fields.')
    } finally {
      setWorkspaceBusy(false)
    }
  }, [activeCompanyTicker, activePositionFileName, loadExecutionOverview])

  const onUpdateCompanyOverlay = useCallback(async (input: {
    companyTicker?: string | null
    strategyNotes?: string | null
    relatedIdeaIds?: string[]
    programGroupId?: string | null
    valuationNotePath?: string | null
    companyPdfReportPath?: string | null
  }) => {
    const targetCompanyTicker = (input.companyTicker ?? activeCompanyTicker)?.trim() ?? ''
    if (!targetCompanyTicker) return
    setWorkspaceBusy(true)
    setWorkspaceMessage(null)
    setExecutionSyncError(null)
    try {
      const company = await updateWebullCompanyOverlayOrch({
        ...input,
        companyTicker: targetCompanyTicker,
      })
      if (!input.companyTicker || input.companyTicker === activeCompanyTicker) {
        setActiveCompanyTicker(company.companyTicker)
      }
      await loadExecutionOverview()
      setWorkspaceMessage('Company metadata updated.')
    } catch (err) {
      setExecutionSyncError(err instanceof Error ? err.message : 'Failed to update company metadata.')
    } finally {
      setWorkspaceBusy(false)
    }
  }, [activeCompanyTicker, loadExecutionOverview])

  const onSavePositionBody = useCallback(async (body: string) => {
    if (!activeCompanyTicker || !activePositionFileName) return
    setWorkspaceBusy(true)
    setWorkspaceMessage(null)
    setExecutionSyncError(null)
    try {
      const detail = await saveWebullPositionBodyOrch({
        companyTicker: activeCompanyTicker,
        fileName: activePositionFileName,
        body,
      })
      setActivePositionDetail(detail)
      setWorkspaceMessage('Position notes saved.')
    } catch (err) {
      setExecutionSyncError(err instanceof Error ? err.message : 'Failed to save position notes.')
    } finally {
      setWorkspaceBusy(false)
    }
  }, [activeCompanyTicker, activePositionFileName])

  useEffect(() => {
    if (activeSubtabId !== 'overall') return
    if (runtime !== 'electron') {
      void refreshOverall()
      return
    }
    if (!hasConfig) {
      void loadSavedOverallSnapshot()
      return
    }
    // Skip the auto-fetch (which rewrites every position/company .md file)
    // when we already have a recent snapshot. Tab switches shouldn't churn
    // the vault — the manual refresh button stays available for an immediate update.
    const fetchedAtMs = snapshot?.fetchedAt ? Date.parse(snapshot.fetchedAt) : NaN
    const isFresh = Number.isFinite(fetchedAtMs) && (Date.now() - fetchedAtMs) < WEBULL_AUTO_REFRESH_STALENESS_MS
    if (isFresh) return
    void refreshOverall()
  }, [activeSubtabId, hasConfig, loadSavedOverallSnapshot, refreshOverall, runtime, snapshot?.fetchedAt])

  return (
    <WebullWorkspaceBlock
      pageTitle={pageTitle}
      subtabs={subtabs}
      activeSubtabId={activeSubtabId}
      onSelectSubtab={setActiveSubtabId}
      hasConfig={hasConfig}
      liveRefreshAvailable={runtime === 'electron'}
      error={error}
      runtime={runtime}
      lastRefreshRuntime={snapshot?.runtime ?? null}
      fetchedAt={snapshot?.fetchedAt ?? null}
      endpoints={snapshot?.endpoints ?? {
        accountList: null,
        accountBalanceLegacy: null,
        accountPositionsLegacy: null,
        assetsAccount: null,
        assetsPositions: null,
        marketQuotes: null,
      }}
      selectedAccount={snapshot?.selectedAccount ?? null}
      accounts={snapshot?.accounts ?? []}
      accountList={snapshot?.accountList ?? null}
      accountBalanceLegacy={snapshot?.accountBalanceLegacy ?? null}
      accountPositionsLegacy={snapshot?.accountPositionsLegacy ?? null}
      assetsAccount={snapshot?.assetsAccount ?? null}
      assetsPositions={snapshot?.assetsPositions ?? null}
      marketQuotes={snapshot?.marketQuotes ?? null}
      warnings={snapshot?.warnings ?? []}
      attempts={snapshot?.attempts ?? []}
      executionRoot={executionRoot}
      executionCompanyCount={executionOverview?.companyCount ?? executionSync?.companyCount ?? 0}
      executionPositionCount={executionOverview?.positionCount ?? executionSync?.positionCount ?? 0}
      executionSyncSource={executionSync?.source ?? 'none'}
      executionSyncWarnings={executionSync?.warnings ?? []}
      executionSyncError={executionSyncError}
      executionOverview={executionOverview}
      activeCompanyTicker={activeCompanyTicker}
      onSelectCompanyTicker={setActiveCompanyTicker}
      activePositionFileName={activePositionFileName}
      onSelectPositionFileName={setActivePositionFileName}
      activePositionDetail={activePositionDetail}
      positionDetailLoading={positionDetailLoading}
      positionDetailError={positionDetailError}
      loading={loading}
      workspaceBusy={workspaceBusy}
      workspaceMessage={workspaceMessage}
      onCreateCompany={onCreateCompany}
      onCreateManualPosition={onCreateManualPosition}
      onUpdatePositionOverlay={onUpdatePositionOverlay}
      onUpdateCompanyOverlay={onUpdateCompanyOverlay}
      onSavePositionBody={onSavePositionBody}
      onOpenNodeFile={(filePath) => openFile(filePath, { mode: 'edit' })}
    />
  )
}
