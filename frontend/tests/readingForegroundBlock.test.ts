import { describe, it, expect, beforeEach } from 'vitest'
import {
  claimReadingForegroundBlock,
  isReadingForegroundBlock,
  resetReadingForegroundBlock,
  subscribeReadingForegroundBlock,
} from '@/services/lego_blocks/units/readingForegroundBlock'

describe('readingForegroundBlock', () => {
  beforeEach(() => { resetReadingForegroundBlock() })

  it('gives foreground to the only claimant', () => {
    const a = Symbol('a')
    claimReadingForegroundBlock(a)
    expect(isReadingForegroundBlock(a)).toBe(true)
  })

  // The case this exists for: MarkdownViewerOrch's slide-over opening over an
  // open workspace document. Both are mounted, both are `active`, and both see
  // the same document-level events — without an arbiter both would be credited.
  it('takes foreground from the document underneath', () => {
    const workspace = Symbol('workspace')
    const slideOver = Symbol('slide-over')
    claimReadingForegroundBlock(workspace)
    claimReadingForegroundBlock(slideOver)
    expect(isReadingForegroundBlock(workspace)).toBe(false)
    expect(isReadingForegroundBlock(slideOver)).toBe(true)
  })

  it('hands foreground back when the overlay closes', () => {
    const workspace = Symbol('workspace')
    const slideOver = Symbol('slide-over')
    claimReadingForegroundBlock(workspace)
    const releaseOverlay = claimReadingForegroundBlock(slideOver)
    releaseOverlay()
    expect(isReadingForegroundBlock(workspace)).toBe(true)
  })

  it('survives releases out of order', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    const c = Symbol('c')
    const releaseA = claimReadingForegroundBlock(a)
    claimReadingForegroundBlock(b)
    claimReadingForegroundBlock(c)
    releaseA()
    expect(isReadingForegroundBlock(c)).toBe(true)
  })

  it('leaves nobody in foreground once everyone releases', () => {
    const a = Symbol('a')
    const releaseA = claimReadingForegroundBlock(a)
    releaseA()
    expect(isReadingForegroundBlock(a)).toBe(false)
  })

  // A re-render that re-claims must not stack the same token twice, or one
  // release would leave a ghost entry holding foreground forever.
  it('moves a repeat claim to the top instead of stacking it', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    claimReadingForegroundBlock(a)
    claimReadingForegroundBlock(b)
    const releaseA = claimReadingForegroundBlock(a)
    expect(isReadingForegroundBlock(a)).toBe(true)
    releaseA()
    expect(isReadingForegroundBlock(b)).toBe(true)
    expect(isReadingForegroundBlock(a)).toBe(false)
  })

  it('notifies subscribers on claim and release', () => {
    const a = Symbol('a')
    const b = Symbol('b')
    let notifications = 0
    subscribeReadingForegroundBlock(() => { notifications += 1 })
    claimReadingForegroundBlock(a)
    const releaseB = claimReadingForegroundBlock(b)
    releaseB()
    expect(notifications).toBe(3)
  })

  it('keeps notifying the rest when one subscriber throws', () => {
    let reached = false
    subscribeReadingForegroundBlock(() => { throw new Error('bad subscriber') })
    subscribeReadingForegroundBlock(() => { reached = true })
    claimReadingForegroundBlock(Symbol('a'))
    expect(reached).toBe(true)
  })

  it('stops notifying after unsubscribe', () => {
    let notifications = 0
    const unsubscribe = subscribeReadingForegroundBlock(() => { notifications += 1 })
    unsubscribe()
    claimReadingForegroundBlock(Symbol('a'))
    expect(notifications).toBe(0)
  })

  // The F9 tab is a fallback: it counts only while no page inside it does.
  // React runs a child's effects before its parent's, so the tab often claims
  // *after* the page — order must not decide it.
  it('keeps a fallback beneath a page that claimed before it', () => {
    const page = Symbol('page')
    const tab = Symbol('tab')
    claimReadingForegroundBlock(page)
    claimReadingForegroundBlock(tab, { fallback: true })
    expect(isReadingForegroundBlock(page)).toBe(true)
    expect(isReadingForegroundBlock(tab)).toBe(false)
  })

  it('hands foreground back to the fallback when the page closes', () => {
    const tab = Symbol('tab')
    claimReadingForegroundBlock(tab, { fallback: true })
    expect(isReadingForegroundBlock(tab)).toBe(true)
    const releasePage = claimReadingForegroundBlock(Symbol('page'))
    expect(isReadingForegroundBlock(tab)).toBe(false)
    releasePage()
    expect(isReadingForegroundBlock(tab)).toBe(true)
  })

  it('lets a fallback that reclaims stay a fallback', () => {
    const page = Symbol('page')
    const tab = Symbol('tab')
    claimReadingForegroundBlock(tab, { fallback: true })
    claimReadingForegroundBlock(page)
    claimReadingForegroundBlock(tab, { fallback: true })
    expect(isReadingForegroundBlock(page)).toBe(true)
  })
})
