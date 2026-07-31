import { createSidebarChromeBlock, type SidebarChromeStateBlock } from './sidebarChromeBlock'

export interface WebSidebarChromeStateBlock extends SidebarChromeStateBlock {
  headerVisible: boolean
  showHeaderToggle: boolean
  siteLabels?: Record<string, string>
}

const block = createSidebarChromeBlock<WebSidebarChromeStateBlock>('web')

export const WEB_SIDEBAR_CHROME_STATE_EVENT_BLOCK = block.stateEvent
export const WEB_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK = block.toggleEvent
export const WEB_SIDEBAR_CHROME_TOGGLE_HEADER_EVENT_BLOCK = block.toggleHeaderEvent

export const dispatchWebSidebarChromeStateBlock = block.dispatchState
export const dispatchWebSidebarChromeToggleBlock = block.dispatchToggle
export const dispatchWebSidebarChromeToggleHeaderBlock = block.dispatchToggleHeader

export const webSidebarChromeBlock = block

// New Note had a `new-thought` sidebar chrome channel until 2026-07-31. It is
// gone: the tab is now a single full-bleed iA-Writer-style writing surface with
// no side panel, so there is nothing for the native/web chrome button to toggle.
