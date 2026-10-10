import { useCallback, useEffect, useState } from 'react'
import type { AiLimitsProviderBlock } from '@/services/lego_blocks/units/aiLimitsModelBlock'
import { addGlobalSyncRefreshListenerBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'

/**
 * What Claude Code's status line currently is. Decides which setup instruction
 * the card can safely show — see `AiLimitsStripBlock`.
 */
export type ClaudeStatusLineModeBlock = 'none' | 'ours' | 'theirs'

interface AiPlanUsageStateBlock {
  providers: AiLimitsProviderBlock[]
  statusLineScriptPath: string
  statusLineMode: ClaudeStatusLineModeBlock
  /**
   * Live clock, ticked once a minute while the window is visible. Countdowns
   * read from it, so they do not sit frozen at the value they had when the
   * data last arrived.
   */
  nowMs: number
}

/**
 * Plan usage for the AI tools installed on this machine.
 *
 * Reads through Electron IPC; on web/iOS there is no local Codex app-server or
 * status-line file to read, so the hook returns nothing and the card hides
 * itself rather than showing an error for a platform where the feature can't
 * exist.
 *
 * No polling timer. A reading is taken on mount, whenever the window regains
 * focus — coming back to the app is exactly when a stale figure matters, and it
 * keeps this off a periodic wake (ENERGY.md) — and when the top chrome's
 * Refresh is pressed. That button is the manual refresh for everything on the
 * page; the meters had an "Updated 2m ago · refresh" line of their own first,
 * a second refresh control for one section.
 */
export function useAiPlanUsageBlock(): AiPlanUsageStateBlock {
  const [providers, setProviders] = useState<AiLimitsProviderBlock[]>([])
  const [statusLineScriptPath, setStatusLineScriptPath] = useState('')
  const [statusLineMode, setStatusLineMode] = useState<ClaudeStatusLineModeBlock>('none')
  const [nowMs, setNowMs] = useState(() => Date.now())

  const refresh = useCallback(() => {
    const read = window.electronAPI?.aiPlanUsageRead
    if (!read) return
    void read()
      .then((next) => {
        setProviders(next.providers)
        setStatusLineScriptPath(next.statusLineScriptPath)
        setStatusLineMode(next.statusLineMode)
        setNowMs(Date.now())
      })
      .catch(() => {
        // Main-process read failed. Keep the last good reading rather than
        // blanking the card — a stale figure beats a flicker to empty.
      })
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = (): void => refresh()
    window.addEventListener('focus', onFocus)
    const removeGlobalRefresh = addGlobalSyncRefreshListenerBlock(refresh)
    return () => {
      window.removeEventListener('focus', onFocus)
      removeGlobalRefresh()
    }
  }, [refresh])

  // Minute clock for the displayed times only — it re-renders text, it never
  // re-reads. Gated on page visibility and torn down with the card, so a
  // backgrounded or closed window wakes nothing (ENERGY.md forbids timers that
  // run unconditionally, not ones that stop when nobody is looking).
  useEffect(() => {
    let timer: number | undefined

    const stop = (): void => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
    }
    const start = (): void => {
      if (timer !== undefined) return
      timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    }
    const sync = (): void => {
      if (document.visibilityState === 'visible') {
        setNowMs(Date.now())
        start()
      } else {
        stop()
      }
    }

    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  return { providers, statusLineScriptPath, statusLineMode, nowMs }
}
