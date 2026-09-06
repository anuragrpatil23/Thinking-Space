import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * The terminal-enabled gate, and specifically the path it reads.
 *
 * This is a layout assertion rather than a behaviour one, because the failure
 * was a layout mistake: the block resolved `../../package.json` from
 * `build/src/lego_blocks/`, which is `build/` — a directory that has never held
 * a package.json. The read threw on every platform, returned null, and fell
 * through to enabled-by-default, so `terminalEnabled: false` was never once
 * honoured. The Windows lite build then omitted node-pty and loaded as though
 * it were present, crashing on launch.
 *
 * Nothing caught it because the failure mode is a silent catch, and the default
 * happens to be correct for the build everyone develops against.
 */

const SRC = path.join(__dirname, '..', 'electron', 'src', 'lego_blocks', 'terminalSupportBlock.ts')
const ELECTRON_ROOT = path.join(__dirname, '..', 'electron')

describe('terminalSupportBlock', () => {
  it('resolves package.json from the compiled layout, not the source layout', () => {
    const source = fs.readFileSync(SRC, 'utf8')
    const match = /path\.resolve\(__dirname, '([^']+)'\)/.exec(source)
    expect(match, 'the block must resolve its package.json via path.resolve(__dirname, ...)').toBeTruthy()

    // tsc preserves the directory shape, so the compiled file sits at
    // <root>/build/src/lego_blocks/ — and inside the asar at the same depth
    // under app.asar/. Resolve the literal from there and require it to land on
    // the package.json electron-builder actually stamps extraMetadata into.
    const compiledDir = path.join(ELECTRON_ROOT, 'build', 'src', 'lego_blocks')
    const resolved = path.resolve(compiledDir, match![1])
    expect(resolved).toBe(path.join(ELECTRON_ROOT, 'package.json'))
    expect(fs.existsSync(resolved)).toBe(true)
  })

  it('the lite config turns the flag off, so the flag has to be readable', () => {
    // The two halves of the mechanism, pinned together: if the lite config stops
    // setting this, the assertion above is guarding nothing.
    const lite = fs.readFileSync(
      path.join(ELECTRON_ROOT, 'electron-builder.win-lite.config.cjs'),
      'utf8',
    )
    expect(lite).toContain('terminalEnabled: false')
    // And it must drop node-pty, or disabling the flag would be pointless.
    expect(lite).toContain('node-pty')
  })
})
