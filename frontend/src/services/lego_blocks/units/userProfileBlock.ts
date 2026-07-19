import {
  STORAGE_KEYS,
  getJsonStorageItem,
  setJsonStorageItem,
} from '@/services/lego_blocks/units/storageKeyBlock'

export interface UserProfileBlock {
  name: string
  symbol: string
  memories: string[]
  createdAt: string
  updatedAt: string
}

export interface UserProfilePatchBlock {
  name?: string
  symbol?: string
  memories?: string[]
}

export const USER_PROFILE_DIR_PATH_BLOCK = '.thinking-space'
export const USER_PROFILE_FILE_PATH_BLOCK = `${USER_PROFILE_DIR_PATH_BLOCK}/profile.json`

const DEFAULT_USER_NAME_BLOCK = 'You'

function normalizeIsoTimestampBlock(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return fallback
  return parsed.toISOString()
}

export function deriveUserProfileSymbolBlock(name: string): string {
  const tokens = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (tokens.length === 0) return DEFAULT_USER_NAME_BLOCK[0]
  const first = Array.from(tokens[0])[0]
  return (first ?? DEFAULT_USER_NAME_BLOCK[0]).toUpperCase()
}

function normalizeUserNameBlock(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_USER_NAME_BLOCK
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return DEFAULT_USER_NAME_BLOCK
  return trimmed.slice(0, 72)
}

function normalizeUserSymbolBlock(value: unknown, fallbackName: string): string {
  if (typeof value !== 'string') return deriveUserProfileSymbolBlock(fallbackName)
  const trimmed = value.trim()
  if (!trimmed) return deriveUserProfileSymbolBlock(fallbackName)
  return Array.from(trimmed).slice(0, 2).join('')
}

function normalizeMemoriesBlock(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const next = item.trim()
    if (!next) continue
    const normalized = next.slice(0, 600)
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
    if (output.length >= 200) break
  }
  return output
}

export function getDefaultUserProfileBlock(): UserProfileBlock {
  const now = new Date().toISOString()
  return {
    name: DEFAULT_USER_NAME_BLOCK,
    symbol: deriveUserProfileSymbolBlock(DEFAULT_USER_NAME_BLOCK),
    memories: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function sanitizeUserProfileBlock(
  raw: Partial<UserProfileBlock> | null | undefined,
  previous?: UserProfileBlock | null,
): UserProfileBlock {
  const fallback = previous ?? getDefaultUserProfileBlock()
  const name = normalizeUserNameBlock(raw?.name ?? fallback.name)
  const symbol = normalizeUserSymbolBlock(raw?.symbol ?? fallback.symbol, name)
  const memories = normalizeMemoriesBlock(raw?.memories ?? fallback.memories)
  const createdAt = normalizeIsoTimestampBlock(raw?.createdAt ?? fallback.createdAt, fallback.createdAt)
  const updatedAt = normalizeIsoTimestampBlock(raw?.updatedAt ?? fallback.updatedAt, new Date().toISOString())
  return {
    name,
    symbol,
    memories,
    createdAt,
    updatedAt,
  }
}

export function applyUserProfilePatchBlock(
  current: UserProfileBlock,
  patch: UserProfilePatchBlock,
): UserProfileBlock {
  const next = sanitizeUserProfileBlock(
    {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    current,
  )
  return next
}

/** True when the profile carries no user-entered content (fresh install). */
export function isDefaultUserProfileBlock(profile: UserProfileBlock): boolean {
  return profile.name === DEFAULT_USER_NAME_BLOCK && profile.memories.length === 0
}

export function readCachedUserProfileBlock(): UserProfileBlock {
  const raw = getJsonStorageItem<Partial<UserProfileBlock> | null>(
    STORAGE_KEYS.userProfileCache,
    null,
  )
  return sanitizeUserProfileBlock(raw)
}

export function writeCachedUserProfileBlock(profile: UserProfileBlock): UserProfileBlock {
  const sanitized = sanitizeUserProfileBlock(profile)
  setJsonStorageItem(STORAGE_KEYS.userProfileCache, sanitized)
  return sanitized
}

export function getUserCommentAuthorBlock(): string {
  return readCachedUserProfileBlock().name
}

export function isCurrentUserAuthorBlock(author: string | undefined): boolean {
  const normalizedAuthor = (author ?? '').trim().toLowerCase()
  if (!normalizedAuthor) return false
  return normalizedAuthor === readCachedUserProfileBlock().name.trim().toLowerCase()
}

export function getCommentAuthorSymbolBlock(author: string | undefined): string | null {
  if (!isCurrentUserAuthorBlock(author)) return null
  return readCachedUserProfileBlock().symbol
}
