import { createSidebarChromeBlock, type SidebarChromeStateBlock } from '@/services/lego_blocks/units/sidebarChromeBlock'

export interface SiResearchSidebarChromeStateBlock extends SidebarChromeStateBlock {}

const block = createSidebarChromeBlock<SiResearchSidebarChromeStateBlock>('si-research')

export const SI_RESEARCH_SIDEBAR_CHROME_STATE_EVENT_BLOCK = block.stateEvent
export const SI_RESEARCH_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK = block.toggleEvent

export const dispatchSiResearchSidebarChromeStateBlock = block.dispatchState
export const dispatchSiResearchSidebarChromeToggleBlock = block.dispatchToggle

export const siResearchSidebarChromeBlock = block
