import type { AiActivityRangeSummaryProvider } from './storageKeyBlock'
import type { GenerationSource } from './intelligence/modelProfileBlock'

// Data unit for a durable per-project range summary. Composes chain digests
// (title + summary + duration) across a date window into the numbered-bullet
// "arcs + tail" body the UI renders.
//
// One record per (projectId, rangeStartDate, rangeEndDate). Regenerated when
// the underlying chain set changes (see computeRangeInputHashBlock). Reader
// surfaces the recorded provider so the UI can indicate whether it came from
// the local pipeline, `claude -p`, or the deterministic fallback.

export interface RangeSummaryChainRef {
  chainKey: string
  date: string
  durationMs: number
  /**
   * False while the chain is still being worked in. Optional, defaulting to
   * settled, so callers that cannot tell keep the old behaviour.
   *
   * Fingerprints skip everything mutable about a live chain, because duration
   * grows with every message: a range containing the session you are in would
   * otherwise invalidate its summary continuously and regenerate on each view.
   * A live chain contributes its identity and nothing else, so the summary
   * regenerates exactly once — when the session goes quiet.
   */
  settled?: boolean
}

/** Fingerprint material for one chain. Live chains contribute identity only. */
function chainFingerprintPartBlock(c: RangeSummaryChainRef): string {
  if (c.settled === false) return `${c.chainKey}:live`
  return `${c.chainKey}:${c.durationMs}:${c.date}`
}

/** The provider tag we PERSIST. Distinct from the user's selection because
 *  the local + claude paths can fall through to the deterministic tier when
 *  their model call fails — the store records what actually ran. */
export type RangeSummaryPersistedProvider =
  | 'local-two-stage'
  | 'claude-cli'
  | 'fallback-titles'
  | 'fallback-stub'

export interface ProjectRangeSummary {
  schemaVersion: 1
  projectId: string
  rangeStartDate: string
  rangeEndDate: string
  /** Numbered-bullet body — arcs ordered by time desc + tail bullet. */
  summary: string
  provider: RangeSummaryPersistedProvider
  /** Model id when the provider is a real intelligence call; empty for the
   *  fallback tiers. */
  model: string
  /** Chain digest keys the summary was composed from, in stable order. */
  chainKeys: string[]
  /** Sum of chain durations in ms — used by consumers to short-circuit
   *  "is this stale enough to regen" checks without rehydrating everything. */
  totalDurationMs: number
  /** Full input hash (chains + provider + promptVersion). Retained so a
   *  cached body can be re-verified against the exact prompt path it was
   *  generated with. Reads that only care about content-level staleness use
   *  `contentFingerprint` instead — see the orch. */
  inputHash: string
  /** Chain-set-only fingerprint (chains + durations). Independent of which
   *  provider produced the summary, so a Claude-generated body can be read back
   *  from a local-mode load without regenerating. Optional for records
   *  written before this field existed — treat missing as "unknown", which
   *  the orch handles by regenerating once. */
  contentFingerprint?: string
  /**
   * Fingerprint of the *digest text* this body was narrated from.
   *
   * The chain-set fingerprint above cannot see it: it hashes chain keys,
   * durations and dates, all of which are identical whether the sessions
   * beneath had digests or not. A summary narrated before its digests existed
   * therefore matched forever and stayed thin until someone hit refresh by
   * hand. Recording what was actually read is what lets it heal.
   *
   * Missing on records written before this field existed. Absent is treated as
   * "unknown, don't touch it" rather than "stale" — invalidating every stored
   * summary at once would mean regenerating the lot on a local model.
   */
  digestFingerprint?: string
  /** ISO timestamp the summary was produced. */
  generatedAt: string
}

/** Higher wins. Selected-provider precedence check uses these ranks: a
 *  stored body is reused when its tier is >= the target tier for the
 *  currently-selected provider. Claude is the ceiling, so once Claude has
 *  run for a range, local/off loads keep serving that body until the chain
 *  set changes. */
export function rangeSummaryTierRankBlock(
  provider: RangeSummaryPersistedProvider,
): number {
  switch (provider) {
    case 'claude-cli':
      return 3
    case 'local-two-stage':
      return 2
    case 'fallback-titles':
      return 1
    case 'fallback-stub':
    default:
      return 0
  }
}

/** Collapse the range-summary's four-state provider onto the coarse
 *  generation-source family used by the shared source chip, so the range card
 *  and the drill-down render the same badge from one implementation. Both
 *  fallback tiers read as rule-based — from the reader's view "no model ran". */
export function rangeSummaryProviderToGenerationSourceBlock(
  provider: RangeSummaryPersistedProvider,
): GenerationSource {
  if (provider === 'claude-cli') return 'claude'
  if (provider === 'local-two-stage') return 'local'
  return 'rule-based'
}

export const AI_ACTIVITY_RANGE_SUMMARY_CACHE_TASK_ID = 'projectRangeSummary'

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

/** Vault-relative path for a range summary's markdown mirror. Files are
 *  named `<start>--<end>.md` so multi-range history sorts naturally in the
 *  file browser. */
export function rangeSummaryVaultRelPathBlock(
  projectId: string,
  rangeStartDate: string,
  rangeEndDate: string,
): string {
  const p = sanitizeSegment(projectId)
  return `ai-activity/ranges/${p}/${rangeStartDate}--${rangeEndDate}.md`
}

/** Sidecar cache key — safe as a file basename. */
export function rangeSummaryCacheKeyBlock(
  projectId: string,
  rangeStartDate: string,
  rangeEndDate: string,
): string {
  return `${sanitizeSegment(projectId)}__${rangeStartDate}__${rangeEndDate}`
}

// ── Input hash ─────────────────────────────────────────────────────────

// Cheap deterministic hash over the composed input the model would see.
// Includes chain keys + durations + prompt version so any regen trigger
// invalidates automatically.
function hashStringBlock(input: string): string {
  let h1 = 0x1f2e3d4c
  let h2 = 0x0badf00d
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
    h1 = (h1 ^ (h1 >>> 13)) >>> 0
    h2 = (h2 ^ (h2 >>> 17)) >>> 0
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

export interface RangeInputHashParts {
  chains: RangeSummaryChainRef[]
  promptVersion: number
  provider: AiActivityRangeSummaryProvider
}

export function computeRangeInputHashBlock(parts: RangeInputHashParts): string {
  // Chain keys are stable across regenerations; duration invalidates if a
  // digest was refreshed with new msg content. Provider is in the hash so
  // switching Local → Claude regenerates rather than reusing a stale body.
  const chainPart = [...parts.chains]
    .sort((a, b) => (a.chainKey < b.chainKey ? -1 : 1))
    .map(chainFingerprintPartBlock)
    .join('|')
  return hashStringBlock(`${parts.provider}#v${parts.promptVersion}#${chainPart}`)
}

/** Provider-independent fingerprint over just the chain set. Two range
 *  summaries with the same fingerprint were composed from the same underlying
 *  activity, regardless of which provider actually ran. Enables the
 *  "Claude is the ceiling, never stomp it with local" precedence rule. */
export function computeRangeContentFingerprintBlock(
  chains: RangeSummaryChainRef[],
): string {
  const chainPart = [...chains]
    .sort((a, b) => (a.chainKey < b.chainKey ? -1 : 1))
    .map(chainFingerprintPartBlock)
    .join('|')
  return hashStringBlock(`content#${chainPart}`)
}

/** Hash of the digest material a range summary was narrated from. Empty
 *  summaries hash differently from real ones, which is the entire point: it is
 *  how "narrated before the digests existed" becomes a detectable state. */
export function computeRangeDigestFingerprintBlock(
  chains: ReadonlyArray<{
    chainKey: string
    title?: string
    summary?: string
    settled?: boolean
  }>,
): string {
  const part = [...chains]
    .sort((a, b) => (a.chainKey < b.chainKey ? -1 : 1))
    // A live chain's digest is expected to change and is not worth regenerating
    // the range for; it contributes identity only, same as above.
    .map(c =>
      c.settled === false
        ? `${c.chainKey}:live`
        : `${c.chainKey}:${(c.title ?? '').length}:${hashStringBlock(c.summary ?? '')}`,
    )
    .join('|')
  return hashStringBlock(`digest#${part}`)
}

// ── Deterministic fallback body ────────────────────────────────────────

interface FallbackChain {
  title?: string
  date: string
  durationMs: number
  msgCount: number
}

function formatDurationMinutes(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Build the "off / last-resort" body deterministically. Two tiers:
 *   - if we have chain titles → number them by duration desc so the user
 *     still gets a scannable ranked list. Chains that share an identical
 *     title (common when the digester assigns the same label to repeated
 *     work in a day) are merged into one bullet with an "×N" count and
 *     summed duration, so the list stays scannable.
 *   - if titles are absent → collapse to a message-count / duration stub,
 *     no fabricated content.
 *  The caller wraps this into a ProjectRangeSummary with the appropriate
 *  provider tag (`fallback-titles` or `fallback-stub`). */
export function buildFallbackBodyBlock(chains: FallbackChain[]): {
  summary: string
  provider: 'fallback-titles' | 'fallback-stub'
} {
  if (chains.length === 0) {
    return {
      summary: '_No AI-assisted activity in this range._',
      provider: 'fallback-stub',
    }
  }
  const withTitles = chains.filter(c => c.title && c.title.trim().length > 0)
  const useTitles = withTitles.length >= Math.max(1, Math.floor(chains.length * 0.5))
  if (useTitles) {
    interface MergedEntry {
      title: string
      titleKey: string
      count: number
      totalMs: number
      dates: Set<string>
    }
    const merged = new Map<string, MergedEntry>()
    for (const c of chains) {
      const rawTitle = c.title?.trim() || '_(untitled chain)_'
      const titleKey = rawTitle.toLowerCase()
      let entry = merged.get(titleKey)
      if (!entry) {
        entry = { title: rawTitle, titleKey, count: 0, totalMs: 0, dates: new Set() }
        merged.set(titleKey, entry)
      }
      entry.count += 1
      entry.totalMs += c.durationMs
      entry.dates.add(c.date)
    }
    const ranked = [...merged.values()].sort((a, b) => b.totalMs - a.totalMs)
    const lines = ranked.map((e, i) => {
      const dates = [...e.dates].sort()
      const dateLabel =
        dates.length === 1
          ? dates[0]
          : `${dates[0]} → ${dates[dates.length - 1]}`
      const countSuffix = e.count > 1 ? ` ×${e.count}` : ''
      return `${i + 1}. ${e.title}${countSuffix} — ${dateLabel}, ${formatDurationMinutes(e.totalMs)}`
    })
    return { summary: lines.join('\n'), provider: 'fallback-titles' }
  }
  const totalMs = chains.reduce((n, c) => n + c.durationMs, 0)
  const totalMsgs = chains.reduce((n, c) => n + c.msgCount, 0)
  const uniqueDays = new Set(chains.map(c => c.date)).size
  return {
    summary:       `${chains.length} chains · ${totalMsgs} msgs · ${formatDurationMinutes(totalMs)} across ` +
      `${uniqueDays} day${uniqueDays === 1 ? '' : 's'}.`,
    provider: 'fallback-stub',
  }
}

// ── Markdown mirror serialization ──────────────────────────────────────

function escapeYamlValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function stringifyRangeSummaryMarkdownBlock(summary: ProjectRangeSummary): string {
  const fm: string[] = [
    '---',
    `schemaVersion: ${summary.schemaVersion}`,
    `projectId: ${summary.projectId}`,
    `rangeStartDate: ${escapeYamlValue(summary.rangeStartDate)}`,
    `rangeEndDate: ${escapeYamlValue(summary.rangeEndDate)}`,
    `provider: ${summary.provider}`,
    `model: ${escapeYamlValue(summary.model)}`,
    `totalDurationMs: ${summary.totalDurationMs}`,
    `chainCount: ${summary.chainKeys.length}`,
    `inputHash: ${summary.inputHash}`,
    ...(summary.contentFingerprint
      ? [`contentFingerprint: ${summary.contentFingerprint}`]
      : []),
    ...(summary.digestFingerprint
      ? [`digestFingerprint: ${summary.digestFingerprint}`]
      : []),
    `generatedAt: ${escapeYamlValue(summary.generatedAt)}`,
    '---',
    '',
  ]
  return `${fm.join('\n')}${summary.summary}\n`
}

function unescapeYamlValue(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return trimmed
}

export function parseRangeSummaryMarkdownBlock(raw: string): ProjectRangeSummary | null {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
  if (!m) return null
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
    if (kv) fm[kv[1]] = kv[2]
  }
  const summary = raw.slice(m[0].length).trimEnd()
  const provider = fm.provider?.trim() as RangeSummaryPersistedProvider | undefined
  if (
    !provider ||
    (provider !== 'local-two-stage' &&
      provider !== 'claude-cli' &&
      provider !== 'fallback-titles' &&
      provider !== 'fallback-stub')
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    projectId: fm.projectId ?? '',
    rangeStartDate: unescapeYamlValue(fm.rangeStartDate ?? ''),
    rangeEndDate: unescapeYamlValue(fm.rangeEndDate ?? ''),
    summary,
    provider,
    model: unescapeYamlValue(fm.model ?? ''),
    chainKeys: [],
    totalDurationMs: Number(fm.totalDurationMs) || 0,
    inputHash: fm.inputHash?.trim() ?? '',
    contentFingerprint: fm.contentFingerprint?.trim() || undefined,
    digestFingerprint: fm.digestFingerprint?.trim() || undefined,
    generatedAt: unescapeYamlValue(fm.generatedAt ?? ''),
  }
}

export function stringifyRangeSummaryJsonBlock(summary: ProjectRangeSummary): string {
  return JSON.stringify(summary)
}

export function parseRangeSummaryJsonBlock(raw: string): ProjectRangeSummary | null {
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    if (obj.schemaVersion !== 1) return null
    // The prose field was called `body` until 2026-08-16. The vault mirror was
    // unaffected by the rename — there the prose is the markdown body, read
    // positionally — but THIS sidecar serializes field names, so every cached
    // record still says `body`. Without the fallback the record parses with an
    // undefined `summary` and the renderer crashes on it.
    //
    // Tolerated rather than busted because a range summary is the expensive
    // tier (5-25 chains per pass, some via claude-cli) and there are hundreds
    // of them; a cache miss here is real money, not a recompute. Records
    // rewrite themselves on their next generation, so this can go once no
    // sidecar carries `body`.
    const record = obj as ProjectRangeSummary & { body?: string }
    if (typeof record.summary !== 'string' && typeof record.body === 'string') {
      record.summary = record.body
    }
    if (typeof record.summary !== 'string') return null
    return record
  } catch {
    return null
  }
}
