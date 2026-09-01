// Move spans the journal is still holding into the vault.
//
// Runs once at startup, which is the moment that matters: whatever is in the
// journal got there because the app went away before the vault write landed —
// a memory kill, a force-quit, a suspension mid-bridge-hop. Draining on the
// next launch is what turns "the sitting is gone" into "the sitting is a few
// seconds short".
//
// Deliberately not on a timer. There is exactly one event that produces
// orphaned entries (the app stopping) and exactly one that can clear them
// (the app starting), so polling would only burn wakeups to discover nothing —
// see docs/contracts/ENERGY.md.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { appendReadingSpan } from '@/services/lego_blocks/integrations/thinkingspaceReadingBlock'
import {
  clearReadingJournalEntryBlock,
  readReadingJournalBlock,
} from '@/services/lego_blocks/units/readingJournalBlock'
import { traceReadingBlock } from '@/services/lego_blocks/units/readingTraceBlock'

let drained = false

/**
 * Write every journalled span to the vault, forgetting each one only once the
 * vault confirms it holds it. An entry that fails to drain stays put and is
 * retried next launch — losing it here would defeat the entire point of having
 * written it down.
 *
 * Idempotent per session, and safe to call before a vault is chosen: the
 * append gate refuses, nothing is cleared, and the next launch tries again.
 */
export async function drainReadingJournalOrch(): Promise<{ drained: number; pending: number }> {
  if (drained) return { drained: 0, pending: readReadingJournalBlock().length }
  drained = true

  const entries = readReadingJournalBlock()
  if (entries.length === 0) return { drained: 0, pending: 0 }

  const fs = getVaultFS()
  let ok = 0
  for (const record of entries) {
    try {
      // The merge rule settles the case where the sitting *did* reach the
      // vault before the app died: the longer measurement wins, and a human's
      // correction is never overwritten. So replaying a span that already
      // landed is harmless.
      if (await appendReadingSpan(fs, record)) {
        clearReadingJournalEntryBlock(record.key)
        ok += 1
      }
    } catch {
      // Leave it journalled for the next launch.
    }
  }
  const pending = readReadingJournalBlock().length
  traceReadingBlock({
    outcome: ok > 0 ? 'wrote' : 'error',
    detail: `journal drain: ${ok} recovered, ${pending} still pending`,
  })
  return { drained: ok, pending }
}

/** Test seam. */
export function resetReadingJournalDrainOrch(): void {
  drained = false
}
