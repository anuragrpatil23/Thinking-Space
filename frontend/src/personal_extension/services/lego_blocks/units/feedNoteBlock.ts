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
  /** When the article was published (ISO), so a tag picked up later still dates by the article */
  published?: string
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
        ...(meta.published ? { published: meta.published } : {}),
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

/** One article and everything reading left on it: its tags, questions and comments. */
export interface FeedNoteArticleBlock {
  itemId: string
  title: string
  link: string
  source: string
  ticker: string | null
  /** YYYY-MM-DD, local: the day it belongs under */
  day: string
  tags: FeedNoteBlock[]
  questions: FeedNoteBlock[]
  comments: FeedNoteBlock[]
  /** Every live note on it */
  notes: FeedNoteBlock[]
}

function localDayBlock(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A tag dates by the article (picking up can happen days later); a question or comment by when it was written. */
function noteTimeBlock(note: FeedNoteBlock): number {
  const t = Date.parse(note.kind === 'tagged' && note.published ? note.published : note.at)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Live notes (not removed, not done), one entry per article, grouped by day,
 * newest first. An article sits under the day of its latest note.
 */
export function groupFeedNotesByDayBlock(notes: FeedNoteBlock[]): Array<{ day: string; articles: FeedNoteArticleBlock[] }> {
  const byItem = new Map<string, FeedNoteBlock[]>()
  for (const note of notes) {
    if (note.removed || note.done) continue
    const key = note.itemId || note.id
    const list = byItem.get(key)
    if (list) list.push(note)
    else byItem.set(key, [note])
  }
  const articles = [...byItem.values()].map((list) => {
    const latest = Math.max(...list.map(noteTimeBlock))
    const first = list[0]
    const byTime = (a: FeedNoteBlock, b: FeedNoteBlock) => Date.parse(a.at) - Date.parse(b.at)
    return {
      article: {
        itemId: first.itemId,
        title: first.title,
        link: first.link,
        source: first.source,
        ticker: list.find(n => n.ticker)?.ticker ?? null,
        day: latest ? localDayBlock(latest) : 'undated',
        tags: list.filter(n => n.kind === 'tagged').sort(byTime),
        questions: list.filter(n => n.kind === 'question').sort(byTime),
        comments: list.filter(n => n.kind === 'comment').sort(byTime),
        notes: list,
      } satisfies FeedNoteArticleBlock,
      latest,
    }
  })
  const days = new Map<string, Array<{ article: FeedNoteArticleBlock; latest: number }>>()
  for (const entry of articles) {
    const list = days.get(entry.article.day)
    if (list) list.push(entry)
    else days.set(entry.article.day, [entry])
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a === 'undated' ? 1 : b === 'undated' ? -1 : b.localeCompare(a)))
    .map(([day, list]) => ({ day, articles: list.sort((a, b) => b.latest - a.latest).map(e => e.article) }))
}
