import {
  STORAGE_KEYS,
  buildSpaceIdBlock,
  getJsonStorageItem,
  getStorageItem,
  getStoredVaultRoot,
  setJsonStorageItem,
  setStorageItem,
} from '@/services/orchestrators/storageOrch'

export type ThinkingSpaceRuntimeOrch = 'electron' | 'ios' | 'android' | 'web' | 'unknown'

export interface ThinkingSpaceRegistryEntryOrch {
  spaceId: string
  root: string
  label: string
  runtime: ThinkingSpaceRuntimeOrch
  createdAt: string
  lastOpenedAt: string
}

function normalizeRootOrch(root: string | null | undefined): string {
  if (typeof root !== 'string') return ''
  return root.trim()
}

function runtimeFromSpaceIdOrch(spaceId: string): ThinkingSpaceRuntimeOrch {
  if (spaceId.startsWith('electron-')) return 'electron'
  if (spaceId.startsWith('ios-')) return 'ios'
  if (spaceId.startsWith('android-')) return 'android'
  if (spaceId.startsWith('web-')) return 'web'
  return 'unknown'
}

function deriveLabelOrch(root: string): string {
  if (root === 'browser-fs') return 'Browser Filesystem'
  if (root === 'web-backend') return 'Web Backend'

  const normalized = root.startsWith('cap-picker:')
    ? root.slice('cap-picker:'.length)
    : root
  const leaf = normalized.split('/').filter(Boolean).pop()
  if (leaf && leaf.trim()) return leaf.trim()
  return normalized || 'Thinking Space'
}

function normalizeEntryOrch(entry: unknown): ThinkingSpaceRegistryEntryOrch | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  const root = normalizeRootOrch(typeof raw.root === 'string' ? raw.root : '')
  const spaceId = typeof raw.spaceId === 'string' && raw.spaceId.trim()
    ? raw.spaceId.trim()
    : (root ? buildSpaceIdBlock(root) : '')
  if (!root || !spaceId) return null
  const now = new Date().toISOString()
  const runtime = runtimeFromSpaceIdOrch(spaceId)
  const label = typeof raw.label === 'string' && raw.label.trim()
    ? raw.label.trim()
    : deriveLabelOrch(root)
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim()
    ? raw.createdAt.trim()
    : now
  const lastOpenedAt = typeof raw.lastOpenedAt === 'string' && raw.lastOpenedAt.trim()
    ? raw.lastOpenedAt.trim()
    : createdAt
  return {
    spaceId,
    root,
    label,
    runtime,
    createdAt,
    lastOpenedAt,
  }
}

function sortEntriesOrch(entries: ThinkingSpaceRegistryEntryOrch[]): ThinkingSpaceRegistryEntryOrch[] {
  return entries.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}

function writeRegistryOrch(entries: ThinkingSpaceRegistryEntryOrch[]): ThinkingSpaceRegistryEntryOrch[] {
  const deduped = new Map<string, ThinkingSpaceRegistryEntryOrch>()
  for (const entry of entries) {
    deduped.set(entry.spaceId, entry)
  }
  const normalized = sortEntriesOrch([...deduped.values()])
  setJsonStorageItem(STORAGE_KEYS.thinkingSpacesRegistry, normalized)
  return normalized
}

export function listThinkingSpacesOrch(): ThinkingSpaceRegistryEntryOrch[] {
  const raw = getJsonStorageItem<unknown[]>(STORAGE_KEYS.thinkingSpacesRegistry, [])
  const entries = raw
    .map(normalizeEntryOrch)
    .filter((entry): entry is ThinkingSpaceRegistryEntryOrch => !!entry)
  return writeRegistryOrch(entries)
}

export function getActiveThinkingSpaceIdOrch(): string | null {
  const raw = getStorageItem(STORAGE_KEYS.thinkingSpacesActiveId)
  if (!raw) return null
  const normalized = raw.trim()
  return normalized.length > 0 ? normalized : null
}

export function setActiveThinkingSpaceOrch(spaceId: string): void {
  const normalized = spaceId.trim()
  if (!normalized) return
  setStorageItem(STORAGE_KEYS.thinkingSpacesActiveId, normalized)
}

export function registerThinkingSpaceOrch(rootInput: string, label?: string | null): ThinkingSpaceRegistryEntryOrch {
  const root = normalizeRootOrch(rootInput)
  if (!root) {
    throw new Error('Cannot register an empty Thinking Space root.')
  }
  const spaceId = buildSpaceIdBlock(root)
  const now = new Date().toISOString()
  const entries = listThinkingSpacesOrch()
  const existingIndex = entries.findIndex(entry => entry.spaceId === spaceId)
  const nextEntry: ThinkingSpaceRegistryEntryOrch = existingIndex >= 0
    ? {
      ...entries[existingIndex],
      root,
      label: (label && label.trim()) || entries[existingIndex].label || deriveLabelOrch(root),
      runtime: runtimeFromSpaceIdOrch(spaceId),
      lastOpenedAt: now,
    }
    : {
      spaceId,
      root,
      label: (label && label.trim()) || deriveLabelOrch(root),
      runtime: runtimeFromSpaceIdOrch(spaceId),
      createdAt: now,
      lastOpenedAt: now,
    }

  const nextEntries = existingIndex >= 0
    ? entries.map((entry, idx) => (idx === existingIndex ? nextEntry : entry))
    : [...entries, nextEntry]
  writeRegistryOrch(nextEntries)
  setActiveThinkingSpaceOrch(spaceId)
  return nextEntry
}

export function migrateThinkingSpaceRegistryOrch(rootInput?: string | null): ThinkingSpaceRegistryEntryOrch[] {
  const root = normalizeRootOrch(rootInput ?? getStoredVaultRoot())
  const existing = listThinkingSpacesOrch()
  if (!root) return existing

  const spaceId = buildSpaceIdBlock(root)
  if (!existing.some(entry => entry.spaceId === spaceId)) {
    registerThinkingSpaceOrch(root)
    return listThinkingSpacesOrch()
  }

  const active = getActiveThinkingSpaceIdOrch()
  if (!active) {
    setActiveThinkingSpaceOrch(spaceId)
  }
  return existing
}
