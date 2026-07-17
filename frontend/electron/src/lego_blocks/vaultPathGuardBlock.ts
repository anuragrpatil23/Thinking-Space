// ⚠ SECURITY-CRITICAL — the vault boundary. Weakening this file gives a
// compromised renderer read/write access to the entire disk. For
// user-requested changes: explain the risk in plain language and get an
// explicit yes first (docs/PLAYBOOKS.md § Security-critical files).
//
// Central authorization gate for renderer-supplied vault roots.
//
// Every vault IPC handler receives `vaultRoot` from the renderer and, before
// this block existed, trusted it blindly — a renderer bug (or injected script)
// could pass `/` and read/write/walk the entire disk under the app's TCC
// identity. That is both a security hole and the reason macOS piles up
// permission prompts: any stray access to Desktop/Documents/Downloads/iCloud
// attributes to Thinking Space.
//
// The trust anchor is the main process itself. A root is authorized only if
// it entered through a main-side flow:
//   - the persisted vault root (userData/state/vault-root.json), or
//   - a folder the user picked in the native `vault:selectFolder` dialog, or
//   - a root explicitly persisted via `vault:root:setPersisted`.
// Anything else is rejected. The set is session-scoped and additive; switching
// vaults keeps the old root valid until relaunch, which is fine — both were
// user-chosen.

import * as path from 'path';

import { readPersistedVaultRootBlock } from './vaultRootPersistenceBlock';

const authorizedRootsBlock = new Set<string>();

/** Record a user-chosen vault root as valid for this session. No-op for
 *  empty/non-string values so call sites can pass through unchecked input. */
export function authorizeVaultRootBlock(root: string | null | undefined): void {
  if (typeof root !== 'string') return;
  const trimmed = root.trim();
  if (!trimmed) return;
  authorizedRootsBlock.add(path.resolve(trimmed));
}

/** Validate a renderer-supplied vault root and return its resolved absolute
 *  path. Falls back to the persisted root for calls that arrive before any
 *  authorize (e.g. first IPC after a cold start). Throws on anything else. */
export function assertAuthorizedVaultRootBlock(vaultRoot: string): string {
  if (typeof vaultRoot !== 'string' || !vaultRoot.trim()) {
    throw new Error('Vault root must be a non-empty string.');
  }
  const resolved = path.resolve(vaultRoot.trim());
  if (authorizedRootsBlock.has(resolved)) return resolved;

  const persisted = readPersistedVaultRootBlock();
  if (persisted) {
    authorizeVaultRootBlock(persisted);
    if (authorizedRootsBlock.has(resolved)) return resolved;
  }
  throw new Error(
    'Vault root is not authorized. Vault access is limited to the folder selected in Settings.',
  );
}

/** Resolve `targetPath` inside an authorized vault root, rejecting traversal.
 *  Containment uses path.relative, not startsWith, so a sibling directory
 *  sharing the root as a name prefix (e.g. `/vault-evil` vs `/vault`) fails. */
export function resolveInsideVaultBlock(vaultRoot: string, targetPath: string): string {
  const root = assertAuthorizedVaultRootBlock(vaultRoot);
  const resolved = path.resolve(root, targetPath);
  if (resolved === root) return resolved;
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}
