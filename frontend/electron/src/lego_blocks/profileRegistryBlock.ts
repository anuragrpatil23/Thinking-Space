import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { readPersistedVaultRootBlock, writePersistedVaultRootBlock } from './vaultRootPersistenceBlock';

// Chrome-style workspace profiles: each profile is a vault root + a display
// identity (name, accent color) that opens in its own window. The default
// profile keeps the legacy single-vault behavior — its vault root stays in
// state/vault-root.json (written by the existing vault:root:setPersisted flow)
// and its window runs on Electron's default session, so existing installs
// keep their IndexedDB cache and localStorage untouched. Only non-default
// profiles get their own persist: partition.

export const DEFAULT_PROFILE_ID_BLOCK = 'default';

export interface ProfileRecordBlock {
  id: string;
  name: string;
  /** null for the default profile — its root lives in state/vault-root.json. */
  vaultRoot: string | null;
  /** CSS color for the window's sidebar accent; null = no accent. */
  accentColor: string | null;
}

interface ProfilesFilePayloadBlock {
  profiles: ProfileRecordBlock[];
}

const PROFILES_RELATIVE_PATH_BLOCK = path.join('state', 'profiles.json');

function getProfilesFilePathBlock(): string {
  return path.join(app.getPath('userData'), PROFILES_RELATIVE_PATH_BLOCK);
}

function normalizeNameBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : null;
}

function normalizeAccentColorBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Only accept simple color literals (hex or named) — this string ends up in
  // a CSS custom property in the renderer, so keep the grammar tight.
  if (!/^#[0-9a-fA-F]{3,8}$/.test(trimmed) && !/^[a-zA-Z]{1,24}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeVaultRootBlock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : null;
}

function synthesizeDefaultProfileBlock(): ProfileRecordBlock {
  return { id: DEFAULT_PROFILE_ID_BLOCK, name: 'Main', vaultRoot: null, accentColor: null };
}

function normalizeRecordBlock(value: unknown): ProfileRecordBlock | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id.trim() : null;
  if (!id) return null;
  const isDefault = id === DEFAULT_PROFILE_ID_BLOCK;
  const vaultRoot = isDefault ? null : normalizeVaultRootBlock(record.vaultRoot);
  if (!isDefault && !vaultRoot) return null;
  return {
    id,
    name: normalizeNameBlock(record.name) ?? (isDefault ? 'Main' : 'Profile'),
    vaultRoot,
    accentColor: normalizeAccentColorBlock(record.accentColor),
  };
}

function readProfilesFileBlock(): ProfileRecordBlock[] {
  try {
    const raw = fs.readFileSync(getProfilesFilePathBlock(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProfilesFilePayloadBlock>;
    if (!Array.isArray(parsed.profiles)) return [];
    const seen = new Set<string>();
    const records: ProfileRecordBlock[] = [];
    for (const entry of parsed.profiles) {
      const normalized = normalizeRecordBlock(entry);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      records.push(normalized);
    }
    return records;
  } catch {
    return [];
  }
}

function writeProfilesFileBlock(profiles: ProfileRecordBlock[]): void {
  const filePath = getProfilesFilePathBlock();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: ProfilesFilePayloadBlock = { profiles };
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

/** All profiles, default first. The default record is synthesized if the file
 *  doesn't mention it, so callers can always rely on it existing. */
export function listProfilesBlock(): ProfileRecordBlock[] {
  const stored = readProfilesFileBlock();
  const defaultRecord = stored.find((p) => p.id === DEFAULT_PROFILE_ID_BLOCK) ?? synthesizeDefaultProfileBlock();
  const rest = stored.filter((p) => p.id !== DEFAULT_PROFILE_ID_BLOCK);
  return [defaultRecord, ...rest];
}

export function getProfileBlock(profileId: string): ProfileRecordBlock | null {
  return listProfilesBlock().find((p) => p.id === profileId) ?? null;
}

/** The vault root a profile's windows operate on. */
export function resolveProfileVaultRootBlock(profile: ProfileRecordBlock): string | null {
  if (profile.id === DEFAULT_PROFILE_ID_BLOCK) return readPersistedVaultRootBlock();
  return profile.vaultRoot;
}

/** App-page session partition; null = Electron default session. */
export function getProfileAppPartitionBlock(profileId: string): string | null {
  return profileId === DEFAULT_PROFILE_ID_BLOCK ? null : `persist:profile-${profileId}`;
}

/** Webview (web-tab) partition — kept per profile so web logins don't bleed
 *  between profiles. Must stay in sync with the renderer's UrlDocumentBlock. */
export function getProfileWebviewPartitionBlock(profileId: string): string {
  return profileId === DEFAULT_PROFILE_ID_BLOCK
    ? 'persist:thinking-space-links'
    : `persist:thinking-space-links-${profileId}`;
}

function assertVaultNotClaimedBlock(vaultRoot: string, excludeProfileId?: string): void {
  const resolved = path.resolve(vaultRoot);
  for (const profile of listProfilesBlock()) {
    if (excludeProfileId && profile.id === excludeProfileId) continue;
    const owned = resolveProfileVaultRootBlock(profile);
    if (owned && path.resolve(owned) === resolved) {
      throw new Error(`That folder is already used by the "${profile.name}" profile.`);
    }
  }
}

export function createProfileBlock(input: {
  name: string;
  vaultRoot: string;
  accentColor?: string | null;
}): ProfileRecordBlock {
  const name = normalizeNameBlock(input.name);
  const vaultRoot = normalizeVaultRootBlock(input.vaultRoot);
  if (!name) throw new Error('Profile name is required.');
  if (!vaultRoot) throw new Error('Profile vault folder is required.');
  assertVaultNotClaimedBlock(vaultRoot);
  const record: ProfileRecordBlock = {
    id: randomUUID().slice(0, 8),
    name,
    vaultRoot,
    accentColor: normalizeAccentColorBlock(input.accentColor) ?? null,
  };
  writeProfilesFileBlock([...listProfilesBlock(), record]);
  return record;
}

export function updateProfileBlock(
  profileId: string,
  patch: { name?: string; accentColor?: string | null; vaultRoot?: string },
): ProfileRecordBlock {
  const profiles = listProfilesBlock();
  const index = profiles.findIndex((p) => p.id === profileId);
  if (index < 0) throw new Error('Profile not found.');
  const current = profiles[index];
  const next: ProfileRecordBlock = { ...current };
  if (patch.name !== undefined) {
    const name = normalizeNameBlock(patch.name);
    if (!name) throw new Error('Profile name is required.');
    next.name = name;
  }
  if (patch.accentColor !== undefined) {
    next.accentColor = normalizeAccentColorBlock(patch.accentColor);
  }
  if (patch.vaultRoot !== undefined && profileId !== DEFAULT_PROFILE_ID_BLOCK) {
    const vaultRoot = normalizeVaultRootBlock(patch.vaultRoot);
    if (!vaultRoot) throw new Error('Profile vault folder is required.');
    assertVaultNotClaimedBlock(vaultRoot, profileId);
    next.vaultRoot = vaultRoot;
  }
  const updated = [...profiles];
  updated[index] = next;
  writeProfilesFileBlock(updated);
  return next;
}

export function deleteProfileBlock(profileId: string): void {
  if (profileId === DEFAULT_PROFILE_ID_BLOCK) throw new Error('The default profile cannot be deleted.');
  const profiles = listProfilesBlock();
  if (!profiles.some((p) => p.id === profileId)) throw new Error('Profile not found.');
  writeProfilesFileBlock(profiles.filter((p) => p.id !== profileId));
}

/** Route a vault-root write to the right store: the default profile keeps the
 *  legacy vault-root.json, non-default profiles update their registry record. */
export function setProfileVaultRootBlock(profileId: string, vaultRoot: string | null): void {
  if (profileId === DEFAULT_PROFILE_ID_BLOCK) {
    writePersistedVaultRootBlock(vaultRoot);
    return;
  }
  if (!vaultRoot) throw new Error('Non-default profiles must always have a vault folder.');
  updateProfileBlock(profileId, { vaultRoot });
}
