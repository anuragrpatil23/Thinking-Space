import { useEffect, useRef, useState, type ReactNode } from 'react'
import Starfield from '@/components/lego_blocks/units/StarfieldBlock'
import MoonSceneBlock from '@/components/lego_blocks/units/MoonSceneBlock'
import HomeWelcomeBlock from '@/components/lego_blocks/integrations/HomeWelcomeBlock'
import AiActivityPanelBlock from '@/components/lego_blocks/integrations/AiActivityPanelBlock'
import AiLimitsStripBlock from '@/components/lego_blocks/integrations/AiLimitsStripBlock'
import { useAiPlanUsageBlock } from '@/components/lego_blocks/hooks/shared/useAiPlanUsageBlock'
import ThisWeekDigestBlock from '@/components/lego_blocks/integrations/ThisWeekDigestBlock'
import WakeListBlock from '@/components/lego_blocks/integrations/WakeListBlock'
import HomeBoardFeedBlock from '@/components/lego_blocks/integrations/HomeBoardFeedBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import { isCapacitorNative } from '@/services/orchestrators/runtimeOrch'
import { dispatchTopChromeAppearanceBlock } from '@/services/lego_blocks/units/topChromeAppearanceBlock'
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
// The moon scene (astronaut + Clawd) is authored at a fixed 520×240 for canvas
// world-space. In the flat frame we drop it into normal flow and scale it down
// to fit narrow (iPhone) widths, centered, purely decorative. Its canvas-space
// floating quote is disabled here (the wrapper clips at sprite bounds, so it
// would poke under the status bar) — HomeWelcomeBlock renders the daily quote
// in-flow instead.
const SCENE_W = 520
const SCENE_H = 240
function AnimatedScene() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setScale(Math.min(1, el.clientWidth / SCENE_W))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        width: '100%',
        height: SCENE_H * scale,
        overflow: 'hidden',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: SCENE_W,
          height: SCENE_H,
          flex: '0 0 auto',
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
        }}
      >
        <MoonSceneBlock x={0} y={0} showQuote={false} />
      </div>
    </div>
  )
}

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
  const planUsage = useAiPlanUsageBlock()

  // When the resolved backdrop is dark but the app color mode is still light
  // (only on Capacitor, where the phase forces a night backdrop), scope a
  // `dark` class to the Home subtree so the panels' CSS-class text/muted colors
  // flip to readable dark values without touching the rest of the app.
  const scopeDark = theme.isDark && resolvedColorMode !== 'dark'

  // Tell the native iPhone shell the status-bar area is dark while the night
  // backdrop is up, so the clock glyphs go light and the top scrim renders in
  // its dark appearance. Reset on unmount — other routes are light-surface.
  useEffect(() => {
    dispatchTopChromeAppearanceBlock({ dark: theme.isDark })
    return () => dispatchTopChromeAppearanceBlock({ dark: false })
  }, [theme.isDark])

  return (
    <div className={`relative isolate ltm-page ltm-page-edge-bleed${scopeDark ? ' dark' : ''}`}>
      <div className="ltm-page-fixed-bg-anchor">
        <div className="ltm-page-fixed-bg-canvas" style={{ background: theme.outerBg }}>
          {theme.showNebula && (
            <div className="absolute inset-0" style={{ backgroundImage: theme.nebulaGradient }} />
          )}
          {/* Pass the theme's star color, same as CanvasSurfaceOrch. Without
              it the field falls back to Starfield's charcoal default, which on
              the cream paper backdrop read as hard black specks bleeding
              through the panels above (2026-08-02). */}
          {theme.showStars && <Starfield starColor={theme.starColor} />}
          {theme.vignetteGradient && (
            <div className="absolute inset-0" style={{ background: theme.vignetteGradient }} />
          )}
        </div>
      </div>

      <div className="relative z-10 ltm-page-shell ltm-shell-medium pt-10 pb-6 sm:pt-16 sm:pb-10 md:pt-24 md:pb-16">
        <header className="mx-auto max-w-3xl">
          <AnimatedScene />
          <div className="mt-6">
            <HomeWelcomeBlock theme={theme} showQuote />
          </div>
        </header>

        <div className="mt-14 space-y-6 sm:mt-16">
          <AiLimitsStripBlock
            providers={planUsage.providers}
            theme={theme}
            nowMs={planUsage.nowMs}
          />

          <FlatPanel theme={theme}>
            <AiActivityPanelBlock enableManualSessions />
          </FlatPanel>

          <FlatPanel theme={theme}>
            <ThisWeekDigestBlock />
          </FlatPanel>

          <WakeListBlock theme={theme} />

          <HomeBoardFeedBlock />
        </div>
      </div>
    </div>
  )
}
