// Full-text index vocabulary — the single definition of "a word" shared by the
// index writer and every reader. If writer and reader ever split text
// differently, search silently misses notes, so both import this file and
// nothing else decides it.
//
// Also the on-disk encodings: which shard a term lives in, and how a posting
// list (sorted doc ids) is packed into a short string.

/** Bump when tokenizing or encoding changes; readers ignore other versions. */
export const FULL_TEXT_FORMAT_VERSION = 1

const MIN_TERM = 2
const MAX_TERM = 32
/** Prefix lookups below this length would match half the vocabulary. */
export const FULL_TEXT_MIN_PREFIX = 3

// Words so common that their postings would list nearly every note.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has',
  'have', 'he', 'her', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me',
  'my', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'so', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up',
  'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'you',
  'your',
])

const WORD = /[\p{L}\p{N}]+/gu

function keepTerm(term: string): boolean {
  if (term.length < MIN_TERM || term.length > MAX_TERM) return false
  if (STOPWORDS.has(term)) return false
  // Long digit runs are ids and timestamps, not words anyone searches.
  if (term.length > 4 && /^\d+$/.test(term)) return false
  return true
}

/** The distinct terms of a text, in first-seen order. */
export function tokenizeFullTextBlock(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.toLowerCase().matchAll(WORD)) {
    const term = match[0]
    if (keepTerm(term)) seen.add(term)
  }
  return [...seen]
}

/**
 * Shard a term by its first character; anything outside a-z0-9 → '_'.
 * Measured on the real vault (2026-10-16): 4k notes, 111 MB of text → a
 * 7.5 MB index. One-char shards give ~40 files of ~200 KB; two-char shards
 * gave 1,344 files of a few KB each — needless per-file iCloud overhead for
 * no gain, since a lookup reads one shard per word either way.
 */
export function fullTextShardKeyBlock(term: string): string {
  const ch = term[0] ?? '_'
  return /[a-z0-9]/.test(ch) ? ch : '_'
}

/** Sorted doc ids → gaps in base36, comma-joined ("3,a,1" = ids 3, 13, 14). */
export function encodePostingsBlock(sortedIds: readonly number[]): string {
  let prev = 0
  const parts: string[] = []
  for (const id of sortedIds) {
    parts.push((id - prev).toString(36))
    prev = id
  }
  return parts.join(',')
}

export function decodePostingsBlock(encoded: string): number[] {
  if (!encoded) return []
  const ids: number[] = []
  let prev = 0
  for (const part of encoded.split(',')) {
    prev += parseInt(part, 36)
    ids.push(prev)
  }
  return ids
}

/** Stable short file name for a note's delta entry (two FNV-1a passes). */
export function fullTextDeltaNameBlock(path: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}
