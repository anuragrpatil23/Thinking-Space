import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveExternalFileRouteBlock } from '../electron/src/lego_blocks/externalFileOpenBlock'

describe('resolveExternalFileRouteBlock', () => {
  let base = ''
  let vault = ''

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-open-file-'))
    vault = path.join(base, 'vault')
    fs.mkdirSync(path.join(vault, 'AI Synthesis'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'AI Synthesis', 'note & more.md'), '# hi')
    fs.writeFileSync(path.join(base, 'outside.md'), '# out')
    fs.symlinkSync(path.join(base, 'outside.md'), path.join(vault, 'escape.md'))
  })

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('maps a vault file to its encoded in-app route', () => {
    expect(resolveExternalFileRouteBlock(path.join(vault, 'AI Synthesis', 'note & more.md'), vault))
      .toBe(`/thinking-space?file=${encodeURIComponent('AI Synthesis/note & more.md')}`)
  })

  it('refuses files outside the vault, symlinks out of it, folders and missing paths', () => {
    expect(resolveExternalFileRouteBlock(path.join(base, 'outside.md'), vault)).toBeNull()
    expect(resolveExternalFileRouteBlock(path.join(vault, 'escape.md'), vault)).toBeNull()
    expect(resolveExternalFileRouteBlock(path.join(vault, 'AI Synthesis'), vault)).toBeNull()
    expect(resolveExternalFileRouteBlock(vault, vault)).toBeNull()
    expect(resolveExternalFileRouteBlock(path.join(vault, 'nope.md'), vault)).toBeNull()
  })
})
