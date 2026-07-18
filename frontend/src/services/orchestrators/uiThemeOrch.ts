import {
  DEFAULT_UI_COLOR_MODE_ID_BLOCK,
  DEFAULT_UI_THEME_ID_BLOCK,
  normalizeUIColorModeIdBlock,
  normalizeUIThemeIdBlock,
  resolveColorModeBlock,
  type UIColorModeId,
  type UIResolvedColorMode,
  type UIThemeId,
} from '@/services/lego_blocks/units/uiThemeBlock'
import { computeTimePhaseBlock, isDarkPhaseBlock } from '@/services/lego_blocks/units/timeOfDayBlock'
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

// Empty string / null means "use the browser default selection color".
export function getStoredSelectionColorOrch(): string {
  return getStorageItem(STORAGE_KEYS.appSelectionColor) ?? ''
}

export function setStoredSelectionColorOrch(color: string): void {
  setStorageItem(STORAGE_KEYS.appSelectionColor, color)
}

/**
 * Drive the `::selection` background via a CSS custom property. When the color
 * is empty we remove the var entirely so the `::selection` rule's declaration
 * becomes invalid and the browser falls back to its native highlight.
 */
export function applySelectionColorOrch(color: string, options: ApplyUIThemeOptions = {}): void {
  const documentRef = resolveDocument(options.documentRef)
  if (!documentRef) return
  const root = documentRef.documentElement
  if (color) {
    root.style.setProperty('--ltm-selection-color', color)
  } else {
    root.style.removeProperty('--ltm-selection-color')
  }
}

export function initializeSelectionColorOrch(options: ApplyUIThemeOptions = {}): string {
  const stored = getStoredSelectionColorOrch()
  applySelectionColorOrch(stored, options)
  return stored
}

export function setStoredUIColorModeOrch(colorModeId: UIColorModeId): void {
  setStorageItem(STORAGE_KEYS.appColorMode, colorModeId)
}

const DARK_THEMES: ReadonlySet<UIThemeId> = new Set<UIThemeId>(['ink'])

function isDarkScheme(theme: UIThemeId, colorMode: UIResolvedColorMode): boolean {
  return colorMode === 'dark' || DARK_THEMES.has(theme)
}

/** Resolve a stored preference against the current wall-clock phase. */
function resolveStoredColorMode(colorMode: UIColorModeId): UIResolvedColorMode {
  return resolveColorModeBlock(colorMode, isDarkPhaseBlock(computeTimePhaseBlock()))
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

  // The attribute always holds an already-resolved scheme (light/dark), so
  // resolving here is a no-op for those and only guards a stray `auto`.
  const currentColorMode = resolveStoredColorMode(
    normalizeUIColorModeIdBlock(documentRef.documentElement.getAttribute('data-ltm-color-mode')),
  )
  applySchemeClasses(documentRef, isDarkScheme(normalizedTheme, currentColorMode))
}

/**
 * Apply an already-resolved scheme. Callers own `auto` resolution (via the
 * time phase) so this stays a pure DOM writer; the persisted preference —
 * which may be `auto` — is written separately by setStoredUIColorModeOrch.
 */
export function applyResolvedColorModeOrch(
  resolvedColorMode: UIResolvedColorMode,
  options: ApplyUIThemeOptions = {},
): void {
  const documentRef = resolveDocument(options.documentRef)
  if (!documentRef) return

  const root = documentRef.documentElement

  root.setAttribute('data-ltm-color-mode', resolvedColorMode)
  if (documentRef.body) {
    documentRef.body.setAttribute('data-ltm-color-mode', resolvedColorMode)
  }

  const currentTheme = normalizeUIThemeIdBlock(root.getAttribute('data-ltm-theme'))
  applySchemeClasses(documentRef, isDarkScheme(currentTheme, resolvedColorMode))
}

export function initializeUIThemeOrch(options: ApplyUIThemeOptions = {}): UIThemeId {
  const storedTheme = getStoredUIThemeOrch() || DEFAULT_UI_THEME_ID_BLOCK
  applyUIThemeOrch(storedTheme, options)
  return storedTheme
}

export function initializeUIColorModeOrch(options: ApplyUIThemeOptions = {}): UIColorModeId {
  const storedColorMode = getStoredUIColorModeOrch() || DEFAULT_UI_COLOR_MODE_ID_BLOCK
  applyResolvedColorModeOrch(resolveStoredColorMode(storedColorMode), options)
  return storedColorMode
}

export type { UIThemeId } from '@/services/lego_blocks/units/uiThemeBlock'
export type { UIColorModeId, UIResolvedColorMode } from '@/services/lego_blocks/units/uiThemeBlock'
export { resolveColorModeBlock } from '@/services/lego_blocks/units/uiThemeBlock'
export { UI_COLOR_MODE_OPTIONS_BLOCK, UI_THEME_OPTIONS_BLOCK } from '@/services/lego_blocks/units/uiThemeBlock'
