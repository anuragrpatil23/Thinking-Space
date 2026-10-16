// Vault search workflow — the one engine every vault search surface asks.
//
// The corpus is built from the IndexedDB index cache (no disk walk): every
// markdown path, every non-markdown file name, every folder those imply, and
// each note's title/tags/indexed text. Built once on first query, then reused
// until a sync rewrites the cache (vaultIndexChangedBlock). Works the same on
// desktop, iPhone and web, since all three keep that cache.
//
// Full text over note bodies comes from fullTextIndexOrch (the shared index
// the Mac writes into the vault) and feeds the ranker's content field.

import {
  getNodeSearchSummaries,
  getVaultAssetIndexRecords,
  getVaultFileIndexRecords,
} from '@/services/lego_blocks/integrations/dbBlock'
import { onVaultIndexChangedBlock } from '@/services/lego_blocks/units/vaultIndexChangedBlock'
import { isAppGeneratedVaultPathBlock } from '@/services/lego_blocks/units/vaultGitignoreBlock'
import {
  rankVaultSearchBlock,
  vaultSearchTokensBlock,
  type VaultSearchDoc,
  type VaultSearchRanking,
} from '@/services/lego_blocks/units/vaultSearchRankBlock'

// The full-text reader (and its writer) load with the first search, not at
// startup (Startup Performance contract).
type FullTextModule = typeof import('@/services/orchestrators/fullTextIndexOrch')
let _fullText: Promise<FullTextModule> | null = null
const fullText = () => (_fullText ??= import('@/services/orchestrators/fullTextIndexOrch'))
const resetFullText = () => { void _fullText?.then(m => m.resetFullTextReaderOrch()) }

export type { VaultSearchHit, VaultSearchReason } from '@/services/lego_blocks/units/vaultSearchRankBlock'

let _corpus: Promise<VaultSearchDoc[]> | null = null
let _generation = 0
const _staleListeners = new Set<() => void>()

onVaultIndexChangedBlock(() => {
  if (!_corpus) return
  _corpus = null
  resetFullText()
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
  /** Only files, or only folders. */
  kind?: 'file' | 'folder'
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
    resetFullText()
  }, IDLE_RELEASE_MS)
}

export async function searchVaultOrch(query: string, options: VaultSearchOptions = {}): Promise<VaultSearchRanking> {
  if (!query.trim()) return { hits: [], total: 0 }
  scheduleRelease()
  // Full text comes from the shared on-disk index; when there is none yet,
  // content falls back to each note's cached excerpt.
  const [docs, contentHits] = await Promise.all([
    corpus(),
    options.kind === 'folder'
      ? Promise.resolve(undefined)
      : fullText().then(m => m.lookupFullTextOrch(vaultSearchTokensBlock(query))).catch(() => undefined),
  ])
  return rankVaultSearchBlock(docs, query, { ...options, contentHits })
}

/** The user's most recently modified files (app-generated data left out) —
 *  what a search surface shows before anything is typed. */
export async function listRecentVaultFilesOrch(limit: number): Promise<{ path: string; mtime: number }[]> {
  scheduleRelease()
  return (await corpus())
    .filter(doc => doc.kind === 'file' && !doc.generated)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map(({ path, mtime }) => ({ path, mtime }))
}

/** Called when a sync makes earlier results stale, so open searches re-run. */
export function onVaultSearchStaleOrch(listener: () => void): () => void {
  _staleListeners.add(listener)
  return () => { _staleListeners.delete(listener) }
}
