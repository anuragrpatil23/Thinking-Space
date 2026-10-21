/* Which projects a session's files belong to, so the explorer's session line
   can say where the work happened ("sfresearch · 9 created") rather than only
   how much. A file belongs to the project whose root folder contains it; the
   most specific root wins, so a project nested inside another project's
   folder (sfai inside sfresearch) claims its own files. Roots outside the
   vault (absolute paths) and an empty root (the whole vault) never match —
   the first is not a vault path, the second would claim everything. */

export interface SessionProjectCountBlock {
  name: string
  count: number
}

function normalizeRootBlock(root: string): string | null {
  const trimmed = root.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!trimmed || root.trim().startsWith('/') || /^[a-z]:/i.test(root.trim())) return null
  return trimmed
}

export function sessionProjectsBlock(
  paths: Iterable<string>,
  projects: ReadonlyArray<{ name: string; roots: readonly string[] }>,
): SessionProjectCountBlock[] {
  const roots: Array<{ root: string; name: string }> = []
  for (const project of projects) {
    for (const root of project.roots) {
      const normalized = normalizeRootBlock(root)
      if (normalized) roots.push({ root: normalized, name: project.name })
    }
  }
  roots.sort((a, b) => b.root.length - a.root.length)

  const counts = new Map<string, number>()
  for (const path of paths) {
    const match = roots.find(({ root }) => path === root || path.startsWith(`${root}/`))
    if (match) counts.set(match.name, (counts.get(match.name) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** "sfresearch", "sfresearch +2", or null when no project matched. */
export function sessionProjectsLabelBlock(projects: readonly SessionProjectCountBlock[]): string | null {
  if (projects.length === 0) return null
  return projects.length === 1 ? projects[0].name : `${projects[0].name} +${projects.length - 1}`
}
