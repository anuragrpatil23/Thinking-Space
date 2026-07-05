// Renderer-side access to GoodNotes reading activity.
//
// On Electron: trigger the GoodNotes harvest (which itself fires the Apple
// Screen Time dump first, then attributes app_usage focus events to docs
// via fts.sqlite), then read the resulting reading.jsonl back over IPC. The
// FDA-needed flag is captured from the harvest result so a Reading panel
// banner can prompt the user.
//
// On non-Electron clients (iPhone/web) the IPC isn't present, but the
// durable log lives in the vault and syncs — so we read and parse
// `ai-raw/raw/goodnotes/reading.jsonl` straight through VaultFS. Either
// way the caller gets the same ParsedSession[] tagged source:'goodnotes'.

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  parseGoodnotesReadingLog,
  type GoodnotesReadingRecord,
} from '@/services/lego_blocks/units/goodnotesReadingParserBlock'
import {
  getGoodnotesAnnotationGate,
  getGoodnotesReadingEnabled,
  getStoredVaultRoot,
} from '@/services/lego_blocks/units/storageKeyBlock'

const READING_LOG_PATH = 'ai-raw/raw/goodnotes/reading.jsonl'

interface GoodnotesApi {
  goodnotesHarvest?: (
    vaultRoot: string,
  ) => Promise<{
    added: number
    total: number
    unavailable?: boolean
    needsFullDiskAccess?: boolean
  }>
  goodnotesReadLog?: (vaultRoot: string) => Promise<GoodnotesReadingRecord[]>
  goodnotesEditRecord?: (
    vaultRoot: string,
    input: { key: string; startMs: number; endMs: number; pages: number },
  ) => Promise<{
    ok: boolean
    reason?: 'not-found' | 'invalid' | 'failed'
    absorbed: number
    total: number
  }>
}

/** Sticky flag: last harvest reported macOS denied Knowledge DB access. The
 *  Reading panel reads this to surface an FDA prompt. We keep it on the
 *  module rather than per-call so the renderer can poll without re-running
 *  the harvest. */
let lastNeedsFullDiskAccess = false

export function goodnotesNeedsFullDiskAccess(): boolean {
  return lastNeedsFullDiskAccess
}

function getApi(): GoodnotesApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { electronAPI?: GoodnotesApi }).electronAPI
  if (!api?.goodnotesHarvest || !api.goodnotesReadLog) return null
  return api
}

function parseLogText(text: string): GoodnotesReadingRecord[] {
  const out: GoodnotesReadingRecord[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as GoodnotesReadingRecord)
    } catch {
      // Skip a corrupt line rather than dropping the whole log.
    }
  }
  return out
}

/**
 * Load GoodNotes reading sessions. Electron harvests fresh first (best-effort —
 * a harvest failure still returns whatever's already logged); other platforms
 * read the synced vault log. Returns [] when GoodNotes/the log isn't present.
 */
export async function loadGoodnotesReadingSessions(fs: VaultFS): Promise<ParsedSession[]> {
  const parseOpts = { annotationGate: getGoodnotesAnnotationGate() }
  const api = getApi()
  if (api) {
    const vaultRoot = getStoredVaultRoot() ?? ''
    // Opt-in gate. Harvesting reaches into GoodNotes' Library/Containers dir,
    // which triggers macOS Sequoia's "access data from other apps" TCC prompt
    // at launch. Users who don't use GoodNotes should never see it; users who
    // do can flip the switch in Settings ▸ AI Activity ▸ Session sources.
    if (getGoodnotesReadingEnabled()) {
      try {
        const result = await api.goodnotesHarvest!(vaultRoot)
        lastNeedsFullDiskAccess = result?.needsFullDiskAccess === true
      } catch {
        // Harvest failed (no GoodNotes, sqlite missing, etc.) — fall through and
        // return whatever the durable log already holds.
      }
    }
    try {
      const records = (await api.goodnotesReadLog!(vaultRoot)) ?? []
      return parseGoodnotesReadingLog(records, parseOpts)
    } catch {
      return []
    }
  }

  // Non-Electron: read the synced durable log directly from the vault.
  try {
    if (!(await fs.exists(READING_LOG_PATH))) return []
    const text = await fs.read(READING_LOG_PATH)
    return parseGoodnotesReadingLog(parseLogText(text), parseOpts)
  } catch {
    return []
  }
}

/**
 * Edit a single goodnotes record's start/end/pages. Routes through the
 * electron IPC so the main process is the sole writer for the goodnotes
 * JSONL — sidesteps races with the harvester. Returns null on platforms
 * without the IPC (iPhone/web), where editing isn't supported yet (those
 * surfaces don't run the harvester anyway, so there's nothing to clean up).
 */
export async function editGoodnotesReadingRecord(
  input: { key: string; startMs: number; endMs: number; pages: number },
): Promise<{ ok: boolean; absorbed: number; total: number } | null> {
  const api = getApi()
  if (!api?.goodnotesEditRecord) return null
  const vaultRoot = getStoredVaultRoot() ?? ''
  if (!vaultRoot) return null
  try {
    const result = await api.goodnotesEditRecord(vaultRoot, input)
    return { ok: result.ok, absorbed: result.absorbed, total: result.total }
  } catch {
    return { ok: false, absorbed: 0, total: 0 }
  }
}
