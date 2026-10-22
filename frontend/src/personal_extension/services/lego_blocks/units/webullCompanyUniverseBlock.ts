// Every company the vault knows about, as one list for the F9 sidebar: what is
// held, what has a study, and what only has a research folder so far. Studied
// or not is the point: the unstudied ones are meant to be seen.

import { researchFolderMatchesBlock } from './webullCompanyDossierBlock'

export type WebullUniverseGroupBlock = 'held' | 'watchlist' | 'researched'
export type WebullStudyStateBlock = 'current' | 'due' | 'none'

export interface WebullUniverseCompanyBlock {
  key: string
  ticker: string | null
  name: string | null
  group: WebullUniverseGroupBlock
  /** Share of held cost basis (0–1); null when not held. */
  costShare: number | null
  studyState: WebullStudyStateBlock
  /** An F9-execution company folder exists (positions, overlay). */
  hasExecutionFolder: boolean
  researchFolderPath: string | null
}

export interface WebullUniverseInputBlock {
  executionCompanies: Array<{ ticker: string; cost: number }>
  studies: Array<{ ticker: string; company: string | null; validThrough: string | null }>
  research: Array<{ name: string; folderPath: string }>
  /** YYYY-MM-DD */
  today: string
}

function looksLikeTickerBlock(name: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,7}$/.test(name)
}

export function buildWebullCompanyUniverseBlock(input: WebullUniverseInputBlock): WebullUniverseCompanyBlock[] {
  const byKey = new Map<string, WebullUniverseCompanyBlock & { cost: number }>()
  const ensure = (ticker: string) => {
    const key = ticker.toUpperCase()
    let entry = byKey.get(key)
    if (!entry) {
      entry = { key, ticker: key, name: null, group: 'researched', costShare: null, studyState: 'none', hasExecutionFolder: false, researchFolderPath: null, cost: 0 }
      byKey.set(key, entry)
    }
    return entry
  }

  for (const company of input.executionCompanies) {
    const entry = ensure(company.ticker)
    entry.hasExecutionFolder = true
    entry.cost += Math.max(0, company.cost)
  }
  for (const study of input.studies) {
    const entry = ensure(study.ticker)
    entry.name = entry.name ?? study.company
    entry.studyState = study.validThrough && study.validThrough < input.today ? 'due' : 'current'
  }
  for (const folder of input.research) {
    if (looksLikeTickerBlock(folder.name)) {
      ensure(folder.name).researchFolderPath = folder.folderPath
      continue
    }
    // A folder named for the company ("Marvell") joins the ticker it names.
    const match = [...byKey.values()].find(entry => entry.ticker && researchFolderMatchesBlock(folder.name, entry.ticker, entry.name))
    if (match) {
      match.researchFolderPath = match.researchFolderPath ?? folder.folderPath
      continue
    }
    byKey.set(`name:${folder.name}`, {
      key: `name:${folder.name}`, ticker: null, name: folder.name, group: 'researched', costShare: null,
      studyState: 'none', hasExecutionFolder: false, researchFolderPath: folder.folderPath, cost: 0,
    })
  }

  const totalCost = [...byKey.values()].reduce((sum, entry) => sum + entry.cost, 0)
  const label = (entry: WebullUniverseCompanyBlock) => (entry.ticker ?? entry.name ?? '').toUpperCase()
  return [...byKey.values()]
    .map(({ cost, ...entry }) => ({
      ...entry,
      group: (cost > 0 ? 'held' : entry.studyState !== 'none' ? 'watchlist' : 'researched') as WebullUniverseGroupBlock,
      costShare: cost > 0 && totalCost > 0 ? cost / totalCost : null,
    }))
    .sort((a, b) => (b.costShare ?? -1) - (a.costShare ?? -1) || label(a).localeCompare(label(b)))
}
