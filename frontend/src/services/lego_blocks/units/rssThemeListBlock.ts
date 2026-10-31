// The theme list: every theme the AI has filed the news under, as a markdown
// list a person can read and edit. It is given to the model each time, so
// "Intel" stays "Intel" across days and months. A renamed line is the spelling
// offered from then on; a deleted one is not offered unless the model uses it
// again. One line a theme:
//
//   - Intel · last seen 2026-10-30 · 12 topics

import type { RssTopicsDayBlock } from './rssTopicBlock'

export interface RssThemeListEntryBlock {
  name: string
  /** YYYY-MM-DD, or '' when a person added the line without one */
  lastSeen: string
  /** Topics filed under it */
  topics: number
}

const LINE_PATTERN_BLOCK = /^\s*[-*]\s+(.+?)\s*$/

/** The list's entries; lines that are not list items (the heading, the note) are ignored. */
export function parseRssThemeListBlock(text: string | null): RssThemeListEntryBlock[] {
  const out: RssThemeListEntryBlock[] = []
  const seen = new Set<string>()
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = LINE_PATTERN_BLOCK.exec(line)
    if (!m) continue
    const [name, ...rest] = m[1].split(/\s+·\s+/)
    const clean = name.trim()
    if (clean.length < 2 || seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    const lastSeen = rest.map(r => /(\d{4}-\d{2}-\d{2})/.exec(r)?.[1]).find(Boolean) ?? ''
    const topics = Number(rest.map(r => /(\d+)\s+topics?/.exec(r)?.[1]).find(Boolean) ?? 0)
    out.push({ name: clean, lastSeen, topics })
  }
  return out
}

/** The most recently used first, then the most used. */
export function sortRssThemeListBlock(list: RssThemeListEntryBlock[]): RssThemeListEntryBlock[] {
  return [...list].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.topics - a.topics || a.name.localeCompare(b.name))
}

export function serializeRssThemeListBlock(list: RssThemeListEntryBlock[]): string {
  return [
    '# Feed themes',
    '',
    'The names the AI files the day\'s topics under, given to it each time. Edit freely:',
    'rename one and that spelling is used from then on; delete one and it is not offered',
    'again unless the AI uses it again.',
    '',
    ...sortRssThemeListBlock(list).map(t => `- ${t.name}${t.lastSeen ? ` · last seen ${t.lastSeen}` : ''} · ${t.topics} ${t.topics === 1 ? 'topic' : 'topics'}`),
    '',
  ].join('\n')
}

/** Count `topics` (topics just placed) into the list: a known name, any case, keeps the list's spelling. */
export function addToRssThemeListBlock(list: RssThemeListEntryBlock[], day: string, topics: RssTopicsDayBlock['topics']): RssThemeListEntryBlock[] {
  const next = list.map(t => ({ ...t }))
  const byKey = new Map(next.map(t => [t.name.toLowerCase(), t]))
  for (const topic of topics) {
    if (!topic.theme) continue
    const entry = byKey.get(topic.theme.toLowerCase())
    if (entry) {
      entry.topics += 1
      if (day > entry.lastSeen) entry.lastSeen = day
    } else {
      const added = { name: topic.theme, lastSeen: day, topics: 1 }
      next.push(added)
      byKey.set(added.name.toLowerCase(), added)
    }
  }
  return next
}
