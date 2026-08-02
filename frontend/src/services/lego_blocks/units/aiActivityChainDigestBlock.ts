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
//   <vaultRoot>/ai-activity/chains/<projectId>/<chainId>.md
// Flat, and addressed by `chainId` alone. The old layout keyed on
// `<YYYY-MM-DD>/<chainKey>` — both derived from the grouping algorithm, so any
// change to chaining relocated the file and orphaned the record. A record's
// address must not be computable from the thing the record describes; see
// `chainId` below and docs/contracts/DERIVATION.md.
//
// Fast path stays the intelligence-cache sidecar at
//   ~/.thinking-space/intelligence-cache/projectChainDigest/<key>.json
// The store block reads cache first, falls through to vault, warms cache
// on vault hit.

// Two kinds of field live in this record, and confusing them is what produced
// every staleness defect in this layer:
//
//   MODEL-DERIVED (title, summary) — cost a provider call. The reason the record
//     exists at all. Persisted, guarded by `inputHash`.
//   HUMAN (undertaking) — judgment. Persisted, never recomputed.
//   MECHANICAL (everything else) — pure functions of the ActivityChain, free to
//     recompute. Persisted ONLY as transport to devices that cannot derive
//     chains locally. Any reader holding a chain must recompute them and ignore
//     what is stored; see `projectChainFieldsBlock`.
/** One member session's file writes, kept together so a chain that spans two
 *  topics can still say which of them wrote what. */
export interface ChainSessionFiles {
  /** `sessionIdOf` — the uuid, or `<uuid>::w<n>` for a windowed session. */
  session: string
  /** Root-relative paths written during that session. */
  files: string[]
}

export interface ProjectChainDigest {
  projectId: string
  /** IDENTITY. Minted once, on first write, and never recomputed — this is the
   *  whole point. It is the file's address, so if it were derived from the
   *  chain (as `chainKey` is) then re-grouping would move the record and lose
   *  it. Legacy digests adopt their `chainKey` as `chainId`, which is why they
   *  survive the layout change. */
  chainId: string
  /** MECHANICAL. Member session ids (`sessionIdOf`), the chain's real identity:
   *  a chain *is* its sessions. Persisted so a derived chain can find its digest
   *  by membership overlap when `chainId` is unknown — the stored digests are
   *  their own session -> digest index, so no side index exists to go stale.
   *  Also the only way a device that cannot derive chains can drill into one. */
  sessions: string[]
  /** MECHANICAL. `ActivityChain.key` — project + earliest session path. A
   *  display handle and a legacy-resolution hint, never an address: which
   *  session sorts first is an output of the grouping rule. */
  chainKey: string
  /** MECHANICAL. ISO local calendar date the chain started (`YYYY-MM-DD`).
   *  A field, not a path segment — it moves whenever the chain's head moves. */
  date: string
  /** MODEL-DERIVED. One-line title (was `sessionTitleContract.title`). */
  title: string
  /** MODEL-DERIVED. 1-3 sentence summary of what the chain did. */
  summary: string
  /** claude-code / codex / chatgpt / grok / … — echoed for filtering. */
  source: string
  /** MECHANICAL. Merged msgCount across the chain's sessions. */
  msgCount: number
  /** MECHANICAL. Merged wall-clock duration (start -> end). */
  durationMs: number
  /** MECHANICAL. Active duration in ms — sum of inter-message gaps, each clamped
   *  so long pauses don't count in full. The honest "how much work" measure for
   *  the density sparkline; `durationMs` stays wall-clock. */
  activeDurationMs: number
  /** MECHANICAL. Chain start / end ISO — atoms need these for narrative flow. */
  startedIso: string
  endedIso: string
  /** Hash of the *model* inputs (transcript excerpts + prompt version + model).
   *  Deliberately excludes the chain's key and id: renaming a record must never
   *  cost a provider call. */
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
  /** MECHANICAL. Vault/repo paths this chain wrote, root-relative. Lifted from
   *  the transcript's structured tool calls, never inferred from prose. These
   *  are the index's page numbers — an entry without them is a memoir. Empty
   *  here means only "this device had no chain to derive from"; it is never
   *  evidence that the chain wrote nothing. */
  filesWritten: string[]
  /** MECHANICAL. The same writes, attributed to the session that made them.
   *
   *  A chain is a *time* grouping, so it can legitimately hold two unrelated
   *  pieces of work — finish a conversation, run a skill twenty seconds later,
   *  and both are one logical session. An undertaking is a *topic*, and it
   *  points at one window. Flattening the writes into `filesWritten` loses which
   *  session made them, so an undertaking bound to the first window inherited
   *  the pages the second one wrote: "Broadcom — who designs a custom chip"
   *  listing four Important Personalities notes.
   *
   *  `filesWritten` stays as the flattened union so readers on older builds keep
   *  working, and is recomputable from this — prefer this when it is present. */
  filesBySession?: ChainSessionFiles[]
  /** MECHANICAL. Same, for files read. Weaker signal but still a pointer. */
  filesRead: string[]
  /** HUMAN. Undertakings this chain belongs to, from the end-of-session ask. Plural:
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
// No version tracks whether the mechanical fields are current, and none should.
// They are a *fallback transport* for devices that cannot derive chains locally
// (iPhone/web have no IPC to `~/.claude`), never a source of truth: any reader
// that can build the chain recomputes them and ignores what is stored. A stale
// copy is therefore unobservable, so there is nothing for a version to guard.
// See `projectChainFieldsBlock`.
// v4 adds chainId + sessions and flattens the vault layout (the <date>
// directory is gone). Readers tolerate v1-v3: a digest with no `chainId`
// adopts its `chainKey`, which is exactly the name its file already had, and a
// digest with no `sessions` resolves by chainId/chainKey as before.
const CURRENT_CHAIN_DIGEST_SCHEMA_VERSION = 4

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidChainDigestDateBlock(value: string): boolean {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

/**
 * How much work a chain represents, in ms.
 *
 * `activeDurationMs` is the honest measure, but it postdates most of the corpus
 * — every digest written before it existed carries 0, which is "not measured",
 * not "no work". Falling back to wall-clock is what keeps a 2026-06 chain from
 * rendering as `0m`.
 *
 * Shared rather than restated: the queue grew its own copy of this without the
 * fallback, and showed every legacy chain as zero-effort right where the
 * "was this worth an undertaking?" judgement is made.
 */
export function chainActiveDurationMsBlock(
  digest: Pick<ProjectChainDigest, 'activeDurationMs' | 'durationMs'>,
): number {
  return digest.activeDurationMs > 0 ? digest.activeDurationMs : digest.durationMs
}

/** Intelligence-cache task id — namespaces the sidecar subdirectory. */
export const AI_ACTIVITY_CHAIN_DIGEST_CACHE_TASK_ID = 'projectChainDigest'

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

/** Vault-relative path for a chain digest's markdown mirror. Flat: the address
 *  is `chainId` and nothing else, so nothing the grouping rule decides can
 *  move a record. */
export function chainDigestVaultRelPathBlock(projectId: string, chainId: string): string {
  return `ai-activity/chains/${sanitizeSegment(projectId)}/${sanitizeSegment(chainId)}.md`
}

/** Root of a project's chain digests — one flat directory. */
export function chainDigestProjectDirBlock(projectId: string): string {
  return `ai-activity/chains/${sanitizeSegment(projectId)}`
}

/** Cache key inside the chain-digest task dir — safe as a file basename. */
export function chainDigestCacheKeyBlock(projectId: string, chainId: string): string {
  return `${sanitizeSegment(projectId)}__${sanitizeSegment(chainId)}`
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

/** Fields common to both wire formats. `chainId` falls back to `chainKey` so a
 *  pre-v4 record keeps the identity its filename already encoded — that is what
 *  makes the layout change lossless rather than a migration. */
function commonChainDigestFieldsBlock(
  parsed: Record<string, unknown>,
  projectId: string,
  chainKey: string,
  date: string,
): ProjectChainDigest {
  return {
    projectId,
    chainId: toStringOrEmpty(parsed.chainId) || chainKey,
    sessions: toStringArray(parsed.sessions),
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
    filesBySession: toChainSessionFilesBlock(parsed.filesBySession),
    filesRead: toStringArray(parsed.filesRead),
    undertaking: toStringArrayLoose(parsed.undertaking),
  }
}

/** Parse `filesBySession`, dropping malformed entries rather than throwing —
 *  this is a mechanical field, so a garbled one costs a recompute, not data.
 *  Returns undefined (not []) when absent, so "written by a build that predates
 *  the field" stays distinguishable from "this chain wrote nothing". */
function toChainSessionFilesBlock(value: unknown): ChainSessionFiles[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ChainSessionFiles[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const session = toStringOrEmpty(entry.session)
    if (!session) continue
    const files = toStringArray(entry.files)
    if (files.length > 0) out.push({ session, files })
  }
  return out.length > 0 ? out : undefined
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

  return commonChainDigestFieldsBlock(parsed, projectId, chainKey, date)
}

/** Serialize a chain digest to the YAML-frontmatter markdown format. */
export function stringifyProjectChainDigestMarkdownBlock(digest: ProjectChainDigest): string {
  const frontmatter: Record<string, unknown> = {
    schemaVersion: CURRENT_CHAIN_DIGEST_SCHEMA_VERSION,
    projectId: digest.projectId,
    chainId: digest.chainId,
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
  // Optional-chained: a digest can arrive here spread from a record written by
  // a build that predates a field, so the key may be absent rather than empty.
  if (digest.sessions?.length) frontmatter.sessions = digest.sessions
  if (digest.filesWritten?.length) frontmatter.filesWritten = digest.filesWritten
  if (digest.filesBySession?.length) frontmatter.filesBySession = digest.filesBySession
  if (digest.filesRead?.length) frontmatter.filesRead = digest.filesRead
  if (digest.undertaking?.length) frontmatter.undertaking = digest.undertaking

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
  return commonChainDigestFieldsBlock(parsed, projectId, chainKey, date)
}
