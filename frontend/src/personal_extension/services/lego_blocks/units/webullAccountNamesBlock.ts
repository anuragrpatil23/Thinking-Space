// What each Webull account is called. Webull sends each account's type
// (INDIVIDUAL_CASH, ROTH_IRA…) with the positions; that gives the name unless
// the operator has named the account in Settings → Webull → Accounts. The
// account number stays the key everywhere (files, statements, gap logs), so
// renaming an account never touches a record.

/** Names for Webull's account types. */
const ACCOUNT_CLASS_NAMES_BLOCK: Record<string, string> = {
  INDIVIDUAL_CASH: 'Individual Cash',
  INDIVIDUAL_MARGIN: 'Individual Margin',
  MARGIN: 'Margin',
  ROTH_IRA: 'Roth IRA',
  TRADITIONAL_IRA: 'Traditional IRA',
  ROLLOVER_IRA: 'Rollover IRA',
}

export interface WebullAccountIdentityBlock {
  accountId: string | null
  accountNumber: string | null
  accountClass: string | null
  /** Webull's own label for it, when it sends one. */
  accountLabel: string | null
}

export interface WebullAccountNameBlock extends WebullAccountIdentityBlock {
  /** What it is called: the operator's name, else the automatic one. */
  name: string
  /** From Webull's account type or label, or "Account 2" when it sends neither. */
  automaticName: string
  /** The operator named it. */
  custom: boolean
}

/** The name Webull's data gives an account, or null when it gives none. */
export function automaticAccountNameBlock(a: Pick<WebullAccountIdentityBlock, 'accountClass' | 'accountLabel'>): string | null {
  const cls = (a.accountClass ?? '').trim().toUpperCase()
  if (cls && ACCOUNT_CLASS_NAMES_BLOCK[cls]) return ACCOUNT_CLASS_NAMES_BLOCK[cls]
  const label = (a.accountLabel ?? '').trim()
  return label || null
}

/** account-names.json: { "<account number>": "<name>" }. Anything else is ignored. */
export function parseAccountNamesBlock(text: string | null): Record<string, string> {
  if (!text) return {}
  try {
    const j = JSON.parse(text) as unknown
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {}
    return Object.fromEntries(Object.entries(j as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== '')
      .map(([k, v]) => [k, v.trim()]))
  } catch {
    return {}
  }
}

export function serializeAccountNamesBlock(names: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.entries(names).filter(([, v]) => v.trim()).sort(([a], [b]) => a.localeCompare(b)))
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/** Each account, once, with what it is called. */
export function resolveAccountNamesBlock(accounts: WebullAccountIdentityBlock[], custom: Record<string, string>): WebullAccountNameBlock[] {
  const out: WebullAccountNameBlock[] = []
  const seen = new Set<string>()
  for (const a of accounts) {
    const key = a.accountNumber || a.accountId
    if (!key || seen.has(key)) continue
    seen.add(key)
    const automaticName = automaticAccountNameBlock(a) ?? `Account ${out.length + 1}`
    const own = (a.accountNumber && custom[a.accountNumber]) || (a.accountId && custom[a.accountId]) || ''
    out.push({ ...a, automaticName, name: own || automaticName, custom: Boolean(own) })
  }
  return out
}

/** The account's name, by its number or id; null when it is not one of them. */
export function accountNameOfBlock(names: WebullAccountNameBlock[], idOrNumber: string | null | undefined): string | null {
  const v = (idOrNumber ?? '').trim()
  if (!v) return null
  return names.find(n => n.accountNumber === v || n.accountId === v)?.name ?? null
}
