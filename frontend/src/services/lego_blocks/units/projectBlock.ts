/**
 * Project — the one definition of "what am I working on", stored in
 * `.thinking-space/projects.json`.
 *
 * It used to be three things that never met. This file's `ProjectBlock` had the
 * Settings UI but was very nearly write-only: `vaultPath` and `organizerEnabled`
 * had *zero* readers outside the form that edited them. The concept doing the
 * real work — mapping a session's working directory to a canonical project —
 * lived in `kai-workspace/projects.md`, a hardcoded path with no UI, silently
 * empty for anyone whose vault has no such folder. And the organizer's records
 * carried a third id again. One project, three identities: `e024e59e…` here,
 * `8bf4d342…` on 43 organizer records, `F9` as the chain directory.
 *
 * v3 makes this the source and lets the rest derive:
 *
 * - `uuid` is identity. Minted once, never recomputed, never derived from a name
 *   or a path — the same rule the chain digests had to learn the hard way (see
 *   docs/contracts/DERIVATION.md).
 * - `key` is the on-disk address (`F9` → `ai-activity/chains/F9/`). Frozen for
 *   the same reason: it is already written into hundreds of files, so it may be
 *   *chosen* once but never recomputed from `name`, or every rename orphans a
 *   directory.
 *
 * - `roots[]` is membership — every folder whose sessions belong here, vault or
 *   not. This replaces `vaultPath` (one folder, no readers) and is what the
 *   registry resolves against.
 *
 * `name`, `mission`, `description`, `group` and `color` are presentation and
 * may change freely.
 *
 * The names are `uuid`/`key` rather than `id`/`slug` deliberately: that is what
 * every organizer record on disk already calls these two ideas, and a project
 * speaking a third vocabulary is how it ended up with three identities.
 */

import {
  normalizeProjectKindBlock,
  type ProjectKindBlock,
} from '@/services/lego_blocks/units/projectKindBlock'

export interface ProjectBlock {
  /** Stable identity. Minted once and frozen — never derived from name, key or path. */
  uuid: string
  /**
   * The project's on-disk address: the folder name under `ai-activity/chains/`
   * and `ai-activity/thinking-organizer/`, and the canonical project name the
   * activity parser emits (e.g. `F9`).
   *
   * Chosen once, then frozen. It is not `uuid` — it is short and human-typed so a
   * vault stays legible — but it is equally an address, so recomputing it from
   * `name` would orphan every record filed under the old one.
   */
  key: string
  /** Short display name (e.g. "Personal market workspace"). */
  name: string
  /** One or two lines on what this project is *for*. Shown under the name. */
  mission: string
  /** Longer prose — the paragraph a new reader (or an agent) needs to have
   *  context. Free-form; empty is normal. */
  description: string
  /**
   * Every folder whose work belongs to this project — the membership test.
   *
   * Vault-relative (`acceleration_core/F9`) or absolute (`/Users/…/repo`), and
   * a project may have as many as it likes: a vault project's sessions run from
   * inside the vault, while its code sessions run from a checkout that is not
   * under the vault and not otherwise knowable. Resolution is longest-prefix, so
   * nesting one project's root inside another's is well-defined.
   *
   * Pointers, never identity. Moving a folder is one edit here rather than a
   * rewrite of every record that belongs to the project.
   */
  roots: string[]
  /** Optional heading this project files under in the projects list. '' = ungrouped. */
  group: string
  /** Other names this project's sessions have been detected as, so a rename or a
   *  differently-spelled checkout folds in instead of fragmenting. */
  aliases: string[]
  /** Explicit display color (`#34d399`). Empty means "derive one". */
  color: string
  /**
   * The directory under `<root>/thinking-organizer/` holding this project's
   * authored records. Empty means the default (`epics`).
   *
   * Not sniffable: Thinking Space carries both a `tasks/` (its live rows) and an
   * `epics/` (stale DEV-era items), so a probe that takes whichever exists reads
   * the wrong corpus.
   */
  taskDir: string
  /**
   * What to call the authored half of the organizer index — the heading over
   * this project's own records, opposite "Undertakings". Empty means "Tasks".
   *
   * Per-project because "task" is the *type's* name, not every project's word
   * for its records. Thinking Space's really are tasks. F9's are Ideas,
   * Questions to research, Key things — calling that half "Tasks" mislabels
   * every row under it, so F9 names it "Thinking": the half opposite doing.
   */
  taskLabel: string
  /**
   * What kind of work this project mostly is — drives the work-mix heatmap.
   * Empty means unclassified, which the fold treats as `other`.
   *
   * Per-project rather than per-session because the kind is not derivable from
   * a transcript and a per-session prompt is a tax nobody pays twice. See
   * [projectKindBlock](./projectKindBlock.ts) for what the kinds mean.
   */
  kind: ProjectKindBlock
}

/**
 * v1: `{ id, name, mission }`.
 * v2: adds `vaultPath`, `organizerEnabled` — both dead on arrival, no readers.
 * v3: `id` → `uuid` and `vaultPath` → `roots[]`, drops `organizerEnabled`, adds
 *     `key`, `description`, `group`, `aliases`, `color`.
 */
export const PROJECTS_SCHEMA_VERSION_BLOCK = 3

export interface ProjectsFileBlock {
  version: number
  projects: ProjectBlock[]
}

export function createProjectUuidBlock(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** v1/v2 wrote `id`; v3 writes `uuid`. Both are read so an upgrade keeps every
 *  project — and, more importantly, keeps its *value*, since canvas surfaces
 *  store that value as their binding. */
function readProjectUuidBlock(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const candidate = value as { uuid?: unknown; id?: unknown }
  if (typeof candidate.uuid === 'string' && candidate.uuid) return candidate.uuid
  if (typeof candidate.id === 'string' && candidate.id) return candidate.id
  return ''
}

export function isValidProjectBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProjectBlock>
  return (
    readProjectUuidBlock(value).length > 0 &&
    typeof candidate.name === 'string' &&
    typeof candidate.mission === 'string'
  )
}

/** Normalize vault-relative paths: forward slashes, no leading/trailing slash. */
export function normalizeVaultPathBlock(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim()
}

/**
 * Normalize a root. Absolute paths keep their leading slash — a code checkout
 * outside the vault is addressed absolutely, and stripping it would silently
 * reinterpret it as vault-relative and match nothing.
 */
export function normalizeProjectRootBlock(value: unknown): string {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/\\/g, '/').trim().replace(/\/+$/, '')
  if (!clean) return ''
  return clean.startsWith('/') ? clean.replace(/^\/+/, '/') : clean.replace(/^\/+/, '')
}

/**
 * Store a root that lives inside the vault as vault-relative.
 *
 * A root is a *portable* address. The vault sits at a different absolute path on
 * every device — `/Users/…/Long-Term-Memory-iCloud` on the Mac, an app container
 * on iOS — so an absolute path to something inside it is only true on the
 * machine that typed it. Relative roots re-anchor per device; absolute ones are
 * kept verbatim, which is correct and necessary for a code checkout *outside*
 * the vault.
 *
 * Getting this wrong is not a near-miss, it is an inversion. The vault project
 * once held the vault's own absolute Mac path: on iOS every sibling project's
 * relative root anchored to the container and matched nothing, while that one
 * absolute root still prefixed every Mac-recorded cwd — so it became the only
 * match and swallowed F9, sfdl and every other vault project whole. Electron
 * looked perfect throughout, because there the two spellings coincide.
 *
 * The vault root itself relativizes to '' and is dropped: "every session in the
 * vault" is not a membership rule, it is the absence of one.
 */
export function relativizeProjectRootBlock(root: string, vaultRoot: string | null | undefined): string {
  if (!root.startsWith('/')) return root
  const base = (vaultRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!base) return root
  if (root === base) return ''
  return root.startsWith(`${base}/`) ? root.slice(base.length + 1) : root
}

function normalizeStringListBlock(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const v = raw.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function normalizeRootsBlock(value: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of normalizeStringListBlock(value)) {
    const root = normalizeProjectRootBlock(raw)
    if (!root || seen.has(root)) continue
    seen.add(root)
    out.push(root)
  }
  return out
}

/**
 * What a key may be, and deliberately not narrower than that.
 *
 * The obvious rule — restrict it to a directory-safe charset — is wrong, and
 * this vault is the counterexample: 17 chain digests carry
 * `projectId: Understanding Myself`, with a space, while their directory is
 * `Understanding_Myself`. The key is the canonical *project string* the parser
 * emits and groups by; `sanitizeSegment` (aiActivitySessionDigestBlock) already
 * derives the filesystem name from it. Rejecting the space would have set that
 * project's key to '' and silently dropped it from the registry.
 *
 * So the only bans are the ones that would make a key ambiguous as a path
 * segment: separators, dot-entries, and control characters. An unusable stored
 * key becomes '' — the project has no on-disk home yet — rather than being
 * rewritten into a *different* address that nothing is filed under.
 */
export function isValidProjectKeyBlock(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const key = value.trim()
  if (!key || key.length > 64 || key !== value) return false
  if (key === '.' || key === '..') return false
  for (const ch of key) {
    if (ch === '/' || ch === '\\') return false
    if (ch.charCodeAt(0) < 0x20) return false
  }
  return true
}

/** Derive a candidate key from a name. Only ever used to *propose* one for a
 *  project that has none — never to recompute an existing one. */
export function suggestProjectKeyBlock(name: string): string {
  const key = name.trim().replace(/[/\\]+/g, '-').slice(0, 64).trim()
  return isValidProjectKeyBlock(key) ? key : ''
}

/**
 * Fill in current fields on a record written by any earlier version.
 *
 * Upgrading must never drop a project: fields default rather than invalidate,
 * because a rejected record is an *erased* one the moment the next write
 * persists the filtered list. v2's `vaultPath` becomes the first root; its
 * `organizerEnabled` is dropped outright — nothing ever read it, and a registry
 * entry existing is the opt-in it was trying to express.
 */
function upgradeProjectBlock(value: unknown): ProjectBlock {
  const candidate = value as Partial<ProjectBlock> & { vaultPath?: unknown; slug?: unknown }
  const roots = normalizeRootsBlock(candidate.roots)
  if (roots.length === 0) {
    const legacy = normalizeVaultPathBlock(candidate.vaultPath)
    if (legacy) roots.push(legacy)
  }
  // `slug` is read as well as `key`: an early v3 build wrote that name, and a
  // key is an address — silently dropping it would refile the project's records.
  const key = isValidProjectKeyBlock(candidate.key)
    ? candidate.key
    : isValidProjectKeyBlock(candidate.slug)
      ? candidate.slug
      : ''
  return {
    uuid: readProjectUuidBlock(value),
    key,
    name: candidate.name ?? '',
    mission: candidate.mission ?? '',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    roots,
    group: typeof candidate.group === 'string' ? candidate.group.trim() : '',
    aliases: normalizeStringListBlock(candidate.aliases),
    color: typeof candidate.color === 'string' ? candidate.color.trim() : '',
    taskDir: typeof candidate.taskDir === 'string' ? candidate.taskDir.trim() : '',
    taskLabel: typeof candidate.taskLabel === 'string' ? candidate.taskLabel.trim() : '',
    kind: normalizeProjectKindBlock(candidate.kind),
  }
}

export function normalizeProjectsFileBlock(value: unknown): ProjectsFileBlock | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ProjectsFileBlock>
  // Accept any version at or below current and migrate forward. Rejecting an
  // older file here would make readProjectsBlock return [], and the next write
  // would persist that empty list over the user's real projects.
  if (typeof candidate.version !== 'number') return null
  if (candidate.version > PROJECTS_SCHEMA_VERSION_BLOCK) return null
  if (!Array.isArray(candidate.projects)) return null
  const projects = candidate.projects.filter(isValidProjectBlock).map(upgradeProjectBlock)
  return { version: PROJECTS_SCHEMA_VERSION_BLOCK, projects }
}

/**
 * Why a detected project name cannot become a key — the same rules as
 * `isValidProjectKeyBlock`, but naming the one that fired.
 *
 * The adoption panel used to fold every rejection into one message about path
 * separators, so a name rejected for any other reason ("Austin house:land ",
 * with a trailing space a folder listing does not show) reported a slash that
 * isn't there, and the user had nothing to act on. A name that is only untidy
 * is not a rejection at all: `trim()` it and adopt the tidy form, since the
 * chain directory is derived from the key by `sanitizeSegment` and would have
 * dropped the whitespace anyway.
 *
 * `taken` is here because it is the failure with no visible symptom: adopting
 * a key another project already owns writes a project with an *empty* key, so
 * the row never flips to "In Projects" and the button looks inert.
 */
export type ProjectKeyIssueBlock = 'empty' | 'too-long' | 'separator' | 'control' | 'taken'

export function explainProjectKeyIssueBlock(
  value: string,
  takenKeys?: Iterable<string>,
): ProjectKeyIssueBlock | null {
  const key = value.trim()
  if (!key || key === '.' || key === '..') return 'empty'
  if (key.length > 64) return 'too-long'
  for (const ch of key) {
    if (ch === '/' || ch === '\\') return 'separator'
    if (ch.charCodeAt(0) < 0x20) return 'control'
  }
  if (takenKeys) {
    for (const taken of takenKeys) {
      if (taken === key) return 'taken'
    }
  }
  return null
}
