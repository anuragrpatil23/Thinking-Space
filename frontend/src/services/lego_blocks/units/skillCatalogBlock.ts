// The skills this build carries. Embedded at build time by the CLI bundler
// (frontend/scripts/bundle-cli.mjs), which reads every skill folder it finds:
// frontend/src/skills/<name>/ in the public app, and the private F9 code's
// skills when that folder is present. Each folder holds contract.json,
// SKILL.md and any reference files. Outside the CLI bundle the catalog is
// empty.

import type { SkillContractBlock } from './skillContractBlock'

export interface SkillBlock {
  contract: SkillContractBlock
  /** SKILL.md */
  instructions: string
  /** Reference files by path inside the skill folder, e.g. "reference/x.py" */
  files: Record<string, string>
}

declare const __THINKSPC_SKILLS__: SkillBlock[] | undefined

export function listSkillsBlock(): SkillBlock[] {
  return typeof __THINKSPC_SKILLS__ !== 'undefined' ? __THINKSPC_SKILLS__ : []
}

export function getSkillBlock(name: string): SkillBlock {
  const skill = listSkillsBlock().find(g => g.contract.name === name)
  if (!skill) {
    const known = listSkillsBlock().map(g => g.contract.name)
    throw new Error(`No skill "${name}".${known.length ? ` Skills: ${known.join(', ')}` : ' This build carries no skills.'}`)
  }
  return skill
}
