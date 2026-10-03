import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getReadingInstallIdBlock } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  parsePdfReadingPositionStoreBlock,
  pickNewerPdfReadingPositionBlock,
  readPdfReadingPositionStoreBlock,
  type PdfReadingPositionEntryBlock,
} from '@/services/lego_blocks/units/pdfReadingPositionBlock'

/* Carries PDF reading positions between devices through the vault.

   Layout — one file per install:

     .thinking-space/reading-positions/a3f1c2.json

   Each device only ever writes its own file, a copy of its local positions,
   and reads everyone's. Same reasoning as the per-install reading day files in
   thinkingspaceReadingBlock: one shared file rewritten by a Mac and an iPad is
   an iCloud conflict copy waiting to happen, and the losing device's positions
   are simply gone. Disjoint files cannot conflict; they merge on read, newest
   `at` per document.

   This is reading state, not a setting, which is why it is not a group in
   `preferences/ui.json`: that file is read-merge-written whole, and a value
   that changes every time someone turns a page would be racing every real
   preference in it.

   `.thinking-space/` is ignored by the vault watcher, so these writes do not
   wake a sync. */

const READING_POSITIONS_DIR_ORCH = '.thinking-space/reading-positions'
const INSTALL_FILE_PATTERN_ORCH = /^([0-9a-f]{6,})\.json$/
/* An install file iCloud has listed but not downloaded yet. */
const ICLOUD_PLACEHOLDER_PATTERN_ORCH = /^\.([0-9a-f]{6,}\.json)\.icloud$/

async function ensureReadingPositionsDirOrch(): Promise<void> {
  const fs = getVaultFS()
  let prefix = ''
  for (const segment of READING_POSITIONS_DIR_ORCH.split('/')) {
    prefix = prefix ? `${prefix}/${segment}` : segment
    try {
      if (!(await fs.exists(prefix))) await fs.mkdir(prefix)
    } catch {
      // Concurrent create or already-exists — fine.
    }
  }
}

/* The newest position any device has recorded for this file, or null. Never
   throws: a vault that cannot be read just means the local copy is used. */
export async function readRoamedPdfReadingPositionOrch(
  path: string,
): Promise<PdfReadingPositionEntryBlock | null> {
  try {
    const fs = getVaultFS()
    if (!(await fs.exists(READING_POSITIONS_DIR_ORCH))) return null
    const listed = await fs.list(READING_POSITIONS_DIR_ORCH)

    const names = new Set<string>()
    for (const name of listed.files) {
      if (INSTALL_FILE_PATTERN_ORCH.test(name)) names.add(name)
      const placeholder = ICLOUD_PLACEHOLDER_PATTERN_ORCH.exec(name)
      if (placeholder) names.add(placeholder[1])
    }

    const entries = await Promise.all([...names].map(async (name) => {
      try {
        const raw = await fs.read(`${READING_POSITIONS_DIR_ORCH}/${name}`)
        return parsePdfReadingPositionStoreBlock(raw)[path] ?? null
      } catch {
        return null
      }
    }))

    return entries.reduce<PdfReadingPositionEntryBlock | null>(pickNewerPdfReadingPositionBlock, null)
  } catch {
    return null
  }
}

// Serialized, and skipped when nothing changed since the last push, so a flush
// on every backgrounding costs a write only when the reader actually moved.
let pushChainOrch: Promise<void> = Promise.resolve()
let lastPushedOrch: string | null = null

/* Publish this device's positions for the others to read. */
export function pushPdfReadingPositionsOrch(): Promise<void> {
  pushChainOrch = pushChainOrch.then(async () => {
    try {
      const serialized = JSON.stringify(readPdfReadingPositionStoreBlock())
      if (serialized === lastPushedOrch) return
      await ensureReadingPositionsDirOrch()
      await getVaultFS().write(
        `${READING_POSITIONS_DIR_ORCH}/${getReadingInstallIdBlock()}.json`,
        serialized,
      )
      lastPushedOrch = serialized
    } catch (error) {
      console.warn('[pdfReadingPositionSyncOrch] push failed:', error)
    }
  })
  return pushChainOrch
}
