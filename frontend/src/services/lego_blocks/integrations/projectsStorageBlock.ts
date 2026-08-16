import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  PROJECTS_SCHEMA_VERSION_BLOCK,
  createProjectUuidBlock,
  isValidProjectKeyBlock,
  normalizeProjectRootBlock,
  normalizeProjectsFileBlock,
  relativizeProjectRootBlock,
  type ProjectBlock,
  type ProjectsFileBlock,
} from '@/services/lego_blocks/units/projectBlock'
import {
  normalizeProjectKindBlock,
  type ProjectKindBlock,
} from '@/services/lego_blocks/units/projectKindBlock'
import { renderProjectsMarkdownBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'

/**
 * projectsStorageBlock — read/write `.thinking-space/projects.json` and emit
 * an in-process change event so surfaces (canvas anchors, settings page) stay
 * in sync without a full app reload.
 *
 * Stored format: `{ version, projects: [ProjectBlock, ...] }`. The file is
 * created on first write; reads return an empty list when missing.
 *
 * `uuid` and `key` are addresses and are therefore write-once: `addProjectBlock`
 * mints them and `updateProjectBlock` accepts a `key` only for a project that
 * has none. Everything else is presentation and freely editable.
 */

export const PROJECTS_FILE_PATH_BLOCK = '.thinking-space/projects.json'
export const PROJECTS_MIRROR_PATH_BLOCK = '.thinking-space/projects.md'
export const PROJECTS_FILE_DIR_BLOCK = '.thinking-space'
export const PROJECTS_CHANGE_EVENT_BLOCK = 'thinking-space:projects-changed'

export interface CreateProjectInputBlock {
  name: string
  /** Chosen once here; ignored later. Invalid or taken → left empty. */
  key?: string
  mission?: string
  description?: string
  roots?: string[]
  group?: string
  aliases?: string[]
  color?: string
  kind?: ProjectKindBlock
}

export interface UpdateProjectInputBlock {
  name?: string
  /** Only honoured while the project has no key — see the write-once note above. */
  key?: string
  mission?: string
  description?: string
  roots?: string[]
  group?: string
  aliases?: string[]
  color?: string
  kind?: ProjectKindBlock
}

function normalizeRootListBlock(value: string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  // The adoption panel hands us the working directories the parser saw, which
  // are absolute by nature. Anything inside the vault is stored relative so it
  // survives the trip to a device that mounts the vault somewhere else.
  const vaultRoot = getStoredVaultRoot()
  for (const raw of value ?? []) {
    const root = relativizeProjectRootBlock(normalizeProjectRootBlock(raw), vaultRoot)
    if (!root || seen.has(root)) continue
    seen.add(root)
    out.push(root)
  }
  return out
}

function normalizeAliasListBlock(value: string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value ?? []) {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/**
 * Read outcome, kept distinct from "no projects" on purpose.
 *
 * `unreadable` means the file exists but could not be parsed — most plausibly
 * written by a newer app version on another device via iCloud. Treating that as
 * an empty list would let the next mutation persist `[]` over real projects, so
 * mutators refuse to write instead.
 */
type ProjectsReadStateBlock =
  | { status: 'ok'; projects: ProjectBlock[] }
  | { status: 'missing' }
  | { status: 'unreadable' }

async function readProjectsStateBlock(): Promise<ProjectsReadStateBlock> {
  try {
    const fs = getVaultFS()
    if (!(await fs.exists(PROJECTS_FILE_PATH_BLOCK))) return { status: 'missing' }
    const raw = await fs.read(PROJECTS_FILE_PATH_BLOCK)
    const parsed = JSON.parse(raw) as unknown
    const file = normalizeProjectsFileBlock(parsed)
    if (!file) return { status: 'unreadable' }
    return { status: 'ok', projects: file.projects }
  } catch {
    return { status: 'unreadable' }
  }
}

/** Projects to mutate, or null when writing would risk clobbering the file. */
async function readProjectsForWriteBlock(): Promise<ProjectBlock[] | null> {
  const state = await readProjectsStateBlock()
  if (state.status === 'unreadable') return null
  return state.status === 'ok' ? state.projects : []
}

function dispatchProjectsChangeBlock(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(PROJECTS_CHANGE_EVENT_BLOCK))
  } catch {
    /* no-op */
  }
}

export async function readProjectsBlock(): Promise<ProjectBlock[]> {
  const state = await readProjectsStateBlock()
  return state.status === 'ok' ? state.projects : []
}

async function writeProjectsBlock(projects: ProjectBlock[]): Promise<void> {
  const fs = getVaultFS()
  await fs.mkdir(PROJECTS_FILE_DIR_BLOCK)
  const payload: ProjectsFileBlock = {
    version: PROJECTS_SCHEMA_VERSION_BLOCK,
    projects,
  }
  await fs.write(PROJECTS_FILE_PATH_BLOCK, JSON.stringify(payload, null, 2))
  await writeProjectsMirrorBlock(projects)
  dispatchProjectsChangeBlock()
}

/**
 * Rewrite the human-readable `projects.md` mirror beside the JSON.
 *
 * A mirror, not a source: it exists so a person or an agent reading the vault
 * can see what the projects are without parsing JSON. Best-effort and always
 * after the JSON write — the registry must never fail to save because a
 * courtesy file could not be written.
 */
async function writeProjectsMirrorBlock(projects: ProjectBlock[]): Promise<void> {
  try {
    const fs = getVaultFS()
    const next = renderProjectsMarkdownBlock(projects)
    if (await fs.exists(PROJECTS_MIRROR_PATH_BLOCK)) {
      if ((await fs.read(PROJECTS_MIRROR_PATH_BLOCK)) === next) return
    }
    await fs.write(PROJECTS_MIRROR_PATH_BLOCK, next)
  } catch {
    /* no-op */
  }
}

export async function addProjectBlock(input: CreateProjectInputBlock): Promise<ProjectBlock | null> {
  const projects = await readProjectsForWriteBlock()
  if (!projects) return null
  // A key is an address, so a duplicate is a collision, not a preference: two
  // projects sharing one would file their chains into the same directory.
  const taken = new Set(projects.map(p => p.key).filter(Boolean))
  const key = isValidProjectKeyBlock(input.key) && !taken.has(input.key) ? input.key : ''
  const next: ProjectBlock = {
    uuid: createProjectUuidBlock(),
    key,
    name: input.name.trim() || 'Untitled project',
    mission: (input.mission ?? '').trim(),
    description: (input.description ?? '').trim(),
    roots: normalizeRootListBlock(input.roots),
    group: (input.group ?? '').trim(),
    aliases: normalizeAliasListBlock(input.aliases),
    // Organizer config: chosen later, in the project's own settings, never at
    // creation. Empty means the defaults (`epics`, "Tasks").
    taskDir: '',
    taskLabel: '',
    color: (input.color ?? '').trim(),
    kind: normalizeProjectKindBlock(input.kind),
  }
  await writeProjectsBlock([...projects, next])
  return next
}

export async function updateProjectBlock(uuid: string, patch: UpdateProjectInputBlock): Promise<ProjectBlock | null> {
  const projects = await readProjectsForWriteBlock()
  if (!projects) return null
  const taken = new Set(projects.filter(p => p.uuid !== uuid).map(p => p.key).filter(Boolean))
  let updated: ProjectBlock | null = null
  const nextList = projects.map(project => {
    if (project.uuid !== uuid) return project
    // Write-once. A project that already has a key keeps it whatever the patch
    // says: hundreds of chains and organizer records are filed under it, and
    // renaming the address orphans every one of them.
    const key =
      project.key ||
      (isValidProjectKeyBlock(patch.key) && !taken.has(patch.key) ? patch.key : '')
    updated = {
      ...project,
      key,
      name: patch.name !== undefined ? patch.name.trim() || project.name : project.name,
      mission: patch.mission !== undefined ? patch.mission : project.mission,
      description: patch.description !== undefined ? patch.description : project.description,
      roots: patch.roots !== undefined ? normalizeRootListBlock(patch.roots) : project.roots,
      group: patch.group !== undefined ? patch.group.trim() : project.group,
      aliases: patch.aliases !== undefined ? normalizeAliasListBlock(patch.aliases) : project.aliases,
      color: patch.color !== undefined ? patch.color.trim() : project.color,
      kind: patch.kind !== undefined ? normalizeProjectKindBlock(patch.kind) : project.kind,
    }
    return updated
  })
  if (!updated) return null
  await writeProjectsBlock(nextList)
  return updated
}

export async function removeProjectBlock(uuid: string): Promise<void> {
  const projects = await readProjectsForWriteBlock()
  if (!projects) return
  const next = projects.filter(project => project.uuid !== uuid)
  if (next.length === projects.length) return
  await writeProjectsBlock(next)
}

export async function getProjectByUuidBlock(uuid: string | null | undefined): Promise<ProjectBlock | null> {
  if (!uuid) return null
  const projects = await readProjectsBlock()
  return projects.find(project => project.uuid === uuid) ?? null
}
