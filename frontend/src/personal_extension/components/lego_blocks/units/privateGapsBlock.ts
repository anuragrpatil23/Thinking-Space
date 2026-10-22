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
