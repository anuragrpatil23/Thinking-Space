import yaml from 'js-yaml'
import { groupChainableBlock } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  parseGenerationSourceBlock,
  type GenerationSource,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

// Durable per-SESSION digest — the AI-refined title + summary for one sitting.
//
// This is the layer that reads raw material. Everything above it (chain, day,
// range) composes these, so this is the only place a transcript is ever fed to
// a model.
//
// WHY THE SESSION AND NOT THE CHAIN
//
// A chain is an output of `buildChains` — group by project and time, split on
// overlap or `/clear`. Filing a model-paid record under it made a *derived*
// value the record's address, which docs/contracts/DERIVATION.md names as the
// root defect in this stack: every change to the grouping rule renamed the file
// and orphaned the record it was supposed to update. The whole apparatus that
// followed — a minted-and-frozen `chainId`, a persisted `sessions[]` acting as
// its own index, two-pass membership-overlap resolution — exists only to defend
// against an address that moves.
//
// A session id does not move. It is stratum-1: the Claude Code session UUID, or
// `<uuid>::w<n>` for a sitting windowed out of one JSONL file by the idle gap.
// Nothing derives it, so nothing can rename it, so none of that defense is
// needed here. There is no `sessionId` minting function in this file, and that
// absence is the point.
//
// Layout:
//   <vaultRoot>/ai-activity/sessions/<projectId>/<sessionId>.md
// Fast path is the intelligence-cache sidecar at
//   ~/.thinking-space/intelligence-cache/projectSessionDigest/<key>.json
// The store block reads cache first, falls through to vault, warms cache on
// vault hit — same two tiers the chain digest used.

// Three kinds of field live in this record, and confusing them produced every
// staleness defect in the chain layer:
//
//   MODEL-DERIVED (title, summary) — cost a provider call. The reason the
//     record exists. Persisted, guarded by `inputHash`.
//   HUMAN (undertaking) — judgment. Persisted, never recomputed, never written
//     by AI. Regeneration must not clobber it.
//   MECHANICAL (everything else) — pure functions of the ParsedSession, free to
//     recompute. Persisted ONLY as transport to devices that cannot see
//     `~/.claude` (iPhone/web have no IPC). Any reader holding the session must
//     recompute them and ignore what is stored.

export interface ProjectSessionDigest {
  projectId: string
  /** IDENTITY and ADDRESS. `sessionIdOf(session)` — the Claude Code UUID, or
   *  `<uuid>::w<n>` for an idle-gap window. Stratum-1: read off the transcript,
   *  never computed from a grouping, so it cannot move under the record. */
  sessionId: string
  /** MECHANICAL. Vault-relative transcript path, `#wN` suffix intact. The way
   *  back to the raw material; not an address (a file can be moved). */
  path: string
  /** MECHANICAL. ISO local calendar date the session started (`YYYY-MM-DD`).
   *  A field, not a path segment. */
  date: string
  /** MODEL-DERIVED. One-line title. */
  title: string
  /** MODEL-DERIVED. Numbered-bullet body — the prose. Named `summary` because
   *  that is what it is; the record is the *digest*. Keeping those two words
   *  distinct is what stops `summary.summary`. */
  summary: string
  /** claude-code / codex / chatgpt / grok / … — echoed for filtering. */
  source: string
  /** MECHANICAL. Substantive user-message count. */
  msgCount: number
  /** MECHANICAL. Wall-clock span (start -> end). */
  durationMs: number
  /** MECHANICAL. Active duration — inter-message gaps, each clamped so long
   *  pauses don't count in full. 0 means "not measured", never "no work". */
  activeDurationMs: number
  /** MECHANICAL. Session start / end ISO. */
  startedIso: string
  endedIso: string
  /** MECHANICAL. The session ran `/clear`, which closes a chain.
   *
   *  Stored for one specific reason: with it, these four fields — project,
   *  start, end, hadClear — are everything `groupChainableBlock` needs, so a
   *  device that cannot read `~/.claude` re-derives the *same* chains from
   *  stored records alone. That is what makes it possible for no chain-level
   *  file to exist anywhere. Without it the phone would need a chain-shaped
   *  transport file, and any address for that file is an output of the
   *  grouping algorithm — the derived-address defect all over again. */
  hadClear: boolean
  /** MECHANICAL. Root-relative paths this session wrote, from the transcript's
   *  structured tool calls — never inferred from prose. Empty means only "this
   *  device had no transcript to derive from"; it is never evidence that the
   *  session wrote nothing. */
  filesWritten: string[]
  /** MECHANICAL. Same, for reads. Not captured by the native parser today. */
  filesRead: string[]
  /** HUMAN. Undertakings this session belongs to, from the end-of-session ask.
   *
   *  Plural: one sitting commonly carries a strand that feeds another
   *  undertaking, and forcing a single assignment destroys that thread.
   *  Empty means unassigned — the normal state until someone answers.
   *
   *  This lived on the chain digest, and that was the bug. A chain groups by
   *  *time*, so it can hold two unrelated topics; an undertaking is a *topic*.
   *  Assigning at the chain level is how "Broadcom — who designs a custom chip"
   *  came to list four Important-Personalities notes as its pages: a 20-second
   *  gap made them one chain, and the assignment could not tell them apart.
   *  A session is the finest unit the transcript actually distinguishes, so
   *  binding here makes that misattribution unrepresentable rather than merely
   *  unlikely. See docs/contracts/DERIVATION.md and ASSIGNMENT.md.
   *
   *  Written only by a human accept/reject. AI may propose (the pending ledger
   *  keyed by session id) but never writes this field. */
  undertaking: string[]
  /** Hash of the *model* inputs (transcript shape + prompt version + model).
   *  Excludes everything positional: nothing about where this record sits in a
   *  chain, a day, or a range may cost a provider call. */
  inputHash: string
  /** ISO timestamp of the last successful generation. */
  generatedAt: string
  /** Provider/model identifier, for re-run on model upgrades. */
  model: string
  /** Which family produced this — 'local' | 'claude' | 'rule-based'. Only
   *  'local'/'claude' are persisted; 'rule-based' is display-only. */
  generator: GenerationSource | ''
}

// v1 — the first schema for this record, and it carries no legacy tolerance
// because it has no predecessors. The chain digests that came before are a
// different record at a different address; they are not migrated and not read,
// they are simply regenerated from transcripts that were never the copy.
//
// Which is the point worth keeping: everything above stratum 1 is derivable, so
// a schema change here is answered by regenerating, not by teaching the parser
// to speak an older dialect forever. Add tolerance only for something a *human*
// may have typed into the file by hand.
const CURRENT_SESSION_DIGEST_SCHEMA_VERSION = 1

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidSessionDigestDateBlock(value: string): boolean {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

/**
 * How much work a session represents, in ms.
 *
 * `activeDurationMs` is the honest measure, but any record written before it
 * was captured carries 0, which is "not measured", not "no work". Falling back
 * to wall-clock is what keeps such a session from rendering as `0m`. Shared
 * rather than restated — the chain layer grew its own copy of this without the
 * fallback and showed every legacy row as zero-effort.
 */
export function sessionActiveDurationMsBlock(
  digest: Pick<ProjectSessionDigest, 'activeDurationMs' | 'durationMs'>,
): number {
  return digest.activeDurationMs > 0 ? digest.activeDurationMs : digest.durationMs
}

/**
 * Group stored session digests into chains — the same chains `buildChains`
 * produces from live transcripts, by construction.
 *
 * Both call `groupChainableBlock`; only the adapter differs. That is the whole
 * design: a chain is not a thing that gets stored and shipped around, it is a
 * question anyone can ask of a set of sessions, and a device holding only
 * digests can ask it just as well as one holding transcripts.
 *
 * The tie-break is `sessionId` rather than `path` — a digest's path is a
 * mechanical field that can be re-derived or absent, while the id is the
 * address and is always present. For records whose id came from a native
 * session both orderings agree, since the id is the path's basename.
 */
export function groupSessionDigestsBlock(
  digests: ProjectSessionDigest[],
): ProjectSessionDigest[][] {
  const chainable = digests.map(d => ({
    digest: d,
    project: d.projectId,
    startedIso: d.startedIso,
    endedIso: d.endedIso,
    hadClear: d.hadClear,
    chainSortKey: d.sessionId,
  }))
  const groups = groupChainableBlock(chainable).map(group => group.map(g => g.digest))
  // Newest chain first — the order every surface renders in.
  groups.sort((a, b) => Date.parse(b[0].startedIso) - Date.parse(a[0].startedIso))
  return groups
}

/** Intelligence-cache task id — namespaces the sidecar subdirectory. */
export const AI_ACTIVITY_SESSION_DIGEST_CACHE_TASK_ID = 'projectSessionDigest'

/** Root of every project's session digests. */
export const SESSIONS_ROOT = 'ai-activity/sessions'

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

/** Vault-relative path for a session digest's markdown mirror. Flat: the
 *  address is `sessionId` and nothing else. */
export function sessionDigestVaultRelPathBlock(projectId: string, sessionId: string): string {
  return `${SESSIONS_ROOT}/${sanitizeSegment(projectId)}/${sanitizeSegment(sessionId)}.md`
}

/** Root of a project's session digests — one flat directory. */
export function sessionDigestProjectDirBlock(projectId: string): string {
  return `${SESSIONS_ROOT}/${sanitizeSegment(projectId)}`
}

/** Cache key inside the session-digest task dir — safe as a file basename. */
export function sessionDigestCacheKeyBlock(projectId: string, sessionId: string): string {
  return `${sanitizeSegment(projectId)}__${sanitizeSegment(sessionId)}`
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toNumberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toIsoStringOrNow(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  return new Date().toISOString()
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim())
  }
  return out
}

/** Tolerates the scalar form (`undertaking: "key"`) so a hand-edited record
 *  reads as a one-element list rather than empty. This is a human-written
 *  field in a file a human can open in Obsidian, so leniency here is about
 *  respecting what someone typed, not about schema drift. */
function toStringArrayLoose(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  return toStringArray(value)
}

/** Fields common to both wire formats. `summary` is passed separately because
 *  the two formats carry it differently: the markdown mirror puts it in the
 *  body (so it stays readable in Obsidian), the JSON sidecar in a field. */
function commonSessionDigestFieldsBlock(
  parsed: Record<string, unknown>,
  projectId: string,
  sessionId: string,
  date: string,
  summary: string,
): ProjectSessionDigest {
  return {
    projectId,
    sessionId,
    path: toStringOrEmpty(parsed.path),
    date,
    title: toStringOrEmpty(parsed.title),
    summary,
    source: toStringOrEmpty(parsed.source),
    msgCount: toNumberOrZero(parsed.msgCount),
    durationMs: toNumberOrZero(parsed.durationMs),
    activeDurationMs: toNumberOrZero(parsed.activeDurationMs),
    startedIso: toStringOrEmpty(parsed.startedIso),
    endedIso: toStringOrEmpty(parsed.endedIso),
    hadClear: parsed.hadClear === true,
    filesWritten: toStringArray(parsed.filesWritten),
    filesRead: toStringArray(parsed.filesRead),
    undertaking: toStringArrayLoose(parsed.undertaking),
    inputHash: toStringOrEmpty(parsed.inputHash),
    generatedAt: toIsoStringOrNow(parsed.generatedAt),
    model: toStringOrEmpty(parsed.model),
    generator: parseGenerationSourceBlock(parsed.generator),
  }
}

/** Both halves of the address must be present and the date must be well
 *  formed. A record we cannot place is worse than no record: it would be
 *  rewritten at a *different* address on the next generation, leaving an
 *  orphan behind. */
function addressableBlock(
  parsed: Record<string, unknown>,
): { projectId: string; sessionId: string; date: string } | null {
  const projectId = toStringOrEmpty(parsed.projectId)
  const sessionId = toStringOrEmpty(parsed.sessionId)
  const date = toStringOrEmpty(parsed.date)
  if (!projectId || !sessionId || !isValidSessionDigestDateBlock(date)) return null
  return { projectId, sessionId, date }
}

/** Parse a session digest markdown mirror back into a struct. Null on drift. */
export function parseProjectSessionDigestMarkdownBlock(
  content: string,
): ProjectSessionDigest | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return null
  const afterOpen = trimmed.indexOf('\n')
  if (afterOpen === -1) return null
  const rest = trimmed.slice(afterOpen + 1)
  const closeIdx = rest.search(/^---\s*$/m)
  if (closeIdx === -1) return null

  let parsed: Record<string, unknown>
  try {
    parsed = yaml.load(rest.slice(0, closeIdx)) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const addr = addressableBlock(parsed)
  if (!addr) return null

  // Body after the closing fence, minus the rendered `# title` heading — that
  // heading is a display affordance for Obsidian, not content, so round-
  // tripping it would double it on the next write.
  const afterClose = rest.slice(closeIdx).replace(/^---\s*\n?/, '')
  const summary = afterClose.replace(/^\s*#\s+.*\n+/, '').trim()

  return commonSessionDigestFieldsBlock(parsed, addr.projectId, addr.sessionId, addr.date, summary)
}

/** Serialize a session digest to the YAML-frontmatter markdown format. */
export function stringifyProjectSessionDigestMarkdownBlock(digest: ProjectSessionDigest): string {
  const frontmatter: Record<string, unknown> = {
    schemaVersion: CURRENT_SESSION_DIGEST_SCHEMA_VERSION,
    projectId: digest.projectId,
    sessionId: digest.sessionId,
    path: digest.path,
    date: digest.date,
    source: digest.source,
    startedIso: digest.startedIso,
    endedIso: digest.endedIso,
    hadClear: digest.hadClear,
    msgCount: digest.msgCount,
    durationMs: digest.durationMs,
    activeDurationMs: digest.activeDurationMs,
    model: digest.model,
    generator: digest.generator,
    inputHash: digest.inputHash,
    generatedAt: digest.generatedAt,
    title: digest.title,
  }
  // Only emitted when present. A session with no pointers should look like a
  // session with no pointers, not one carrying two empty lists — absence means
  // "this device had no transcript to derive from", which is not "wrote
  // nothing", and the empty key would assert the second.
  if (digest.filesWritten?.length) frontmatter.filesWritten = digest.filesWritten
  if (digest.filesRead?.length) frontmatter.filesRead = digest.filesRead
  if (digest.undertaking?.length) frontmatter.undertaking = digest.undertaking

  const yamlStr = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"' })
    .trimEnd()

  const bodyLines: string[] = []
  if (digest.title) bodyLines.push(`# ${digest.title}`, '')
  if (digest.summary) bodyLines.push(digest.summary, '')

  return `---\n${yamlStr}\n---\n\n${bodyLines.join('\n').trimEnd()}\n`
}

/** JSON form for the intelligence-cache sidecar. Same shape, no envelope. */
export function stringifyProjectSessionDigestJsonBlock(digest: ProjectSessionDigest): string {
  return JSON.stringify({ schemaVersion: CURRENT_SESSION_DIGEST_SCHEMA_VERSION, ...digest }, null, 2)
}

export function parseProjectSessionDigestJsonBlock(raw: string): ProjectSessionDigest | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const addr = addressableBlock(parsed)
  if (!addr) return null
  return commonSessionDigestFieldsBlock(
    parsed,
    addr.projectId,
    addr.sessionId,
    addr.date,
    toStringOrEmpty(parsed.summary),
  )
}
