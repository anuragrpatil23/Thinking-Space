import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  NEW_NOTE_NAME_ATTEMPTS_BLOCK,
  buildTargetPathBlock,
  numberedFilenameBlock,
} from '@/services/lego_blocks/units/noteComposerBlock'

/** First filename in `folderPath` that nothing occupies: `base`, then
 *  `base-2`, `base-3`. Shared by the composer (new note, move) and the canvas
 *  (save a post-it) — "no append, ever" means a write into a folder that
 *  already holds the name must land beside it, not on top of it. */
export async function findFreeNoteFilenameBlock(folderPath: string, base: string): Promise<string | null> {
  const fs = getVaultFS()
  for (let attempt = 1; attempt <= NEW_NOTE_NAME_ATTEMPTS_BLOCK; attempt += 1) {
    const candidate = numberedFilenameBlock(base, attempt)
    const candidatePath = buildTargetPathBlock(folderPath, candidate)
    if (!candidatePath) break
    // Serial on purpose: each answer decides whether the next name is even
    // worth asking about, and the loop almost always ends on the first.
    if (!(await fs.exists(candidatePath))) return candidate
  }
  return null
}
