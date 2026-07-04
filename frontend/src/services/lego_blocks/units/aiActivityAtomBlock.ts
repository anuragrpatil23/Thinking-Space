import yaml from 'js-yaml'

// Rhythm-independent atom for the AI Activity intelligence layer.
// One atom per (project, calendar day). Weeks and 3-day sets are derived by
// grouping atoms in the view layer — atoms themselves know nothing about
// which rhythm the user is currently looking at, so switching set ⇄ week
// costs nothing.
//
// Storage: sidecar JSON in the intelligence cache (fast path) and, when
// the user opts in, a mirrored YAML-frontmatter markdown file at
//   <vaultRoot>/ai-activity/atoms/<projectId>/<YYYY-MM-DD>.md
// The markdown mirror is the durable, browsable record — users read atoms
// as regular notes in the app.
//
// `sealed: false` marks the *live* atom for today, which regenerates as the
// day progresses. Sealing happens at day-rollover: the next day's atom is
// generated and the previous day's atom is frozen. `inputHash` covers the
// generator input (session ids + hashes + previous-atom digest anchor) so
// re-tagging or backfilling sessions auto-invalidates just the affected
// day, not the surrounding week.

export interface ProjectDayAtom {
  /** Vault-relative project root or another stable project identifier. */
  projectId: string
  /** ISO local calendar date the atom covers (`YYYY-MM-DD`). */
  date: string
  /** One-line, present-tense summary of the day's AI work. */
  headline: string
  /** Why this day matters relative to the project's arc. Empty allowed. */
  whyItMatters: string
  /** Generator confidence 0..1; used to soften low-quality atoms in the UI. */
  confidence: number
  /** False while the day is in progress, true once frozen. */
  sealed: boolean
  /** Hash of the generator inputs — cache key + auto-invalidation trigger. */
  inputHash: string
  /** ISO timestamp of the last successful generation. */
  generatedAt: string
  /** Provider/model identifier so we can re-run on model upgrades. */
  model: string
}

const CURRENT_ATOM_SCHEMA_VERSION = 1

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidAtomDateBlock(value: string): boolean {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

/** Vault-relative path where an atom's markdown mirror lives. */
export function atomVaultRelPathBlock(projectId: string, date: string): string {
  return `ai-activity/atoms/${projectId}/${date}.md`
}

/** Intelligence-cache task id — used as the sidecar subdirectory. */
export const AI_ACTIVITY_ATOM_CACHE_TASK_ID = 'projectDayAtom'

/** Cache key inside the atom task dir — safe as a file basename. */
export function atomCacheKeyBlock(projectId: string, date: string): string {
  return `${sanitizeSegment(projectId)}__${date}`
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'project'
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toIsoStringOrNow(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  return new Date().toISOString()
}

/** Parse a markdown mirror back into an atom. Returns null on any shape drift. */
export function parseProjectDayAtomMarkdownBlock(content: string): ProjectDayAtom | null {
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
  const date = toStringOrEmpty(parsed.date)
  if (!projectId || !isValidAtomDateBlock(date)) return null

  return {
    projectId,
    date,
    headline: toStringOrEmpty(parsed.headline),
    whyItMatters: toStringOrEmpty(parsed.whyItMatters),
    confidence: clampConfidence(parsed.confidence),
    sealed: parsed.sealed === true,
    inputHash: toStringOrEmpty(parsed.inputHash),
    generatedAt: toIsoStringOrNow(parsed.generatedAt),
    model: toStringOrEmpty(parsed.model),
  }
}

/** Serialize an atom to the YAML-frontmatter markdown format used in the vault. */
export function stringifyProjectDayAtomMarkdownBlock(atom: ProjectDayAtom): string {
  const frontmatter: Record<string, unknown> = {
    schemaVersion: CURRENT_ATOM_SCHEMA_VERSION,
    projectId: atom.projectId,
    date: atom.date,
    sealed: atom.sealed,
    confidence: atom.confidence,
    model: atom.model,
    inputHash: atom.inputHash,
    generatedAt: atom.generatedAt,
    headline: atom.headline,
    whyItMatters: atom.whyItMatters,
  }
  const yamlStr = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  }).trimEnd()

  const bodyLines: string[] = []
  if (atom.headline) bodyLines.push(`# ${atom.headline}`, '')
  if (atom.whyItMatters) bodyLines.push('## Why it matters', atom.whyItMatters, '')

  const body = bodyLines.join('\n').trimEnd()
  return `---\n${yamlStr}\n---\n\n${body}\n`
}

/** JSON form for the intelligence-cache sidecar. Same shape, no envelope. */
export function stringifyProjectDayAtomJsonBlock(atom: ProjectDayAtom): string {
  return JSON.stringify(
    { schemaVersion: CURRENT_ATOM_SCHEMA_VERSION, ...atom },
    null,
    2,
  )
}

export function parseProjectDayAtomJsonBlock(raw: string): ProjectDayAtom | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const projectId = toStringOrEmpty(parsed.projectId)
  const date = toStringOrEmpty(parsed.date)
  if (!projectId || !isValidAtomDateBlock(date)) return null
  return {
    projectId,
    date,
    headline: toStringOrEmpty(parsed.headline),
    whyItMatters: toStringOrEmpty(parsed.whyItMatters),
    confidence: clampConfidence(parsed.confidence),
    sealed: parsed.sealed === true,
    inputHash: toStringOrEmpty(parsed.inputHash),
    generatedAt: toIsoStringOrNow(parsed.generatedAt),
    model: toStringOrEmpty(parsed.model),
  }
}
