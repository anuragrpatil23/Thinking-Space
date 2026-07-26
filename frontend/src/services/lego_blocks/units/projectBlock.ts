/**
 * Project — a user-defined "what am I trying to do here" context that can be
 * bound to any canvas surface (Home, Webull F9, future surfaces). Stored as a
 * settings-only concept in `.thinking-space/projects.json`; not derived from
 * the organizer.
 *
 * Schema is intentionally minimal: a short name and a mission statement. UI
 * surfaces (anchor headings, pickers) render `name` as the title and `mission`
 * as the body copy.
 */

export interface ProjectBlock {
  /** Stable id (crypto.randomUUID where available, falls back to a time+random suffix). */
  id: string
  /** Short display name (e.g. "Personal market workspace"). */
  name: string
  /** One- or two-line mission statement shown under the name on surfaces. */
  mission: string
  /**
   * Vault-relative folder this project's notes live in (e.g. `acceleration_core/F9`).
   * Empty when the project has no vault home yet.
   *
   * This is a *pointer*, never an identity — `id` is the identity. Renaming the
   * folder is a one-line edit here rather than a rewrite of every record that
   * belongs to the project.
   */
  vaultPath: string
  /**
   * Whether the Thinking Organizer builds an undertaking index for this project.
   *
   * Off by default and opt-in per project: the registry stays complete and shows
   * everything detected, but the organizer only covers projects deliberately
   * defined for it.
   */
  organizerEnabled: boolean
}

/** v1: { id, name, mission }. v2 adds vaultPath + organizerEnabled. */
export const PROJECTS_SCHEMA_VERSION_BLOCK = 2

export interface ProjectsFileBlock {
  version: number
  projects: ProjectBlock[]
}

export function createProjectIdBlock(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function isValidProjectBlock(value: unknown): value is ProjectBlock {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProjectBlock>
  return (
    typeof candidate.id === 'string' && candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    typeof candidate.mission === 'string'
  )
}

/** Normalize vault-relative paths: forward slashes, no leading/trailing slash. */
export function normalizeVaultPathBlock(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim()
}

/**
 * Fill in v2 fields on a record that may have been written by any earlier
 * version. Upgrading must never drop a project: the fields default rather than
 * invalidate, because a rejected record is an erased one once the next write
 * persists the filtered list.
 */
function upgradeProjectBlock(value: ProjectBlock): ProjectBlock {
  const candidate = value as Partial<ProjectBlock>
  return {
    id: value.id,
    name: value.name,
    mission: value.mission,
    vaultPath: normalizeVaultPathBlock(candidate.vaultPath),
    organizerEnabled: candidate.organizerEnabled === true,
  }
}

export function normalizeProjectsFileBlock(value: unknown): ProjectsFileBlock | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ProjectsFileBlock>
  // Accept any version at or below current and migrate forward. Rejecting an
  // older file here would make readProjectsBlock return [], and the next write
  // would persist that empty list over the user's real projects.
  if (typeof candidate.version !== 'number') return null
  if (candidate.version > PROJECTS_SCHEMA_VERSION_BLOCK) return null
  if (!Array.isArray(candidate.projects)) return null
  const projects = candidate.projects.filter(isValidProjectBlock).map(upgradeProjectBlock)
  return { version: PROJECTS_SCHEMA_VERSION_BLOCK, projects }
}
