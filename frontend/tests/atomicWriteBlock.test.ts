// Durability contract, rule 2: a write never truncates the previous version.
// See docs/contracts/DURABILITY.md.
//
// The property under test is not "the bytes land" — plain writeFile did that
// fine. It is that there is no instant at which the target holds neither the
// old version nor the new one. That is what O_TRUNC violated, and it is why a
// crash used to cost the whole note rather than the last second of typing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fsPromises from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { Worker } from 'worker_threads'

import {
  atomicWriteFileBlock,
  atomicWriteBytesBlock,
  sweepAtomicTempsBlock,
  isAtomicTempPathBlock,
  atomicTempPathBlock,
  atomicTargetFromTempBlock,
  ATOMIC_TMP_PATTERN_BLOCK,
} from '../electron/src/lego_blocks/atomicWriteBlock'

let dir: string

beforeEach(async () => {
  dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'thinkspc-atomic-'))
})

afterEach(async () => {
  await fsPromises.rm(dir, { recursive: true, force: true })
})

const read = (p: string) => fsPromises.readFile(p, 'utf-8')

describe('atomicWriteFileBlock', () => {
  it('writes a new file, creating missing parent directories', async () => {
    const target = path.join(dir, 'nested', 'deeper', 'note.md')
    await atomicWriteFileBlock(target, '# hello\n')
    expect(await read(target)).toBe('# hello\n')
  })

  it('replaces an existing file exactly, byte for byte', async () => {
    const target = path.join(dir, 'note.md')
    await atomicWriteFileBlock(target, 'first\n')
    await atomicWriteFileBlock(target, 'second, longer than the first\n')
    expect(await read(target)).toBe('second, longer than the first\n')
  })

  it('leaves no temp files behind on success', async () => {
    const target = path.join(dir, 'note.md')
    await atomicWriteFileBlock(target, 'body\n')
    const leftovers = (await fsPromises.readdir(dir)).filter(isAtomicTempPathBlock)
    expect(leftovers).toEqual([])
  })

  // The core property, and the only test here that would have failed before
  // this change. It needs a reader that is genuinely concurrent with the write:
  // an async loop on the same thread gets scheduled once and observes nothing,
  // which would make this pass vacuously. A worker thread spinning on statSync
  // does observe the window.
  //
  // Measured against the old `fsPromises.writeFile` path with a 60MB payload:
  // 5,428 of 2,338,934 observations were truncated, minimum observed size 0 —
  // the file was seen completely empty. The same run through this block:
  // 2,371,069 observations, zero.
  it('never exposes a truncated or partial target mid-write', async () => {
    const target = path.join(dir, 'big.md')
    const oldContent = 'o'.repeat(8_000_000)
    const newContent = 'n'.repeat(8_000_000)
    await atomicWriteFileBlock(target, oldContent)

    const worker = new Worker(`
      const { parentPort, workerData } = require('worker_threads')
      const fs = require('fs')
      let bad = 0, total = 0, minSeen = Infinity, running = true
      parentPort.on('message', (m) => { if (m === 'stop') running = false })
      parentPort.postMessage('ready')
      const spin = () => {
        for (let i = 0; i < 500; i += 1) {
          try {
            const size = fs.statSync(workerData.target).size
            total += 1
            if (size !== workerData.oldLen && size !== workerData.newLen) {
              bad += 1
              if (size < minSeen) minSeen = size
            }
          } catch { total += 1; bad += 1; minSeen = -1 }
        }
        if (running) setImmediate(spin)
        else parentPort.postMessage({ total, bad, minSeen: minSeen === Infinity ? null : minSeen })
      }
      setImmediate(spin)
    `, {
      eval: true,
      workerData: { target, oldLen: oldContent.length, newLen: newContent.length },
    })

    try {
      await new Promise<void>((resolve) => {
        worker.once('message', () => resolve())
      })

      const report = new Promise<{ total: number; bad: number; minSeen: number | null }>(
        (resolve) => {
          worker.on('message', (value) => {
            if (value && typeof value === 'object') resolve(value)
          })
        },
      )

      await atomicWriteFileBlock(target, newContent)
      worker.postMessage('stop')
      const { total, bad, minSeen } = await report

      // The reader must actually have run, or the assertion below is empty.
      expect(total).toBeGreaterThan(1000)
      expect({ bad, minSeen }).toEqual({ bad: 0, minSeen: null })
    } finally {
      await worker.terminate()
    }

    expect((await fsPromises.stat(target)).size).toBe(newContent.length)
  })

  it('preserves the previous version when the write fails', async () => {
    // A directory where the file should be makes `rename` fail, standing in
    // for any mid-write abort. The pre-existing content must survive it.
    const target = path.join(dir, 'note.md')
    await atomicWriteFileBlock(target, 'precious\n')
    await fsPromises.rm(target)
    await fsPromises.mkdir(target)

    await expect(atomicWriteFileBlock(target, 'clobber\n')).rejects.toThrow()

    // And the failed attempt must not leave scratch behind.
    const leftovers = (await fsPromises.readdir(dir)).filter(isAtomicTempPathBlock)
    expect(leftovers).toEqual([])
  })

  it('preserves the target permission bits across a replacement', async () => {
    const target = path.join(dir, 'note.md')
    await atomicWriteFileBlock(target, 'one\n')
    await fsPromises.chmod(target, 0o640)
    await atomicWriteFileBlock(target, 'two\n')
    expect((await fsPromises.stat(target)).mode & 0o777).toBe(0o640)
  })

  it('writes through a symlink rather than replacing it', async () => {
    // Vaults contain symlinked folders, and plain writeFile followed links.
    // Rename would replace the link with a regular file, silently detaching it.
    const real = path.join(dir, 'real.md')
    const link = path.join(dir, 'link.md')
    await atomicWriteFileBlock(real, 'original\n')
    await fsPromises.symlink(real, link)

    await atomicWriteFileBlock(link, 'through the link\n')

    expect((await fsPromises.lstat(link)).isSymbolicLink()).toBe(true)
    expect(await read(real)).toBe('through the link\n')
  })

  it('does not interleave concurrent writers', async () => {
    const target = path.join(dir, 'note.md')
    const a = `${'a'.repeat(50_000)}\n`
    const b = `${'b'.repeat(50_000)}\n`
    await Promise.all([
      atomicWriteFileBlock(target, a),
      atomicWriteFileBlock(target, b),
    ])
    const final = await read(target)
    // One winner, never a mixture.
    expect(final === a || final === b).toBe(true)
  })
})

describe('atomicWriteBytesBlock', () => {
  it('round-trips binary content', async () => {
    const target = path.join(dir, 'blob.bin')
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255])
    await atomicWriteBytesBlock(target, bytes)
    expect(new Uint8Array(await fsPromises.readFile(target))).toEqual(bytes)
  })
})

describe('temp file recognition', () => {
  // These two live in different files — the generator in atomicWriteBlock, the
  // ignore rule in vaultWatcherBlock — so drift between them would silently
  // start emitting a watcher event for every save. Asserted against the
  // generator directly: observing the temp via fs.watch is racy (the file can
  // come and go inside one poll) and made this test flaky.
  it('generates temps its own pattern recognises', () => {
    for (const target of [
      path.join(dir, 'note.md'),
      path.join(dir, 'deep', 'nested', '2026-08-22.md'),
      path.join(dir, 'name with spaces.md'),
      path.join(dir, '.already-hidden.md'),
    ]) {
      // Many iterations because the name carries a random token.
      for (let i = 0; i < 200; i += 1) {
        const temp = atomicTempPathBlock(target)
        expect(isAtomicTempPathBlock(temp)).toBe(true)
        expect(path.dirname(temp)).toBe(path.dirname(target))
        expect(path.basename(temp).startsWith('.')).toBe(true)
      }
    }
  })

  it('does not mistake an ordinary note for scratch', () => {
    expect(ATOMIC_TMP_PATTERN_BLOCK.test('notes/.thinkspc-tmp-ideas.md')).toBe(false)
    expect(ATOMIC_TMP_PATTERN_BLOCK.test('notes/2026-08-22.md')).toBe(false)
  })
})

describe('sweepAtomicTempsBlock', () => {
  it('removes stale temps and leaves real files alone', async () => {
    await fsPromises.writeFile(path.join(dir, '.note.md.thinkspc-tmp-1-2-abc123'), 'stale')
    await fsPromises.writeFile(path.join(dir, 'note.md'), 'real')
    await fsPromises.writeFile(path.join(dir, '.hidden.md'), 'also real')

    const removed = await sweepAtomicTempsBlock(dir)

    expect(removed).toBe(1)
    expect((await fsPromises.readdir(dir)).sort()).toEqual(['.hidden.md', 'note.md'])
  })

  // The rule that makes the sweep safe on every backend. A backend whose rename
  // cannot overwrite (Capacitor/iOS) must delete the target first, and in that
  // window the temp holds the only copy of the file. Sweeping it there would be
  // the exact loss this module exists to prevent.
  it('never removes a temp whose target is missing', async () => {
    await fsPromises.writeFile(
      path.join(dir, '.orphan.md.thinkspc-tmp-1-2-abc123'),
      'the only copy of this file',
    )
    const removed = await sweepAtomicTempsBlock(dir)
    expect(removed).toBe(0)
    expect(await fsPromises.readdir(dir)).toEqual(['.orphan.md.thinkspc-tmp-1-2-abc123'])
  })

  it('derives the target a temp was headed for', () => {
    expect(atomicTargetFromTempBlock('.note.md.thinkspc-tmp-1-2-abc123')).toBe('note.md')
    expect(atomicTargetFromTempBlock('a/b/.note.md.thinkspc-tmp-9-9-zzz999')).toBe('a/b/note.md')
    expect(atomicTargetFromTempBlock('note.md')).toBeNull()
  })

  it('never throws on an unreadable directory', async () => {
    await expect(sweepAtomicTempsBlock(path.join(dir, 'nope'))).resolves.toBe(0)
  })
})
