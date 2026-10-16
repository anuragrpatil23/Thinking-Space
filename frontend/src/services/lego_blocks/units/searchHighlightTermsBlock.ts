// The words the user is currently searching for, shared from whichever
// search surface set them (explorer filter, ⌘K) to the note view that lights
// them up. One value app-wide: the latest search wins; null clears.

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
