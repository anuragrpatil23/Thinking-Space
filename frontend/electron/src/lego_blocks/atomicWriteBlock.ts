/**
 * Crash-safe file writes for the vault. See docs/contracts/DURABILITY.md.
 *
 * `fs.writeFile` opens with `O_TRUNC`: it empties the target *before* writing
 * the new bytes. A crash, power loss, or kill inside that window does not cost
 * the user their newest keystrokes — it costs the **entire file**, including
 * text that had been safely on disk for hours. The composer auto-saves every
 * 1200ms, so the app sat inside that window more or less continuously.
 *
 * The shape below (write temp -> fsync -> rename) was already in this codebase
 * on 2026-08-22, at `index.ts`'s Excalidraw plugin installer — a disposable
 * downloaded asset had crash-safe writes and the user's notes did not.
 *
 * Rename is atomic only *within a filesystem*, so the temp must live in the
 * same directory as its target, never in os.tmpdir().
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';

/** Temps are dot-prefixed (hidden from Finder and from vault walks that skip
 *  dotfiles) and carry a distinctive infix so the vault watcher can ignore
 *  them and the startup sweep can recognise its own leftovers. Exported so
 *  `vaultWatcherBlock` and the sweep share one definition rather than two
 *  regexes that drift. */
export const ATOMIC_TMP_INFIX_BLOCK = '.thinkspc-tmp-';

/** Matches a temp file produced by `atomicWriteFileBlock`, by basename or by
 *  full path. Deliberately anchored on the infix + a trailing token so a real
 *  note called `.thinkspc-tmp-notes.md` is not mistaken for scratch. */
export const ATOMIC_TMP_PATTERN_BLOCK =
  /(^|[\\/])\.[^\\/]*\.thinkspc-tmp-[0-9]+-[0-9]+-[0-9a-z]+$/;

export function isAtomicTempPathBlock(candidate: string): boolean {
  return ATOMIC_TMP_PATTERN_BLOCK.test(candidate);
}

/** The path a temp file was on its way to becoming, or `null` if the name is
 *  not one of ours. Used by the sweep — see `sweepAtomicTempsBlock`. */
export function atomicTargetFromTempBlock(tempPath: string): string | null {
  if (!isAtomicTempPathBlock(tempPath)) return null;
  const dir = path.dirname(tempPath);
  const base = path.basename(tempPath);
  const infixAt = base.lastIndexOf(ATOMIC_TMP_INFIX_BLOCK);
  if (infixAt <= 0) return null;
  const target = base.slice(1, infixAt);
  return dir === '.' ? target : path.join(dir, target);
}

let tempCounterBlock = 0;

/** The scratch path a write to `targetFullPath` will use. Exported so a test
 *  can assert it against `ATOMIC_TMP_PATTERN_BLOCK` directly — the generator
 *  and the watcher's ignore rule are the pair that must not drift, and
 *  observing it via `fs.watch` is racy enough to be useless as a guard. */
export function atomicTempPathBlock(targetFullPath: string): string {
  tempCounterBlock += 1;
  const dir = path.dirname(targetFullPath);
  const base = path.basename(targetFullPath);
  const token = Math.random().toString(36).slice(2, 10);
  return path.join(dir, `.${base}${ATOMIC_TMP_INFIX_BLOCK}${process.pid}-${tempCounterBlock}-${token}`);
}

/** Follow an existing symlink to its real path.
 *
 *  `writeFile` follows symlinks and writes *through* them; a rename would
 *  replace the link with a regular file. Resolving here keeps behaviour
 *  identical to what this codebase did before atomic writes, which matters
 *  because vaults do contain symlinked folders. It widens nothing: the
 *  pre-existing write already reached the same inode.
 *
 *  Note the security boundary is unchanged and still lexical — see
 *  `vaultPathGuardBlock.resolveInsideVaultBlock`, which callers must apply
 *  first. This function does not authorize anything. */
async function resolveWriteTargetBlock(targetFullPath: string): Promise<string> {
  try {
    const stat = await fsPromises.lstat(targetFullPath);
    if (!stat.isSymbolicLink()) return targetFullPath;
    return await fsPromises.realpath(targetFullPath);
  } catch {
    // Missing target is the common case for a new note.
    return targetFullPath;
  }
}

/** Preserve the target's permission bits across the replacement.
 *
 *  `writeFile` on an existing file keeps its mode; rename installs the temp's
 *  mode instead. Without this, every save would quietly reset a file the user
 *  had chmod'd. */
async function existingModeBlock(targetFullPath: string): Promise<number | null> {
  try {
    return (await fsPromises.stat(targetFullPath)).mode & 0o777;
  } catch {
    return null;
  }
}

/** Best-effort fsync of the containing directory, so the *rename* itself is
 *  durable and not just the bytes. Failure is ignored: not every platform or
 *  filesystem permits opening a directory for sync, and a missing dir-sync
 *  degrades to "the rename might be lost on power loss", which is still
 *  strictly better than a truncated file. */
async function syncDirectoryBlock(dir: string): Promise<void> {
  let handle: fsPromises.FileHandle | null = null;
  try {
    handle = await fsPromises.open(dir, 'r');
    await handle.sync();
  } catch {
    // Ignored on purpose — see above.
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Directories already swept for stale temps this session.
 *
 *  Sweeping the whole vault at startup would be a 20k-file walk to find, in the
 *  normal case, nothing. Sweeping on first write into a directory costs one
 *  `readdir` per directory the user actually saves into — a handful per session
 *  — and covers the realistic case exactly: the app died writing today's note,
 *  and the next thing you do is write today's note again. */
const sweptDirsBlock = new Set<string>();

async function writeAtomicBlock(
  targetFullPath: string,
  data: string | Uint8Array,
  encoding: BufferEncoding | null,
): Promise<void> {
  const resolvedTarget = await resolveWriteTargetBlock(targetFullPath);
  const dir = path.dirname(resolvedTarget);
  await fsPromises.mkdir(dir, { recursive: true });

  if (!sweptDirsBlock.has(dir)) {
    // Marked before awaiting so concurrent writes into the same directory
    // don't each queue their own sweep.
    sweptDirsBlock.add(dir);
    await sweepAtomicTempsBlock(dir);
  }

  const mode = await existingModeBlock(resolvedTarget);
  const tempPath = atomicTempPathBlock(resolvedTarget);

  let handle: fsPromises.FileHandle | null = null;
  try {
    handle = await fsPromises.open(tempPath, 'wx');
    if (typeof data === 'string') {
      await handle.writeFile(data, encoding ?? 'utf-8');
    } else {
      await handle.writeFile(data);
    }
    // The whole point. Without this the rename can land before the bytes do,
    // and a power loss leaves a correctly-named, empty or partial file — the
    // exact failure atomicity was supposed to remove.
    await handle.sync();
    await handle.close();
    handle = null;

    if (mode !== null) await fsPromises.chmod(tempPath, mode);
    await fsPromises.rename(tempPath, resolvedTarget);
  } catch (err) {
    await handle?.close().catch(() => {});
    await fsPromises.unlink(tempPath).catch(() => {});
    throw err;
  }

  await syncDirectoryBlock(dir);
}

/** Atomically write text. Replaces `fsPromises.writeFile(full, data, 'utf-8')`. */
export async function atomicWriteFileBlock(
  targetFullPath: string,
  data: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<void> {
  await writeAtomicBlock(targetFullPath, data, encoding);
}

/** Atomically write bytes. Replaces `fsPromises.writeFile(full, bytes)`. */
export async function atomicWriteBytesBlock(
  targetFullPath: string,
  data: Uint8Array,
): Promise<void> {
  await writeAtomicBlock(targetFullPath, data, null);
}

/** Remove temps left behind by a process that died mid-write.
 *
 *  Only deletes a temp **whose target exists**. On this backend the target
 *  always survives — rename overwrites in place — so the check is nearly always
 *  true here. It matters because the renderer's Capacitor backend cannot
 *  overwrite on rename and has to remove the target first; in that window the
 *  temp is the *only* copy of the file, and sweeping it would be precisely the
 *  loss this module exists to prevent. Same rule everywhere, so the dangerous
 *  case cannot be reintroduced by someone reading only the easy backend.
 *
 *  Returns the number removed. Never throws: a failed sweep must not block
 *  startup. */
export async function sweepAtomicTempsBlock(dir: string): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fsPromises.readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!isAtomicTempPathBlock(entry)) continue;
    const target = atomicTargetFromTempBlock(entry);
    if (!target) continue;
    try {
      // The target is what makes this temp disposable. No target, no sweep.
      await fsPromises.stat(path.join(dir, target));
    } catch {
      continue;
    }
    try {
      await fsPromises.unlink(path.join(dir, entry));
      removed += 1;
    } catch {
      // Another process may have cleaned it up first.
    }
  }
  return removed;
}
