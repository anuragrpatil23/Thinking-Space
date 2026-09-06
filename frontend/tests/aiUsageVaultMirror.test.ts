import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The vault mirror for AI usage capture.
 *
 * The interesting behaviour is not that bytes land — it is what the mirror
 * refuses to do. The home copies are on a retention clock and the vault copy is
 * the durable one, so a shrunken or cleared source must never be allowed to
 * overwrite history the vault is holding *because* home could not keep it.
 */

let homeDir: string
let vaultDir: string
let realHome: string | undefined

// The source addresses are module-level constants bound to os.homedir(), so the
// redirect has to be in place before the module under test is imported — hence
// resetModules and a dynamic import in every test. HOME rather than a spy:
// os.homedir() reads it on POSIX, and the ESM binding is not redefinable.
beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-usage-home-'))
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-usage-vault-'))
  realHome = process.env.HOME
  process.env.HOME = homeDir
  vi.resetModules()
  expect(os.homedir()).toBe(homeDir)
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(homeDir, { recursive: true, force: true })
  fs.rmSync(vaultDir, { recursive: true, force: true })
})

/** Import fresh so the stubbed homedir is baked into the path constants. */
async function loadBlock() {
  return await import('../electron/src/lego_blocks/aiUsageVaultMirrorBlock')
}

/** Stands in for the vault guard; containment is that block's own concern. */
const resolveTarget = (relPath: string): string => path.join(vaultDir, relPath)

function writeHome(relPath: string, contents: string): string {
  const full = path.join(homeDir, '.thinking-space', relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, contents)
  return full
}

const vaultFile = (relPath: string): string => path.join(vaultDir, relPath)

describe('aiUsageVaultMirrorBlock', () => {
  it('mirrors session snapshots under their session id and the usage log under this machine', async () => {
    writeHome('ai-sessions/claude/abc-123.json', '{"session_id":"abc-123"}')
    writeHome('ai-usage-log/claude/2026-09.jsonl', '{"t":1,"p":"claude"}\n')

    const { promoteAiUsageCaptureBlock } = await loadBlock()
    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(2)

    expect(fs.readFileSync(vaultFile('ai-activity/raw-sessions/claude/sessions/abc-123.json'), 'utf8'))
      .toBe('{"session_id":"abc-123"}')
    // The month file carries the machine suffix, so a second install syncing
    // into the same vault lands beside this one instead of colliding with it.
    expect(fs.readFileSync(vaultFile('ai-activity/raw-sessions/claude/usage/2026-09.a3f1c2.jsonl'), 'utf8'))
      .toBe('{"t":1,"p":"claude"}\n')
  })

  it('is idempotent — a second run with nothing changed copies nothing', async () => {
    writeHome('ai-sessions/claude/abc-123.json', '{"session_id":"abc-123"}')
    writeHome('ai-usage-log/claude/2026-09.jsonl', '{"t":1}\n')

    const { promoteAiUsageCaptureBlock } = await loadBlock()
    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(2)
    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(0)
  })

  it('carries new samples over as the month grows', async () => {
    writeHome('ai-usage-log/claude/2026-09.jsonl', '{"t":1}\n')
    const { promoteAiUsageCaptureBlock } = await loadBlock()
    promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')

    writeHome('ai-usage-log/claude/2026-09.jsonl', '{"t":1}\n{"t":2}\n')
    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(1)
    expect(fs.readFileSync(vaultFile('ai-activity/raw-sessions/claude/usage/2026-09.a3f1c2.jsonl'), 'utf8'))
      .toBe('{"t":1}\n{"t":2}\n')
  })

  it('never lets a shrunken source overwrite a longer mirror', async () => {
    // The whole reason the vault copy exists: home is pruned and can be cleared,
    // and history there is unrecoverable. A source that lost rows says nothing
    // about the rows the mirror already holds.
    writeHome('ai-usage-log/claude/2026-09.jsonl', '{"t":1}\n{"t":2}\n{"t":3}\n')
    const { promoteAiUsageCaptureBlock } = await loadBlock()
    promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')

    writeHome('ai-usage-log/claude/2026-09.jsonl', '{"t":9}\n')
    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(0)
    expect(fs.readFileSync(vaultFile('ai-activity/raw-sessions/claude/usage/2026-09.a3f1c2.jsonl'), 'utf8'))
      .toBe('{"t":1}\n{"t":2}\n{"t":3}\n')
  })

  it('refreshes a session snapshot when the source is newer', async () => {
    const source = writeHome('ai-sessions/claude/abc-123.json', '{"v":1}')
    const { promoteAiUsageCaptureBlock } = await loadBlock()
    promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')

    fs.writeFileSync(source, '{"v":2}')
    const future = new Date(Date.now() + 60_000)
    fs.utimesSync(source, future, future)

    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(1)
    expect(fs.readFileSync(vaultFile('ai-activity/raw-sessions/claude/sessions/abc-123.json'), 'utf8'))
      .toBe('{"v":2}')
  })

  it('mirrors codex capture alongside claude, and ignores files it does not recognise', async () => {
    writeHome('ai-sessions/codex/sess-9.json', '{}')
    writeHome('ai-usage-log/codex/2026-09.jsonl', '{"t":1,"p":"codex"}\n')
    // Not ours: a stray extension, a session id outside the allowed charset
    // (the name reaches us off disk and ends up in a vault path, so the guard
    // is at the boundary that builds the path), and a month that is not a month.
    writeHome('ai-sessions/claude/notes.txt', 'ignore me')
    writeHome('ai-sessions/claude/not a session $id.json', '{}')
    writeHome('ai-usage-log/claude/latest.jsonl', '{}')

    const { promoteAiUsageCaptureBlock } = await loadBlock()
    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(2)

    expect(fs.existsSync(vaultFile('ai-activity/raw-sessions/codex/sessions/sess-9.json'))).toBe(true)
    expect(fs.existsSync(vaultFile('ai-activity/raw-sessions/codex/usage/2026-09.a3f1c2.jsonl'))).toBe(true)
    expect(fs.existsSync(vaultFile('ai-activity/raw-sessions/claude/usage/latest.a3f1c2.jsonl'))).toBe(false)
    // Nothing from the claude side got through at all, and no `.tmp` survived.
    expect(fs.existsSync(vaultFile('ai-activity/raw-sessions/claude'))).toBe(false)
    expect(fs.readdirSync(vaultDir)).toEqual(['ai-activity'])
  })

  it('leaves the home copy in place — promotion is a sync, not a handoff', async () => {
    // The script must always have somewhere to write, vault or no vault.
    const source = writeHome('ai-usage-log/claude/2026-09.jsonl', '{"t":1}\n')
    const { promoteAiUsageCaptureBlock } = await loadBlock()
    promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')
    expect(fs.readFileSync(source, 'utf8')).toBe('{"t":1}\n')
  })

  it('writes nothing when there is nothing captured', async () => {
    const { promoteAiUsageCaptureBlock } = await loadBlock()
    expect(promoteAiUsageCaptureBlock(resolveTarget, 'a3f1c2')).toBe(0)
    expect(fs.existsSync(vaultFile('ai-activity'))).toBe(false)
  })
})
