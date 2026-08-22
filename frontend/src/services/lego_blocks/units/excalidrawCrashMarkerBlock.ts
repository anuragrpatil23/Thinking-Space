const EXCALIDRAW_CRASH_MARKER_KEY_BLOCK = 'ltm.excalidraw.edit-crash-marker'
const EXCALIDRAW_CRASH_MARKER_MAX_AGE_MS = 10 * 60 * 1000

export type ExcalidrawCrashStageBlock =
  | 'edit_requested'
  | 'editor_mounting'
  | 'api_attached'

export interface ExcalidrawCrashMarkerBlock {
  path: string
  stage: ExcalidrawCrashStageBlock
  markedAt: number
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readRawMarker(): ExcalidrawCrashMarkerBlock | null {
  if (!canUseStorage()) return null
  try {
    const raw = window.localStorage.getItem(EXCALIDRAW_CRASH_MARKER_KEY_BLOCK)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ExcalidrawCrashMarkerBlock>
    if (typeof parsed.path !== 'string' || typeof parsed.stage !== 'string' || typeof parsed.markedAt !== 'number') {
      return null
    }
    return {
      path: parsed.path,
      stage: parsed.stage as ExcalidrawCrashStageBlock,
      markedAt: parsed.markedAt,
    }
  } catch {
    return null
  }
}

/** What the crash marker should do when the Excalidraw API reference changes.
 *
 *  `onApiChange(null)` is fired both while the editor is mounting (before its
 *  API exists) and from the effect cleanup when the document closes. Treating
 *  those alike meant every clean exit planted an `editor_mounting` marker that
 *  nothing cleared, so the next launch reported a crash that never happened —
 *  observed 2026-08-22 with no jetsam kill and a cleanly saved file.
 *
 *  Whether the API ever attached is the discriminator. */
export type ExcalidrawMarkerActionBlock =
  | { action: 'mark'; stage: ExcalidrawCrashStageBlock }
  | { action: 'clear' }

export function excalidrawMarkerActionBlock(options: {
  /** The API reference just handed to us. */
  hasApi: boolean
  /** Did the API attach at any point for the document currently open? */
  everAttached: boolean
}): ExcalidrawMarkerActionBlock {
  if (options.hasApi) return { action: 'mark', stage: 'api_attached' }
  // Attached, then gone: the editor stabilised and is closing normally.
  if (options.everAttached) return { action: 'clear' }
  // Never attached: genuinely mid-mount, which is the state worth recording.
  return { action: 'mark', stage: 'editor_mounting' }
}

export function markExcalidrawCrashStageBlock(path: string, stage: ExcalidrawCrashStageBlock): void {
  if (!canUseStorage()) return
  try {
    const marker: ExcalidrawCrashMarkerBlock = {
      path,
      stage,
      markedAt: Date.now(),
    }
    window.localStorage.setItem(EXCALIDRAW_CRASH_MARKER_KEY_BLOCK, JSON.stringify(marker))
  } catch {
    // Ignore storage failures. This is diagnostic only.
  }
}

export function clearExcalidrawCrashMarkerBlock(): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.removeItem(EXCALIDRAW_CRASH_MARKER_KEY_BLOCK)
  } catch {
    // Ignore storage failures. This is diagnostic only.
  }
}

export function consumeRecentExcalidrawCrashMarkerBlock(): ExcalidrawCrashMarkerBlock | null {
  const marker = readRawMarker()
  clearExcalidrawCrashMarkerBlock()
  if (!marker) return null
  if (Date.now() - marker.markedAt > EXCALIDRAW_CRASH_MARKER_MAX_AGE_MS) return null
  return marker
}
