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
//   - The Claude Code transcript at
//     `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
//     The encoded-cwd segment is unknown to us (Claude Code derives it
//     from the invocation's cwd), so we scan every project dir under
//     `~/.claude/projects` and delete any `<sessionId>.jsonl` we find.
//
//   - The vault-side render dropped by the user's SessionEnd hook
//     (`~/.claude/hooks/render-session.sh`) at
//     `<vault>/ai_raw/raw/claude-code/YYYY-MM-DD_<sid8>[_slug].md`.
//     We match on the 8-char short id prefix so the date and slug parts
//     don't need to be known.
//
// This module is standalone ESM with no external deps beyond Node core,
// so it works identically from runner.mjs (imported at load time) and
// from the Electron main process (dynamic-imported at runtime).

import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();

export const CLAUDE_PROJECTS_DIR = join(HOME, '.claude', 'projects');

// Vault location where render-session.sh drops rendered session markdown.
// Kept in one place so both runner.mjs and the summarizer path point at the
// same location — if the user relocates the vault, only this constant moves.
export const VAULT_CLAUDE_SESSIONS_DIR = join(
  HOME,
  'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents',
  'Long-Term-Memory-iCloud', 'ai_raw', 'raw', 'claude-code',
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

  // 1. JSONL transcripts under ~/.claude/projects/<encoded-cwd>/<sid>.jsonl.
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

  // 2. Vault md mirror keyed by `YYYY-MM-DD_<sid8>[_slug].md`. We don't
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
