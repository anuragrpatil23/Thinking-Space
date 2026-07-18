import type { DragEvent } from 'react'

export interface PersistedExplorerState {
  expandedPaths?: string[]
  selectedFolderPath?: string | null
  selectedFilePath?: string | null
  // 'list' is legacy (the old Numbered list view) — read for migration to
  // 'compact', never written anymore.
  viewMode?: 'tree' | 'compact' | 'grid' | 'list'
  /** Per-folder file numbering toggle, only meaningful in compact mode. */
  compactNumbering?: boolean
}

export type ExplorerPathKindBlock = 'file' | 'folder'

export interface DroppedPathPayloadBlock {
  path: string
  kind: ExplorerPathKindBlock
}

export const EXPLORER_PERSISTENCE_PREFIX = 'ltm.vaultExplorer.state.v1'

function normalizeDroppedPathBlock(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

export function normalizePersistedExpandedPaths(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    : []
  const unique = new Set<string>([''])
  for (const path of list) {
    if (!path) continue
    unique.add(path)
  }
  return [...unique]
}

export function readPersistedExplorerState(storageKey: string): PersistedExplorerState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedExplorerState
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export function getParentPath(path: string): string {
  const idx = path.lastIndexOf('/')
  if (idx < 0) return ''
  return path.slice(0, idx)
}

export function getLeafName(path: string): string {
  const idx = path.lastIndexOf('/')
  if (idx < 0) return path
  return path.slice(idx + 1)
}

export function hasNodeDragType(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer.types)
  return types.includes('application/x-ltm-node-id') || types.includes('text/ltm-node-id')
}

export function hasPathDragType(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer.types)
  return types.includes('application/x-ltm-path') || types.includes('text/ltm-file-path')
}

export function readDroppedPath(event: DragEvent): DroppedPathPayloadBlock | null {
  const explicitRaw = event.dataTransfer.getData('application/x-ltm-path').trim()
  const textFallbackRaw = event.dataTransfer.getData('text/ltm-file-path').trim()
  const plainRaw = event.dataTransfer.getData('text/plain').trim()
  const raw = explicitRaw || textFallbackRaw || plainRaw
  if (!raw) return null

  const kindRaw = event.dataTransfer.getData('application/x-ltm-path-kind').trim()
  const kind = kindRaw === 'folder' ? 'folder' : 'file'
  const path = normalizeDroppedPathBlock(raw.startsWith('ltm-path:') ? raw.slice('ltm-path:'.length) : raw)
  if (!path) return null

  return { path, kind }
}

export function readDroppedNodeId(event: DragEvent): string | null {
  const explicit = event.dataTransfer.getData('application/x-ltm-node-id').trim()
  if (explicit) return explicit
  const textFallback = event.dataTransfer.getData('text/ltm-node-id').trim()
  if (textFallback) return textFallback
  const plain = event.dataTransfer.getData('text/plain').trim()
  if (plain.startsWith('ltm-node:')) return plain.slice('ltm-node:'.length).trim() || null
  return null
}
