import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLAUDE_STATUSLINE_WRAPPER_NAME_BLOCK,
  connectClaudeStatusLineBlock,
  disconnectClaudeStatusLineBlock,
  type ClaudeStatusLinePathsBlock,
} from '../electron/src/lego_blocks/claudeStatusLineConnectBlock'

/**
 * The Connect button's writes to Claude Code's settings.
 *
 * The file belongs to the user and to another program, so every test here is
 * about what must survive: their other settings, their own status line, and a
 * file we could not read.
 */

const tempDirs: string[] = []

/** A throwaway home with a stand-in for our bundled script. */
function makeHome(): ClaudeStatusLinePathsBlock & { captured: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-connect-'))
  tempDirs.push(home)
  const stateDir = path.join(home, '.thinking-space')
  // A space in the path, like "Thinking Space.app".
  const bundle = path.join(home, 'Thinking Space.app')
  fs.mkdirSync(bundle, { recursive: true })
  const scriptPath = path.join(bundle, 'claude-statusline.sh')
  const captured = path.join(home, 'captured.json')
  fs.writeFileSync(scriptPath, `#!/usr/bin/env bash\ncat > '${captured}'\necho OURS\n`, { mode: 0o755 })
  return { settingsPath: path.join(home, '.claude', 'settings.json'), stateDir, scriptPath, captured }
}

function writeSettings(paths: ClaudeStatusLinePathsBlock, value: unknown): void {
  fs.mkdirSync(path.dirname(paths.settingsPath), { recursive: true })
  fs.writeFileSync(paths.settingsPath, typeof value === 'string' ? value : JSON.stringify(value))
}

const readSettings = (paths: ClaudeStatusLinePathsBlock): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8')) as Record<string, unknown>

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('connectClaudeStatusLineBlock', () => {
  it('creates the setting when there is no settings file at all', () => {
    const paths = makeHome()
    expect(connectClaudeStatusLineBlock(paths)).toEqual({ ok: true, mode: 'direct' })
    expect(readSettings(paths).statusLine).toEqual({
      type: 'command',
      command: `"${paths.scriptPath}"`,
    })
  })

  it('leaves every other setting in the file alone', () => {
    const paths = makeHome()
    writeSettings(paths, { model: 'opus', permissions: { allow: ['Bash(ls:*)'] } })
    connectClaudeStatusLineBlock(paths)
    const settings = readSettings(paths)
    expect(settings.model).toBe('opus')
    expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)'] })
  })

  it('wraps an existing status line: theirs is what shows, ours still captures', () => {
    const paths = makeHome()
    writeSettings(paths, { statusLine: { type: 'command', command: `echo "it's mine"`, padding: 0 } })
    expect(connectClaudeStatusLineBlock(paths)).toEqual({ ok: true, mode: 'wrapped' })

    const wrapper = path.join(paths.stateDir, CLAUDE_STATUSLINE_WRAPPER_NAME_BLOCK)
    expect(readSettings(paths).statusLine).toEqual({
      type: 'command',
      command: `"${wrapper}"`,
      padding: 0,
    })

    const shown = execFileSync('bash', [wrapper], { input: '{"session_id":"abc"}', encoding: 'utf8' })
    expect(shown.trim()).toBe("it's mine")
    expect(fs.readFileSync(paths.captured, 'utf8')).toBe('{"session_id":"abc"}')
  })

  it('does nothing when already connected', () => {
    const paths = makeHome()
    connectClaudeStatusLineBlock(paths)
    const before = fs.readFileSync(paths.settingsPath, 'utf8')
    expect(connectClaudeStatusLineBlock(paths)).toEqual({ ok: true, mode: 'already' })
    expect(fs.readFileSync(paths.settingsPath, 'utf8')).toBe(before)
  })

  it('refuses to write over a settings file it cannot parse', () => {
    const paths = makeHome()
    writeSettings(paths, '{ "model": "opus", ')
    expect(connectClaudeStatusLineBlock(paths)).toEqual({ ok: false, reason: 'unreadable-settings' })
    expect(fs.readFileSync(paths.settingsPath, 'utf8')).toBe('{ "model": "opus", ')
  })
})

describe('disconnectClaudeStatusLineBlock', () => {
  it('removes the setting when there was none before', () => {
    const paths = makeHome()
    writeSettings(paths, { model: 'opus' })
    connectClaudeStatusLineBlock(paths)
    expect(disconnectClaudeStatusLineBlock(paths)).toEqual({ ok: true, restored: 'removed' })
    expect(readSettings(paths)).toEqual({ model: 'opus' })
  })

  it('puts an existing status line back exactly as it was', () => {
    const paths = makeHome()
    const theirs = { type: 'command', command: 'echo mine', padding: 0 }
    writeSettings(paths, { statusLine: theirs })
    connectClaudeStatusLineBlock(paths)
    expect(disconnectClaudeStatusLineBlock(paths)).toEqual({ ok: true, restored: 'previous' })
    expect(readSettings(paths).statusLine).toEqual(theirs)
  })

  it('leaves a status line the person changed after connecting', () => {
    const paths = makeHome()
    connectClaudeStatusLineBlock(paths)
    writeSettings(paths, { statusLine: { type: 'command', command: 'echo new' } })
    expect(disconnectClaudeStatusLineBlock(paths)).toEqual({ ok: true, restored: 'not-connected' })
    expect(readSettings(paths).statusLine).toEqual({ type: 'command', command: 'echo new' })
  })
})
