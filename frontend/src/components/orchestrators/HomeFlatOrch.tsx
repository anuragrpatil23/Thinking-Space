import type { ReactNode } from 'react'
import Starfield from '@/components/lego_blocks/units/StarfieldBlock'
import HomeWelcomeBlock from '@/components/lego_blocks/integrations/HomeWelcomeBlock'
import AiActivityPanelBlock from '@/components/lego_blocks/integrations/AiActivityPanelBlock'
import ThisWeekDigestBlock from '@/components/lego_blocks/integrations/ThisWeekDigestBlock'
import HomeBoardFeedBlock from '@/components/lego_blocks/integrations/HomeBoardFeedBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import { isCapacitorNative } from '@/services/orchestrators/runtimeOrch'
import type { CanvasThemeTokens } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'

/**
 * The flat (non-spatial) frame for Home — the iOS/web presentation of the same
 * content the spatial canvas anchor renders (`HomeAnchorTileBlock`). Instead of
 * FloatingPanels on a zoomable world, each panel is a plain card in a native
 * scroll column. Content decisions (which panels, in what order) stay shared
 * through the same lego blocks so the two homes can't drift.
 *
 * Frame split: Electron gets the spatial canvas; everything else gets this.
 */
function FlatPanel({ theme, children }: { theme: CanvasThemeTokens; children: ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: 20,
        background: theme.anchorPanelBg,
        border: `1px solid ${theme.anchorPanelBorder}`,
        boxShadow: theme.anchorPanelShadow,
      }}
    >
      {children}
    </div>
  )
}

export default function HomeFlatOrch() {
  const { resolvedColorMode } = useUIThemeBlock()

  // On Capacitor (iPhone) the backdrop follows time-of-day so the flat home
  // picks up the same day/night hues the canvas uses. On web/PWA we follow the
  // app color mode only (`followPhase: false`) so the backdrop always matches
  // the UI — that removes the old readability hazard where a night backdrop
  // sat under light-mode text, so no cream fallback is needed.
  const followPhase = isCapacitorNative()
  const theme = useCanvasThemeBlock({ followPhase })

  // When the resolved backdrop is dark but the app color mode is still light
  // (only on Capacitor, where the phase forces a night backdrop), scope a
  // `dark` class to the Home subtree so the panels' CSS-class text/muted colors
  // flip to readable dark values without touching the rest of the app.
  const scopeDark = theme.isDark && resolvedColorMode !== 'dark'

  return (
    <div className={`relative isolate ltm-page ltm-page-edge-bleed${scopeDark ? ' dark' : ''}`}>
      <div className="ltm-page-fixed-bg-anchor">
        <div className="ltm-page-fixed-bg-canvas" style={{ background: theme.outerBg }}>
          {theme.showNebula && (
            <div className="absolute inset-0" style={{ backgroundImage: theme.nebulaGradient }} />
          )}
          {theme.showStars && <Starfield />}
          {theme.vignetteGradient && (
            <div className="absolute inset-0" style={{ background: theme.vignetteGradient }} />
          )}
        </div>
      </div>

      <div className="relative z-10 ltm-page-shell ltm-shell-medium pt-10 pb-6 sm:pt-16 sm:pb-10 md:pt-24 md:pb-16">
        <header className="mx-auto max-w-3xl">
          <HomeWelcomeBlock showQuote theme={theme} />
        </header>

        <div className="mt-10 space-y-6 sm:mt-12">
          <FlatPanel theme={theme}>
            <AiActivityPanelBlock enableManualSessions />
          </FlatPanel>

          <FlatPanel theme={theme}>
            <ThisWeekDigestBlock />
          </FlatPanel>

          <HomeBoardFeedBlock />
        </div>
      </div>
    </div>
  )
}
