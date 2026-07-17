#!/usr/bin/env node
// Thinking Space standalone scheduler runner.
// Invoked by launchd plists. No dependency on the Electron app being running.
//
// Commands:
//   runner.mjs run <key>            — execute the schedule with the given key
//   runner.mjs stop <key>           — SIGTERM the running child of a window schedule
//   runner.mjs catchup-check        — fire any missed calendar slots since last run
//   runner.mjs heartbeat-check      — alert if Electron heartbeat is stale
//   runner.mjs notify <text>        — send a Telegram message
//   runner.mjs status               — print state + recent log entries
//   runner.mjs telegram-poll        — long-poll Bot API once; resume the
//                                     active conv's Claude session on reply

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, openSync, futimesSync, closeSync,
         readFileSync, writeFileSync, renameSync, statSync, appendFileSync,
         readdirSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { deleteClaudeSessionFilesBlock } from './claudeSessionCleanupBlock.mjs';

const HOME = homedir();
// userData path is injected by the Electron provisioner via the plist
// EnvironmentVariables dict. The provisioner uses app.getPath('userData'),
// which is the only correct value (it depends on package.json name vs
// productName and on dev vs packaged builds). Fallback is best-effort.
const USERDATA = process.env.THINKING_SPACE_USERDATA
  ?? join(HOME, 'Library', 'Application Support', 'Thinking Space');
const SCHEDULES_DIR = join(USERDATA, 'state', 'schedules');
const TRANSCRIPTS_DIR = join(USERDATA, 'transcripts');
const SECRETS_PATH = join(HOME, '.thinking-space', 'secrets.json');
const STATE_DIR = join(HOME, '.thinking-space', 'scheduler');
const STATE_PATH = join(STATE_DIR, 'state.json');
const LOG_PATH = join(STATE_DIR, 'runner.log');
const HEARTBEAT_ELECTRON_PATH = join(HOME, '.thinking-space-alive');
const HEARTBEAT_RUNNER_PATH = join(HOME, '.thinking-space-runner-alive');
const TELEGRAM_STATE_DIR = join(HOME, '.thinking-space', 'state', 'telegram');
const TELEGRAM_POLL_STATE = join(TELEGRAM_STATE_DIR, 'poll-state.json');
const TELEGRAM_ACTIVE = join(TELEGRAM_STATE_DIR, 'active.json');
const TELEGRAM_CONVS_DIR = join(TELEGRAM_STATE_DIR, 'conversations');
const TELEGRAM_LONG_POLL_TIMEOUT_S = 25;
const TELEGRAM_REPLY_CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;
// Session cleanup (JSONL under ~/.claude/projects + vault mirror under
// ai_raw/raw/claude-code) is delegated to claudeSessionCleanupBlock.mjs.
// Same module is dynamic-imported by the Electron main-process claude-cli
// provider so the summarizer's own invocations also leave no trace.

const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const HEARTBEAT_STALE_MS = 36 * 60 * 60 * 1000;
const DEFAULT_CLAUDE_BINARY = '/opt/homebrew/bin/claude';
// Catch-up only fires a scheduled slot if it's at least this old. Gives
// launchd time to do its normal on-time fire without us racing it.
const CATCHUP_MIN_AGE_MS = 2 * 60 * 1000;
// Lock files older than this are considered stale (process died). 2x the
// schedule timeout: enough slack for slow exits, short enough that a real
// hang doesn't block catch-up for hours.
const LOCK_STALE_MS = 20 * 60 * 1000;
const LOCKS_DIR = join(STATE_DIR, 'locks');

// ---------- low-level helpers ----------

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJsonOr(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return fallback; }
}

function writeJsonAtomic(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, path);
}

function touchFile(path) {
  ensureDir(dirname(path));
  const now = new Date();
  const fd = openSync(path, 'w');
  futimesSync(fd, now, now);
  closeSync(fd);
}

function nowIso() { return new Date().toISOString(); }

function logEvent(event) {
  ensureDir(dirname(LOG_PATH));
  const line = JSON.stringify({ ts: nowIso(), ...event }) + '\n';
  try { appendFileSync(LOG_PATH, line, { encoding: 'utf-8' }); }
  catch (err) { console.warn('[log] append failed', err.message); }
}

// ---------- state ----------

function readState() {
  return readJsonOr(STATE_PATH, { schedules: {}, lastUpdated: null });
}

function updateScheduleState(key, patch) {
  const state = readState();
  state.schedules[key] = { ...(state.schedules[key] ?? {}), ...patch };
  state.lastUpdated = nowIso();
  writeJsonAtomic(STATE_PATH, state);
}

// ---------- per-key locks ----------

function lockPathFor(key) {
  return join(LOCKS_DIR, `${key}.lock`);
}

function tryAcquireLock(key, origin) {
  ensureDir(LOCKS_DIR);
  const path = lockPathFor(key);
  const body = JSON.stringify({ pid: process.pid, origin, startedAt: nowIso() });
  try {
    // O_CREAT | O_EXCL: atomic, fails if file exists.
    const fd = openSync(path, 'wx', 0o600);
    writeFileSync(fd, body, { encoding: 'utf-8' });
    closeSync(fd);
    return path;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Existing lock — if it's older than the stale threshold, the prior
    // process almost certainly died without releasing. Take it over.
    try {
      const st = statSync(path);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        writeFileSync(path, body, { encoding: 'utf-8', mode: 0o600 });
        logEvent({ kind: 'lock_stale_taken', key, origin });
        return path;
      }
    } catch { /* race: file vanished, just retry once */ }
    return null;
  }
}

function releaseLock(path) {
  if (!path) return;
  try { unlinkSync(path); } catch { /* already gone */ }
}

// ---------- calendar math ----------

// Most recent scheduled fire time at or before `now`. Mirrors the launchd
// StartCalendarInterval semantics from the existing pmsetWakeBlock, but in
// reverse: walk backward up to 7 days (to cover weekday-filtered entries).
function computeMostRecentScheduledTime(spec, now = new Date()) {
  if (spec.schedule?.kind !== 'calendar') return null;
  for (let dayOffset = 0; dayOffset >= -7; dayOffset--) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() + dayOffset);
    const candidates = [];
    for (const entry of spec.schedule.entries) {
      if (typeof entry.weekday === 'number') {
        // launchd weekdays: 0/7 = Sunday, 1..6 = Mon..Sat. JS getDay(): 0=Sun.
        const wd = entry.weekday === 7 ? 0 : entry.weekday;
        if (dayStart.getDay() !== wd) continue;
      }
      const fire = new Date(dayStart);
      fire.setHours(entry.hour, entry.minute, 0, 0);
      if (fire.getTime() <= now.getTime()) candidates.push(fire);
    }
    if (candidates.length) {
      candidates.sort((a, b) => b.getTime() - a.getTime());
      return candidates[0];
    }
  }
  return null;
}

// ---------- telegram ----------

function readSecrets() {
  const s = readJsonOr(SECRETS_PATH, null);
  if (!s?.telegram?.bot_token || !s?.telegram?.chat_id) {
    throw new Error(`Telegram creds missing at ${SECRETS_PATH}`);
  }
  return s.telegram;
}

// "Typing…" bubble in the user's chat. Auto-expires after ~5s on Telegram's
// side, so callers that want sustained typing must call this on an interval.
// Best-effort: failures are logged but never propagate (purely cosmetic).
async function sendTelegramTyping() {
  let tg;
  try { tg = readSecrets(); } catch { return; }
  try {
    await fetch(`https://api.telegram.org/bot${tg.bot_token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.chat_id, action: 'typing' }),
    });
  } catch (err) {
    logEvent({ kind: 'telegram_typing_error', message: err.message });
  }
}

// Start refreshing the typing bubble every 4s (Telegram's ~5s TTL minus
// jitter). Returns a stop function that clears the interval. Fires one
// immediately so the bubble appears without waiting for the first tick.
function startTelegramTyping() {
  sendTelegramTyping();
  const handle = setInterval(sendTelegramTyping, 4000);
  return () => clearInterval(handle);
}

async function sendTelegram(text, { parseMode = 'Markdown' } = {}) {
  let tg;
  try { tg = readSecrets(); }
  catch (err) { logEvent({ kind: 'telegram_skip', reason: err.message }); return { sent: false, reason: err.message }; }

  const url = `https://api.telegram.org/bot${tg.bot_token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.chat_id, text, parse_mode: parseMode }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logEvent({ kind: 'telegram_fail', status: res.status, body: body.slice(0, 200) });
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    logEvent({ kind: 'telegram_error', message: err.message });
    return { sent: false, reason: err.message };
  }
}

// ---------- schedule execution ----------

function readSpec(key) {
  const path = join(SCHEDULES_DIR, `${key}.json`);
  return readJsonOr(path, null);
}

// Schedules without an explicit cwd used to inherit the runner's cwd — `/`
// under launchd. Children (claude especially) treat cwd as their project dir
// and roam from there, and macOS bills every folder they touch to the APP's
// permission identity (the runner is the app binary run as node). That is
// what produced the Desktop/Documents/Downloads/Network-Volumes permission
// prompts attributed to Thinking Space. Default to the vault — the one
// folder the user already granted — falling back to ~/.thinking-space.
function defaultExecutionCwd() {
  try {
    const raw = readFileSync(join(USERDATA, 'state', 'vault-root.json'), 'utf-8');
    const vaultRoot = JSON.parse(raw)?.vaultRoot;
    if (typeof vaultRoot === 'string' && vaultRoot.trim() && existsSync(vaultRoot)) {
      return vaultRoot;
    }
  } catch { /* fall through */ }
  return join(HOME, '.thinking-space');
}

function resolveSpawn(execution) {
  if (execution.kind === 'shell') {
    return {
      command: execution.command,
      args: execution.args ?? [],
      cwd: execution.cwd ?? defaultExecutionCwd(),
      env: { ...process.env, ...(execution.env ?? {}) },
    };
  }
  if (execution.kind === 'claude-code') {
    const args = [];
    if (execution.skipPermissions) args.push('--dangerously-skip-permissions');
    if (execution.model) args.push('--model', execution.model);
    const sessionMode = execution.session?.mode ?? 'new';
    if (sessionMode === 'continue') args.push('--continue');
    else if (sessionMode === 'resume') {
      if (!execution.session?.id) throw new Error('claude-code resume requires session.id');
      args.push('--resume', execution.session.id);
    }
    // stream-json + verbose lets us parse the session_id from the first
    // system/init event so the telegram poller can `claude --resume` the
    // same conversation when a reply arrives.
    args.push('--output-format', 'stream-json', '--verbose');
    args.push('-p', execution.prompt);
    return {
      command: execution.claudeBinary ?? DEFAULT_CLAUDE_BINARY,
      args,
      cwd: execution.cwd ?? defaultExecutionCwd(),
      env: { ...process.env, ...(execution.env ?? {}) },
    };
  }
  throw new Error(`Unknown execution kind: ${execution.kind}`);
}

function timestampSlug(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
         `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function runSchedule(key, { origin = 'launchd' } = {}) {
  const spec = readSpec(key);
  if (!spec) {
    logEvent({ kind: 'run_skip', key, reason: 'spec_not_found' });
    return { ok: false, reason: 'spec_not_found' };
  }
  if (!spec.enabled) {
    logEvent({ kind: 'run_skip', key, reason: 'disabled' });
    return { ok: false, reason: 'disabled' };
  }

  const lockPath = tryAcquireLock(key, origin);
  if (!lockPath) {
    logEvent({ kind: 'run_skip', key, reason: 'lock_held', origin });
    return { ok: false, reason: 'lock_held' };
  }

  try {
    return await runScheduleLocked(spec, origin);
  } finally {
    releaseLock(lockPath);
  }
}

async function runScheduleLocked(spec, origin) {
  const key = spec.key;
  const startedAt = new Date();
  // The scheduled slot this fire corresponds to. Recorded in state so the
  // catch-up watcher knows this slot has been claimed and won't re-fire it.
  const scheduledSlot = computeMostRecentScheduledTime(spec, startedAt);

  let resolved;
  try { resolved = resolveSpawn(spec.execution); }
  catch (err) {
    logEvent({ kind: 'run_error', key, phase: 'resolve', message: err.message, origin });
    await sendTelegram(`❌ *${spec.title}*\nresolve error: ${err.message}`);
    return { ok: false, reason: err.message };
  }

  const transcriptDir = join(TRANSCRIPTS_DIR, key);
  ensureDir(transcriptDir);
  const transcriptFilename = `${timestampSlug(startedAt)}.log`;
  const transcriptPath = join(transcriptDir, transcriptFilename);
  const transcript = createWriteStream(transcriptPath, { flags: 'w', encoding: 'utf-8' });

  const header =
    `# schedule: ${spec.key}\n` +
    `# label: ${spec.label}\n` +
    `# kind: ${spec.execution.kind}\n` +
    `# started: ${startedAt.toISOString()}\n` +
    `# origin: ${origin}\n` +
    `# scheduledSlot: ${scheduledSlot ? scheduledSlot.toISOString() : 'n/a'}\n` +
    `# command: ${resolved.command} ${resolved.args.join(' ')}\n` +
    `# cwd: ${resolved.cwd ?? process.cwd()}\n` +
    `# runner: standalone-mjs\n` +
    `---\n`;
  transcript.write(header);
  let bytes = header.length;
  let truncated = false;

  const writeLine = (channel, line) => {
    if (truncated) return;
    const hhmmss = new Date().toISOString().slice(11, 19);
    const marker = channel === 'stderr' ? '!' : ' ';
    const formatted = `${hhmmss} ${marker} ${line}\n`;
    if (bytes + formatted.length > MAX_TRANSCRIPT_BYTES) {
      transcript.write(`\n[transcript truncated at ${MAX_TRANSCRIPT_BYTES} bytes]\n`);
      truncated = true;
      return;
    }
    transcript.write(formatted);
    bytes += formatted.length;
  };

  const isClaudeCode = spec.execution.kind === 'claude-code';
  let claudeSessionId = null;
  // Captured from a `rate_limit_event` with status "rejected" in stream-json
  // output. Surfaced in the failure Telegram so the user knows *why* the run
  // exited 1 (out of session quota until resetsAt) vs a real bug.
  let claudeRateLimit = null;

  const inspectClaudeLine = (line) => {
    if (!isClaudeCode || !line.startsWith('{')) return;
    try {
      const ev = JSON.parse(line);
      if (!ev) return;
      if (!claudeSessionId && typeof ev.session_id === 'string' && ev.session_id) {
        claudeSessionId = ev.session_id;
      }
      if (
        !claudeRateLimit
        && ev.type === 'rate_limit_event'
        && ev.rate_limit_info?.status === 'rejected'
      ) {
        claudeRateLimit = {
          resetsAt: ev.rate_limit_info.resetsAt ?? null,
          rateLimitType: ev.rate_limit_info.rateLimitType ?? null,
          overageStatus: ev.rate_limit_info.overageStatus ?? null,
        };
      }
    } catch { /* not JSON, ignore */ }
  };

  const buffers = { stdout: '', stderr: '' };
  const ingest = (channel, chunk) => {
    buffers[channel] += chunk.toString('utf-8');
    let idx;
    while ((idx = buffers[channel].indexOf('\n')) !== -1) {
      const line = buffers[channel].slice(0, idx).replace(/\r$/, '');
      buffers[channel] = buffers[channel].slice(idx + 1);
      if (channel === 'stdout') inspectClaudeLine(line);
      writeLine(channel, line);
    }
  };

  const isWindow = spec.schedule?.kind === 'window';

  const child = spawn(resolved.command, resolved.args, {
    cwd: resolved.cwd, env: resolved.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (c) => ingest('stdout', c));
  child.stderr?.on('data', (c) => ingest('stderr', c));

  // Window jobs are intentionally long-running and get SIGTERM'd by a paired
  // stop plist. Skip the timeout cap and record the PID so `runner.mjs stop`
  // can find it.
  let timeoutHandle = null;
  if (!isWindow) {
    timeoutHandle = setTimeout(() => {
      if (!child.killed) {
        transcript.write(`\n[killed: timeout after ${DEFAULT_TIMEOUT_MS}ms]\n`);
        child.kill('SIGTERM');
      }
    }, DEFAULT_TIMEOUT_MS);
  } else {
    updateScheduleState(key, { runningPid: child.pid, runningSince: nowIso() });
  }

  let spawnError;
  child.on('error', (err) => {
    spawnError = err.message;
    transcript.write(`\n[spawn error] ${err.message}\n`);
  });

  const result = await new Promise((resolve) => {
    child.on('close', (exitCode, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (buffers.stdout) { writeLine('stdout', buffers.stdout); buffers.stdout = ''; }
      if (buffers.stderr) { writeLine('stderr', buffers.stderr); buffers.stderr = ''; }
      const endedAt = new Date();
      transcript.write(`---\n# ended: ${endedAt.toISOString()}\n# exit: ${exitCode}\n# signal: ${signal ?? 'null'}\n`);
      transcript.end(() => resolve({ exitCode, signal, endedAt }));
    });
  });

  if (isWindow) {
    updateScheduleState(key, { runningPid: null, runningSince: null });
  }

  // For window jobs, a SIGTERM is the expected stop signal — count it as
  // success, not failure. Anything else (non-zero exit, spawn error, other
  // signal) is still a failure.
  const stoppedByWindow = isWindow && result.signal === 'SIGTERM';
  const failed = !stoppedByWindow && (result.exitCode !== 0 || spawnError);
  const durationMs = result.endedAt.getTime() - startedAt.getTime();

  const statePatch = {
    lastFiredAt: startedAt.toISOString(),
    lastEndedAt: result.endedAt.toISOString(),
    lastExitCode: result.exitCode,
    lastSignal: result.signal,
    lastDurationMs: durationMs,
    lastTranscript: transcriptFilename,
    lastError: spawnError ?? null,
    lastOrigin: origin,
    // Mark the scheduled slot as claimed so the catch-up watcher does not
    // re-fire it. Stored even on failure: a failed run still consumed the
    // slot, and the right response is to escalate (Telegram alert), not loop.
    lastScheduledSlot: scheduledSlot ? scheduledSlot.toISOString() : null,
    consecutiveFailures: failed
      ? (readState().schedules[key]?.consecutiveFailures ?? 0) + 1
      : 0,
  };
  if (isClaudeCode) statePatch.lastClaudeSessionId = claudeSessionId ?? null;
  updateScheduleState(key, statePatch);

  logEvent({
    kind: 'run', key, origin,
    scheduledSlot: scheduledSlot ? scheduledSlot.toISOString() : null,
    exitCode: result.exitCode, signal: result.signal,
    durationMs, transcript: transcriptFilename, failed: !!failed,
    error: spawnError ?? null,
  });

  // Touch runner heartbeat so the watcher knows the runner itself is alive.
  touchFile(HEARTBEAT_RUNNER_PATH);

  // Auto-open Telegram conversation if this schedule opted in. The first
  // outbound message (the "opening hook") is sent by the skill itself via
  // thinkspc telegram.send_message; we only register the conv ↔ sessionId
  // pairing here so the poller can resume on reply.
  if (isClaudeCode && !failed && claudeSessionId && spec.execution.telegramConversation) {
    try { await openTelegramConvForSpec(spec, claudeSessionId, resolved.cwd ?? process.cwd()); }
    catch (err) { logEvent({ kind: 'telegram_conv_open_error', key, message: err.message }); }
  }

  // Auto-delete the captured Claude session JSONL for one-shot anchor jobs.
  // Skipped when telegramConversation is also set, since the poller needs
  // the session alive for resume.
  if (
    isClaudeCode && claudeSessionId
    && spec.execution.cleanupSession
    && !spec.execution.telegramConversation
  ) {
    const removed = deleteClaudeSessionFilesBlock(claudeSessionId);
    logEvent({ kind: 'claude_session_cleanup', key, sessionId: claudeSessionId, removed });
  }

  const durationLabel = durationMs < 1000
    ? `${durationMs} ms`
    : durationMs < 60_000
      ? `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)} s`
      : `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`;
  const finishedLabel = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  let statusLabel;
  if (!failed) {
    statusLabel = stoppedByWindow ? '✅ Stopped (window end)' : '✅ Success';
  } else if (claudeRateLimit) {
    // resetsAt is a unix seconds epoch in stream-json output.
    const resetsLabel = claudeRateLimit.resetsAt
      ? new Date(claudeRateLimit.resetsAt * 1000).toLocaleString('en-US', {
          timeZone: 'America/Chicago',
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        }) + ' CT'
      : 'unknown';
    const kindLabel = claudeRateLimit.rateLimitType === 'five_hour' ? '5-hour session' : (claudeRateLimit.rateLimitType ?? 'rate limit');
    const overageLabel = claudeRateLimit.overageStatus === 'rejected' ? ' · overage disabled' : '';
    statusLabel = `⛔ Rate limited (${kindLabel}${overageLabel}) · resets ${resetsLabel}`;
  } else if (spawnError) {
    statusLabel = `❌ Failed (${spawnError})`;
  } else {
    statusLabel = `❌ Failed (exit ${result.exitCode}${result.signal ? `, signal ${result.signal}` : ''})`;
  }
  await sendTelegram(
    [
      `*Thinking Space scheduler*`,
      `Job: ${spec.title}`,
      `Status: ${statusLabel}`,
      `Duration: ${durationLabel}`,
      `Origin: ${origin}`,
      `Finished: ${finishedLabel} CT`,
      `Transcript: \`${transcriptFilename}\``,
    ].join('\n'),
  );

  return { ok: !failed, exitCode: result.exitCode, transcriptPath };
}

// ---------- window stop ----------

// Read the running PID for a window schedule from state and send SIGTERM.
// Idempotent: missing PID or already-dead process is logged and exits 0.
async function stopSchedule(key) {
  const state = readState();
  const sch = state.schedules?.[key];
  const pid = sch?.runningPid;
  if (!pid) {
    logEvent({ kind: 'stop_skip', key, reason: 'no_running_pid' });
    console.log(JSON.stringify({ ok: true, reason: 'no_running_pid' }));
    return { ok: true };
  }
  try {
    process.kill(pid, 'SIGTERM');
    logEvent({ kind: 'stop', key, pid });
    console.log(JSON.stringify({ ok: true, pid }));
    return { ok: true };
  } catch (err) {
    if (err.code === 'ESRCH') {
      // process already gone — clear the stale PID
      updateScheduleState(key, { runningPid: null, runningSince: null });
      logEvent({ kind: 'stop_skip', key, reason: 'esrch', pid });
      console.log(JSON.stringify({ ok: true, reason: 'esrch' }));
      return { ok: true };
    }
    logEvent({ kind: 'stop_error', key, pid, message: err.message });
    console.error(JSON.stringify({ ok: false, error: err.message }));
    return { ok: false };
  }
}

// ---------- heartbeat watcher ----------

function ageMs(path) {
  try { return Date.now() - statSync(path).mtimeMs; }
  catch { return Infinity; }
}

async function heartbeatCheck() {
  // The watcher's own execution proves the runner subsystem is wired and
  // firing on schedule — touch its heartbeat first so it shows fresh.
  touchFile(HEARTBEAT_RUNNER_PATH);
  const electronAge = ageMs(HEARTBEAT_ELECTRON_PATH);
  const runnerAge = ageMs(HEARTBEAT_RUNNER_PATH);
  const state = readState();
  const lastAlert = state.lastHeartbeatAlert ?? {};

  const checks = [
    { name: 'electron', path: HEARTBEAT_ELECTRON_PATH, age: electronAge },
    { name: 'runner',   path: HEARTBEAT_RUNNER_PATH,   age: runnerAge },
  ];

  let alerted = false;
  for (const c of checks) {
    // Skip "never seen" — file has never existed. Either the subsystem hasn't
    // started yet (fresh install) or the path is wrong. Either way, no signal.
    if (!Number.isFinite(c.age)) continue;
    const stale = c.age > HEARTBEAT_STALE_MS;
    const alertedRecently = lastAlert[c.name] && (Date.now() - Date.parse(lastAlert[c.name])) < 24 * 60 * 60 * 1000;
    if (stale && !alertedRecently) {
      const hours = Number.isFinite(c.age) ? Math.round(c.age / 3600000) : 'never seen';
      await sendTelegram(
        `⚠️ *${c.name} heartbeat stale*\nlast update: ${hours === 'never seen' ? 'never' : `${hours}h ago`}\npath: \`${c.path}\``,
        { parseMode: 'Markdown' },
      );
      lastAlert[c.name] = nowIso();
      alerted = true;
    } else if (!stale && lastAlert[c.name]) {
      // recovered — clear so we alert again next time it goes stale
      delete lastAlert[c.name];
    }
  }
  const next = readState();
  next.lastHeartbeatAlert = lastAlert;
  writeJsonAtomic(STATE_PATH, next);
  logEvent({ kind: 'heartbeat_check', electronAge, runnerAge, alerted });
  return { electronAge, runnerAge, alerted };
}

// ---------- catch-up watcher ----------

// Walks every calendar schedule, figures out the most recent scheduled time
// in the past, and re-fires it if the state file says we haven't claimed
// that slot yet. Skips schedules that just fired (within CATCHUP_MIN_AGE_MS)
// so launchd's on-time fire wins the race.
//
// dryRun=true returns the list of slots that WOULD fire without invoking any
// runs and without touching state. Useful for safe inspection.
async function catchupCheck({ dryRun = false } = {}) {
  touchFile(HEARTBEAT_RUNNER_PATH);
  if (!existsSync(SCHEDULES_DIR)) {
    logEvent({ kind: 'catchup_check', considered: 0, fired: 0, dryRun });
    return { considered: 0, fired: 0, fires: [], dryRun };
  }
  const state = readState();
  const files = readdirSync(SCHEDULES_DIR).filter((f) => f.endsWith('.json'));
  const now = new Date();
  let considered = 0;
  let fired = 0;
  const fires = [];

  for (const file of files) {
    const key = file.replace(/\.json$/, '');
    const spec = readSpec(key);
    if (!spec || !spec.enabled) continue;
    if (spec.schedule?.kind !== 'calendar') continue; // interval handled by launchd
    considered++;

    const mostRecent = computeMostRecentScheduledTime(spec, now);
    if (!mostRecent) continue;
    const slotAgeMs = now.getTime() - mostRecent.getTime();
    if (slotAgeMs < CATCHUP_MIN_AGE_MS) continue; // launchd should be handling it

    const lastSlotIso = state.schedules?.[key]?.lastScheduledSlot ?? null;
    const lastSlot = lastSlotIso ? Date.parse(lastSlotIso) : 0;
    if (lastSlot >= mostRecent.getTime()) continue; // already claimed

    fires.push({ key, scheduledSlot: mostRecent.toISOString(), ageMs: slotAgeMs });
  }

  if (dryRun) {
    logEvent({ kind: 'catchup_check', considered, fired: 0, dryRun: true, would: fires });
    return { considered, fired: 0, fires, dryRun: true };
  }

  // Fire serially so we don't hammer the system if many slots were missed.
  for (const f of fires) {
    logEvent({ kind: 'catchup_fire', key: f.key, scheduledSlot: f.scheduledSlot, ageMs: f.ageMs });
    const r = await runSchedule(f.key, { origin: 'catchup' });
    if (r.reason !== 'lock_held') fired++;
  }

  logEvent({ kind: 'catchup_check', considered, fired });
  return { considered, fired, fires };
}

// ---------- status ----------

// ---------- telegram poll ----------
//
// One-shot tick driven by launchd every ~30s. Each call long-polls the Bot
// API for ~25s. If an inbound message matches the active conv, we resume
// the paired Claude Code session with the reply text and let it respond
// (Claude calls telegram.send_message itself to talk back).
//
// State files are written by the thinkspc telegram.* capabilities; this
// poller is a pure consumer (plus updates poll-state.json's lastUpdateId).

function readActiveConvPointer() {
  return readJsonOr(TELEGRAM_ACTIVE, null);
}

function readConv(convId) {
  return readJsonOr(join(TELEGRAM_CONVS_DIR, `${convId}.json`), null);
}

function writeConv(state) {
  writeJsonAtomic(join(TELEGRAM_CONVS_DIR, `${state.convId}.json`), state);
}

function appendConvHistory(convId, entry) {
  const conv = readConv(convId);
  if (!conv) return null;
  const next = { ...conv, history: [...(conv.history ?? []), entry] };
  writeConv(next);
  return next;
}

async function telegramGetUpdates(offset) {
  let tg;
  try { tg = readSecrets(); }
  catch (err) { logEvent({ kind: 'telegram_poll_skip', reason: err.message }); return []; }

  const url = `https://api.telegram.org/bot${tg.bot_token}/getUpdates`
    + `?offset=${offset}&timeout=${TELEGRAM_LONG_POLL_TIMEOUT_S}`
    + `&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`;
  // AbortController guards against a stuck connection: Bot API normally
  // returns within `timeout` seconds, so anything past that is anomalous.
  const ctrl = new AbortController();
  const guard = setTimeout(() => ctrl.abort(), (TELEGRAM_LONG_POLL_TIMEOUT_S + 10) * 1000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      logEvent({ kind: 'telegram_poll_http_error', status: res.status });
      return [];
    }
    const payload = await res.json();
    if (!payload?.ok || !Array.isArray(payload.result)) {
      logEvent({ kind: 'telegram_poll_bad_payload', payload: String(payload).slice(0, 200) });
      return [];
    }
    return payload.result;
  } catch (err) {
    logEvent({ kind: 'telegram_poll_fetch_error', message: err.message });
    return [];
  } finally {
    clearTimeout(guard);
  }
}

// Used for every reply-turn after the first one in a telegram conversation.
// Should match (or at least be no weaker than) the model in the schedule spec
// so the conversation stays consistent across turns.
const TELEGRAM_RESUME_MODEL = 'claude-sonnet-4-6';
const THINKSPC_SHIM = join(HOME, '.local', 'bin', 'thinkspc');

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve) => {
    let stderr = '';
    let stdout = '';
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    child.stdout?.on('data', (c) => { stdout += c.toString('utf-8'); });
    child.stderr?.on('data', (c) => { stderr += c.toString('utf-8'); });
    child.on('error', (err) => resolve({ ok: false, exitCode: null, stdout, stderr, error: err.message }));
    child.on('close', (exitCode, signal) => resolve({ ok: exitCode === 0, exitCode, signal, stdout, stderr }));
  });
}

async function openTelegramConvForSpec(spec, sessionId, cwd) {
  if (!existsSync(THINKSPC_SHIM)) {
    logEvent({ kind: 'telegram_conv_open_skip', reason: 'shim_missing', key: spec.key });
    return;
  }
  const args = [
    '--json',
    'telegram.open_conversation',
    '--scheduleKey', spec.key,
    '--sessionId', sessionId,
    '--cwd', cwd,
  ];
  const r = await spawnAndWait(THINKSPC_SHIM, args);
  if (!r.ok) {
    logEvent({
      kind: 'telegram_conv_open_failed',
      key: spec.key,
      exitCode: r.exitCode,
      stderrTail: (r.stderr || '').slice(-500),
    });
    return;
  }
  try {
    const parsed = JSON.parse(r.stdout.trim());
    logEvent({
      kind: 'telegram_conv_opened',
      key: spec.key,
      convId: parsed?.data?.convId ?? null,
      replacedConvId: parsed?.data?.replacedConvId ?? null,
    });
  } catch {
    logEvent({ kind: 'telegram_conv_opened', key: spec.key, stdoutTail: r.stdout.slice(-200) });
  }
}

function spawnClaudeResume({ cwd, sessionId, replyText, scheduleKey }) {
  return new Promise((resolve) => {
    const args = [
      '--dangerously-skip-permissions',
      '--model', TELEGRAM_RESUME_MODEL,
      '--resume', sessionId,
      '--output-format', 'stream-json', '--verbose',
      '-p', replyText,
    ];

    // Write a transcript so the Schedules UI can show this resume turn in
    // the run history. Mirrors runScheduleLocked's transcript format.
    const startedAt = new Date();
    const transcriptDir = join(TRANSCRIPTS_DIR, scheduleKey);
    ensureDir(transcriptDir);
    const transcriptFilename = `${timestampSlug(startedAt)}-resume.log`;
    const transcriptPath = join(transcriptDir, transcriptFilename);
    const transcript = createWriteStream(transcriptPath, { flags: 'w', encoding: 'utf-8' });
    transcript.write(
      `# schedule: ${scheduleKey}\n` +
      `# kind: claude-code (telegram-resume)\n` +
      `# started: ${startedAt.toISOString()}\n` +
      `# sessionId: ${sessionId}\n` +
      `# reply: ${replyText.replace(/\n/g, ' ').slice(0, 200)}\n` +
      `# command: ${DEFAULT_CLAUDE_BINARY} ${args.join(' ')}\n` +
      `# cwd: ${cwd}\n` +
      `---\n`,
    );

    let stderr = '';
    const child = spawn(DEFAULT_CLAUDE_BINARY, args, {
      cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (c) => { transcript.write(c); });
    child.stderr?.on('data', (c) => {
      const s = c.toString('utf-8');
      stderr += s;
      transcript.write(`[stderr] ${s}`);
    });
    const guard = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
    }, TELEGRAM_REPLY_CLAUDE_TIMEOUT_MS);
    const finish = (result) => {
      clearTimeout(guard);
      transcript.write(
        `---\n# ended: ${new Date().toISOString()}\n# exit: ${result.exitCode}\n# signal: ${result.signal ?? 'null'}\n`,
      );
      transcript.end(() => resolve({ ...result, transcript: transcriptFilename }));
    };
    child.on('error', (err) => finish({ ok: false, exitCode: null, signal: null, error: err.message, stderr }));
    child.on('close', (exitCode, signal) => finish({ ok: exitCode === 0, exitCode, signal, stderr: stderr.slice(-2000) }));
  });
}

async function handleTelegramMessage(message) {
  const text = (message.text ?? '').toString();
  const fromChatId = message.chat?.id;
  const messageDate = message.date;

  const active = readActiveConvPointer();
  if (!active?.convId) {
    logEvent({ kind: 'telegram_unhandled', reason: 'no_active_conv', fromChatId, textPreview: text.slice(0, 80) });
    return;
  }
  if (String(active.chatId) !== String(fromChatId)) {
    logEvent({ kind: 'telegram_unhandled', reason: 'chat_mismatch', fromChatId, expected: active.chatId });
    return;
  }
  const conv = readConv(active.convId);
  if (!conv) {
    logEvent({ kind: 'telegram_unhandled', reason: 'conv_missing', convId: active.convId });
    return;
  }
  if (conv.status !== 'active') {
    logEvent({ kind: 'telegram_unhandled', reason: 'conv_not_active', convId: conv.convId, status: conv.status });
    return;
  }
  if (!text.trim()) {
    logEvent({ kind: 'telegram_unhandled', reason: 'empty_message', convId: conv.convId });
    return;
  }

  appendConvHistory(conv.convId, {
    direction: 'in',
    text,
    at: messageDate ? new Date(messageDate * 1000).toISOString() : nowIso(),
  });
  logEvent({ kind: 'telegram_inbound', convId: conv.convId, textPreview: text.slice(0, 80) });

  // Show "typing…" in the user's chat until Claude responds. Claude's reply
  // turn can take 10–60s; without this the chat looks dead while we cold-
  // start the session resume. Stopped in finally so a crash doesn't leak
  // the interval.
  const stopTyping = startTelegramTyping();
  let result;
  try {
    result = await spawnClaudeResume({
      cwd: conv.cwd,
      sessionId: conv.sessionId,
      replyText: text,
      scheduleKey: conv.scheduleKey,
    });
  } finally {
    stopTyping();
  }
  logEvent({
    kind: 'telegram_claude_resume',
    convId: conv.convId,
    sessionId: conv.sessionId,
    ok: result.ok,
    exitCode: result.exitCode,
    signal: result.signal ?? null,
    transcript: result.transcript,
    stderrTail: result.stderr || null,
  });

  if (!result.ok) {
    await sendTelegram(
      `⚠️ Couldn't process your last reply (claude exit ${result.exitCode ?? 'spawn-error'}). The conversation is paused; reply again or wait for tomorrow.`,
    );
  }
}

async function telegramPoll() {
  touchFile(HEARTBEAT_RUNNER_PATH);
  const pollState = readJsonOr(TELEGRAM_POLL_STATE, { lastUpdateId: 0 });
  const offset = (pollState.lastUpdateId ?? 0) + 1;

  const updates = await telegramGetUpdates(offset);
  if (updates.length === 0) {
    return { processed: 0 };
  }

  let highest = pollState.lastUpdateId ?? 0;
  for (const update of updates) {
    if (typeof update.update_id === 'number' && update.update_id > highest) {
      highest = update.update_id;
    }
    if (update.message) {
      try { await handleTelegramMessage(update.message); }
      catch (err) { logEvent({ kind: 'telegram_handle_error', message: err.message, updateId: update.update_id }); }
    }
  }

  writeJsonAtomic(TELEGRAM_POLL_STATE, { lastUpdateId: highest, lastPolledAt: nowIso() });
  return { processed: updates.length, lastUpdateId: highest };
}

function status() {
  const state = readState();
  const schedules = existsSync(SCHEDULES_DIR) ? readdirSync(SCHEDULES_DIR).filter(f => f.endsWith('.json')) : [];
  const recentLog = (() => {
    try {
      const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n').slice(-20);
      return lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    } catch { return []; }
  })();
  console.log(JSON.stringify({
    secretsPresent: existsSync(SECRETS_PATH),
    schedulesDir: SCHEDULES_DIR,
    schedulesFound: schedules,
    electronHeartbeatAgeMs: ageMs(HEARTBEAT_ELECTRON_PATH),
    runnerHeartbeatAgeMs: ageMs(HEARTBEAT_RUNNER_PATH),
    state,
    recentLog,
  }, null, 2));
}

// ---------- incognito one-shot claude ----------

// Read all of stdin as a UTF-8 string. Used to pass large prompts (a 12KB
// git diff, say) without hitting argv length limits or shell-escaping hell.
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

// Parse `claude -p --output-format json` stdout: a single JSON envelope with
// `result` (assistant text) and `session_id`. Falls back to raw stdout if the
// payload isn't parseable, so an unexpected CLI version still yields text.
function parseClaudeJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return { content: '', sessionId: null };
  try {
    const obj = JSON.parse(trimmed);
    return {
      content: typeof obj.result === 'string' ? obj.result : '',
      sessionId: typeof obj.session_id === 'string' ? obj.session_id : null,
    };
  } catch {
    return { content: trimmed, sessionId: null };
  }
}

// One-shot incognito Claude call — the SAME recipe as the app's intelligence
// claude-cli provider (frontend/electron/src/lego_blocks/claudeCliBlock.ts):
// `--output-format json` to capture session_id, THINKSPC_INCOGNITO=1 so a
// SessionEnd hook can early-exit, then a TWO-PASS cleanup (immediate + ~1.2s
// later) to win the race against the hook writing the vault mirror. Any
// scheduled job that needs generated text (commit messages, etc.) should
// route through this instead of hand-rolling its own `claude -p` + cleanup.
async function runClaudeIncognito({ model, system, prompt, timeoutMs = 60_000 }) {
  const args = ['-p'];
  if (model) args.push('--model', model);
  if (system) args.push('--system-prompt', system);
  args.push('--output-format', 'json');
  args.push(prompt);

  const started = Date.now();
  const result = await new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(DEFAULT_CLAUDE_BINARY, args, {
        env: { ...process.env, FORCE_COLOR: '0', THINKSPC_INCOGNITO: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, error: `spawn failed: ${err.message}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM'); }, timeoutMs);
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (timedOut) { resolve({ ok: false, error: `timeout after ${timeoutMs}ms` }); return; }
      if (/^Not logged in/i.test(trimmed) || /Please run \/login/i.test(trimmed)) {
        resolve({ ok: false, error: 'not-logged-in' }); return;
      }
      if (code !== 0 && !trimmed) { resolve({ ok: false, error: stderr.trim() || `exit ${code}` }); return; }
      resolve({ ok: true, ...parseClaudeJsonOutput(trimmed) });
    });
  });

  // Two-pass incognito cleanup — mirrors claudeCliBlock's
  // scheduleSessionCleanupBlock. The retry covers the window where the
  // SessionEnd hook writes the vault mirror a beat after the child exits.
  if (result.ok && result.sessionId) {
    const nuke = () => {
      try {
        const removed = deleteClaudeSessionFilesBlock(result.sessionId);
        logEvent({ kind: 'claude_session_cleanup', origin: 'incognito', sessionId: result.sessionId, removed });
      } catch { /* best effort */ }
    };
    nuke();
    await new Promise((r) => setTimeout(r, 1200));
    nuke();
  }

  return { ...result, latencyMs: Date.now() - started };
}

// ---------- dispatch ----------

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'run': {
      const key = rest[0];
      if (!key) { console.error('usage: runner.mjs run <key> [--origin <name>]'); process.exit(2); }
      const originIdx = rest.indexOf('--origin');
      const origin = originIdx >= 0 && rest[originIdx + 1] ? rest[originIdx + 1] : 'launchd';
      const r = await runSchedule(key, { origin });
      process.exit(r.ok ? 0 : 1);
    }
    case 'stop': {
      const key = rest[0];
      if (!key) { console.error('usage: runner.mjs stop <key>'); process.exit(2); }
      const r = await stopSchedule(key);
      process.exit(r.ok ? 0 : 1);
    }
    case 'heartbeat-check': {
      await heartbeatCheck();
      process.exit(0);
    }
    case 'catchup-check': {
      const dryRun = rest.includes('--dry-run');
      const r = await catchupCheck({ dryRun });
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    }
    case 'notify': {
      const text = rest.join(' ');
      if (!text) { console.error('usage: runner.mjs notify <text>'); process.exit(2); }
      const r = await sendTelegram(text);
      console.log(JSON.stringify(r));
      process.exit(r.sent ? 0 : 1);
    }
    case 'status': {
      status();
      process.exit(0);
    }
    case 'telegram-poll': {
      const r = await telegramPoll();
      console.log(JSON.stringify(r));
      process.exit(0);
    }
    case 'cleanup-session': {
      const sessionId = rest[0];
      if (!sessionId) { console.error('usage: runner.mjs cleanup-session <sessionId>'); process.exit(2); }
      const removed = deleteClaudeSessionFilesBlock(sessionId);
      logEvent({ kind: 'claude_session_cleanup', origin: 'cli', sessionId, removed });
      console.log(JSON.stringify({ ok: true, sessionId, removed }));
      process.exit(0);
    }
    case 'claude-incognito': {
      // One-shot incognito Claude for scheduled jobs. Prompt comes on stdin
      // (large diffs), model/system via flags. Prints the assistant text to
      // stdout and self-cleans the session (two-pass). Exit 1 on failure so
      // callers can fall back to a static message.
      //   ... | runner.mjs claude-incognito [--model haiku] [--system <s>]
      const modelIdx = rest.indexOf('--model');
      const model = modelIdx >= 0 && rest[modelIdx + 1] ? rest[modelIdx + 1] : 'haiku';
      const systemIdx = rest.indexOf('--system');
      const system = systemIdx >= 0 && rest[systemIdx + 1] ? rest[systemIdx + 1] : '';
      const prompt = (await readStdin()).trim();
      if (!prompt) { console.error('usage: <prompt on stdin> | runner.mjs claude-incognito [--model m] [--system s]'); process.exit(2); }
      const r = await runClaudeIncognito({ model, system, prompt });
      if (!r.ok) { console.error(r.error ?? 'claude-incognito failed'); process.exit(1); }
      process.stdout.write(r.content ?? '');
      process.exit(0);
    }
    default:
      console.error('usage: runner.mjs <run|stop|catchup-check|heartbeat-check|notify|status|telegram-poll|cleanup-session|claude-incognito> [args]');
      process.exit(2);
  }
}

main().catch((err) => {
  logEvent({ kind: 'fatal', message: err.message, stack: err.stack });
  console.error(err);
  process.exit(1);
});
