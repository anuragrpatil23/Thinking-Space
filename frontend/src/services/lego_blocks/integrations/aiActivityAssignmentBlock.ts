import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'

/**
 * The end-of-session ask: which undertaking did this session belong to?
 *
 * ## Why this is keyed on session id
 *
 * The ask fires while the conversation is still live. The chain does not exist
 * yet — it is generated *afterwards*, by the `SessionEnd` hook. So the answer
 * cannot be keyed on `chainKey`; there isn't one to key on. It is keyed on
 * `session_id`, parked here, and stamped onto the session by the renderer when
 * the chain is finally produced.
 *
 * Verified 2026-07-26: the id the hook receives from its stdin event, the
 * transcript filename (`~/.claude/projects/<slug>/<session_id>.jsonl`), and the
 * id visible mid-session are the same value. No mapping needed.
 *
 * Do *not* key on the `session_XXXX` string in git commit footers — that is the
 * claude.ai URL slug, a different identifier entirely.
 *
 * ## Why a file per session rather than one index
 *
 * Two writers race here: this capability, called mid-session, and the render
 * hook, which fires twice per session (PreCompact, then SessionEnd). A single
 * shared index would need locking. One small file per session cannot conflict.
 */

const PENDING_DIR = 'ai-activity/pending-assignments'

export interface PendingAssignment {
  sessionId: string
  /** Undertaking keys this session belongs to — existing, plus the key minted
   *  for a brand-new one. Plural: a session commonly feeds more than one strand
   *  (see ProjectChainDigest.undertaking). */
  undertakings: string[]
  /** Set when the session opened an undertaking that did not exist before —
   *  describes the newly-minted key (at most one per ask for now). */
  newTitle?: string
  /** Section key for a brand-new undertaking. */
  section?: string
  /** Project the undertaking belongs to. */
  projectId?: string
  recordedAt: string
}

export function pendingAssignmentPathBlock(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${PENDING_DIR}/${safe}.json`
}

export async function recordAssignmentBlock(
  assignment: Omit<PendingAssignment, 'recordedAt'>,
): Promise<{ path: string; assignment: PendingAssignment }> {
  const fs = getVaultFS()
  await fs.mkdir(PENDING_DIR)
  const record: PendingAssignment = { ...assignment, recordedAt: new Date().toISOString() }
  const path = pendingAssignmentPathBlock(assignment.sessionId)
  await fs.write(path, `${JSON.stringify(record, null, 2)}\n`)
  return { path, assignment: record }
}

export async function readAssignmentBlock(sessionId: string): Promise<PendingAssignment | null> {
  const fs = getVaultFS()
  const path = pendingAssignmentPathBlock(sessionId)
  try {
    if (!(await fs.exists(path))) return null
    const parsed = JSON.parse(await fs.read(path)) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as PendingAssignment
    return record.sessionId && record.undertakings?.length ? record : null
  } catch {
    return null
  }
}

export async function listPendingAssignmentsBlock(): Promise<PendingAssignment[]> {
  const fs = getVaultFS()
  let names: string[] = []
  try {
    names = (await fs.list(PENDING_DIR)).files.filter(name => name.endsWith('.json'))
  } catch {
    return []
  }
  const out: PendingAssignment[] = []
  for (const name of names) {
    const record = await readAssignmentBlock(name.replace(/\.json$/, ''))
    if (record) out.push(record)
  }
  out.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  return out
}

/**
 * Drop an assignment once it has been stamped onto a chain.
 *
 * Not called by the renderer: the hook runs twice per session, and clearing
 * after the first run would leave the second run's chain unstamped. Clearing is
 * a separate sweep over chains that already carry an `undertaking`.
 */
export async function clearAssignmentBlock(sessionId: string): Promise<boolean> {
  const fs = getVaultFS()
  const path = pendingAssignmentPathBlock(sessionId)
  try {
    if (!(await fs.exists(path))) return false
    await fs.delete(path)
    return true
  } catch {
    return false
  }
}
