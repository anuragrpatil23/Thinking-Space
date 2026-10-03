// Which built-in launchd agents this machine actually needs.
//
// Every built-in agent re-launches the app binary (Electron-as-Node) on a
// timer, forever, whether the app is open or not. Installing them for someone
// with no schedules and no Telegram bot buys nothing and costs a process
// launch every 30s — and on a build signed without a Team ID, macOS kills
// some of those launches at exec ("Launch Constraint Violation"), which the
// user sees as "Thinking Space quit unexpectedly" while the app is open and
// fine (seen 2026-10-01..03 on two machines).
//
// Pure: callers pass in what they read from disk.

import type { ScheduleSpecBlock } from './scheduleStorageBlock';

/**
 * catchup-check only ever fires missed slots of enabled calendar schedules
 * (interval schedules are launchd's own job) — mirror runner.mjs catchupCheck.
 */
export function needsCatchupAgentBlock(specs: ScheduleSpecBlock[]): boolean {
  return specs.some((s) => s.enabled && s.schedule?.kind === 'calendar');
}

/**
 * Mirror of runner.mjs readSecrets: both a bot token and a chat id. Takes the
 * parsed secrets.json (or null when missing/unreadable).
 */
function hasTelegramCredsBlock(secrets: unknown): boolean {
  if (!secrets || typeof secrets !== 'object') return false;
  const tg = (secrets as { telegram?: { bot_token?: unknown; chat_id?: unknown } }).telegram;
  return Boolean(tg?.bot_token) && Boolean(tg?.chat_id);
}

/** telegram-poll can do nothing without bot credentials. */
export function needsTelegramPollAgentBlock(secrets: unknown): boolean {
  return hasTelegramCredsBlock(secrets);
}

/**
 * heartbeat-check's only output is a Telegram alert when a heartbeat goes
 * stale — without credentials it can notice a problem and tell no one.
 */
export function needsHeartbeatAgentBlock(secrets: unknown): boolean {
  return hasTelegramCredsBlock(secrets);
}
