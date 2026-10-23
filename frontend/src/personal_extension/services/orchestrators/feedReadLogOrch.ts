// Write the feed's daily record (feedReadLogBlock) into F9-execution/feed/.
//
// Desktop only, so one device writes. Only the last week is rewritten: older
// days are settled, and the article cache that rebuilds them expires. A day's
// file is never replaced by one with fewer stories — the cache may already
// have lost some of that day's articles, and the file is the record.

import { getVaultFS, isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import { rssReaderFeedsBlock, type RssFeedPreferencesBlock, type RssFeedResultBlock } from '@/services/lego_blocks/units/rssFeedBlock'
import { buildRssDayInboxBlock } from '@/services/lego_blocks/units/rssStoryBlock'
import { buildFeedReadLogBlock, feedReadLogPathBlock, feedReadLogStoryCountBlock } from '../lego_blocks/units/feedReadLogBlock'
import { readWebullExecutionSettingsOrch } from './webullExecutionSettingsOrch'

const REWRITE_DAYS = 7

let writing: Promise<number> | null = null

/** Bring the last week's day files up to date; returns how many were written. */
export function writeFeedReadLogsOrch(feeds: RssFeedResultBlock[], preferences: RssFeedPreferencesBlock | null): Promise<number> {
  if (writing) return writing
  writing = (async () => {
    if (!isElectron() || !preferences || feeds.length === 0) return 0
    const { executionFolderPath } = await readWebullExecutionSettingsOrch()
    if (!executionFolderPath) return 0
    const days = buildRssDayInboxBlock({ feeds: rssReaderFeedsBlock(feeds, preferences), configs: preferences.feeds })
      .filter(day => day.day !== 'undated')
      .slice(0, REWRITE_DAYS)
    const fs = getVaultFS()
    let written = 0
    for (const day of days) {
      const path = feedReadLogPathBlock(executionFolderPath, day.day)
      const next = buildFeedReadLogBlock(day)
      const current = await fs.read(path).catch(() => null)
      if (current === next) continue
      if (current && feedReadLogStoryCountBlock(current) > day.storyCount) continue
      await fs.write(path, next)
      written += 1
    }
    return written
  })().finally(() => { writing = null })
  return writing
}
