// Vault graph data workflow — one unified graph over everything the vault
// holds. Markdown notes get wikilink edges (Dexie link index); code files get
// lexical import edges (codeImportScanBlock). Both flow through the same
// assembly, so a repo opened as a profile's vault becomes a codebase map with
// its docs clustered beside the code, while a notes-only vault is unchanged.
// Git births, AI-session heat, and folder-gravity layout apply to all nodes.
// Snapshot + in-flight dedupe mirror aiActivityCacheBlock so re-entering the
// tab is instant.

import { getVaultFS, type VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getAllLinks } from '@/services/lego_blocks/integrations/dbBlock'
import { loadAiActivity } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import { loadGitFileBirthsBlock } from '@/services/lego_blocks/units/gitFileBirthBlock'
import {
  buildVaultGraphBlock,
  projectPrefixOfBlock,
  type GraphLinkInput,
  type VaultGraphData,
} from '@/services/lego_blocks/integrations/vaultGraphBlock'
import { readProjectsBlock } from '@/services/lego_blocks/integrations/projectsStorageBlock'
import { loadProjectRegistryBlock } from '@/services/lego_blocks/integrations/projectRegistryLoaderBlock'
import {
  buildCodeGraphLinksBlock,
  isGeneratedCodePathBlock,
  CODE_GRAPH_NODE_EXTENSIONS,
  CODE_SCAN_MAX_BYTES,
} from '@/services/lego_blocks/units/codeImportScanBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { isElectron } from '@/services/orchestrators/runtimeOrch'
import {
  readAiActivityMappingBlock,
  resolveCanonicalProjectBlock,
} from '@/services/lego_blocks/units/aiActivityMappingBlock'

export type { VaultGraphData, VaultGraphNode, VaultGraphLink } from '@/services/lego_blocks/integrations/vaultGraphBlock'

const SNAPSHOT_TTL_MS = 5 * 60_000

/** Hard ceiling on scanned code files — beyond this the force sim degrades
 *  anyway; most-recently-modified wins so active code survives the cut. */
const CODE_SCAN_MAX_FILES = 6000

/** Parallel content reads — each is one small IPC round-trip. */
const CODE_READ_CONCURRENCY = 24

let _snapshot: { data: VaultGraphData; ts: number } | null = null
let _inflight: Promise<VaultGraphData> | null = null

/** Import edges for the vault's code files: read the scannable ones with
 *  bounded concurrency, extract + resolve imports. Unreadable files just
 *  contribute no edges — they stay as nodes. */
async function loadCodeLinks(
  fs: VaultFS,
  codeEntries: Array<{ path: string; size: number }>,
): Promise<GraphLinkInput[]> {
  const scannable = codeEntries.filter(e => e.size > 0 && e.size <= CODE_SCAN_MAX_BYTES)
  const contents: Array<{ path: string; content: string }> = []
  let next = 0
  async function worker() {
    while (next < scannable.length) {
      const entry = scannable[next++]
      try {
        contents.push({ path: entry.path, content: await fs.read(entry.path) })
      } catch {
        // unreadable file — node without outgoing edges
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CODE_READ_CONCURRENCY, scannable.length) }, worker),
  )
  return buildCodeGraphLinksBlock(contents, codeEntries.map(e => e.path))
}

async function performLoad(): Promise<VaultGraphData> {
  const fs = getVaultFS()
  const vaultRoot = getStoredVaultRoot() ?? ''
  const vaultFolderName = vaultRoot.split('/').filter(Boolean).pop() ?? ''

  const walked = await fs.walkVault(['.md', ...CODE_GRAPH_NODE_EXTENSIONS])
  // Build outputs would drown the real files — for markdown too (dist/ docs).
  const entries = walked.filter(e => !isGeneratedCodePathBlock(e.path))
  const codeEntries = entries
    .filter(e => !e.path.endsWith('.md'))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, CODE_SCAN_MAX_FILES)

  const [noteLinks, codeLinks, activity, births] = await Promise.all([
    getAllLinks(),
    loadCodeLinks(fs, codeEntries),
    loadAiActivity(fs).catch(() => ({ sessions: [], reparsed: 0 })),
    isElectron() && vaultRoot
      ? // No pathspec: births for every file, code included.
        loadGitFileBirthsBlock(vaultRoot, []).catch(() => new Map<string, number>())
      : Promise.resolve(new Map<string, number>()),
  ])

  // One mapping snapshot for the whole build — the same rename/merge rules
  // the AI activity card applies, matched against each file's vault path.
  const mappingSettings = readAiActivityMappingBlock()

  // The defined projects: a note's folder now names its project, so a note and
  // a session sitting in the same folder finally agree instead of reaching that
  // answer through two unrelated rules.
  //
  // Roots are consulted *after* the existing mapping, not by handing the note's
  // absolute path to `resolveCanonicalProjectBlock` as a cwd. That shortcut
  // would quietly widen every `contains` rule to match the vault's own absolute
  // path — a rule written to catch one folder would start matching the whole
  // vault. An explicit rule (or an alias) still wins; roots only speak when the
  // mapping had nothing to say.
  await loadProjectRegistryBlock().catch(() => undefined)
  const rootToKey = new Map<string, string>()
  for (const project of await readProjectsBlock()) {
    if (!project.key) continue
    for (const root of project.roots) {
      if (!root.startsWith('/')) rootToKey.set(root, project.key)
    }
  }
  const projectRoots = [...rootToKey.keys()]

  return buildVaultGraphBlock({
    // Nodes: all markdown, plus the capped/most-recent code set (uncapped code
    // entries would appear as permanently link-less nodes).
    entries: [...entries.filter(e => e.path.endsWith('.md')), ...codeEntries],
    links: [...noteLinks, ...codeLinks],
    births,
    sessions: activity.sessions,
    vaultFolderName,
    nowMs: Date.now(),
    nodeExtensions: ['.md', ...CODE_GRAPH_NODE_EXTENSIONS],
    projectRoots,
    resolveProject: (raw, path) => {
      const mapped = resolveCanonicalProjectBlock(raw, path, null, mappingSettings)
      if (mapped !== raw) return mapped
      return rootToKey.get(projectPrefixOfBlock(path, projectRoots)) ?? mapped
    },
  })
}

export async function loadVaultGraph(options: { force?: boolean } = {}): Promise<VaultGraphData> {
  const { force = false } = options

  if (!force && _snapshot && Date.now() - _snapshot.ts < SNAPSHOT_TTL_MS) {
    return _snapshot.data
  }
  if (!force && _inflight) return _inflight
  if (force) {
    _snapshot = null
    _inflight = null
  }

  const promise = performLoad()
    .then(data => {
      _snapshot = { data, ts: Date.now() }
      _inflight = null
      return data
    })
    .catch(err => {
      _inflight = null
      throw err
    })

  _inflight = promise
  return promise
}
