import { getVaultFS, type VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  AI_ACTIVITY_SESSION_DIGEST_CACHE_TASK_ID,
  parseProjectSessionDigestJsonBlock,
  parseProjectSessionDigestMarkdownBlock,
  sessionDigestCacheKeyBlock,
  sessionDigestProjectDirBlock,
  SESSIONS_ROOT,
  sessionDigestVaultRelPathBlock,
  stringifyProjectSessionDigestJsonBlock,
  stringifyProjectSessionDigestMarkdownBlock,
  type ProjectSessionDigest,
} from '@/services/lego_blocks/units/aiActivitySessionDigestBlock'
import {
  intelligenceCacheAvailableBlock,
  readIntelligenceCacheBlock,
  writeIntelligenceCacheBlock,
} from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import { getVaultWriteAiActivityEnabled } from '@/services/lego_blocks/units/vaultWritePrefsBlock'

// Two-tier store for per-session digests:
//   fast path: intelligence-cache sidecar JSON
//   durable path (opt-in): vault markdown mirror at
//     <vaultRoot>/ai-activity/sessions/<projectId>/<sessionId>.md
// Cache is warmed on vault hit so subsequent lookups don't re-read the file.
//
// Note what this store does NOT have: a legacy-address fallback. The chain
// store needed one because its address was derived and therefore moved; a
// session id is read off the transcript and never moves, so there is exactly
// one place a record can be, on every device, forever. If a lookup misses, the
// record does not exist — no second guess, no `legacy` parameter threaded
// through every caller.

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
  sessionId: string,
): Promise<ProjectSessionDigest | null> {
  if (!intelligenceCacheAvailableBlock()) return null
  const rec = await readIntelligenceCacheBlock(
    AI_ACTIVITY_SESSION_DIGEST_CACHE_TASK_ID,
    sessionDigestCacheKeyBlock(projectId, sessionId),
  )
  if (!rec) return null
  return parseProjectSessionDigestJsonBlock(rec.valueJson)
}

async function readFromVault(
  projectId: string,
  sessionId: string,
): Promise<ProjectSessionDigest | null> {
  const fs = getVaultFS()
  if (!fs) return null
  const relPath = sessionDigestVaultRelPathBlock(projectId, sessionId)
  try {
    if (!(await fs.exists(relPath))) return null
    return parseProjectSessionDigestMarkdownBlock(await fs.read(relPath))
  } catch {
    return null
  }
}

async function writeToVault(digest: ProjectSessionDigest): Promise<void> {
  if (!(await getVaultWriteAiActivityEnabled())) return
  const fs = getVaultFS()
  if (!fs) return
  const relPath = sessionDigestVaultRelPathBlock(digest.projectId, digest.sessionId)
  try {
    await ensureVaultDir(fs, relPath.slice(0, relPath.lastIndexOf('/')))
    await fs.write(relPath, stringifyProjectSessionDigestMarkdownBlock(digest))
  } catch {
    // Vault write is best-effort — cache remains the source of truth.
  }
}

async function writeToCache(digest: ProjectSessionDigest): Promise<void> {
  if (!intelligenceCacheAvailableBlock()) return
  await writeIntelligenceCacheBlock({
    taskId: AI_ACTIVITY_SESSION_DIGEST_CACHE_TASK_ID,
    cacheKey: sessionDigestCacheKeyBlock(digest.projectId, digest.sessionId),
    providerId: 'ai-activity-session-digest',
    model: digest.model || 'unknown',
    generatedAt: digest.generatedAt,
    valueJson: stringifyProjectSessionDigestJsonBlock(digest),
  })
}

export async function getProjectSessionDigestBlock(
  projectId: string,
  sessionId: string,
): Promise<ProjectSessionDigest | null> {
  const cached = await readFromCache(projectId, sessionId)
  if (cached) return cached
  const fromVault = await readFromVault(projectId, sessionId)
  if (fromVault) {
    // Warm the cache so subsequent lookups don't re-hit the vault.
    await writeToCache(fromVault)
    return fromVault
  }
  return null
}

export async function putProjectSessionDigestBlock(digest: ProjectSessionDigest): Promise<void> {
  await writeToCache(digest)
  await writeToVault(digest)
}

/** Every project with at least one stored session digest. The queue spans
 *  projects, and this is how it finds them without a registry read. */
export async function listSessionProjectsBlock(): Promise<string[]> {
  const fs = getVaultFS()
  try {
    return (await fs.list(SESSIONS_ROOT)).folders.slice().sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * Set the human `undertaking` field on a stored digest, leaving everything else
 * exactly as it was.
 *
 * Separate from `putProjectSessionDigestBlock` because the two writes mean
 * different things. A put replaces a *derived* record; this patches a *human*
 * one. Assignment is judgment, not derivation, so regeneration must never
 * clobber it — which is only guaranteed if assignment never round-trips through
 * the generation path.
 *
 * Returns null when there is no record to patch. That is deliberate: an
 * assignment to a session with no digest would have to invent the derived
 * fields to have something to write, and an invented record is worse than a
 * refused write.
 */
export async function patchSessionUndertakingBlock(
  projectId: string,
  sessionId: string,
  undertaking: string[],
): Promise<ProjectSessionDigest | null> {
  const existing = await getProjectSessionDigestBlock(projectId, sessionId)
  if (!existing) return null
  const next: ProjectSessionDigest = { ...existing, undertaking }
  await writeToCache(next)

  // Writes the vault file DIRECTLY, deliberately bypassing
  // `getVaultWriteAiActivityEnabled`. That preference governs whether *derived*
  // AI-activity records get mirrored into the vault — a reasonable thing to
  // decline, because they can always be regenerated. An assignment cannot. It
  // is a human judgment with no other source, so honouring the mirror
  // preference here would silently discard the one field in this record that
  // nothing can reconstruct.
  const fs = getVaultFS()
  if (!fs) return next
  const relPath = sessionDigestVaultRelPathBlock(projectId, sessionId)
  try {
    await ensureVaultDir(fs, relPath.slice(0, relPath.lastIndexOf('/')))
    await fs.write(relPath, stringifyProjectSessionDigestMarkdownBlock(next))
  } catch {
    // Cache still holds it; surfacing a throw here would abort a disposition
    // the ledger has already recorded.
  }
  return next
}

/**
 * Every stored session digest for a project.
 *
 * Reads the vault directory rather than the cache because this is the path the
 * organizer and the range composer use, and they must see records written on
 * another device. Missing directory reads as "no digests yet", not an error —
 * a project the user has never opened an AI session in is the normal case.
 */
export async function listProjectSessionDigestsBlock(
  projectId: string,
): Promise<ProjectSessionDigest[]> {
  const fs = getVaultFS()
  if (!fs) return []
  const dir = sessionDigestProjectDirBlock(projectId)
  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    // Missing directory reads as "no digests yet", not an error — a project the
    // user has never run an AI session in is the normal case.
    return []
  }
  const out: ProjectSessionDigest[] = []
  for (const name of names) {
    try {
      const parsed = parseProjectSessionDigestMarkdownBlock(await fs.read(`${dir}/${name}`))
      if (parsed) out.push(parsed)
    } catch {
      // One unreadable record must not blank the whole project's history.
    }
  }
  out.sort((a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso))
  return out
}
