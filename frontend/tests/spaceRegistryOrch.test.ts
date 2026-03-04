import { beforeEach, describe, expect, it } from 'vitest'
import {
  getActiveThinkingSpaceIdOrch,
  listThinkingSpacesOrch,
  migrateThinkingSpaceRegistryOrch,
  registerThinkingSpaceOrch,
} from '@/services/orchestrators/spaceRegistryOrch'
import { STORAGE_KEYS, buildSpaceIdBlock, setStorageItem } from '@/services/orchestrators/storageOrch'

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      const keys = [...store.keys()]
      return keys[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  } as Storage
}

describe('spaceRegistryOrch', () => {
  beforeEach(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: createMemoryLocalStorage(),
        configurable: true,
        writable: true,
      })
      return
    }
    globalThis.localStorage.clear()
  })

  it('registers a thinking space with deterministic identity and active pointer', () => {
    const entry = registerThinkingSpaceOrch('/tmp/work-notes')
    const all = listThinkingSpacesOrch()

    expect(all).toHaveLength(1)
    expect(entry.spaceId).toBe(buildSpaceIdBlock('/tmp/work-notes'))
    expect(all[0]?.root).toBe('/tmp/work-notes')
    expect(all[0]?.runtime).toBe('unknown')
    expect(getActiveThinkingSpaceIdOrch()).toBe(entry.spaceId)
  })

  it('updates existing registry entry on re-register', async () => {
    const first = registerThinkingSpaceOrch('/tmp/work-notes', 'Work')
    await new Promise(resolve => setTimeout(resolve, 1))
    const second = registerThinkingSpaceOrch('/tmp/work-notes', 'Work Updated')

    const all = listThinkingSpacesOrch()
    expect(all).toHaveLength(1)
    expect(second.spaceId).toBe(first.spaceId)
    expect(all[0]?.label).toBe('Work Updated')
    expect(all[0]?.lastOpenedAt >= first.lastOpenedAt).toBe(true)
  })

  it('migrates legacy single-root storage into registry', () => {
    setStorageItem(STORAGE_KEYS.vaultRoot, '/tmp/migrated-space')
    const migrated = migrateThinkingSpaceRegistryOrch()

    expect(migrated).toHaveLength(1)
    expect(migrated[0]?.root).toBe('/tmp/migrated-space')
    expect(migrated[0]?.spaceId).toBe(buildSpaceIdBlock('/tmp/migrated-space'))
    expect(getActiveThinkingSpaceIdOrch()).toBe(buildSpaceIdBlock('/tmp/migrated-space'))
  })
})
