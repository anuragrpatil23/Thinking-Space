import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// Persists user preferences for what Thinking Space is allowed to write into
// the user's vault. Mirrors opensourceAiBaseUrlPersistenceBlock — main-process
// is the source of truth because the electron startup path (vault:watch:start)
// needs the value before any renderer has mounted.
//
// Prefs are keyed PER VAULT ROOT. With workspace profiles, each profile owns
// its own vault — a single app-global flag would leak one vault's opt-in into
// every other profile's vault (the bug that grew `ai-activity/` in every new
// profile). The file keeps the legacy top-level fields untouched so older
// builds still parse it, but current code only reads/writes `vaults`.
//
// Both sub-trees now live under one `ai-activity/` folder in the vault:
// harvested raw signals go to `ai-activity/raw-sessions/…`, AI-derived digests
// to `ai-activity/{atoms,chains,ranges}`, hand-logged sessions to
// `ai-activity/manual-sessions.jsonl`. The two opt-ins stay distinct because
// they carry different data-protection semantics (below).
//
// `writeAiRaw` gates the harvesters that dump raw signals under
// `ai-activity/raw-sessions/` (Apple Screen Time mirror, GoodNotes reading
// log). `null` means this vault has never made a choice — first read runs a
// one-time per-vault migration: if the vault already holds harvested raw (the
// new `ai-activity/raw-sessions/` dir, or the legacy `ai-raw/` / `ai_raw/`
// dirs) we set
// `true` (existing installs keep harvesting — turning it off silently would
// lose data past the macOS 28-day cliff), otherwise `false`.
//
// `writeAiActivity` gates the AI-derived digests mirror at
// `<vaultRoot>/ai-activity/{atoms,chains,ranges}`. Strictly opt-in — no
// dir-exists migration: the mirror is a derived, rebuildable backup (the
// sidecar cache is the hot path), and the pre-per-vault bug left stray
// `ai-activity/` dirs in fresh profile vaults, so "dir exists" is not evidence
// of intent. Default off; reads from an existing dir keep working either way.

interface VaultWritePrefEntryBlock {
  writeAiRaw: boolean | null;
  writeAiActivity: boolean | null;
}

interface PersistedVaultWritePrefsPayloadBlock {
  // Legacy app-global fields — preserved verbatim for old builds, never
  // consulted by current code.
  writeAiRaw: boolean | null;
  writeAiActivity: boolean | null;
  vaults: Record<string, VaultWritePrefEntryBlock>;
}

const PERSISTED_VAULT_WRITE_PREFS_RELATIVE_PATH_BLOCK = path.join(
  'state',
  'vault-write-prefs.json',
);

function getPersistedVaultWritePrefsPathBlock(): string {
  return path.join(
    app.getPath('userData'),
    PERSISTED_VAULT_WRITE_PREFS_RELATIVE_PATH_BLOCK,
  );
}

function normalizeTristateBooleanBlock(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

// Canonical map key for a vault root — resolves relative segments and drops
// the trailing separator so `/vault/` and `/vault` land on the same entry.
function vaultPrefKeyBlock(vaultRoot: string): string {
  const resolved = path.resolve(vaultRoot.trim());
  return resolved.length > 1 && resolved.endsWith(path.sep)
    ? resolved.slice(0, -1)
    : resolved;
}

function normalizeVaultEntryBlock(value: unknown): VaultWritePrefEntryBlock {
  const record = (value && typeof value === 'object' ? value : {}) as Partial<VaultWritePrefEntryBlock>;
  return {
    writeAiRaw: normalizeTristateBooleanBlock(record.writeAiRaw),
    writeAiActivity: normalizeTristateBooleanBlock(record.writeAiActivity),
  };
}

const EMPTY_PREFS: PersistedVaultWritePrefsPayloadBlock = {
  writeAiRaw: null,
  writeAiActivity: null,
  vaults: {},
};

export function readPersistedVaultWritePrefsBlock(): PersistedVaultWritePrefsPayloadBlock {
  const filePath = getPersistedVaultWritePrefsPathBlock();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return { ...EMPTY_PREFS, vaults: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedVaultWritePrefsPayloadBlock>;
    const vaults: Record<string, VaultWritePrefEntryBlock> = {};
    if (parsed.vaults && typeof parsed.vaults === 'object') {
      for (const [key, entry] of Object.entries(parsed.vaults)) {
        vaults[key] = normalizeVaultEntryBlock(entry);
      }
    }
    return {
      writeAiRaw: normalizeTristateBooleanBlock(parsed.writeAiRaw),
      writeAiActivity: normalizeTristateBooleanBlock(parsed.writeAiActivity),
      vaults,
    };
  } catch {
    return { ...EMPTY_PREFS, vaults: {} };
  }
}

function persistVaultWritePrefsBlock(payload: PersistedVaultWritePrefsPayloadBlock): void {
  const filePath = getPersistedVaultWritePrefsPathBlock();
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);
}

export function writeVaultWritePrefForVaultBlock(
  vaultRoot: string,
  patch: Partial<VaultWritePrefEntryBlock>,
): VaultWritePrefEntryBlock {
  const key = vaultPrefKeyBlock(vaultRoot);
  const current = readPersistedVaultWritePrefsBlock();
  const existing = current.vaults[key] ?? { writeAiRaw: null, writeAiActivity: null };
  const next: VaultWritePrefEntryBlock = {
    writeAiRaw:
      patch.writeAiRaw === undefined
        ? existing.writeAiRaw
        : normalizeTristateBooleanBlock(patch.writeAiRaw),
    writeAiActivity:
      patch.writeAiActivity === undefined
        ? existing.writeAiActivity
        : normalizeTristateBooleanBlock(patch.writeAiActivity),
  };
  current.vaults[key] = next;
  persistVaultWritePrefsBlock(current);
  return next;
}

// Returns the effective `writeAiRaw` value for this vault, applying the
// first-read migration when the vault has no stored choice. Safe to call from
// any harvest callsite — the migration write is idempotent.
export function resolveWriteAiRawEnabledBlock(vaultRoot: string): boolean {
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) return false;
  const entry = readPersistedVaultWritePrefsBlock().vaults[vaultPrefKeyBlock(vaultRoot)];
  if (entry && entry.writeAiRaw !== null) return entry.writeAiRaw;
  const existed =
    fs.existsSync(path.join(vaultRoot, 'ai-activity', 'raw-sessions'))
    || fs.existsSync(path.join(vaultRoot, 'ai-raw'))
    || fs.existsSync(path.join(vaultRoot, 'ai_raw'));
  const migrated = writeVaultWritePrefForVaultBlock(vaultRoot, { writeAiRaw: existed });
  return migrated.writeAiRaw === true;
}

// Effective `writeAiActivity` for this vault. Strictly opt-in — no migration
// heuristic; a vault mirrors digests only after the user flips the toggle in
// that profile's Settings.
export function resolveWriteAiActivityEnabledBlock(vaultRoot: string): boolean {
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) return false;
  const entry = readPersistedVaultWritePrefsBlock().vaults[vaultPrefKeyBlock(vaultRoot)];
  return entry?.writeAiActivity === true;
}

// Move a directory's contents into another, never clobbering an existing
// destination file (the legacy copy is left in place if a name collides, so
// no harvested data is ever overwritten). Recurses into subdirs and removes
// now-empty source dirs. Best-effort — any failure leaves the source intact
// for the next boot to retry.
function moveDirContentsBlock(srcDir: string, dstDir: string): void {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    try {
      if (entry.isDirectory()) {
        moveDirContentsBlock(src, dst);
      } else if (!fs.existsSync(dst)) {
        fs.renameSync(src, dst);
      }
    } catch {
      // Leave this entry for the next boot; keep migrating the rest.
    }
  }
  try {
    fs.rmdirSync(srcDir);
  } catch {
    // Non-empty (a collision kept a legacy copy) or sync-locked — fine.
  }
}

// One-shot fold of the legacy harvested-raw dirs (`ai-raw/`, and the even
// older snake_case `ai_raw/`) into the unified `ai-activity/raw-sessions/`
// tree we now write everywhere. Both legacy layouts nested everything under
// `<dir>/raw/`, so we lift `<dir>/raw` up to `ai-activity/raw-sessions`.
// Idempotent — no-op once the legacy dirs are gone. Called from the vault
// watcher startup path before any harvester runs so downstream code sees a
// single canonical directory. Silent on failure: the vault sits on iCloud for
// some users and a rename can lose to a sync intercept; we leave things as-is
// and try again next launch.
export function migrateAiRawIntoAiActivityBlock(vaultRoot: string): void {
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) return;
  const targetRaw = path.join(vaultRoot, 'ai-activity', 'raw-sessions');
  for (const legacyName of ['ai-raw', 'ai_raw']) {
    const legacyRoot = path.join(vaultRoot, legacyName);
    const legacyRaw = path.join(legacyRoot, 'raw');
    try {
      if (!fs.existsSync(legacyRaw)) continue;
      if (!fs.existsSync(targetRaw)) {
        // Fast path: no merge needed — hoist the whole raw/ dir in one rename.
        fs.mkdirSync(path.join(vaultRoot, 'ai-activity'), { recursive: true });
        fs.renameSync(legacyRaw, targetRaw);
      } else {
        moveDirContentsBlock(legacyRaw, targetRaw);
      }
      // Drop the now-empty legacy parent so it stops tripping the existence
      // checks (and stops looking like a live dir in the vault).
      try {
        fs.rmdirSync(legacyRoot);
      } catch {
        // Still holds something (a collision or a stray file) — leave it.
      }
    } catch {
      // Ignore — will retry on next boot.
    }
  }
}
