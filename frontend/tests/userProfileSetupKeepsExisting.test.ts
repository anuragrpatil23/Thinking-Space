import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
let unreadable = false

vi.mock('@/services/orchestrators/runtimeOrch', () => ({
  getVaultFS: () => ({
    exists: async (path: string) => files.has(path) || [...files.keys()].some(k => k.startsWith(`${path}/`)),
    read: async (path: string) => {
      if (unreadable) throw new Error('placeholder not downloaded')
      const data = files.get(path)
      if (data === undefined) throw new Error('missing')
      return data
    },
    write: async (path: string, data: string) => { files.set(path, data) },
    mkdir: async () => undefined,
  }),
}))
vi.mock('@/services/orchestrators/storageOrch', () => ({
  getStoredVaultRoot: () => '/vault',
}))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
})

const { ensureUserProfileOrch, updateUserProfileOrch } = await import('@/services/orchestrators/userProfileOrch')
const { USER_PROFILE_FILE_PATH_BLOCK } = await import('@/services/lego_blocks/units/userProfileBlock')

describe('ensureUserProfileOrch (vault setup)', () => {
  beforeEach(() => {
    files.clear()
    store.clear()
    unreadable = false
  })

  it('keeps the profile an existing vault already has', async () => {
    const existing = JSON.stringify({ name: 'Anurag', symbol: 'A', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n'
    files.set(USER_PROFILE_FILE_PATH_BLOCK, existing)
    const profile = await ensureUserProfileOrch({ name: 'You', symbol: 'Y' })
    expect(files.get(USER_PROFILE_FILE_PATH_BLOCK)).toBe(existing)
    expect(profile.name).toBe('Anurag')
  })

  it('writes the setup form into a vault that has no profile', async () => {
    await ensureUserProfileOrch({ name: 'New Person', symbol: 'N' })
    expect(JSON.parse(files.get(USER_PROFILE_FILE_PATH_BLOCK) ?? '{}').name).toBe('New Person')
  })

  it('leaves an unreadable profile untouched', async () => {
    files.set(USER_PROFILE_FILE_PATH_BLOCK, 'original bytes')
    unreadable = true
    await ensureUserProfileOrch({ name: 'You', symbol: 'Y' })
    expect(files.get(USER_PROFILE_FILE_PATH_BLOCK)).toBe('original bytes')
  })
})

describe('updateUserProfileOrch (Settings)', () => {
  beforeEach(() => {
    files.clear()
    store.clear()
    unreadable = false
  })

  it('patches the vault profile, keeping fields the patch does not touch', async () => {
    files.set(USER_PROFILE_FILE_PATH_BLOCK, JSON.stringify({ name: 'Anurag', symbol: 'A', memories: ['likes first principles'] }))
    await updateUserProfileOrch({ symbol: 'AP' })
    const saved = JSON.parse(files.get(USER_PROFILE_FILE_PATH_BLOCK) ?? '{}')
    expect(saved).toMatchObject({ name: 'Anurag', symbol: 'AP', memories: ['likes first principles'] })
  })

  it('refuses to save over a profile that has not downloaded yet', async () => {
    files.set(USER_PROFILE_FILE_PATH_BLOCK, 'real profile, not local yet')
    unreadable = true
    await expect(updateUserProfileOrch({ name: 'Someone' })).rejects.toThrow(/still syncing/)
    expect(files.get(USER_PROFILE_FILE_PATH_BLOCK)).toBe('real profile, not local yet')
  })
})
