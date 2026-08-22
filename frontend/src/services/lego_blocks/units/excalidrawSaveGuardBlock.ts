// Refuses to write a drawing that lost most of itself.
// See docs/contracts/DURABILITY.md.
//
// The failure this exists for, observed on iPad 2026-08-22:
//
//   The app is killed while *opening* a large drawing — the crash marker
//   reports stage `api_attached`, meaning the Excalidraw API had attached but
//   the scene was not necessarily populated yet. The save path takes its
//   elements from `api.getSceneElementsBlock()`. If a change is registered in
//   that window, the 2s auto-save fires and serialises whatever the API
//   currently holds over the real file.
//
// The files this happens to are book-length: 4,594,029 characters and 921
// elements for one of them. Overwriting that with an empty scene is not a
// degraded save, it is the whole drawing.
//
// The distinction the guard rests on is **who asked**. An explicit Save is a
// human act by someone looking at the canvas — if it is empty, they can see
// that it is empty. Auto-save is not: it fires on a timer, possibly while the
// scene is still loading, possibly while the app is dying. So auto-save is held
// to a standard explicit saves are not.

export type ExcalidrawSaveTriggerBlock = 'auto' | 'explicit'

export type ExcalidrawSaveVerdictBlock =
  | { allow: true }
  | { allow: false; reason: string }

/** Below this many lost elements, a shrink is ordinary editing whatever the
 *  ratio says — deleting three things from a five-element sketch is 60%. */
export const SHRINK_MIN_LOST_ELEMENTS_BLOCK = 20

/** Fraction of the drawing that must vanish before an auto-save is refused.
 *  Half is deliberately far past normal editing: no one hand-deletes half a
 *  drawing inside one 2s auto-save window. A partially-loaded scene, by
 *  contrast, is usually empty or near it. */
export const SHRINK_REFUSE_RATIO_BLOCK = 0.5

export function excalidrawSaveGuardBlock(options: {
  /** Elements in the file as it was loaded from disk. */
  baselineElementCount: number
  /** Elements the save is about to write. */
  nextElementCount: number
  trigger: ExcalidrawSaveTriggerBlock
}): ExcalidrawSaveVerdictBlock {
  const { baselineElementCount, nextElementCount, trigger } = options

  // Nothing on disk to lose.
  if (baselineElementCount <= 0) return { allow: true }
  // Grew or held steady.
  if (nextElementCount >= baselineElementCount) return { allow: true }

  // A person looking at the canvas asked for this. Their judgement beats the
  // heuristic — including "yes, I really did just clear the board".
  if (trigger === 'explicit') return { allow: true }

  if (nextElementCount === 0) {
    return {
      allow: false,
      reason: `Auto-save was skipped: the canvas is empty but the file holds ${baselineElementCount} element${baselineElementCount === 1 ? '' : 's'}. The drawing on disk was left untouched.`,
    }
  }

  const lost = baselineElementCount - nextElementCount
  if (lost >= SHRINK_MIN_LOST_ELEMENTS_BLOCK
    && lost / baselineElementCount >= SHRINK_REFUSE_RATIO_BLOCK) {
    return {
      allow: false,
      reason: `Auto-save was skipped: the canvas has ${nextElementCount} elements but the file holds ${baselineElementCount}. The drawing on disk was left untouched — use Save if this is intentional.`,
    }
  }

  return { allow: true }
}
