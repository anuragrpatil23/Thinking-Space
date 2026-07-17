// Update discovery for local/self-built apps (checkpoint-ship.sh, fork builds).
//
// Custom builds carry a `local-build` marker and skip electron-updater entirely
// — the official DMG would erase the user's modifications, so it's a downgrade
// for them. But they should still LEARN that a new official release exists;
// their upgrade path is `git merge upstream/main` + rebuild (PLAYBOOKS.md §12,
// Step 5). This block checks the GitHub releases API once per app launch and
// shows one native notification when upstream is ahead. Silent on any failure
// (offline, rate-limited, no releases) — this is a courtesy, not a dependency.

import { app, Notification } from 'electron';
import * as https from 'https';

const RELEASES_LATEST_URL =
  'https://api.github.com/repos/anuragrpatil23/Thinking-Space/releases/latest';

function fetchLatestTagBlock(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      RELEASES_LATEST_URL,
      { headers: { 'User-Agent': 'thinking-space-app', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { tag_name?: unknown };
            resolve(typeof parsed.tag_name === 'string' ? parsed.tag_name : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10_000, () => { req.destroy(); resolve(null); });
  });
}

/** "v2.7.0" / "2.7.0" → [2,7,0]; returns null for anything unparseable. */
function parseVersionBlock(raw: string): number[] | null {
  const m = raw.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewerBlock(candidate: number[], current: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

/** Fire-and-forget: notify once if the official release is ahead of this
 *  local build. Call only when the `local-build` marker is present. */
export async function notifyIfOfficialReleaseAheadBlock(): Promise<void> {
  const tag = await fetchLatestTagBlock();
  if (!tag) return;
  const latest = parseVersionBlock(tag);
  const current = parseVersionBlock(app.getVersion());
  if (!latest || !current || !isNewerBlock(latest, current)) return;
  if (!Notification.isSupported()) return;
  new Notification({
    title: `Thinking Space ${tag.replace(/^v/i, '')} is out`,
    body:
      'You are running a custom build, so it was not auto-installed. '
      + 'Ask your AI assistant to update your app — it will merge the new version into your copy.',
  }).show();
}
