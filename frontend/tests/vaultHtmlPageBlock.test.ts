import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import { authorizeVaultRootBlock } from '../electron/src/lego_blocks/vaultPathGuardBlock'
import {
  mintVaultHtmlPageUrlBlock,
  resolveVaultHtmlPageRequestBlock,
} from '../electron/src/lego_blocks/vaultHtmlPageBlock'

describe('vaultHtmlPageBlock', () => {
  let tmp = ''
  let vault = ''
  let pageUrl = ''

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-html-page-')))
    vault = path.join(tmp, 'vault')
    fs.mkdirSync(path.join(vault, 'diagrams', 'vendor'), { recursive: true })
    fs.mkdirSync(path.join(vault, 'other'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'diagrams', 'my page.html'), '<p>hi</p>')
    fs.writeFileSync(path.join(vault, 'diagrams', 'data.json'), '{}')
    fs.writeFileSync(path.join(vault, 'diagrams', 'vendor', 'lib.js'), '')
    fs.writeFileSync(path.join(vault, 'secret.md'), 'private')
    fs.writeFileSync(path.join(vault, 'other', 'page.html'), '<p>other</p>')
    fs.writeFileSync(path.join(tmp, 'outside.txt'), 'outside')
    fs.symlinkSync(path.join(vault, 'secret.md'), path.join(vault, 'diagrams', 'link.md'))
    authorizeVaultRootBlock(vault)
    pageUrl = mintVaultHtmlPageUrlBlock('app', vault, 'diagrams/my page.html')
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const at = (suffix: string) => `app://${new URL(pageUrl).host}/${suffix}`

  it('serves the page and files beside or below it', () => {
    expect(resolveVaultHtmlPageRequestBlock(pageUrl)).toBe(path.join(vault, 'diagrams', 'my page.html'))
    expect(resolveVaultHtmlPageRequestBlock(new URL('data.json', pageUrl).toString())).toBe(path.join(vault, 'diagrams', 'data.json'))
    expect(resolveVaultHtmlPageRequestBlock(new URL('vendor/lib.js', pageUrl).toString())).toBe(path.join(vault, 'diagrams', 'vendor', 'lib.js'))
  })

  it('refuses anything above the page folder', () => {
    expect(resolveVaultHtmlPageRequestBlock(at('..%2Fsecret.md'))).toBeNull()
    expect(resolveVaultHtmlPageRequestBlock(at('%2E%2E/%2E%2E/outside.txt'))).toBeNull()
    expect(resolveVaultHtmlPageRequestBlock(at(encodeURIComponent(path.join(vault, 'secret.md'))))).toBeNull()
  })

  it('refuses a symlink that points out of the folder', () => {
    expect(resolveVaultHtmlPageRequestBlock(at('link.md'))).toBeNull()
  })

  it('refuses hosts that were never minted, directories, and missing files', () => {
    expect(resolveVaultHtmlPageRequestBlock('app://page-deadbeef/my%20page.html')).toBeNull()
    expect(resolveVaultHtmlPageRequestBlock(at('data.json'))).not.toBeNull()
    expect(resolveVaultHtmlPageRequestBlock(at('vendor'))).toBeNull()
    expect(resolveVaultHtmlPageRequestBlock(at('nope.js'))).toBeNull()
  })

  it('gives each folder its own origin', () => {
    const other = mintVaultHtmlPageUrlBlock('app', vault, 'other/page.html')
    expect(new URL(other).host).not.toBe(new URL(pageUrl).host)
    expect(mintVaultHtmlPageUrlBlock('app', vault, 'diagrams/my page.html')).toBe(pageUrl)
  })

  it('only mints for HTML files inside an authorized vault', () => {
    expect(() => mintVaultHtmlPageUrlBlock('app', vault, 'secret.md')).toThrow()
    expect(() => mintVaultHtmlPageUrlBlock('app', vault, '../outside.txt')).toThrow()
    expect(() => mintVaultHtmlPageUrlBlock('app', tmp, 'vault/other/page.html')).toThrow()
  })
})
