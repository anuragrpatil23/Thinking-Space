import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { atomicWriteFileBlock } from './atomicWriteBlock';

// Folders outside the vault that the user has chosen to link, such as a papers
// library or a code repo. The main process owns the list: a folder joins it only
// through the native picker, so nothing in a note or a link can widen access.
// The renderer names a folder by id and a file by a path inside it, and every
// path is checked here against the real location on disk, after symlinks.

export type LinkedFolderKindBlock = 'papers' | 'code';

export interface LinkedFolderBlock {
  id: string;
  path: string;
  kind: LinkedFolderKindBlock;
  /** The project a code folder belongs to; null for a papers folder. */
  project: string | null;
}

const PROJECT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.md', '.txt']);
// Documents only. Anything that can run (.app, .command, .sh, .pkg, .py, ...) is refused by not being listed.
const OPENABLE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.md', '.txt', '.html', '.pptx', '.docx', '.xlsx', '.csv']);

/** Hidden files, and names that usually hold a secret. Never read, listed or opened, even inside a linked folder. */
export function isBlockedLinkedNameBlock(name: string): boolean {
  return name.startsWith('.')
    || /^(secrets?|credentials?|passwords?)(\.|$)/i.test(name)
    || /(^|[-_.])(tokens?|credentials?|secrets?)\.(json|txt|ya?ml|toml|ini|env)$/i.test(name)
    || /^id_(rsa|dsa|ecdsa|ed25519)/i.test(name)
    || /\.(pem|key|p12|pfx|keystore|asc|env)$/i.test(name);
}

export function parseLinkedFoldersBlock(text: string): LinkedFolderBlock[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw): LinkedFolderBlock[] => {
    const item = raw as Partial<LinkedFolderBlock> | null;
    if (!item || typeof item.id !== 'string' || typeof item.path !== 'string' || !path.isAbsolute(item.path)) return [];
    if (item.kind === 'papers') return [{ id: item.id, path: item.path, kind: 'papers', project: null }];
    if (item.kind === 'code' && typeof item.project === 'string' && PROJECT_NAME.test(item.project)) {
      return [{ id: item.id, path: item.path, kind: 'code', project: item.project }];
    }
    return [];
  });
}

export async function readLinkedFoldersBlock(file: string): Promise<LinkedFolderBlock[]> {
  try {
    return parseLinkedFoldersBlock(await fs.readFile(file, 'utf8'));
  } catch {
    return [];
  }
}

export async function writeLinkedFoldersBlock(file: string, folders: LinkedFolderBlock[]): Promise<void> {
  await atomicWriteFileBlock(file, JSON.stringify(folders, null, 2));
}

/** Adds a folder the user just picked, at its real location. The whole disk or home folder is refused. */
export async function addLinkedFolderBlock(
  folders: LinkedFolderBlock[],
  picked: string,
  kind: unknown,
  project: unknown,
  home: string = os.homedir(),
): Promise<LinkedFolderBlock[]> {
  if (kind !== 'papers' && kind !== 'code') throw new Error('A linked folder is either papers or code.');
  if (kind === 'code' && (typeof project !== 'string' || !PROJECT_NAME.test(project))) throw new Error('A code folder needs a project.');
  const real = await fs.realpath(picked);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('Pick a folder.');
  const realHome = await fs.realpath(home).catch(() => home);
  if (path.dirname(real) === real || real === realHome || realHome.startsWith(`${real}${path.sep}`)) {
    throw new Error('That folder is too broad to link. Pick the specific folder you want.');
  }
  const entry: LinkedFolderBlock = { id: randomUUID(), path: real, kind, project: kind === 'code' ? project as string : null };
  const sameFolder = folders.find(folder => folder.path === real && folder.kind === kind && folder.project === entry.project);
  return sameFolder ? folders : [...folders, entry];
}

/** The real path of a file inside a linked folder, or an error. Symlinks are followed before the check. */
export async function resolveLinkedPathBlock(root: string, relPath: unknown): Promise<string> {
  if (typeof relPath !== 'string' || relPath.includes('\0') || relPath.includes('\\') || path.isAbsolute(relPath)) {
    throw new Error('That path is not inside the linked folder.');
  }
  const parts = relPath.split('/').filter(part => part && part !== '.');
  if (parts.includes('..') || parts.some(isBlockedLinkedNameBlock)) throw new Error('That path is not available.');
  const realRoot = await fs.realpath(root);
  const real = await fs.realpath(path.join(realRoot, ...parts));
  const inside = path.relative(realRoot, real);
  if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error('That path is not inside the linked folder.');
  }
  if (inside.split(path.sep).filter(Boolean).some(isBlockedLinkedNameBlock)) throw new Error('That path is not available.');
  return real;
}

export async function readLinkedTextBlock(root: string, relPath: unknown): Promise<string> {
  const real = await resolveLinkedPathBlock(root, relPath);
  if (!TEXT_EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('Only text notes can be read here.');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) throw new Error('That file cannot be read here.');
  return fs.readFile(real, 'utf8');
}

/** One level of a folder, without hidden files or likely secrets. */
export async function listLinkedFolderBlock(root: string, relPath: unknown): Promise<{ folders: string[]; files: string[] }> {
  const real = await resolveLinkedPathBlock(root, relPath);
  const entries = await fs.readdir(real, { withFileTypes: true });
  const shown = entries.filter(entry => !isBlockedLinkedNameBlock(entry.name));
  return {
    folders: shown.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(),
    files: shown.filter(entry => entry.isFile()).map(entry => entry.name).sort(),
  };
}

/** The file to hand to the system's default app: documents only, never anything that can run. */
export async function linkedFileToOpenBlock(root: string, relPath: unknown): Promise<string> {
  const real = await resolveLinkedPathBlock(root, relPath);
  if (!OPENABLE_EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('That kind of file cannot be opened from here.');
  if (!(await fs.stat(real)).isFile()) throw new Error('That is not a file.');
  return real;
}
