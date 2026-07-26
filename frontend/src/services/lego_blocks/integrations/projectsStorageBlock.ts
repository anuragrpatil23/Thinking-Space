import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import {
  PROJECTS_SCHEMA_VERSION_BLOCK,
  createProjectIdBlock,
  normalizeProjectsFileBlock,
  normalizeVaultPathBlock,
  type ProjectBlock,
  type ProjectsFileBlock,
} from '@/services/lego_blocks/units/projectBlock'

/**
 * projectsStorageBlock — read/write `.thinking-space/projects.json` and emit
 * an in-process change event so surfaces (canvas anchors, settings page) stay
 * in sync without a full app reload.
 *
 * Stored format: `{ version, projects: [{ id, name, mission }, ...] }`. The
 * file is created on first write; reads return an empty list when missing.
 */

export const PROJECTS_FILE_PATH_BLOCK = '.thinking-space/projects.json'
export const PROJECTS_FILE_DIR_BLOCK = '.thinking-space'
export const PROJECTS_CHANGE_EVENT_BLOCK = 'thinking-space:projects-changed'

export interface CreateProjectInputBlock {
  name: string
  mission?: string
  vaultPath?: string
  organizerEnabled?: boolean
}

export interface UpdateProjectInputBlock {
  name?: string
  mission?: string
  vaultPath?: string
  organizerEnabled?: boolean
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
  dispatchProjectsChangeBlock()
}

export async function addProjectBlock(input: CreateProjectInputBlock): Promise<ProjectBlock | null> {
  const projects = await readProjectsForWriteBlock()
  if (!projects) return null
  const next: ProjectBlock = {
    id: createProjectIdBlock(),
    name: input.name.trim() || 'Untitled project',
    mission: (input.mission ?? '').trim(),
    vaultPath: normalizeVaultPathBlock(input.vaultPath),
    organizerEnabled: input.organizerEnabled === true,
  }
  await writeProjectsBlock([...projects, next])
  return next
}

export async function updateProjectBlock(id: string, patch: UpdateProjectInputBlock): Promise<ProjectBlock | null> {
  const projects = await readProjectsForWriteBlock()
  if (!projects) return null
  let updated: ProjectBlock | null = null
  const nextList = projects.map(project => {
    if (project.id !== id) return project
    updated = {
      ...project,
      name: patch.name !== undefined ? patch.name.trim() || project.name : project.name,
      mission: patch.mission !== undefined ? patch.mission : project.mission,
      vaultPath: patch.vaultPath !== undefined ? normalizeVaultPathBlock(patch.vaultPath) : project.vaultPath,
      organizerEnabled: patch.organizerEnabled !== undefined ? patch.organizerEnabled : project.organizerEnabled,
    }
    return updated
  })
  if (!updated) return null
  await writeProjectsBlock(nextList)
  return updated
}

export async function removeProjectBlock(id: string): Promise<void> {
  const projects = await readProjectsForWriteBlock()
  if (!projects) return
  const next = projects.filter(project => project.id !== id)
  if (next.length === projects.length) return
  await writeProjectsBlock(next)
}

export async function getProjectByIdBlock(id: string | null | undefined): Promise<ProjectBlock | null> {
  if (!id) return null
  const projects = await readProjectsBlock()
  return projects.find(project => project.id === id) ?? null
}
