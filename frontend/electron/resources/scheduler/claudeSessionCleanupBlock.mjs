// Shared cleanup for Claude Code CLI sessions. Two consumers:
//
//   1. Scheduler runner (runner.mjs) — one-shot anchor/autocommit/telegram
//      jobs that opt-in via `spec.execution.cleanupSession = true` so the
//      transcript never leaks into the AI activity panel.
//
//   2. Electron main process (claudeCliBlock.ts) — the summarizer's
//      internal `claude -p` invocations for chain digests, day atoms, and
//      range summaries. These are strictly implementation detail; they
//      must leave no trace, otherwise the summarizer eats its own tail
//      (its own invocations show up as new "activity" in the next run).
//
// Given a session id, we remove:
//
//   - Its entries in `~/.claude/history.jsonl`. Native
//     `--no-session-persistence` does not write this log on current Claude
//     CLI versions, but legacy/plain invocations do; the activity importer
//     reconstructs deleted sessions from it, so cleanup removes it too.
//
//   - The Claude Code transcript at
//     `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
//     The encoded-cwd segment is unknown to us (Claude Code derives it
//     from the invocation's cwd), so we scan every project dir under
//     `~/.claude/projects` and delete any `<sessionId>.jsonl` we find.
//
//   - The vault-side render dropped by the user's SessionEnd hook
//     (`~/.claude/hooks/render-session.sh`) at
//     `<vault>/ai-activity/raw-sessions/claude-code/YYYY-MM-DD_<sid8>[_slug].md`.
//     We match on the 8-char short id prefix so the date and slug parts
//     don't need to be known.
//
// This module is standalone ESM with no external deps beyond Node core,
// so it works identically from runner.mjs (imported at load time) and
// from the Electron main process (dynamic-imported at runtime).

import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

export const CLAUDE_PROJECTS_DIR = join(HOME, '.claude', 'projects');
export const CLAUDE_HISTORY_PATH = join(HOME, '.claude', 'history.jsonl');

// Vault location where render-session.sh drops rendered session markdown.
// Kept in one place so both runner.mjs and the summarizer path point at the
// same location — if the user relocates the vault, only this constant moves.
export const VAULT_CLAUDE_SESSIONS_DIR = join(
  HOME,
  'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents',
  'Long-Term-Memory-iCloud', 'ai-activity', 'raw-sessions', 'claude-code',
);

/**
 * Delete every trace of a Claude Code CLI session identified by `sessionId`.
 * Best-effort: unlink failures are swallowed so a race with the OS or a
 * concurrent process never bubbles up as an error to the caller. Returns the
 * absolute paths of every file we actually removed so callers can log it.
 */
export function deleteClaudeSessionFilesBlock(sessionId) {
  const removed = [];
  if (!sessionId || typeof sessionId !== 'string') return removed;

  // 1. Claude's permanent prompt log. Native no-persistence currently skips
  // it, but legacy/plain CLI invocations write here. AI activity deliberately
  // rebuilds missing transcripts from this log, so cleanup must remove any
  // legacy entry before deleting the corresponding transcript.
  // Preserve malformed lines rather than risking unrelated history if a
  // future CLI version changes its record shape.
  if (existsSync(CLAUDE_HISTORY_PATH)) {
    try {
      const source = readFileSync(CLAUDE_HISTORY_PATH, 'utf8');
      const lines = source.split(/\r?\n/);
      let changed = false;
      const kept = lines.filter((line) => {
        if (!line) return true;
        try {
          const entry = JSON.parse(line);
          if (entry?.sessionId === sessionId) {
            changed = true;
            return false;
          }
        } catch { /* preserve unknown/malformed history lines */ }
        return true;
      });
      if (changed) {
        const next = kept.join('\n');
        const temp = `${CLAUDE_HISTORY_PATH}.${process.pid}.tmp`;
        writeFileSync(temp, next, 'utf8');
        renameSync(temp, CLAUDE_HISTORY_PATH);
        removed.push(CLAUDE_HISTORY_PATH);
      }
    } catch { /* best effort */ }
  }

  // 2. JSONL transcripts under ~/.claude/projects/<encoded-cwd>/<sid>.jsonl.
  if (existsSync(CLAUDE_PROJECTS_DIR)) {
    let projects;
    try { projects = readdirSync(CLAUDE_PROJECTS_DIR); } catch { projects = []; }
    for (const project of projects) {
      const candidate = join(CLAUDE_PROJECTS_DIR, project, `${sessionId}.jsonl`);
      if (existsSync(candidate)) {
        try { unlinkSync(candidate); removed.push(candidate); }
        catch { /* best effort */ }
      }
    }
  }

  // 3. Vault md mirror keyed by `YYYY-MM-DD_<sid8>[_slug].md`. We don't
  // know the date/slug, so match on the 8-char short-id prefix.
  if (existsSync(VAULT_CLAUDE_SESSIONS_DIR)) {
    const shortId = sessionId.slice(0, 8);
    let files;
    try { files = readdirSync(VAULT_CLAUDE_SESSIONS_DIR); } catch { files = []; }
    for (const name of files) {
      if (!/^\d{4}-\d{2}-\d{2}_/.test(name)) continue;
      const afterDate = name.slice(11); // strip "YYYY-MM-DD_"
      if (afterDate === `${shortId}.md` || afterDate.startsWith(`${shortId}_`)) {
        const p = join(VAULT_CLAUDE_SESSIONS_DIR, name);
        try { unlinkSync(p); removed.push(p); }
        catch { /* best effort */ }
      }
    }
  }

  return removed;
}
