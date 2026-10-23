// Ads, trackers and on-page clutter blocked in the in-app browser that shows
// links and feed articles — and only there. Ghostery's engine (the one behind
// its browser extension) with the community lists for ads, tracking, cookie
// notices and annoyances: requests to ad servers never leave, and banners,
// donation boxes and newsletter pop-ups are hidden by element.
//
// Scope: sessions whose partition starts with `persist:thinking-space-links`
// (the reader's; one per workspace profile). Gmail, Google Docs, the library
// and every other session are untouched.
//
// Filter lists: Ghostery's prebuilt engine, fetched once and kept in userData;
// refreshed when the copy is older than a week, checked when a reader page
// opens (no timers). Without a network the last copy keeps working; with no
// copy at all, pages simply load unblocked.

import { app, net, session as electronSession, type Session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

const READER_PARTITION_PREFIX = 'persist:thinking-space-links';
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

let blockerPromise: Promise<ElectronBlocker | null> | null = null;
const enabled = new WeakSet<Session>();

function enginePathBlock(): string {
  return path.join(app.getPath('userData'), 'reader-adblock', 'engine.bin');
}

async function loadBlockerBlock(): Promise<ElectronBlocker | null> {
  const cachePath = enginePathBlock();
  await fsPromises.mkdir(path.dirname(cachePath), { recursive: true });
  // A stale copy is set aside, not deleted, so a failed refresh falls back to it
  const stale = fs.existsSync(cachePath) && Date.now() - fs.statSync(cachePath).mtimeMs > REFRESH_AFTER_MS;
  const fetchForEngine = (url: string) => net.fetch(url) as unknown as ReturnType<typeof fetch>;
  try {
    return await ElectronBlocker.fromPrebuiltFull(fetchForEngine, {
      path: cachePath,
      read: async (p: string) => {
        if (stale) throw new Error('refresh');
        return fsPromises.readFile(p);
      },
      write: (p: string, buffer: Uint8Array) => fsPromises.writeFile(p, buffer),
    });
  } catch (error) {
    if (fs.existsSync(cachePath)) {
      try {
        return ElectronBlocker.deserialize(new Uint8Array(await fsPromises.readFile(cachePath)));
      } catch { /* unreadable copy */ }
    }
    console.warn('[reader-adblock] no filter lists available:', error instanceof Error ? error.message : error);
    return null;
  }
}

function enableForPartitionBlock(partition: string): void {
  if (!partition.startsWith(READER_PARTITION_PREFIX)) return;
  const target = electronSession.fromPartition(partition);
  if (enabled.has(target)) return;
  enabled.add(target);
  blockerPromise ??= loadBlockerBlock();
  void blockerPromise.then((blocker) => {
    if (blocker) blocker.enableBlockingInSession(target);
    else enabled.delete(target);
  });
}

/** Call once at startup: every reader webview gets the blocker on its session.
 *  The engine starts loading when the app is ready, so the first page is covered. */
export function installReaderAdblockBlock(): void {
  void app.whenReady().then(() => { blockerPromise ??= loadBlockerBlock(); });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (_attachEvent, _webPreferences, params) => {
      if (typeof params.partition === 'string') enableForPartitionBlock(params.partition);
    });
  });
}
