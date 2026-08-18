import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseProposalLogBlock,
  serializeProposalBlock,
  type AssignmentProposalBlock,
  type ProposalLogReadBlock,
} from '@/services/lego_blocks/units/assignmentProposalBlock'
import {
  parseVerdictLogBlock,
  serializeVerdictBlock,
  verdictMonthBlock,
  type AssignmentVerdictBlock,
  type VerdictLogReadBlock,
} from '@/services/lego_blocks/units/assignmentVerdictBlock'

/**
 * Vault storage for the two append-only assignment logs.
 *
 *   ai-activity/proposals/<project>.jsonl        what is claimed about each session
 *   ai-activity/assignment-log/<YYYY-MM>.jsonl   what was decided, and by whom
 *
 * `proposals/` is the *only* home for an unanswered claim. It was not: an
 * in-session answer used to be parked in `ai-activity/pending-assignments/`, a
 * second directory in a second format that the queue never read, so every
 * answer an agent gave about its own work went nowhere. The two routes differed
 * in provenance, which is a field, so they are now one log with `proposedBy`
 * telling them apart.
 *
 * Both are JSONL and both are only ever appended to, which is what lets more
 * than one pass write without a lock; a read-modify-write of a structured
 * document would silently drop whatever the other writer had just decided.
 * Append itself is read-concat-write and therefore racy, so it verifies — see
 * `appendLinesBlock`.
 *
 * Proposals are split per project because the queue reads one project at a time
 * and a project's proposals are its own concern. Verdicts are split per month
 * because they are read in aggregate across projects — calibration is a property
 * of the model, not of a project — and a single file would grow without bound.
 *
 * The vault FS has no append, so append here is read-concat-write. That is the
 * honest cost of the layout and it is bounded: these files are one short line
 * per chain.
 */

const PROPOSALS_ROOT = 'ai-activity/proposals'
const VERDICTS_ROOT = 'ai-activity/assignment-log'

async function readIfPresentBlock(path: string): Promise<string> {
  const fs = getVaultFS()
  try {
    if (!(await fs.exists(path))) return ''
    return await fs.read(path)
  } catch {
    return ''
  }
}

/**
 * Append, then check the append survived.
 *
 * The vault FS has no append, so this is read-concat-write, and two writers
 * racing lose one writer's lines. The original note here reasoned that this was
 * acceptable because "a lost proposal is re-proposable" — true of a sweep,
 * which can simply run again, and false of the write that now shares this path.
 * An in-session answer is first-hand: the agent that could have re-written it
 * has ended, and nothing else knows what it knew. Losing one is losing the
 * observation, not a derivable guess at it.
 *
 * So the write verifies. Re-read, confirm every line landed, and retry with
 * jitter if it did not — jitter because two writers that back off by the same
 * amount collide again on the retry. Bounded at three attempts and then
 * reported honestly rather than retried forever: the caller decides what a
 * failed append means, and for the in-session ask it means telling the agent
 * its answer was not recorded instead of returning a path and a lie.
 */
const APPEND_ATTEMPTS = 3

async function sleepJitterBlock(attempt: number): Promise<void> {
  const ms = 40 * attempt + Math.floor(Math.random() * 60)
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function appendLinesBlock(
  root: string,
  path: string,
  lines: string[],
): Promise<{ verified: boolean }> {
  if (!lines.length) return { verified: true }
  const fs = getVaultFS()
  await fs.mkdir(root)
  for (let attempt = 1; attempt <= APPEND_ATTEMPTS; attempt += 1) {
    const existing = await readIfPresentBlock(path)
    const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
    await fs.write(path, `${prefix}${lines.join('\n')}\n`)

    // Verify against a fresh read, not against what we just composed: the point
    // is to catch the case where someone else's write landed on top of ours.
    const after = await readIfPresentBlock(path)
    const present = new Set(after.split('\n').map(line => line.trim()))
    if (lines.every(line => present.has(line.trim()))) return { verified: true }
    if (attempt < APPEND_ATTEMPTS) await sleepJitterBlock(attempt)
  }
  return { verified: false }
}

export function proposalLogPathBlock(projectId: string): string {
  return `${PROPOSALS_ROOT}/${projectId.replace(/[^A-Za-z0-9._-]+/g, '-')}.jsonl`
}

/** Read one project's proposals, including the count of lines that could not be
 *  read. The caller must carry `skipped` onward — see `ProposalLogReadBlock`. */
export async function readProposalsBlock(projectId: string): Promise<ProposalLogReadBlock> {
  return parseProposalLogBlock(await readIfPresentBlock(proposalLogPathBlock(projectId)))
}

/** Append proposals for one project. Callers pass a batch because a pass
 *  normally judges a whole backlog at once, and one write beats sixty. */
export async function appendProposalsBlock(
  projectId: string,
  proposals: AssignmentProposalBlock[],
): Promise<{ path: string; verified: boolean }> {
  const path = proposalLogPathBlock(projectId)
  const { verified } = await appendLinesBlock(
    PROPOSALS_ROOT,
    path,
    proposals.map(serializeProposalBlock),
  )
  return { path, verified }
}

export function verdictLogPathBlock(month: string): string {
  return `${VERDICTS_ROOT}/${month}.jsonl`
}

/** Every verdict, all months, oldest file first. Calibration reads the lot —
 *  it is a few thousand short lines even after a year, and sampling recent
 *  months only would hide exactly the drift it exists to detect. */
export async function readAllVerdictsBlock(): Promise<VerdictLogReadBlock> {
  const fs = getVaultFS()
  let names: string[] = []
  try {
    names = (await fs.list(VERDICTS_ROOT)).files.filter(name => name.endsWith('.jsonl')).sort()
  } catch {
    return { verdicts: [], skipped: 0, samples: [] }
  }
  const verdicts: AssignmentVerdictBlock[] = []
  const samples: string[] = []
  let skipped = 0
  for (const name of names) {
    const read = parseVerdictLogBlock(await readIfPresentBlock(`${VERDICTS_ROOT}/${name}`))
    verdicts.push(...read.verdicts)
    skipped += read.skipped
    for (const sample of read.samples) if (samples.length < 3) samples.push(sample)
  }
  return { verdicts, skipped, samples }
}

/** Append verdicts, fanned out to the month each one belongs to. A batch that
 *  straddles midnight on the 1st writes two files rather than filing January's
 *  decision under February. */
export async function appendVerdictsBlock(verdicts: AssignmentVerdictBlock[]): Promise<string[]> {
  const byMonth = new Map<string, string[]>()
  for (const verdict of verdicts) {
    const month = verdictMonthBlock(verdict.at)
    const bucket = byMonth.get(month)
    if (bucket) bucket.push(serializeVerdictBlock(verdict))
    else byMonth.set(month, [serializeVerdictBlock(verdict)])
  }
  const paths: string[] = []
  for (const [month, lines] of byMonth) {
    const path = verdictLogPathBlock(month)
    await appendLinesBlock(VERDICTS_ROOT, path, lines)
    paths.push(path)
  }
  return paths
}
