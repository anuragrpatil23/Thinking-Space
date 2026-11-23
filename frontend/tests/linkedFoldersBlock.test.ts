import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addLinkedFolderBlock,
  describeLinkedCodeBlock,
  isBlockedLinkedNameBlock,
  linkedFileToOpenBlock,
  listLinkedFolderBlock,
  parseLinkedFoldersBlock,
  readLinkedCodeTextBlock,
  readLinkedDocumentBytesBlock,
  readLinkedDocumentTextBlock,
  statLinkedDocumentBlock,
  readLinkedFoldersBlock,
  readLinkedTextBlock,
  resolveLinkedPathBlock,
  writeLinkedFoldersBlock,
} from '../electron/src/lego_blocks/linkedFoldersBlock'

let base: string
let root: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'linked-')))
  root = path.join(base, 'library')
  await mkdir(path.join(root, 'guo-2026'), { recursive: true })
  await writeFile(path.join(root, 'guo-2026', 'guo-2026.md'), '# note')
  await writeFile(path.join(root, 'guo-2026', 'guo-2026.pdf'), 'pdf')
  await writeFile(path.join(root, 'guo-2026', 'run.sh'), 'echo hi')
  await writeFile(path.join(root, 'guo-2026', 'launch.command'), 'echo hi')
  await writeFile(path.join(root, 'guo-2026', '.env'), 'KEY=1')
  await writeFile(path.join(root, 'guo-2026', 'credentials.json'), '{}')
  await writeFile(path.join(base, 'outside.md'), 'private')
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

describe('paths inside a linked folder', () => {
  it('reads a note and lists a folder without secrets', async () => {
    expect(await readLinkedTextBlock(root, 'guo-2026/guo-2026.md')).toBe('# note')
    const listed = await listLinkedFolderBlock(root, 'guo-2026')
    expect(listed.files).toContain('guo-2026.pdf')
    expect(listed.files).not.toContain('.env')
    expect(listed.files).not.toContain('credentials.json')
  })

  it.each(['../outside.md', 'guo-2026/../../outside.md', '/etc/hosts', 'guo-2026/.env', 'guo-2026/credentials.json', 'a\0b', 'guo-2026\\..\\x'])('refuses %s', async (bad) => {
    await expect(resolveLinkedPathBlock(root, bad)).rejects.toThrow()
  })

  it('refuses a symlink that leads out of the folder', async () => {
    await symlink(path.join(base, 'outside.md'), path.join(root, 'escape.md'))
    await expect(readLinkedTextBlock(root, 'escape.md')).rejects.toThrow()
  })

  it('refuses a symlink with an innocent name that points at a secret', async () => {
    await symlink(path.join(root, 'guo-2026', '.env'), path.join(root, 'notes.md'))
    await expect(readLinkedTextBlock(root, 'notes.md')).rejects.toThrow()
  })

  it('opens documents and refuses anything that can run', async () => {
    expect(await linkedFileToOpenBlock(root, 'guo-2026/guo-2026.pdf')).toBe(path.join(root, 'guo-2026', 'guo-2026.pdf'))
    await expect(linkedFileToOpenBlock(root, 'guo-2026/run.sh')).rejects.toThrow()
    await expect(linkedFileToOpenBlock(root, 'guo-2026/launch.command')).rejects.toThrow()
  })

  it('does not mistake a paper about tokens for a secret', () => {
    expect(isBlockedLinkedNameBlock('tokenizer-2025.md')).toBe(false)
    expect(isBlockedLinkedNameBlock('secret-collusion-2024')).toBe(false)
    expect(isBlockedLinkedNameBlock('api-token.json')).toBe(true)
    expect(isBlockedLinkedNameBlock('id_ed25519')).toBe(true)
  })
})

describe('the list of linked folders', () => {
  it('adds a picked folder once', async () => {
    const one = await addLinkedFolderBlock([], root, 'papers', path.join(base, 'home'))
    expect(one).toMatchObject([{ path: root, kind: 'papers' }])
    expect(await addLinkedFolderBlock(one, root, 'papers', path.join(base, 'home'))).toHaveLength(1)
    expect(await addLinkedFolderBlock([], root, 'code', path.join(base, 'home'))).toMatchObject([{ kind: 'code' }])
    expect(parseLinkedFoldersBlock('[{"id":"x","path":"/a","kind":"code","project":"old"}]')).toEqual([{ id: 'x', path: '/a', kind: 'code' }])
  })

  it('refuses the whole disk, the home folder and anything above it', async () => {
    const home = path.join(root, 'guo-2026')
    await expect(addLinkedFolderBlock([], '/', 'papers', home)).rejects.toThrow()
    await expect(addLinkedFolderBlock([], home, 'papers', home)).rejects.toThrow()
    await expect(addLinkedFolderBlock([], root, 'papers', home)).rejects.toThrow()
  })

  it('survives a save, and drops anything malformed', async () => {
    const file = path.join(base, 'linked.json')
    const list = await addLinkedFolderBlock([], root, 'papers', path.join(base, 'home'))
    await writeLinkedFoldersBlock(file, list)
    expect(await readLinkedFoldersBlock(file)).toEqual(list)
    expect(parseLinkedFoldersBlock('[{"id":"x","path":"relative","kind":"papers"},{"id":"y","path":"/a","kind":"run"}]')).toEqual([])
    expect(parseLinkedFoldersBlock('not json')).toEqual([])
  })
})

describe('reading a code folder', () => {
  it('shows a script as text, with sizes, and hides secrets from the listing', async () => {
    expect(await readLinkedCodeTextBlock(root, 'guo-2026/run.sh')).toBe('echo hi')
    const listed = await describeLinkedCodeBlock(root, 'guo-2026')
    expect(listed.type === 'folder' && listed.files.map(file => file.name)).toEqual(expect.arrayContaining(['run.sh']))
    expect(listed.type === 'folder' && listed.files.map(file => file.name)).not.toContain('credentials.json')
    expect(listed.type === 'folder' && listed.files.map(file => file.name)).not.toContain('.env')
  })

  it('gives a large file its size and refuses to load it', async () => {
    await writeFile(path.join(root, 'big.jsonl'), 'x'.repeat(600 * 1024))
    expect(await describeLinkedCodeBlock(root, 'big.jsonl')).toEqual({ type: 'file', size: 600 * 1024 })
    await expect(readLinkedCodeTextBlock(root, 'big.jsonl')).rejects.toThrow('too large')
  })

  it('refuses binaries, archives, secrets, keys inside files, and escapes', async () => {
    await writeFile(path.join(root, 'samples.jsonl.gz'), 'gz')
    await writeFile(path.join(root, 'bin.json'), Buffer.from([1, 0, 2]))
    await writeFile(path.join(root, 'config.json'), '{"key":"sk-ant-abcdefghijklmnopqrstuvwxyz"}')
    await writeFile(path.join(root, 'id.txt'), '-----BEGIN OPENSSH PRIVATE KEY-----')
    await symlink(path.join(base, 'outside.md'), path.join(root, 'way-out.md'))
    for (const rel of ['samples.jsonl.gz', 'bin.json', 'config.json', 'id.txt', 'way-out.md', '../outside.md', 'guo-2026/.env', 'guo-2026/credentials.json']) {
      await expect(readLinkedCodeTextBlock(root, rel)).rejects.toThrow()
    }
  })
})

describe('reading a paper in the app', () => {
  it('reads notes and PDFs, and refuses scripts, secrets and escapes', async () => {
    expect(await readLinkedDocumentTextBlock(root, 'guo-2026/guo-2026.md')).toBe('# note')
    expect(Buffer.from(await readLinkedDocumentBytesBlock(root, 'guo-2026/guo-2026.pdf'), 'base64').toString()).toBe('pdf')
    expect((await statLinkedDocumentBlock(root, 'guo-2026/guo-2026.pdf')).size).toBe(3)
    for (const rel of ['guo-2026/run.sh', 'guo-2026/.env', 'guo-2026/credentials.json', '../outside.md']) {
      await expect(readLinkedDocumentTextBlock(root, rel)).rejects.toThrow()
      await expect(readLinkedDocumentBytesBlock(root, rel)).rejects.toThrow()
    }
  })
})
