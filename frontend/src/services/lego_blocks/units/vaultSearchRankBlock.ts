// Vault search ranking — the one scorer behind every vault search surface.
//
// Every query token must land somewhere (AND), and where it lands sets its
// worth: a file's own name beats its title, which beats its tags, its folder
// path, and finally its indexed content. Within a field, an exact or prefix
// hit beats a word-start hit beats a plain substring. Loose letter-scatter
// matching is allowed only on names, and only when the letters sit close
// together (within 1.5× the token's length) — across 20k paths, unrestricted subsequence matching turns
// "idea" into hundreds of junk hits.
//
// Pure and synchronous: docs are pre-lowercased once by the caller, so a
// keystroke over ~25k docs is a few string scans each.

import { recencyRankBoostBlock } from './fuzzySearchBlock'

export type VaultSearchReason = 'name' | 'title' | 'tags' | 'folder' | 'content'

export interface VaultSearchDoc {
  /** Vault-relative path, original case. */
  path: string
  kind: 'file' | 'folder'
  /** Lowercased file stem (no extension) or folder name. */
  name: string
  /** Lowercased note title; '' when none or same as name. */
  title: string
  /** Lowercased tags, space-joined. */
  tags: string
  /** Lowercased parent folder path. */
  folder: string
  /** Lowercased indexed text (title, tags, excerpt, metadata). */
  content: string
  mtime: number
  /** Machine-written by the app (AI Activity data): still findable, ranked
   *  below the user's own notes. */
  generated?: boolean
}

export interface VaultSearchHit {
  path: string
  kind: 'file' | 'folder'
  score: number
  reason: VaultSearchReason
}

export interface VaultSearchRanking {
  hits: VaultSearchHit[]
  /** Matches before the limit was applied. */
  total: number
}

const FIELD_WEIGHT: Record<VaultSearchReason, number> = {
  name: 1,
  title: 0.9,
  tags: 0.6,
  folder: 0.35,
  content: 0.2,
}

const BOUNDARY = /[\s/_.\-()[\]]/

/** How well one token sits in one field: 0 = absent. */
function tokenFieldScore(token: string, field: string, allowScatter: boolean): number {
  if (!field) return 0
  if (field === token) return 100
  const at = field.indexOf(token)
  if (at === 0) return 80
  if (at > 0) {
    // Prefer a hit that starts a word over one buried mid-word.
    let i = at
    while (i !== -1) {
      if (BOUNDARY.test(field[i - 1])) return 70
      i = field.indexOf(token, i + 1)
    }
    return 50
  }
  if (!allowScatter || token.length < 4) return 0
  // Compact subsequence: "ideafac" → "idea-factory" (skipping the dash), but
  // the matched span must stay within 1.5× the token, so "idea" does not
  // match "i-did-eat-a-lot".
  let ti = 0
  let start = -1
  for (let i = 0; i < field.length && ti < token.length; i++) {
    if (field[i] !== token[ti]) continue
    if (start === -1) start = i
    ti++
    if (ti === token.length) {
      return i - start + 1 <= Math.ceil(token.length * 1.5) ? 20 : 0
    }
  }
  return 0
}

/** Per query token, the notes whose full text contains it (from the index). */
export type VaultSearchContentHits = ReadonlyMap<string, ReadonlySet<string>>

/** How a query splits into tokens — shared so callers can look tokens up. */
export function vaultSearchTokensBlock(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function scoreDoc(
  doc: VaultSearchDoc,
  tokens: string[],
  phrase: string,
  contentHits: VaultSearchContentHits | undefined,
): { score: number; reason: VaultSearchReason } | null {
  const byField: Record<VaultSearchReason, number> = { name: 0, title: 0, tags: 0, folder: 0, content: 0 }
  let score = 0
  for (const token of tokens) {
    let best = 0
    let bestField: VaultSearchReason = 'content'
    const consider = (field: VaultSearchReason, text: string, scatter: boolean) => {
      const s = tokenFieldScore(token, text, scatter) * FIELD_WEIGHT[field]
      if (s > best) { best = s; bestField = field }
    }
    consider('name', doc.name, true)
    consider('title', doc.title, false)
    consider('tags', doc.tags, false)
    consider('folder', doc.folder, false)
    // Content only matters when nothing better matched this token. The full
    // text index counts as a mid-word-strength hit; the cached excerpt as-is.
    if (best < 20) {
      if (contentHits?.get(token)?.has(doc.path)) {
        const s = 50 * FIELD_WEIGHT.content
        if (s > best) { best = s; bestField = 'content' }
      }
      consider('content', doc.content, false)
    }
    if (best === 0) return null
    score += best
    byField[bestField] += best
  }
  // The whole phrase reading straight through the name or title.
  if (tokens.length > 1) {
    if (doc.name.includes(phrase)) score += 40
    else if (doc.title.includes(phrase)) score += 30
  }
  // Short names and shallow paths are more likely the thing being looked for.
  score -= Math.min(10, doc.name.length * 0.05)
  score -= doc.folder ? doc.folder.split('/').length * 0.5 : 0
  if (doc.generated) score -= 35
  score += recencyRankBoostBlock(doc.mtime)

  let reason: VaultSearchReason = 'name'
  let top = -1
  for (const field of Object.keys(byField) as VaultSearchReason[]) {
    if (byField[field] > top) { top = byField[field]; reason = field }
  }
  return { score, reason }
}

export function rankVaultSearchBlock(
  docs: readonly VaultSearchDoc[],
  query: string,
  options: { limit?: number; scope?: string; kind?: 'file' | 'folder'; contentHits?: VaultSearchContentHits } = {},
): VaultSearchRanking {
  const tokens = vaultSearchTokensBlock(query)
  const phrase = tokens.join(' ')
  if (tokens.length === 0) return { hits: [], total: 0 }
  const scope = options.scope ? `${options.scope.replace(/\/+$/, '')}/` : ''

  const hits: VaultSearchHit[] = []
  for (const doc of docs) {
    if (scope && !doc.path.startsWith(scope)) continue
    if (options.kind && doc.kind !== options.kind) continue
    const scored = scoreDoc(doc, tokens, phrase, options.contentHits)
    if (scored) hits.push({ path: doc.path, kind: doc.kind, ...scored })
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const limit = options.limit ?? hits.length
  return { hits: hits.slice(0, limit), total: hits.length }
}

/** A folder's listing in the filtered tree — names, sorted folders-then-files. */
export interface VaultSearchTreeNode {
  folders: string[]
  files: string[]
}

export interface VaultSearchTree {
  /** Folder path ('' = root) → the children that lead to a hit. */
  nodes: Map<string, VaultSearchTreeNode>
  /** Folders that matched by their own name — shown whole, not filtered. */
  matchedFolders: Set<string>
}

/**
 * Lay hits out as a tree: every ancestor of a hit becomes a listing holding
 * just the branches that lead to hits. A folder that matched by name appears
 * in its parent's listing but gets no listing of its own — the explorer shows
 * its real contents, unfiltered, when it is opened.
 */
export function buildVaultSearchTreeBlock(hits: readonly VaultSearchHit[]): VaultSearchTree {
  const sets = new Map<string, { folders: Set<string>; files: Set<string> }>()
  const matchedFolders = new Set<string>()
  const listing = (path: string) => {
    let entry = sets.get(path)
    if (!entry) {
      entry = { folders: new Set(), files: new Set() }
      sets.set(path, entry)
    }
    return entry
  }

  for (const hit of hits) {
    if (hit.kind === 'folder') matchedFolders.add(hit.path)
    const segments = hit.path.split('/')
    let parent = ''
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]
      const isLeaf = i === segments.length - 1
      if (isLeaf && hit.kind === 'file') listing(parent).files.add(name)
      else listing(parent).folders.add(name)
      parent = parent ? `${parent}/${name}` : name
    }
  }

  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const nodes = new Map<string, VaultSearchTreeNode>()
  for (const [path, entry] of sets) {
    nodes.set(path, { folders: [...entry.folders].sort(byName), files: [...entry.files].sort(byName) })
  }
  return { nodes, matchedFolders }
}
