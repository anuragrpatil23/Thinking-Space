// Find-in-note model. A note lights up one NoteFindQuery at a time, from one
// of two places:
//   - the app-wide vault search words (explorer filter, ⌘K) — held here, the
//     latest search wins; matched at word starts, like the full-text index,
//     so the note lights exactly what made it a hit;
//   - text typed into the note's own find bar (⌘F) — matched literally, so a
//     typed phrase finds that phrase.
// `findNoteMatchesBlock` is the one matcher every painter uses (the editor
// layer, the rendered-view highlights).

import { tokenizeFullTextBlock } from './fullTextTokenizeBlock'

type Listener = (words: readonly string[]) => void

let _words: readonly string[] = []
const listeners = new Set<Listener>()

/** Set from a raw query; words follow the full-text index's vocabulary, so
 *  what is highlighted is exactly what made a note match. */
export function setSearchHighlightQueryBlock(query: string | null): void {
  const words = query ? tokenizeFullTextBlock(query) : []
  if (words.length === _words.length && words.every((w, i) => w === _words[i])) return
  _words = words
  for (const listener of listeners) listener(_words)
}

export function getSearchHighlightWordsBlock(): readonly string[] {
  return _words
}

export function onSearchHighlightWordsBlock(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where `words` occur in `text`, the way the index matches them: at a word
 * start, any case, the whole word lit ("fact" → "factory"). Shared by the
 * editor layer and the rendered view so both light up the same thing.
 */
export function findSearchWordMatchesBlock(
  text: string,
  words: readonly string[],
): { from: number; to: number }[] {
  if (words.length === 0 || !text) return []
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join('|')})[\\p{L}\\p{N}]*`,
    'giu',
  )
  const out: { from: number; to: number }[] = []
  for (const match of text.matchAll(pattern)) {
    const from = match.index ?? 0
    out.push({ from, to: from + match[0].length })
  }
  return out
}

export type NoteFindQuery =
  | { mode: 'words'; words: readonly string[] }
  | { mode: 'literal'; text: string }

/** Words from the vault search, or null when there are none. */
export function wordsFindQueryBlock(words: readonly string[]): NoteFindQuery | null {
  return words.length > 0 ? { mode: 'words', words } : null
}

/** Text typed into a find bar, or null when blank. */
export function literalFindQueryBlock(text: string): NoteFindQuery | null {
  const trimmed = text.trim()
  return trimmed ? { mode: 'literal', text: trimmed } : null
}

export function sameNoteFindQueryBlock(a: NoteFindQuery | null, b: NoteFindQuery | null): boolean {
  if (a === b) return true
  if (!a || !b || a.mode !== b.mode) return false
  if (a.mode === 'literal') return a.text === (b as { text: string }).text
  const bw = (b as { words: readonly string[] }).words
  return a.words.length === bw.length && a.words.every((w, i) => w === bw[i])
}

/** Every match of `query` in `text`. */
export function findNoteMatchesBlock(text: string, query: NoteFindQuery | null): { from: number; to: number }[] {
  if (!query || !text) return []
  if (query.mode === 'words') return findSearchWordMatchesBlock(text, query.words)
  const needle = query.text.toLowerCase()
  const haystack = text.toLowerCase()
  const out: { from: number; to: number }[] = []
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    out.push({ from: at, to: at + needle.length })
  }
  return out
}
