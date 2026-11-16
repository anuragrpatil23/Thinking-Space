import { useCallback, useEffect, useState } from 'react'
import { ACCOUNT_NAMES_CHANGED_EVENT_BLOCK, loadWebullAccountNamesBlock } from '@/personal_extension/services/lego_blocks/integrations/webullAccountNamesVaultBlock'
import { accountNameOfBlock, type WebullAccountNameBlock } from '@/personal_extension/services/lego_blocks/units/webullAccountNamesBlock'

/**
 * Every Webull account with what it is called, and a lookup by number or id
 * (falling back to what it was given). Read again after a rename, and when
 * `refreshKey` changes (a new sync).
 */
export function useWebullAccountNamesBlock(executionRoot: string | null, refreshKey?: string | null): {
  accounts: WebullAccountNameBlock[]
  nameOf: (idOrNumber: string | null | undefined) => string
} {
  const [accounts, setAccounts] = useState<WebullAccountNameBlock[]>([])
  const [changes, setChanges] = useState(0)
  useEffect(() => {
    const onChanged = () => setChanges(n => n + 1)
    window.addEventListener(ACCOUNT_NAMES_CHANGED_EVENT_BLOCK, onChanged)
    return () => window.removeEventListener(ACCOUNT_NAMES_CHANGED_EVENT_BLOCK, onChanged)
  }, [])
  useEffect(() => {
    if (!executionRoot) { setAccounts([]); return }
    let cancelled = false
    void loadWebullAccountNamesBlock(executionRoot).then(next => { if (!cancelled) setAccounts(next) }).catch(() => { if (!cancelled) setAccounts([]) })
    return () => { cancelled = true }
  }, [executionRoot, refreshKey, changes])
  const nameOf = useCallback((idOrNumber: string | null | undefined) => accountNameOfBlock(accounts, idOrNumber) ?? (idOrNumber ?? '').trim(), [accounts])
  return { accounts, nameOf }
}
