import yaml from 'js-yaml'
import {
  parseGenerationSourceBlock,
  type GenerationSource,
} from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

// Durable per-chain digest — the AI-refined title + summary for one chain,
// stored on disk instead of only in the intelligence cache. Rationale:
// chain titles/summaries are content the user reads (day drilldown table,
// timeline scrubbing, atom composition), not throwaway computation.
// Keeping them in `ai-activity/chains/…` gives them the same durable +
// browsable status atoms have, and lets the day-atom generator pull them
// from the vault on cross-device installs.
//
// Layout:
//   <vaultRoot>/ai-activity/chains/<projectId>/<YYYY-MM-DD>/<chainKey>.md
// The date bucket in the path is the chain's local start date — same
// bucketing the heatmap/trend chart use, so a day's chains cluster.
//
// Fast path stays the intelligence-cache sidecar at
//   ~/.thinking-space/intelligence-cache/projectChainDigest/<key>.json
// The store block reads cache first, falls through to vault, warms cache
// on vault hit.

export interface ProjectChainDigest {
  projectId: string
  /** Chain.key — derived from project + earliest session id. */
  chainKey: string
  /** ISO local calendar date the chain started (`YYYY-MM-DD`). */
  date: string
  /** One-line title (was `sessionTitleContract.title`). */
  title: string
  /** 1-3 sentence summary of what the chain did — new field. */
  summary: string
  /** claude-code / codex / chatgpt / grok / … — echoed for filtering. */
  source: string
  /** Merged msgCount at digest-time — invalidates the atom if it grew. */
  msgCount: number
  /** Merged wall-clock duration at digest-time. */
  durationMs: number
  /** Active duration in ms — sum of inter-message gaps, each clamped so long
   *  pauses don't count in full. The honest "how much work" measure for the
   *  density sparkline; `durationMs` stays wall-clock. 0 on records written
   *  before this field existed (v2), healed on read from `chain.activeDurationMs`
   *  the same way pointers are — see reconcileDigestPointersBlock. */
  activeDurationMs: number
  /** Chain start / end ISO — atoms need these for narrative flow. */
  startedIso: string
  endedIso: string
  /** Hash of inputs (transcript excerpts + prompt version + model). */
  inputHash: string
  /** ISO timestamp of the last successful generation. */
  generatedAt: string
  /** Provider/model identifier for re-run on model upgrades. */
  model: string
  /** Which family produced this digest — 'local' | 'claude' | 'rule-based'.
   *  Only 'local'/'claude' are ever persisted; 'rule-based' is display-only.
   *  Drives regeneration when the selected provider switches families.
   *  Empty string on legacy records written before this field existed. */
  generator: GenerationSource | ''
  /** Vault/repo paths this chain wrote, root-relative (`vault://`, `cwd://`).
   *  Lifted from the transcript's structured tool calls, never inferred from
   *  prose. These are the index's page numbers — an entry without them is a
   *  memoir. Empty on chains rendered before pointer extraction existed. */
  filesWritten: string[]
  /** Same, for files read. Weaker signal than writes but still a pointer. */
  filesRead: string[]
  /** Undertakings this chain belongs to, from the end-of-session ask. Plural:
   *  one session commonly carries a strand that feeds another undertaking (the
   *  Amazon sessions fed Semiconductor physics too), and forcing a single
   *  assignment destroys that thread. Empty means unassigned — the normal state
   *  until someone answers. */
  undertaking: string[]
}

// v2 adds filesWritten / filesRead / undertaking. Readers tolerate v1 by
// defaulting all three to empty — a v1 chain is a chain with no pointers, which
// is exactly what it is.
// v3 adds activeDurationMs. Readers tolerate v1/v2 by defaulting it to 0; it is
// healed on read from the chain's per-message timing, so 0 means "not measured
// yet", not "no work".
const CURRENT_CHAIN_DIGEST_SCHEMA_VERSION = 3

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidChainDigestDateBlock(value: string): boolean {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

/** Intelligence-cache task id — namespaces the sidecar subdirectory. */
export const AI_ACTIVITY_CHAIN_DIGEST_CACHE_TASK_ID = 'projectChainDigest'

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

/** Vault-relative path for a chain digest's markdown mirror. */
export function chainDigestVaultRelPathBlock(
  projectId: string,
  date: string,
  chainKey: string,
): string {
  const p = sanitizeSegment(projectId)
  const k = sanitizeSegment(chainKey)
  return `ai-activity/chains/${p}/${date}/${k}.md`
}

/** Cache key inside the chain-digest task dir — safe as a file basename. */
export function chainDigestCacheKeyBlock(
  projectId: string,
  date: string,
  chainKey: string,
): string {
  return `${sanitizeSegment(projectId)}__${date}__${sanitizeSegment(chainKey)}`
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

/** Like toStringArray but tolerates the pre-plural scalar form (`undertaking:
 *  "key"`) so a v2 digest reads as a one-element list rather than empty. */
function toStringArrayLoose(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  return toStringArray(value)
}

/** Parse a chain digest markdown mirror back into a struct. Null on drift. */
export function parseProjectChainDigestMarkdownBlock(content: string): ProjectChainDigest | null {
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

  const projectId = toStringOrEmpty(parsed.projectId)
  const chainKey = toStringOrEmpty(parsed.chainKey)
  const date = toStringOrEmpty(parsed.date)
  if (!projectId || !chainKey || !isValidChainDigestDateBlock(date)) return null

  return {
    projectId,
    chainKey,
    date,
    title: toStringOrEmpty(parsed.title),
    summary: toStringOrEmpty(parsed.summary),
    source: toStringOrEmpty(parsed.source),
    msgCount: toNumberOrZero(parsed.msgCount),
    durationMs: toNumberOrZero(parsed.durationMs),
    activeDurationMs: toNumberOrZero(parsed.activeDurationMs),
    startedIso: toStringOrEmpty(parsed.startedIso),
    endedIso: toStringOrEmpty(parsed.endedIso),
    inputHash: toStringOrEmpty(parsed.inputHash),
    generatedAt: toIsoStringOrNow(parsed.generatedAt),
    model: toStringOrEmpty(parsed.model),
    generator: parseGenerationSourceBlock(parsed.generator),
    filesWritten: toStringArray(parsed.filesWritten),
    filesRead: toStringArray(parsed.filesRead),
    undertaking: toStringArrayLoose(parsed.undertaking),
  }
}

/** Serialize a chain digest to the YAML-frontmatter markdown format. */
export function stringifyProjectChainDigestMarkdownBlock(digest: ProjectChainDigest): string {
  const frontmatter: Record<string, unknown> = {
    schemaVersion: CURRENT_CHAIN_DIGEST_SCHEMA_VERSION,
    projectId: digest.projectId,
    chainKey: digest.chainKey,
    date: digest.date,
    source: digest.source,
    startedIso: digest.startedIso,
    endedIso: digest.endedIso,
    msgCount: digest.msgCount,
    durationMs: digest.durationMs,
    activeDurationMs: digest.activeDurationMs,
    model: digest.model,
    generator: digest.generator,
    inputHash: digest.inputHash,
    generatedAt: digest.generatedAt,
    title: digest.title,
  }
  // Only emitted when present. A chain with no pointers should look like a
  // chain with no pointers, not one carrying two empty lists — most existing
  // chains predate extraction and writing the keys would imply otherwise.
  if (digest.filesWritten.length) frontmatter.filesWritten = digest.filesWritten
  if (digest.filesRead.length) frontmatter.filesRead = digest.filesRead
  if (digest.undertaking.length) frontmatter.undertaking = digest.undertaking

  const yamlStr = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  }).trimEnd()

  const bodyLines: string[] = []
  if (digest.title) bodyLines.push(`# ${digest.title}`, '')
  if (digest.summary) bodyLines.push(digest.summary, '')

  const body = bodyLines.join('\n').trimEnd()
  return `---\n${yamlStr}\n---\n\n${body}\n`
}

/** JSON form for the intelligence-cache sidecar. Same shape, no envelope. */
export function stringifyProjectChainDigestJsonBlock(digest: ProjectChainDigest): string {
  return JSON.stringify(
    { schemaVersion: CURRENT_CHAIN_DIGEST_SCHEMA_VERSION, ...digest },
    null,
    2,
  )
}

export function parseProjectChainDigestJsonBlock(raw: string): ProjectChainDigest | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const projectId = toStringOrEmpty(parsed.projectId)
  const chainKey = toStringOrEmpty(parsed.chainKey)
  const date = toStringOrEmpty(parsed.date)
  if (!projectId || !chainKey || !isValidChainDigestDateBlock(date)) return null
  return {
    projectId,
    chainKey,
    date,
    title: toStringOrEmpty(parsed.title),
    summary: toStringOrEmpty(parsed.summary),
    source: toStringOrEmpty(parsed.source),
    msgCount: toNumberOrZero(parsed.msgCount),
    durationMs: toNumberOrZero(parsed.durationMs),
    activeDurationMs: toNumberOrZero(parsed.activeDurationMs),
    startedIso: toStringOrEmpty(parsed.startedIso),
    endedIso: toStringOrEmpty(parsed.endedIso),
    inputHash: toStringOrEmpty(parsed.inputHash),
    generatedAt: toIsoStringOrNow(parsed.generatedAt),
    model: toStringOrEmpty(parsed.model),
    generator: parseGenerationSourceBlock(parsed.generator),
    filesWritten: toStringArray(parsed.filesWritten),
    filesRead: toStringArray(parsed.filesRead),
    undertaking: toStringArrayLoose(parsed.undertaking),
  }
}
