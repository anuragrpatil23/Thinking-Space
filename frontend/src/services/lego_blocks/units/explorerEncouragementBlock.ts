/* What Clawd says when you pull past the top of the explorer: a hello and a
   small, sincere nudge forward. Never a "slow down" ("take a breath", "take it
   easy"): unasked-for wellness advice reads as nagging. Walked through in order (not drawn at random), so the
   same line never comes twice in a row and every one gets its turn. */

export const EXPLORER_ENCOURAGEMENTS_BLOCK: readonly string[] = [
  'hello!',
  "you're doing great",
  'keep going!',
  'nice thinking today',
  "you've got this",
  'love where this is going',
  'great progress',
  'proud of you',
  'hi again!',
]

const ENCOURAGEMENT_INDEX_KEY_BLOCK = 'thinkspc:explorer-encouragement-index'

/** The line at `index`, wrapping around the list. */
export function encouragementAtBlock(index: number): string {
  const list = EXPLORER_ENCOURAGEMENTS_BLOCK
  return list[((index % list.length) + list.length) % list.length]
}

/** The next line, remembering where it got to across sessions. */
export function nextEncouragementBlock(): string {
  let index = 0
  try {
    index = Number.parseInt(window.localStorage.getItem(ENCOURAGEMENT_INDEX_KEY_BLOCK) ?? '0', 10) || 0
    window.localStorage.setItem(ENCOURAGEMENT_INDEX_KEY_BLOCK, String(index + 1))
  } catch {
    /* Without storage it starts from the top each time; still never repeats
       within one pull. */
  }
  return encouragementAtBlock(index)
}
