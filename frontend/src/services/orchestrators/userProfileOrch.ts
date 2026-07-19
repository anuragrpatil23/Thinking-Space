import { getVaultFS } from '@/services/orchestrators/runtimeOrch'
import { getStoredVaultRoot } from '@/services/orchestrators/storageOrch'
import {
  USER_PROFILE_DIR_PATH_BLOCK,
  USER_PROFILE_FILE_PATH_BLOCK,
  applyUserProfilePatchBlock,
  getDefaultUserProfileBlock,
  isDefaultUserProfileBlock,
  readCachedUserProfileBlock,
  sanitizeUserProfileBlock,
  type UserProfileBlock,
  type UserProfilePatchBlock,
  writeCachedUserProfileBlock,
} from '@/services/lego_blocks/units/userProfileBlock'

function hasActiveVaultRootBlock(): boolean {
  const root = getStoredVaultRoot()?.trim()
  return !!root
}

async function readVaultUserProfileBlock(): Promise<UserProfileBlock | null> {
  const fs = getVaultFS()
  const exists = await fs.exists(USER_PROFILE_FILE_PATH_BLOCK)
  if (!exists) return null
  const raw = await fs.read(USER_PROFILE_FILE_PATH_BLOCK)
  const parsed = JSON.parse(raw) as Partial<UserProfileBlock>
  return sanitizeUserProfileBlock(parsed)
}

async function writeVaultUserProfileBlock(profile: UserProfileBlock): Promise<void> {
  const fs = getVaultFS()
  if (!(await fs.exists(USER_PROFILE_DIR_PATH_BLOCK))) {
    await fs.mkdir(USER_PROFILE_DIR_PATH_BLOCK)
  }
  await fs.write(USER_PROFILE_FILE_PATH_BLOCK, `${JSON.stringify(profile, null, 2)}\n`)
}

export async function readUserProfileOrch(): Promise<UserProfileBlock> {
  const cached = readCachedUserProfileBlock()
  if (!hasActiveVaultRootBlock()) return cached
  try {
    const fromVault = await readVaultUserProfileBlock()
    if (!fromVault) {
      // Never seed the vault with a pure-default profile: on a fresh device
      // "file absent" may really mean "iCloud placeholder not detected" or a
      // transient read failure, and writing defaults would clobber the real
      // profile via vault sync. A default cache has nothing worth seeding.
      if (isDefaultUserProfileBlock(cached)) return cached
      const seeded = sanitizeUserProfileBlock({
        ...cached,
        updatedAt: new Date().toISOString(),
      }, cached)
      await writeVaultUserProfileBlock(seeded)
      return writeCachedUserProfileBlock(seeded)
    }
    return writeCachedUserProfileBlock(fromVault)
  } catch (error) {
    console.warn('[userProfileOrch] Failed to read vault profile, using cache:', error)
    return cached
  }
}

export async function ensureUserProfileOrch(seed?: UserProfilePatchBlock): Promise<UserProfileBlock> {
  const cached = readCachedUserProfileBlock()
  const base = hasActiveVaultRootBlock()
    ? await readUserProfileOrch()
    : cached
  const merged = applyUserProfilePatchBlock(base, seed ?? {})
  if (!hasActiveVaultRootBlock()) {
    return writeCachedUserProfileBlock(merged)
  }
  await writeVaultUserProfileBlock(merged)
  return writeCachedUserProfileBlock(merged)
}

export async function updateUserProfileOrch(patch: UserProfilePatchBlock): Promise<UserProfileBlock> {
  const current = await readUserProfileOrch()
  const next = applyUserProfilePatchBlock(current, patch)
  if (hasActiveVaultRootBlock()) {
    await writeVaultUserProfileBlock(next)
  }
  return writeCachedUserProfileBlock(next)
}

export async function resetUserProfileOrch(): Promise<UserProfileBlock> {
  const defaults = getDefaultUserProfileBlock()
  if (hasActiveVaultRootBlock()) {
    await writeVaultUserProfileBlock(defaults)
  }
  return writeCachedUserProfileBlock(defaults)
}
