// Durability contract, rule 1: a save landing must not replace keystrokes made
// while it was in flight. See docs/contracts/DURABILITY.md.

import { describe, it, expect } from 'vitest'

import { rebaseBufferOntoWriteBlock } from '@/services/lego_blocks/units/noteComposerBlock'

const FM = '---\nuuid: abc\nupdated_at: 2026-10-28T10:00:00Z\n---\n'
const FM2 = '---\nuuid: abc\nupdated_at: 2026-10-28T10:00:05Z\n---\n'

describe('rebaseBufferOntoWriteBlock', () => {
  it('adopts the disk version when nothing was typed during the write', () => {
    expect(rebaseBufferOntoWriteBlock({
      submitted: 'hello', onDisk: `${FM}hello`, current: 'hello',
    })).toBe(`${FM}hello`)
  })

  it('keeps a sentence typed while the first save created the file', () => {
    expect(rebaseBufferOntoWriteBlock({
      submitted: 'first line',
      onDisk: `${FM}*Wednesday, October 28, 2026*\n\nfirst line`,
      current: 'first line\nsecond line typed mid-save',
    })).toBe(`${FM}*Wednesday, October 28, 2026*\n\nfirst line\nsecond line typed mid-save`)
  })

  // The edit path always restamps updated_at, so disk never equals what was
  // submitted — the old code dropped mid-save typing on every single save.
  it('keeps typing across an updated_at restamp', () => {
    expect(rebaseBufferOntoWriteBlock({
      submitted: `${FM}a\nb`,
      onDisk: `${FM2}a\nb`,
      current: `${FM}a\nb\nc`,
    })).toBe(`${FM2}a\nb\nc`)
  })

  it('keeps an edit in the middle of the body', () => {
    expect(rebaseBufferOntoWriteBlock({
      submitted: `${FM}one\nthree`,
      onDisk: `${FM2}one\nthree`,
      current: `${FM}one\ntwo\nthree`,
    })).toBe(`${FM2}one\ntwo\nthree`)
  })

  it('keeps the buffer when disk is unchanged (mtime-only conflict)', () => {
    expect(rebaseBufferOntoWriteBlock({
      submitted: `${FM}a`, onDisk: `${FM}a`, current: `${FM}a b`,
    })).toBe(`${FM}a b`)
  })

  it('merges a conflicting writer that touched a different span', () => {
    expect(rebaseBufferOntoWriteBlock({
      submitted: 'top\nmiddle\nbottom',
      onDisk: 'TOP\nmiddle\nbottom',
      current: 'top\nmiddle\nbottom\nmine',
    })).toBe('TOP\nmiddle\nbottom\nmine')
  })

  it('lets typed text win when both edited the same span', () => {
    expect(rebaseBufferOntoWriteBlock({
      submitted: 'abc', onDisk: 'aXc', current: 'aYc',
    })).toBe('aYc')
  })

  it('never loses a character the user typed', () => {
    const submitted = `${FM}alpha beta gamma`
    const onDisk = `${FM2}alpha beta gamma`
    for (let i = FM.length; i <= submitted.length; i++) {
      const current = `${submitted.slice(0, i)}XYZ${submitted.slice(i)}`
      const out = rebaseBufferOntoWriteBlock({ submitted, onDisk, current })
      expect(out).toBe(`${FM2}${current.slice(FM.length)}`)
    }
  })
})
