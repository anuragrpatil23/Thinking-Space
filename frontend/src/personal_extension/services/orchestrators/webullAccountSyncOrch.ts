// The Webull account pull (positions, balances, every account), as one step F9
// sync runs: every six hours in the background, when Overall Positions opens
// and the last pull is over half an hour old, or when you ask. It writes
// overall.json and the position files, then tells whoever shows them.
//
// It never asks Webull for a new sign-in on its own: that sends a 2FA prompt to
// your phone. When the sign-in has run out it stops and waits for you
// (F9SyncNeedsYouBlock); a pull you ask for may sign in again.

import { readWebullCredentialStatusBlock } from '../lego_blocks/units/webullConfigBlock'
import { webullSignedInBlock } from '../lego_blocks/integrations/webullApiBlock'
import type { SyncWebullExecutionResultBlock } from '../lego_blocks/integrations/webullExecutionStorageBlock'
import { F9SyncNeedsYouBlock } from './f9SyncOrch'
import { syncWebullExecutionFromOverallOrch } from './webullExecutionOrch'
import { fetchWebullOverallSnapshotOrch, type WebullOverallSnapshotOrch } from './webullOverallOrch'

export interface WebullAccountPullBlock {
  snapshot: WebullOverallSnapshotOrch
  execution: SyncWebullExecutionResultBlock | null
  executionError: string | null
}

let last: WebullAccountPullBlock | null = null
const listeners = new Set<(pull: WebullAccountPullBlock) => void>()

/** The latest pull made in this session, for the page that shows it. */
export const readLastWebullPullOrch = () => last

export function subscribeWebullPullOrch(listener: (pull: WebullAccountPullBlock) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function webullAccountAvailableOrch(): boolean {
  return Boolean(window.electronAPI?.isElectron && window.electronAPI.webullCredentialStatus)
}

// A sign-in that has run out, or one waiting on the phone
const SIGN_IN = /token|2FA|sign.?in|credential|unauthori[sz]ed|HTTP 401|HTTP 403/i

/** Pull the account now. `mayAskToSignIn`: only when you asked (it can send a 2FA prompt). */
export async function pullWebullAccountOrch(mayAskToSignIn: boolean): Promise<WebullAccountPullBlock> {
  const credentials = await readWebullCredentialStatusBlock()
  if (!credentials.configured) throw new F9SyncNeedsYouBlock('Add your Webull app key and secret in Settings → Webull.')
  if (!mayAskToSignIn && !(await webullSignedInBlock())) {
    throw new F9SyncNeedsYouBlock('Webull needs you to sign in again. Pull from Webull here and approve the prompt on your phone.')
  }
  let snapshot: WebullOverallSnapshotOrch
  try {
    snapshot = await fetchWebullOverallSnapshotOrch()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (SIGN_IN.test(message)) throw new F9SyncNeedsYouBlock(message)
    throw err
  }
  let execution: SyncWebullExecutionResultBlock | null = null
  let executionError: string | null = null
  try {
    execution = await syncWebullExecutionFromOverallOrch(snapshot)
  } catch (err) {
    executionError = err instanceof Error ? err.message : 'Failed to sync Webull execution files.'
  }
  last = { snapshot, execution, executionError }
  for (const l of listeners) l(last)
  return last
}
