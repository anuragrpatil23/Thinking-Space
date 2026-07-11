// Vault graph data workflow — gathers the four sources (vault walk, link
// index, git births, AI activity) and hands them to vaultGraphBlock for
// assembly. Snapshot + in-flight dedupe mirror aiActivityCacheBlock so
// re-entering the tab is instant.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getAllLinks } from '@/services/lego_blocks/integrations/dbBlock'
import { loadAiActivity } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'
import { loadGitFileBirthsBlock } from '@/services/lego_blocks/units/gitFileBirthBlock'
import { buildVaultGraphBlock, type VaultGraphData } from '@/services/lego_blocks/integrations/vaultGraphBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { isElectron } from '@/services/orchestrators/runtimeOrch'
import {
  readAiActivityMappingBlock,
  resolveCanonicalProjectBlock,
} from '@/services/lego_blocks/units/aiActivityMappingBlock'

export type { VaultGraphData, VaultGraphNode, VaultGraphLink } from '@/services/lego_blocks/integrations/vaultGraphBlock'

const SNAPSHOT_TTL_MS = 5 * 60_000

let _snapshot: { data: VaultGraphData; ts: number } | null = null
let _inflight: Promise<VaultGraphData> | null = null

async function performLoad(): Promise<VaultGraphData> {
  const fs = getVaultFS()
  const vaultRoot = getStoredVaultRoot() ?? ''
  const vaultFolderName = vaultRoot.split('/').filter(Boolean).pop() ?? ''

  const [entries, links, activity, births] = await Promise.all([
    fs.walkVault(['.md']),
    getAllLinks(),
    loadAiActivity(fs).catch(() => ({ sessions: [], reparsed: 0 })),
    isElectron() && vaultRoot
      ? loadGitFileBirthsBlock(vaultRoot).catch(() => new Map<string, number>())
      : Promise.resolve(new Map<string, number>()),
  ])

  // One mapping snapshot for the whole build — the same rename/merge rules
  // the AI activity card applies, matched against each note's vault path.
  const mappingSettings = readAiActivityMappingBlock()

  return buildVaultGraphBlock({
    entries,
    links,
    births,
    sessions: activity.sessions,
    vaultFolderName,
    nowMs: Date.now(),
    resolveProject: (raw, path) => resolveCanonicalProjectBlock(raw, path, null, mappingSettings),
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
