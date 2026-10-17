import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  PROJECTS_MIRROR_PATH_BLOCK,
  readProjectsBlock,
} from '@/services/lego_blocks/integrations/projectsStorageBlock'
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
// The projects the user defined in Settings are the source. Their generated
// mirror, `.thinking-space/projects.md`, is the only fallback.
//
// Best-effort throughout: nothing readable leaves the cache empty and
// attribution falls back to the basename, which is the pre-registry behaviour.

// Only matters if `projects.json` is lost or unreadable, in which case the
// mirror is the freshest surviving copy. The old hand-maintained
// `kai-workspace/projects.md` fallback was retired once every vault had
// imported (2026-10-16).
async function fallbackRegistryBlock(vaultRoot: string) {
  try {
    const fs = getVaultFS()
    if (!(await fs.exists(PROJECTS_MIRROR_PATH_BLOCK))) return []
    return parseProjectRegistryMarkdownBlock(await fs.read(PROJECTS_MIRROR_PATH_BLOCK), vaultRoot)
  } catch {
    return []
  }
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
