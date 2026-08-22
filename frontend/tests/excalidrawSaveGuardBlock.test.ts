// See docs/contracts/DURABILITY.md.
//
// Real numbers from the iPad failure, 2026-08-22: "The Idea Factory (mindmap
// full text).excalidraw.md" is 4,594,029 characters and 921 elements. The app
// was being killed at stage `api_attached` while opening it — API attached,
// scene not necessarily populated — and the save path reads its elements
// straight from that API.

import { describe, it, expect } from 'vitest'

import {
  excalidrawSaveGuardBlock,
  SHRINK_MIN_LOST_ELEMENTS_BLOCK,
  SHRINK_REFUSE_RATIO_BLOCK,
  SHRINK_MIN_LOST_TEXT_CHARS_BLOCK,
  excalidrawTextCharsBlock,
} from '@/services/lego_blocks/units/excalidrawSaveGuardBlock'

const IDEA_FACTORY_ELEMENTS = 921

describe('the case it was written for', () => {
  it('refuses to auto-save an empty scene over a real drawing', () => {
    const verdict = excalidrawSaveGuardBlock({
      baselineElementCount: IDEA_FACTORY_ELEMENTS,
      nextElementCount: 0,
      trigger: 'auto',
    })
    expect(verdict.allow).toBe(false)
    expect(verdict.allow === false && verdict.reason).toContain('921')
  })

  it('refuses a partially-loaded scene', () => {
    // The API attached and returned a fraction of the file.
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: IDEA_FACTORY_ELEMENTS,
      nextElementCount: 12,
      trigger: 'auto',
    }).allow).toBe(false)
  })
})

describe('ordinary editing is never blocked', () => {
  it('allows growth', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 100, nextElementCount: 140, trigger: 'auto',
    }).allow).toBe(true)
  })

  it('allows an unchanged count', () => {
    // Moving or restyling elements changes the scene without changing the count.
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 100, nextElementCount: 100, trigger: 'auto',
    }).allow).toBe(true)
  })

  it('allows deleting a few things from a big drawing', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: IDEA_FACTORY_ELEMENTS, nextElementCount: 900, trigger: 'auto',
    }).allow).toBe(true)
  })

  // Deleting three shapes from a five-shape sketch is a 60% drop and entirely
  // normal. The absolute floor is what stops the ratio firing on small scenes.
  it('allows heavy deletion in a small drawing', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 5, nextElementCount: 2, trigger: 'auto',
    }).allow).toBe(true)
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 8, nextElementCount: 1, trigger: 'auto',
    }).allow).toBe(true)
  })

  it('allows a new drawing with nothing on disk yet', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 0, nextElementCount: 0, trigger: 'auto',
    }).allow).toBe(true)
  })
})

describe('an explicit save always wins', () => {
  // A person looking at the canvas can see it is empty. Their judgement beats
  // the heuristic, including "yes, I really did just clear the board".
  it.each([0, 1, 400])('allows clearing to %i elements on explicit save', (next) => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: IDEA_FACTORY_ELEMENTS,
      nextElementCount: next,
      trigger: 'explicit',
    }).allow).toBe(true)
  })
})

describe('threshold boundaries', () => {
  it('holds at exactly the ratio and floor', () => {
    const baseline = 100
    const lost = Math.max(SHRINK_MIN_LOST_ELEMENTS_BLOCK, baseline * SHRINK_REFUSE_RATIO_BLOCK)
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: baseline, nextElementCount: baseline - lost, trigger: 'auto',
    }).allow).toBe(false)
    // One element less lost is under the line.
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: baseline, nextElementCount: baseline - lost + 1, trigger: 'auto',
    }).allow).toBe(true)
  })

  it('needs both the ratio and the floor to refuse', () => {
    // Big ratio, tiny absolute loss.
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 10, nextElementCount: 2, trigger: 'auto',
    }).allow).toBe(true)
    // Big absolute loss, small ratio.
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 1000, nextElementCount: 900, trigger: 'auto',
    }).allow).toBe(true)
  })

  // Zero is special-cased ahead of the ratio: an empty canvas over any
  // non-empty file is refused regardless of how few elements that file had.
  it('refuses emptying even a small drawing on auto-save', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 3, nextElementCount: 0, trigger: 'auto',
    }).allow).toBe(false)
  })
})

describe('the message says what was not done', () => {
  it('states the drawing on disk was left alone', () => {
    const verdict = excalidrawSaveGuardBlock({
      baselineElementCount: IDEA_FACTORY_ELEMENTS, nextElementCount: 0, trigger: 'auto',
    })
    expect(verdict.allow === false && verdict.reason).toMatch(/left untouched/)
  })

  it('points at Save when a shrink might be intentional', () => {
    const verdict = excalidrawSaveGuardBlock({
      baselineElementCount: 200, nextElementCount: 50, trigger: 'auto',
    })
    expect(verdict.allow === false && verdict.reason).toMatch(/use Save/i)
  })
})

describe('content shrink — the count-blind failure', () => {
  // A scene can mount with every element present but their text not yet
  // populated. By element count that is indistinguishable from a healthy save,
  // which is exactly the hole this closes.
  const BOOK_CHARS = 2_195_361

  it('refuses an auto-save whose text collapsed while the count held', () => {
    const verdict = excalidrawSaveGuardBlock({
      baselineElementCount: 921,
      nextElementCount: 921,
      baselineTextChars: BOOK_CHARS,
      nextTextChars: 0,
      trigger: 'auto',
    })
    expect(verdict.allow).toBe(false)
    expect(verdict.allow === false && verdict.reason).toMatch(/left untouched/)
  })

  it('allows ordinary text editing', () => {
    for (const next of [BOOK_CHARS, BOOK_CHARS + 5_000, BOOK_CHARS - 1_500]) {
      expect(excalidrawSaveGuardBlock({
        baselineElementCount: 921, nextElementCount: 921,
        baselineTextChars: BOOK_CHARS, nextTextChars: next, trigger: 'auto',
      }).allow).toBe(true)
    }
  })

  it('does not fire on a small drawing losing a label', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 6, nextElementCount: 6,
      baselineTextChars: 120, nextTextChars: 0, trigger: 'auto',
    }).allow).toBe(true)
  })

  it('needs both the ratio and the character floor', () => {
    // Huge ratio, small absolute loss.
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 10, nextElementCount: 10,
      baselineTextChars: 1_000, nextTextChars: 0, trigger: 'auto',
    }).allow).toBe(true)
    // Large absolute loss, small ratio.
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 10, nextElementCount: 10,
      baselineTextChars: 1_000_000, nextTextChars: 970_000, trigger: 'auto',
    }).allow).toBe(true)
  })

  it('an explicit save still wins', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 921, nextElementCount: 921,
      baselineTextChars: BOOK_CHARS, nextTextChars: 0, trigger: 'explicit',
    }).allow).toBe(true)
  })

  it('skips the check when no counts are supplied', () => {
    expect(excalidrawSaveGuardBlock({
      baselineElementCount: 921, nextElementCount: 921, trigger: 'auto',
    }).allow).toBe(true)
  })

  it('has a floor low enough to be meaningful', () => {
    expect(SHRINK_MIN_LOST_TEXT_CHARS_BLOCK).toBeLessThanOrEqual(5_000)
  })
})

describe('excalidrawTextCharsBlock', () => {
  it('sums only text elements', () => {
    expect(excalidrawTextCharsBlock([
      { type: 'text', text: 'hello' },
      { type: 'freedraw' },
      { type: 'text', text: 'world!' },
      { type: 'rectangle', text: 'ignored' },
    ])).toBe(11)
  })

  it('tolerates malformed elements', () => {
    expect(excalidrawTextCharsBlock([
      null as unknown as { type?: unknown },
      { type: 'text' },
      { type: 'text', text: 42 as unknown as string },
    ])).toBe(0)
  })
})
