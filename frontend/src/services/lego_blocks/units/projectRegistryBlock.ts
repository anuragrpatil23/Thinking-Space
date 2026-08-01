// Project registry: map a session's working directory to a canonical project
// by longest-prefix match, so one project's work stops fragmenting across the
// folders it was run from.
//
// Why this exists: the parse-time project is the cwd's basename, so the same
// logical project scatters — Thinking Space appears as `Thinking-Space`,
// `frontend`, `backend`, `App`; a vault project appears under every spelling of
// its path. Basename can't fix that; a path map can. This is the mechanism the
// design calls "the actual prerequisite" for the cross-project view.
//
// The data comes from `.thinking-space/projects.json`. The markdown parser and
// renderer below are the fallback/mirror pair for that file, one line per
// project:
//   - **F9** · `acceleration_core/F9/` — …
// A line may carry more than one backticked path. That matters for code repos:
// a vault project's sessions run from inside the vault (one path), but
// thinkingspace.ai's code sessions run from the repo checkout, which is not
// under the vault and not otherwise knowable — so its line needs the repo's
// absolute path added as a second backticked entry. Every backticked path on a
// line is a root for that project.
//
// Pure: parsing and resolution here, the vault read + cache in the loader.

export interface ProjectRegistryEntry {
  project: string
  /** Absolute cwd prefixes that belong to this project. */
  paths: string[]
}

/**
 * Parse `projects.md`. Vault-relative paths are anchored to `vaultRoot`;
 * absolute paths (a code-repo checkout) are kept as-is. Lines without a bolded
 * name and at least one backticked path are ignored (headings, prose).
 */
export function parseProjectRegistryMarkdownBlock(
  markdown: string,
  vaultRoot: string,
): ProjectRegistryEntry[] {
  const root = vaultRoot.replace(/\/+$/, '')
  const out: ProjectRegistryEntry[] = []
  for (const line of markdown.split('\n')) {
    const m = /^\s*-\s*\*\*(.+?)\*\*\s*(.*)$/.exec(line)
    if (!m) continue
    const project = m[1].trim()
    if (!project) continue
    // Paths come from before the em dash only. After it is prose, and prose
    // backticks things: thinkingspace.ai's line names `Thinking-Space`,
    // `frontend` and `backend` while *explaining* the fragmentation it fixes,
    // and reading those as roots anchors three folders that do not exist.
    const [pathPart] = m[2].split('—')
    const paths: string[] = []
    for (const pm of pathPart.matchAll(/`([^`]+)`/g)) {
      const raw = pm[1].trim().replace(/\/+$/, '')
      if (!raw) continue
      paths.push(raw.startsWith('/') ? raw : root ? `${root}/${raw}` : raw)
    }
    if (paths.length) out.push({ project, paths })
  }
  return out
}

export const PROJECTS_MARKDOWN_BANNER_BLOCK =
  '<!-- GENERATED from .thinking-space/projects.json — do not edit. Edit projects in Settings → Projects. -->'

/**
 * Render the human-readable mirror of `projects.json`.
 *
 * Deliberately emits the same line shape `parseProjectRegistryMarkdownBlock`
 * reads, so the mirror is legible to a person, to an agent grepping the vault,
 * and — if `projects.json` is ever lost — to the fallback parser. It is a
 * mirror and never a source: the banner says so, and nothing writes back.
 *
 * Keys, not names, head each line: the key is the address every chain directory
 * and organizer record is filed under, so that is what a reader needs to match.
 *
 * No timestamp on purpose — it is rewritten with every `projects.json` write, so
 * a date would add nothing but an iCloud sync on every keystroke-saved edit.
 */
export function renderProjectsMarkdownBlock(
  projects: Array<{ key: string; name: string; mission: string; roots: string[]; group: string; aliases: string[] }>,
): string {
  const listed = projects.filter(p => p.key)
  const groups = new Map<string, typeof listed>()
  for (const project of listed) {
    const group = project.group.trim()
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(project)
  }
  // Named groups first, alphabetically; the ungrouped remainder last, under its
  // own heading — without one it reads as the tail of whichever group sorted
  // last, which is exactly the wrong thing for a file about what belongs where.
  const names = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b))
  if (groups.has('')) names.push('')

  const lines: string[] = [PROJECTS_MARKDOWN_BANNER_BLOCK, '', '# Projects', '']
  for (const group of names) {
    lines.push(`## ${group || 'Ungrouped'}`, '')
    const members = groups.get(group)!.slice().sort((a, b) => a.key.localeCompare(b.key))
    for (const project of members) {
      const paths = project.roots.map(root => `\`${root}\``).join(' ')
      const label = project.name.trim() && project.name.trim() !== project.key ? ` (${project.name.trim()})` : ''
      const mission = project.mission.trim().replace(/\s+/g, ' ')
      // Parenthesised only when it trails a mission; on its own it is the note.
      const akaText = project.aliases.length
        ? `also known as ${project.aliases.map(a => `"${a}"`).join(', ')}`
        : ''
      const aka = akaText && mission ? `(${akaText})` : akaText
      // A mission is prose and usually ends in its own period; don't add a second.
      const tail = [mission, aka].filter(Boolean).join(mission.endsWith('.') ? ' ' : '. ')
      lines.push(`- **${project.key}**${label}${paths ? ` ${paths}` : ''}${tail ? ` — ${tail}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Longest registered root containing `cwd`, with the root that matched — the
 *  root is what the settings page shows to explain an attribution. */
export function matchProjectRootBlock(
  cwd: string,
  entries: ProjectRegistryEntry[],
): { project: string; root: string } | null {
  const norm = cwd.replace(/\/+$/, '')
  if (!norm) return null
  let best: { project: string; root: string } | null = null
  for (const entry of entries) {
    for (const path of entry.paths) {
      if (norm === path || norm.startsWith(`${path}/`)) {
        if (!best || path.length > best.root.length) best = { project: entry.project, root: path }
      }
    }
  }
  return best
}

/** Canonical project for a cwd by longest-prefix match, or null when no
 *  registered path contains it (caller falls back to basename inference). */
export function resolveProjectByCwdBlock(
  cwd: string,
  entries: ProjectRegistryEntry[],
): string | null {
  return matchProjectRootBlock(cwd, entries)?.project ?? null
}

/**
 * The same entries, from the projects the user actually defined.
 *
 * This is the direction the data should always have flowed. `projects.md` was a
 * hand-maintained file at a hardcoded path (`kai-workspace/`), so the registry
 * was silently empty for every user whose vault has no such folder — their
 * projects fragmented by cwd basename with nothing on screen to explain why.
 *
 * The project's `key` is the canonical name, not `name`: it is the address
 * already written into `ai-activity/chains/<key>/` and every organizer record,
 * so emitting the display name here would file new work under a second identity.
 * A project with no key yet has no on-disk home and is skipped rather than
 * guessed at. `aliases` are not roots — they match detected *names*, handled by
 * the mapping rules, not by prefix.
 */
export function projectRegistryFromProjectsBlock(
  projects: Array<{ key: string; roots: string[] }>,
  vaultRoot: string,
): ProjectRegistryEntry[] {
  const root = vaultRoot.replace(/\/+$/, '')
  const out: ProjectRegistryEntry[] = []
  for (const project of projects) {
    if (!project.key) continue
    const paths: string[] = []
    for (const raw of project.roots ?? []) {
      const path = raw.trim().replace(/\/+$/, '')
      if (!path) continue
      paths.push(path.startsWith('/') ? path : root ? `${root}/${path}` : path)
    }
    if (paths.length) out.push({ project: project.key, paths })
  }
  return out
}

/**
 * Aliases: detected project *name* → canonical key.
 *
 * Roots fix attribution by path, which is the strong evidence and handles every
 * session whose cwd is under a registered folder. Aliases cover what paths
 * cannot: a session with no usable cwd (a pasted transcript, a web export), or
 * one run from a folder that is a project's but was never listed. `backend` in
 * this vault is the case — its cwd was the vault root, which belongs to no
 * project, so no prefix will ever match it and only the name can fold it in.
 *
 * Matched case-insensitively, since the same checkout appears as `Thinking-Space`
 * and `thinking-space` depending on how it was cloned. An alias that collides
 * with a real project's key is dropped: a project's own name outranks another
 * project's claim on it, or the two would fight over their own sessions.
 */
export type ProjectAliasMapBlock = Map<string, string>

export function projectAliasesFromProjectsBlock(
  projects: Array<{ key: string; aliases?: string[] }>,
): ProjectAliasMapBlock {
  const keys = new Set(projects.map(p => p.key.trim().toLowerCase()).filter(Boolean))
  const out: ProjectAliasMapBlock = new Map()
  for (const project of projects) {
    const key = project.key.trim()
    if (!key) continue
    for (const raw of project.aliases ?? []) {
      const alias = raw.trim().toLowerCase()
      if (!alias || keys.has(alias) || out.has(alias)) continue
      out.set(alias, key)
    }
  }
  return out
}

export function resolveProjectByAliasBlock(
  detected: string,
  aliases: ProjectAliasMapBlock,
): string | null {
  return aliases.get(detected.trim().toLowerCase()) ?? null
}

// In-memory cache. The registry rarely changes and the resolver
// (resolveCanonicalProjectBlock) is synchronous, so the loader warms this once
// and the resolver reads it here. Empty until loaded — the resolver then just
// falls back to basename, which is the pre-registry behaviour.
let _cache: ProjectRegistryEntry[] = []
let _aliasCache: ProjectAliasMapBlock = new Map()
let _colorCache: Record<string, string> = {}
let _nameCache: Record<string, string> = {}

export function setCachedProjectRegistryBlock(entries: ProjectRegistryEntry[]): void {
  _cache = entries
}

export function readCachedProjectRegistryBlock(): ProjectRegistryEntry[] {
  return _cache
}

export function setCachedProjectAliasesBlock(aliases: ProjectAliasMapBlock): void {
  _aliasCache = aliases
}

export function readCachedProjectAliasesBlock(): ProjectAliasMapBlock {
  return _aliasCache
}

/** Canonical key → explicit color, for projects that set one. Same warm-once
 *  shape as the registry: the color resolver is synchronous. */
export function setCachedProjectColorsBlock(colors: Record<string, string>): void {
  _colorCache = colors
}

export function readCachedProjectColorsBlock(): Record<string, string> {
  return _colorCache
}

/** Canonical key → display name. Grouping, colors, and every on-disk address
 *  stay on the key; only rendered text goes through here. That split is what
 *  lets a project be renamed without moving its chain directory or splitting
 *  its history in two. */
export function setCachedProjectNamesBlock(names: Record<string, string>): void {
  _nameCache = names
}

export function readCachedProjectNamesBlock(): Record<string, string> {
  return _nameCache
}

/** Rendered label for a canonical project key. Falls back to the key, which is
 *  what every view showed before names existed. */
export function projectLabelBlock(key: string): string {
  return _nameCache[key] ?? key
}
