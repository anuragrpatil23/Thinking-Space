/**
 * The verdict log: what was proposed, what was decided, and by whom.
 *
 * Append-only, and written from the first disposition rather than added once
 * the feature has proved itself. It is three things at once and all three are
 * needed later:
 *
 * - the **calibration signal** that decides when a confidence band has earned
 *   the right to auto-apply — which cannot be reconstructed after the fact,
 *   because the months where the model is worst are exactly the months whose
 *   corrections are most informative;
 * - the **correction history** that makes a wrong auto-apply diagnosable
 *   ("what did it think, and what did I change it to") rather than a mystery
 *   pointer someone finds three weeks later;
 * - the **audit trail** for a layer where a machine writes into judgment
 *   fields, which SECURITY.md's shape of argument says needs a record, not a
 *   promise.
 *
 * Pure shape and arithmetic here; the store writes it.
 */

import {
  confidenceBandBlock,
  targetIdBlock,
  type ConfidenceBandBlock,
  type ProposalTargetBlock,
} from '@/services/lego_blocks/units/assignmentProposalBlock'

export type VerdictKindBlock =
  /** Applied as proposed. */
  | 'accept'
  /** Applied, but somewhere else. `correctedTo` says where — this is the row
   *  that teaches, so it carries both sides. */
  | 'modify'
  /** Not applied. The chain still owes a disposition and returns to the queue;
   *  the proposal is what was rejected, not the chain. */
  | 'reject'

export interface AssignmentVerdictBlock {
  sessionId: string
  projectId: string
  /** What was on the table. Null when a human dispositioned a chain the model
   *  never got to — a rarity worth telling apart from "proposed and accepted",
   *  because it is not evidence about the model either way. */
  proposed: ProposalTargetBlock | null
  confidence: number
  verdict: VerdictKindBlock
  /** Where it actually landed. Null on a reject. */
  correctedTo: ProposalTargetBlock | null
  /** `queue` (a human cleared it) or `auto` (a band was trusted). Auto rows are
   *  what the recent-auto undo list reads, so this is not cosmetic. */
  decidedBy: 'queue' | 'auto'
  at: string
}

/** Did the verdict land where the proposal pointed? The one place the
 *  comparison lives, so `accept` can never drift from meaning "unchanged". */
export function isUnchangedBlock(verdict: AssignmentVerdictBlock): boolean {
  if (!verdict.proposed || !verdict.correctedTo) return false
  return targetIdBlock(verdict.proposed) === targetIdBlock(verdict.correctedTo)
}

export interface BandCalibrationBlock {
  band: ConfidenceBandBlock
  accepted: number
  modified: number
  rejected: number
  /** accepted / total. NaN-free: an untested band reports 0 and a rate of 0,
   *  which reads as "not earned yet" rather than "perfect". */
  acceptRate: number
  total: number
}

/**
 * How well each band has done — the input to any decision about auto-applying.
 *
 * Only human verdicts count. Including `auto` rows would let the policy grade
 * its own homework: an auto-applied proposal that nobody corrected is recorded
 * as an accept, so a band that started auto-applying would keep confirming
 * itself with rows no human ever looked at. Undo of an auto row *is* a human
 * verdict, and lands as its own `modify`/`reject`, which is how a bad band
 * loses its rate back.
 */
export function calibrateBandsBlock(
  verdicts: AssignmentVerdictBlock[],
): BandCalibrationBlock[] {
  const bands: ConfidenceBandBlock[] = ['high', 'medium', 'low']
  const tally = new Map<ConfidenceBandBlock, BandCalibrationBlock>(
    bands.map(band => [
      band,
      { band, accepted: 0, modified: 0, rejected: 0, acceptRate: 0, total: 0 },
    ]),
  )

  for (const verdict of verdicts) {
    if (verdict.decidedBy !== 'queue') continue
    if (!verdict.proposed) continue
    const row = tally.get(confidenceBandBlock(verdict.confidence))
    if (!row) continue
    row.total += 1
    if (verdict.verdict === 'accept') row.accepted += 1
    else if (verdict.verdict === 'modify') row.modified += 1
    else row.rejected += 1
  }

  for (const row of tally.values()) {
    row.acceptRate = row.total ? row.accepted / row.total : 0
  }
  return bands.map(band => tally.get(band)!)
}

// ── JSONL transport ────────────────────────────────────────────────────────

function asStringBlock(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseTargetBlock(raw: unknown): ProposalTargetBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.kind === 'bucket') return { kind: 'bucket' }
  if (obj.kind === 'existing') {
    const key = asStringBlock(obj.key).trim()
    return key ? { kind: 'existing', key } : null
  }
  if (obj.kind === 'new') {
    const title = asStringBlock(obj.title).trim()
    return title ? { kind: 'new', title } : null
  }
  return null
}

/**
 * What a verdict log read produced, including what it could not read.
 *
 * Same reason as `ProposalLogReadBlock`: the pre-refactor lines are keyed
 * `chainId`, this parser requires `sessionId`, and dropping them quietly does
 * not merely hide rows — it empties the calibration set. A band's right to
 * auto-apply is earned from these verdicts, so a silent skip here reads as
 * "this band has no track record" when the truth is "its track record could not
 * be parsed". Those must not look the same.
 */
export interface VerdictLogReadBlock {
  verdicts: AssignmentVerdictBlock[]
  skipped: number
  samples: string[]
}

const SAMPLE_LIMIT = 3
const SAMPLE_CHARS = 160

function pushSampleBlock(samples: string[], line: string): void {
  if (samples.length >= SAMPLE_LIMIT) return
  samples.push(line.length > SAMPLE_CHARS ? `${line.slice(0, SAMPLE_CHARS)}…` : line)
}

export function parseVerdictLogBlock(content: string): VerdictLogReadBlock {
  const out: AssignmentVerdictBlock[] = []
  const samples: string[] = []
  let skipped = 0
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      skipped += 1
      pushSampleBlock(samples, trimmed)
      continue
    }
    const sessionId = asStringBlock(raw.sessionId).trim()
    const verdict = raw.verdict
    if (!sessionId || (verdict !== 'accept' && verdict !== 'modify' && verdict !== 'reject')) {
      skipped += 1
      pushSampleBlock(samples, trimmed)
      continue
    }
    out.push({
      sessionId,
      projectId: asStringBlock(raw.projectId).trim(),
      proposed: parseTargetBlock(raw.proposed),
      confidence:
        typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
          ? Math.min(1, Math.max(0, raw.confidence))
          : 0,
      verdict,
      correctedTo: parseTargetBlock(raw.correctedTo),
      decidedBy: raw.decidedBy === 'auto' ? 'auto' : 'queue',
      at: asStringBlock(raw.at),
    })
  }
  return { verdicts: out, skipped, samples }
}

export function serializeVerdictBlock(verdict: AssignmentVerdictBlock): string {
  return JSON.stringify(verdict)
}

/** Month bucket a verdict files under, so the log stays readable by hand and no
 *  single file grows without bound. Derived from the timestamp, never stored. */
export function verdictMonthBlock(at: string): string {
  const month = /^(\d{4}-\d{2})/.exec(at)
  return month ? month[1] : new Date().toISOString().slice(0, 7)
}
