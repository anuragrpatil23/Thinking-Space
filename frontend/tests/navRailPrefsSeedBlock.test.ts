import { beforeEach, describe, expect, it } from 'vitest'
import {
  getNavRailPrefsBlock,
  NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK,
  resetNavRailPrefsBlock,
  seedNavRailDefaultsBlock,
  setNavRailItemHiddenBlock,
} from '@/services/lego_blocks/units/navRailPrefsBlock'
import { STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'

function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size },
    },
  })
}

describe('nav rail default seeding', () => {
  beforeEach(() => {
    installLocalStorageMock()
    localStorage.clear()
  })

  it('hides Webull and Tools on a fresh profile', () => {
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden.sort()).toEqual([...NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK].sort())
  })

  it('leaves a profile with prior use untouched, even with no prefs record', () => {
    localStorage.setItem(STORAGE_KEYS.vaultRoot, '/vaults/thinking')
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden).toEqual([])
  })

  it('never overwrites prefs a user already has', () => {
    setNavRailItemHiddenBlock('/vault-graph', true)
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden).toEqual(['/vault-graph'])
  })

  it('is idempotent across launches once a fresh profile starts being used', () => {
    seedNavRailDefaultsBlock()
    setNavRailItemHiddenBlock('/webull', false)
    localStorage.setItem(STORAGE_KEYS.appTheme, 'dark')
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden).toEqual(['/tools'])
  })

  it('resets to the shipped default rather than to everything-visible', () => {
    setNavRailItemHiddenBlock('/thinking-space', true)
    resetNavRailPrefsBlock()
    expect(getNavRailPrefsBlock().hidden.sort()).toEqual([...NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK].sort())
  })
})
