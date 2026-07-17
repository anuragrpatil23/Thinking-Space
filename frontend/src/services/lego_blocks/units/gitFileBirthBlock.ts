// Birth timestamps for vault files from git history.
//
// One `git log` pass over the whole history (newest → oldest) collecting every
// file-add. A path can be added more than once (delete + re-add, moves); since
// we iterate newest-first and overwrite, the oldest add wins — that's the
// note's true birth. Renamed files reset their birth to the move date, which
// is acceptable for the cheap attribution the graph timeline needs.
//
// Desktop-only (uses the vault:git IPC). Callers fall back to fs ctime when
// this returns an empty map.

export async function loadGitFileBirthsBlock(
  vaultRoot: string,
  /** Git pathspecs to limit the scan; empty array = the whole tree (code graph). */
  pathspecs: string[] = ['*.md'],
): Promise<Map<string, number>> {
  const births = new Map<string, number>()
  const git = window.electronAPI?.git
  if (!git) return births

  // \x01 marks commit-timestamp lines so they can't collide with file paths.
  // core.quotepath=off keeps non-ASCII paths readable instead of escaped.
  const out = await git(vaultRoot, [
    '-c', 'core.quotepath=off',
    'log',
    '--diff-filter=A',
    '--name-only',
    '--format=%x01%ct',
    ...(pathspecs.length > 0 ? ['--', ...pathspecs] : []),
  ])

  let currentMs = 0
  for (const rawLine of out.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) continue
    if (line.charCodeAt(0) === 1) {
      const ts = parseInt(line.slice(1), 10)
      currentMs = Number.isFinite(ts) ? ts * 1000 : 0
      continue
    }
    if (currentMs > 0) births.set(line, currentMs)
  }
  return births
}
