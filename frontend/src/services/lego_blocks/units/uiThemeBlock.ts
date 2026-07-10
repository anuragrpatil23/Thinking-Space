export type UIThemeId = 'classic' | 'kraft' | 'ink'
/** Stored preference. `auto` is time-based (not OS-based): it renders like
 * light by day and flips the whole app to dark at night. */
export type UIColorModeId = 'light' | 'dark' | 'auto'
/** Concrete scheme the app actually applies once `auto` is resolved. */
export type UIResolvedColorMode = 'light' | 'dark'

export interface UIThemeOptionBlock {
  id: UIThemeId
  label: string
  description: string
}

export interface UIColorModeOptionBlock {
  id: UIColorModeId
  label: string
  description: string
}

export const DEFAULT_UI_THEME_ID_BLOCK: UIThemeId = 'classic'
export const DEFAULT_UI_COLOR_MODE_ID_BLOCK: UIColorModeId = 'light'

export const UI_THEME_OPTIONS_BLOCK: readonly UIThemeOptionBlock[] = Object.freeze([
  {
    id: 'classic',
    label: 'Classic',
    description: 'The default Thinking Space chrome — neutral grey shell.',
  },
  {
    id: 'kraft',
    label: 'Kraft',
    description: 'Warm taupe chrome that picks up the canvas amber — cohesive, paper-like.',
  },
  {
    id: 'ink',
    label: 'Ink',
    description: 'Deep navy chrome that frames the canvas like paper on a desk.',
  },
])

export const UI_COLOR_MODE_OPTIONS_BLOCK: readonly UIColorModeOptionBlock[] = Object.freeze([
  {
    id: 'light',
    label: 'Light',
    description: 'Bright interface for daytime use.',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Low-light interface across the full app.',
  },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Light by day; the whole app follows the canvas into dark at night.',
  },
])

const VALID_THEME_IDS = new Set<UIThemeId>(UI_THEME_OPTIONS_BLOCK.map(option => option.id))
const VALID_COLOR_MODE_IDS = new Set<UIColorModeId>(UI_COLOR_MODE_OPTIONS_BLOCK.map(option => option.id))

export function isUIThemeIdBlock(value: unknown): value is UIThemeId {
  return typeof value === 'string' && VALID_THEME_IDS.has(value as UIThemeId)
}

export function normalizeUIThemeIdBlock(value: unknown): UIThemeId {
  if (isUIThemeIdBlock(value)) return value
  return DEFAULT_UI_THEME_ID_BLOCK
}

export function isUIColorModeIdBlock(value: unknown): value is UIColorModeId {
  return typeof value === 'string' && VALID_COLOR_MODE_IDS.has(value as UIColorModeId)
}

export function normalizeUIColorModeIdBlock(value: unknown): UIColorModeId {
  if (isUIColorModeIdBlock(value)) return value
  return DEFAULT_UI_COLOR_MODE_ID_BLOCK
}

/**
 * Resolve a stored color-mode preference to the concrete scheme to apply.
 * `auto` becomes dark only when the caller reports a dark time phase (see
 * isDarkPhaseBlock in timeOfDayBlock); `light`/`dark` are honored as-is.
 */
export function resolveColorModeBlock(
  preference: UIColorModeId,
  isDarkPhase: boolean,
): UIResolvedColorMode {
  if (preference === 'auto') return isDarkPhase ? 'dark' : 'light'
  return preference
}
