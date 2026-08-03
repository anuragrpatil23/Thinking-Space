import { getVaultFS, type VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { THINKING_ORGANIZER_DIR } from '@/services/lego_blocks/integrations/projectStorageBlock'
import { normalizeHexColorBlock, normalizeTagListBlock, tagLookupKeyBlock } from '@/services/lego_blocks/units/tagBlock'

export interface OrganizerProgramGroupEntryBlock {
  id: string
  name: string
  programIds: string[]
  collapsed?: boolean
}

export interface OrganizerUiStateBlock {
  schemaVersion: number
  updatedAt: string
  projectName?: string
  /**
   * The id this project's chains and undertakings are filed under in
   * `ai-activity/`, when it differs from the project root's basename.
   *
   * The basename was the whole mapping, which works only while the folder
   * happens to be named the same thing: `lifeblood_systems/thinkingspace.ai`
   * carries a fully populated registry under `Thinking-Space` and resolved to
   * `thinkingspace.ai`, so the index came up empty with nothing to say why.
   * Stored rather than guessed, and stored *here* because it is per-project
   * state and this is the per-project state file.
   */
  aiProjectId?: string
  missionStatement?: string
  presetTags: string[]
  tagColors: Record<string, string>
  programGroups: OrganizerProgramGroupEntryBlock[]
}

const ORGANIZER_UI_STATE_SCHEMA_VERSION_BLOCK = 3
const ORGANIZER_UI_STATE_FILE_BLOCK = 'organizer-ui-state.json'

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function normalizePresetTags(raw: unknown): string[] {
  return normalizeTagListBlock(Array.isArray(raw) ? raw.map(String) : [])
}

function normalizeTagColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  const normalizedColors: Record<string, string> = {}
  for (const [tag, color] of Object.entries(record)) {
    const tagKey = tagLookupKeyBlock(String(tag))
    const normalizedColor = normalizeHexColorBlock(
      typeof color === 'string' ? color : null,
    )
    if (!tagKey || !normalizedColor) continue
    normalizedColors[tagKey] = normalizedColor
  }
  return normalizedColors
}

function dedupeProgramIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const normalized = id.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function normalizeProgramGroups(groups: unknown): OrganizerProgramGroupEntryBlock[] {
  if (!Array.isArray(groups)) return []
  const seenGroupIds = new Set<string>()
  const assignedPrograms = new Set<string>()
  const normalized: OrganizerProgramGroupEntryBlock[] = []

  for (const value of groups) {
    if (!value || typeof value !== 'object') continue
    const group = value as Record<string, unknown>
    const id = String(group.id ?? '').trim()
    if (!id || seenGroupIds.has(id)) continue
    seenGroupIds.add(id)

    const name = String(group.name ?? '').trim() || 'Group'
    const rawProgramIds = Array.isArray(group.programIds) ? group.programIds.map(String) : []
    const nextProgramIds: string[] = []
    for (const programId of dedupeProgramIds(rawProgramIds)) {
      if (assignedPrograms.has(programId)) continue
      assignedPrograms.add(programId)
      nextProgramIds.push(programId)
    }

    normalized.push({
      id,
      name,
      programIds: nextProgramIds,
      collapsed: !!group.collapsed,
    })
  }

  return normalized
}

function normalizeProjectName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed || undefined
}

function normalizeMissionStatement(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed || undefined
}

function normalizeUpdatedAt(raw: unknown): string {
  if (typeof raw !== 'string') return new Date().toISOString()
  const trimmed = raw.trim()
  if (!trimmed) return new Date().toISOString()
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

export function normalizeOrganizerUiStateBlock(raw: unknown): OrganizerUiStateBlock {
  const record = raw && typeof raw === 'object'
    ? (raw as Record<string, unknown>)
    : {}
  return {
    schemaVersion: ORGANIZER_UI_STATE_SCHEMA_VERSION_BLOCK,
    updatedAt: normalizeUpdatedAt(record.updatedAt),
    projectName: normalizeProjectName(record.projectName),
    aiProjectId: normalizeProjectName(record.aiProjectId),
    missionStatement: normalizeMissionStatement(record.missionStatement),
    presetTags: normalizePresetTags(record.presetTags),
    tagColors: normalizeTagColors(record.tagColors),
    programGroups: normalizeProgramGroups(record.programGroups),
  }
}

export function organizerUiStatePathBlock(projectRoot: string): string {
  const normalizedRoot = normalizePath(projectRoot)
  if (!normalizedRoot) return `${THINKING_ORGANIZER_DIR}/${ORGANIZER_UI_STATE_FILE_BLOCK}`
  return `${normalizedRoot}/${THINKING_ORGANIZER_DIR}/${ORGANIZER_UI_STATE_FILE_BLOCK}`
}

// `fs` is injectable for tests and defaults to the live vault, which is what
// every caller in the app wants. It used to be required, and the wrapper that
// existed only to supply it was a file of its own.
export async function readOrganizerUiStateBlock(
  projectRoot: string,
  fs: VaultFS = getVaultFS(),
): Promise<OrganizerUiStateBlock | null> {
  try {
    const raw = await fs.read(organizerUiStatePathBlock(projectRoot))
    return normalizeOrganizerUiStateBlock(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function writeOrganizerUiStateBlock(
  projectRoot: string,
  input: OrganizerUiStateBlock,
  fs: VaultFS = getVaultFS(),
): Promise<OrganizerUiStateBlock> {
  const normalized = normalizeOrganizerUiStateBlock(input)
  const normalizedRoot = normalizePath(projectRoot)
  const organizerDir = normalizedRoot
    ? `${normalizedRoot}/${THINKING_ORGANIZER_DIR}`
    : THINKING_ORGANIZER_DIR
  try {
    await fs.mkdir(organizerDir)
  } catch {
    // Directory may already exist.
  }
  await fs.write(organizerUiStatePathBlock(projectRoot), `${JSON.stringify(normalized, null, 2)}\n`)
  return normalized
}
