import { describe, expect, it, afterAll, beforeEach, vi, afterEach } from 'vitest'
import {
  getPowerStateBlock,
  heavyBackgroundWorkAllowedBlock,
  invalidatePowerStateBlock,
} from '@/services/lego_blocks/integrations/powerStateBlock'

// A session digest is a 400–600s local-model run. Opening the AI Activity panel
// on a wide range asks for one per session, so on battery a single panel mount
// could drain a laptop. These tests pin the gate: automatic runs need wall
// power, an explicit regenerate ignores the gate, and a surface that cannot
// read power state (web, iOS) keeps generating exactly as it did before.

// These tests run in the node environment, so `window` is ours to define.
// The block reads `window.electronAPI?.powerStateGet` and nothing else.
type FakeWindow = { electronAPI?: { powerStateGet?: () => Promise<unknown> } }

// Vitest workers are reused across test files, and `globalThis` is shared
// within one. A `window` left behind here makes unrelated files think they are
// in a browser — which is exactly how the editor tests started failing.
const hadWindow = 'window' in globalThis
const originalWindow = (globalThis as { window?: unknown }).window

function setApi(api: FakeWindow['electronAPI']): void {
  invalidatePowerStateBlock()
  ;(globalThis as { window?: FakeWindow }).window = { electronAPI: api }
}

function restoreWindow(): void {
  invalidatePowerStateBlock()
  if (hadWindow) (globalThis as { window?: unknown }).window = originalWindow
  else delete (globalThis as { window?: unknown }).window
}

function stubPower(state: { onBattery: boolean; lowPowerMode: boolean; known: boolean } | null) {
  // null = no Electron bridge at all, i.e. the web/iOS case.
  setApi(state === null ? undefined : { powerStateGet: vi.fn(async () => state) })
}

describe('power gate · state block', () => {
  afterEach(() => {
    stubPower(null)
  })
  afterAll(restoreWindow)

  it('allows heavy work on AC with Low Power Mode off', async () => {
    stubPower({ onBattery: false, lowPowerMode: false, known: true })
    expect(await heavyBackgroundWorkAllowedBlock()).toEqual({ allowed: true })
  })

  it('blocks on battery', async () => {
    stubPower({ onBattery: true, lowPowerMode: false, known: true })
    expect(await heavyBackgroundWorkAllowedBlock()).toEqual({
      allowed: false,
      reason: 'on-battery',
    })
  })

  it('blocks in Low Power Mode even while plugged in', async () => {
    // Low Power Mode is the user telling the OS to conserve. Honour it on AC
    // too — a plugged-in Mac in LPM is usually one that is thermally unhappy.
    stubPower({ onBattery: false, lowPowerMode: true, known: true })
    expect(await heavyBackgroundWorkAllowedBlock()).toEqual({
      allowed: false,
      reason: 'low-power-mode',
    })
  })

  it('reports battery over low-power when both are true', async () => {
    // Low Power Mode is the more specific signal, so it names the reason.
    stubPower({ onBattery: true, lowPowerMode: true, known: true })
    const result = await heavyBackgroundWorkAllowedBlock()
    expect(result).toEqual({ allowed: false, reason: 'low-power-mode' })
  })

  it('is permissive when the platform has no power API', async () => {
    // Web and iOS cannot read this. Blocking there would silently kill digests
    // on surfaces that never had a battery problem to begin with.
    stubPower(null)
    expect(await heavyBackgroundWorkAllowedBlock()).toEqual({ allowed: true })
  })

  it('ignores an unreadable Low Power Mode probe but still trusts AC/battery', async () => {
    // `known: false` means the pmset probe failed; powerMonitor's battery flag
    // is native and independent, so it still counts.
    stubPower({ onBattery: true, lowPowerMode: false, known: false })
    expect(await heavyBackgroundWorkAllowedBlock()).toEqual({
      allowed: false,
      reason: 'on-battery',
    })
    stubPower({ onBattery: false, lowPowerMode: true, known: false })
    expect(await heavyBackgroundWorkAllowedBlock()).toEqual({ allowed: true })
  })

  it('caches so a loop over many chains does not issue one IPC call each', async () => {
    const probe = vi.fn(async () => ({ onBattery: true, lowPowerMode: false, known: true }))
    setApi({ powerStateGet: probe })
    await Promise.all(Array.from({ length: 20 }, () => getPowerStateBlock()))
    await getPowerStateBlock()
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('falls back to permissive when the probe throws', async () => {
    setApi({
      powerStateGet: vi.fn(async () => {
        throw new Error('pmset exploded')
      }),
    })
    expect(await heavyBackgroundWorkAllowedBlock()).toEqual({ allowed: true })
  })
})

// ── The gate where it actually matters: the digest orchestrator ─────────

vi.mock('@/services/lego_blocks/units/storageKeyBlock', async importActual => ({
  ...(await importActual<typeof import('@/services/lego_blocks/units/storageKeyBlock')>()),
  getStoredVaultRoot: () => '/vault',
  getAiActivityAiTitlesEnabled: () => true,
}))
vi.mock('@/services/lego_blocks/integrations/intelligence/providerRegistryBlock', () => ({
  currentGenerationSourceBlock: () => 'local',
}))
vi.mock('@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock', () => ({
  intelligenceCacheAvailableBlock: () => true,
}))
vi.mock('@/services/lego_blocks/integrations/aiActivitySessionDigestStoreBlock', () => ({
  getProjectSessionDigestBlock: async () => null,
  putProjectSessionDigestBlock: async () => undefined,
}))

const runContract = vi.fn(async () => ({ ok: false, value: undefined, providerId: 'local' }))
vi.mock('@/services/orchestrators/intelligenceOrch', () => ({
  availability: async () => ({ available: true }),
  contractReasoningWillRunOrch: async () => false,
  runContract: () => runContract(),
}))

const { ensureSessionDigestOrch } = await import(
  '@/services/orchestrators/aiActivitySessionDigestOrch'
)

// A long-settled session, so the liveness guard is not what does the blocking.
const settledSession = {
  path: 'native/claude/abc.jsonl',
  source: 'claude-code',
  project: 'Thinking-Space',
  userMsgCount: 12,
  startedIso: '2026-07-14T10:00:00.000Z',
  endedIso: '2026-07-14T10:40:00.000Z',
  topic: 'a real conversation',
  hadClear: false,
  mtime: 0,
} as never

describe('power gate · session digest orchestrator', () => {
  beforeEach(() => {
    runContract.mockClear()
  })
  afterAll(restoreWindow)

  it('does not run the model automatically while on battery', async () => {
    stubPower({ onBattery: true, lowPowerMode: false, known: true })
    const result = await ensureSessionDigestOrch(settledSession)
    expect(runContract).not.toHaveBeenCalled()
    expect(result?.isAi).toBe(false)
    expect(result?.blocked).toBe('on-battery')
    // The refusal is not persisted as an answer — the fallback title is the
    // session's own topic, and plugging in regenerates for real.
    expect(result?.digest.title).toBeTruthy()
  })

  it('does not run the model automatically in Low Power Mode', async () => {
    stubPower({ onBattery: false, lowPowerMode: true, known: true })
    const result = await ensureSessionDigestOrch(settledSession)
    expect(runContract).not.toHaveBeenCalled()
    expect(result?.blocked).toBe('low-power-mode')
  })

  it('runs when the user clicks regenerate, battery or not', async () => {
    // The whole point of the override: a person asking is not a background
    // loop deciding.
    stubPower({ onBattery: true, lowPowerMode: true, known: true })
    await ensureSessionDigestOrch(settledSession, { refresh: true })
    expect(runContract).toHaveBeenCalledTimes(1)
  })

  it('runs automatically on wall power', async () => {
    stubPower({ onBattery: false, lowPowerMode: false, known: true })
    await ensureSessionDigestOrch(settledSession)
    expect(runContract).toHaveBeenCalledTimes(1)
  })
})

// ── The pmset parse, against real `pmset -g` output ─────────────────────

describe('power gate · pmset parse', () => {
  // Verbatim from a `pmset -g` on Apple Silicon, trimmed. The key here is
  // `powermode`, NOT `lowpowermode` — the first version of this block looked
  // for the Intel-era spelling and would have silently never fired the gate.
  const appleSilicon = `System-wide power settings:
Currently in use:
 standby              1
 powernap             1
 displaysleep         5 (display sleep prevented by Thinking Space)
 powermode            1
 womp                 0
`

  it('reads Low Power Mode from the powermode key', async () => {
    const { parseLowPowerModeBlock } = await import(
      '../electron/src/lego_blocks/powerStateBlock'
    )
    expect(parseLowPowerModeBlock(appleSilicon)).toEqual({ value: true, known: true })
    expect(parseLowPowerModeBlock(appleSilicon.replace('powermode            1', 'powermode            0'))).toEqual({
      value: false,
      known: true,
    })
  })

  it('treats High Power Mode (2) as no reason to hold back', async () => {
    const { parseLowPowerModeBlock } = await import(
      '../electron/src/lego_blocks/powerStateBlock'
    )
    expect(parseLowPowerModeBlock(appleSilicon.replace('powermode            1', 'powermode            2'))).toEqual({
      value: false,
      known: true,
    })
  })

  it('still reads the Intel-era lowpowermode spelling', async () => {
    const { parseLowPowerModeBlock } = await import(
      '../electron/src/lego_blocks/powerStateBlock'
    )
    expect(parseLowPowerModeBlock(' lowpowermode 1\n')).toEqual({ value: true, known: true })
  })

  it('reports unknown when the key is absent rather than guessing "off"', async () => {
    const { parseLowPowerModeBlock } = await import(
      '../electron/src/lego_blocks/powerStateBlock'
    )
    expect(parseLowPowerModeBlock(' standby 1\n sleep 1\n')).toEqual({
      value: false,
      known: false,
    })
  })
})
