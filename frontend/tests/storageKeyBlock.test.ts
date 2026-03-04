import { beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEYS, buildSpaceIdBlock, getStorageItem, setStorageItem } from '@/services/orchestrators/storageOrch'

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

describe('storageKeyBlock', () => {
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

  it('does not alias non-vault global keys to vault root in electron-aware reads', () => {
    setStorageItem(STORAGE_KEYS.vaultRoot, '/tmp/space-a')
    setStorageItem(STORAGE_KEYS.thinkingSpacesRegistry, '[{"spaceId":"s1"}]')

    expect(getStorageItem(STORAGE_KEYS.thinkingSpacesRegistry)).toBe('[{"spaceId":"s1"}]')
  })

  it('isolates scoped keys per active thinking space', () => {
    setStorageItem(STORAGE_KEYS.vaultRoot, '/tmp/space-a')
    setStorageItem(STORAGE_KEYS.appShellTabs, '[{"id":"a","route":"/thinking-space"}]')

    setStorageItem(STORAGE_KEYS.vaultRoot, '/tmp/space-b')
    expect(getStorageItem(STORAGE_KEYS.appShellTabs)).toBeNull()
    setStorageItem(STORAGE_KEYS.appShellTabs, '[{"id":"b","route":"/thinking-space"}]')

    setStorageItem(STORAGE_KEYS.vaultRoot, '/tmp/space-a')
    expect(getStorageItem(STORAGE_KEYS.appShellTabs)).toBe('[{"id":"a","route":"/thinking-space"}]')

    setStorageItem(STORAGE_KEYS.vaultRoot, '/tmp/space-b')
    expect(getStorageItem(STORAGE_KEYS.appShellTabs)).toBe('[{"id":"b","route":"/thinking-space"}]')
  })

  it('prefers explicit active space id for scoped key resolution', () => {
    setStorageItem(STORAGE_KEYS.vaultRoot, '/tmp/space-a')
    setStorageItem(STORAGE_KEYS.appShellTabs, '[{"id":"a","route":"/thinking-space"}]')

    setStorageItem(STORAGE_KEYS.thinkingSpacesActiveId, 'space-manual-b')
    expect(getStorageItem(STORAGE_KEYS.appShellTabs)).toBeNull()

    setStorageItem(STORAGE_KEYS.appShellTabs, '[{"id":"b","route":"/new-thought"}]')
    expect(getStorageItem(STORAGE_KEYS.appShellTabs)).toBe('[{"id":"b","route":"/new-thought"}]')

    setStorageItem(STORAGE_KEYS.thinkingSpacesActiveId, buildSpaceIdBlock('/tmp/space-a'))
    expect(getStorageItem(STORAGE_KEYS.appShellTabs)).toBe('[{"id":"a","route":"/thinking-space"}]')
  })
})
