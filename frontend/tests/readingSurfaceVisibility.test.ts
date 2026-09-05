// Guards the wiring, not the arithmetic.
//
// Every Thinking Space workspace tab stays mounted behind `visibility: hidden`
// when you navigate away from it, so a document's `active` prop — which means
// "is this the selected pane *within* this surface" — stays true for a document
// nobody can see. A book opened for a minute and left in a tab therefore kept
// `attending` true for hours: it accrued reading time, held the reading
// foreground away from whatever you were actually looking at, and kept the
// screen wake lock leased (docs/contracts/ENERGY.md: reading holds the display
// awake, nothing else does).
//
// `RouteActivityContextBlock` already carried the missing fact and nothing read
// it. This asserts every reading surface reads it, because the failure is
// silent: the surfaces still render, still measure, and still pass every
// behavioural test that mounts them in isolation — where the context defaults
// to true and the bug cannot reproduce.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SURFACES = [
  'src/components/lego_blocks/integrations/MarkdownDocumentBlock.tsx',
  'src/components/lego_blocks/integrations/PdfDocumentBlock.tsx',
  'src/components/lego_blocks/integrations/RuledNotebookDocumentBlock.tsx',
]

function source(file: string): string {
  return readFileSync(resolve(__dirname, '..', file), 'utf8')
}

describe('reading surfaces respect route visibility', () => {
  it.each(SURFACES)('%s consumes useRouteActivityBlock', file => {
    const src = source(file)
    expect(src).toContain("useRouteActivityBlock")
    expect(src).toMatch(/const\s+surfaceVisible\s*=\s*useRouteActivityBlock\(\)/)
  })

  it.each(SURFACES)('%s gates its reading predicate on surface visibility', file => {
    const src = source(file)
    // Whatever the rest of the predicate is, visibility has to be in it.
    expect(src).toMatch(/surfaceVisible\s*&&/)
  })

  // The two that also lease the wake lock share ONE expression with the reading
  // tracker on purpose, so the two can never disagree about what reading means.
  it('markdown shares one predicate between the wake lock and the tracker', () => {
    const src = source(SURFACES[0])
    expect(src).toMatch(/const attending = surfaceVisible &&/)
    expect(src).toContain('useScreenWakeLockBlock(attending)')
  })
})
