import { addRecent } from '@/components/lego_blocks/integrations/CascadingFolderPickerBlock'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { findFreeNoteFilenameBlock } from '@/services/lego_blocks/integrations/freeNoteFilenameBlock'
import {
  DESTINATION_RECENTS_KEY_BLOCK,
  ensureMarkdownFilenameBlock,
  normalizeSegmentsBlock,
  readDestinationUsageCountsBlock,
  readRecentDestinationsBlock,
  topUsedDestinationsBlock,
  writeDestinationUsageCountsBlock,
} from '@/services/lego_blocks/units/noteComposerBlock'
import { postItFilenameBlock } from '@/services/lego_blocks/units/postItNoteBlock'
import { invokeCapabilityOrThrow } from '@/services/orchestrators/capabilityRouterOrch'

// Save a canvas post-it as a vault note.
//
// Goes through `thoughts.create`, the same capability the New Note composer
// writes with, so the note gets the same frontmatter, key and `thought` tag a
// composed note would — a saved post-it is a note, not a lesser export.
//
// Order matters for durability: this only *returns* once the file is confirmed
// on disk. The caller swaps the tile after that, so a failed write leaves the
// post-it exactly as it was and its text is never only in a half-made note.

const POST_IT_ACTOR: CapabilityActor = { kind: 'human', id: 'ui.canvas.save-post-it' }

const QUICK_FOLDER_LIMIT = 6

/** What the save dialog opens with: a filename from the post-it's first line,
 *  and the folders you actually save to — recent first, then most used — with
 *  the newest one preselected. */
export function postItSaveDefaultsOrch(text: string): { filename: string; quickFolders: string[] } {
  const recent = readRecentDestinationsBlock()
  const mostUsed = topUsedDestinationsBlock(readDestinationUsageCountsBlock(), QUICK_FOLDER_LIMIT).map(e => e.path)
  const quickFolders = [...new Set([...recent, ...mostUsed])].slice(0, QUICK_FOLDER_LIMIT)
  return { filename: postItFilenameBlock(text), quickFolders }
}

export interface SavePostItToVaultInput {
  text: string
  folderPath: string
  filename: string
}

export async function savePostItToVaultOrch({
  text,
  folderPath,
  filename,
}: SavePostItToVaultInput): Promise<{ filePath: string }> {
  const folder = normalizeSegmentsBlock(folderPath).join('/')
  if (!folder) throw new Error('Pick a destination folder first.')
  if (!text.trim()) throw new Error('This post-it is empty.')

  const chosen = await findFreeNoteFilenameBlock(folder, ensureMarkdownFilenameBlock(filename))
  if (!chosen) throw new Error(`Could not find a free file name in ${folder}.`)

  const { output_path: filePath } = await invokeCapabilityOrThrow({
    capability: 'thoughts.create',
    input: {
      folder_path: folder,
      filename: chosen,
      content: text,
      title: null,
      date_header: false,
      emotions: [],
    },
    actor: POST_IT_ACTOR,
  })
  if (!(await getVaultFS().exists(filePath))) {
    throw new Error(`Saved, but ${filePath} is not on disk — the post-it was kept.`)
  }

  // Same recents + usage counts the composer reads, so a folder used from the
  // canvas shows up as recent/most-used in both places.
  const segments = folder.split('/')
  addRecent(DESTINATION_RECENTS_KEY_BLOCK, segments)
  const counts = readDestinationUsageCountsBlock()
  writeDestinationUsageCountsBlock({ ...counts, [folder]: (counts[folder] ?? 0) + 1 })

  return { filePath }
}
