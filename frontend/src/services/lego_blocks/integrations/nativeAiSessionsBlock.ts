// Renderer-side wrapper for the native AI session IPCs (Electron-only).
//
// On non-Electron platforms (iOS/web) the IPCs aren't present and we return
// an empty list rather than erroring — the activity panel falls back to the
// vault markdown source only.

import {
  parseNativeAiSession,
  type NativeSource,
} from '@/services/lego_blocks/units/nativeAiSessionParserBlock'
import type { ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

interface NativeListEntry {
  source: NativeSource
  relPath: string
  mtime: number
  size: number
}

export interface NativeAiSessionRoots {
  /** Effective root per source (override or default). */
  claude: string
  codex: string
  /** Built-in defaults, so the UI can show/reset them. */
  claudeDefault: string
  codexDefault: string
}

interface NativeApi {
  nativeAiSessionsList?: () => Promise<NativeListEntry[]>
  nativeAiSessionRead?: (source: NativeSource, relPath: string) => Promise<string>
  nativeAiSessionsGetRoots?: () => Promise<NativeAiSessionRoots>
  nativeAiSessionsSetRoots?: (
    roots: Partial<Record<NativeSource, string | null>>,
  ) => Promise<NativeAiSessionRoots>
  nativeAiClaudeHistoryRead?: () => Promise<string>
}

function getApi(): NativeApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { electronAPI?: NativeApi }).electronAPI
  if (!api) return null
  if (!api.nativeAiSessionsList || !api.nativeAiSessionRead) return null
  return api
}

export function nativeAiSourcesAvailable(): boolean {
  return getApi() !== null
}

/** Where the native session stores are read from. Null on non-Electron clients. */
export async function getNativeAiSessionRoots(): Promise<NativeAiSessionRoots | null> {
  const api = getApi()
  if (!api?.nativeAiSessionsGetRoots) return null
  try {
    return await api.nativeAiSessionsGetRoots()
  } catch {
    return null
  }
}

/** Re-point a native session store. Pass null/'' to reset a source to its default. */
export async function setNativeAiSessionRoots(
  roots: Partial<Record<NativeSource, string | null>>,
): Promise<NativeAiSessionRoots> {
  const api = getApi()
  if (!api?.nativeAiSessionsSetRoots) {
    throw new Error('Native AI session API not available on this platform')
  }
  return api.nativeAiSessionsSetRoots(roots)
}

export async function listNativeAiSessions(): Promise<NativeListEntry[]> {
  const api = getApi()
  if (!api) return []
  try {
    return (await api.nativeAiSessionsList!()) ?? []
  } catch {
    return []
  }
}

/** Claude Code's permanent prompt log (`~/.claude/history.jsonl`). Returns ''
 *  on non-Electron clients or when the file is missing. */
export async function readClaudeHistory(): Promise<string> {
  const api = getApi()
  if (!api?.nativeAiClaudeHistoryRead) return ''
  try {
    return (await api.nativeAiClaudeHistoryRead()) ?? ''
  } catch {
    return ''
  }
}

export async function readNativeAiSession(
  source: NativeSource,
  relPath: string,
): Promise<string> {
  const api = getApi()
  if (!api) throw new Error('Native AI session API not available on this platform')
  return api.nativeAiSessionRead!(source, relPath)
}

/**
 * Convenience: read + parse a single native session. Returns one entry per
 * activity window — a long idle gap inside one transcript splits into multiple
 * ParsedSession rows (`path`, `path#w1`, ...). Returns [] for unparseable files
 * so the caller can keep going through the batch.
 */
export async function loadAndParseNativeAiSession(
  entry: NativeListEntry,
  spawnKickoffPatterns: readonly string[] = [],
): Promise<ParsedSession[]> {
  try {
    const text = await readNativeAiSession(entry.source, entry.relPath)
    return parseNativeAiSession({
      source: entry.source,
      relPath: entry.relPath,
      mtime: entry.mtime,
      text,
      spawnKickoffPatterns,
    })
  } catch {
    return []
  }
}
