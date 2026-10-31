import { describe, expect, it } from 'vitest'
import { createTopNudgeCounterBlock } from '@/services/lego_blocks/units/topNudgeCounterBlock'

/* A trackpad flick up: fingers ramp, then the coast decays. 16ms ticks. */
const FLICK = [-2, -6, -14, -28, -40, -36, -36, -30, -24, -18, -12, -8, -5, -3, -1, -3, -1]

function playBlock(counter: ReturnType<typeof createTopNudgeCounterBlock>, deltas: number[], start: number, atTop = true): { hellos: number; end: number } {
  let hellos = 0
  let now = start
  for (const delta of deltas) {
    if (counter.wheel(delta, atTop, now)) hellos += 1
    now += 16
  }
  return { hellos, end: now }
}

describe('topNudgeCounterBlock', () => {
  it('says hello on the third flick at the top, even when the coasts run together', () => {
    const counter = createTopNudgeCounterBlock()
    let t = 0
    let hellos = 0
    for (let i = 0; i < 3; i += 1) {
      const run = playBlock(counter, FLICK, t)
      hellos += run.hellos
      t = run.end // no gap at all between flicks
    }
    expect(hellos).toBe(1)
  })

  it('says hello for three flicks with pauses between them', () => {
    const counter = createTopNudgeCounterBlock()
    let t = 0
    let hellos = 0
    for (let i = 0; i < 3; i += 1) {
      const run = playBlock(counter, FLICK, t)
      hellos += run.hellos
      t = run.end + 600
    }
    expect(hellos).toBe(1)
  })

  it('does not count one long flick as several', () => {
    const counter = createTopNudgeCounterBlock()
    expect(playBlock(counter, [...FLICK, ...FLICK.slice(10), -3, -1, -3, -1, -2, -1], 0).hellos).toBe(0)
  })

  it('does not count the scroll that brings you to the top', () => {
    const counter = createTopNudgeCounterBlock()
    let t = playBlock(counter, FLICK.slice(0, 6), 0, false).end
    t = playBlock(counter, FLICK.slice(6), t).end
    let hellos = 0
    for (let i = 0; i < 2; i += 1) {
      const run = playBlock(counter, FLICK, t)
      hellos += run.hellos
      t = run.end
    }
    expect(hellos).toBe(0)
    expect(playBlock(counter, FLICK, t).hellos).toBe(1)
  })

  it('starts over after scrolling down or waiting too long', () => {
    const counter = createTopNudgeCounterBlock()
    let t = playBlock(counter, FLICK, 0).end
    t = playBlock(counter, FLICK, t).end
    t = playBlock(counter, [4, 8, 4], t + 400).end
    t = playBlock(counter, FLICK, t + 400).end
    t = playBlock(counter, FLICK, t + 400).end
    expect(playBlock(counter, FLICK, t + 3000).hellos).toBe(0)
  })

  it('counts touch scrolls the same way', () => {
    const counter = createTopNudgeCounterBlock()
    expect(counter.touch(true, true, 0)).toBe(false)
    expect(counter.touch(true, true, 500)).toBe(false)
    expect(counter.touch(true, true, 1000)).toBe(true)
  })
})
