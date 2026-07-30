import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseProjectChainDigestMarkdownBlock,
  stringifyProjectChainDigestMarkdownBlock,
  type ProjectChainDigest,
} from '@/services/lego_blocks/units/aiActivityChainDigestBlock'

/**
 * Walk the stored chain digests: `ai-activity/chains/<project>/<date>/*.md`.
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

export async function listChainDatesBlock(projectId: string): Promise<string[]> {
  const fs = getVaultFS()
  try {
    const listed = await fs.list(`${CHAINS_ROOT}/${projectId}`)
    return listed.folders.filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()
  } catch {
    return []
  }
}

export interface ChainEntry extends ProjectChainDigest {
  /** Vault-relative path of the chain file, for repair capabilities. */
  path: string
}

export async function listChainsBlock(query: ChainQuery): Promise<ChainEntry[]> {
  const fs = getVaultFS()
  const dates = await listChainDatesBlock(query.projectId)
  const out: ChainEntry[] = []

  for (const date of dates) {
    if (!withinRange(date, query.from, query.to)) continue
    const dir = `${CHAINS_ROOT}/${query.projectId}/${date}`
    let names: string[] = []
    try {
      names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
    } catch {
      continue
    }
    for (const name of names) {
      const path = `${dir}/${name}`
      let content: string
      try {
        content = await fs.read(path)
      } catch {
        continue
      }
      const digest = parseProjectChainDigestMarkdownBlock(content)
      if (!digest) continue
      if (query.undertaking && !digest.undertaking.includes(query.undertaking)) continue
      out.push({ ...digest, path })
    }
  }

  out.sort((a, b) => a.startedIso.localeCompare(b.startedIso) || a.chainKey.localeCompare(b.chainKey))
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
  const targetDir = `${CHAINS_ROOT}/${digest.projectId}/${digest.date}`
  const name = entry.path.slice(entry.path.lastIndexOf('/') + 1)
  const targetPath = `${targetDir}/${name}`

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
