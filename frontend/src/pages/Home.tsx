import { Link } from 'react-router-dom'
import Starfield from '@/components/lego_blocks/units/StarfieldBlock'
import TodayFileActivityOrch from '@/components/orchestrators/TodayFileActivityOrch'
import HomeDashboardOrch from '@/components/orchestrators/HomeDashboardOrch'
import AiActivityPanelBlock from '@/components/lego_blocks/integrations/AiActivityPanelBlock'
import { useUserProfileBlock } from '@/components/lego_blocks/hooks/shared/useUserProfileBlock'
import { useDashboardActivityBlock } from '@/components/lego_blocks/hooks/shared/useDashboardActivityBlock'
import { useCanvasThemeBlock } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import { isCapacitorNative } from '@/services/orchestrators/runtimeOrch'

export default function Home() {
  const { profile } = useUserProfileBlock()
  const activity = useDashboardActivityBlock('30d')
  const theme = useCanvasThemeBlock()
  const { resolvedColorMode } = useUIThemeBlock()

  // On Capacitor (iPhone) always honor the time-of-day backdrop so Home picks
  // up the same day/night hues the canvas uses. Elsewhere the dashboard cards
  // use app-wide foreground colors that don't flip unless the UI color mode
  // is dark — so if the backdrop went dark while UI is still light, card text
  // becomes unreadable. Fall back to a soft cream there.
  const backdropMatchesUI =
    isCapacitorNative() ||
    (resolvedColorMode === 'dark' && theme.isDark) ||
    (resolvedColorMode === 'light' && !theme.isDark)
  const bg = backdropMatchesUI ? theme.outerBg : '#f6efe0'
  const showStars = backdropMatchesUI && theme.showStars
  const showNebula = backdropMatchesUI && theme.showNebula
  const vignette = backdropMatchesUI ? theme.vignetteGradient : null

  // If the backdrop is dark but the UI is still in light mode (only happens
  // on Capacitor where we force the time-of-day bg), scope a `dark` class to
  // the Home subtree so card text + muted colors flip to readable dark-mode
  // values without affecting the rest of the app.
  const scopeDark = theme.isDark && resolvedColorMode !== 'dark'

  return (
    <div
      className={`relative isolate ltm-page ltm-page-edge-bleed${scopeDark ? ' dark' : ''}`}
    >
      <div className="ltm-page-fixed-bg-anchor">
        <div className="ltm-page-fixed-bg-canvas" style={{ background: bg }}>
          {showNebula && (
            <div className="absolute inset-0" style={{ backgroundImage: theme.nebulaGradient }} />
          )}
          {showStars && <Starfield />}
          {vignette && (
            <div className="absolute inset-0" style={{ background: vignette }} />
          )}
        </div>
      </div>

      <div className="relative z-10 ltm-page-shell ltm-shell-medium pt-10 pb-6 sm:pt-16 sm:pb-10 md:pt-24 md:pb-16">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground sm:text-sm">
            Thinking Space
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Welcome, {profile.name}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:mt-4 sm:text-lg">
            A calm focused thinking space. Open the side drawer to pick a tool and get started.
          </p>
        </header>

        <div className="mt-10 h-32 sm:mt-12 sm:h-36 md:mt-14 md:h-40" aria-hidden="true" />

        <section>
          <HomeDashboardOrch activity={activity} />
        </section>

        <section className="mt-10">
          <AiActivityPanelBlock />
        </section>

        <section className="mt-10">
          <div className="flex justify-end">
            <Link to="/git-insights" className="text-sm text-muted-foreground hover:text-foreground">
              Open insights
            </Link>
          </div>
          <div className="mt-2">
            <TodayFileActivityOrch
              highlights={activity.series?.highlights ?? null}
              highlightsLoading={activity.loading}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
