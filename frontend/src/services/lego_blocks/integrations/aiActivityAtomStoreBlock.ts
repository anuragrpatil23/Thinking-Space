import { getVaultFS, type VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  AI_ACTIVITY_ATOM_CACHE_TASK_ID,
  atomCacheKeyBlock,
  atomVaultRelPathBlock,
  isRuleBasedAtomBlock,
  parseProjectDayAtomJsonBlock,
  parseProjectDayAtomMarkdownBlock,
  stringifyProjectDayAtomJsonBlock,
  stringifyProjectDayAtomMarkdownBlock,
  type ProjectDayAtom,
} from '@/services/lego_blocks/units/aiActivityAtomBlock'
import {
  clearIntelligenceCacheBlock,
  intelligenceCacheAvailableBlock,
  readIntelligenceCacheBlock,
  writeIntelligenceCacheBlock,
} from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import { getVaultWriteAiActivityEnabled } from '@/services/lego_blocks/units/vaultWritePrefsBlock'

// Read/write atoms through a two-tier store:
//   fast path: intelligence-cache sidecar JSON at
//     ~/.thinking-space/intelligence-cache/projectDayAtom/<key>.json
//   durable path (opt-in): vault markdown mirror at
//     <vaultRoot>/ai-activity/atoms/<projectId>/<YYYY-MM-DD>.md
//
// A missed cache read falls through to the vault so that a fresh install on
// another device can resume from atoms already synced via iCloud. Writes go
// to the cache always; the vault mirror is gated by the `writeAiActivity`
// toggle (see vaultWritePrefsBlock).

async function ensureVaultDir(fs: VaultFS, dir: string): Promise<void> {
  const segments = dir.split('/').filter(Boolean)
  let prefix = ''
  for (const seg of segments) {
    prefix = prefix ? `${prefix}/${seg}` : seg
    try {
      if (!(await fs.exists(prefix))) await fs.mkdir(prefix)
    } catch {
      // Ignore — concurrent create or already-exists.
    }
  }
}

async function readAtomFromCache(projectId: string, date: string): Promise<ProjectDayAtom | null> {
  if (!intelligenceCacheAvailableBlock()) return null
  const cacheKey = atomCacheKeyBlock(projectId, date)
  const rec = await readIntelligenceCacheBlock(AI_ACTIVITY_ATOM_CACHE_TASK_ID, cacheKey)
  if (!rec) return null
  return parseProjectDayAtomJsonBlock(rec.valueJson)
}

async function readAtomFromVault(projectId: string, date: string): Promise<ProjectDayAtom | null> {
  const fs = getVaultFS()
  if (!fs) return null
  const relPath = atomVaultRelPathBlock(projectId, date)
  try {
    if (!(await fs.exists(relPath))) return null
    const raw = await fs.read(relPath)
    return parseProjectDayAtomMarkdownBlock(raw)
  } catch {
    return null
  }
}

async function writeAtomToVault(atom: ProjectDayAtom): Promise<void> {
  const enabled = await getVaultWriteAiActivityEnabled()
  if (!enabled) return
  const fs = getVaultFS()
  if (!fs) return
  const relPath = atomVaultRelPathBlock(atom.projectId, atom.date)
  const dir = relPath.slice(0, relPath.lastIndexOf('/'))
  try {
    await ensureVaultDir(fs, dir)
    await fs.write(relPath, stringifyProjectDayAtomMarkdownBlock(atom))
  } catch {
    // Vault write is best-effort — cache remains the source of truth.
  }
}

async function writeAtomToCache(atom: ProjectDayAtom): Promise<void> {
  if (!intelligenceCacheAvailableBlock()) return
  await writeIntelligenceCacheBlock({
    taskId: AI_ACTIVITY_ATOM_CACHE_TASK_ID,
    cacheKey: atomCacheKeyBlock(atom.projectId, atom.date),
    providerId: 'ai-activity-atom',
    model: atom.model || 'unknown',
    generatedAt: atom.generatedAt,
    valueJson: stringifyProjectDayAtomJsonBlock(atom),
  })
}

export async function getProjectDayAtomBlock(
  projectId: string,
  date: string,
): Promise<ProjectDayAtom | null> {
  const cached = await readAtomFromCache(projectId, date)
  if (cached) return cached
  const fromVault = await readAtomFromVault(projectId, date)
  if (fromVault) {
    // Warm the cache so subsequent lookups don't re-hit the vault.
    await writeAtomToCache(fromVault)
    return fromVault
  }
  return null
}

export async function putProjectDayAtomBlock(atom: ProjectDayAtom): Promise<void> {
  await writeAtomToCache(atom)
  await writeAtomToVault(atom)
}

/**
 * One-time cleanup of the legacy bug where deterministic (rule-based) stub
 * atoms were persisted alongside real AI output. Walks the vault mirror
 * (`ai-activity/atoms/<projectId>/<date>.md`), deletes every file that parses
 * to a rule-based atom, then drops the whole fast-path cache task dir.
 *
 * The cache is cleared wholesale rather than per-key because the sidecar has
 * no list/selective-delete API — but that's safe: it's a rebuildable mirror,
 * so surviving real atoms re-warm from the vault (or regenerate) on next read,
 * while any stub cache entries we couldn't enumerate simply vanish.
 *
 * Idempotent and best-effort — safe to call again; unreadable/unparseable
 * files are left untouched. The orchestrator gates it behind a run-once flag.
 */
export async function purgeRuleBasedAtomsFromStoreBlock(): Promise<{
  scannedVaultFiles: number
  deletedVaultFiles: number
  clearedCache: boolean
}> {
  let scanned = 0
  let deleted = 0
  const fs = getVaultFS()
  if (fs) {
    try {
      const root = 'ai-activity/atoms'
      if (await fs.exists(root)) {
        const { folders } = await fs.list(root)
        for (const projectId of folders) {
          const projectDir = `${root}/${projectId}`
          let files: string[] = []
          try {
            files = (await fs.list(projectDir)).files
          } catch {
            continue
          }
          for (const file of files) {
            if (!file.endsWith('.md')) continue
            scanned++
            const relPath = `${projectDir}/${file}`
            try {
              const atom = parseProjectDayAtomMarkdownBlock(await fs.read(relPath))
              if (atom && isRuleBasedAtomBlock(atom)) {
                await fs.delete(relPath)
                deleted++
              }
            } catch {
              // Unreadable or unparseable — leave it rather than risk data loss.
            }
          }
        }
      }
    } catch {
      // Best-effort — a listing failure shouldn't block app startup.
    }
  }
  const clearedCache = await clearIntelligenceCacheBlock(AI_ACTIVITY_ATOM_CACHE_TASK_ID)
  return { scannedVaultFiles: scanned, deletedVaultFiles: deleted, clearedCache }
}

/**
 * Load atoms for a project across a date range (inclusive on both ends).
 * Missing days simply don't appear in the returned array — the caller is
 * responsible for pairing atoms with the period's expected date list.
 */
export async function listProjectDayAtomsInRangeBlock(
  projectId: string,
  fromDate: string,
  toDate: string,
): Promise<ProjectDayAtom[]> {
  const dates = enumerateDates(fromDate, toDate)
  const results = await Promise.all(dates.map(d => getProjectDayAtomBlock(projectId, d)))
  const out: ProjectDayAtom[] = []
  for (const atom of results) if (atom) out.push(atom)
  return out
}

function enumerateDates(fromIso: string, toIso: string): string[] {
  if (fromIso > toIso) return []
  const out: string[] = []
  const cursor = new Date(`${fromIso}T00:00:00`)
  const end = new Date(`${toIso}T00:00:00`)
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    const d = String(cursor.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${d}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}
