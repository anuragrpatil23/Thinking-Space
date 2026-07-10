// Scan the f9-sim folder for the Sim timeline dataset.
//
// Layout (see kai-workspace/F9/f9-sim-tab-build-spec.md), all under <simRoot>:
//   eras.yaml                                   — era band
//   bench.md                                    — candidate table (hollow marks)
//   cases/<company-slug>/<file>.md              — one staged rep per file
//
// Skip rules while walking cases/:
//   *-patterns.md  — per-company cross-case notes (not reps)
//   pair-*.md      — paired-choice files at the cases/ root
//
// Read-only: this never writes to the vault.

import { getFileContent, listFolderEntries } from '@/services/orchestrators/fileSystemOrch'
import {
  isSimNonRepFileNameBlock,
  parseWebullSimBenchBlock,
  parseWebullSimCaseBlock,
  parseWebullSimErasBlock,
  type WebullSimBenchEntryBlock,
  type WebullSimCaseBlock,
  type WebullSimEraBlock,
} from '../units/webullSimRecordBlock'

interface FolderEntriesBlock {
  folders: string[]
  files: string[]
}

const EMPTY_FOLDER_ENTRIES_BLOCK: FolderEntriesBlock = { folders: [], files: [] }

export interface WebullSimVaultScanBlock {
  simRoot: string
  cases: WebullSimCaseBlock[]
  bench: WebullSimBenchEntryBlock[]
  eras: WebullSimEraBlock[]
  warnings: string[]
}

async function readFileTextBlock(filePath: string, warnings: string[]): Promise<string | null> {
  try {
    const { content } = await getFileContent(filePath)
    return content
  } catch (err) {
    warnings.push(`failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

export async function scanWebullSimVaultBlock(simRoot: string): Promise<WebullSimVaultScanBlock> {
  const trimmedRoot = simRoot.trim().replace(/\/+$/, '')
  const warnings: string[] = []
  const cases: WebullSimCaseBlock[] = []

  if (!trimmedRoot) {
    return { simRoot: '', cases: [], bench: [], eras: [], warnings: ['sim root not configured'] }
  }

  const rootEntries = await listFolderEntries(trimmedRoot).catch(() => EMPTY_FOLDER_ENTRIES_BLOCK)
  if (rootEntries.folders.length === 0 && rootEntries.files.length === 0) {
    warnings.push(`sim root has no entries (path may not exist): ${trimmedRoot}`)
  }

  // 1) Era band.
  let eras: WebullSimEraBlock[] = []
  if (rootEntries.files.some((f) => f.toLowerCase() === 'eras.yaml')) {
    const erasText = await readFileTextBlock(`${trimmedRoot}/eras.yaml`, warnings)
    if (erasText) {
      eras = parseWebullSimErasBlock(erasText)
      if (eras.length === 0) warnings.push('eras.yaml parsed but produced no eras')
    }
  } else {
    warnings.push('eras.yaml not found in sim root')
  }

  // 2) Bench candidates.
  let bench: WebullSimBenchEntryBlock[] = []
  if (rootEntries.files.some((f) => f.toLowerCase() === 'bench.md')) {
    const benchText = await readFileTextBlock(`${trimmedRoot}/bench.md`, warnings)
    if (benchText) bench = parseWebullSimBenchBlock(benchText)
  }

  // 3) Staged reps under cases/<company-slug>/*.md.
  if (rootEntries.folders.includes('cases')) {
    const casesRoot = `${trimmedRoot}/cases`
    const casesEntries = await listFolderEntries(casesRoot).catch(() => EMPTY_FOLDER_ENTRIES_BLOCK)
    for (const companySlug of casesEntries.folders) {
      const companyEntries = await listFolderEntries(`${casesRoot}/${companySlug}`).catch(() => EMPTY_FOLDER_ENTRIES_BLOCK)
      for (const file of companyEntries.files) {
        if (isSimNonRepFileNameBlock(file)) continue
        const filePath = `${casesRoot}/${companySlug}/${file}`
        const content = await readFileTextBlock(filePath, warnings)
        if (content === null) continue
        const parsed = parseWebullSimCaseBlock({ filePath, companySlug, content })
        if (parsed) cases.push(parsed)
        else warnings.push(`skipped (no parseable moment_date/frontmatter): ${filePath}`)
      }
    }
  } else {
    warnings.push('cases/ folder not found in sim root')
  }

  return { simRoot: trimmedRoot, cases, bench, eras, warnings }
}
