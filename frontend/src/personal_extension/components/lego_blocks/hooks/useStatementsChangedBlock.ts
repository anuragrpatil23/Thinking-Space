import { useEffect, useRef } from 'react'
import { subscribeExternalVaultChangesBlock } from '@/services/lego_blocks/integrations/vaultExternalChangeBlock'

/**
 * Calls back when the statements folder changes outside the app: an agent
 * reading new PDFs into the CSVs, a sync from another device. Changes come in
 * bursts (several CSVs rewritten in a row), so it waits for them to settle.
 * With `checkOnFocus`, coming back to the window checks again too, in case the
 * watcher missed it (for cheap reads only: it runs on every focus).
 */
export function useStatementsChangedBlock(executionRoot: string | null, onChanged: () => void, checkOnFocus = false): void {
  const callback = useRef(onChanged)
  callback.current = onChanged
  useEffect(() => {
    if (!executionRoot) return
    const folder = `${executionRoot.replace(/\/+$/, '')}/statements/`
    let timer: number | null = null
    const later = (ms: number) => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => { timer = null; callback.current() }, ms)
    }
    const stop = subscribeExternalVaultChangesBlock((change) => {
      if (change.relPath?.startsWith(folder)) later(1200)
    })
    const onFocus = () => later(200)
    if (checkOnFocus) window.addEventListener('focus', onFocus)
    return () => {
      stop()
      window.removeEventListener('focus', onFocus)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [executionRoot, checkOnFocus])
}
