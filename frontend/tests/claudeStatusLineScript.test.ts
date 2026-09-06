import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The shipped status-line script, exercised as Claude Code runs it.
 *
 * Nothing tested this before, which is how the Windows write-location bug
 * survived: every write in the script succeeds on any platform, so a reading
 * landing in the wrong home directory looks identical to it working — the card
 * simply stays empty and no error is raised anywhere.
 */

const SCRIPT = path.join(
  __dirname,
  '..',
  'electron',
  'resources',
  'claude-statusline.sh',
)

/** A payload shaped like the one Claude Code pipes in, trimmed to what we read. */
const PAYLOAD = JSON.stringify({
  session_id: '11111111-2222-3333-4444-555555555555',
  model: { id: 'claude-opus-5', display_name: 'Opus 5' },
  cost: { total_cost_usd: 1.5 },
  context_window: { used_percentage: 12 },
  rate_limits: {
    five_hour: { used_percentage: 34, resets_at: 1788693000 },
    seven_day: { used_percentage: 15, resets_at: 1789239600 },
  },
})

const tempDirs: string[] = []

function makeDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ts-statusline-${label}-`))
  tempDirs.push(dir)
  return dir
}

/** Run the script with an explicit environment, returning what it printed. */
function runScript(env: NodeJS.ProcessEnv): string {
  return execFileSync('bash', [SCRIPT], {
    input: PAYLOAD,
    encoding: 'utf8',
    // A bare env: inheriting the developer's own HOME would let a passing test
    // write into their real ~/.thinking-space.
    env: { PATH: process.env.PATH ?? '', ...env },
  })
}

const bridgeIn = (home: string): string =>
  path.join(home, '.thinking-space', 'claude-limits.json')

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('claude-statusline.sh', () => {
  it('writes the bridge, the session copy and a usage sample under HOME', () => {
    const home = makeDir('posix')
    runScript({ HOME: home })

    const bridge = JSON.parse(fs.readFileSync(bridgeIn(home), 'utf8')) as Record<string, unknown>
    expect(bridge).toEqual(JSON.parse(PAYLOAD))

    const sessions = path.join(home, '.thinking-space', 'ai-sessions', 'claude')
    expect(fs.readdirSync(sessions)).toEqual([
      '11111111-2222-3333-4444-555555555555.json',
    ])

    const logDir = path.join(home, '.thinking-space', 'ai-usage-log', 'claude')
    const [logFile] = fs.readdirSync(logDir)
    const sample = JSON.parse(fs.readFileSync(path.join(logDir, logFile), 'utf8').trim()) as Record<string, unknown>
    expect(sample.p).toBe('claude')
    expect(sample.fh).toBe(34)
    expect(sample.sd).toBe(15)
  })

  it('prefers USERPROFILE over HOME, because that is what os.homedir() reads on Windows', () => {
    // The Windows failure: a Git Bash / MSYS shell hands the script a HOME
    // inside the MSYS root, so the reading lands somewhere the Electron app —
    // which always reads the Windows profile — never looks.
    const msysHome = makeDir('msys')
    const winProfile = makeDir('winprofile')
    runScript({ HOME: msysHome, USERPROFILE: winProfile })

    expect(fs.existsSync(bridgeIn(winProfile))).toBe(true)
    expect(fs.existsSync(path.join(msysHome, '.thinking-space'))).toBe(false)
  })

  it('still reads the limits when jq is absent, as it is on most Windows boxes', () => {
    const home = makeDir('nojq')
    // jq is optional by design and rare on Windows, so the sed/grep fallback is
    // the path most Windows users actually take. Reproduce it by building a bin
    // directory holding only the tools the script may rely on — masking jq via
    // PATH is the only honest way, since it is installed on most dev machines.
    const stubBin = makeDir('bin')
    for (const tool of ['bash', 'cat', 'sed', 'grep', 'head', 'tail', 'mkdir', 'mv', 'date', 'dirname']) {
      for (const root of ['/usr/bin', '/bin']) {
        const real = path.join(root, tool)
        if (fs.existsSync(real)) {
          fs.symlinkSync(real, path.join(stubBin, tool))
          break
        }
      }
    }
    expect(fs.existsSync(path.join(stubBin, 'jq'))).toBe(false)

    const printed = execFileSync('bash', [SCRIPT], {
      input: PAYLOAD,
      encoding: 'utf8',
      env: { PATH: stubBin, HOME: home },
    })
    expect(printed).toContain('Opus 5')

    // The fallback must still recover both windows — a sed pattern that missed
    // them would leave the card blank while the status line looked healthy.
    const logDir = path.join(home, '.thinking-space', 'ai-usage-log', 'claude')
    const [logFile] = fs.readdirSync(logDir)
    const sample = JSON.parse(fs.readFileSync(path.join(logDir, logFile), 'utf8').trim()) as Record<string, unknown>
    expect(sample.fh).toBe(34)
    expect(sample.sd).toBe(15)
  })
})
