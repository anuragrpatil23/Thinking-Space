/**
 * Vault filesystem watcher. Wraps chokidar with a single watcher per vault
 * root, ref-counted across windows. Emits change events back to renderers
 * via the supplied broadcast function.
 */

import * as chokidar from 'chokidar';
import * as path from 'path';

export type VaultWatchEventKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface VaultWatchEvent {
  kind: VaultWatchEventKind;
  path: string;
}

interface WatcherEntry {
  watcher: chokidar.FSWatcher;
  refCount: number;
}

const watchers = new Map<string, WatcherEntry>();

const IGNORED_GLOBS: RegExp[] = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])\.obsidian[\\/]workspace/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
  /(^|[\\/])\.trash([\\/]|$)/,
  /(^|[\\/])\.thinkspc[\\/]cache/,
  // App-managed state, not user content. `home-snapshot.json` in particular is
  // regenerated after every vault sync, so watching it closed a feedback loop:
  // sync writes the snapshot -> watcher reports it -> renderer syncs -> repeat.
  // Self-write suppression was supposed to break that, but its window is 3s
  // and polled events arrived at 2.3s+, so it missed intermittently and the
  // loop sustained itself. Measured 2026-08-11: this file was being rewritten
  // every ~2s (37KB, into an iCloud-synced folder) with the app fully idle.
  /(^|[\\/])\.thinking-space([\\/]|$)/,
];

function isIgnored(p: string): boolean {
  return IGNORED_GLOBS.some((rx) => rx.test(p));
}

function normalizeVaultRoot(vaultRoot: string): string {
  return path.resolve(vaultRoot);
}

export interface StartVaultWatcherBlockOptions {
  /** Called for each event after chokidar's own internal batching. */
  onEvent: (vaultRoot: string, event: VaultWatchEvent) => void;
}

export function startVaultWatcherBlock(
  rawVaultRoot: string,
  options: StartVaultWatcherBlockOptions,
): { ok: true } | { ok: false; error: string } {
  const vaultRoot = normalizeVaultRoot(rawVaultRoot);
  const existing = watchers.get(vaultRoot);
  if (existing) {
    existing.refCount++;
    return { ok: true };
  }

  // NEVER enable polling here. This watcher previously forced
  // `usePolling: true, interval: 2000, depth: 99` for iCloud vaults, on the
  // belief that iCloud-backed paths don't emit native FSEvents for external
  // writes (e.g. a CLI process editing files while the app is open).
  //
  // That belief was tested on 2026-08-11 against a real 20,842-file iCloud
  // vault and is false for local external writes: an unrelated Node process
  // creating, appending to, and deleting a file in the vault produced add /
  // change / unlink events with polling off, at **0.1% of one core** at idle.
  // With polling on, the main process sat at 67-84% CPU while completely idle
  // — ~10k stat syscalls/second plus a full JS diff, forever, measured with
  // `/usr/bin/sample` (libuv workers in scandir/stat, main thread in
  // node::fs::AfterStat). That was the single largest energy cost in the app.
  //
  // The case FSEvents may still miss is a change syncing *down* from another
  // device. That is covered by the focus/visibilitychange reconciliation in
  // `vaultLiveRefreshOrch` — a full vault walk costs ~0.13s warm, so it is
  // affordable on focus and ruinous at 2s intervals.
  try {
    const watcher = chokidar.watch(vaultRoot, {
      ignored: (p: string) => isIgnored(p),
      ignoreInitial: true,
      persistent: true,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      depth: 99,
    });

    const dispatch = (kind: VaultWatchEventKind) => (filePath: string) => {
      if (isIgnored(filePath)) return;
      options.onEvent(vaultRoot, { kind, path: filePath });
    };

    watcher.on('add', dispatch('add'));
    watcher.on('change', dispatch('change'));
    watcher.on('unlink', dispatch('unlink'));
    watcher.on('addDir', dispatch('addDir'));
    watcher.on('unlinkDir', dispatch('unlinkDir'));
    watcher.on('error', (err: unknown) => {
      console.warn('[vaultWatcher] error', err);
    });

    watchers.set(vaultRoot, { watcher, refCount: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function stopVaultWatcherBlock(rawVaultRoot: string): { ok: true } {
  const vaultRoot = normalizeVaultRoot(rawVaultRoot);
  const entry = watchers.get(vaultRoot);
  if (!entry) return { ok: true };
  entry.refCount--;
  if (entry.refCount <= 0) {
    void entry.watcher.close();
    watchers.delete(vaultRoot);
  }
  return { ok: true };
}

export function stopAllVaultWatcherBlocks(): void {
  for (const [, entry] of watchers) {
    void entry.watcher.close();
  }
  watchers.clear();
}
