// The crash marker reports that the app died while opening a drawing. It has to
// be trustworthy, because it is the only evidence the user ever sees — and for
// most of 2026-08-22 it was lying: a session with no jetsam kill and a cleanly
// saved 961-element file still reported "exited unexpectedly".

import { describe, it, expect } from 'vitest'

import { excalidrawMarkerActionBlock } from '@/services/lego_blocks/units/excalidrawCrashMarkerBlock'

describe('excalidrawMarkerActionBlock', () => {
  it('records the attach', () => {
    expect(excalidrawMarkerActionBlock({ hasApi: true, everAttached: false }))
      .toEqual({ action: 'mark', stage: 'api_attached' })
  })

  it('records a mount that has not attached yet', () => {
    // The real pre-stabilisation state — if the app dies here, say so.
    expect(excalidrawMarkerActionBlock({ hasApi: false, everAttached: false }))
      .toEqual({ action: 'mark', stage: 'editor_mounting' })
  })

  // The bug. `ExcalidrawDocumentBlock` fires onApiChange(null) from an effect
  // cleanup, so this path runs on every clean close.
  it('clears on teardown after a successful attach', () => {
    expect(excalidrawMarkerActionBlock({ hasApi: false, everAttached: true }))
      .toEqual({ action: 'clear' })
  })

  it('never marks a mount stage once the editor has attached', () => {
    const result = excalidrawMarkerActionBlock({ hasApi: false, everAttached: true })
    expect(result.action === 'mark' && result.stage).not.toBe('editor_mounting')
  })

  it('a full open-then-close cycle leaves nothing behind', () => {
    let everAttached = false
    const steps: string[] = []
    for (const hasApi of [false, true, false]) {
      const result = excalidrawMarkerActionBlock({ hasApi, everAttached })
      if (hasApi) everAttached = true
      else if (result.action === 'clear') everAttached = false
      steps.push(result.action === 'mark' ? result.stage : 'clear')
    }
    expect(steps).toEqual(['editor_mounting', 'api_attached', 'clear'])
  })

  it('a mount that dies before attaching leaves a marker', () => {
    // No teardown runs when the process is killed, so the last action stands.
    const result = excalidrawMarkerActionBlock({ hasApi: false, everAttached: false })
    expect(result).toEqual({ action: 'mark', stage: 'editor_mounting' })
  })
})
