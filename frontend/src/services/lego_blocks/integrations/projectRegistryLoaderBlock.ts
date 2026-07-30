import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  parseProjectRegistryMarkdownBlock,
  setCachedProjectRegistryBlock,
} from '@/services/lego_blocks/units/projectRegistryBlock'

// Warms the project-registry cache from kai-workspace/projects.md. Called once
// where AI-activity data loads, before project attribution resolves. Best-
// effort: a missing or unreadable file leaves the cache empty, and attribution
// falls back to the cwd basename — the pre-registry behaviour.

const PROJECTS_MD_PATH = 'kai-workspace/projects.md'

export async function loadProjectRegistryBlock(): Promise<void> {
  try {
    const fs = getVaultFS()
    if (!(await fs.exists(PROJECTS_MD_PATH))) return
    const md = await fs.read(PROJECTS_MD_PATH)
    const vaultRoot = getStoredVaultRoot() ?? ''
    setCachedProjectRegistryBlock(parseProjectRegistryMarkdownBlock(md, vaultRoot))
  } catch {
    // Leave whatever is cached; never let registry loading break the view.
  }
}
