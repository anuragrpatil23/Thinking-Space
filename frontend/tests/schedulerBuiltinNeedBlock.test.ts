// The built-in launchd agents relaunch the app binary on a timer forever.
// A machine with nothing for them to do must not get them installed.

import { describe, expect, it } from 'vitest'
import {
  needsCatchupAgentBlock,
  needsHeartbeatAgentBlock,
  needsTelegramPollAgentBlock,
} from '../electron/src/lego_blocks/schedulerBuiltinNeedBlock'

type Specs = Parameters<typeof needsCatchupAgentBlock>[0]

function spec(enabled: boolean, kind: string): Specs[number] {
  return { enabled, schedule: { kind } } as unknown as Specs[number]
}

describe('needsCatchupAgentBlock', () => {
  it('is false with no schedules', () => {
    expect(needsCatchupAgentBlock([])).toBe(false)
  })

  it('is false when calendar schedules are all disabled', () => {
    expect(needsCatchupAgentBlock([spec(false, 'calendar')])).toBe(false)
  })

  it('is false for interval-only schedules (launchd handles those itself)', () => {
    expect(needsCatchupAgentBlock([spec(true, 'interval')])).toBe(false)
  })

  it('is true with one enabled calendar schedule', () => {
    expect(needsCatchupAgentBlock([spec(true, 'interval'), spec(true, 'calendar')])).toBe(true)
  })
})

describe('needsTelegramPollAgentBlock', () => {
  it('is false when secrets are missing or unreadable', () => {
    expect(needsTelegramPollAgentBlock(null)).toBe(false)
    expect(needsTelegramPollAgentBlock('nope')).toBe(false)
    expect(needsTelegramPollAgentBlock({})).toBe(false)
  })

  it('is false when either credential is missing', () => {
    expect(needsTelegramPollAgentBlock({ telegram: { bot_token: 't' } })).toBe(false)
    expect(needsTelegramPollAgentBlock({ telegram: { chat_id: 1 } })).toBe(false)
    expect(needsTelegramPollAgentBlock({ telegram: { bot_token: '', chat_id: 1 } })).toBe(false)
  })

  it('is true with both a bot token and a chat id', () => {
    expect(needsTelegramPollAgentBlock({ telegram: { bot_token: 't', chat_id: 1 } })).toBe(true)
  })
})

describe('needsHeartbeatAgentBlock', () => {
  it('is false without Telegram credentials — it would have no way to alert', () => {
    expect(needsHeartbeatAgentBlock(null)).toBe(false)
    expect(needsHeartbeatAgentBlock({ telegram: { bot_token: 't' } })).toBe(false)
  })

  it('is true with both a bot token and a chat id', () => {
    expect(needsHeartbeatAgentBlock({ telegram: { bot_token: 't', chat_id: 1 } })).toBe(true)
  })
})
