/* Counts "keep scrolling up at the top" for the explorer's easter egg
   (Clawd in ExplorerGreetingBlock): three separate upward scrolls that start with
   the tree already at the top, each within 2s of the last.

   The hard part is "separate". On a Mac trackpad a flick's momentum keeps
   wheel events coming for a second or more, so quick flicks never leave a
   gap: splitting on silence alone (250ms) ran them all into one scroll and
   the hello never came. So a scroll also ends when its deltas have fallen
   off their peak (the coast) and then jump back up — fingers on again.
   Deltas are read as the sum of each one and the one before: Chromium's
   coast repeats and interleaves (36, 36, 34; 3, 1, 3, 1), and fingers
   zig-zag (12, 1, 14, 2); the pair smooths both. */

const QUIET_MS_BLOCK = 250
const WITHIN_MS_BLOCK = 2000
const TAPS_BLOCK = 3

export interface TopNudgeCounterBlock {
  /** One wheel event. `atTop`: the tree's scrollTop is 0. True = say hello. */
  wheel: (deltaY: number, atTop: boolean, now: number) => boolean
  /** One touch gesture already judged a scroll (`up` = toward the top). */
  touch: (up: boolean, atTop: boolean, now: number) => boolean
}

export function createTopNudgeCounterBlock(): TopNudgeCounterBlock {
  let lastAt = -Infinity
  let lastSize = 0
  let peak = 0
  let low = Infinity
  let falling = false
  let taps = 0
  let lastTapAt = -Infinity

  function tapBlock(atTop: boolean, now: number): boolean {
    /* A scroll that started below the top only gets you there. */
    if (!atTop) {
      taps = 0
      return false
    }
    taps = now - lastTapAt <= WITHIN_MS_BLOCK ? taps + 1 : 1
    lastTapAt = now
    if (taps < TAPS_BLOCK) return false
    taps = 0
    return true
  }

  return {
    wheel(deltaY, atTop, now) {
      /* Chromium's empty event on lift, and sideways-only movement. */
      if (deltaY === 0) return false
      const fresh = now - lastAt > QUIET_MS_BLOCK
      lastAt = now
      if (deltaY > 0) {
        taps = 0
        lastSize = 0
        return false
      }
      const size = -deltaY
      const pair = size + (fresh ? 0 : lastSize)
      lastSize = size
      let begins = fresh
      if (!fresh) {
        if (!falling) {
          peak = Math.max(peak, pair)
          if (pair <= peak * 0.7) {
            falling = true
            low = pair
          }
        } else {
          low = Math.min(low, pair)
          if (pair >= Math.max(8, low * 3)) begins = true
        }
      }
      if (!begins) return false
      peak = pair
      low = Infinity
      falling = false
      return tapBlock(atTop, now)
    },
    touch(up, atTop, now) {
      if (!up) {
        taps = 0
        return false
      }
      return tapBlock(atTop, now)
    },
  }
}
