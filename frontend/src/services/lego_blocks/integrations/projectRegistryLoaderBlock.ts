import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { readProjectsBlock } from '@/services/lego_blocks/integrations/projectsStorageBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  parseProjectRegistryMarkdownBlock,
  projectAliasesFromProjectsBlock,
  projectTaskSourcesFromProjectsBlock,
  projectMissionsFromProjectsBlock,
  setCachedProjectMissionsBlock,
  setCachedProjectTaskSourcesBlock,
  projectRegistryFromProjectsBlock,
  setCachedProjectAliasesBlock,
  setCachedProjectColorsBlock,
  setCachedProjectNamesBlock,
  setCachedProjectRegistryBlock,
} from '@/services/lego_blocks/units/projectRegistryBlock'

// Warms the project-registry cache — the map from a session's working directory
// to a canonical project — before AI-activity attribution resolves.
//
// The projects the user defined in Settings are the source. `projects.md` is a
// fallback for one case only: a vault that was using the old hand-maintained
// file and has not been imported yet. It is a hardcoded path under
// `kai-workspace/`, which is why it cannot be the source — for anyone whose
// vault has no such folder the registry was silently empty, and their projects
// fragmented by cwd basename with nothing on screen to say why.
//
// Best-effort throughout: nothing readable leaves the cache empty and
// attribution falls back to the basename, which is the pre-registry behaviour.

// Tried in order. The first is the generated mirror of `projects.json` — it
// only matters if the JSON is lost or unreadable, in which case the mirror is
// the freshest surviving copy. The second is the old hand-maintained file, kept
// for vaults that never imported.
const FALLBACK_PROJECTS_MD_PATHS = ['.thinking-space/projects.md', 'kai-workspace/projects.md']

async function fallbackRegistryBlock(vaultRoot: string) {
  const fs = getVaultFS()
  for (const path of FALLBACK_PROJECTS_MD_PATHS) {
    try {
      if (!(await fs.exists(path))) continue
      const entries = parseProjectRegistryMarkdownBlock(await fs.read(path), vaultRoot)
      if (entries.length) return entries
    } catch {
      /* try the next one */
    }
  }
  return []
}

export async function loadProjectRegistryBlock(): Promise<void> {
  try {
    const vaultRoot = getStoredVaultRoot() ?? ''
    const projects = await readProjectsBlock()
    const defined = projectRegistryFromProjectsBlock(projects, vaultRoot)
    // Aliases come only from defined projects — `projects.md` has no way to
    // express them, so a vault still on the fallback simply has none.
    setCachedProjectAliasesBlock(projectAliasesFromProjectsBlock(projects))
    setCachedProjectColorsBlock(
      Object.fromEntries(
        projects.filter(p => p.key && p.color).map(p => [p.key, p.color]),
      ),
    )
    // Names are labels only. A rename must never move a chain directory or
    // split a project's history, so nothing but rendered text reads these.
    setCachedProjectNamesBlock(
      Object.fromEntries(
        projects
          .filter(p => p.key && p.name.trim() && p.name.trim() !== p.key)
          .map(p => [p.key, p.name.trim()]),
      ),
    )
    setCachedProjectTaskSourcesBlock(projectTaskSourcesFromProjectsBlock(projects))
    setCachedProjectMissionsBlock(projectMissionsFromProjectsBlock(projects))
    // Only fall back when the defined projects contribute *no* roots at all.
    // Merging the two would let a stale markdown line quietly outrank an edit
    // made in Settings, and longest-prefix would pick between them by accident.
    setCachedProjectRegistryBlock(
      defined.length > 0 ? defined : await fallbackRegistryBlock(vaultRoot),
    )
  } catch {
    // Leave whatever is cached; never let registry loading break the view.
  }
}
