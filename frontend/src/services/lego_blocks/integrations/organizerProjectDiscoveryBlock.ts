import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getVaultFileIndexPaths } from '@/services/lego_blocks/integrations/dbBlock'
import { THINKING_ORGANIZER_DIR } from '@/services/lego_blocks/integrations/projectStorageBlock'

/**
 * Finding the organizer's projects by looking, instead of remembering.
 *
 * The list used to be whatever localStorage happened to hold: a project entered
 * it only by being created through the Create Project flow, and there was no
 * path back in for one that already existed on disk. A vault carrying a fully
 * populated undertaking registry could show "no projects yet", and the only
 * repair was to create the project a second time.
 *
 * So the vault is the source of truth and localStorage is a cache, which is the
 * same rule the rest of the app already follows. Two kinds of evidence count:
 *
 * 1. **A named ui-state** — `<root>/thinking-organizer/organizer-ui-state.json`
 *    with a `projectName`. The name is the marker on purpose: that file also
 *    appears under folders that merely *had* organizer state once, and listing
 *    those as projects would be worse than listing none. Candidate roots come
 *    from the path index and the ui-state is then read per candidate, because
 *    the index only tracks markdown — looking the JSON up in it finds nothing.
 * 2. **A registry directory** — `ai-activity/thinking-organizer/<id>/`. Chains
 *    get attributed to a project long before anyone builds a node tree for it,
 *    so the registry is often the first evidence a project exists at all.
 *
 * Merged on the **AI-activity project id** — the registry `key`, which is by
 * definition the folder chains are filed under, and is allowed to differ from
 * the folder name (`lifeblood_systems/thinkingspace.ai` files under
 * `Thinking-Space`). A node-tree root wins over a registry-only one: it is the
 * richer record.
 */

import { loadProjectRegistryBlock } from '@/services/lego_blocks/integrations/projectRegistryLoaderBlock'
import {
  readCachedProjectNamesBlock,
  readCachedProjectRegistryBlock,
  relativizeRegistryEntriesBlock,
} from '@/services/lego_blocks/units/projectRegistryBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

export const AI_ACTIVITY_REGISTRY_ROOT_BLOCK = 'ai-activity/thinking-organizer'

const ORGANIZER_DIR_SEGMENT = `/${THINKING_ORGANIZER_DIR}/`

export interface DiscoveredProjectBlock {
  /** Vault-relative project root. For a registry-only project this is the
   *  registry directory itself — a real path, unique, and one whose basename is
   *  already the project id. */
  root: string
  name: string
  /** The id the undertaking registry and the chain digests are filed under. */
  aiProjectId: string
  /** False when the only evidence is a registry directory, so a caller can tell
   *  "no node tree yet" apart from "node tree failed to load". */
  hasNodeTree: boolean
}

function humanize(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ').trim()
  return spaced.replace(/\b\w/g, char => char.toUpperCase())
}

export async function discoverOrganizerProjectsBlock(): Promise<DiscoveredProjectBlock[]> {
  const byAiProjectId = new Map<string, DiscoveredProjectBlock>()

  // Key-only read of the file index rather than a directory walk: discovery
  // runs on mount, and a vault-wide walk on every organizer open is exactly the
  // kind of unconditional work the energy contract exists to prevent.
  let paths: string[] = []
  try {
    paths = await getVaultFileIndexPaths()
  } catch {
    paths = []
  }

  // The index holds markdown only — asking it for the ui-state JSON directly
  // returns nothing, always. So the index supplies *candidate roots* (any folder
  // with organizer markdown under it) and the ui-state is read per candidate.
  // There are a handful of candidates in a vault, so this is a few reads, not a
  // walk.
  // Which roots actually carry a node tree. The index holds markdown only, which
  // is exactly the question being asked here, so this is a key scan, not a read.
  const rootsWithTree = new Set<string>()
  for (const path of paths) {
    const at = path.indexOf(ORGANIZER_DIR_SEGMENT)
    if (at <= 0) continue
    const root = path.slice(0, at)
    // ai-activity/thinking-organizer is the chain registry, not a project root;
    // it gets its own pass below.
    if (!root || root === 'ai-activity') continue
    rootsWithTree.add(root)
  }

  // Identity comes from the registry, never from a per-project file. It used to
  // read each candidate's `organizer-ui-state.json` for `projectName` and
  // `aiProjectId` — a second copy of `name` and `key`, and a hard dependency on
  // a file that is going away. It also meant a project whose ui-state happened
  // to omit `projectName` vanished from this list entirely.
  //
  // Registration alone is not evidence of an organizer, though: most registered
  // projects have no node tree and never will, and listing all of them would
  // bury the few that do. So an entry appears only with evidence — markdown
  // under its root here, or a chain directory in the pass below.
  await loadProjectRegistryBlock()
  const names = readCachedProjectNamesBlock()
  for (const { project, root } of relativizeRegistryEntriesBlock(
    readCachedProjectRegistryBlock(),
    getStoredVaultRoot() ?? '',
  )) {
    if (!rootsWithTree.has(root)) continue
    byAiProjectId.set(project, {
      root,
      name: names[project]?.trim() || project,
      aiProjectId: project,
      hasNodeTree: true,
    })
  }

  let registryIds: string[] = []
  try {
    registryIds = (await getVaultFS().list(AI_ACTIVITY_REGISTRY_ROOT_BLOCK)).folders
  } catch {
    registryIds = []
  }

  for (const id of registryIds) {
    if (byAiProjectId.has(id)) continue
    byAiProjectId.set(id, {
      root: `${AI_ACTIVITY_REGISTRY_ROOT_BLOCK}/${id}`,
      name: humanize(id),
      aiProjectId: id,
      hasNodeTree: false,
    })
  }

  return [...byAiProjectId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

