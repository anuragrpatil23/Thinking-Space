import { useEffect, useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { SETTINGS_CONTROL_CLASS_BLOCK } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { useWebullAccountNamesBlock } from '@/personal_extension/components/lego_blocks/hooks/useWebullAccountNamesBlock'
import { setWebullAccountNameBlock } from '@/personal_extension/services/lego_blocks/integrations/webullAccountNamesVaultBlock'
import type { WebullAccountNameBlock } from '@/personal_extension/services/lego_blocks/units/webullAccountNamesBlock'
import { cn } from '@/lib/utils'

function AccountNameRowBlock({ account, executionRoot }: { account: WebullAccountNameBlock; executionRoot: string }) {
  const saved = account.custom ? account.name : ''
  const [draft, setDraft] = useState(saved)
  useEffect(() => { setDraft(saved) }, [saved])
  const number = account.accountNumber
  const save = () => {
    if (!number || draft.trim() === saved) return
    void setWebullAccountNameBlock(executionRoot, number, draft)
  }
  return (
    <SettingsRowBlock
      label={account.name}
      description={`${number ?? account.accountId ?? ''}${account.custom ? ` · Webull calls it ${account.automaticName}` : ''}`}
      control={(
        <input
          type="text"
          value={draft}
          disabled={!number}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder={account.automaticName}
          aria-label={`Name for account ${number ?? ''}`}
          className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-[220px]')}
        />
      )}
    />
  )
}

/**
 * Settings → Webull → Accounts: what each account is called across the app.
 * Blank uses the name from Webull's account type.
 */
export function WebullAccountNamesSettingsRowBlock({ executionFolderPath }: { executionFolderPath: string }) {
  const root = executionFolderPath.trim()
  const { accounts } = useWebullAccountNamesBlock(root || null)
  if (!root) return null
  return (
    <SettingsGroupBlock heading="Accounts" description="What each Webull account is called everywhere in the app. Leave a name blank to use the one from Webull's account type.">
      {accounts.length === 0
        ? <SettingsRowBlock label="No accounts yet" description="They appear after the first Webull sync." />
        : accounts.map(a => <AccountNameRowBlock key={a.accountNumber ?? a.accountId ?? a.name} account={a} executionRoot={root} />)}
    </SettingsGroupBlock>
  )
}
