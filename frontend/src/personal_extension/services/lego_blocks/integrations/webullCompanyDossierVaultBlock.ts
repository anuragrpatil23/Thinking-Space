// Gather one company's page from the vault: its study record, observations,
// price history and Value Line issues (under F9-execution), plus its research folder
// (ValueLine reports, earnings calls, launches, thoughts) under
// "Thoughts, Predictions, launches and Postmortem". Read-only.

import { getFileContent, listFolderEntries } from '@/services/orchestrators/fileSystemOrch'
import { parseWebullStudyRecordBlock, type WebullStudyRecordBlock } from '../units/webullStudyRecordBlock'
import {
  isValueLineFolderBlock,
  VALUE_LINE_FOLDER_NAME_BLOCK,
  parseResearchDateKeyBlock,
  parseWebullObservationsBlock,
  parseWebullPriceSeriesBlock,
  researchFolderMatchesBlock,
  sortResearchFilesBlock,
  type WebullObservationEntryBlock,
  type WebullPricePointBlock,
  type WebullResearchFileBlock,
  type WebullResearchGroupBlock,
} from '../units/webullCompanyDossierBlock'

export const WEBULL_RESEARCH_FOLDER_NAME_BLOCK = 'Thoughts, Predictions, launches and Postmortem'
export const ADDITIONAL_COMPANIES_FOLDER_BLOCK = 'Additional companies'
const SKIPPED_RESEARCH_FOLDERS_BLOCK = new Set(['images', 'attachments', 'assets'])

export interface WebullCompanyDossierBlock {
  ticker: string
  study: WebullStudyRecordBlock | null
  /** The company's name, from the study record's `company` field. */
  companyName: string | null
  observationsPath: string | null
  observations: WebullObservationEntryBlock[]
  prices: WebullPricePointBlock[]
  researchFolderPath: string | null
  valueLineReports: WebullResearchFileBlock[]
  researchGroups: WebullResearchGroupBlock[]
  warnings: string[]
}

const EMPTY_ENTRIES_BLOCK = { folders: [] as string[], files: [] as string[] }

async function readTextBlock(path: string): Promise<string | null> {
  try {
    return (await getFileContent(path)).content
  } catch {
    return null
  }
}

async function findStudyRecordBlock(executionRoot: string, ticker: string): Promise<WebullStudyRecordBlock | null> {
  // Held companies keep the study in their own folder; watch-only ones under watchlist/<ticker>/.
  for (const folder of [`${executionRoot}/${ticker}`, `${executionRoot}/watchlist/${ticker.toLowerCase()}`]) {
    const { files } = await listFolderEntries(folder).catch(() => EMPTY_ENTRIES_BLOCK)
    const expected = `${ticker.toLowerCase()}-study.md`
    const fileName = files.find(f => f.toLowerCase() === expected) ?? files.find(f => f.toLowerCase().endsWith('-study.md'))
    if (!fileName) continue
    const filePath = `${folder}/${fileName}`
    const content = await readTextBlock(filePath)
    const record = content ? parseWebullStudyRecordBlock({ filePath, fileName, content }) : null
    if (record) return record
  }
  return null
}

async function findResearchFolderBlock(researchRoot: string, ticker: string, companyName: string | null): Promise<string | null> {
  const top = await listFolderEntries(researchRoot).catch(() => EMPTY_ENTRIES_BLOCK)
  const direct = top.folders.find(folder => folder !== ADDITIONAL_COMPANIES_FOLDER_BLOCK && researchFolderMatchesBlock(folder, ticker, companyName))
  if (direct) return `${researchRoot}/${direct}`
  const extraRoot = `${researchRoot}/${ADDITIONAL_COMPANIES_FOLDER_BLOCK}`
  const extra = await listFolderEntries(extraRoot).catch(() => EMPTY_ENTRIES_BLOCK)
  const match = extra.folders.find(folder => researchFolderMatchesBlock(folder, ticker, companyName))
  return match ? `${extraRoot}/${match}` : null
}

function toResearchFileBlock(folder: string, name: string): WebullResearchFileBlock {
  return { path: `${folder}/${name}`, name: name.replace(/\.(md|pdf)$/i, ''), dateKey: parseResearchDateKeyBlock(name) }
}

/** Markdown/PDF files in a folder and its direct subfolders (launches/earnings, launches/momentum events). */
async function collectResearchFilesBlock(folder: string, depth: number): Promise<WebullResearchFileBlock[]> {
  const entries = await listFolderEntries(folder).catch(() => EMPTY_ENTRIES_BLOCK)
  const files = entries.files
    .filter(name => /\.(md|pdf)$/i.test(name))
    .map(name => toResearchFileBlock(folder, name))
  if (depth > 0) {
    for (const sub of entries.folders) {
      if (SKIPPED_RESEARCH_FOLDERS_BLOCK.has(sub.toLowerCase())) continue
      files.push(...await collectResearchFilesBlock(`${folder}/${sub}`, depth - 1))
    }
  }
  return files
}

async function loadResearchBlock(folder: string): Promise<{ valueLineReports: WebullResearchFileBlock[]; groups: WebullResearchGroupBlock[] }> {
  const entries = await listFolderEntries(folder).catch(() => EMPTY_ENTRIES_BLOCK)
  const valueLineReports: WebullResearchFileBlock[] = []
  const groups: WebullResearchGroupBlock[] = []
  for (const sub of entries.folders) {
    if (SKIPPED_RESEARCH_FOLDERS_BLOCK.has(sub.toLowerCase())) continue
    const files = await collectResearchFilesBlock(`${folder}/${sub}`, 1)
    if (isValueLineFolderBlock(sub)) {
      valueLineReports.push(...files.filter(file => file.path.toLowerCase().endsWith('.pdf')))
    } else if (files.length > 0) {
      groups.push({ label: sub, files: sortResearchFilesBlock(files) })
    }
  }
  const loose = entries.files.filter(name => /\.md$/i.test(name)).map(name => toResearchFileBlock(folder, name))
  if (loose.length > 0) groups.push({ label: 'Boards & notes', files: sortResearchFilesBlock(loose) })
  return { valueLineReports: sortResearchFilesBlock(valueLineReports), groups }
}

export async function loadWebullCompanyDossierBlock(params: {
  executionRoot: string
  ticker: string
  companyName: string | null
}): Promise<WebullCompanyDossierBlock> {
  const executionRoot = params.executionRoot.trim().replace(/\/+$/, '')
  const ticker = params.ticker.trim().toUpperCase()
  const companyFolder = `${executionRoot}/${ticker}`
  const researchRoot = `${executionRoot.replace(/\/[^/]+$/, '')}/${WEBULL_RESEARCH_FOLDER_NAME_BLOCK}`
  const warnings: string[] = []

  // Without a ticker (a research-only company) there is no company folder to read.
  const [study, observationsText, pricesText, valueLineFiles] = ticker
    ? await Promise.all([
        findStudyRecordBlock(executionRoot, ticker),
        readTextBlock(`${companyFolder}/observations.md`),
        readTextBlock(`${companyFolder}/prices.csv`),
        listFolderEntries(`${companyFolder}/${VALUE_LINE_FOLDER_NAME_BLOCK}`).then(e => e.files).catch(() => [] as string[]),
      ])
    : [null, null, null, [] as string[]]
  const companyName = study?.company ?? params.companyName
  const researchFolderPath = await findResearchFolderBlock(researchRoot, ticker, companyName)
  const research = researchFolderPath
    ? await loadResearchBlock(researchFolderPath)
    : { valueLineReports: [], groups: [] }

  return {
    ticker,
    study,
    companyName,
    observationsPath: observationsText === null ? null : `${companyFolder}/observations.md`,
    observations: observationsText ? parseWebullObservationsBlock(observationsText) : [],
    prices: pricesText ? parseWebullPriceSeriesBlock(pricesText) : [],
    researchFolderPath,
    // Issues in F9-execution/<TICKER>/valueline/ first; any still in an old research folder too
    valueLineReports: sortResearchFilesBlock([
      ...valueLineFiles.filter(name => /\.pdf$/i.test(name)).map(name => toResearchFileBlock(`${companyFolder}/${VALUE_LINE_FOLDER_NAME_BLOCK}`, name)),
      ...research.valueLineReports,
    ]),
    researchGroups: research.groups,
    warnings,
  }
}
