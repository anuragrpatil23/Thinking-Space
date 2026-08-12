/**
 * useMoonSceneMessagesBlock — resolves which scheduled moon-scene message (if
 * any) is currently active per speaker. Reloads on the vault-preferences save
 * event and re-evaluates the clock every 30s so windows open/close live.
 */

import { useEffect, useMemo, useState } from 'react'
import { useVisibleIntervalBlock } from './useVisibleIntervalBlock'
import {
  isMoonSceneMessageActiveBlock,
  MOON_SCENE_MESSAGES_UPDATED_EVENT_BLOCK,
  type MoonSceneMessagePreferenceBlock,
  type MoonSceneSpeakerBlock,
} from '@/services/lego_blocks/units/vaultUiPreferencesBlock'
import { readMoonSceneMessagesPreferenceOrch } from '@/services/orchestrators/vaultUiPreferencesOrch'

const CLOCK_TICK_MS = 30_000

export type ActiveMoonSceneMessagesBlock = Partial<
  Record<MoonSceneSpeakerBlock, MoonSceneMessagePreferenceBlock>
>

export function useMoonSceneMessagesBlock(): ActiveMoonSceneMessagesBlock {
  const [messages, setMessages] = useState<MoonSceneMessagePreferenceBlock[]>([])
  const [clockKey, setClockKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void readMoonSceneMessagesPreferenceOrch()
        .then(next => {
          if (!cancelled) setMessages(next)
        })
        .catch(() => {
          /* keep current messages */
        })
    }
    load()
    window.addEventListener(MOON_SCENE_MESSAGES_UPDATED_EVENT_BLOCK, load)
    return () => {
      cancelled = true
      window.removeEventListener(MOON_SCENE_MESSAGES_UPDATED_EVENT_BLOCK, load)
    }
  }, [])

  useVisibleIntervalBlock(() => setClockKey(k => k + 1), CLOCK_TICK_MS)

  return useMemo(() => {
    void clockKey
    const now = new Date()
    const active: ActiveMoonSceneMessagesBlock = {}
    for (const message of messages) {
      if (active[message.speaker]) continue
      if (isMoonSceneMessageActiveBlock(message, now)) {
        active[message.speaker] = message
      }
    }
    return active
  }, [messages, clockKey])
}
