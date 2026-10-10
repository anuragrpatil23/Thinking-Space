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
  type LimitLedgerBlock,
  type LimitSampleBlock,
  type LimitShareWindowBlock,
  type SessionLimitShareBlock,
} from '@/services/lego_blocks/units/aiLimitShareBlock'
import type { PlanUsageMoveBlock } from '@/services/lego_blocks/units/aiPlanUsageHistoryBlock'

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
export function baseSessionIdBlock(session: ParsedSession): string {
  return sessionIdOf(session).split('::', 1)[0].toLowerCase()
}

interface LimitDerivationBlock {
  shares: Map<string, SessionLimitShareBlock>
  moves: PlanUsageMoveBlock[]
}

/** Weekly movements of one provider's ledger, as the plan-usage graph reads them. */
function weeklyMovesBlock(
  provider: PlanUsageMoveBlock['provider'],
  ledger: LimitLedgerBlock,
): PlanUsageMoveBlock[] {
  const out: PlanUsageMoveBlock[] = []
  for (const entry of ledger.entries) {
    if (entry.kind !== 'weekly') continue
    out.push({ t: entry.t, provider, baseSid: entry.sid, pct: entry.pct })
  }
  return out
}

/**
 * Pure half: sessions and the Claude log text in, both readings of the ledger
 * out — per-sitting shares, and the weekly movements over time. One function so
 * the table's "% of the week" and the graph's bars come from the same ledger
 * and cannot disagree.
 */
export function deriveLimitLedgersBlock(
  sessions: ParsedSession[],
  claudeUsageLogText: string,
): LimitDerivationBlock {
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
  const claudeLedger = buildLimitLedgerBlock(parseClaudeUsageLogBlock(claudeUsageLogText))
  const codexLedger = buildLimitLedgerBlock(codexSamples)
  return {
    shares: new Map([
      ...buildSessionShareIndexBlock(claudeLedger, claudeWindows),
      ...buildSessionShareIndexBlock(codexLedger, codexWindows),
    ]),
    moves: [...weeklyMovesBlock('claude', claudeLedger), ...weeklyMovesBlock('codex', codexLedger)],
  }
}

/** Pure half: sessions and the Claude log text in, shares out. */
export function deriveSessionLimitSharesBlock(
  sessions: ParsedSession[],
  claudeUsageLogText: string,
): Map<string, SessionLimitShareBlock> {
  return deriveLimitLedgersBlock(sessions, claudeUsageLogText).shares
}

let memo: { sessions: ParsedSession[]; logLength: number; derived: LimitDerivationBlock } | null = null
let inflight: Promise<LimitDerivationBlock> | null = null

/**
 * Coalesced, and reused while neither input has changed: `loadAiActivity`
 * hands back the same array until something is re-parsed, and the log is
 * append-only, so its length is a sound fingerprint.
 */
async function loadLimitLedgersBlock(): Promise<LimitDerivationBlock> {
  if (inflight) return inflight
  inflight = (async () => {
    const fs = getVaultFS()
    const [{ sessions }, logText] = await Promise.all([
      loadAiActivity(fs),
      readClaudeUsageLogTextBlock(fs),
    ])
    if (memo && memo.sessions === sessions && memo.logLength === logText.length) return memo.derived
    const derived = deriveLimitLedgersBlock(sessions, logText)
    memo = { sessions, logLength: logText.length, derived }
    return derived
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/** Shares for every sitting. */
export async function loadSessionLimitSharesOrch(): Promise<Map<string, SessionLimitShareBlock>> {
  return (await loadLimitLedgersBlock()).shares
}

/** Every weekly-limit movement on record, both providers, oldest first per provider. */
export async function loadPlanUsageMovesOrch(): Promise<PlanUsageMoveBlock[]> {
  return (await loadLimitLedgersBlock()).moves
}
