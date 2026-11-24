import { randomUUID } from 'crypto';
import { promises as fs, watch as fsWatch } from 'fs';
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
}

export type LinkedCodeEntryBlock =
  | { type: 'file'; size: number }
  | { type: 'folder'; folders: string[]; files: Array<{ name: string; size: number }> };

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.md', '.txt']);
const DOCUMENT_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html']);
const DOCUMENT_BYTE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;
// Generated folders, left out of a code folder's listing.
const GENERATED_FOLDERS = new Set(['__pycache__', 'node_modules']);
const MAX_CODE_TEXT_BYTES = 512 * 1024;
// Shown as text only. A script here is something to read; nothing in a code folder is ever launched.
const CODE_TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.rst', '.log', '.out', '.err', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.ipynb',
  '.py', '.sh', '.bash', '.zsh', '.r', '.jl', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.sql', '.slurm', '.lsf',
]);
const CODE_TEXT_NAMES = new Set(['readme', 'license', 'makefile', 'dockerfile', 'requirements']);
// Keys pasted into an otherwise ordinary file, such as a run's saved config.
const SECRET_CONTENT = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-ant-[\w-]{20,}|sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{40,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{30,}|xox[baprs]-[\w-]{20,})/;
// Documents only. Anything that can run (.app, .command, .sh, .pkg, .py, ...) is refused by not being listed.
const OPENABLE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.md', '.txt', '.html', '.pptx', '.docx', '.xlsx', '.csv']);

/** Hidden files, and names that usually hold a secret. Never read, listed or opened, even inside a linked folder. */
export function isBlockedLinkedNameBlock(name: string): boolean {
  return name.startsWith('.')
    || /^(secrets?|credentials?|passwords?)(\.|$)/i.test(name)
    || /(^|[-_.])(tokens?|credentials?|secrets?)\.(json|txt|ya?ml|toml|ini|env)$/i.test(name)
    || /^(api[-_]?keys?|auth|tokens?)(\.(json|txt|ya?ml|toml|ini|env))?$/i.test(name)
    || /^service[-_]?account.*\.json$/i.test(name)
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
    return item.kind === 'papers' || item.kind === 'code' ? [{ id: item.id, path: item.path, kind: item.kind }] : [];
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
  home: string = os.homedir(),
): Promise<LinkedFolderBlock[]> {
  if (kind !== 'papers' && kind !== 'code') throw new Error('A linked folder is either papers or code.');
  const real = await fs.realpath(picked);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('Pick a folder.');
  const realHome = await fs.realpath(home).catch(() => home);
  if (path.dirname(real) === real || real === realHome || realHome.startsWith(`${real}${path.sep}`)) {
    throw new Error('That folder is too broad to link. Pick the specific folder you want.');
  }
  if (folders.some(folder => folder.path === real && folder.kind === kind)) return folders;
  return [...folders, { id: randomUUID(), path: real, kind }];
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

/** A path in a code folder: a file's size, or one level of a folder with sizes. Nothing is loaded. */
export async function describeLinkedCodeBlock(root: string, relPath: unknown): Promise<LinkedCodeEntryBlock> {
  const real = await resolveLinkedPathBlock(root, relPath);
  const stat = await fs.stat(real);
  if (stat.isFile()) return { type: 'file', size: stat.size };
  if (!stat.isDirectory()) throw new Error('That path is not available.');
  const entries = (await fs.readdir(real, { withFileTypes: true })).filter(entry => !isBlockedLinkedNameBlock(entry.name));
  const files = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => ({
    name: entry.name,
    size: (await fs.stat(path.join(real, entry.name))).size,
  })));
  return {
    type: 'folder',
    folders: entries.filter(entry => entry.isDirectory() && !GENERATED_FOLDERS.has(entry.name)).map(entry => entry.name).sort(),
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A code folder's file as text, for showing in the app. Large, binary or secret-bearing files are refused. */
export async function readLinkedCodeTextBlock(root: string, relPath: unknown, maxBytes = MAX_CODE_TEXT_BYTES): Promise<string> {
  const real = await resolveLinkedPathBlock(root, relPath);
  const base = path.basename(real).toLowerCase();
  if (!CODE_TEXT_EXTENSIONS.has(path.extname(base)) && !CODE_TEXT_NAMES.has(base)) throw new Error('This kind of file is not shown as text.');
  return readCheckedTextBlock(real, maxBytes);
}

// Data a page reads rather than shows: a run's records, labels and drawn panels.
const CODE_DATA_EXTENSIONS = new Set(['.jsonl', '.json', '.html']);
const MAX_CODE_DATA_BYTES = 16 * 1024 * 1024;

/** A run's data file as text (.jsonl, .json, .html), with a larger limit and the same checks. */
export async function readLinkedCodeDataBlock(root: string, relPath: unknown): Promise<string> {
  const real = await resolveLinkedPathBlock(root, relPath);
  if (!CODE_DATA_EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('Only data files are read this way.');
  return readCheckedTextBlock(real, MAX_CODE_DATA_BYTES);
}

async function readCheckedTextBlock(real: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(real, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('That is not a file.');
    if (stat.size > maxBytes) throw new Error('This file is too large to show here.');
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) throw new Error('This file is not text.');
    const text = bytes.toString('utf8');
    if (SECRET_CONTENT.test(text)) throw new Error('This file looks like it holds a key, so it is not shown.');
    return text;
  } finally {
    await handle.close();
  }
}

/** A papers-folder document as text, for the app's own reader. */
export async function readLinkedDocumentTextBlock(root: string, relPath: unknown): Promise<string> {
  const real = await resolveLinkedPathBlock(root, relPath);
  if (!DOCUMENT_TEXT_EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('This kind of file cannot be read here.');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) throw new Error('That file cannot be read here.');
  return fs.readFile(real, 'utf8');
}

/** A PDF or picture from a papers folder, for the app's own reader. */
export async function readLinkedDocumentBytesBlock(root: string, relPath: unknown): Promise<string> {
  const real = await resolveLinkedPathBlock(root, relPath);
  if (!DOCUMENT_BYTE_EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('This kind of file cannot be read here.');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) throw new Error('That file cannot be read here.');
  return (await fs.readFile(real)).toString('base64');
}

export async function statLinkedDocumentBlock(root: string, relPath: unknown): Promise<{ mtime: number; ctime: number; size: number }> {
  const real = await resolveLinkedPathBlock(root, relPath);
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error('That is not a file.');
  return { mtime: stat.mtimeMs, ctime: stat.ctimeMs, size: stat.size };
}

/**
 * Calls `onChange` (debounced) when anything under a folder inside a linked code
 * folder changes, for example after a git pull. It says only that something
 * changed, never what, so the renderer re-reads through the usual checked reads.
 * Never writes. Returns the function that stops watching.
 */
export async function watchLinkedCodeFolderBlock(root: string, relPath: unknown, onChange: () => void, waitMs = 400): Promise<() => void> {
  const real = await resolveLinkedPathBlock(root, relPath);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('Only a folder can be watched.');
  let timer: NodeJS.Timeout | null = null;
  const watcher = fsWatch(real, { recursive: true, persistent: false }, (_kind, name) => {
    const parts = String(name ?? '').split(path.sep);
    if (parts.some(part => GENERATED_FOLDERS.has(part) || part === '.git')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; onChange(); }, waitMs);
  });
  watcher.on('error', () => watcher.close());
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
