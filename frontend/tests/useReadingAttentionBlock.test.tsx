// @vitest-environment jsdom
//
// Drives the hook the way the app does — mount, presence events, unmount — and
// asserts a span actually reaches the writer. The pure blocks were unit-tested
// from the start and all passed while the feature wrote nothing at all, because
// every bug was in the wiring between them.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import type { ThinkingspaceReadingRecord } from '@/services/lego_blocks/units/thinkingspaceReadingParserBlock'

const appended: ThinkingspaceReadingRecord[] = []
let gateOpen = true

vi.mock('@/services/lego_blocks/integrations/thinkingspaceReadingBlock', () => ({
  appendReadingSpan: async (_fs: unknown, record: ThinkingspaceReadingRecord) => {
    if (!gateOpen) return false
    appended.push(record)
    return true
  },
}))
vi.mock('@/services/lego_blocks/integrations/fsBlock', () => ({
  getVaultFS: () => ({}),
}))

const journalStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => journalStore.get(k) ?? null,
  setItem: (k: string, v: string) => { journalStore.set(k, v) },
  removeItem: (k: string) => { journalStore.delete(k) },
})

const { useReadingAttentionBlock } = await import(
  '@/components/lego_blocks/hooks/shared/useReadingAttentionBlock'
)
const { resetReadingForegroundBlock } = await import(
  '@/services/lego_blocks/units/readingForegroundBlock'
)
const { IDLE_CEILING_MS } = await import(
  '@/services/lego_blocks/units/readingAttentionBlock'
)
const { readReadingJournalBlock } = await import(
  '@/services/lego_blocks/units/readingJournalBlock'
)
const { useRouteActivityBlock } = await import(
  '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
)
const { default: RouteActivityProviderBlock } = await import(
  '@/components/lego_blocks/units/RouteActivityProviderBlock'
)

/** A reader composed the way the real surfaces are: pane selection AND the
 *  route's own visibility, which is the fact they were missing. */
function SurfaceReader({ path, active }: { path: string; active: boolean }) {
  const scrollRef = useRef<HTMLElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const surfaceVisible = useRouteActivityBlock()
  useReadingAttentionBlock(path, surfaceVisible && active, { scrollRef, surfaceRef })
  return <div ref={surfaceRef} data-testid="surface" />
}

function Reader({ path, attending }: { path: string | null; attending: boolean }) {
  const scrollRef = useRef<HTMLElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  useReadingAttentionBlock(path, attending, { scrollRef, surfaceRef })
  return <div ref={surfaceRef} data-testid="surface" />
}

/** A click inside the document's own surface. */
function signalInside(atMs: number) {
  vi.setSystemTime(atMs)
  act(() => {
    document.querySelector('[data-testid="surface"]')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  })
}

/** A click somewhere else in the app — an explorer row, a side panel. */
function signalElsewhere(atMs: number) {
  vi.setSystemTime(atMs)
  act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
}

/** One presence signal inside the document, past the hook's 1s throttle. */
function signal(atMs: number) {
  vi.setSystemTime(atMs)
  act(() => {
    const el = document.querySelector('[data-testid="surface"]') ?? document.body
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  })
}

describe('useReadingAttentionBlock', () => {
  // No auto-cleanup without globals:true — a component left mounted keeps its
  // document listeners and flushes into the NEXT test's assertions.
  afterEach(() => { cleanup() })

  beforeEach(() => {
    appended.length = 0
    journalStore.clear()
    gateOpen = true
    resetReadingForegroundBlock()
    vi.useFakeTimers()
    vi.setSystemTime(1_756_500_000_000)
  })

  it('writes a span for a sitting past the floor', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 30_000)
    signal(t0 + 60_000)
    signal(t0 + 90_000)
    signal(t0 + 120_000)
    vi.setSystemTime(t0 + 125_000)
    act(() => { view.unmount() })

    expect(appended).toHaveLength(1)
    expect(appended[0].filePath).toBe('notes/foo.md')
    expect(appended[0].source).toBe('reading-md')
    expect(appended[0].method).toBe('measured')
    // Three gaps of 30s between four signals. The 30s before the first and the
    // 5s after the last were never observed, so neither is credited, and the
    // record's own extent is first-signal to last-signal.
    expect(appended[0].activeMs).toBe(90_000)
    expect(appended[0].startMs).toBe(t0 + 30_000)
    expect(appended[0].endMs).toBe(t0 + 120_000)
  })

  it('writes nothing for a glance under the floor', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 20_000)
    vi.setSystemTime(t0 + 30_000)
    act(() => { view.unmount() })
    expect(appended).toHaveLength(0)
  })

  it('ends the sitting when attending goes false', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 60_000)
    signal(t0 + 150_000)
    vi.setSystemTime(t0 + 200_000)
    act(() => { view.rerender(<Reader path="notes/foo.md" attending={false} />) })
    expect(appended).toHaveLength(1)
    expect(appended[0].activeMs).toBe(90_000)
    expect(appended[0].endMs).toBe(t0 + 150_000)
  })

  it('tags an excalidraw path as a drawing span', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/board.excalidraw.md" attending />)
    signal(t0 + 30_000)
    signal(t0 + 120_000)
    vi.setSystemTime(t0 + 125_000)
    act(() => { view.unmount() })
    expect(appended[0]?.source).toBe('reading-draw')
  })

  // The bug this whole arbiter exists for: a slide-over opening over an open
  // workspace document, both mounted, both active, both seeing the same events.
  it('credits only the foreground document when two are mounted', () => {
    const t0 = Date.now()
    const view = render(
      <>
        <Reader path="notes/workspace.md" attending />
        <Reader path="notes/overlay.md" attending />
      </>,
    )
    // Dispatch into BOTH surfaces, which is the situation the arbiter exists
    // for: two mounted readers, both active, both seeing presence.
    const signalBoth = (atMs: number) => {
      vi.setSystemTime(atMs)
      act(() => {
        document.querySelectorAll('[data-testid="surface"]').forEach(el => {
          el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        })
      })
    }
    signalBoth(t0 + 30_000)
    signalBoth(t0 + 120_000)
    vi.setSystemTime(t0 + 125_000)
    act(() => { view.unmount() })

    const paths = appended.map(r => r.filePath)
    expect(paths).toEqual(['notes/overlay.md'])
  })

  it('flushes the in-progress span when the app hides', () => {
    const t0 = Date.now()
    render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 30_000)
    signal(t0 + 120_000)
    vi.setSystemTime(t0 + 130_000)
    act(() => { window.dispatchEvent(new Event('pagehide')) })

    expect(appended).toHaveLength(1)
    // The flush itself is not a sign anyone was reading, so it credits nothing.
    expect(appended[0].activeMs).toBe(90_000)
  })

  it('re-emits the same key when the sitting really ends, so the merge upgrades it', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 30_000)
    signal(t0 + 120_000)
    vi.setSystemTime(t0 + 130_000)
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    signal(t0 + 180_000)
    vi.setSystemTime(t0 + 200_000)
    act(() => { view.unmount() })

    expect(appended).toHaveLength(2)
    expect(appended[0].key).toBe(appended[1].key)
    expect(appended[1].activeMs).toBeGreaterThan(appended[0].activeMs)
  })

  // The defect this replaces: blur used to credit the gap up to the moment of
  // leaving, on the theory you were reading right until you switched away. For
  // a document sitting open in a pane while you work elsewhere, that minted up
  // to one ceiling on EVERY app switch. A real Mac span log collected 5.4m
  // overnight on a book nobody was awake to read.
  it('credits nothing for the stretch before a blur', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 30_000)
    signal(t0 + 120_000)                              // 90s of real reading
    vi.setSystemTime(t0 + 240_000)                    // two idle minutes, then
    act(() => { window.dispatchEvent(new Event('blur')) })
    signal(t0 + 300_000)                              // back: re-arms, no credit
    signal(t0 + 360_000)                              // 60s more of reading
    vi.setSystemTime(t0 + 400_000)
    act(() => { view.unmount() })

    expect(appended).toHaveLength(1)
    expect(appended[0].activeMs).toBe(150_000)
  })

  // Falling asleep over a book is not a five-hour sitting. Because a span is
  // filed by the day it STARTED, an unbroken overnight span also files the next
  // morning's reading under yesterday, which is how an afternoon of reading
  // vanished from the day it happened on.
  it('splits a sitting when the reader goes away for longer than the ceiling', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 30_000)
    signal(t0 + 120_000)
    act(() => { window.dispatchEvent(new Event('blur')) })
    const nextDay = t0 + 10 * 60 * 60_000
    act(() => { window.dispatchEvent(new Event('focus')) })
    signal(nextDay)
    signal(nextDay + 90_000)
    vi.setSystemTime(nextDay + 100_000)
    act(() => { view.unmount() })

    expect(appended).toHaveLength(2)
    expect(appended[0].activeMs).toBe(90_000)
    expect(appended[0].endMs).toBe(t0 + 120_000)      // ends where it was left
    expect(appended[1].startMs).toBe(nextDay)         // the morning is its own
    expect(appended[1].activeMs).toBe(90_000)
    expect(appended[0].key).not.toBe(appended[1].key)
  })

  // Every workspace tab stays mounted behind `visibility: hidden`, so a
  // document left in a tab you navigated away from kept `active` true and went
  // on measuring — and holding the screen awake — for as long as it stayed
  // open. Three hours of "reading" were logged for a file nobody could see.
  describe('a surface that is mounted but off screen', () => {
    it('stops measuring when the route goes hidden', () => {
      const t0 = Date.now()
      const view = render(
        <RouteActivityProviderBlock active>
          <SurfaceReader path="notes/foo.md" active />
        </RouteActivityProviderBlock>,
      )
      signal(t0 + 30_000)
      signal(t0 + 120_000)

      // Navigate to another tab. The component stays mounted.
      vi.setSystemTime(t0 + 130_000)
      act(() => {
        view.rerender(
          <RouteActivityProviderBlock active={false}>
            <SurfaceReader path="notes/foo.md" active />
          </RouteActivityProviderBlock>,
        )
      })

      expect(appended).toHaveLength(1)
      expect(appended[0].activeMs).toBe(90_000)
      expect(appended[0].endMs).toBe(t0 + 120_000)

      // Two hours elsewhere in the app, with the document still mounted and
      // still "active" in its own pane. Nothing more may be recorded.
      vi.setSystemTime(t0 + 2 * 60 * 60_000)
      act(() => { view.unmount() })
      expect(appended).toHaveLength(1)
    })

    it('never starts measuring while the route is hidden', () => {
      const t0 = Date.now()
      render(
        <RouteActivityProviderBlock active={false}>
          <SurfaceReader path="notes/foo.md" active />
        </RouteActivityProviderBlock>,
      )
      for (let m = 1; m <= 30; m += 1) signal(t0 + m * 60_000)
      expect(appended).toHaveLength(0)
      expect(readReadingJournalBlock()).toHaveLength(0)
    })
  })

  it('writes nothing when there is no path', () => {
    const t0 = Date.now()
    const view = render(<Reader path={null} attending />)
    signal(t0 + 30_000)
    signal(t0 + 90_000)
    vi.setSystemTime(t0 + 95_000)
    act(() => { view.unmount() })
    expect(appended).toHaveLength(0)
  })

  describe('surviving a death mid-sitting', () => {
    // The failure this exists for: 45 minutes of reading held in a ref, and the
    // app is taken away (iOS WebContent memory kill, force-quit, crash) before
    // the sitting ends. Nothing calls unmount, so nothing emits.
    it('journals the span in progress so a kill does not lose it', () => {
      const t0 = Date.now()
      render(<Reader path="notes/foo.md" attending />)
      // Read for a while. No unmount, no pagehide — the app simply dies.
      for (let m = 1; m <= 45; m += 1) signal(t0 + m * 60_000)

      expect(appended).toHaveLength(0)  // nothing ever reached the vault
      const journalled = readReadingJournalBlock()
      expect(journalled).toHaveLength(1)
      expect(journalled[0].filePath).toBe('notes/foo.md')
      // 45 signals a minute apart: the first arms, the other 44 each credit a
      // minute. The minute before the first signal was never observed.
      expect(journalled[0].activeMs).toBe(44 * 60_000)
    })

    it('forgets the journalled span once the vault confirms it', async () => {
      const t0 = Date.now()
      const view = render(<Reader path="notes/foo.md" attending />)
      signal(t0 + 30_000)
      signal(t0 + 120_000)
      vi.setSystemTime(t0 + 125_000)
      act(() => { view.unmount() })
      await act(async () => { await Promise.resolve() })

      expect(appended).toHaveLength(1)
      expect(readReadingJournalBlock()).toHaveLength(0)
    })

    // A refused gate is not durability. Keep it journalled so turning the
    // vault-write permission on later recovers the sitting.
    it('keeps the span journalled when the vault refuses it', async () => {
      gateOpen = false
      const t0 = Date.now()
      const view = render(<Reader path="notes/foo.md" attending />)
      signal(t0 + 30_000)
      signal(t0 + 120_000)
      vi.setSystemTime(t0 + 125_000)
      act(() => { view.unmount() })
      await act(async () => { await Promise.resolve() })

      expect(readReadingJournalBlock()).toHaveLength(1)
    })

    it('does not journal a glance below the floor', () => {
      const t0 = Date.now()
      render(<Reader path="notes/foo.md" attending />)
      signal(t0 + 20_000)
      signal(t0 + 40_000)
      expect(readReadingJournalBlock()).toHaveLength(0)
    })
  })

  describe('crediting only interaction in this document', () => {
    // The real defect: a PDF left open on its cover collected 15 minutes while
    // the reader worked elsewhere in the app. `attending` asks whether this is
    // the active pane, never whether the interaction is in it.
    it('ignores clicks elsewhere in the app', () => {
      const t0 = Date.now()
      const view = render(<Reader path="notes/foo.md" attending />)
      for (let m = 1; m <= 30; m += 1) signalElsewhere(t0 + m * 60_000)
      vi.setSystemTime(t0 + 31 * 60_000)
      act(() => { view.unmount() })
      // Nothing at all. Scoping the listeners stopped those clicks counting;
      // bounding the sitting by its own signals removed the ceiling that the
      // close used to credit on top, so a document open beside half an hour of
      // work elsewhere now records no sitting rather than a short one.
      expect(appended).toHaveLength(0)
    })

    it('credits clicks inside the document', () => {
      const t0 = Date.now()
      const view = render(<Reader path="notes/foo.md" attending />)
      signalInside(t0 + 60_000)
      signalInside(t0 + 120_000)
      signalInside(t0 + 180_000)
      vi.setSystemTime(t0 + 200_000)
      act(() => { view.unmount() })
      expect(appended).toHaveLength(1)
      expect(appended[0].activeMs).toBe(120_000)
    })

    // Reading by arrow key with focus on body is normal, so keydown stays on
    // window and cannot be scoped to the element.
    it('credits keyboard reading when nothing is focused', () => {
      const t0 = Date.now()
      const view = render(<Reader path="notes/foo.md" attending />)
      for (const m of [1, 2, 3]) {
        vi.setSystemTime(t0 + m * 60_000)
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })) })
      }
      vi.setSystemTime(t0 + 200_000)
      act(() => { view.unmount() })
      expect(appended).toHaveLength(1)
    })

    it('refuses keystrokes typed into a field elsewhere', () => {
      const t0 = Date.now()
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      const view = render(<Reader path="notes/foo.md" attending />)
      for (let m = 1; m <= 10; m += 1) {
        vi.setSystemTime(t0 + m * 60_000)
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })) })
      }
      vi.setSystemTime(t0 + 11 * 60_000)
      act(() => { view.unmount() })
      input.remove()
      expect(appended[0]?.activeMs ?? 0).toBeLessThanOrEqual(IDLE_CEILING_MS)
    })
  })
})
