import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// Persists user preferences for what Thinking Space is allowed to write into
// the user's vault. Mirrors opensourceAiBaseUrlPersistenceBlock — main-process
// is the source of truth because the electron startup path (vault:watch:start)
// needs the value before any renderer has mounted.
//
// `writeAiRaw` gates the harvesters that dump raw signals under `ai-raw/` in
// the vault (Apple Screen Time mirror, GoodNotes reading log). `null` means
// the user has never made a choice — callers apply a one-time migration:
// if the vault already contains `ai-raw/` (or the legacy `ai_raw/` before
// the dir migration runs) we set `true` (preserve behavior for existing
// installs), otherwise `false` (opt-in for new users).

interface PersistedVaultWritePrefsPayloadBlock {
  writeAiRaw: boolean | null;
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

export function readPersistedVaultWritePrefsBlock(): PersistedVaultWritePrefsPayloadBlock {
  const filePath = getPersistedVaultWritePrefsPathBlock();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return { writeAiRaw: null };
    const parsed = JSON.parse(raw) as Partial<PersistedVaultWritePrefsPayloadBlock>;
    return { writeAiRaw: normalizeTristateBooleanBlock(parsed.writeAiRaw) };
  } catch {
    return { writeAiRaw: null };
  }
}

export function writePersistedVaultWritePrefsBlock(
  patch: Partial<PersistedVaultWritePrefsPayloadBlock>,
): PersistedVaultWritePrefsPayloadBlock {
  const current = readPersistedVaultWritePrefsBlock();
  const next: PersistedVaultWritePrefsPayloadBlock = {
    writeAiRaw:
      patch.writeAiRaw === undefined
        ? current.writeAiRaw
        : normalizeTristateBooleanBlock(patch.writeAiRaw),
  };
  const filePath = getPersistedVaultWritePrefsPathBlock();
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);
  return next;
}

// Returns the effective `writeAiRaw` value, applying the first-launch
// migration when the stored value is `null`. Safe to call from any harvest
// callsite — the migration write is idempotent.
export function resolveWriteAiRawEnabledBlock(vaultRoot: string): boolean {
  const current = readPersistedVaultWritePrefsBlock();
  if (current.writeAiRaw !== null) return current.writeAiRaw;
  const existed = vaultRoot.trim().length > 0
    && (
      fs.existsSync(path.join(vaultRoot, 'ai-raw'))
      || fs.existsSync(path.join(vaultRoot, 'ai_raw'))
    );
  const migrated = writePersistedVaultWritePrefsBlock({ writeAiRaw: existed });
  return migrated.writeAiRaw === true;
}

// One-shot rename of the legacy snake_case `ai_raw/` vault dir to the
// kebab-case `ai-raw/` we now write everywhere. Idempotent — no-op if the
// legacy path is absent or the new path already exists. Called from the
// vault watcher startup path before any harvester runs so downstream code
// sees a single canonical directory. Silent on failure: the vault sits on
// iCloud for some users and a rename can lose to a sync intercept; we
// simply leave things as-is and try again next launch.
export function migrateLegacyAiRawDirBlock(vaultRoot: string): void {
  if (typeof vaultRoot !== 'string' || vaultRoot.trim().length === 0) return;
  const legacy = path.join(vaultRoot, 'ai_raw');
  const current = path.join(vaultRoot, 'ai-raw');
  try {
    if (!fs.existsSync(legacy)) return;
    if (fs.existsSync(current)) return;
    fs.renameSync(legacy, current);
  } catch {
    // Ignore — will retry on next boot.
  }
}
