// Notes made while reading the Feed: questions (Q) and comments (C) typed
// against an article, and articles the user tagged for later (`new company`,
// `understand more`, `interesting`, `research more`), picked up without being
// asked. One file, <executionRoot>/feed/notes.md, one line per note, readable
// and editable in any Markdown app:
//
//   - [ ] How does nanosecond OCS fit with CPO? <!-- {"id":"…","kind":"question",…} -->
//   - Resolight is one to watch <!-- {"id":"…","kind":"comment",…} -->
//   - [x] … (a question that has been understood)
//
// The comment holds where the note came from (article, link, source, ticker).
// Each note is its own line, so removing one never touches another. A picked-up
// tag that the user removes stays as a line marked `removed`, so it is not
// picked up again; typed notes are simply deleted.

export const FEED_NOTES_FILE_BLOCK = 'notes.md'

/** Tags that make an article worth coming back to; tagging one picks it up. */
export const FEED_PICKUP_TAGS_BLOCK = ['new company', 'understand more', 'research more', 'interesting'] as const

export type FeedNoteKindBlock = 'question' | 'comment' | 'tagged'

export interface FeedNoteBlock {
  id: string
  kind: FeedNoteKindBlock
  /** The question or comment; for a tagged article, its headline */
  text: string
  /** A question understood, or any note dealt with */
  done: boolean
  /** A picked-up note the user removed: kept so it is not picked up again */
  removed?: boolean
  /** The tag that picked it up (kind 'tagged') */
  tag?: string
  itemId: string
  title: string
  link: string
  source: string
  /** The company it is about, when the feed says (NVDA Feed → NVDA) */
  ticker: string | null
  /** ISO time it was made */
  at: string
}

const HEADER = [
  '# Reading notes',
  '',
  'Questions and comments made while reading the Feed in Thinking Space, and articles tagged to come back to.',
  'One note per line; tick a question once it is understood. The comment at the end of each line says where it came from.',
  '',
].join('\n')

const LINE_RE = /^- (?:\[( |x|X)\] )?(.*?)\s*<!--\s*(\{.*\})\s*-->\s*$/

/** The company a feed is about, from its name: "NVDA Feed", "NVDA - Blog", "NASDAQ - TSLA". */
export function feedTickerBlock(feedTitle: string): string | null {
  const title = feedTitle.trim()
  const nasdaq = title.match(/^NASDAQ\s*-\s*([A-Z]{1,5})$/)
  if (nasdaq) return nasdaq[1]
  const own = title.match(/^([A-Z]{1,5})(?:\s+Feed\b|\s+-\s)/)
  return own ? own[1] : null
}

export function newFeedNoteIdBlock(now = Date.now()): string {
  return `n-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function parseFeedNotesBlock(content: string): FeedNoteBlock[] {
  const notes: FeedNoteBlock[] = []
  for (const line of content.split('\n')) {
    const match = line.match(LINE_RE)
    if (!match) continue
    try {
      const meta = JSON.parse(match[3]) as Partial<FeedNoteBlock>
      if (!meta.id || !meta.kind) continue
      notes.push({
        id: meta.id,
        kind: meta.kind,
        text: match[2].trim(),
        done: (match[1] ?? ' ').toLowerCase() === 'x',
        ...(meta.removed ? { removed: true } : {}),
        ...(meta.tag ? { tag: meta.tag } : {}),
        itemId: meta.itemId ?? '',
        title: meta.title ?? '',
        link: meta.link ?? '',
        source: meta.source ?? '',
        ticker: meta.ticker ?? null,
        at: meta.at ?? '',
      })
    } catch { /* a hand-edited line that no longer parses is left alone */ }
  }
  return notes
}

function formatLineBlock(note: FeedNoteBlock): string {
  const { text, done, ...meta } = note
  // `>` escaped so a headline can never close the comment early
  const json = JSON.stringify(meta).replace(/>/g, '\\u003e')
  const box = note.kind === 'comment' ? '' : `[${done ? 'x' : ' '}] `
  return `- ${box}${text.replace(/\s+/g, ' ').trim()} <!-- ${json} -->`
}

/** The file with this note added at the end (a new file gets the header). */
export function appendFeedNoteBlock(content: string | null, note: FeedNoteBlock): string {
  const base = content && content.trim() ? content.replace(/\n*$/, '\n') : `${HEADER}\n`
  return `${base}${formatLineBlock(note)}\n`
}

/**
 * The file with one note's line replaced, or removed when `next` is null.
 * Every other line, hand-written ones included, stays exactly as it was.
 */
export function replaceFeedNoteBlock(content: string, id: string, next: FeedNoteBlock | null): string {
  return content
    .split('\n')
    .flatMap((line) => {
      const match = line.match(LINE_RE)
      if (!match) return [line]
      try {
        if ((JSON.parse(match[3]) as { id?: string }).id !== id) return [line]
      } catch { return [line] }
      return next ? [formatLineBlock(next)] : []
    })
    .join('\n')
}

export function feedNotesPathBlock(executionRoot: string): string {
  return `${executionRoot.replace(/\/+$/, '')}/feed/${FEED_NOTES_FILE_BLOCK}`
}
