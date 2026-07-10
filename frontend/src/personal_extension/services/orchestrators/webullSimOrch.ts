// Workflow surface for the Webull → Sim subtab.
//
// Resolves the f9-sim vault root from the configured Webull execution folder,
// scans the three sources (cases, eras.yaml, bench.md), and assembles the
// read-only timeline view-model the Sim canvas renders.
//
// The Sim data lives beside the execution data in the vault:
//   <F9>/F9-execution      ← executionFolderPath (configured in Settings → Webull)
//   <F9>/AI Synthesis/f9-sim
// so the sim root is derived from the execution folder's parent.

import { readWebullExecutionSettingsOrch } from './webullExecutionSettingsOrch'
import { readVaultUiPreferencesOrch } from '@/services/orchestrators/vaultUiPreferencesOrch'
import { scanWebullSimVaultBlock } from '../lego_blocks/integrations/webullSimVaultBlock'
import {
  buildWebullSimTimelineModelBlock,
  type WebullSimTimelineModelBlock,
} from '../lego_blocks/units/webullSimRecordBlock'

// Default sim folder name — a sibling of the execution folder, mirroring the
// `F9-execution` naming so the pair reads consistently in the vault.
const SIM_DEFAULT_FOLDER_NAME_BLOCK = 'F9-sim'

function normalizeVaultRelativePathBlock(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * Default sim folder derived from the execution folder path (its sibling):
 * `acceleration_core/F9/F9-execution` → `acceleration_core/F9/F9-sim`.
 * Returns '' when the execution folder isn't configured.
 */
export function deriveDefaultWebullSimRootBlock(executionFolderPath: string): string {
  const normalized = normalizeVaultRelativePathBlock(executionFolderPath)
  if (!normalized) return ''
  const lastSlash = normalized.lastIndexOf('/')
  const parent = lastSlash >= 0 ? normalized.slice(0, lastSlash) : ''
  return parent ? `${parent}/${SIM_DEFAULT_FOLDER_NAME_BLOCK}` : SIM_DEFAULT_FOLDER_NAME_BLOCK
}

/**
 * Resolve the sim folder the timeline reads. An explicit user-configured path
 * wins (and works even without an execution folder set); otherwise fall back to
 * the sibling default beside the execution folder.
 */
export function resolveWebullSimRootBlock(
  executionFolderPath: string,
  configuredSimFolderPath: string,
): string {
  const explicit = normalizeVaultRelativePathBlock(configuredSimFolderPath)
  if (explicit) return explicit
  return deriveDefaultWebullSimRootBlock(executionFolderPath)
}

export interface WebullSimOverviewBlock {
  simRoot: string
  configured: boolean
  model: WebullSimTimelineModelBlock
  warnings: string[]
}

const EMPTY_MODEL_BLOCK: WebullSimTimelineModelBlock = {
  lanes: [],
  eras: [],
  minYear: 1920,
  maxYear: new Date().getFullYear() + 2,
  totalReps: 0,
  benchSize: 0,
  counts: { staged: 0, responseWritten: 0, revealed: 0, postMortemDone: 0 },
}

export async function loadWebullSimOverviewOrch(): Promise<WebullSimOverviewBlock> {
  const [settings, preferences] = await Promise.all([
    readWebullExecutionSettingsOrch(),
    readVaultUiPreferencesOrch(),
  ])
  const simRoot = resolveWebullSimRootBlock(settings.executionFolderPath, preferences.webullSimFolderPath)
  if (!simRoot) {
    return {
      simRoot: '',
      configured: false,
      model: EMPTY_MODEL_BLOCK,
      warnings: ['Set the Sim folder path (or the execution folder path) in Settings → Webull to locate the Sim data.'],
    }
  }

  const scan = await scanWebullSimVaultBlock(simRoot)
  const model = buildWebullSimTimelineModelBlock({
    cases: scan.cases,
    bench: scan.bench,
    eras: scan.eras,
  })
  return { simRoot, configured: true, model, warnings: scan.warnings }
}
