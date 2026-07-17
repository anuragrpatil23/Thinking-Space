// Workspace-profile identity for this window (Chrome-profile semantics: each
// profile has its own vault, window, and accent color). Resolved once by the
// preload at window creation; web/PWA builds fall back to the default profile.

export interface WorkspaceProfileBlock {
  id: string
  name: string
  accentColor: string | null
  icon: string | null
  isDefault: boolean
  vaultRoot: string | null
  webviewPartition: string
  openWindowCount: number
}

const DEFAULT_WORKSPACE_PROFILE_BLOCK: WorkspaceProfileBlock = {
  id: 'default',
  name: 'Main',
  accentColor: null,
  icon: null,
  isDefault: true,
  vaultRoot: null,
  webviewPartition: 'persist:thinking-space-links',
  openWindowCount: 1,
}

interface ProfileElectronBridgeBlock {
  isElectron?: boolean
  profileGet?: () => WorkspaceProfileBlock
  onProfileChanged?: (handler: (profile: WorkspaceProfileBlock) => void) => () => void
  profilesList?: () => Promise<WorkspaceProfileBlock[]>
  profilesCreate?: (input: { name: string; vaultRoot: string; accentColor?: string | null; icon?: string | null }) => Promise<WorkspaceProfileBlock>
  profilesUpdate?: (input: { id: string; name?: string; accentColor?: string | null; icon?: string | null }) => Promise<WorkspaceProfileBlock>
  profilesDelete?: (profileId: string) => Promise<void>
  profilesOpenWindow?: (profileId: string) => Promise<void>
}

function getProfileBridgeBlock(): ProfileElectronBridgeBlock | null {
  if (typeof window === 'undefined') return null
  const api = (window as { electronAPI?: ProfileElectronBridgeBlock }).electronAPI
  return api?.isElectron ? api : null
}

/** The profile this window belongs to. Safe in all runtimes. */
export function getCurrentWorkspaceProfileBlock(): WorkspaceProfileBlock {
  const bridge = getProfileBridgeBlock()
  return bridge?.profileGet?.() ?? DEFAULT_WORKSPACE_PROFILE_BLOCK
}

/** Subscribe to live profile edits (name/accent). Returns an unsubscribe fn. */
export function subscribeWorkspaceProfileChangedBlock(
  handler: (profile: WorkspaceProfileBlock) => void,
): () => void {
  const bridge = getProfileBridgeBlock()
  return bridge?.onProfileChanged?.(handler) ?? (() => undefined)
}

export function isWorkspaceProfilesSupportedBlock(): boolean {
  return typeof getProfileBridgeBlock()?.profilesList === 'function'
}

export async function listWorkspaceProfilesBlock(): Promise<WorkspaceProfileBlock[]> {
  const bridge = getProfileBridgeBlock()
  if (!bridge?.profilesList) return [getCurrentWorkspaceProfileBlock()]
  return bridge.profilesList()
}

export async function createWorkspaceProfileBlock(input: {
  name: string
  vaultRoot: string
  accentColor?: string | null
  icon?: string | null
}): Promise<WorkspaceProfileBlock> {
  const bridge = getProfileBridgeBlock()
  if (!bridge?.profilesCreate) throw new Error('Profiles need the desktop app.')
  return bridge.profilesCreate(input)
}

export async function updateWorkspaceProfileBlock(input: {
  id: string
  name?: string
  accentColor?: string | null
  icon?: string | null
}): Promise<WorkspaceProfileBlock> {
  const bridge = getProfileBridgeBlock()
  if (!bridge?.profilesUpdate) throw new Error('Profiles need the desktop app.')
  return bridge.profilesUpdate(input)
}

export async function deleteWorkspaceProfileBlock(profileId: string): Promise<void> {
  const bridge = getProfileBridgeBlock()
  if (!bridge?.profilesDelete) throw new Error('Profiles need the desktop app.')
  await bridge.profilesDelete(profileId)
}

export async function openWorkspaceProfileWindowBlock(profileId: string): Promise<void> {
  const bridge = getProfileBridgeBlock()
  if (!bridge?.profilesOpenWindow) throw new Error('Profiles need the desktop app.')
  await bridge.profilesOpenWindow(profileId)
}
