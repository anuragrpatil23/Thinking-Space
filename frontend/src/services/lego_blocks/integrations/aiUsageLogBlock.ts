// Reads the Claude usage log — the status line's record of the account's
// session and weekly limit percentages over time — from wherever this device
// can reach it.
//
// Two places hold it, and neither is enough alone:
//   - this machine's home directory, over Electron IPC: complete and current,
//     but only this machine's sessions, and absent on iOS / web.
//   - the vault mirror (`aiUsageVaultMirrorBlock`): every machine that opted
//     in, one file per month per machine, but only as fresh as the last sync.
//
// Both are returned concatenated. Limits are account-wide, so another
// machine's rows are not duplicates to discard — they are the readings that
// explain movement this machine did not cause. The rows this machine wrote
// appear in both; `parseClaudeUsageLogBlock` drops the repeats.

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'

/** Where `aiUsageVaultMirrorBlock` lands the Claude usage log in the vault. */
const VAULT_USAGE_DIR_BLOCK = 'ai-activity/raw-sessions/claude/usage'

interface UsageLogApi {
  aiUsageLogRead?: () => Promise<string>
}

async function readHomeUsageLogBlock(): Promise<string> {
  if (typeof window === 'undefined') return ''
  const api = (window as unknown as { electronAPI?: UsageLogApi }).electronAPI
  if (!api?.aiUsageLogRead) return ''
  try {
    return await api.aiUsageLogRead()
  } catch {
    return ''
  }
}

async function readVaultUsageLogBlock(fs: VaultFS): Promise<string> {
  try {
    if (!(await fs.exists(VAULT_USAGE_DIR_BLOCK))) return ''
    const { files } = await fs.list(VAULT_USAGE_DIR_BLOCK)
    const months = await Promise.all(
      files
        .filter(name => name.endsWith('.jsonl'))
        .map(name => fs.read(`${VAULT_USAGE_DIR_BLOCK}/${name}`).catch(() => '')),
    )
    return months.join('\n')
  } catch {
    // The mirror is opt-in; a vault without it is the common case.
    return ''
  }
}

export async function readClaudeUsageLogTextBlock(fs: VaultFS): Promise<string> {
  const [home, vault] = await Promise.all([readHomeUsageLogBlock(), readVaultUsageLogBlock(fs)])
  return `${home}\n${vault}`
}
