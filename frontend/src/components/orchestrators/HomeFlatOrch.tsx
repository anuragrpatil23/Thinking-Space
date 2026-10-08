import { useEffect, useRef, useState, type ReactNode } from 'react'
import Starfield from '@/components/lego_blocks/units/StarfieldBlock'
import MoonSceneBlock from '@/components/lego_blocks/units/MoonSceneBlock'
import HomeWelcomeBlock from '@/components/lego_blocks/integrations/HomeWelcomeBlock'
import AiActivityPanelBlock from '@/components/lego_blocks/integrations/AiActivityPanelBlock'
import { HOME_TILE_SHADOW_BLOCK } from '@/components/lego_blocks/units/HomeTileBlock'
import AiActivityHomeTileBlock from '@/components/lego_blocks/integrations/AiActivityHomeTileBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useNavigate } from 'react-router-dom'
import {
  HOME_SECTION_PAGES_BLOCK,
  type HomeSectionBlock,
} from '@/services/lego_blocks/units/homeSectionPagesBlock'
import {
  pushNativeNavigationBlock,
  setNativeNavigationStackBlock,
} from '@/services/lego_blocks/units/topChromeNativeBridgeBlock'
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

function FlatPanel({
  theme,
  tile = false,
  children,
}: {
  theme: CanvasThemeTokens
  /** Holds a phone tile rather than a full card: a little less padding. */
  tile?: boolean
  children: ReactNode
}) {
  return (
    <div
      style={{
        borderRadius: tile ? 22 : 14,
        height: tile ? '100%' : undefined,
        padding: tile ? '22px 20px' : 20,
        background: theme.anchorPanelBg,
        border: `1px solid ${theme.anchorPanelBorder}`,
        boxShadow: tile ? HOME_TILE_SHADOW_BLOCK : theme.anchorPanelShadow,
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
  const navigate = useNavigate()
  const { layout } = useUILayoutBlock()
  const phone = layout.mode === 'phone'
  // The phone stage. Two jobs, both off the render path:
  //  - measure where things rest and where they should land, and hand those
  //    distances to CSS as variables;
  //  - feed scroll progress to CSS as `--p`, at most once a frame.
  // No React state is involved: nothing here may re-render Home mid-motion.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageAreaRef = useRef<HTMLDivElement | null>(null)
  const welcomeGroupRef = useRef<HTMLElement | null>(null)
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const tilesRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!phone) return
    const stage = stageRef.current
    const area = stageAreaRef.current
    const group = welcomeGroupRef.current
    const scene = sceneRef.current
    const tiles = tilesRef.current
    if (!stage || !area || !group || !scene || !tiles) return

    // Landed layout, top to bottom: scene, small greeting, tiles.
    // Generous gaps: the screen is tall, and at 14/18px the scene, greeting
    // and tiles read as one clump crammed into the middle of it.
    const GAP_SCENE_TITLE = 30
    const SMALL_TITLE_H = 24
    const GAP_TITLE_TILES = 36
    const TILES_DROP = 26
    const measure = () => {
      const title = group.querySelector('h1')
      if (!title) return
      const areaH = area.clientHeight
      const sceneH = scene.offsetHeight
      // offsetTop is layout position, untouched by the transforms in play.
      const restTop = group.offsetTop
      const landedH = sceneH + GAP_SCENE_TITLE + SMALL_TITLE_H + GAP_TITLE_TILES + tiles.offsetHeight
      // Above centre, not on it: of the height left over, about a third goes
      // above the group and the rest below, so the scene sits high and the
      // tiles keep clear air between them and the dock.
      const landedTop = Math.max(16, (areaH - landedH) * 0.34)
      stage.style.setProperty('--d-scene', `${landedTop - restTop}px`)
      stage.style.setProperty(
        '--d-title',
        `${landedTop + sceneH + GAP_SCENE_TITLE - (title as HTMLElement).offsetTop}px`,
      )
      // The tiles sit a further step below the greeting than the group's
      // own rhythm puts them. Added here, not to the gap above, so it lowers
      // the tiles without the centring pulling the scene up to compensate.
      stage.style.setProperty(
        '--tiles-top',
        `${landedTop + sceneH + GAP_SCENE_TITLE + SMALL_TITLE_H + GAP_TITLE_TILES + TILES_DROP}px`,
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(area)
    ro.observe(group)
    ro.observe(tiles)

    let scroller: HTMLElement | null = stage.parentElement
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') break
      scroller = scroller.parentElement
    }
    // Where the browser has scroll-driven animations (Safari 26+), CSS runs
    // the whole transition off the scroll position on the compositor and this
    // effect never touches a frame of it — see `.ltm-home-stage` in index.css.
    // A recording of the script-driven version (2026-10-08) showed it updating
    // on every other frame: each tick changed an inherited custom property,
    // which restyled every element on the stage, and crossing the tap
    // threshold re-rendered Home in the middle of the motion. So:
    //  - the only per-scroll work left here is flipping whether the tiles
    //    take taps, written straight to the element, never through state;
    //  - the script-driven path survives as a fallback for a browser without
    //    scroll timelines, and is what sets `--p` there.
    const cssDriven =
      typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()')
    // The transition finishes over the first ~70% of the travel in whichever
    // direction the page is moving, so the snap's long settling tail happens
    // after everything has landed (fallback path; the CSS path encodes the
    // same idea in its animation-range).
    const TRAVEL = 0.7
    const EASE_MS = 40
    let frame = 0
    let lastP = 0
    let forward = true
    let target = 0
    let shown = 0
    let lastT = 0
    let tappable: boolean | null = null
    const readP = () => {
      const span = stage.offsetHeight || 1
      return Math.max(0, Math.min(1, (scroller?.scrollTop ?? 0) / span))
    }
    const setTappable = (on: boolean) => {
      if (on === tappable) return
      tappable = on
      tiles.style.pointerEvents = on ? 'auto' : 'none'
      if (on) tiles.removeAttribute('aria-hidden')
      else tiles.setAttribute('aria-hidden', 'true')
    }
    const tick = (t: number) => {
      frame = 0
      const p = readP()
      if (cssDriven) {
        setTappable(p > 0.6)
        return
      }
      if (p > lastP + 0.0005) forward = true
      else if (p < lastP - 0.0005) forward = false
      lastP = p
      target = forward ? Math.min(1, p / TRAVEL) : Math.max(0, (p - (1 - TRAVEL)) / TRAVEL)
      const dt = lastT ? Math.min(64, t - lastT) : 16
      lastT = t
      shown += (target - shown) * (1 - Math.exp(-dt / EASE_MS))
      if (Math.abs(target - shown) < 0.002) shown = target
      stage.style.setProperty('--p', shown.toFixed(4))
      setTappable(shown > 0.85)
      if (shown !== target) frame = requestAnimationFrame(tick)
      else lastT = 0
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(tick)
    }
    shown = readP()
    if (!cssDriven) stage.style.setProperty('--p', shown.toFixed(4))
    setTappable(shown > 0.85)
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [phone])
  // On the iPhone shell a section's page is a native push: Swift slides it in
  // and shows a back arrow. The stack is set first so it is [home, page] when
  // the push lands — that count is what the back gesture and arrow check (same
  // ordering ThinkingSpaceOrch documents). Anywhere else, or if the bridge
  // rejects, it is a plain route change.
  const openSection = (section: HomeSectionBlock) => {
    const { path } = HOME_SECTION_PAGES_BLOCK[section]
    if (!(layout.surface === 'capacitor-ios' && phone)) {
      navigate(path)
      return
    }
    void (async () => {
      try {
        await setNativeNavigationStackBlock(['/'])
        await pushNativeNavigationBlock(path)
      } catch (err) {
        console.warn(`[Home] native push to ${path} failed, falling back to navigate`, err)
        navigate(path)
      }
    })()
  }

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

      {phone ? (
        // Phone: one pinned stage, driven by the scroll. The page is two
        // screens tall and snaps between them, but nothing on it scrolls away:
        // the stage is sticky, and how far the page has scrolled (0 → 1) is
        // fed to it as `--p`. As it goes, the scene rides up a little at the
        // same size, the greeting shrinks to a caption under it, the mission
        // and quote fade, and the tiles rise in beneath. Everything moves by
        // transform and opacity only, tied to the finger — an earlier cut
        // flipped a timed animation at the half-way point and animated heights
        // and font size, which re-laid the page out every frame and stuttered.
        <div className="ltm-home-snap relative z-10 ltm-page-shell ltm-shell-medium">
          <div className="ltm-home-track relative h-[200svh]">
            {/* The two snap points. They carry no content. */}
            <div aria-hidden className="ltm-home-snap-screen pointer-events-none absolute inset-x-0 top-0 h-[100svh]" />
            <div aria-hidden className="ltm-home-snap-screen pointer-events-none absolute inset-x-0 top-[100svh] h-[100svh]" />

            <div
              ref={stageRef}
              className="ltm-home-stage sticky top-0 h-[100svh] pb-[calc(var(--ltm-safe-top,0px)+1.5rem)]"
            >
              <div ref={stageAreaRef} className="relative h-full">
                {/* Resting layout: scene and welcome, centred. */}
                <div className="flex h-full flex-col justify-center">
                  <header ref={welcomeGroupRef} className="mx-auto w-full max-w-3xl">
                    <div ref={sceneRef} className="ltm-home-scene">
                      <AnimatedScene />
                    </div>
                    <div className="mt-8">
                      <HomeWelcomeBlock theme={theme} showQuote airy stage />
                    </div>
                  </header>
                </div>

                {/* One wide tile and two half tiles, parked where they will
                    land (`--tiles-top`, measured). If the board is empty its
                    tile renders nothing, and the tile left alone on the second
                    row takes the full width instead of half of it. */}
                <div
                  ref={tilesRef}
                  className="ltm-home-tiles absolute inset-x-0 grid grid-cols-2 gap-4 [&>*:last-child:nth-child(even)]:col-span-2"
                >
                  <div className="col-span-2">
                    <FlatPanel theme={theme} tile>
                      <AiActivityHomeTileBlock onOpen={() => openSection('ai-activity')} />
                    </FlatPanel>
                  </div>
                  <FlatPanel theme={theme} tile>
                    <ThisWeekDigestBlock surface="tile" onOpen={() => openSection('worked-on')} />
                  </FlatPanel>
                  <HomeBoardFeedBlock surface="tile" onOpen={() => openSection('board')} />
                </div>
              </div>
            </div>
          </div>

          {/* Anything else Home has to say is a third stop below the stage.
              Both of these can render nothing; `empty:hidden` keeps an empty
              wrapper from adding a blank screen to snap to. */}
          <div className="ltm-home-snap-screen space-y-4 pb-[calc(var(--ltm-safe-bottom,0px)+6rem)] pt-6 empty:hidden">
            <AiLimitsStripBlock
              providers={planUsage.providers}
              theme={theme}
              nowMs={planUsage.nowMs}
              statusLineScriptPath={planUsage.statusLineScriptPath}
              statusLineMode={planUsage.statusLineMode}
              readAtMs={planUsage.readAtMs}
              onRefresh={planUsage.refresh}
            />
            <WakeListBlock theme={theme} />
          </div>
        </div>
      ) : (
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
            statusLineScriptPath={planUsage.statusLineScriptPath}
            statusLineMode={planUsage.statusLineMode}
            readAtMs={planUsage.readAtMs}
            onRefresh={planUsage.refresh}
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
      )}
    </div>
  )
}
