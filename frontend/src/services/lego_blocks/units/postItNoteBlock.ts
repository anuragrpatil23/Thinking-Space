import { filenameFromTitleBlock } from '@/services/lego_blocks/units/noteComposerBlock'

// Turning a canvas post-it into a vault note. Pure half: what the note is
// called. The write itself is `postItVaultSaveOrch`.
//
// A post-it has no title field — whatever you typed first is the closest thing
// to one. "Account No - 345987003" is a fine filename; a 400-character first
// paragraph is not, so the slug is cut at a word boundary.

const TITLE_MAX_CHARS_BLOCK = 60

/** First non-blank line, with leading markdown markers (`#`, `-`, `1.`, `[ ]`)
 *  stripped, cut at a word boundary. Empty string when the post-it is blank. */
export function postItTitleBlock(text: string): string {
  const firstLine = text
    .split('\n')
    .map(line => line.trim())
    .find(Boolean)
  if (!firstLine) return ''
  const stripped = firstLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/^([-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim()
  if (stripped.length <= TITLE_MAX_CHARS_BLOCK) return stripped
  const cut = stripped.slice(0, TITLE_MAX_CHARS_BLOCK)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()
}

/** Suggested filename for a post-it. Falls back to today's date when the first
 *  line has nothing slug-able in it (blank, emoji-only, punctuation). */
export function postItFilenameBlock(text: string): string {
  return filenameFromTitleBlock(postItTitleBlock(text))
}
