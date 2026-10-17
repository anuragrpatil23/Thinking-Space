import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createExternalFileGrantsBlock, resolveExternalFileRouteBlock } from '../electron/src/lego_blocks/externalFileOpenBlock'

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

describe('createExternalFileGrantsBlock', () => {
  let base = ''

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-grant-file-')))
    fs.writeFileSync(path.join(base, 'plan.md'), '# plan')
    fs.writeFileSync(path.join(base, 'sibling.md'), '# sibling')
    fs.writeFileSync(path.join(base, 'secrets.env'), 'X=1')
    fs.symlinkSync(path.join(base, 'plan.md'), path.join(base, 'link.md'))
  })

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('grants a markdown file by its real path and routes to it', () => {
    const grants = createExternalFileGrantsBlock()
    const target = path.join(base, 'plan.md')
    expect(grants.grant(target)).toBe(`/thinking-space?file=${encodeURIComponent(target)}`)
    expect(grants.assertGranted(target)).toBe(target)
  })

  it('records a symlink as the file it points to', () => {
    const grants = createExternalFileGrantsBlock()
    expect(grants.grant(path.join(base, 'link.md'))).toBe(`/thinking-space?file=${encodeURIComponent(path.join(base, 'plan.md'))}`)
    expect(() => grants.assertGranted(path.join(base, 'link.md'))).toThrow()
  })

  it('serves only granted files', () => {
    const grants = createExternalFileGrantsBlock()
    grants.grant(path.join(base, 'plan.md'))
    expect(() => grants.assertGranted(path.join(base, 'sibling.md'))).toThrow()
    expect(() => grants.assertGranted(base)).toThrow()
    expect(() => grants.assertGranted('plan.md')).toThrow()
    expect(() => grants.assertGranted(undefined)).toThrow()
  })

  it('refuses non-markdown files, folders and missing paths', () => {
    const grants = createExternalFileGrantsBlock()
    expect(grants.grant(path.join(base, 'secrets.env'))).toBeNull()
    expect(grants.grant(base)).toBeNull()
    expect(grants.grant(path.join(base, 'nope.md'))).toBeNull()
  })

  it('refuses a granted path that now resolves somewhere else', () => {
    const grants = createExternalFileGrantsBlock()
    const target = path.join(base, 'moving.md')
    fs.writeFileSync(target, '# a')
    grants.grant(target)
    fs.rmSync(target)
    fs.symlinkSync(path.join(base, 'sibling.md'), target)
    expect(() => grants.assertGranted(target)).toThrow()
  })
})
