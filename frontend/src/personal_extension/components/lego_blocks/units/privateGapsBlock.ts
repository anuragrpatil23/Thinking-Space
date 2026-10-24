import { lazy, type ComponentType } from 'react'

// The Gaps tab lives in a private folder (personal_extension/gaps) that is not
// part of the public repo. When the folder is present the tab is shown; when it
// is missing, this glob matches nothing and the tab is simply left out.
const GAPS_MODULES = import.meta.glob<{ default: ComponentType }>('../../../gaps/index.ts')
const loadGaps = Object.values(GAPS_MODULES)[0]

export const GAPS_TAB_AVAILABLE = Boolean(loadGaps)
export const PrivateGapsBlock = loadGaps ? lazy(loadGaps) : null

// The company page's gaps section lives in the same private folder; without it
// the page simply has no gaps section.
const COMPANY_GAPS_MODULES = import.meta.glob<{ default: ComponentType<PrivateCompanyGapsPropsBlock> }>('../../../gaps/companyGaps.tsx')
const loadCompanyGaps = Object.values(COMPANY_GAPS_MODULES)[0]

export interface PrivateCompanyGapsPropsBlock {
  ticker: string
  executionRoot: string
  onOpenFile: (path: string) => void
}

export const PrivateCompanyGapsBlock = loadCompanyGaps ? lazy(loadCompanyGaps) : null

// Noticed (things seen happening, before they are gaps) lives in the same
// private folder: its own F9 view, and a section on the company page.
const NOTICED_MODULES = import.meta.glob<{ default: ComponentType }>('../../../gaps/noticed.tsx')
const loadNoticed = Object.values(NOTICED_MODULES)[0]
export const NOTICED_TAB_AVAILABLE = Boolean(loadNoticed)
export const PrivateNoticedBlock = loadNoticed ? lazy(loadNoticed) : null

const COMPANY_NOTICED_MODULES = import.meta.glob<{ default: ComponentType<PrivateCompanyGapsPropsBlock> }>('../../../gaps/companyNoticed.tsx')
const loadCompanyNoticed = Object.values(COMPANY_NOTICED_MODULES)[0]
export const PrivateCompanyNoticedBlock = loadCompanyNoticed ? lazy(loadCompanyNoticed) : null

// Sim (replays: the loop at a moment in history) lives in the same private
// folder, all of it; without it there is no Sim tab.
const SIM_MODULES = import.meta.glob<{ default: ComponentType }>('../../../gaps/sim.tsx')
const loadSim = Object.values(SIM_MODULES)[0]
export const PrivateSimBlock = loadSim ? lazy(loadSim) : null

export const SIM_TAB_AVAILABLE = Boolean(loadSim)

// Study (every company studied: its table and timeline) is private too. The
// study records it reads stay public, for the sidebar and the company page.
const STUDY_MODULES = import.meta.glob<{ default: ComponentType }>('../../../gaps/study.tsx')
const loadStudy = Object.values(STUDY_MODULES)[0]
export const STUDY_TAB_AVAILABLE = Boolean(loadStudy)
export const PrivateStudyBlock = loadStudy ? lazy(loadStudy) : null
