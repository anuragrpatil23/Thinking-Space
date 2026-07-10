import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  UI_COLOR_MODE_OPTIONS_BLOCK,
  UI_THEME_OPTIONS_BLOCK,
  initializeUIColorModeOrch,
  setStoredUIColorModeOrch,
  initializeUIThemeOrch,
  applyResolvedColorModeOrch,
  setStoredUIThemeOrch,
  applyUIThemeOrch,
  resolveColorModeBlock,
  type UIColorModeId,
  type UIResolvedColorMode,
  type UIThemeId,
} from '@/services/orchestrators/uiThemeOrch'
import { isDarkPhaseBlock, useTimeOfDayBlock } from '@/components/lego_blocks/hooks/shared/useTimeOfDayBlock'

interface UIThemeContextValue {
  themeId: UIThemeId
  setThemeId: (themeId: UIThemeId) => void
  /** The user's stored preference — light, dark, or auto. Drives the picker. */
  colorModeId: UIColorModeId
  setColorModeId: (colorModeId: UIColorModeId) => void
  /** The concrete scheme in effect right now (auto resolved by time of day).
   * Everything that asks "is the app currently dark?" should read this. */
  resolvedColorMode: UIResolvedColorMode
}

const defaultTheme = initializeUIThemeOrch()
const defaultColorMode = initializeUIColorModeOrch()

const UIThemeContext = createContext<UIThemeContextValue>({
  themeId: defaultTheme,
  setThemeId: () => {},
  colorModeId: defaultColorMode,
  setColorModeId: () => {},
  resolvedColorMode: resolveColorModeBlock(defaultColorMode, false),
})

export function UIThemeProviderBlock({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<UIThemeId>(defaultTheme)
  const [colorModeId, setColorModeIdState] = useState<UIColorModeId>(defaultColorMode)
  const phase = useTimeOfDayBlock()

  // `auto` tracks the wall clock, so the resolved scheme recomputes whenever
  // the phase crosses the night boundary — flipping the whole app to dark.
  const resolvedColorMode = resolveColorModeBlock(colorModeId, isDarkPhaseBlock(phase))

  const setThemeId = useCallback((nextTheme: UIThemeId) => {
    setThemeIdState(nextTheme)
  }, [])

  const setColorModeId = useCallback((nextColorMode: UIColorModeId) => {
    setColorModeIdState(nextColorMode)
  }, [])

  useEffect(() => {
    setStoredUIThemeOrch(themeId)
    applyUIThemeOrch(themeId)
  }, [themeId])

  // Persist the raw preference; apply the resolved scheme. Split so an `auto`
  // day→night flip re-applies without rewriting storage.
  useEffect(() => {
    setStoredUIColorModeOrch(colorModeId)
  }, [colorModeId])

  useEffect(() => {
    applyResolvedColorModeOrch(resolvedColorMode)
  }, [resolvedColorMode])

  const value = useMemo(
    () => ({
      themeId,
      setThemeId,
      colorModeId,
      setColorModeId,
      resolvedColorMode,
    }),
    [colorModeId, setColorModeId, themeId, setThemeId, resolvedColorMode],
  )

  return (
    <UIThemeContext.Provider value={value}>
      {children}
    </UIThemeContext.Provider>
  )
}

export function useUIThemeBlock(): UIThemeContextValue {
  return useContext(UIThemeContext)
}

export { UI_COLOR_MODE_OPTIONS_BLOCK }
export { UI_THEME_OPTIONS_BLOCK }
export type { UIColorModeId, UIResolvedColorMode, UIThemeId }
