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
import { scanWebullSimVaultBlock } from '../lego_blocks/integrations/webullSimVaultBlock'
import {
  buildWebullSimTimelineModelBlock,
  type WebullSimTimelineModelBlock,
} from '../lego_blocks/units/webullSimRecordBlock'

// The sim lives inside the execution folder, beside gaps/, noticed/ and
// reading/, so F9 has one folder (moved from a sibling F9-sim 2026-10-23).
const SIM_FOLDER_NAME_BLOCK = 'sim'

function normalizeVaultRelativePathBlock(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * The sim folder: `<execution folder>/sim`, e.g.
 * `acceleration_core/F9/F9-execution/sim`. '' when the execution folder isn't set.
 */
export function resolveWebullSimRootBlock(executionFolderPath: string): string {
  const normalized = normalizeVaultRelativePathBlock(executionFolderPath)
  return normalized ? `${normalized}/${SIM_FOLDER_NAME_BLOCK}` : ''
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
  const settings = await readWebullExecutionSettingsOrch()
  const simRoot = resolveWebullSimRootBlock(settings.executionFolderPath)
  if (!simRoot) {
    return {
      simRoot: '',
      configured: false,
      model: EMPTY_MODEL_BLOCK,
      warnings: ['Set the execution folder in Settings → Webull; the Sim lives in its sim/ folder.'],
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
