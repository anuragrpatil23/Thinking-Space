import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { loadAiActivity } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import { readClaudeUsageLogTextBlock } from '@/services/lego_blocks/integrations/aiUsageLogBlock'
import { sessionIdOf } from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  buildLimitLedgerBlock,
  buildSessionShareIndexBlock,
  codexReadingsToSamplesBlock,
  parseClaudeUsageLogBlock,
  type LimitSampleBlock,
  type LimitShareWindowBlock,
  type SessionLimitShareBlock,
} from '@/services/lego_blocks/units/aiLimitShareBlock'

/**
 * How much of the plan's session and weekly limits each sitting used, keyed by
 * the sitting's session id.
 *
 * Nothing here is stored. The account-wide readings are stratum-1 capture (the
 * Claude usage log, Codex's own transcripts) and the shares are recomputed from
 * them on every read, across every session at once — which is not optional:
 * who moved the meter can only be answered by looking at everyone who was
 * spending, so a per-session record could not be derived in isolation and
 * would go stale the moment a neighbouring session's samples arrived.
 *
 * Deliberately built from every session, never from the list a view happens to
 * be showing: a share computed over a filtered range would change with the
 * filter (DERIVATION.md — canonical derivation belongs in services).
 */

/** A window's own id is `<session>` or `<session>::<anchor>`; limits are
 *  reported under the session. */
function baseSessionIdBlock(session: ParsedSession): string {
  return sessionIdOf(session).split('::', 1)[0].toLowerCase()
}

/** Pure half: sessions and the Claude log text in, shares out. */
export function deriveSessionLimitSharesBlock(
  sessions: ParsedSession[],
  claudeUsageLogText: string,
): Map<string, SessionLimitShareBlock> {
  const claudeWindows: LimitShareWindowBlock[] = []
  const codexWindows: LimitShareWindowBlock[] = []
  const codexSamples: LimitSampleBlock[] = []

  for (const session of sessions) {
    if (session.source !== 'claude-code' && session.source !== 'codex') continue
    const startMs = Date.parse(session.startedIso)
    if (!Number.isFinite(startMs)) continue
    const baseSid = baseSessionIdBlock(session)
    const window = { id: sessionIdOf(session), baseSid, startMs }
    if (session.source === 'claude-code') {
      claudeWindows.push(window)
    } else {
      codexWindows.push(window)
      if (session.limitReadings?.length) {
        codexSamples.push(
          ...codexReadingsToSamplesBlock(baseSid, session.model ?? null, session.limitReadings),
        )
      }
    }
  }

  // One ledger per provider: each meters its own account, and readings from
  // both in one timeline would be measured against each other.
  const claude = buildSessionShareIndexBlock(
    buildLimitLedgerBlock(parseClaudeUsageLogBlock(claudeUsageLogText)),
    claudeWindows,
  )
  const codex = buildSessionShareIndexBlock(buildLimitLedgerBlock(codexSamples), codexWindows)
  return new Map([...claude, ...codex])
}

let memo: { sessions: ParsedSession[]; logLength: number; shares: Map<string, SessionLimitShareBlock> } | null =
  null
let inflight: Promise<Map<string, SessionLimitShareBlock>> | null = null

/**
 * Shares for every sitting. Coalesced, and reused while neither input has
 * changed: `loadAiActivity` hands back the same array until something is
 * re-parsed, and the log is append-only, so its length is a sound fingerprint.
 */
export async function loadSessionLimitSharesOrch(): Promise<Map<string, SessionLimitShareBlock>> {
  if (inflight) return inflight
  inflight = (async () => {
    const fs = getVaultFS()
    const [{ sessions }, logText] = await Promise.all([
      loadAiActivity(fs),
      readClaudeUsageLogTextBlock(fs),
    ])
    if (memo && memo.sessions === sessions && memo.logLength === logText.length) return memo.shares
    const shares = deriveSessionLimitSharesBlock(sessions, logText)
    memo = { sessions, logLength: logText.length, shares }
    return shares
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}
