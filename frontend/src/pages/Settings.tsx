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
    <div className="ltm-page">
      <SettingsOrch
        explorerIconStyle={explorerIconStyle}
        onExplorerIconStyleChange={onExplorerIconStyleChange}
        explorerFolderColorRules={explorerFolderColorRules}
        onExplorerFolderColorRulesChange={onExplorerFolderColorRulesChange}
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
