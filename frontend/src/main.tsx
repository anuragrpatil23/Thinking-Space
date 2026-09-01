import './services/lego_blocks/units/promiseWithResolversPolyfillBlock'
import { installConsoleNoiseFilterBlock } from './services/lego_blocks/units/consoleNoiseFilterBlock'
import { enforceIPhoneViewportNoZoomBlock } from './services/lego_blocks/units/iphoneViewportBlock'
import { requestPersistentStorageBlock } from './services/lego_blocks/units/persistentStorageBlock'
import { seedNavRailDefaultsBlock } from './services/lego_blocks/units/navRailPrefsBlock'
import { installReadingTraceConsoleBlock } from './services/lego_blocks/units/readingTraceBlock'
import { drainReadingJournalOrch } from './services/orchestrators/readingJournalDrainOrch'

installConsoleNoiseFilterBlock()
enforceIPhoneViewportNoZoomBlock()
requestPersistentStorageBlock()
// Before the first render, so the rail never flashes the wrong shape. It does
// NOT need to beat the app's other storage writes: a cold boot writes theme,
// color mode, and the shell tab record on its own, and the seeding rule knows
// to discount exactly those.
seedNavRailDefaultsBlock()
installReadingTraceConsoleBlock()
// Recover any sitting the app died holding. Fire-and-forget: it must not delay
// first paint, and an entry that fails to drain stays journalled for next time.
void drainReadingJournalOrch()
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, BrowserRouter } from 'react-router-dom'
import App from './App'
import { MarkdownViewerProvider } from './components/orchestrators/MarkdownViewerOrch'
import { UILayoutProviderBlock } from './components/lego_blocks/integrations/UILayoutBlock'
import { UIThemeProviderBlock } from './components/lego_blocks/units/UIThemeBlock'
import { isElectron, isCapacitorNative } from './services/orchestrators/runtimeOrch'
import './index.css'

// Electron and Capacitor use HashRouter (no server to handle routes).
// Web uses BrowserRouter with /thinking-space.
const isLocalApp = isElectron() || isCapacitorNative()
const Router = isLocalApp ? HashRouter : BrowserRouter
const webBasename = '/thinking-space'
const routerProps = isLocalApp ? {} : { basename: webBasename }
const disableStrictModeForCapacitorDebug = import.meta.env.DEV && isCapacitorNative()

const appTree = (
  <Router {...routerProps}>
    <UIThemeProviderBlock>
      <UILayoutProviderBlock>
        <MarkdownViewerProvider>
          <App />
        </MarkdownViewerProvider>
      </UILayoutProviderBlock>
    </UIThemeProviderBlock>
  </Router>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  disableStrictModeForCapacitorDebug
    ? appTree
    : <React.StrictMode>{appTree}</React.StrictMode>,
)
