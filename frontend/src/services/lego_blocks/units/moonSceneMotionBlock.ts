import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'

// Body-level animations replace the idle bob/wiggle; arm-level ones (wave,
// cheer) keep the body idle and only override the arm overlays. Skate/run
// additionally shuttle the outer wrapper so the speech bubble travels along.
export const MSG_BODY_ANIMATION: Partial<Record<MoonSceneAnimationBlock, string>> = {
  dance: 'moon-msg-dance 0.9s ease-in-out infinite',
  hop: 'moon-msg-hop 1.6s ease-in-out infinite',
  spin: 'moon-msg-spin 2.4s linear infinite',
  skate: 'moon-msg-skate-tilt 1.25s ease-in-out infinite alternate',
  run: 'moon-msg-run-face 3.2s steps(1) infinite',
  float: 'moon-msg-float 4s ease-in-out infinite alternate',
  sleep: 'moon-msg-sleep 5s ease-in-out infinite alternate',
  hang: 'moon-msg-hang 2.8s ease-in-out infinite',
  wag: 'moon-msg-wag-walk 6s steps(1) infinite',
  nod: 'moon-msg-nod 1.1s ease-in-out infinite',
  wobble: 'moon-msg-wobble 0.7s ease-in-out infinite alternate',
  stretch: 'moon-msg-stretch 2.4s ease-in-out infinite',
  backflip: 'moon-msg-backflip 1.4s ease-in-out infinite',
}

export const MSG_OUTER_ANIMATION: Partial<Record<MoonSceneAnimationBlock, string>> = {
  skate: 'moon-msg-skate-shuttle 5s ease-in-out infinite',
  run: 'moon-msg-run-shuttle 3.2s linear infinite',
  wag: 'moon-msg-wag-shuttle 6s linear infinite',
}
