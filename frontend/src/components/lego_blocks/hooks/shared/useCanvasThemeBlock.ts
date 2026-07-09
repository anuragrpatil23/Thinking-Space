import { useUIThemeBlock } from '@/components/lego_blocks/units/UIThemeBlock'
import { useTimeOfDayBlock } from './useTimeOfDayBlock'

export interface CanvasThemeTokens {
  /** Visual darkness — drives whether tiles use light or dark glass. */
  isDark: boolean
  outerBg: string
  showStars: boolean
  starColor: string
  showNebula: boolean
  /** Complete `background-image` string for the nebula layer. */
  nebulaGradient: string
  /** Complete `background` string for the bottom vignette layer; null = no vignette. */
  vignetteGradient: string | null
  boardBorder: string
  boardGlow: string
  bloomDot: string
  /** CSS mix-blend-mode for the aurora edge flash. 'screen' on dark backdrops
   * (adds light, classic northern-lights vibe); 'multiply' on light backdrops
   * (translucent aurora staining the cream — screen would be invisible). */
  edgeBlend: 'screen' | 'multiply' | 'normal'
  tileBg: string
  tileBorder: string
  tileBorderFocused: string
  tileShadow: string
  tileShadowFocused: string
  tileText: string
  tileTextMuted: string
  toolbarBg: string
  toolbarBorder: string
  toolbarText: string
  toolbarTextMuted: string
  toolbarHighlight: string
  popoverBg: string
  popoverBorder: string
  popoverText: string
  popoverTextMuted: string
  popoverHighlight: string
  minimapBg: string
  minimapBorder: string
  minimapViewport: string
  minimapViewportFill: string
  anchorPanelBg: string
  anchorPanelBorder: string
  anchorPanelShadow: string
  anchorHeading: string
  anchorEyebrow: string
}

// One nebula set per phase, shared by both light and dark modes.
// Opacities tuned to read on both cream and cosmic-black backdrops.
const DAY_NEBULA = [
  'radial-gradient(1200px 600px at 20% -10%, rgba(59,130,246,0.20), transparent 40%)',
  'radial-gradient(900px 500px at 80% 0%, rgba(168,85,247,0.13), transparent 55%)',
  'radial-gradient(800px 500px at 50% 100%, rgba(245,158,11,0.10), transparent 55%)',
].join(', ')

const GOLDEN_NEBULA = [
  'radial-gradient(1200px 600px at 20% -10%, rgba(251,191,36,0.12), transparent 60%)',
  'radial-gradient(900px 500px at 80% 0%, rgba(244,114,182,0.10), transparent 55%)',
  'radial-gradient(800px 500px at 50% 100%, rgba(217,119,87,0.08), transparent 55%)',
].join(', ')

const NIGHT_NEBULA = [
  'radial-gradient(1200px 600px at 20% -10%, rgba(99,102,241,0.22), transparent 60%)',
  'radial-gradient(900px 500px at 80% 0%, rgba(168,85,247,0.16), transparent 55%)',
  'radial-gradient(800px 500px at 50% 100%, rgba(56,189,248,0.13), transparent 55%)',
].join(', ')

function nebulaForPhase(phase: 'day' | 'golden' | 'night'): string {
  if (phase === 'golden') return GOLDEN_NEBULA
  if (phase === 'night') return NIGHT_NEBULA
  return DAY_NEBULA
}

const DARK_VIGNETTE =
  'linear-gradient(to bottom, rgba(10,10,12,0.05) 0%, rgba(10,10,12,0) 30%, rgba(10,10,12,0) 70%, rgba(10,10,12,0.5) 100%)'

const NIGHT_VIGNETTE =
  'linear-gradient(to bottom, rgba(11,18,40,0.05) 0%, rgba(11,18,40,0) 30%, rgba(11,18,40,0) 70%, rgba(11,18,40,0.55) 100%)'

const DAY_VIGNETTE =
  'linear-gradient(to bottom, rgba(246,239,224,0.1) 0%, rgba(246,239,224,0) 30%, rgba(246,239,224,0) 70%, rgba(246,239,224,0.55) 100%)'

const GOLDEN_VIGNETTE =
  'linear-gradient(to bottom, rgba(245,232,205,0.1) 0%, rgba(245,232,205,0) 30%, rgba(245,232,205,0) 70%, rgba(245,232,205,0.6) 100%)'

// Cosmic-black base recipe. Not returned directly anymore — NIGHT extends it
// and is what both explicit dark mode and the light-mode night phase render.
const DARK: CanvasThemeTokens = {
  isDark: true,
  outerBg: '#0a0a0c',
  showStars: true,
  starColor: '#c7d2fe',
  showNebula: true,
  nebulaGradient: DAY_NEBULA, // placeholder; overridden by phase at hook time
  vignetteGradient: DARK_VIGNETTE,
  boardBorder: 'rgba(255,255,255,0.14)',
  boardGlow: 'inset 0 0 0 1px rgba(255,255,255,0.03), 0 0 80px rgba(255,255,255,0.03)',
  bloomDot: 'rgba(255,255,255,0.28)',
  edgeBlend: 'screen',
  tileBg: 'rgba(20, 20, 24, 0.72)',
  tileBorder: 'rgba(255,255,255,0.06)',
  tileBorderFocused: 'rgba(255,255,255,0.18)',
  tileShadow: '0 8px 32px rgba(0,0,0,0.35)',
  tileShadowFocused: '0 12px 40px rgba(0,0,0,0.5)',
  tileText: 'rgba(255,255,255,0.92)',
  tileTextMuted: 'rgba(255,255,255,0.35)',
  toolbarBg: 'rgba(20, 20, 24, 0.85)',
  toolbarBorder: 'rgba(255,255,255,0.08)',
  toolbarText: 'rgba(255,255,255,0.7)',
  toolbarTextMuted: 'rgba(255,255,255,0.45)',
  toolbarHighlight: 'rgba(255,255,255,0.08)',
  popoverBg: 'rgba(20,20,24,0.95)',
  popoverBorder: 'rgba(255,255,255,0.08)',
  popoverText: 'rgba(255,255,255,0.92)',
  popoverTextMuted: 'rgba(255,255,255,0.4)',
  popoverHighlight: 'rgba(255,255,255,0.06)',
  minimapBg: 'rgba(10, 10, 12, 0.85)',
  minimapBorder: 'rgba(255,255,255,0.08)',
  minimapViewport: 'rgba(255,255,255,0.65)',
  minimapViewportFill: 'rgba(255,255,255,0.06)',
  anchorPanelBg: 'rgba(20, 20, 24, 0.55)',
  anchorPanelBorder: 'rgba(255,255,255,0.05)',
  anchorPanelShadow: '0 12px 36px rgba(0,0,0,0.45)',
  anchorHeading: 'rgba(255,255,255,0.95)',
  anchorEyebrow: 'rgba(255,255,255,0.45)',
}

// Light-mode tokens shared between day + golden (only backdrop/nebula change).
const LIGHT_GLASS: Omit<
  CanvasThemeTokens,
  'outerBg' | 'starColor' | 'nebulaGradient' | 'vignetteGradient'
> = {
  isDark: false,
  showStars: true,
  showNebula: true,
  boardBorder: 'rgba(20,20,24,0.16)',
  boardGlow: 'inset 0 0 0 1px rgba(255,255,255,0.7), 0 8px 60px rgba(20,20,24,0.06)',
  bloomDot: 'rgba(20,20,24,0.35)',
  edgeBlend: 'multiply',
  tileBg: 'rgba(255, 255, 255, 0.85)',
  tileBorder: 'rgba(20,20,24,0.08)',
  tileBorderFocused: 'rgba(20,20,24,0.28)',
  tileShadow: '0 6px 20px rgba(20,20,24,0.08)',
  tileShadowFocused: '0 12px 32px rgba(20,20,24,0.14)',
  tileText: 'rgba(20,20,24,0.92)',
  tileTextMuted: 'rgba(20,20,24,0.4)',
  toolbarBg: 'rgba(255, 255, 255, 0.95)',
  toolbarBorder: 'rgba(20,20,24,0.1)',
  toolbarText: 'rgba(20,20,24,0.75)',
  toolbarTextMuted: 'rgba(20,20,24,0.4)',
  toolbarHighlight: 'rgba(20,20,24,0.06)',
  popoverBg: 'rgba(255,255,255,0.98)',
  popoverBorder: 'rgba(20,20,24,0.08)',
  popoverText: 'rgba(20,20,24,0.92)',
  popoverTextMuted: 'rgba(20,20,24,0.45)',
  popoverHighlight: 'rgba(20,20,24,0.05)',
  minimapBg: 'rgba(255, 255, 255, 0.9)',
  minimapBorder: 'rgba(20,20,24,0.1)',
  minimapViewport: 'rgba(20,20,24,0.6)',
  minimapViewportFill: 'rgba(20,20,24,0.05)',
  anchorPanelBg: 'rgba(255, 255, 255, 0.65)',
  anchorPanelBorder: 'rgba(20,20,24,0.06)',
  anchorPanelShadow: '0 8px 24px rgba(20,20,24,0.06)',
  anchorHeading: 'rgba(20,20,24,0.92)',
  anchorEyebrow: 'rgba(20,20,24,0.45)',
}

const DAY: CanvasThemeTokens = {
  ...LIGHT_GLASS,
  outerBg: '#f6efe0',
  starColor: '#a89478',
  nebulaGradient: DAY_NEBULA,
  vignetteGradient: DAY_VIGNETTE,
}

const GOLDEN: CanvasThemeTokens = {
  ...LIGHT_GLASS,
  outerBg: '#f5eede',
  starColor: '#a89478',
  nebulaGradient: GOLDEN_NEBULA,
  vignetteGradient: GOLDEN_VIGNETTE,
  boardGlow: 'inset 0 0 0 1px rgba(255,255,255,0.55), 0 8px 60px rgba(217,119,87,0.08)',
  edgeBlend: 'multiply',
}

// Midnight-blue night recipe — used for explicit dark mode AND the night phase
// inside light mode. Glass + text follow the dark recipe; the bg is blue-tinted
// because the starfield/nebula/aurora scene reads richer on it than on neutral black.
const NIGHT: CanvasThemeTokens = {
  ...DARK,
  outerBg: '#10182e',
  starColor: '#c7d2fe',
  nebulaGradient: NIGHT_NEBULA, // placeholder; phase override keeps it consistent
  vignetteGradient: NIGHT_VIGNETTE,
  boardBorder: 'rgba(255,255,255,0.12)',
  boardGlow: 'inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 90px rgba(99,102,241,0.06)',
  edgeBlend: 'screen',
}

interface CanvasThemeOptions {
  /** Time-of-day phases (golden/night backdrops) only make sense when the
   * canvas backdrop is actually rendered behind the consumer. Inline surfaces
   * on regular pages must pass false so a light-mode page doesn't flip to the
   * dark night recipe after sunset — they follow the app color mode only. */
  followPhase?: boolean
}

export function useCanvasThemeBlock(options: CanvasThemeOptions = {}): CanvasThemeTokens {
  const { followPhase = true } = options
  const { colorModeId } = useUIThemeBlock()
  const phase = useTimeOfDayBlock()
  const nebulaGradient = nebulaForPhase(phase)
  if (colorModeId === 'dark') return { ...NIGHT, nebulaGradient }
  if (!followPhase) return { ...DAY, nebulaGradient }
  if (phase === 'golden') return { ...GOLDEN, nebulaGradient }
  if (phase === 'night') return { ...NIGHT, nebulaGradient }
  return { ...DAY, nebulaGradient }
}
