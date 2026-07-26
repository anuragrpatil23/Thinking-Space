import { describe, expect, it } from 'vitest'
import { setManagedVaultGitignorePrefixes } from '@/services/lego_blocks/units/vaultGitignoreBlock'
import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'

function makeMockVaultFs(initialFiles?: Record<string, string>): {
  fs: VaultFS
  files: Map<string, string>
} {
  const files = new Map<string, string>(Object.entries(initialFiles ?? {}))
  const fs = {
    read: async (path: string) => {
      const value = files.get(path)
      if (value == null) throw new Error(`Missing file: ${path}`)
      return value
    },
    write: async (path: string, data: string) => {
      files.set(path, data)
    },
    create: async (path: string, data: string) => {
      files.set(path, data)
    },
    list: async () => ({ files: [], folders: [] }),
    walkVault: async () => [],
    stat: async () => ({ size: 0, mtime: 0, ctime: 0 }),
    exists: async (path: string) => files.has(path),
    mkdir: async () => {},
    process: async () => {},
  } as unknown as VaultFS

  return { fs, files }
}

async function writeAndRead(
  prefixes: string[],
  initial?: Record<string, string>,
): Promise<string> {
  const { fs, files } = makeMockVaultFs(initial)
  await setManagedVaultGitignorePrefixes(prefixes, fs)
  return files.get('.gitignore') ?? ''
}

describe('vaultGitignoreBlock', () => {
  it('ignores baseline prefixes that have no tracked exceptions', async () => {
    const result = await writeAndRead([])
    expect(result).toContain('/ai-raw/')
    expect(result).not.toContain('/ai-raw/*')
  })

  // Undertaking records are hand-written and destructively revised, so losing
  // git history under ai-activity/thinking-organizer loses them outright.
  it('keeps ai-activity/thinking-organizer tracked under the ignored parent', async () => {
    const result = await writeAndRead([])
    expect(result).toContain('/ai-activity/*')
    expect(result).toContain('!/ai-activity/thinking-organizer/')
  })

  // The directory form makes git skip descending into ai-activity entirely,
  // which silently kills the negation below it.
  it('never emits the bare directory form for a prefix with exceptions', async () => {
    const result = await writeAndRead([])
    const lines = result.split('\n')
    expect(lines).not.toContain('/ai-activity/')
  })

  it('emits the exclusion before its negation', async () => {
    const lines = (await writeAndRead([])).split('\n')
    expect(lines.indexOf('/ai-activity/*')).toBeLessThan(
      lines.indexOf('!/ai-activity/thinking-organizer/'),
    )
    expect(lines.indexOf('/ai-activity/*')).toBeGreaterThan(-1)
  })

  it('preserves hand-written entries outside the managed block', async () => {
    const result = await writeAndRead([], {
      '.gitignore': '.DS_Store\n/some/user/path.pdf\n',
    })
    expect(result).toContain('.DS_Store')
    expect(result).toContain('/some/user/path.pdf')
    expect(result).toContain('!/ai-activity/thinking-organizer/')
  })

  it('rewrites a stale managed block that used the bare directory form', async () => {
    const stale = [
      '# BEGIN Thinking Space managed exclusions',
      '# Auto-managed by Thinking Space — edit through the app, not by hand.',
      '/ai-activity/',
      '/ai-raw/',
      '# END Thinking Space managed exclusions',
    ].join('\n')
    const result = await writeAndRead([], { '.gitignore': `${stale}\n` })
    expect(result.split('\n')).not.toContain('/ai-activity/')
    expect(result).toContain('!/ai-activity/thinking-organizer/')
  })

  it('still applies exceptions when the caller passes the prefix explicitly', async () => {
    const result = await writeAndRead(['ai-activity', 'webull-data'])
    expect(result).toContain('/ai-activity/*')
    expect(result).toContain('!/ai-activity/thinking-organizer/')
    expect(result).toContain('/webull-data/')
  })
})
