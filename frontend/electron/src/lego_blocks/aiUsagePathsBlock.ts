import * as os from 'os';
import * as path from 'path';

/**
 * Where this machine's AI usage capture lands.
 *
 * Its own unit because two things need it and they must not disagree: the
 * reader (`aiPlanUsageBlock`, which also prunes these directories) and the
 * vault mirror (`aiUsageVaultMirrorBlock`, which copies out of them). Same
 * reason `IDLE_GAP_MS` is one exported constant — two copies of an address
 * drift, and nothing in the UI would say so.
 *
 * Kept free of any `electron` import so both sides, and their tests, can read
 * it without standing up an app.
 */

/** Per-session snapshots, one file per session id, under a provider directory. */
export const AI_SESSIONS_DIR_BLOCK = path.join(os.homedir(), '.thinking-space', 'ai-sessions');

/** Append-only usage history, one monthly file under a provider directory. */
export const AI_USAGE_LOG_DIR_BLOCK = path.join(os.homedir(), '.thinking-space', 'ai-usage-log');
