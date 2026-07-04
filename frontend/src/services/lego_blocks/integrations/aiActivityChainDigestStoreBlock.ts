import { getVaultFS, type VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  AI_ACTIVITY_CHAIN_DIGEST_CACHE_TASK_ID,
  chainDigestCacheKeyBlock,
  chainDigestVaultRelPathBlock,
  parseProjectChainDigestJsonBlock,
  parseProjectChainDigestMarkdownBlock,
  stringifyProjectChainDigestJsonBlock,
  stringifyProjectChainDigestMarkdownBlock,
  type ProjectChainDigest,
} from '@/services/lego_blocks/units/aiActivityChainDigestBlock'
import {
  intelligenceCacheAvailableBlock,
  readIntelligenceCacheBlock,
  writeIntelligenceCacheBlock,
} from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import { getVaultWriteAiActivityEnabled } from '@/services/lego_blocks/units/vaultWritePrefsBlock'

// Two-tier store for per-chain digests, mirroring the atom store:
//   fast path: intelligence-cache sidecar JSON
//   durable path (opt-in): vault markdown mirror at
//     <vaultRoot>/ai-activity/chains/<projectId>/<YYYY-MM-DD>/<chainKey>.md
// Cache is warmed on vault hit so subsequent lookups don't re-read the file.

async function ensureVaultDir(fs: VaultFS, dir: string): Promise<void> {
  const segments = dir.split('/').filter(Boolean)
  let prefix = ''
  for (const seg of segments) {
    prefix = prefix ? `${prefix}/${seg}` : seg
    try {
      if (!(await fs.exists(prefix))) await fs.mkdir(prefix)
    } catch {
      // Concurrent create or already-exists — fine.
    }
  }
}

async function readFromCache(
  projectId: string,
  date: string,
  chainKey: string,
): Promise<ProjectChainDigest | null> {
  if (!intelligenceCacheAvailableBlock()) return null
  const rec = await readIntelligenceCacheBlock(
    AI_ACTIVITY_CHAIN_DIGEST_CACHE_TASK_ID,
    chainDigestCacheKeyBlock(projectId, date, chainKey),
  )
  if (!rec) return null
  return parseProjectChainDigestJsonBlock(rec.valueJson)
}

async function readFromVault(
  projectId: string,
  date: string,
  chainKey: string,
): Promise<ProjectChainDigest | null> {
  const fs = getVaultFS()
  if (!fs) return null
  const relPath = chainDigestVaultRelPathBlock(projectId, date, chainKey)
  try {
    if (!(await fs.exists(relPath))) return null
    const raw = await fs.read(relPath)
    return parseProjectChainDigestMarkdownBlock(raw)
  } catch {
    return null
  }
}

async function writeToVault(digest: ProjectChainDigest): Promise<void> {
  const enabled = await getVaultWriteAiActivityEnabled()
  if (!enabled) return
  const fs = getVaultFS()
  if (!fs) return
  const relPath = chainDigestVaultRelPathBlock(digest.projectId, digest.date, digest.chainKey)
  const dir = relPath.slice(0, relPath.lastIndexOf('/'))
  try {
    await ensureVaultDir(fs, dir)
    await fs.write(relPath, stringifyProjectChainDigestMarkdownBlock(digest))
  } catch {
    // Vault write is best-effort — cache remains the source of truth.
  }
}

async function writeToCache(digest: ProjectChainDigest): Promise<void> {
  if (!intelligenceCacheAvailableBlock()) return
  await writeIntelligenceCacheBlock({
    taskId: AI_ACTIVITY_CHAIN_DIGEST_CACHE_TASK_ID,
    cacheKey: chainDigestCacheKeyBlock(digest.projectId, digest.date, digest.chainKey),
    providerId: 'ai-activity-chain-digest',
    model: digest.model || 'unknown',
    generatedAt: digest.generatedAt,
    valueJson: stringifyProjectChainDigestJsonBlock(digest),
  })
}

export async function getProjectChainDigestBlock(
  projectId: string,
  date: string,
  chainKey: string,
): Promise<ProjectChainDigest | null> {
  const cached = await readFromCache(projectId, date, chainKey)
  if (cached) return cached
  const fromVault = await readFromVault(projectId, date, chainKey)
  if (fromVault) {
    // Warm the cache so subsequent lookups don't re-hit the vault.
    await writeToCache(fromVault)
    return fromVault
  }
  return null
}

export async function putProjectChainDigestBlock(digest: ProjectChainDigest): Promise<void> {
  await writeToCache(digest)
  await writeToVault(digest)
}
