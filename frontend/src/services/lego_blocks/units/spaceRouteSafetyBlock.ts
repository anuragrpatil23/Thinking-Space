export type VaultPathKindForSpaceRouteBlock = 'file' | 'folder' | 'missing'

export interface SpaceRouteSafetyDepsBlock {
  getVaultPathKind: (path: string) => Promise<VaultPathKindForSpaceRouteBlock> | VaultPathKindForSpaceRouteBlock
}

export interface WorkspaceRouteTabBlock {
  id: string
  route: string
}

const THINKING_SPACE_PATH_BLOCK = '/thinking-space'
const THINKING_ORGANIZER_PATHS_BLOCK = new Set(['/thinking-organizer', '/file-organizer'])
const FILE_QUERY_PARAM_BLOCK = 'file'
const PROJECT_ROOT_QUERY_PARAM_BLOCK = 'projectRoot'
const SELECTED_NODE_QUERY_PARAM_BLOCK = 'selectedNode'

function normalizeWorkspaceRouteBlock(route: string): string {
  const trimmed = route.trim()
  if (!trimmed) return THINKING_SPACE_PATH_BLOCK
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function safeDecodeComponentBlock(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeVaultPathParamBlock(value: string): string {
  return safeDecodeComponentBlock(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

function buildRouteFromPartsBlock(pathname: string, searchParams: URLSearchParams, hash: string): string {
  const query = searchParams.toString()
  return `${pathname}${query ? `?${query}` : ''}${hash || ''}`
}

export async function sanitizeWorkspaceRouteForSpaceBlock(
  route: string,
  deps: SpaceRouteSafetyDepsBlock,
): Promise<string> {
  const normalizedRoute = normalizeWorkspaceRouteBlock(route)

  let parsed: URL
  try {
    parsed = new URL(normalizedRoute, 'https://thinking-space.local')
  } catch {
    return THINKING_SPACE_PATH_BLOCK
  }

  const pathname = parsed.pathname
  const searchParams = parsed.searchParams

  if (pathname === THINKING_SPACE_PATH_BLOCK) {
    const fileParam = searchParams.get(FILE_QUERY_PARAM_BLOCK)
    if (fileParam) {
      const normalizedFilePath = normalizeVaultPathParamBlock(fileParam)
      if (!normalizedFilePath) {
        searchParams.delete(FILE_QUERY_PARAM_BLOCK)
      } else {
        const kind = await deps.getVaultPathKind(normalizedFilePath)
        if (kind !== 'file') {
          searchParams.delete(FILE_QUERY_PARAM_BLOCK)
        } else {
          searchParams.set(FILE_QUERY_PARAM_BLOCK, normalizedFilePath)
        }
      }
    }

    return buildRouteFromPartsBlock(pathname, searchParams, parsed.hash)
  }

  if (THINKING_ORGANIZER_PATHS_BLOCK.has(pathname)) {
    const projectRootParam = searchParams.get(PROJECT_ROOT_QUERY_PARAM_BLOCK)
    if (projectRootParam) {
      const normalizedProjectRoot = normalizeVaultPathParamBlock(projectRootParam)
      if (!normalizedProjectRoot) {
        searchParams.delete(PROJECT_ROOT_QUERY_PARAM_BLOCK)
        searchParams.delete(SELECTED_NODE_QUERY_PARAM_BLOCK)
      } else {
        const kind = await deps.getVaultPathKind(normalizedProjectRoot)
        if (kind !== 'folder') {
          searchParams.delete(PROJECT_ROOT_QUERY_PARAM_BLOCK)
          searchParams.delete(SELECTED_NODE_QUERY_PARAM_BLOCK)
        } else {
          searchParams.set(PROJECT_ROOT_QUERY_PARAM_BLOCK, normalizedProjectRoot)
        }
      }
    }

    return buildRouteFromPartsBlock(pathname, searchParams, parsed.hash)
  }

  return buildRouteFromPartsBlock(pathname, searchParams, parsed.hash)
}

export async function sanitizeWorkspaceTabsForSpaceBlock<T extends WorkspaceRouteTabBlock>(
  tabs: T[],
  deps: SpaceRouteSafetyDepsBlock,
): Promise<T[]> {
  const sanitized: T[] = []
  for (const tab of tabs) {
    const nextRoute = await sanitizeWorkspaceRouteForSpaceBlock(tab.route, deps)
    if (nextRoute === tab.route) {
      sanitized.push(tab)
      continue
    }
    sanitized.push({
      ...tab,
      route: nextRoute,
    })
  }
  return sanitized
}
