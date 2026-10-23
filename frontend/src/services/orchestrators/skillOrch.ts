// `thinkspc skill.*`: hand a job to the user's own coding agent and check what
// it produced. See skillContractBlock for what a skill is.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getSkillBlock, listSkillsBlock } from '@/services/lego_blocks/units/skillCatalogBlock'
import { validateSkillFolderBlock, type SkillCheckBlock } from '@/services/lego_blocks/units/skillContractBlock'

export function listSkillsOrch(): Array<{ name: string; title: string; summary: string; version: number; folder: string }> {
  return listSkillsBlock().map(({ contract: c }) => ({ name: c.name, title: c.title, summary: c.summary, version: c.version, folder: c.folder }))
}

export function getSkillOrch(name: string) {
  const skill = getSkillBlock(name)
  return { name, title: skill.contract.title, version: skill.contract.version, folder: skill.contract.folder, instructions: skill.instructions, files: Object.keys(skill.files).sort(), contract: skill.contract }
}

export function getSkillFileOrch(name: string, path: string): { path: string; content: string } {
  const skill = getSkillBlock(name)
  const content = skill.files[path]
  if (content === undefined) throw new Error(`Skill "${name}" has no file "${path}". Files: ${Object.keys(skill.files).sort().join(', ')}`)
  return { path, content }
}

/** Every file under a vault folder, as paths relative to it (hidden files skipped). */
async function listFolderFilesBlock(folder: string): Promise<string[]> {
  const fs = getVaultFS()
  const out: string[] = []
  const walk = async (rel: string) => {
    const listed = await fs.list(rel ? `${folder}/${rel}` : folder).catch(() => ({ files: [] as string[], folders: [] as string[] }))
    for (const file of listed.files) out.push(rel ? `${rel}/${file}` : file)
    for (const sub of listed.folders) await walk(rel ? `${rel}/${sub}` : sub)
  }
  await walk('')
  return out.sort()
}

export async function validateSkillOrch(name: string, folderOverride?: string): Promise<{ name: string; folder: string; version: number; ok: boolean; checks: SkillCheckBlock[] }> {
  const skill = getSkillBlock(name)
  const folder = (folderOverride || skill.contract.folder).replace(/\/+$/, '')
  const fs = getVaultFS()
  const files = await listFolderFilesBlock(folder)
  const texts = new Map<string, string | null>()
  for (const rule of skill.contract.rules) {
    if ((rule.kind === 'csv' || rule.kind === 'monthsContiguous') && files.includes(rule.file) && !texts.has(rule.file)) {
      texts.set(rule.file, await fs.read(`${folder}/${rule.file}`).catch(() => null))
    }
  }
  const checks = validateSkillFolderBlock(skill.contract, files, f => texts.get(f) ?? null)
  return { name, folder, version: skill.contract.version, ok: checks.every(c => c.ok), checks }
}
