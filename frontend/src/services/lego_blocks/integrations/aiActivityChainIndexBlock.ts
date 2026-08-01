import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  chainDigestVaultRelPathBlock,
  parseProjectChainDigestMarkdownBlock,
  stringifyProjectChainDigestMarkdownBlock,
  type ProjectChainDigest,
} from '@/services/lego_blocks/units/aiActivityChainDigestBlock'

/**
 * Walk the stored chain digests: `ai-activity/chains/<project>/*.md`.
 *
 * Flat, addressed by `chainId`. The previous layout nested a `<date>/` bucket
 * and named files after `chainKey` — both computed from the grouping rule, so
 * re-chaining moved records and orphaned them. Legacy nested files are still
 * *read* (see `readLegacyNestedBlock`) so nothing is lost; they are superseded
 * the first time their chain is written back, and the reader can be deleted
 * once no vault has them.
 *
 * Every consumer of this data has so far grepped the filesystem directly, which
 * is why four defects in the layer went unnoticed until something tried to build
 * an index on it. One reader, one place to fix.
 *
 * Chains are the *tail* of an undertaking. They are read here and never copied
 * into an undertaking record — an undertaking that cached its own tail would go
 * stale the moment another session landed, which is precisely the failure mode
 * `ranges/` already has.
 */

const CHAINS_ROOT = 'ai-activity/chains'

export interface ChainQuery {
  projectId: string
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string
  to?: string
  /** Only chains assigned to this undertaking key. */
  undertaking?: string
}

function withinRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

/** Legacy date buckets under a project, newest layout has none. */
export async function listChainDatesBlock(projectId: string): Promise<string[]> {
  const fs = getVaultFS()
  try {
    const listed = await fs.list(`${CHAINS_ROOT}/${projectId}`)
    return listed.folders.filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()
  } catch {
    return []
  }
}

async function readDigestFileBlock(path: string): Promise<ChainEntry | null> {
  const fs = getVaultFS()
  let content: string
  try {
    content = await fs.read(path)
  } catch {
    return null
  }
  const digest = parseProjectChainDigestMarkdownBlock(content)
  return digest ? { ...digest, path } : null
}

export interface ChainEntry extends ProjectChainDigest {
  /** Vault-relative path of the chain file, for repair capabilities. */
  path: string
}

export async function listChainsBlock(query: ChainQuery): Promise<ChainEntry[]> {
  const fs = getVaultFS()
  const dir = `${CHAINS_ROOT}/${query.projectId}`

  // Flat layout first, so a migrated record always wins over its legacy twin.
  const byId = new Map<string, ChainEntry>()
  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    names = []
  }
  for (const name of names) {
    const entry = await readDigestFileBlock(`${dir}/${name}`)
    if (entry) byId.set(entry.chainId, entry)
  }

  // Legacy `<date>/<chainKey>.md`. Skipped entirely once a project has been
  // written back, because `listChainDatesBlock` finds no date folders.
  for (const date of await listChainDatesBlock(query.projectId)) {
    let legacy: string[] = []
    try {
      legacy = (await fs.list(`${dir}/${date}`)).files.filter(name => name.endsWith('.md'))
    } catch {
      continue
    }
    for (const name of legacy) {
      const entry = await readDigestFileBlock(`${dir}/${date}/${name}`)
      if (entry && !byId.has(entry.chainId)) byId.set(entry.chainId, entry)
    }
  }

  const out: ChainEntry[] = []
  for (const entry of byId.values()) {
    if (!withinRange(entry.date, query.from, query.to)) continue
    if (query.undertaking && !entry.undertaking.includes(query.undertaking)) continue
    out.push(entry)
  }

  out.sort((a, b) => a.startedIso.localeCompare(b.startedIso) || a.chainId.localeCompare(b.chainId))
  return out
}

export async function findChainBlock(
  projectId: string,
  chainKey: string,
): Promise<ChainEntry | null> {
  const chains = await listChainsBlock({ projectId })
  return chains.find(chain => chain.chainKey === chainKey) ?? null
}

/**
 * Rewrite a chain file in place, preserving everything the caller didn't touch.
 *
 * Used by the repair capabilities (`chain.set_project`, `chain.set_files`) and
 * by assignment stamping. Chains are generated artifacts, but these three fields
 * are judgment, not derivation — regeneration must not clobber them, which is
 * why they are patched onto the existing file rather than recomputed.
 */
export async function patchChainBlock(
  entry: ChainEntry,
  patch: Partial<Pick<ProjectChainDigest, 'projectId' | 'filesWritten' | 'filesRead' | 'undertaking'>>,
): Promise<{ path: string; digest: ProjectChainDigest }> {
  const fs = getVaultFS()
  const digest: ProjectChainDigest = { ...entry, ...patch }
  const content = stringifyProjectChainDigestMarkdownBlock(digest)

  // Re-projecting moves the file: the project id is a path segment, so leaving
  // it in place would make the on-disk location contradict the frontmatter.
  // The date is not a segment any more, so only a project change relocates —
  // and a legacy nested record migrates to the flat layout on its first patch.
  const targetDir = `${CHAINS_ROOT}/${digest.projectId}`
  const targetPath = chainDigestVaultRelPathBlock(digest.projectId, digest.chainId)

  if (targetPath !== entry.path) {
    await fs.mkdir(targetDir)
    await fs.write(targetPath, content)
    try {
      await fs.delete(entry.path)
    } catch {
      // Leaving a stale copy is better than losing the chain; the duplicate is
      // visible and repairable, a deletion mid-write is not.
    }
  } else {
    await fs.write(targetPath, content)
  }

  return { path: targetPath, digest }
}
