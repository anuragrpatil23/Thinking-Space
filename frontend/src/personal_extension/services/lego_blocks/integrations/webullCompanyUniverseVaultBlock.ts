// Read the inputs for the company universe: every study record (held folders
// and watchlist) and every research folder under "Thoughts, Predictions,
// launches and Postmortem" (including "Additional companies"). Read-only.

import { listFolderEntries } from '@/services/orchestrators/fileSystemOrch'
import { scanWebullStudyVaultBlock } from './webullStudyVaultBlock'
import { ADDITIONAL_COMPANIES_FOLDER_BLOCK, WEBULL_RESEARCH_FOLDER_NAME_BLOCK } from './webullCompanyDossierVaultBlock'

// Research folders that hold notes across companies, not one company.
const NON_COMPANY_RESEARCH_FOLDERS_BLOCK = new Set(['overall', ADDITIONAL_COMPANIES_FOLDER_BLOCK.toLowerCase()])

export interface WebullCompanyUniverseSourcesBlock {
  studies: Array<{ ticker: string; company: string | null; validThrough: string | null }>
  research: Array<{ name: string; folderPath: string }>
}

const EMPTY_ENTRIES_BLOCK = { folders: [] as string[], files: [] as string[] }

export async function loadWebullCompanyUniverseSourcesBlock(executionRoot: string): Promise<WebullCompanyUniverseSourcesBlock> {
  const root = executionRoot.trim().replace(/\/+$/, '')
  const researchRoot = `${root.replace(/\/[^/]+$/, '')}/${WEBULL_RESEARCH_FOLDER_NAME_BLOCK}`
  const [scan, top, extra] = await Promise.all([
    scanWebullStudyVaultBlock(root).catch(() => ({ records: [] as Awaited<ReturnType<typeof scanWebullStudyVaultBlock>>['records'] })),
    listFolderEntries(researchRoot).catch(() => EMPTY_ENTRIES_BLOCK),
    listFolderEntries(`${researchRoot}/${ADDITIONAL_COMPANIES_FOLDER_BLOCK}`).catch(() => EMPTY_ENTRIES_BLOCK),
  ])
  return {
    studies: scan.records.map(({ record }) => ({ ticker: record.ticker, company: record.company, validThrough: record.validThrough })),
    research: [
      ...top.folders
        .filter(name => !NON_COMPANY_RESEARCH_FOLDERS_BLOCK.has(name.toLowerCase()))
        .map(name => ({ name, folderPath: `${researchRoot}/${name}` })),
      ...extra.folders.map(name => ({ name, folderPath: `${researchRoot}/${ADDITIONAL_COMPANIES_FOLDER_BLOCK}/${name}` })),
    ],
  }
}
