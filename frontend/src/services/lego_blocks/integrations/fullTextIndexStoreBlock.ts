// On-disk layout of the shared full-text index, in the vault so every device
// gets the Mac's work through iCloud:
//
//   .thinking-space/search-index/
//     manifest.json            which base generation is live, who writes it
//     docs.g<N>.json           base generation N: doc id → path, mtime
//     shards/g<N>.<key>.json   base generation N: term → packed doc ids,
//                              for terms starting with <key> (1 char)
//     delta/<hash>.json        one note re-indexed since the base was built
//
// A note edit rewrites one small delta file, never a shard. A rebuild writes a
// whole new generation beside the old one, flips the manifest, then removes
// the old files — a reader mid-query sees one generation or the other.
// `.thinking-space` is ignored by the vault watcher, so writing here can't
// feed back into sync; the folder is kept out of git (vaultGitignoreBlock).

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { FULL_TEXT_FORMAT_VERSION } from '@/services/lego_blocks/units/fullTextTokenizeBlock'

export const FULL_TEXT_INDEX_DIR = '.thinking-space/search-index'
const SHARDS_DIR = `${FULL_TEXT_INDEX_DIR}/shards`
const DELTA_DIR = `${FULL_TEXT_INDEX_DIR}/delta`
const MANIFEST_PATH = `${FULL_TEXT_INDEX_DIR}/manifest.json`

export interface FullTextManifest {
  version: number
  generation: number
  /** Install id of the one device allowed to write this index. */
  writer: string
  builtAt: number
  docCount: number
}

export interface FullTextDocTable {
  paths: string[]
  /** Epoch seconds, same units as the vault file index. */
  mtimes: number[]
}

/** term → packed postings (see encodePostingsBlock). */
export type FullTextShard = Record<string, string>

export interface FullTextDelta {
  path: string
  mtime: number
  /** Space-joined distinct terms. */
  terms: string
}

const docsPath = (generation: number) => `${FULL_TEXT_INDEX_DIR}/docs.g${generation}.json`
const shardPath = (generation: number, key: string) => `${SHARDS_DIR}/g${generation}.${key}.json`
const deltaPath = (name: string) => `${DELTA_DIR}/${name}.json`

async function readJson<T>(fs: VaultFS, path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.read(path)) as T
  } catch {
    return null
  }
}

export async function ensureFullTextDirsBlock(fs: VaultFS): Promise<void> {
  for (const dir of ['.thinking-space', FULL_TEXT_INDEX_DIR, SHARDS_DIR, DELTA_DIR]) {
    if (!(await fs.exists(dir))) await fs.mkdir(dir)
  }
}

/** Null when absent, unreadable, or written in another format version. */
export async function readFullTextManifestBlock(fs: VaultFS): Promise<FullTextManifest | null> {
  const manifest = await readJson<FullTextManifest>(fs, MANIFEST_PATH)
  return manifest?.version === FULL_TEXT_FORMAT_VERSION ? manifest : null
}

export async function writeFullTextManifestBlock(fs: VaultFS, manifest: FullTextManifest): Promise<void> {
  await fs.write(MANIFEST_PATH, JSON.stringify(manifest))
}

export async function readFullTextDocsBlock(fs: VaultFS, generation: number): Promise<FullTextDocTable | null> {
  return readJson<FullTextDocTable>(fs, docsPath(generation))
}

export async function writeFullTextDocsBlock(fs: VaultFS, generation: number, docs: FullTextDocTable): Promise<void> {
  await fs.write(docsPath(generation), JSON.stringify(docs))
}

/** A missing shard is an empty one — no term in the vault starts that way. */
export async function readFullTextShardBlock(fs: VaultFS, generation: number, key: string): Promise<FullTextShard> {
  return (await readJson<FullTextShard>(fs, shardPath(generation, key))) ?? {}
}

export async function writeFullTextShardBlock(
  fs: VaultFS,
  generation: number,
  key: string,
  shard: FullTextShard,
): Promise<void> {
  await fs.write(shardPath(generation, key), JSON.stringify(shard))
}

export async function listFullTextDeltaNamesBlock(fs: VaultFS): Promise<string[]> {
  try {
    const { files } = await fs.list(DELTA_DIR)
    return files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
  } catch {
    return []
  }
}

export async function readFullTextDeltaBlock(fs: VaultFS, name: string): Promise<FullTextDelta | null> {
  return readJson<FullTextDelta>(fs, deltaPath(name))
}

export async function writeFullTextDeltaBlock(fs: VaultFS, name: string, delta: FullTextDelta): Promise<void> {
  await fs.write(deltaPath(name), JSON.stringify(delta))
}

export async function deleteFullTextDeltaBlock(fs: VaultFS, name: string): Promise<void> {
  await fs.delete(deltaPath(name)).catch(() => undefined)
}

/** Remove every base file that does not belong to `keepGeneration`. */
export async function deleteStaleFullTextGenerationsBlock(fs: VaultFS, keepGeneration: number): Promise<void> {
  const keepShard = `g${keepGeneration}.`
  const keepDocs = `docs.g${keepGeneration}.json`
  try {
    const { files } = await fs.list(SHARDS_DIR)
    for (const file of files) {
      if (!file.startsWith(keepShard)) await fs.delete(`${SHARDS_DIR}/${file}`).catch(() => undefined)
    }
  } catch { /* nothing to clean */ }
  try {
    const { files } = await fs.list(FULL_TEXT_INDEX_DIR)
    for (const file of files) {
      if (file.startsWith('docs.g') && file !== keepDocs) {
        await fs.delete(`${FULL_TEXT_INDEX_DIR}/${file}`).catch(() => undefined)
      }
    }
  } catch { /* nothing to clean */ }
}
