// What changed in a drawing since it was loaded.
// See docs/contracts/DURABILITY.md.
//
// The recovery journal for notes stores the whole buffer, because a note is
// small. A drawing is not: the file this was written for is 4,594,029
// characters, and writing that every few seconds would be a stutter rather than
// a safety net.
//
// It is also unnecessary. Measured on that file:
//
//   text        248 elements   2,195,361 bytes   generated book text
//   freedraw    178 elements     524,732 bytes   the user's annotations
//   arrow       247 elements     177,664 bytes   generated scaffold
//   rectangle   248 elements     131,469 bytes   generated scaffold
//
// The part at risk during a reading session is the freedraw layer — what gets
// annotated on top of a mindmap that was generated once and never edited. So
// the journal stores a delta against the scene as loaded, and recovery is
// "the file on disk, plus what you did to it".
//
// Excalidraw increments `version` on every element mutation, so change
// detection is a number comparison rather than a deep compare of an 8KB text
// element.

export interface ExcalidrawElementLikeBlock {
  id: string
  version?: number
  [key: string]: unknown
}

export interface ExcalidrawSceneDeltaBlock {
  /** Ids of the current scene in z-order. Cheap (~20KB for 921 elements) and
   *  the only way a reorder survives — a delta of changed elements alone
   *  cannot express "these two swapped depth". */
  order: string[]
  /** Elements that are new or whose `version` moved. */
  changed: ExcalidrawElementLikeBlock[]
}

function byIdBlock(
  elements: readonly ExcalidrawElementLikeBlock[],
): Map<string, ExcalidrawElementLikeBlock> {
  const map = new Map<string, ExcalidrawElementLikeBlock>()
  for (const element of elements) {
    if (element && typeof element.id === 'string') map.set(element.id, element)
  }
  return map
}

/** Everything `current` has that `baseline` does not.
 *
 *  Deletions need no explicit list: `order` is the complete membership of the
 *  current scene, so anything absent from it is gone by construction. */
export function computeExcalidrawDeltaBlock(
  baseline: readonly ExcalidrawElementLikeBlock[],
  current: readonly ExcalidrawElementLikeBlock[],
): ExcalidrawSceneDeltaBlock {
  const baseById = byIdBlock(baseline)
  const order: string[] = []
  const changed: ExcalidrawElementLikeBlock[] = []
  for (const element of current) {
    if (!element || typeof element.id !== 'string') continue
    order.push(element.id)
    const previous = baseById.get(element.id)
    if (!previous) {
      changed.push(element)
      continue
    }
    // `version` is Excalidraw's own mutation counter. Falling back to a
    // reference check keeps this correct for anything that does not carry one
    // rather than silently treating it as unchanged.
    const sameVersion = typeof element.version === 'number'
      && typeof previous.version === 'number'
      && element.version === previous.version
    if (!sameVersion && element !== previous) changed.push(element)
  }
  return { order, changed }
}

/** Rebuild the current scene from the file on disk plus the delta.
 *
 *  Ids in `order` with no element anywhere are dropped rather than throwing:
 *  a recovery path that refuses to produce anything is worse than one that
 *  produces everything it can. */
export function applyExcalidrawDeltaBlock(
  baseline: readonly ExcalidrawElementLikeBlock[],
  delta: ExcalidrawSceneDeltaBlock,
): ExcalidrawElementLikeBlock[] {
  const baseById = byIdBlock(baseline)
  const changedById = byIdBlock(delta.changed)
  const out: ExcalidrawElementLikeBlock[] = []
  for (const id of delta.order) {
    const element = changedById.get(id) ?? baseById.get(id)
    if (element) out.push(element)
  }
  return out
}

/** Rough serialized size of a delta, for deciding whether it is worth writing
 *  and for reporting what a recovery is offering. */
export function excalidrawDeltaSizeBlock(delta: ExcalidrawSceneDeltaBlock): number {
  return JSON.stringify(delta).length
}

/** Does this delta represent any real work? An `order`-only delta (pure
 *  reorder) still counts; an empty one does not. */
export function excalidrawDeltaHasWorkBlock(
  baseline: readonly ExcalidrawElementLikeBlock[],
  delta: ExcalidrawSceneDeltaBlock,
): boolean {
  if (delta.changed.length > 0) return true
  if (delta.order.length !== baseline.length) return true
  for (let index = 0; index < delta.order.length; index += 1) {
    if (delta.order[index] !== baseline[index]?.id) return true
  }
  return false
}
