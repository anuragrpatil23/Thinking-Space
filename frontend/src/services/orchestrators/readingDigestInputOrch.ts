// Prepare what a reading sitting shows the model, or decide it shows nothing.
//
// Three steps, and the middle one is the reason this exists as its own
// orchestrator rather than inline: extract the text at the locations the
// attention settled on, decide whether there is enough there to be worth a
// call, and only then budget it into an excerpt. Skipping the middle step is
// how a model ends up confidently summarising forty pages someone flipped past.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { extractReadingLocationsOrch } from '@/services/orchestrators/readingExcerptOrch'
import {
  buildReadingExcerptBlock,
  isReadingWorthSummarisingBlock,
} from '@/services/lego_blocks/units/readingExcerptBlock'
import { setReadingDigestInputBlock } from '@/services/lego_blocks/units/intelligence/contracts/readingDigestContractBlock'

/**
 * Returns false when this sitting should keep its mechanical sentence and make
 * no model call — too little dwell, nothing extractable, or a document that
 * cannot be read back (a scanned PDF with no text layer, a deleted file).
 *
 * `readingWhere` is carried on the session by the parser precisely so this can
 * run without re-reading the span log.
 */
export async function prepareReadingDigestInputOrch(session: ParsedSession): Promise<boolean> {
  const where = session.readingWhere
  const filePath = session.readingFilePath
  if (!where || !filePath) return false

  const activeMs = session.activeDurationMs ?? 0
  const locations = await extractReadingLocationsOrch(getVaultFS(), filePath, where, activeMs)
  if (!isReadingWorthSummarisingBlock(locations, activeMs)) return false

  const excerpt = buildReadingExcerptBlock(locations)
  if (!excerpt.text) return false

  setReadingDigestInputBlock(session, excerpt.text)
  return true
}
