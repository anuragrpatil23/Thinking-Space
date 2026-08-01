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
//     <vaultRoot>/ai-activity/chains/<projectId>/<chainId>.md
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
  chainId: string,
): Promise<ProjectChainDigest | null> {
  if (!intelligenceCacheAvailableBlock()) return null
  const rec = await readIntelligenceCacheBlock(
    AI_ACTIVITY_CHAIN_DIGEST_CACHE_TASK_ID,
    chainDigestCacheKeyBlock(projectId, chainId),
  )
  if (!rec) return null
  return parseProjectChainDigestJsonBlock(rec.valueJson)
}

async function readFromVault(
  projectId: string,
  chainId: string,
): Promise<ProjectChainDigest | null> {
  const fs = getVaultFS()
  if (!fs) return null
  const relPath = chainDigestVaultRelPathBlock(projectId, chainId)
  try {
    if (!(await fs.exists(relPath))) return null
    const raw = await fs.read(relPath)
    return parseProjectChainDigestMarkdownBlock(raw)
  } catch {
    return null
  }
}

/** Read a pre-v4 record at `<project>/<date>/<chainKey>.md`. */
async function readLegacyNestedBlock(
  projectId: string,
  date: string,
  chainKey: string,
): Promise<ProjectChainDigest | null> {
  const fs = getVaultFS()
  if (!fs) return null
  const safe = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
  const relPath = `ai-activity/chains/${safe(projectId)}/${date}/${safe(chainKey)}.md`
  try {
    if (!(await fs.exists(relPath))) return null
    return parseProjectChainDigestMarkdownBlock(await fs.read(relPath))
  } catch {
    return null
  }
}

async function writeToVault(digest: ProjectChainDigest): Promise<void> {
  const enabled = await getVaultWriteAiActivityEnabled()
  if (!enabled) return
  const fs = getVaultFS()
  if (!fs) return
  const relPath = chainDigestVaultRelPathBlock(digest.projectId, digest.chainId)
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
    cacheKey: chainDigestCacheKeyBlock(digest.projectId, digest.chainId),
    providerId: 'ai-activity-chain-digest',
    model: digest.model || 'unknown',
    generatedAt: digest.generatedAt,
    valueJson: stringifyProjectChainDigestJsonBlock(digest),
  })
}

/**
 * `legacy` is the pre-v4 nested address (`<project>/<date>/<chainKey>.md`).
 * Passing it is what keeps an existing vault from regenerating: a v1-v3 record
 * lives at that path, and without the fallback the flat lookup misses and the
 * caller pays a provider call to rebuild a title that is already on disk. The
 * record migrates to the flat layout on its next write; this argument can be
 * dropped once no vault has nested files.
 */
export async function getProjectChainDigestBlock(
  projectId: string,
  chainId: string,
  legacy?: { date: string; chainKey: string },
): Promise<ProjectChainDigest | null> {
  const cached = await readFromCache(projectId, chainId)
  if (cached) return cached
  const fromVault = await readFromVault(projectId, chainId)
  if (fromVault) {
    // Warm the cache so subsequent lookups don't re-hit the vault.
    await writeToCache(fromVault)
    return fromVault
  }
  if (legacy) {
    const nested = await readLegacyNestedBlock(projectId, legacy.date, legacy.chainKey)
    if (nested) {
      await writeToCache(nested)
      return nested
    }
  }
  return null
}

export async function putProjectChainDigestBlock(digest: ProjectChainDigest): Promise<void> {
  await writeToCache(digest)
  await writeToVault(digest)
}
