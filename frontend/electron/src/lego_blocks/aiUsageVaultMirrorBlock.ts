import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveInsideVaultBlock } from './vaultPathGuardBlock';
import { resolveWriteAiRawEnabledBlock } from './vaultWritePrefsPersistenceBlock';
import { AI_SESSIONS_DIR_BLOCK, AI_USAGE_LOG_DIR_BLOCK } from './aiUsagePathsBlock';

/**
 * Mirror the AI usage capture from this machine's home directory into the vault.
 *
 * Why a copy exists at all. The status line writes to `~/.thinking-space`
 * because it must: it is a bash script spawned per message, in a shell we do
 * not control, on platforms we cannot test — it has no idea where the vault is
 * and every ounce of logic added to it is a liability (the Windows write-path
 * bug is what that liability looks like). So the script captures to a fixed
 * local landing zone and the app, which knows the vault and the opt-in, moves
 * it on. Hooks capture; the app derives — promotion is the transport half of
 * that rule.
 *
 * DERIVATION.md permits a copy only to reach somewhere the value cannot be
 * derived, and asks you to name the device that needs it. Two answers here, and
 * both are real:
 *
 *   - **The iPhone and iPad.** They have no `~/.thinking-space` from the Mac
 *     and no Claude Code at all, so plan usage is structurally desktop-only
 *     until the record travels with the vault.
 *   - **Next year.** Home snapshots are pruned at 30 days and the usage log at
 *     365. The curve cannot be reconstructed after the fact — that is why the
 *     script writes it as it happens — so the local copy expiring is a
 *     permanent hole unless something durable holds it first.
 *
 * The home copy is never moved or deleted, only read: it is the landing zone
 * the script must always be able to write to, whether or not a vault is open,
 * synced, or opted in. Promotion is idempotent sync, not a handoff.
 */

/** Providers with capture under both roots. Codex's samples are written by the
 *  app rather than the status line, but they land in the same shape. */
const PROVIDERS_BLOCK = ['claude', 'codex'] as const;

/** Turns a vault-relative path into an absolute one, rejecting traversal. In
 *  production this is the vault guard; in tests, a joiner over a temp dir. */
export type ResolveTargetBlock = (relPath: string) => string;

/** Where a provider's mirror lives inside the vault. Sits under the existing
 *  raw-signal tree, so it rides `writeAiRaw` alongside every other harvest. */
function vaultProviderDirBlock(provider: string): string {
  return path.posix.join('ai-activity', 'raw-sessions', provider);
}

/**
 * A stable id for this *machine*, kept beside the data it names.
 *
 * Deliberately not the renderer's `getReadingInstallIdBlock` (localStorage, so
 * per profile) and not `userData` (also per profile). Rate limits are
 * account-wide: two profiles open on one Mac capture the same numbers, so a
 * per-profile id would file one machine's samples under two names and double
 * every row a reader sees. The machine is the real unit here.
 */
function machineInstallIdBlock(): string {
  const file = path.join(os.homedir(), '.thinking-space', 'install-id');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{6,}$/.test(existing)) return existing;
  } catch {
    // Not minted yet — fall through.
  }
  const minted = Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 16).toString(16)).join('');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${minted}\n`);
  } catch {
    // Unwritable home is survivable: the id is only a filename suffix, and an
    // unstable one costs an extra file per run rather than any lost data.
  }
  return minted;
}

/** Copy through a temp file so a reader — or an iCloud sync racing us — never
 *  sees a half-written mirror. Mirrors the status line's own write discipline. */
function copyAtomicBlock(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.copyFileSync(source, tmp);
  fs.renameSync(tmp, target);
}

/**
 * Session snapshots: one file per session id, copied when the source is newer.
 *
 * A session id is stratum-1 — Claude Code's own UUID — so the mirror is filed
 * under an address no grouping change can move, and it joins directly against
 * the digests already sitting in this tree.
 */
function promoteSessionSnapshotsBlock(resolveTarget: ResolveTargetBlock, provider: string): number {
  const sourceDir = path.join(AI_SESSIONS_DIR_BLOCK, provider);
  let copied = 0;
  let names: string[];
  try {
    names = fs.readdirSync(sourceDir);
  } catch {
    return 0; // Nothing captured for this provider yet.
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    // The script already guards this charset, but the value reaches us through
    // a filename and ends up in a vault path — validate at the boundary that
    // builds the path, not only at the one that wrote it.
    if (!/^[A-Za-z0-9-]+\.json$/.test(name)) continue;
    try {
      const source = path.join(sourceDir, name);
      const target = resolveTarget(
        path.posix.join(vaultProviderDirBlock(provider), 'sessions', name),
      );
      const sourceStat = fs.statSync(source);
      let targetMtime = -1;
      try {
        targetMtime = fs.statSync(target).mtimeMs;
      } catch {
        // Not mirrored yet.
      }
      if (sourceStat.mtimeMs <= targetMtime) continue;
      copyAtomicBlock(source, target);
      copied += 1;
    } catch {
      // One unreadable or unwritable file must not abandon the rest.
    }
  }
  return copied;
}

/**
 * Usage history: one file per month **per machine**.
 *
 * The per-machine suffix is not optional. The vault syncs through iCloud, and a
 * single `2026-09.jsonl` appended by a Mac and a laptop is a conflict copy
 * waiting to happen — iCloud resolves a two-writer collision by keeping both
 * under a renamed sibling, which no reader here would ever look at. Same
 * discipline the in-app reading log adopted, and for the same reason.
 *
 * It differs from reading spans in one way worth knowing: reading is genuinely
 * per-device, while rate limits are account-wide, so two machines write
 * near-duplicate rows for the same account. That makes a reader's job merging
 * rather than concatenating — dedupe by sample bucket, not by file. Nothing
 * reads these yet, so no merge exists to get wrong; the filename is what keeps
 * writing one possible later.
 */
function promoteUsageLogBlock(resolveTarget: ResolveTargetBlock, provider: string, installId: string): number {
  const sourceDir = path.join(AI_USAGE_LOG_DIR_BLOCK, provider);
  let copied = 0;
  let names: string[];
  try {
    names = fs.readdirSync(sourceDir);
  } catch {
    return 0;
  }

  for (const name of names) {
    const match = /^(\d{4}-\d{2})\.jsonl$/.exec(name);
    if (!match) continue;
    try {
      const source = path.join(sourceDir, name);
      const target = resolveTarget(
        path.posix.join(
          vaultProviderDirBlock(provider),
          'usage',
          `${match[1]}.${installId}.jsonl`,
        ),
      );
      const sourceSize = fs.statSync(source).size;
      let targetSize = -1;
      try {
        targetSize = fs.statSync(target).size;
      } catch {
        // Not mirrored yet.
      }
      // Append-only at the source, so a mirror is current exactly when it is
      // the same size. Never write a *smaller* file over a larger one: a
      // cleared or truncated home directory would otherwise erase history the
      // vault was holding precisely because home could not keep it. Absence is
      // not evidence — a shrunken source says nothing about the samples the
      // mirror already has.
      if (sourceSize <= targetSize) continue;
      copyAtomicBlock(source, target);
      copied += 1;
    } catch {
      // Same as above: one bad month never stops the others.
    }
  }
  return copied;
}

/**
 * Promote every provider's capture into the vault. Best-effort and idempotent —
 * safe to call on every launch.
 *
 * Returns the number of files written, for the caller's log. Zero is the normal
 * steady state: nothing has changed since the last run.
 */
export function promoteAiUsageToVaultBlock(vaultRoot: string): number {
  if (!resolveWriteAiRawEnabledBlock(vaultRoot)) return 0;
  return promoteAiUsageCaptureBlock(
    (relPath) => resolveInsideVaultBlock(vaultRoot, relPath),
    machineInstallIdBlock(),
  );
}

/**
 * The copy itself, with the vault behind a resolver.
 *
 * Split out so the behaviour that matters — what gets copied, what is skipped,
 * and above all what is never overwritten — can be tested against a temp
 * directory instead of an authorized vault root and a running Electron app.
 * The resolver is the containment boundary in production, so a test passing a
 * plain joiner exercises the copy logic and nothing else.
 */
export function promoteAiUsageCaptureBlock(
  resolveTarget: ResolveTargetBlock,
  installId: string,
): number {
  let copied = 0;
  for (const provider of PROVIDERS_BLOCK) {
    copied += promoteSessionSnapshotsBlock(resolveTarget, provider);
    copied += promoteUsageLogBlock(resolveTarget, provider, installId);
  }
  return copied;
}
