import { isElectron } from '@/services/orchestrators/runtimeOrch'
import {
  getWebullConfigBlock,
  readStoredWebullAccessTokenBlock,
  writeStoredWebullAccessTokenBlock,
  type WebullConfigBlock,
} from '../units/webullConfigBlock'

export interface WebullApiResultBlock {
  endpoint: string
  requestedAt: string
  data: unknown
  attempts: string[]
}

const DEFAULT_ACCOUNT_POSITIONS_CANDIDATE_PATHS_BLOCK = [
  '/openapi/account/positions',
  '/account/positions',
  '/app/account/positions',
]

const DEFAULT_ASSETS_ACCOUNT_CANDIDATE_PATHS_BLOCK = [
  '/openapi/assets/account',
  '/openapi/assets/balance',
  '/assets/account',
  '/assets/balance',
]

const DEFAULT_INSTRUMENT_STOCK_BY_TICKER_IDS_CANDIDATE_PATHS_BLOCK = [
  '/openapi/instrument/stock/list-by-ticker-ids',
]

const DEFAULT_INSTRUMENT_OPTION_BY_TICKER_IDS_CANDIDATE_PATHS_BLOCK = [
  '/openapi/instrument/option/list-by-ticker-ids',
]

const DEFAULT_TRADE_INSTRUMENT_CANDIDATE_PATHS_BLOCK = [
  '/trade/instrument',
  '/openapi/trade/instrument',
]

const DEFAULT_MARKET_QUOTES_CANDIDATE_PATHS_BLOCK = [
  '/openapi/market-data/stock/snapshot',
  '/openapi/market-data/stock/quotes',
  '/market-data/stock/snapshot',
  '/market-data/stock/quotes',
]

const QUOTE_QUERY_VARIANTS_BLOCK: Array<Record<string, string>> = [
  { symbols: '__SYMBOLS__' },
  { symbols: '__SYMBOLS__', category: 'US_STOCK' },
  { stock_ticker_ids: '__SYMBOLS__' },
  { stock_ticker_ids: '__SYMBOLS__', category: 'US_STOCK' },
  { ticker_ids: '__SYMBOLS__' },
]

const DEFAULT_POSITIONS_PAGE_SIZE_BLOCK = 100
const MAX_POSITIONS_PAGE_FETCH_BLOCK = 50
const MAX_INSTRUMENT_LOOKUP_IDS_PER_REQUEST_BLOCK = 40
const WEBULL_PAGINATION_STAGGER_MS_BLOCK = 350

const INSTRUMENT_QUERY_VARIANTS_BLOCK: Array<(idsCsv: string) => Record<string, string>> = [
  idsCsv => ({ ticker_ids: idsCsv }),
  idsCsv => ({ stock_ticker_ids: idsCsv }),
  idsCsv => ({ instrument_ids: idsCsv }),
  idsCsv => ({ ids: idsCsv }),
]

const TRADE_INSTRUMENT_QUERY_VARIANTS_BLOCK: Array<(instrumentId: string) => Record<string, string>> = [
  instrumentId => ({ instrument_id: instrumentId }),
  instrumentId => ({ ticker_id: instrumentId }),
  instrumentId => ({ id: instrumentId }),
]

interface WebullAccessTokenBlock {
  token: string
  expires: number | null
  status: string | null
}

const WEBULL_TOKEN_EXPIRY_SAFETY_MS_BLOCK = 60_000
const WEBULL_TOKEN_CHECK_DURATION_MS_BLOCK = 300_000
const WEBULL_TOKEN_CHECK_INTERVAL_MS_BLOCK = 5_000
let cachedWebullAccessTokenBlock: WebullAccessTokenBlock | null = null
let pendingWebullTokenInitPromiseBlock: Promise<string> | null = null
let hydratedWebullAccessTokenCacheBlock = false

function parseJsonSafelyBlock(raw: string): unknown {
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function buildErrorPreviewBlock(parsed: unknown): string {
  if (typeof parsed === 'string') return parsed.slice(0, 260)
  return JSON.stringify(parsed).slice(0, 260)
}

function assertElectronRuntimeBlock(): void {
  if (!isElectron()) {
    throw new Error('Webull Webull API currently requires Electron runtime because browser requests are blocked by CORS.')
  }
}

function resolvePathCandidatesBlock(overridePath: string | undefined, defaults: string[]): string[] {
  const seen = new Set<string>()
  const ordered = [overridePath, ...defaults]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim())

  const result: string[] = []
  for (const path of ordered) {
    if (seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

function buildEndpointBlock(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const url = new URL(path, baseUrl)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue
      const normalized = String(value).trim()
      if (!normalized) continue
      url.searchParams.set(key, normalized)
    }
  }
  return url.toString()
}

function withOpenApiBaseUrlBlock(config: WebullConfigBlock): WebullConfigBlock {
  return {
    ...config,
    baseUrl: config.openApiBaseUrl,
  }
}

const WEBULL_RATE_LIMIT_RETRY_MAX_BLOCK = 4
const WEBULL_RATE_LIMIT_RETRY_BASE_MS_BLOCK = 800
const WEBULL_RATE_LIMIT_RETRY_CAP_MS_BLOCK = 8_000

function computeRetryDelayMsBlock(attemptIndex: number): number {
  // Exponential backoff with jitter: 800ms, 1600ms, 3200ms, 6400ms (capped at 8s) +/- 25%.
  const base = Math.min(
    WEBULL_RATE_LIMIT_RETRY_CAP_MS_BLOCK,
    WEBULL_RATE_LIMIT_RETRY_BASE_MS_BLOCK * Math.pow(2, attemptIndex),
  )
  const jitter = base * 0.25 * (Math.random() * 2 - 1)
  return Math.max(0, Math.floor(base + jitter))
}

function isRetryableRateLimitStatusBlock(status: number): boolean {
  // 429 = explicit rate limit; 503 = backend overloaded.
  return status === 429 || status === 503
}

async function signedRequestBlock(
  method: 'GET' | 'POST',
  endpoint: string,
  options?: {
    version?: string
    accessToken?: string
    body?: string
  },
): Promise<{ status: number; data: unknown }> {
  if (!window.electronAPI?.webullSignedRequest) {
    throw new Error('Webull Webull signed bridge is unavailable in this Electron build.')
  }

  let lastResponse: { status: number; data: unknown } | null = null
  for (let attempt = 0; attempt <= WEBULL_RATE_LIMIT_RETRY_MAX_BLOCK; attempt += 1) {
    const response = await window.electronAPI.webullSignedRequest({
      method,
      url: endpoint,
      version: options?.version,
      accessToken: options?.accessToken,
      body: options?.body,
    })
    lastResponse = {
      status: response.status,
      data: parseJsonSafelyBlock(response.body),
    }

    if (!isRetryableRateLimitStatusBlock(response.status)) {
      return lastResponse
    }
    if (attempt === WEBULL_RATE_LIMIT_RETRY_MAX_BLOCK) {
      return lastResponse
    }
    await waitForMsBlock(computeRetryDelayMsBlock(attempt))
  }

  return lastResponse!
}

async function signedV2RequestBlock(
  method: 'GET' | 'POST',
  endpoint: string,
  options?: {
    accessToken?: string
    body?: string
  },
): Promise<{ status: number; data: unknown }> {
  return signedRequestBlock(method, endpoint, {
    version: 'v2',
    accessToken: options?.accessToken,
    body: options?.body,
  })
}

function parseAccessTokenBlock(value: unknown): WebullAccessTokenBlock | null {
  const row = asRecordBlock(value)
  if (!row) return null

  const token = firstNonEmptyStringBlock(row.token, row.access_token, row.accessToken)
  if (!token) return null
  const status = firstNonEmptyStringBlock(row.status)

  let expires: number | null = null
  const rawExpires = row.expires
  if (typeof rawExpires === 'number' && Number.isFinite(rawExpires)) {
    expires = rawExpires
  } else if (typeof rawExpires === 'string') {
    const parsed = Number(rawExpires)
    if (Number.isFinite(parsed)) {
      expires = parsed
    }
  }

  return {
    token,
    expires,
    status,
  }
}

function normalizeAccessTokenStatusBlock(token: WebullAccessTokenBlock | null): string {
  if (!token?.status) return ''
  return token.status.trim().toUpperCase()
}

function isAccessTokenExpiredBlock(token: WebullAccessTokenBlock): boolean {
  if (token.expires === null) return false
  return token.expires <= (Date.now() + WEBULL_TOKEN_EXPIRY_SAFETY_MS_BLOCK)
}

function isCachedAccessTokenUsableBlock(token: WebullAccessTokenBlock | null): boolean {
  if (!token?.token) return false
  if (isAccessTokenExpiredBlock(token)) return false
  return normalizeAccessTokenStatusBlock(token) === 'NORMAL'
}

function isCachedPendingAccessTokenBlock(token: WebullAccessTokenBlock | null): boolean {
  if (!token?.token) return false
  if (isAccessTokenExpiredBlock(token)) return false
  return normalizeAccessTokenStatusBlock(token) === 'PENDING'
}

async function setCachedWebullAccessTokenBlock(
  token: WebullAccessTokenBlock | null,
): Promise<void> {
  cachedWebullAccessTokenBlock = token
  try {
    await writeStoredWebullAccessTokenBlock(token)
  } catch {
    // Token persistence is best-effort; auth flow should continue when secure storage writes fail.
  }
}

async function hydrateCachedWebullAccessTokenFromSecureStoreBlock(): Promise<void> {
  if (hydratedWebullAccessTokenCacheBlock) return
  hydratedWebullAccessTokenCacheBlock = true
  try {
    const parsed = await readStoredWebullAccessTokenBlock()
    if (!parsed) return
    if (isAccessTokenExpiredBlock(parsed)) return
    cachedWebullAccessTokenBlock = parsed
  } catch {
    // Best-effort hydration from secure token cache.
  }
}

/**
 * Whether a usable Webull sign-in is on hand, without asking Webull for one.
 * Asking for a new one sends a 2FA prompt to the phone: only ever when you ask.
 */
export async function webullSignedInBlock(): Promise<boolean> {
  await hydrateCachedWebullAccessTokenFromSecureStoreBlock()
  return isCachedAccessTokenUsableBlock(cachedWebullAccessTokenBlock)
}

function waitForMsBlock(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, Math.max(0, ms))
  })
}

async function pollWebullTokenUntilNormalBlock(
  config: WebullConfigBlock,
  token: string,
): Promise<string> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new Error('Webull token check requires a non-empty token.')
  }

  const checkEndpoint = buildEndpointBlock(config.baseUrl, '/openapi/auth/token/check')
  const deadline = Date.now() + WEBULL_TOKEN_CHECK_DURATION_MS_BLOCK
  let tokenToCheck = normalizedToken

  while (true) {
    const checkResponse = await signedV2RequestBlock(
      'POST',
      checkEndpoint,
      { body: JSON.stringify({ token: tokenToCheck }) },
    )
    if (checkResponse.status < 200 || checkResponse.status >= 300) {
      throw new Error(`Webull token check failed (HTTP ${checkResponse.status}): ${buildErrorPreviewBlock(checkResponse.data)}`)
    }

    const parsed = parseAccessTokenBlock(checkResponse.data)
    if (!parsed) {
      throw new Error(`Webull token check returned malformed payload: ${buildErrorPreviewBlock(checkResponse.data)}`)
    }
    await setCachedWebullAccessTokenBlock(parsed)

    const normalizedStatus = normalizeAccessTokenStatusBlock(parsed)
    if (normalizedStatus === 'NORMAL') {
      return parsed.token
    }
    if (normalizedStatus === 'INVALID' || normalizedStatus === 'EXPIRED') {
      throw new Error(`Webull token status became ${normalizedStatus}. Please restart token verification.`)
    }

    tokenToCheck = parsed.token
    if (Date.now() >= deadline) {
      throw new Error('Webull token verification is still pending. Approve the 2FA prompt on phone and retry.')
    }

    await waitForMsBlock(WEBULL_TOKEN_CHECK_INTERVAL_MS_BLOCK)
  }
}

async function ensureWebullAccessTokenInnerBlock(config: WebullConfigBlock): Promise<string> {
  await hydrateCachedWebullAccessTokenFromSecureStoreBlock()

  if (isCachedAccessTokenUsableBlock(cachedWebullAccessTokenBlock)) {
    return cachedWebullAccessTokenBlock!.token
  }
  if (isCachedPendingAccessTokenBlock(cachedWebullAccessTokenBlock)) {
    return pollWebullTokenUntilNormalBlock(config, cachedWebullAccessTokenBlock!.token)
  }

  const createEndpoint = buildEndpointBlock(config.baseUrl, '/openapi/auth/token/create')
  const createBody = cachedWebullAccessTokenBlock?.token
    ? JSON.stringify({ token: cachedWebullAccessTokenBlock.token })
    : '{}'
  const createResponse = await signedV2RequestBlock('POST', createEndpoint, { body: createBody })
  if (createResponse.status < 200 || createResponse.status >= 300) {
    throw new Error(`Webull token create failed (HTTP ${createResponse.status}): ${buildErrorPreviewBlock(createResponse.data)}`)
  }

  const parsed = parseAccessTokenBlock(createResponse.data)
  if (!parsed) {
    throw new Error(`Webull token create returned malformed payload: ${buildErrorPreviewBlock(createResponse.data)}`)
  }
  await setCachedWebullAccessTokenBlock(parsed)

  const normalizedStatus = normalizeAccessTokenStatusBlock(parsed)
  if (normalizedStatus === 'NORMAL') {
    return parsed.token
  }
  if (normalizedStatus === 'PENDING') {
    return pollWebullTokenUntilNormalBlock(config, parsed.token)
  }
  if (normalizedStatus === 'INVALID' || normalizedStatus === 'EXPIRED') {
    throw new Error(`Webull token create returned ${normalizedStatus} status. Please restart token verification.`)
  }

  throw new Error(`Webull token create returned unsupported status: ${parsed.status ?? 'unknown'}`)
}

async function ensureWebullAccessTokenBlock(config: WebullConfigBlock): Promise<string> {
  if (pendingWebullTokenInitPromiseBlock) {
    return pendingWebullTokenInitPromiseBlock
  }

  pendingWebullTokenInitPromiseBlock = ensureWebullAccessTokenInnerBlock(config)
    .finally(() => {
      pendingWebullTokenInitPromiseBlock = null
    })
  return pendingWebullTokenInitPromiseBlock
}

async function signedGetBlock(
  endpoint: string,
  options?: { accessToken?: string },
): Promise<{ status: number; data: unknown }> {
  return signedRequestBlock('GET', endpoint, { accessToken: options?.accessToken })
}

function resolveQuoteQueryVariantsBlock(symbols: string[]): Array<Record<string, string>> {
  const csv = symbols.join(',')
  return QUOTE_QUERY_VARIANTS_BLOCK.map(variant => {
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(variant)) {
      next[key] = value === '__SYMBOLS__' ? csv : value
    }
    return next
  })
}

function asRecordBlock(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asRecordArrayBlock(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
}

function firstNonEmptyStringBlock(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const normalized = candidate.trim()
    if (normalized) return normalized
  }
  return null
}

function extractHoldingsRowsBlock(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return asRecordArrayBlock(value)
  const row = asRecordBlock(value)
  if (!row) return []
  const candidateKeys = ['holdings', 'positions', 'items', 'rows', 'data', 'list', 'result']
  for (const key of candidateKeys) {
    const nested = row[key]
    if (Array.isArray(nested)) {
      return asRecordArrayBlock(nested)
    }
  }
  return []
}

function readHasNextFlagBlock(value: unknown): boolean {
  const row = asRecordBlock(value)
  if (!row) return false
  const raw = row.has_next ?? row.hasNext
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase()
    return normalized === 'true' || normalized === '1'
  }
  return false
}

function resolveLastInstrumentCursorBlock(value: unknown): string | null {
  const row = asRecordBlock(value)
  const fromPage = firstNonEmptyStringBlock(
    row?.last_instrument_id,
    row?.lastInstrumentId,
    row?.next_last_instrument_id,
    row?.nextLastInstrumentId,
    row?.next_cursor,
    row?.nextCursor,
    row?.cursor,
  )
  if (fromPage) return fromPage

  const holdings = extractHoldingsRowsBlock(value)
  if (holdings.length === 0) return null
  const lastHolding = holdings[holdings.length - 1]
  return firstNonEmptyStringBlock(
    lastHolding.instrument_id,
    lastHolding.instrumentId,
    lastHolding.position_id,
    lastHolding.positionId,
    lastHolding.id,
  )
}

function extractCollectionRowsBlock(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return asRecordArrayBlock(value)
  const row = asRecordBlock(value)
  if (!row) return []

  const candidateKeys = ['items', 'list', 'data', 'rows', 'result', 'instruments', 'holdings', 'positions']
  for (const key of candidateKeys) {
    const nested = row[key]
    if (Array.isArray(nested)) {
      return asRecordArrayBlock(nested)
    }
  }
  return []
}

function splitIntoChunksBlock<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return []
  const normalizedChunkSize = Math.max(1, chunkSize)
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += normalizedChunkSize) {
    chunks.push(items.slice(index, index + normalizedChunkSize))
  }
  return chunks
}

async function fetchPaginatedPositionsByCandidatePathsBlock(
  config: WebullConfigBlock,
  candidatePaths: string[],
  accountId: string,
  errorLabel: string,
): Promise<WebullApiResultBlock> {
  const requestedAt = new Date().toISOString()
  const attempts: string[] = []

  for (const path of candidatePaths) {
    let firstEndpoint: string | null = null
    let pageCursor: string | null = null
    let mergedHoldings: Array<Record<string, unknown>> = []
    let lastPageRecord: Record<string, unknown> | null = null

    for (let pageIndex = 0; pageIndex < MAX_POSITIONS_PAGE_FETCH_BLOCK; pageIndex += 1) {
      if (pageIndex > 0) {
        await waitForMsBlock(WEBULL_PAGINATION_STAGGER_MS_BLOCK)
      }
      const endpoint = buildEndpointBlock(config.baseUrl, path, {
        account_id: accountId,
        page_size: DEFAULT_POSITIONS_PAGE_SIZE_BLOCK,
        last_instrument_id: pageCursor,
      })
      const response = await signedGetBlock(endpoint)
      const queryString = new URL(endpoint).searchParams.toString()
      attempts.push(`${path}?${queryString} -> HTTP ${response.status}`)

      if (response.status < 200 || response.status >= 300) {
        if (!firstEndpoint && response.status === 404) {
          break
        }
        throw new Error(`${errorLabel} failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
      }

      if (!firstEndpoint) firstEndpoint = endpoint
      lastPageRecord = asRecordBlock(response.data)

      const pageHoldings = extractHoldingsRowsBlock(response.data)
      mergedHoldings = mergedHoldings.concat(pageHoldings)

      const hasNext = readHasNextFlagBlock(response.data)
      if (!hasNext) {
        return {
          endpoint: firstEndpoint,
          requestedAt,
          data: {
            ...(lastPageRecord ?? {}),
            has_next: false,
            holdings: mergedHoldings,
          },
          attempts,
        }
      }

      pageCursor = resolveLastInstrumentCursorBlock(response.data)
      if (!pageCursor) {
        attempts.push(`${path} pagination stopped: has_next=true but last_instrument_id cursor was missing`)
        return {
          endpoint: firstEndpoint,
          requestedAt,
          data: {
            ...(lastPageRecord ?? {}),
            has_next: true,
            holdings: mergedHoldings,
            pagination_truncated: true,
            pagination_truncated_reason: 'has_next=true but last_instrument_id cursor was missing',
          },
          attempts,
        }
      }
    }

    if (firstEndpoint) {
      attempts.push(`${path} pagination stopped: reached safety limit of ${MAX_POSITIONS_PAGE_FETCH_BLOCK} pages`)
      return {
        endpoint: firstEndpoint,
        requestedAt,
        data: {
          ...(lastPageRecord ?? {}),
          has_next: true,
          holdings: mergedHoldings,
          pagination_truncated: true,
          pagination_truncated_reason: `reached safety limit of ${MAX_POSITIONS_PAGE_FETCH_BLOCK} pages`,
        },
        attempts,
      }
    }
  }

  throw new Error(`${errorLabel} route not found for candidate paths: ${attempts.join(', ')}`)
}

async function fetchInstrumentByTickerIdsBlock(
  config: WebullConfigBlock,
  candidatePaths: string[],
  ids: string[],
  errorLabel: string,
): Promise<WebullApiResultBlock> {
  const normalizedIds = Array.from(new Set(
    ids
      .map(value => value.trim())
      .filter(Boolean),
  ))
  if (normalizedIds.length === 0) {
    throw new Error(`${errorLabel} requires at least one ticker id.`)
  }

  const requestedAt = new Date().toISOString()
  const attempts: string[] = []
  const mergedRows: Array<Record<string, unknown>> = []
  const rawResponses: unknown[] = []
  let firstSuccessEndpoint: string | null = null

  const chunks = splitIntoChunksBlock(normalizedIds, MAX_INSTRUMENT_LOOKUP_IDS_PER_REQUEST_BLOCK)
  for (const chunk of chunks) {
    const idsCsv = chunk.join(',')
    let chunkResolved = false

    for (const path of candidatePaths) {
      for (const queryFactory of INSTRUMENT_QUERY_VARIANTS_BLOCK) {
        const endpoint = buildEndpointBlock(config.baseUrl, path, queryFactory(idsCsv))
        const response = await signedGetBlock(endpoint)
        const queryString = new URL(endpoint).searchParams.toString()
        attempts.push(`${path}?${queryString} -> HTTP ${response.status}`)

        if (response.status >= 200 && response.status < 300) {
          if (!firstSuccessEndpoint) firstSuccessEndpoint = endpoint
          rawResponses.push(response.data)
          mergedRows.push(...extractCollectionRowsBlock(response.data))
          chunkResolved = true
          break
        }

        if (response.status === 404 || response.status === 400 || response.status === 422) {
          continue
        }

        throw new Error(`${errorLabel} failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
      }

      if (chunkResolved) break
    }

    if (!chunkResolved) {
      throw new Error(`${errorLabel} route/params not found for ids chunk: ${idsCsv}`)
    }
  }

  return {
    endpoint: firstSuccessEndpoint ?? 'not-requested',
    requestedAt,
    data: {
      items: mergedRows,
      raw_responses: rawResponses,
      request_id_count: normalizedIds.length,
    },
    attempts,
  }
}

async function fetchByPathCandidatesBlock(
  config: WebullConfigBlock,
  candidatePaths: string[],
  options?: {
    query?: Record<string, string | number | boolean | null | undefined>
    continueStatuses?: number[]
    errorLabel?: string
  },
): Promise<WebullApiResultBlock> {
  const continueStatuses = new Set(options?.continueStatuses ?? [404])
  const requestedAt = new Date().toISOString()
  const attempts: string[] = []

  for (const path of candidatePaths) {
    const endpoint = buildEndpointBlock(config.baseUrl, path, options?.query)
    const response = await signedGetBlock(endpoint)

    if (response.status >= 200 && response.status < 300) {
      attempts.push(`${path} -> HTTP ${response.status}`)
      return {
        endpoint,
        requestedAt,
        data: response.data,
        attempts,
      }
    }

    attempts.push(`${path} -> HTTP ${response.status}`)

    if (continueStatuses.has(response.status)) {
      continue
    }

    const label = options?.errorLabel ?? 'Webull request'
    throw new Error(`${label} failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
  }

  const label = options?.errorLabel ?? 'Webull request'
  throw new Error(`${label} route not found for candidate paths: ${attempts.join(', ')}`)
}

export async function fetchWebullAccountListBlock(): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const config = getWebullConfigBlock()
  const accessToken = await ensureWebullAccessTokenBlock(config)
  const requestedAt = new Date().toISOString()
  const path = '/openapi/account/list'
  const endpoint = buildEndpointBlock(config.baseUrl, path)
  const response = await signedV2RequestBlock('GET', endpoint, { accessToken })
  const attempts = [`${path} -> HTTP ${response.status}`]

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webull account list failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
  }

  return {
    endpoint,
    requestedAt,
    data: response.data,
    attempts,
  }
}

export async function fetchWebullAccountBalanceBlock(accountId: string): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const normalizedAccountId = accountId.trim()
  if (!normalizedAccountId) {
    throw new Error('Account id is required for account balance request.')
  }

  const config = getWebullConfigBlock()
  const accessToken = await ensureWebullAccessTokenBlock(config)
  const requestedAt = new Date().toISOString()
  const path = '/openapi/assets/balance'
  const endpoint = buildEndpointBlock(config.baseUrl, path, { account_id: normalizedAccountId })
  const response = await signedV2RequestBlock('GET', endpoint, { accessToken })
  const attempts = [`${path}?${new URL(endpoint).searchParams.toString()} -> HTTP ${response.status}`]

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webull account balance failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
  }

  return {
    endpoint,
    requestedAt,
    data: response.data,
    attempts,
  }
}

export async function fetchWebullAccountPositionsBlock(accountId: string): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const normalizedAccountId = accountId.trim()
  if (!normalizedAccountId) {
    throw new Error('Account id is required for positions request.')
  }

  const config = getWebullConfigBlock()
  const candidatePaths = resolvePathCandidatesBlock(config.accountPositionsPath, DEFAULT_ACCOUNT_POSITIONS_CANDIDATE_PATHS_BLOCK)
  return fetchPaginatedPositionsByCandidatePathsBlock(
    config,
    candidatePaths,
    normalizedAccountId,
    'Webull account positions',
  )
}

export async function fetchWebullAssetsAccountBlock(accountId: string): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const normalizedAccountId = accountId.trim()
  if (!normalizedAccountId) {
    throw new Error('Account id is required for assets account request.')
  }

  const config = withOpenApiBaseUrlBlock(getWebullConfigBlock())
  const candidatePaths = resolvePathCandidatesBlock(undefined, DEFAULT_ASSETS_ACCOUNT_CANDIDATE_PATHS_BLOCK)
  try {
    return await fetchByPathCandidatesBlock(config, candidatePaths, {
      continueStatuses: [404, 400, 422],
      errorLabel: 'Webull OpenAPI assets account',
    })
  } catch {
    return fetchByPathCandidatesBlock(config, candidatePaths, {
      query: { account_id: normalizedAccountId },
      continueStatuses: [404, 400, 422],
      errorLabel: 'Webull OpenAPI assets account',
    })
  }
}

export async function fetchWebullAssetsPositionsBlock(accountId: string): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const normalizedAccountId = accountId.trim()
  if (!normalizedAccountId) {
    throw new Error('Account id is required for assets positions request.')
  }

  // Match Python SDK TradeClient.account_v2.get_account_position(account_id):
  // single signed request, no fallback routes, raw payload passthrough.
  const config = getWebullConfigBlock()
  const accessToken = await ensureWebullAccessTokenBlock(config)
  const requestedAt = new Date().toISOString()
  const path = '/openapi/assets/positions'
  const endpoint = buildEndpointBlock(config.baseUrl, path, {
    account_id: normalizedAccountId,
  })
  const response = await signedV2RequestBlock('GET', endpoint, { accessToken })
  const attempts = [`${path}?${new URL(endpoint).searchParams.toString()} -> HTTP ${response.status}`]

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webull OpenAPI assets positions failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
  }

  return {
    endpoint,
    requestedAt,
    data: response.data,
    attempts,
  }
}

export async function fetchWebullStockInstrumentsByTickerIdsBlock(
  tickerIds: string[],
): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const config = getWebullConfigBlock()
  const candidatePaths = resolvePathCandidatesBlock(undefined, DEFAULT_INSTRUMENT_STOCK_BY_TICKER_IDS_CANDIDATE_PATHS_BLOCK)
  return fetchInstrumentByTickerIdsBlock(config, candidatePaths, tickerIds, 'Webull stock instrument lookup')
}

export async function fetchWebullOptionInstrumentsByTickerIdsBlock(
  tickerIds: string[],
): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const config = getWebullConfigBlock()
  const candidatePaths = resolvePathCandidatesBlock(undefined, DEFAULT_INSTRUMENT_OPTION_BY_TICKER_IDS_CANDIDATE_PATHS_BLOCK)
  return fetchInstrumentByTickerIdsBlock(config, candidatePaths, tickerIds, 'Webull option instrument lookup')
}

export async function fetchWebullTradeInstrumentsByIdsBlock(
  instrumentIds: string[],
): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const normalizedIds = Array.from(new Set(
    instrumentIds
      .map(value => value.trim())
      .filter(Boolean),
  ))
  if (normalizedIds.length === 0) {
    throw new Error('Webull trade instrument lookup requires at least one instrument id.')
  }

  const config = getWebullConfigBlock()
  const candidatePaths = resolvePathCandidatesBlock(undefined, DEFAULT_TRADE_INSTRUMENT_CANDIDATE_PATHS_BLOCK)
  const requestedAt = new Date().toISOString()
  const attempts: string[] = []

  const rowsById = new Map<string, Record<string, unknown>>()
  let firstSuccessEndpoint: string | null = null
  let sawRateLimit = false
  const unresolvedIds: string[] = []

  for (const instrumentId of normalizedIds) {
    let resolved = false

    for (const path of candidatePaths) {
      for (const queryFactory of TRADE_INSTRUMENT_QUERY_VARIANTS_BLOCK) {
        const endpoint = buildEndpointBlock(config.baseUrl, path, queryFactory(instrumentId))
        const response = await signedGetBlock(endpoint)
        const queryString = new URL(endpoint).searchParams.toString()
        attempts.push(`${path}?${queryString} -> HTTP ${response.status}`)

        if (response.status >= 200 && response.status < 300) {
          if (!firstSuccessEndpoint) firstSuccessEndpoint = endpoint
          const rows = extractCollectionRowsBlock(response.data)
          if (rows.length > 0) {
            for (const row of rows) {
              const key = firstNonEmptyStringBlock(
                row.instrument_id,
                row.instrumentId,
                row.id,
                instrumentId,
              )
              if (!key) continue
              rowsById.set(key, row)
            }
          } else {
            const single = asRecordBlock(response.data)
            if (single) {
              const key = firstNonEmptyStringBlock(
                single.instrument_id,
                single.instrumentId,
                single.id,
                instrumentId,
              )
              if (key) {
                rowsById.set(key, single)
              }
            }
          }
          resolved = true
          break
        }

        if (response.status === 404 || response.status === 400 || response.status === 422) {
          continue
        }
        if (response.status === 429) {
          sawRateLimit = true
          continue
        }

        throw new Error(`Webull trade instrument lookup failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
      }

      if (resolved) break
    }

    if (!resolved) {
      unresolvedIds.push(instrumentId)
    }
  }

  if (rowsById.size === 0) {
    if (sawRateLimit) {
      throw new Error('Webull trade instrument lookup hit rate limit before resolving any metadata.')
    }
    const sample = unresolvedIds.slice(0, 8).join(',')
    throw new Error(`Webull trade instrument lookup route/params not found for ids. Sample unresolved ids: ${sample}`)
  }

  return {
    endpoint: firstSuccessEndpoint ?? 'not-requested',
    requestedAt,
    data: {
      items: Array.from(rowsById.values()),
      requested_id_count: normalizedIds.length,
      resolved_id_count: rowsById.size,
      unresolved_ids: unresolvedIds,
      rate_limited: sawRateLimit,
    },
    attempts,
  }
}

export async function fetchWebullMarketQuotesBlock(symbols: string[]): Promise<WebullApiResultBlock> {
  assertElectronRuntimeBlock()
  const normalizedSymbols = symbols
    .map(symbol => symbol.trim().toUpperCase())
    .filter(Boolean)

  if (normalizedSymbols.length === 0) {
    throw new Error('At least one quote symbol is required.')
  }

  const config = getWebullConfigBlock()
  const candidatePaths = resolvePathCandidatesBlock(
    config.marketSnapshotPath,
    [
      ...(config.marketQuotesPath ? [config.marketQuotesPath] : []),
      ...DEFAULT_MARKET_QUOTES_CANDIDATE_PATHS_BLOCK,
    ],
  )
  const queryVariants = resolveQuoteQueryVariantsBlock(normalizedSymbols)

  const requestedAt = new Date().toISOString()
  const attempts: string[] = []

  for (const path of candidatePaths) {
    for (const query of queryVariants) {
      const endpoint = buildEndpointBlock(config.baseUrl, path, query)
      const response = await signedGetBlock(endpoint)

      if (response.status >= 200 && response.status < 300) {
        attempts.push(`${path}?${new URL(endpoint).searchParams.toString()} -> HTTP ${response.status}`)
        return {
          endpoint,
          requestedAt,
          data: response.data,
          attempts,
        }
      }

      attempts.push(`${path}?${new URL(endpoint).searchParams.toString()} -> HTTP ${response.status}`)
      if (response.status === 404 || response.status === 400 || response.status === 422) {
        continue
      }

      throw new Error(`Webull market quotes failed at ${path} (HTTP ${response.status}): ${buildErrorPreviewBlock(response.data)}`)
    }
  }

  const sample = attempts.slice(0, 4).join(', ')
  throw new Error(`Webull market quotes route/params not found after ${attempts.length} attempts. Sample: ${sample}`)
}

// An account's orders in a time window, with when each one filled. Webull's
// order history: the current API names it /trading/orders/historical-orders/list
// (start_time / end_time as ISO instants, cursor paging by pagination_key);
// the older one /openapi/account/orders/history (start_date / end_date days).
// Each route is tried with its own parameters; the first that answers wins.
// The raw pages are returned; webullOrderFillsBlock reads them.
export async function fetchWebullOrderHistoryBlock(accountId: string, from: Date, to: Date): Promise<unknown[]> {
  assertElectronRuntimeBlock()
  const account = accountId.trim()
  if (!account) throw new Error('Account id is required for order history.')
  const config = getWebullConfigBlock()
  const accessToken = await ensureWebullAccessTokenBlock(config)
  // Signed the v2 way with the access token, as account list is: the plain
  // signed GET gets 404 on these routes.
  const paths = ['/trading/orders/historical-orders/list', '/openapi/trading/orders/historical-orders/list']
  let path: string | null = null
  let pageSize: number | null = 100
  let calls = 0
  const rowsOf = (d: unknown) => Array.isArray(d) ? d.length : Array.isArray((d as { data?: unknown })?.data) ? (d as { data: unknown[] }).data.length : 0
  const call = async (a: Date, b: Date): Promise<unknown> => {
    if (calls++ > 0) await new Promise(r => setTimeout(r, 1000)) // about one call a second
    const tryPaths = path ? [path] : paths
    const errors: string[] = []
    for (const p of tryPaths) {
      const q = { account_id: account, start_time: a.toISOString(), end_time: b.toISOString(), ...(pageSize ? { page_size: pageSize } : {}) }
      let res = await signedV2RequestBlock('GET', buildEndpointBlock(config.baseUrl, p, q), { accessToken })
      if ((res.status === 400 || res.status === 417) && pageSize) {
        pageSize = null // Webull doesn't take page_size here; ask without it
        res = await signedV2RequestBlock('GET', buildEndpointBlock(config.baseUrl, p, { account_id: account, start_time: a.toISOString(), end_time: b.toISOString() }), { accessToken })
      }
      if (res.status >= 200 && res.status < 300) { path = p; return res.data }
      errors.push(`${p} -> HTTP ${res.status}${res.status === 404 ? '' : `: ${buildErrorPreviewBlock(res.data)}`}`)
    }
    throw new Error(errors.join(' · '))
  }
  // A reply that fills a page may have been cut short (the history has shown no
  // cursor): split that window in half until each piece fits.
  const pages: unknown[] = []
  const walk = async (a: Date, b: Date, depth: number): Promise<void> => {
    const data = await call(a, b)
    const n = rowsOf(data)
    const full = n > 0 && (n === 10 || n === 20 || n === 50 || n === 100)
    if (full && depth < 12 && b.getTime() - a.getTime() > 60 * 60 * 1000) {
      const mid = new Date((a.getTime() + b.getTime()) / 2)
      await walk(a, mid, depth + 1)
      await walk(mid, b, depth + 1)
      return
    }
    pages.push(data)
  }
  await walk(from, to, 0)
  return pages
}

export interface WebullAccessCheckBlock {
  area: string
  /** The path that answered, or the last one tried. */
  path: string
  status: number | null
  ok: boolean
  /** What came back: how many rows, a time, or the error. */
  note: string
}

// One call to each part of the API the app might build on, to see what this
// account's access returns (data, or "Insufficient permission"). Read-only
// calls only; nothing is placed or changed. Each path is tried with and
// without the /openapi prefix, since the docs and the older routes differ.
export async function checkWebullApiAccessBlock(symbol = 'MU'): Promise<WebullAccessCheckBlock[]> {
  assertElectronRuntimeBlock()
  const config = getWebullConfigBlock()
  const accessToken = await ensureWebullAccessTokenBlock(config)
  const list = await signedV2RequestBlock('GET', buildEndpointBlock(config.baseUrl, '/openapi/account/list'), { accessToken })
  const accounts = JSON.stringify(list.data).match(/"account_id"\s*:\s*"([^"]+)"/)
  const accountId = accounts?.[1] ?? ''
  const day = 86400000
  const checks: Array<{ area: string; path: string; query: Record<string, string | number> }> = [
    { area: 'Stock snapshot (real-time?)', path: '/market-data/stocks/snapshots/list', query: { symbols: symbol, category: 'US_STOCK' } },
    { area: 'Open orders', path: '/trading/orders/open-orders/list', query: { account_id: accountId } },
    { area: 'Order history', path: '/trading/orders/historical-orders/list', query: { account_id: accountId, start_time: new Date(Date.now() - 7 * day).toISOString(), end_time: new Date().toISOString() } },
    { area: 'Cash activities', path: '/trading/activities/cash-activities/list', query: { account_id: accountId, start_time: new Date(Date.now() - 30 * day).toISOString(), end_time: new Date().toISOString() } },
    { area: 'Analyst target prices', path: '/market-data/fundamentals/analysis/target-prices/get', query: { symbol, category: 'US_STOCK' } },
    { area: 'Analyst ratings', path: '/market-data/fundamentals/analysis/ratings/get', query: { symbol, category: 'US_STOCK' } },
    { area: 'Insider transactions', path: '/market-data/fundamentals/insider-transactions/list', query: { symbol, category: 'US_STOCK' } },
    { area: '13F institutions', path: '/market-data/fundamentals/institutions/list', query: { keyword: 'Berkshire' } },
    { area: 'Unusual activity', path: '/market-data/screeners/unusual-activities/list', query: { category: 'US_STOCK', count: 5 } },
    { area: 'Stock news', path: '/market-data/news/stock-news/list', query: { symbol, category: 'US_STOCK' } },
    { area: 'Fear & greed', path: '/market-data/screeners/fear-greed-indexes/get', query: { category: 'US_STOCK' } },
    { area: 'Option snapshot (OPRA)', path: '/market-data/options/snapshots/list', query: { symbols: `${symbol}271217C00900000`, category: 'US_OPTION' } },
  ]
  const describe = (data: unknown): string => {
    const text = JSON.stringify(data) ?? ''
    const rows = Array.isArray(data) ? data.length : Array.isArray((data as { data?: unknown })?.data) ? ((data as { data: unknown[] }).data).length : null
    const time = text.match(/"(quote_time|last_trade_time|update_time|date)"\s*:\s*"?([^",}]+)/)
    return [rows !== null ? `${rows} rows` : null, time ? `${time[1]}=${time[2]}` : null, text.slice(0, 160)].filter(Boolean).join(' · ')
  }
  const out: WebullAccessCheckBlock[] = []
  for (const c of checks) {
    let result: WebullAccessCheckBlock = { area: c.area, path: c.path, status: null, ok: false, note: 'not tried' }
    for (const path of [`/openapi${c.path}`, c.path]) {
      try {
        const res = await signedV2RequestBlock('GET', buildEndpointBlock(config.baseUrl, path, c.query), { accessToken })
        result = { area: c.area, path, status: res.status, ok: res.status >= 200 && res.status < 300, note: res.status >= 200 && res.status < 300 ? describe(res.data) : buildErrorPreviewBlock(res.data) }
        if (res.status !== 404) break
      } catch (err) {
        result = { area: c.area, path, status: null, ok: false, note: err instanceof Error ? err.message : String(err) }
      }
    }
    out.push(result)
    await new Promise(r => setTimeout(r, 1100)) // Webull allows about 1 call a second on these
  }
  return out
}

/**
 * One read-only GET to Webull's API (market data, fundamentals, screeners),
 * signed the v2 way with the access token. The path is tried as the docs give
 * it and with the /openapi prefix. Throws with the status and Webull's message.
 */
export async function fetchWebullDataBlock(path: string, query: Record<string, string | number | undefined>): Promise<unknown> {
  assertElectronRuntimeBlock()
  const config = getWebullConfigBlock()
  const accessToken = await ensureWebullAccessTokenBlock(config)
  const errors: string[] = []
  for (const p of [path, `/openapi${path}`]) {
    const res = await signedV2RequestBlock('GET', buildEndpointBlock(config.baseUrl, p, query), { accessToken })
    if (res.status >= 200 && res.status < 300) return res.data
    errors.push(`${p} -> HTTP ${res.status}: ${buildErrorPreviewBlock(res.data)}`)
    if (res.status !== 404) break
  }
  throw new Error(errors.join(' · '))
}
