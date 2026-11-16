// The accounts Webull last sent (overall.json in the execution folder) and the
// names the operator gave them (account-names.json beside it). Kept in the
// vault so the names roam with it to every device.
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseAccountNamesBlock,
  resolveAccountNamesBlock,
  serializeAccountNamesBlock,
  type WebullAccountIdentityBlock,
  type WebullAccountNameBlock,
} from '../units/webullAccountNamesBlock'

/** Fired on window when an account is renamed. */
export const ACCOUNT_NAMES_CHANGED_EVENT_BLOCK = 'f9:account-names-changed'

const rootOf = (executionRoot: string) => executionRoot.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const namesPath = (root: string) => `${root}/account-names.json`

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** The accounts in the last Webull sync, in the order Webull sent them. */
async function syncedAccountsBlock(root: string): Promise<WebullAccountIdentityBlock[]> {
  const text = await getVaultFS().read(`${root}/overall.json`).catch(() => null)
  if (!text) return []
  try {
    const j = JSON.parse(text) as { accounts?: Array<{ account?: Record<string, unknown> }>; selected_account?: Record<string, unknown> }
    const raw = (j.accounts ?? []).map(a => a.account).filter((a): a is Record<string, unknown> => Boolean(a))
    if (raw.length === 0 && j.selected_account) raw.push(j.selected_account)
    return raw.map(a => ({
      accountId: str(a.accountId ?? a.account_id),
      accountNumber: str(a.accountNumber ?? a.account_number),
      accountClass: str(a.accountClass ?? a.account_class),
      accountLabel: str(a.accountLabel ?? a.account_label),
    }))
  } catch {
    return []
  }
}

export async function readCustomAccountNamesBlock(executionRoot: string): Promise<Record<string, string>> {
  const root = rootOf(executionRoot)
  if (!root) return {}
  return parseAccountNamesBlock(await getVaultFS().read(namesPath(root)).catch(() => null))
}

/** Every account Webull last sent, with what it is called. */
export async function loadWebullAccountNamesBlock(executionRoot: string): Promise<WebullAccountNameBlock[]> {
  const root = rootOf(executionRoot)
  if (!root) return []
  const [accounts, custom] = await Promise.all([syncedAccountsBlock(root), readCustomAccountNamesBlock(root)])
  return resolveAccountNamesBlock(accounts, custom)
}

/** Name an account (by its number); a blank name goes back to the automatic one. */
export async function setWebullAccountNameBlock(executionRoot: string, accountNumber: string, name: string): Promise<void> {
  const root = rootOf(executionRoot)
  if (!root || !accountNumber) return
  const custom = await readCustomAccountNamesBlock(root)
  if (name.trim()) custom[accountNumber] = name.trim()
  else delete custom[accountNumber]
  await getVaultFS().write(namesPath(root), serializeAccountNamesBlock(custom))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_NAMES_CHANGED_EVENT_BLOCK))
}
