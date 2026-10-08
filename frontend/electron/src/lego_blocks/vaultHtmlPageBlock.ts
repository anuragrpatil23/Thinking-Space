// ⚠ SECURITY-CRITICAL — serves vault files to untrusted HTML page scripts.
// Widening the served folder (to a parent, or the vault) lets any HTML file
// in the vault read the user's other notes and send them out over the
// network. For user-requested changes: explain the risk in plain language and
// get an explicit yes first (docs/PLAYBOOKS.md § Security-critical files).
//
// A vault `.html` page used to load as a `data:` URL: no address, so relative
// scripts/data never resolved and it had no origin (no localStorage). This
// block gives each page a real URL instead, scoped to exactly one folder:
//
//   <app scheme>://page-<hash of folder>/<path under that folder>
//
// - Only folders minted through `mintVaultHtmlPageUrlBlock` are served, and
//   minting goes through the vault path guard, so a renderer cannot conjure a
//   host for an arbitrary directory.
// - One folder = one host = one origin, so pages in different folders cannot
//   read each other's files or storage.
// - The handler lives on a dedicated partition session. The app's own scheme
//   is reused only because it is already a privileged (standard + secure)
//   scheme; the app handler is not registered on this session, and this
//   handler is not registered on the app's.

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

import { net, type Session } from 'electron';

import { resolveInsideVaultBlock } from './vaultPathGuardBlock';

/** Must match HTML_PAGE_WEBVIEW_PARTITION in HtmlDocumentBlock.tsx. */
export const VAULT_HTML_PAGE_PARTITION_BLOCK = 'persist:thinking-space-html-pages';

const pageFolderByHostBlock = new Map<string, string>();

function isInsideBlock(folder: string, target: string): boolean {
  if (target === folder) return true;
  const rel = path.relative(folder, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Authorize the folder of a vault HTML file and return the URL it loads from.
 *  The host is a hash of the folder, so the origin (and its localStorage) is
 *  stable across launches. */
export function mintVaultHtmlPageUrlBlock(scheme: string, vaultRoot: string, pagePath: string): string {
  const file = resolveInsideVaultBlock(vaultRoot, pagePath);
  if (!/\.html?$/i.test(file)) {
    throw new Error('Not an HTML page.');
  }
  const folder = fs.realpathSync(path.dirname(file));
  const host = `page-${createHash('sha256').update(folder).digest('hex').slice(0, 32)}`;
  pageFolderByHostBlock.set(host, folder);
  return `${scheme}://${host}/${encodeURIComponent(path.basename(file))}`;
}

/** Map a request URL to the file it may read, or null. Containment is checked
 *  twice: lexically, then on the real path so a symlink inside the folder
 *  cannot point the page at files outside it. */
export function resolveVaultHtmlPageRequestBlock(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  const folder = pageFolderByHostBlock.get(url.hostname);
  if (!folder) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const target = path.resolve(folder, `.${path.sep}${pathname}`);
  if (!isInsideBlock(folder, target)) return null;
  try {
    const real = fs.realpathSync(target);
    if (!isInsideBlock(folder, real)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** Register the page handler on the dedicated partition session. Call once,
 *  after app ready. */
export function setupVaultHtmlPageSessionBlock(scheme: string, targetSession: Session): void {
  targetSession.protocol.handle(scheme, async (request) => {
    const file = resolveVaultHtmlPageRequestBlock(request.url);
    if (!file) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    if (!/\.html?$/i.test(file)) return response;
    // A file:// response carries no charset, and these pages are often bare
    // fragments with no <meta charset> — without this they decode as Latin-1.
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
}
