// The Electron main process and the renderer each carry their own copy of the
// atomic-temp naming — the two builds cannot import from one another. This test
// is the seam that stops them drifting.
//
// Drift is not cosmetic. The vault watcher's ignore list uses the main-process
// pattern; if the renderer starts generating names it does not match, every
// save on iPad/web emits a spurious add/unlink pair and the watcher feedback
// loop the ENERGY contract documents comes back.

import { describe, it, expect } from 'vitest'

import * as renderer from '@/services/lego_blocks/units/atomicWriteNamingBlock'
import * as main from '../electron/src/lego_blocks/atomicWriteBlock'

describe('the two implementations agree', () => {
  it('shares the infix', () => {
    expect(renderer.ATOMIC_TMP_INFIX_BLOCK).toBe(main.ATOMIC_TMP_INFIX_BLOCK)
  })

  it('shares the pattern', () => {
    expect(renderer.ATOMIC_TMP_PATTERN_BLOCK.source).toBe(main.ATOMIC_TMP_PATTERN_BLOCK.source)
  })

  it('each recognises the other’s temp names', () => {
    for (const target of ['note.md', 'a/b/2026-08-22.md', 'drawing.excalidraw.md']) {
      const fromRenderer = renderer.atomicTempPathBlock(target)
      const fromMain = main.atomicTempPathBlock(target)
      expect(renderer.isAtomicTempPathBlock(fromRenderer)).toBe(true)
      expect(main.isAtomicTempPathBlock(fromRenderer)).toBe(true)
      expect(renderer.isAtomicTempPathBlock(fromMain)).toBe(true)
      expect(main.isAtomicTempPathBlock(fromMain)).toBe(true)
    }
  })

  it('each derives the same target from the other’s temp', () => {
    for (const target of ['note.md', 'a/b/2026-08-22.md']) {
      const fromRenderer = renderer.atomicTempPathBlock(target)
      expect(renderer.atomicTargetFromTempBlock(fromRenderer)).toBe(target)
      expect(main.atomicTargetFromTempBlock(fromRenderer)).toBe(target)
    }
  })

  it('neither mistakes an ordinary note for scratch', () => {
    for (const name of ['notes/2026-08-22.md', '.hidden.md', 'a.thinkspc-tmp-notes.md']) {
      expect(renderer.isAtomicTempPathBlock(name)).toBe(false)
      expect(main.isAtomicTempPathBlock(name)).toBe(false)
    }
  })
})

describe('renderer naming keeps the temp beside its target', () => {
  it('stays in the same directory — rename is only atomic within a filesystem', () => {
    const temp = renderer.atomicTempPathBlock('deep/nested/note.md')
    expect(temp.startsWith('deep/nested/')).toBe(true)
    expect(temp.slice('deep/nested/'.length).startsWith('.')).toBe(true)
  })

  it('handles a target with no directory', () => {
    const temp = renderer.atomicTempPathBlock('note.md')
    expect(temp.includes('/')).toBe(false)
    expect(renderer.atomicTargetFromTempBlock(temp)).toBe('note.md')
  })

  it('never collides across rapid successive writes', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i += 1) seen.add(renderer.atomicTempPathBlock('note.md'))
    expect(seen.size).toBe(500)
  })
})
