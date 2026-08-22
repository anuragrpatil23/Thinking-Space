// Durability contract, rule 1: the buffer is never the only copy of typed text,
// in any save mode. See docs/contracts/DURABILITY.md.
//
// These are the predicates the destructive paths in `useNoteComposerOrch`
// consult before clearing or replacing `content`. Each one exists because the
// path that now calls it used to make the decision inline, and got it wrong.

import { describe, it, expect } from 'vitest'

import {
  bufferHasUnsavedTextBlock,
  saveRetryDelayBlock,
  shouldFlushOnTeardownBlock,
  shouldRequestSaveBlock,
  originCleanupActionBlock,
  SAVE_RETRY_BASE_MS_BLOCK,
  SAVE_RETRY_MAX_MS_BLOCK,
} from '@/services/lego_blocks/units/noteComposerBlock'

describe('bufferHasUnsavedTextBlock', () => {
  it('protects text that differs from what was written', () => {
    expect(bufferHasUnsavedTextBlock('typed a line', '')).toBe(true)
    expect(bufferHasUnsavedTextBlock('on disk\nplus more', 'on disk')).toBe(true)
  })

  it('does not protect text already on disk', () => {
    expect(bufferHasUnsavedTextBlock('same', 'same')).toBe(false)
  })

  // The startNewNote / teardown paths gate a *save* on this. Whitespace-only
  // content is exactly what `canSave` refuses to write, so calling it unsaved
  // would block every transition behind a save that can never succeed.
  it('treats whitespace-only content as nothing to protect', () => {
    expect(bufferHasUnsavedTextBlock('', '')).toBe(false)
    expect(bufferHasUnsavedTextBlock('   \n\t\n  ', '')).toBe(false)
  })

  // The reported bug: auto-save re-seeds the baseline, so a *saved* buffer and
  // an unsaved one look identical unless this comparison is made.
  it('sees a fresh edit made after a save', () => {
    const saved = '---\ntitle: x\n---\nbody'
    expect(bufferHasUnsavedTextBlock(saved, saved)).toBe(false)
    expect(bufferHasUnsavedTextBlock(`${saved} and more`, saved)).toBe(true)
  })
})

describe('saveRetryDelayBlock', () => {
  it('schedules nothing when no failure is outstanding', () => {
    expect(saveRetryDelayBlock(0)).toBe(0)
    expect(saveRetryDelayBlock(-1)).toBe(0)
    expect(saveRetryDelayBlock(Number.NaN)).toBe(0)
  })

  it('doubles per consecutive failure', () => {
    expect(saveRetryDelayBlock(1)).toBe(SAVE_RETRY_BASE_MS_BLOCK)
    expect(saveRetryDelayBlock(2)).toBe(SAVE_RETRY_BASE_MS_BLOCK * 2)
    expect(saveRetryDelayBlock(3)).toBe(SAVE_RETRY_BASE_MS_BLOCK * 4)
  })

  it('never exceeds the ceiling, however long the vault stays away', () => {
    for (const count of [10, 50, 1024, 100_000]) {
      const delay = saveRetryDelayBlock(count)
      expect(delay).toBe(SAVE_RETRY_MAX_MS_BLOCK)
      expect(Number.isFinite(delay)).toBe(true)
    }
  })

  // A vault that comes back must be noticed while the user is still sitting
  // there, or the retry is theatre.
  it('keeps the ceiling within half a minute', () => {
    expect(SAVE_RETRY_MAX_MS_BLOCK).toBeLessThanOrEqual(30_000)
  })
})

describe('shouldFlushOnTeardownBlock', () => {
  it('flushes unsaved prose on the way out', () => {
    expect(shouldFlushOnTeardownBlock({
      makeThisTodo: false, content: 'half a thought', base: '',
    })).toBe(true)
  })

  it('does not flush what is already written', () => {
    expect(shouldFlushOnTeardownBlock({
      makeThisTodo: false, content: 'saved', base: 'saved',
    })).toBe(false)
  })

  // `todos.create` appends rather than replaces, so flushing on every teardown
  // would duplicate the whole list. This is the same reason auto-save skips
  // todo mode.
  it('never flushes in todo mode, however dirty the buffer', () => {
    expect(shouldFlushOnTeardownBlock({
      makeThisTodo: true, content: 'task one\ntask two', base: '',
    })).toBe(false)
  })
})

describe('shouldRequestSaveBlock', () => {
  const base = {
    makeThisTodo: false,
    content: 'typed something',
    base: '',
    saving: false,
    loadingTargetContent: false,
    canSave: true,
    todoItemCount: 0,
    lastTodoSubmit: null as string | null,
  }

  it('saves unsaved prose', () => {
    expect(shouldRequestSaveBlock(base)).toBe(true)
  })

  // Silence, not an error. A reflex keystroke that raises a banner whenever
  // there is nothing to write teaches people to stop pressing it — and in
  // manual mode this is the only way text reaches the note.
  it('is silent when there is nothing to write', () => {
    expect(shouldRequestSaveBlock({ ...base, content: 'same', base: 'same' })).toBe(false)
    expect(shouldRequestSaveBlock({ ...base, content: '   ' })).toBe(false)
  })

  it('never writes a half-loaded buffer over a real note', () => {
    expect(shouldRequestSaveBlock({ ...base, loadingTargetContent: true })).toBe(false)
  })

  it('does not stack on an in-flight save', () => {
    expect(shouldRequestSaveBlock({ ...base, saving: true })).toBe(false)
  })

  it('respects canSave', () => {
    expect(shouldRequestSaveBlock({ ...base, canSave: false })).toBe(false)
  })

  describe('todo mode', () => {
    const todo = { ...base, makeThisTodo: true, content: 'task one\ntask two', todoItemCount: 2 }

    it('submits a changed list', () => {
      expect(shouldRequestSaveBlock(todo)).toBe(true)
      expect(shouldRequestSaveBlock({ ...todo, lastTodoSubmit: 'task one' })).toBe(true)
    })

    // `todos.create` appends. Pressing Cmd+S twice on an unchanged list would
    // add every task a second time, which is why auto-save skips todo mode.
    it('refuses to re-submit an unchanged list', () => {
      expect(shouldRequestSaveBlock({ ...todo, lastTodoSubmit: todo.content })).toBe(false)
    })

    it('refuses an empty list', () => {
      expect(shouldRequestSaveBlock({ ...todo, content: '', todoItemCount: 0 })).toBe(false)
    })
  })
})

describe('originCleanupActionBlock', () => {
  const base = {
    onDisk: 'what we wrote',
    lastWritten: 'what we wrote',
    sessionStart: '',
    createdHere: true,
  }

  it('deletes a file this session created', () => {
    expect(originCleanupActionBlock(base)).toBe('delete')
  })

  it('deletes an empty file that predated the session', () => {
    // Nothing to preserve, and leaving it is the husk this contract exists to
    // stop creating.
    expect(originCleanupActionBlock({ ...base, createdHere: false, sessionStart: '  \n ' }))
      .toBe('delete')
  })

  // The case the whole `sessionStart` baseline exists for. Auto-save re-seeds
  // `lastWritten` on every write, so without a separate session baseline an
  // appended-to day note looks entirely ours — and the move would delete
  // somebody's whole day.
  it('restores a note that existed before this session', () => {
    expect(originCleanupActionBlock({
      onDisk: 'their day note\nplus my addition',
      lastWritten: 'their day note\nplus my addition',
      sessionStart: 'their day note',
      createdHere: false,
    })).toBe('restore')
  })

  it('refuses to touch a file something else changed', () => {
    expect(originCleanupActionBlock({
      ...base,
      onDisk: 'someone else got here first',
    })).toBe('changed-elsewhere')
  })

  it('refuses even when this session created it, if it changed underneath', () => {
    expect(originCleanupActionBlock({
      onDisk: 'edited by another window',
      lastWritten: 'what we wrote',
      sessionStart: '',
      createdHere: true,
    })).toBe('changed-elsewhere')
  })

  it('does nothing when the origin is already gone', () => {
    expect(originCleanupActionBlock({ ...base, onDisk: null })).toBe('leave')
  })

  // Belt and braces: no combination of inputs may delete a file holding
  // content that predates the session.
  it('never deletes content that predates the session', () => {
    for (const createdHere of [true, false]) {
      for (const sessionStart of ['their words', 'a', '---\ntitle: x\n---\nbody']) {
        const action = originCleanupActionBlock({
          onDisk: 'same', lastWritten: 'same', sessionStart, createdHere,
        })
        if (!createdHere) expect(action).toBe('restore')
      }
    }
  })
})
