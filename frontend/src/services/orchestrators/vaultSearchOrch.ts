// Vault search workflow — the one engine every vault search surface asks.
//
// The corpus is built from the IndexedDB index cache (no disk walk): every
// markdown path, every non-markdown file name, every folder those imply, and
// each note's title/tags/indexed text. Built once on first query, then reused
// until a sync rewrites the cache (vaultIndexChangedBlock). Works the same on
// desktop, iPhone and web, since all three keep that cache.
//
// Full-text search over note bodies is a later layer; it will slot in as
// another field on the same docs without changing callers.

import {
  getNodeSearchSummaries,
  getVaultAssetIndexRecords,
  getVaultFileIndexRecords,
} from '@/services/lego_blocks/integrations/dbBlock'
import { onVaultIndexChangedBlock } from '@/services/lego_blocks/units/vaultIndexChangedBlock'
import { isAppGeneratedVaultPathBlock } from '@/services/lego_blocks/units/vaultGitignoreBlock'
import {
  rankVaultSearchBlock,
  type VaultSearchDoc,
  type VaultSearchRanking,
} from '@/services/lego_blocks/units/vaultSearchRankBlock'

export type { VaultSearchHit, VaultSearchReason } from '@/services/lego_blocks/units/vaultSearchRankBlock'

let _corpus: Promise<VaultSearchDoc[]> | null = null
let _generation = 0
const _staleListeners = new Set<() => void>()

onVaultIndexChangedBlock(() => {
  if (!_corpus) return
  _corpus = null
  _generation++
  for (const listener of _staleListeners) listener()
})

const isHidden = (path: string) => path.startsWith('.') || path.includes('/.')

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

async function buildCorpus(): Promise<VaultSearchDoc[]> {
  const [markdown, assets, notes] = await Promise.all([
    getVaultFileIndexRecords(),
    getVaultAssetIndexRecords(),
    getNodeSearchSummaries(),
  ])
  const noteByPath = new Map(notes.map(n => [n.filePath, n]))
  const docs: VaultSearchDoc[] = []
  const folders = new Map<string, number>()

  for (const file of [...markdown, ...assets]) {
    if (isHidden(file.path)) continue
    const cut = file.path.lastIndexOf('/')
    const folder = cut > 0 ? file.path.slice(0, cut) : ''
    const name = stemOf(file.path.slice(cut + 1)).toLowerCase()
    const note = noteByPath.get(file.path)
    const title = note?.title.toLowerCase() ?? ''
    docs.push({
      path: file.path,
      kind: 'file',
      name,
      title: title === name ? '' : title,
      tags: note ? note.tags.join(' ').toLowerCase() : '',
      folder: folder.toLowerCase(),
      content: note?.searchText ?? '',
      mtime: file.mtime,
      generated: isAppGeneratedVaultPathBlock(file.path),
    })
    // Every ancestor is a folder doc, dated by its newest file.
    let dir = folder
    while (dir) {
      const seen = folders.get(dir)
      if (seen !== undefined && seen >= file.mtime) break
      folders.set(dir, Math.max(seen ?? 0, file.mtime))
      const up = dir.lastIndexOf('/')
      dir = up > 0 ? dir.slice(0, up) : ''
    }
  }

  for (const [path, mtime] of folders) {
    const cut = path.lastIndexOf('/')
    docs.push({
      path,
      kind: 'folder',
      name: path.slice(cut + 1).toLowerCase(),
      title: '',
      tags: '',
      folder: cut > 0 ? path.slice(0, cut).toLowerCase() : '',
      content: '',
      mtime,
      generated: isAppGeneratedVaultPathBlock(path),
    })
  }
  return docs
}

function corpus(): Promise<VaultSearchDoc[]> {
  if (!_corpus) {
    const generation = _generation
    _corpus = buildCorpus().catch(err => {
      if (generation === _generation) _corpus = null
      throw err
    })
  }
  return _corpus
}

export interface VaultSearchOptions {
  /** Only paths under this folder. */
  scope?: string
  limit?: number
}

/** A few MB of docs is fine while searching, not forever — iOS kills
 *  WebContent on memory, so the corpus goes once searching stops. */
const IDLE_RELEASE_MS = 2 * 60_000
let _releaseTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRelease(): void {
  if (_releaseTimer !== null) clearTimeout(_releaseTimer)
  _releaseTimer = setTimeout(() => {
    _releaseTimer = null
    _corpus = null
    _generation++
  }, IDLE_RELEASE_MS)
}

export async function searchVaultOrch(query: string, options: VaultSearchOptions = {}): Promise<VaultSearchRanking> {
  if (!query.trim()) return { hits: [], total: 0 }
  scheduleRelease()
  return rankVaultSearchBlock(await corpus(), query, options)
}

/** Called when a sync makes earlier results stale, so open searches re-run. */
export function onVaultSearchStaleOrch(listener: () => void): () => void {
  _staleListeners.add(listener)
  return () => { _staleListeners.delete(listener) }
}
