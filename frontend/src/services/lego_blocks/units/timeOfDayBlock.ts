/**
 * timeOfDayBlock — pure wall-clock → time-phase logic, shared by the canvas
 * backdrop hook (useTimeOfDayBlock) and the `auto` color-mode resolver
 * (uiThemeOrch). Kept in the service layer so both the component hook and the
 * theme orchestrator resolve the same night boundary instead of duplicating
 * the hour thresholds.
 *
 * Phases:
 *   day    05:00–17:00  bright
 *   golden 17:00–20:00  warm, still a light backdrop
 *   night  20:00–23:00  dark backdrop, idle scene
 *   late   23:00–05:00  dark backdrop + "take a break" wind-down
 *
 * `isDarkPhaseBlock` marks the two phases that render the dark night backdrop;
 * `auto` color mode flips the whole app to dark for exactly those phases.
 */

export type CanvasTimePhase = 'day' | 'golden' | 'night' | 'late'

export function computeTimePhaseBlock(now: Date = new Date()): CanvasTimePhase {
  const h = now.getHours()
  if (h >= 5 && h < 17) return 'day'
  if (h >= 17 && h < 20) return 'golden'
  if (h >= 23 || h < 5) return 'late'
  return 'night'
}

/** True for the phases that use the dark night backdrop (night + late). */
export function isDarkPhaseBlock(phase: CanvasTimePhase): boolean {
  return phase === 'night' || phase === 'late'
}
