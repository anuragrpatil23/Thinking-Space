import { useSearchParams } from 'react-router-dom'
import SettingsOrch, { type SettingsTabWithProfileId } from '@/components/orchestrators/SettingsOrch'
import type {
  ExplorerFolderColorPreferenceBlock,
  ExplorerIconStyleBlock,
} from '@/services/orchestrators/vaultUiPreferencesOrch'
import type { SchedulerSettingsBlock } from '@/services/orchestrators/schedulerSettingsOrch'

interface SettingsPageProps {
  explorerIconStyle: ExplorerIconStyleBlock
  onExplorerIconStyleChange: (nextStyle: ExplorerIconStyleBlock) => void
  explorerFolderColorRules: ExplorerFolderColorPreferenceBlock[]
  onExplorerFolderColorRulesChange: (nextRules: ExplorerFolderColorPreferenceBlock[]) => Promise<void> | void
  explorerSelectedColor: string
  onExplorerSelectedColorChange: (nextColor: string) => void
  schedulerSettings: SchedulerSettingsBlock
  onSchedulerSettingsChange: (nextSettings: SchedulerSettingsBlock) => Promise<void> | void
  onRequestVaultSwitch: () => void
  webullTabLabel?: string
  webullTabIconText?: string
  onWebullTabPreferencesChange?: (label: string, iconText: string) => Promise<void> | void
}

export default function Settings({
  explorerIconStyle,
  onExplorerIconStyleChange,
  explorerFolderColorRules,
  onExplorerFolderColorRulesChange,
  explorerSelectedColor,
  onExplorerSelectedColorChange,
  schedulerSettings,
  onSchedulerSettingsChange,
  onRequestVaultSwitch,
  webullTabLabel,
  webullTabIconText,
  onWebullTabPreferencesChange,
}: SettingsPageProps) {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab: SettingsTabWithProfileId =
    requestedTab === 'profile'
      ? 'profile'
      : requestedTab === 'ai'
        ? 'ai'
        : requestedTab === 'webull'
          ? 'webull'
          : requestedTab === 'google-docs-sheets'
            ? 'google_docs_sheets'
          : requestedTab === 'explorer'
            ? 'explorer'
          : requestedTab === 'activity'
            ? 'activity'
          : requestedTab === 'scheduler'
            ? 'scheduler'
          : requestedTab === 'cache'
            ? 'cache'
            : requestedTab === 'vault'
              ? 'vault'
            : requestedTab === 'workspace_profiles'
              ? 'workspace_profiles'
            : requestedTab === 'navigation'
              ? 'navigation'
              : 'theme'

  return (
    // h-full pins the page to the shell's viewport box so the outer app scroller
    // never engages — the sidebar and the detail pane then scroll independently
    // (app chrome), instead of the whole page sliding as one web document.
    <div className="ltm-page h-full">
      <SettingsOrch
        explorerIconStyle={explorerIconStyle}
        onExplorerIconStyleChange={onExplorerIconStyleChange}
        explorerFolderColorRules={explorerFolderColorRules}
        onExplorerFolderColorRulesChange={onExplorerFolderColorRulesChange}
        explorerSelectedColor={explorerSelectedColor}
        onExplorerSelectedColorChange={onExplorerSelectedColorChange}
        schedulerSettings={schedulerSettings}
        onSchedulerSettingsChange={onSchedulerSettingsChange}
        onRequestVaultSwitch={onRequestVaultSwitch}
        initialTab={initialTab}
        webullTabLabel={webullTabLabel}
        webullTabIconText={webullTabIconText}
        onWebullTabPreferencesChange={onWebullTabPreferencesChange}
      />
    </div>
  )
}
