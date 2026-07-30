import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { parseAskMarkdownBlock, type Ask } from '@/services/lego_blocks/units/aiActivityAskBlock'

// Reads the old organizer's asks. They live beside the project, under its vault
// path — `<projectRoot>/thinking-organizer/epics/` — not in `ai-activity/`,
// because they are Anurag's hand-written records, the other half of the loop.
// Read-only here: the seam never edits the old store.

export function askEpicsDirBlock(projectRoot: string): string {
  return `${projectRoot.replace(/\/+$/, '')}/thinking-organizer/epics`
}

export async function listAsksBlock(projectRoot: string): Promise<Ask[]> {
  const fs = getVaultFS()
  const dir = askEpicsDirBlock(projectRoot)
  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    return []
  }
  const out: Ask[] = []
  for (const name of names) {
    try {
      const ask = parseAskMarkdownBlock(await fs.read(`${dir}/${name}`))
      if (ask) out.push(ask)
    } catch {
      // A half-finished hand edit skips, never breaks the list.
    }
  }
  return out
}
