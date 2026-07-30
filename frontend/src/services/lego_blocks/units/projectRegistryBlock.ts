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
// The data comes from `kai-workspace/projects.md`, one line per project:
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
    const paths: string[] = []
    for (const pm of m[2].matchAll(/`([^`]+)`/g)) {
      const raw = pm[1].trim().replace(/\/+$/, '')
      if (!raw) continue
      paths.push(raw.startsWith('/') ? raw : root ? `${root}/${raw}` : raw)
    }
    if (paths.length) out.push({ project, paths })
  }
  return out
}

/** Canonical project for a cwd by longest-prefix match, or null when no
 *  registered path contains it (caller falls back to basename inference). */
export function resolveProjectByCwdBlock(
  cwd: string,
  entries: ProjectRegistryEntry[],
): string | null {
  const norm = cwd.replace(/\/+$/, '')
  if (!norm) return null
  let best: { project: string; len: number } | null = null
  for (const entry of entries) {
    for (const path of entry.paths) {
      if (norm === path || norm.startsWith(`${path}/`)) {
        if (!best || path.length > best.len) best = { project: entry.project, len: path.length }
      }
    }
  }
  return best ? best.project : null
}

// In-memory cache. The registry rarely changes and the resolver
// (resolveCanonicalProjectBlock) is synchronous, so the loader warms this once
// and the resolver reads it here. Empty until loaded — the resolver then just
// falls back to basename, which is the pre-registry behaviour.
let _cache: ProjectRegistryEntry[] = []

export function setCachedProjectRegistryBlock(entries: ProjectRegistryEntry[]): void {
  _cache = entries
}

export function readCachedProjectRegistryBlock(): ProjectRegistryEntry[] {
  return _cache
}
