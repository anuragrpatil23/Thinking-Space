import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseProposalLogBlock,
  serializeProposalBlock,
  type AssignmentProposalBlock,
} from '@/services/lego_blocks/units/assignmentProposalBlock'
import {
  parseVerdictLogBlock,
  serializeVerdictBlock,
  verdictMonthBlock,
  type AssignmentVerdictBlock,
} from '@/services/lego_blocks/units/assignmentVerdictBlock'

/**
 * Vault storage for the two append-only assignment logs.
 *
 *   ai-activity/proposals/<project>.jsonl        what the AI thinks each chain was
 *   ai-activity/assignment-log/<YYYY-MM>.jsonl   what was decided, and by whom
 *
 * Both are JSONL and both are only ever appended to, which is what makes them
 * safe to write from more than one pass without a lock: the worst outcome of a
 * concurrent write is a lost line, and a lost *proposal* is re-proposable while
 * a lost *verdict* costs one calibration data point. A read-modify-write of a
 * structured document, by contrast, would silently drop whatever the other
 * writer had just decided.
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

async function appendLinesBlock(root: string, path: string, lines: string[]): Promise<void> {
  if (!lines.length) return
  const fs = getVaultFS()
  await fs.mkdir(root)
  const existing = await readIfPresentBlock(path)
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
  await fs.write(path, `${prefix}${lines.join('\n')}\n`)
}

export function proposalLogPathBlock(projectId: string): string {
  return `${PROPOSALS_ROOT}/${projectId.replace(/[^A-Za-z0-9._-]+/g, '-')}.jsonl`
}

export async function readProposalsBlock(projectId: string): Promise<AssignmentProposalBlock[]> {
  return parseProposalLogBlock(await readIfPresentBlock(proposalLogPathBlock(projectId)))
}

/** Append proposals for one project. Callers pass a batch because a pass
 *  normally judges a whole backlog at once, and one write beats sixty. */
export async function appendProposalsBlock(
  projectId: string,
  proposals: AssignmentProposalBlock[],
): Promise<string> {
  const path = proposalLogPathBlock(projectId)
  await appendLinesBlock(PROPOSALS_ROOT, path, proposals.map(serializeProposalBlock))
  return path
}

export function verdictLogPathBlock(month: string): string {
  return `${VERDICTS_ROOT}/${month}.jsonl`
}

/** Every verdict, all months, oldest file first. Calibration reads the lot —
 *  it is a few thousand short lines even after a year, and sampling recent
 *  months only would hide exactly the drift it exists to detect. */
export async function readAllVerdictsBlock(): Promise<AssignmentVerdictBlock[]> {
  const fs = getVaultFS()
  let names: string[] = []
  try {
    names = (await fs.list(VERDICTS_ROOT)).files.filter(name => name.endsWith('.jsonl')).sort()
  } catch {
    return []
  }
  const out: AssignmentVerdictBlock[] = []
  for (const name of names) {
    out.push(...parseVerdictLogBlock(await readIfPresentBlock(`${VERDICTS_ROOT}/${name}`)))
  }
  return out
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
