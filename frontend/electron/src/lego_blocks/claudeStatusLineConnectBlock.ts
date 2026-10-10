import * as fs from 'fs';
import * as path from 'path';

/**
 * Connects Claude Code's status line to Thinking Space, and takes it back out.
 *
 * Claude Code hands its limit figures to exactly one place: the command named
 * by `statusLine` in `~/.claude/settings.json`. Until this block existed the
 * app only ever *read* that file and asked the person to paste a `/statusline`
 * command into Claude Code — a setup step in another program, for a feature
 * that is free on Codex. This block makes the same change for them, on a
 * button press, never on its own.
 *
 * Three rules, each because the file is not ours:
 *
 *   - **Never replace someone's status line.** Only one runs, so pointing the
 *     setting at our script would delete their branch, their context meter,
 *     whatever they built. An existing command is wrapped instead: a small
 *     script hands the payload to ours for the capture, then to theirs for the
 *     display, and what they see does not change.
 *   - **Never write over a file we could not read.** A settings file that does
 *     not parse is left exactly as it is and the connect reports failure —
 *     rewriting it from an empty object would silently delete every other
 *     setting in it.
 *   - **Always be able to put it back.** What `statusLine` was before (or that
 *     it was absent) is recorded beside the wrapper, the whole file is copied
 *     aside before the first write, and the write itself is temp-then-rename
 *     so a crash cannot leave half a settings file.
 *
 * Electron-free and path-injected, so tests can run it against a temp home.
 */

/** Our own script's filename — how a `statusLine.command` is recognised as ours. */
export const CLAUDE_STATUSLINE_SCRIPT_NAME_BLOCK = 'claude-statusline.sh';
/** The wrapper around someone's existing status line. Also recognised as ours. */
export const CLAUDE_STATUSLINE_WRAPPER_NAME_BLOCK = 'claude-statusline-wrap.sh';
const CONNECT_RECORD_NAME_BLOCK = 'claude-statusline-connect.json';
const SETTINGS_BACKUP_NAME_BLOCK = 'claude-settings-before-connect.json';

export interface ClaudeStatusLinePathsBlock {
  /** `~/.claude/settings.json`. */
  settingsPath: string;
  /** `~/.thinking-space` — where the wrapper, the record and the backup live. */
  stateDir: string;
  /** Absolute path to the bundled status-line script. */
  scriptPath: string;
}

export type ClaudeStatusLineConnectResultBlock =
  | { ok: true; mode: 'direct' | 'wrapped' | 'already' }
  | { ok: false; reason: 'unreadable-settings' | 'no-script' | 'write-failed' };

export type ClaudeStatusLineDisconnectResultBlock =
  | { ok: true; restored: 'previous' | 'removed' | 'not-connected' }
  | { ok: false; reason: 'unreadable-settings' | 'write-failed' };

type SettingsBlock = Record<string, unknown>;

export function isOurStatusLineCommandBlock(command: string): boolean {
  return (
    command.includes(CLAUDE_STATUSLINE_SCRIPT_NAME_BLOCK) ||
    command.includes(CLAUDE_STATUSLINE_WRAPPER_NAME_BLOCK)
  );
}

/**
 * The settings object, `{}` when the file does not exist, or null when it
 * exists and cannot be used — the one case nothing may be written.
 */
function readSettingsBlock(settingsPath: string): SettingsBlock | null {
  let text: string;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null;
  }
  if (text.trim() === '') return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SettingsBlock)
      : null;
  } catch {
    return null;
  }
}

/** Temp in the same directory, then rename: never a half-written file. */
function writeFileAtomicBlock(target: string, text: string, mode?: number): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.thinking-space-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, text, mode === undefined ? 'utf8' : { encoding: 'utf8', mode });
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
}

function writeSettingsBlock(settingsPath: string, settings: SettingsBlock): void {
  writeFileAtomicBlock(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

/** POSIX single-quoting: safe for any string, including one with quotes in it. */
function shellQuoteBlock(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The wrapper: capture with our script, display with theirs.
 *
 * Their command is run through a shell exactly as Claude Code would run it —
 * it is a shell string, not a path — and our script's output is discarded so
 * the only line Claude Code sees is the one they wrote. A failure on our side
 * cannot take their status line down: the capture's exit status is ignored.
 */
function wrapperScriptBlock(scriptPath: string, originalCommand: string): string {
  return [
    '#!/usr/bin/env bash',
    '# Written by Thinking Space when you pressed "Connect Claude".',
    '# It saves the usage reading, then runs your own status line unchanged.',
    '# To undo: Thinking Space > Settings > AI Activity > Plan usage, or restore',
    '# "statusLine" in ~/.claude/settings.json to the command below.',
    'input=$(cat)',
    `printf '%s' "$input" | ${shellQuoteBlock(scriptPath)} >/dev/null 2>&1 || true`,
    `printf '%s' "$input" | "\${SHELL:-/bin/sh}" -c ${shellQuoteBlock(originalCommand)}`,
    '',
  ].join('\n');
}

export function connectClaudeStatusLineBlock(
  paths: ClaudeStatusLinePathsBlock,
): ClaudeStatusLineConnectResultBlock {
  if (!paths.scriptPath) return { ok: false, reason: 'no-script' };
  const settings = readSettingsBlock(paths.settingsPath);
  if (!settings) return { ok: false, reason: 'unreadable-settings' };

  const previous =
    settings.statusLine && typeof settings.statusLine === 'object'
      ? (settings.statusLine as Record<string, unknown>)
      : null;
  const previousCommand = typeof previous?.command === 'string' ? previous.command : null;
  if (previousCommand && isOurStatusLineCommandBlock(previousCommand)) {
    return { ok: true, mode: 'already' };
  }

  try {
    fs.mkdirSync(paths.stateDir, { recursive: true });
    // The whole file, as it was, before the first byte of ours goes in. Kept
    // only when there was a file to keep.
    if (fs.existsSync(paths.settingsPath)) {
      fs.copyFileSync(paths.settingsPath, path.join(paths.stateDir, SETTINGS_BACKUP_NAME_BLOCK));
    }
    // What to put back. Written before the settings change, so there is never
    // a moment where we have changed the setting and cannot undo it.
    writeFileAtomicBlock(
      path.join(paths.stateDir, CONNECT_RECORD_NAME_BLOCK),
      `${JSON.stringify({ previous, connectedAt: Date.now() }, null, 2)}\n`,
    );

    let command: string;
    if (previousCommand) {
      const wrapperPath = path.join(paths.stateDir, CLAUDE_STATUSLINE_WRAPPER_NAME_BLOCK);
      writeFileAtomicBlock(wrapperPath, wrapperScriptBlock(paths.scriptPath, previousCommand), 0o755);
      command = `"${wrapperPath}"`;
    } else {
      // Quoted, always: the app bundle's own path has a space in it.
      command = `"${paths.scriptPath}"`;
    }

    // Their other status-line fields (padding and so on) ride along untouched.
    writeSettingsBlock(paths.settingsPath, {
      ...settings,
      statusLine: { ...(previous ?? {}), type: 'command', command },
    });
    return { ok: true, mode: previousCommand ? 'wrapped' : 'direct' };
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
}

export function disconnectClaudeStatusLineBlock(
  paths: ClaudeStatusLinePathsBlock,
): ClaudeStatusLineDisconnectResultBlock {
  const settings = readSettingsBlock(paths.settingsPath);
  if (!settings) return { ok: false, reason: 'unreadable-settings' };

  const current = settings.statusLine as Record<string, unknown> | undefined;
  const currentCommand = typeof current?.command === 'string' ? current.command : null;
  // Changed since we connected, or never connected: it is theirs now, and
  // "undo" must not reach into it.
  if (!currentCommand || !isOurStatusLineCommandBlock(currentCommand)) {
    return { ok: true, restored: 'not-connected' };
  }

  let previous: Record<string, unknown> | null = null;
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(paths.stateDir, CONNECT_RECORD_NAME_BLOCK), 'utf8'),
    ) as { previous?: unknown };
    if (record.previous && typeof record.previous === 'object') {
      previous = record.previous as Record<string, unknown>;
    }
  } catch {
    // No record — connected by the old pasted command. There is nothing to
    // restore to, so undoing means taking our entry out.
  }

  try {
    const next: SettingsBlock = { ...settings };
    if (previous) next.statusLine = previous;
    else delete next.statusLine;
    writeSettingsBlock(paths.settingsPath, next);
    return { ok: true, restored: previous ? 'previous' : 'removed' };
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
}
