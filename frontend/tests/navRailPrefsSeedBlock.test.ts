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
    localStorage.setItem(STORAGE_KEYS.aiSettings, '{"provider":"claude"}')
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden).toEqual([])
  })

  // The bug a real test profile caught: these four are written by a cold boot
  // before anyone has touched anything, so treating them as use made every new
  // profile look like a returning user and load with all tabs showing.
  it('does not mistake cold-boot writes for prior use', () => {
    localStorage.setItem(STORAGE_KEYS.appColorMode, 'light')
    localStorage.setItem(STORAGE_KEYS.appTheme, 'classic')
    localStorage.setItem(`${STORAGE_KEYS.appShellTabs}:window-abc`, '[]')
    localStorage.setItem(`${STORAGE_KEYS.appShellActiveTabId}:window-abc`, 'tab-1')
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden.sort()).toEqual([...NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK].sort())
  })

  it('corrects an untouched record left by the earlier seeding rule', () => {
    localStorage.setItem(STORAGE_KEYS.navRailPrefs, JSON.stringify({ order: [], hidden: [], homePosition: 'bottom' }))
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden.sort()).toEqual([...NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK].sort())
  })

  it('does not re-seed a record the user has customized', () => {
    localStorage.setItem(STORAGE_KEYS.navRailPrefs, JSON.stringify({ order: ['/new-thought'], hidden: [], homePosition: 'bottom' }))
    seedNavRailDefaultsBlock()
    expect(getNavRailPrefsBlock().hidden).toEqual([])
    expect(getNavRailPrefsBlock().order).toEqual(['/new-thought'])
  })

  it('seeds at most once — a later launch leaves the record alone', () => {
    seedNavRailDefaultsBlock()
    setNavRailItemHiddenBlock('/webull', false)
    setNavRailItemHiddenBlock('/tools', false)
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
    expect(getNavRailPrefsBlock().seedVersion).toBe(2)
  })

  it('resets to the shipped default rather than to everything-visible', () => {
    setNavRailItemHiddenBlock('/thinking-space', true)
    resetNavRailPrefsBlock()
    expect(getNavRailPrefsBlock().hidden.sort()).toEqual([...NAV_RAIL_FRESH_INSTALL_HIDDEN_BLOCK].sort())
  })
})
