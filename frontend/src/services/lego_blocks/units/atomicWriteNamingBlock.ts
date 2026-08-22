// Naming for crash-safe temp files, renderer side.
// See docs/contracts/DURABILITY.md.
//
// The Electron main process has its own copy of this in
// `electron/src/lego_blocks/atomicWriteBlock.ts` — the two builds cannot import
// from each other. `tests/atomicWriteBlock.test.ts` asserts the two agree, so a
// drift shows up as a failing test rather than as a vault watcher that suddenly
// reports a filesystem event for every save.

export const ATOMIC_TMP_INFIX_BLOCK = '.thinkspc-tmp-'

export const ATOMIC_TMP_PATTERN_BLOCK =
  /(^|[\\/])\.[^\\/]*\.thinkspc-tmp-[0-9]+-[0-9]+-[0-9a-z]+$/

export function isAtomicTempPathBlock(candidate: string): boolean {
  return ATOMIC_TMP_PATTERN_BLOCK.test(candidate)
}

let tempCounterBlock = 0

/** Scratch path for a write to `targetPath`. Same directory — a rename is only
 *  atomic within one filesystem — and dot-prefixed so it stays out of vault
 *  walks that skip hidden files. */
export function atomicTempPathBlock(targetPath: string): string {
  tempCounterBlock += 1
  const slash = targetPath.lastIndexOf('/')
  const dir = slash >= 0 ? targetPath.slice(0, slash + 1) : ''
  const base = slash >= 0 ? targetPath.slice(slash + 1) : targetPath
  const token = Math.random().toString(36).slice(2, 10)
  // `1` stands in for the pid the main process uses; the renderer has none, and
  // the counter plus token already make it unique.
  return `${dir}.${base}${ATOMIC_TMP_INFIX_BLOCK}1-${tempCounterBlock}-${token}`
}

/** The path a temp file was on its way to becoming, or `null` if the name is
 *  not one of ours.
 *
 *  Needed by the sweep: a leftover temp is only safe to delete once its target
 *  is known to exist. On a backend whose rename cannot overwrite, the write has
 *  to delete the target first — and in that window the temp is the *only* copy
 *  of the file. Deleting it there would be the exact loss this all exists to
 *  prevent. */
export function atomicTargetFromTempBlock(tempPath: string): string | null {
  if (!isAtomicTempPathBlock(tempPath)) return null
  const slash = tempPath.lastIndexOf('/')
  const dir = slash >= 0 ? tempPath.slice(0, slash + 1) : ''
  const base = tempPath.slice(slash + 1)
  const infixAt = base.lastIndexOf(ATOMIC_TMP_INFIX_BLOCK)
  if (infixAt <= 0) return null
  // Strip the leading '.' the temp added, and everything from the infix on.
  return `${dir}${base.slice(1, infixAt)}`
}
