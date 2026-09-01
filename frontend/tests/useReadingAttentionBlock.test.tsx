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
const { readReadingJournalBlock } = await import(
  '@/services/lego_blocks/units/readingJournalBlock'
)

function Reader({ path, attending }: { path: string | null; attending: boolean }) {
  const scrollRef = useRef<HTMLElement | null>(null)
  useReadingAttentionBlock(path, attending, { scrollRef })
  return null
}

/** One presence signal, past the hook's 1s throttle. */
function signal(atMs: number) {
  vi.setSystemTime(atMs)
  act(() => { document.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
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
    vi.setSystemTime(t0 + 95_000)
    act(() => { view.unmount() })

    expect(appended).toHaveLength(1)
    expect(appended[0].filePath).toBe('notes/foo.md')
    expect(appended[0].source).toBe('reading-md')
    expect(appended[0].method).toBe('measured')
    expect(appended[0].activeMs).toBe(95_000)
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
    vi.setSystemTime(t0 + 120_000)
    act(() => { view.rerender(<Reader path="notes/foo.md" attending={false} />) })
    expect(appended).toHaveLength(1)
    expect(appended[0].activeMs).toBe(120_000)
  })

  it('tags an excalidraw path as a drawing span', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/board.excalidraw.md" attending />)
    signal(t0 + 90_000)
    vi.setSystemTime(t0 + 95_000)
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
    signal(t0 + 90_000)
    vi.setSystemTime(t0 + 95_000)
    act(() => { view.unmount() })

    const paths = appended.map(r => r.filePath)
    expect(paths).toEqual(['notes/overlay.md'])
  })

  it('flushes the in-progress span when the app hides', () => {
    const t0 = Date.now()
    render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 90_000)
    vi.setSystemTime(t0 + 100_000)
    act(() => { window.dispatchEvent(new Event('pagehide')) })

    expect(appended).toHaveLength(1)
    expect(appended[0].activeMs).toBe(100_000)
  })

  it('re-emits the same key when the sitting really ends, so the merge upgrades it', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 90_000)
    vi.setSystemTime(t0 + 100_000)
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    signal(t0 + 150_000)
    vi.setSystemTime(t0 + 200_000)
    act(() => { view.unmount() })

    expect(appended).toHaveLength(2)
    expect(appended[0].key).toBe(appended[1].key)
    expect(appended[1].activeMs).toBeGreaterThan(appended[0].activeMs)
  })

  it('does not credit time spent blurred', () => {
    const t0 = Date.now()
    const view = render(<Reader path="notes/foo.md" attending />)
    signal(t0 + 60_000)
    vi.setSystemTime(t0 + 70_000)
    act(() => { window.dispatchEvent(new Event('blur')) })
    vi.setSystemTime(t0 + 3_600_000)
    act(() => { window.dispatchEvent(new Event('focus')) })
    signal(t0 + 3_660_000)
    vi.setSystemTime(t0 + 3_665_000)
    act(() => { view.unmount() })

    // 70s before the blur, 65s after the focus. The hour away contributes none.
    expect(appended[0].activeMs).toBe(135_000)
  })

  it('writes nothing when there is no path', () => {
    const t0 = Date.now()
    const view = render(<Reader path={null} attending />)
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
      // Within one checkpoint interval of the full 45 minutes.
      expect(journalled[0].activeMs).toBeGreaterThan(44 * 60_000)
    })

    it('forgets the journalled span once the vault confirms it', async () => {
      const t0 = Date.now()
      const view = render(<Reader path="notes/foo.md" attending />)
      signal(t0 + 90_000)
      vi.setSystemTime(t0 + 95_000)
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
      signal(t0 + 90_000)
      vi.setSystemTime(t0 + 95_000)
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
})
