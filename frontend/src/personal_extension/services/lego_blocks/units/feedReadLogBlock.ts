// The lasting record of the feed: one small Markdown file per day in
// F9-execution/feed/, every story that reached the inbox, whoever read it.
// The article cache expires after 30 days; this does not. Kept as small as
// possible: one line per story (time, source, linked headline, how many other
// sources carried it, whether it was read, its tags), and a second line only
// when the AI wrote a summary.

import type { RssDayInboxBlock } from '@/services/lego_blocks/units/rssStoryBlock'

export const FEED_LOG_FOLDER_BLOCK = 'feed'

export function feedReadLogPathBlock(executionRoot: string, day: string): string {
  return `${executionRoot.replace(/\/+$/, '')}/${FEED_LOG_FOLDER_BLOCK}/${day}.md`
}

/** The AI's theme list for the Feed's topics, beside the day logs. */
export function feedThemeListPathBlock(executionRoot: string): string {
  return `${executionRoot.replace(/\/+$/, '')}/${FEED_LOG_FOLDER_BLOCK}/themes.md`
}

function oneLineBlock(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function timeBlock(iso: string | null): string {
  if (!iso) return '--:--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The day's file. Stories in time order, so the file reads like the day went. */
export function buildFeedReadLogBlock(day: RssDayInboxBlock): string {
  const stories = day.sources.flatMap(source => source.stories)
    .sort((a, b) => Date.parse(a.lead.item.pubDate ?? '') - Date.parse(b.lead.item.pubDate ?? ''))
  const lines = [
    '---',
    `day: ${day.day}`,
    `stories: ${stories.length}`,
    `read: ${stories.filter(s => s.read).length}`,
    '---',
    '',
  ]
  for (const story of stories) {
    const item = story.lead.item
    const title = oneLineBlock(item.title || '(untitled)').replace(/[[\]]/g, '')
    const others = new Set(story.others.map(m => m.feedTitle).filter(t => t !== story.lead.feedTitle)).size
    const tags = [...new Set([story.lead, ...story.others].flatMap(m => m.item.tags ?? []))]
    const parts = [
      `${timeBlock(item.pubDate)} ${oneLineBlock(story.lead.feedTitle)}`,
      item.link ? `[${title}](${item.link})` : title,
      others > 0 ? `+${others}` : null,
      story.read ? 'read' : null,
      tags.length > 0 ? tags.map(t => `#${t.replace(/\s+/g, '-')}`).join(' ') : null,
    ].filter(Boolean)
    lines.push(`- ${parts.join(' · ')}`)
    const summary = [story.lead, ...story.others].find(m => m.item.aiSummary)?.item.aiSummary
    if (summary) lines.push(`  ${oneLineBlock(summary.text)}`)
  }
  return `${lines.join('\n')}\n`
}

/** Stories recorded in an existing day file, from its frontmatter; 0 when unknown. */
export function feedReadLogStoryCountBlock(content: string): number {
  const m = /^stories:\s*(\d+)\s*$/m.exec(content.slice(0, 200))
  return m ? Number(m[1]) : 0
}
