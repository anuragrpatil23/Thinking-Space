import { useSearchParams } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'
import SettingsOrch, { type SettingsTabWithProfileId } from '@/components/orchestrators/SettingsOrch'
import type {
  ExplorerFolderColorPreferenceBlock,
  ExplorerIconStyleBlock,
} from '@/services/orchestrators/vaultUiPreferencesOrch'
import type { ThinkingSpaceRegistryEntryOrch } from '@/services/orchestrators/spaceRegistryOrch'

interface SettingsPageProps {
  explorerIconStyle: ExplorerIconStyleBlock
  onExplorerIconStyleChange: (nextStyle: ExplorerIconStyleBlock) => void
  explorerFolderColorRules: ExplorerFolderColorPreferenceBlock[]
  onExplorerFolderColorRulesChange: (nextRules: ExplorerFolderColorPreferenceBlock[]) => Promise<void> | void
  onRequestVaultSwitch: () => void
  activeSpaceId: string
  thinkingSpaces: ThinkingSpaceRegistryEntryOrch[]
  onSwitchThinkingSpace: (spaceId: string) => void
}

export default function Settings({
  explorerIconStyle,
  onExplorerIconStyleChange,
  explorerFolderColorRules,
  onExplorerFolderColorRulesChange,
  onRequestVaultSwitch,
  activeSpaceId,
  thinkingSpaces,
  onSwitchThinkingSpace,
}: SettingsPageProps) {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab: SettingsTabWithProfileId =
    requestedTab === 'profile'
      ? 'profile'
      : requestedTab === 'ai'
        ? 'ai'
        : requestedTab === 'f9'
          ? 'f9'
          : requestedTab === 'google-docs-sheets'
            ? 'google_docs_sheets'
          : requestedTab === 'explorer'
            ? 'explorer'
          : requestedTab === 'cache'
            ? 'cache'
            : requestedTab === 'vault'
              ? 'vault'
              : 'theme'

  return (
    <div className="ltm-page">
      <div className="ltm-page-shell ltm-shell-wide space-y-4">
        <header className="shrink-0">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <SlidersHorizontal className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage profile, theme, markdown editor behavior, AI configuration, F9 execution storage, cache reset, and Thinking Space switching.
              </p>
            </div>
          </div>
        </header>
        <SettingsOrch
          explorerIconStyle={explorerIconStyle}
          onExplorerIconStyleChange={onExplorerIconStyleChange}
          explorerFolderColorRules={explorerFolderColorRules}
          onExplorerFolderColorRulesChange={onExplorerFolderColorRulesChange}
          onRequestVaultSwitch={onRequestVaultSwitch}
          activeSpaceId={activeSpaceId}
          thinkingSpaces={thinkingSpaces}
          onSwitchThinkingSpace={onSwitchThinkingSpace}
          initialTab={initialTab}
        />
      </div>
    </div>
  )
}
