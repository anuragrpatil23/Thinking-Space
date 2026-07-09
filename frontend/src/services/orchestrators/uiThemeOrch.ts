import {
  DEFAULT_UI_COLOR_MODE_ID_BLOCK,
  DEFAULT_UI_THEME_ID_BLOCK,
  normalizeUIColorModeIdBlock,
  normalizeUIThemeIdBlock,
  type UIColorModeId,
  type UIThemeId,
} from '@/services/lego_blocks/units/uiThemeBlock'
import { STORAGE_KEYS, getStorageItem, setStorageItem } from './storageOrch'

interface ApplyUIThemeOptions {
  documentRef?: Document | null
}

function resolveDocument(documentRef?: Document | null): Document | null {
  if (documentRef) return documentRef
  if (typeof document === 'undefined') return null
  return document
}

export function getStoredUIThemeOrch(): UIThemeId {
  return normalizeUIThemeIdBlock(getStorageItem(STORAGE_KEYS.appTheme))
}

export function setStoredUIThemeOrch(themeId: UIThemeId): void {
  setStorageItem(STORAGE_KEYS.appTheme, themeId)
}

export function getStoredUIColorModeOrch(): UIColorModeId {
  return normalizeUIColorModeIdBlock(getStorageItem(STORAGE_KEYS.appColorMode))
}

export function setStoredUIColorModeOrch(colorModeId: UIColorModeId): void {
  setStorageItem(STORAGE_KEYS.appColorMode, colorModeId)
}

const DARK_THEMES: ReadonlySet<UIThemeId> = new Set<UIThemeId>(['ink'])

function isDarkScheme(theme: UIThemeId, colorMode: UIColorModeId): boolean {
  return colorMode === 'dark' || DARK_THEMES.has(theme)
}

// The Electron window's vibrancy material follows nativeTheme, not CSS, so
// the resolved scheme must be mirrored to the main process or the native
// blur stays in the system appearance (dark blur under a light app theme).
// Optional cast instead of extending the global ElectronAPI declaration —
// the method only exists when running in Electron.
function syncNativeColorMode(isDark: boolean): void {
  if (typeof window === 'undefined') return
  const bridge = (window as unknown as {
    electronAPI?: { setNativeColorMode?: (mode: 'light' | 'dark' | 'system') => Promise<void> }
  }).electronAPI
  void bridge?.setNativeColorMode?.(isDark ? 'dark' : 'light')?.catch?.(() => {})
}

function applySchemeClasses(documentRef: Document, isDark: boolean): void {
  syncNativeColorMode(isDark)
  const root = documentRef.documentElement
  root.classList.toggle('dark', isDark)
  root.classList.toggle('theme-dark', isDark)
  root.classList.toggle('theme-light', !isDark)
  root.style.colorScheme = isDark ? 'dark' : 'light'
  if (documentRef.body) {
    documentRef.body.classList.toggle('dark', isDark)
    documentRef.body.classList.toggle('theme-dark', isDark)
    documentRef.body.classList.toggle('theme-light', !isDark)
  }
}

export function applyUIThemeOrch(themeId: UIThemeId, options: ApplyUIThemeOptions = {}): void {
  const documentRef = resolveDocument(options.documentRef)
  if (!documentRef) return

  const normalizedTheme = normalizeUIThemeIdBlock(themeId)
  documentRef.documentElement.setAttribute('data-ltm-theme', normalizedTheme)
  if (documentRef.body) {
    documentRef.body.setAttribute('data-ltm-theme', normalizedTheme)
  }

  const currentColorMode = normalizeUIColorModeIdBlock(
    documentRef.documentElement.getAttribute('data-ltm-color-mode'),
  )
  applySchemeClasses(documentRef, isDarkScheme(normalizedTheme, currentColorMode))
}

export function applyUIColorModeOrch(colorModeId: UIColorModeId, options: ApplyUIThemeOptions = {}): void {
  const documentRef = resolveDocument(options.documentRef)
  if (!documentRef) return

  const normalizedColorMode = normalizeUIColorModeIdBlock(colorModeId)
  const root = documentRef.documentElement

  root.setAttribute('data-ltm-color-mode', normalizedColorMode)
  if (documentRef.body) {
    documentRef.body.setAttribute('data-ltm-color-mode', normalizedColorMode)
  }

  const currentTheme = normalizeUIThemeIdBlock(root.getAttribute('data-ltm-theme'))
  applySchemeClasses(documentRef, isDarkScheme(currentTheme, normalizedColorMode))
}

export function initializeUIThemeOrch(options: ApplyUIThemeOptions = {}): UIThemeId {
  const storedTheme = getStoredUIThemeOrch() || DEFAULT_UI_THEME_ID_BLOCK
  applyUIThemeOrch(storedTheme, options)
  return storedTheme
}

export function initializeUIColorModeOrch(options: ApplyUIThemeOptions = {}): UIColorModeId {
  const storedColorMode = getStoredUIColorModeOrch() || DEFAULT_UI_COLOR_MODE_ID_BLOCK
  applyUIColorModeOrch(storedColorMode, options)
  return storedColorMode
}

export type { UIThemeId } from '@/services/lego_blocks/units/uiThemeBlock'
export type { UIColorModeId } from '@/services/lego_blocks/units/uiThemeBlock'
export { UI_COLOR_MODE_OPTIONS_BLOCK, UI_THEME_OPTIONS_BLOCK } from '@/services/lego_blocks/units/uiThemeBlock'
