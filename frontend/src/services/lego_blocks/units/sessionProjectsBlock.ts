/* Which projects the sessions in view belong to, so the explorer's session
   line says where the work happened ("sfresearch · 9 created") and not only
   how much. The project is the one the AI activity parser files each session
   under — the same name the AI Activity panel shows — not inferred from where
   the files landed: work in sfresearch that writes into a nested project's
   folder (sfresearch/…/jessy-william) is still sfresearch work. Bracketed
   buckets ("[auto-commit]") and empty names are not projects. */

export interface SessionProjectCountBlock {
  name: string
  count: number
}

/** Projects across the given sessions, weighted by files touched, largest first. */
export function sessionProjectsBlock(
  sessions: ReadonlyArray<{ project: string; fileCount: number }>,
): SessionProjectCountBlock[] {
  const counts = new Map<string, number>()
  for (const { project, fileCount } of sessions) {
    const name = project.trim()
    if (!name || name.startsWith('[')) continue
    counts.set(name, (counts.get(name) ?? 0) + fileCount)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** "sfresearch", "sfresearch +2", or null when no project is known. */
export function sessionProjectsLabelBlock(projects: readonly SessionProjectCountBlock[]): string | null {
  if (projects.length === 0) return null
  return projects.length === 1 ? projects[0].name : `${projects[0].name} +${projects.length - 1}`
}
