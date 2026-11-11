// An SEC filing as the PDF it would print to (2026-11-11). The renderer asks for
// one filing on www.sec.gov; main renders it in a hidden window and prints it.
// The window is as shut as a window can be: no preload, no Node, sandboxed,
// JavaScript off, its own in-memory session (no cookies shared), every request
// that is not https://www.sec.gov cancelled, no navigation away, no popups.
// sec.gov asks callers to say who they are: the caller's user agent is used
// (same check as net:fetchText).
import { BrowserWindow, session } from 'electron';

const SEC_HOST_BLOCK = 'www.sec.gov';
const PARTITION_BLOCK = 'sec-filing-print';
const LOAD_TIMEOUT_MS_BLOCK = 90_000;

/** Only a filing document under www.sec.gov/Archives/edgar/data/, over https. */
export function assertSecFilingUrlBlock(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('An SEC filing address is required');
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' || url.hostname !== SEC_HOST_BLOCK || !url.pathname.startsWith('/Archives/edgar/data/') || !/\.html?$/i.test(url.pathname)) {
    throw new Error('Only an SEC filing document (https://www.sec.gov/Archives/edgar/data/…htm) can be printed');
  }
  return url.toString();
}

let guarded = false

export async function printSecFilingPdfBlock(rawUrl: unknown, rawUserAgent: unknown): Promise<{ bytesBase64: string }> {
  const url = assertSecFilingUrlBlock(rawUrl);
  const userAgent = typeof rawUserAgent === 'string' && /^[\x20-\x7E]{1,200}$/.test(rawUserAgent) ? rawUserAgent : 'Mozilla/5.0 (compatible; ThinkingSpace/1.0)';
  const ses = session.fromPartition(PARTITION_BLOCK);
  if (!guarded) {
    guarded = true;
    // Nothing but sec.gov over https, whatever the filing's markup points at
    ses.webRequest.onBeforeRequest((details, callback) => {
      let ok = false;
      try {
        const u = new URL(details.url);
        ok = (u.protocol === 'https:' && u.hostname === SEC_HOST_BLOCK) || u.protocol === 'data:';
      } catch { ok = false; }
      callback({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  }
  ses.setUserAgent(userAgent);
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 1400,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false, webSecurity: true, session: ses, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    await Promise.race([
      win.loadURL(url, { userAgent }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('The filing took too long to load')), LOAD_TIMEOUT_MS_BLOCK)),
    ]);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { marginType: 'default' } });
    return { bytesBase64: pdf.toString('base64') };
  } finally {
    win.destroy();
  }
}
