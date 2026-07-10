import type { FileStat } from '@/services/lego_blocks/units/typesBlock'
import {
  applyFolderMapBlock,
  type FolderMapDisplay,
  parseFolderMapBlock,
} from '@/services/lego_blocks/units/folderMapBlock'
import {
  getVaultFS,
  normalizeCapacitorStoredVaultRoot,
  type VaultEntry,
} from '@/services/lego_blocks/integrations/fsBlock'
import {
  parseWikilinkTargetBlock,
  resolveWikilinkPathBlock,
  splitTextByWikilinksBlock,
} from '@/services/lego_blocks/integrations/obsidianWikilinkBlock'
import {
  splitFrontmatterDocumentBlock,
  isLikelyYamlPathScalarBlock,
  findYamlCommentStartIndexBlock,
} from '@/services/lego_blocks/units/linkIndexBlock'
import { resolveFrontmatterDatesBlock } from '@/services/lego_blocks/units/frontmatterDatesBlock'
import {
  getBacklinksForPathPrefix,
  getAllFilePaths,
  updateLinkTargets,
  updateLinkSourcePaths,
} from '@/services/lego_blocks/integrations/dbBlock'
import { syncSingleFile } from './vaultSyncOrch'
import { getStoredVaultRoot } from './storageOrch'
import { isCapacitorNative, isElectron } from './runtimeOrch'

export interface FolderEntries {
  folders: string[]
  /**
   * File basenames in display order. When a `_map.md` is present, files are ordered
   * by the map (mapped entries first, unmapped alphabetical after — per the "folder
   * is truth" safety rule). Without a map, alphabetical.
   */
  files: string[]
  /**
   * Present when the folder contains a `_map.md` — parsed sections + unmapped files,
   * with map keys resolved to actual folder filenames (with extensions). Consumers
   * that don't care about the map can ignore this and just render `files`.
   */
  map?: FolderEntriesMap
}

export interface FolderEntriesMapEntry {
  /** Actual file basename in the folder (with extension), or the raw wikilink key if missing. */
  file: string
  description: string
  missing?: boolean
  duplicate?: boolean
}

export interface FolderEntriesMapSection {
  title: string
  entries: FolderEntriesMapEntry[]
}

export interface FolderEntriesMap {
  sections: FolderEntriesMapSection[]
  /** Unmapped file basenames (with extension), alphabetical. */
  unmapped: string[]
  /** Filename → description, for tooltip lookup. Excludes missing entries. */
  descriptions: Record<string, string>
}

const FOLDER_MAP_FILENAME = '_map.md'

function stripMdExtension(name: string): string {
  return name.replace(/\.md$/i, '')
}

/**
 * Resolve a parsed `_map.md` against the folder's actual files.
 * Map keys are wikilink form (no extension); folder files include extensions.
 * We match by extensionless basename, case-sensitive.
 */
function resolveFolderMapAgainstFiles(
  mapSource: string,
  fileNames: readonly string[],
): { orderedFiles: string[]; map: FolderEntriesMap } {
  const parsed = parseFolderMapBlock(mapSource)
  const keyToFile = new Map<string, string>()
  for (const name of fileNames) keyToFile.set(stripMdExtension(name), name)
  const keys = [...keyToFile.keys()]
  const display: FolderMapDisplay = applyFolderMapBlock(parsed, keys)

  const orderedFiles: string[] = []
  const seen = new Set<string>()
  const sections: FolderEntriesMapSection[] = display.sections.map(section => ({
    title: section.title,
    entries: section.entries.map(entry => {
      const file = keyToFile.get(entry.key)
      if (file && !entry.duplicate && !seen.has(file)) {
        orderedFiles.push(file)
        seen.add(file)
      }
      return {
        file: file ?? entry.key,
        description: entry.description,
        ...(entry.missing ? { missing: true as const } : {}),
        ...(entry.duplicate ? { duplicate: true as const } : {}),
      }
    }),
  }))

  const unmapped: string[] = []
  for (const key of display.unmapped) {
    const file = keyToFile.get(key)
    if (file && !seen.has(file)) {
      orderedFiles.push(file)
      unmapped.push(file)
      seen.add(file)
    }
  }

  const descriptions: Record<string, string> = {}
  for (const section of sections) {
    for (const entry of section.entries) {
      if (!entry.missing && entry.description) descriptions[entry.file] = entry.description
    }
  }

  return { orderedFiles, map: { sections, unmapped, descriptions } }
}

export type VaultPathKind = 'file' | 'folder' | 'missing'

const DRAWING_TEMPLATE = `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

# Excalidraw Data

## Text Elements

%%
## Drawing
\`\`\`json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://github.com/anthropics/thinking-space",
  "elements": [],
  "appState": {},
  "files": {}
}
\`\`\`
%%
`

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function joinVaultPath(basePath: string, relPath: string): string {
  const base = basePath.replace(/\/+$/g, '')
  const rel = relPath.replace(/^\/+/g, '')
  if (!base) return rel
  if (!rel) return base
  return `${base}/${rel}`
}

function splitParent(path: string): { parent: string; name: string } {
  const normalized = normalizeRelPath(path)
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return { parent: '', name: normalized }
  return {
    parent: normalized.slice(0, idx),
    name: normalized.slice(idx + 1),
  }
}

function joinRel(parent: string, child: string): string {
  const base = normalizeRelPath(parent)
  return base ? `${base}/${child}` : child
}

function isSameOrChildPath(path: string, maybeParent: string): boolean {
  if (!path || !maybeParent) return false
  return path === maybeParent || path.startsWith(`${maybeParent}/`)
}

function normalizeLinkPath(path: string): string {
  const sanitized = path.replace(/\\/g, '/').trim()
  if (!sanitized) return ''
  const parts = sanitized.split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

function dirnameLinkPath(path: string): string {
  const normalized = normalizeLinkPath(path)
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return ''
  return normalized.slice(0, idx)
}

function leafLinkPath(path: string): string {
  const normalized = normalizeLinkPath(path)
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return normalized
  return normalized.slice(idx + 1)
}

function joinLinkPath(parent: string, child: string): string {
  const base = normalizeLinkPath(parent)
  const relRaw = child.replace(/\\/g, '/').trim()
  if (!base) return normalizeLinkPath(relRaw)
  if (!relRaw) return base
  return normalizeLinkPath(`${base}/${relRaw}`)
}

function relativeLinkPath(fromDir: string, toPath: string): string {
  const fromParts = normalizeLinkPath(fromDir).split('/').filter(Boolean)
  const toParts = normalizeLinkPath(toPath).split('/').filter(Boolean)
  let i = 0
  while (
    i < fromParts.length
    && i < toParts.length
    && fromParts[i].toLowerCase() === toParts[i].toLowerCase()
  ) {
    i += 1
  }
  const up = new Array(Math.max(0, fromParts.length - i)).fill('..')
  const down = toParts.slice(i)
  return [...up, ...down].join('/')
}

function hasExplicitExtensionLinkPath(path: string): boolean {
  const leaf = leafLinkPath(path)
  const idx = leaf.lastIndexOf('.')
  return idx > 0
}

function hasUriScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

function remapMovedPath(path: string, sourcePath: string, targetPath: string): string {
  if (path === sourcePath) return targetPath
  if (!path.startsWith(`${sourcePath}/`)) return path
  const suffix = path.slice(sourcePath.length + 1)
  return suffix ? `${targetPath}/${suffix}` : targetPath
}

function reverseRemapMovedPath(path: string, sourcePath: string, targetPath: string): string {
  if (path === targetPath) return sourcePath
  if (!path.startsWith(`${targetPath}/`)) return path
  const suffix = path.slice(targetPath.length + 1)
  return suffix ? `${sourcePath}/${suffix}` : sourcePath
}

function formatWikilinkPathLikeOriginal(
  originalPath: string,
  currentPath: string,
  nextAbsolutePath: string,
): string {
  const raw = originalPath.replace(/\\/g, '/').trim()
  const hadLeadingSlash = raw.startsWith('/')
  const hadRelativePrefix = raw.startsWith('./') || raw.startsWith('../')
  const hadSlash = raw.includes('/')
  const hadExplicitExtension = hasExplicitExtensionLinkPath(raw)
  const currentDir = dirnameLinkPath(currentPath)

  let rewritten: string
  if (hadLeadingSlash || (hadSlash && !hadRelativePrefix)) {
    rewritten = normalizeLinkPath(nextAbsolutePath)
  } else if (hadRelativePrefix) {
    rewritten = relativeLinkPath(currentDir, nextAbsolutePath)
    if (!rewritten) rewritten = leafLinkPath(nextAbsolutePath)
    if (!rewritten.startsWith('../') && !rewritten.startsWith('./')) {
      rewritten = `./${rewritten}`
    }
  } else {
    rewritten = leafLinkPath(nextAbsolutePath)
  }

  if (!hadExplicitExtension && rewritten.toLowerCase().endsWith('.md')) {
    rewritten = rewritten.slice(0, -3)
  }
  if (hadLeadingSlash) rewritten = `/${rewritten}`
  return rewritten
}

function formatMarkdownLinkPathLikeOriginal(
  originalPath: string,
  currentPath: string,
  nextAbsolutePath: string,
): string {
  const raw = originalPath.replace(/\\/g, '/').trim()
  const hadLeadingSlash = raw.startsWith('/')
  const hadExplicitExtension = hasExplicitExtensionLinkPath(raw)
  const currentDir = dirnameLinkPath(currentPath)

  let rewritten: string
  if (hadLeadingSlash) {
    rewritten = `/${normalizeLinkPath(nextAbsolutePath)}`
  } else {
    rewritten = relativeLinkPath(currentDir, nextAbsolutePath)
    if (!rewritten) rewritten = leafLinkPath(nextAbsolutePath)
    if (raw.startsWith('./') && !rewritten.startsWith('../') && !rewritten.startsWith('./')) {
      rewritten = `./${rewritten}`
    }
  }

  if (!hadExplicitExtension && rewritten.toLowerCase().endsWith('.md')) {
    rewritten = rewritten.slice(0, -3)
  }
  return rewritten
}

// splitFrontmatterDocumentBlock, isLikelyYamlPathScalarBlock, findYamlCommentStartIndexBlock
// are now imported from @/services/lego_blocks/units/linkIndexBlock

function resolveYamlScalarAbsolutePathBlock(
  rawValue: string,
  currentPath: string,
  sourcePath: string,
  candidatePathsBeforeMove: string[],
): string | null {
  const value = rawValue.trim()
  if (!isLikelyYamlPathScalarBlock(value)) return null
  if (value.startsWith('#') || hasUriScheme(value)) return null

  const normalizedCurrentPath = normalizeLinkPath(currentPath)
  const normalizedSourcePath = normalizeLinkPath(sourcePath)
  const currentDir = dirnameLinkPath(normalizedCurrentPath)
  const candidates: string[] = []
  const pushCandidate = (candidate: string) => {
    const normalized = normalizeLinkPath(candidate)
    if (!normalized) return
    if (!candidates.includes(normalized)) candidates.push(normalized)
  }

  const resolved = resolveWikilinkPathBlock({
    currentPath: normalizedCurrentPath,
    target: value,
    candidatePaths: candidatePathsBeforeMove,
  }).path
  if (resolved) pushCandidate(resolved)

  if (value.startsWith('/')) {
    pushCandidate(value.slice(1))
  } else if (value.startsWith('./') || value.startsWith('../')) {
    pushCandidate(joinLinkPath(currentDir, value))
  } else if (value.includes('/')) {
    pushCandidate(value)
    pushCandidate(joinLinkPath(currentDir, value))
  } else {
    pushCandidate(joinLinkPath(currentDir, value))
    pushCandidate(value)
  }

  for (const candidate of candidates) {
    if (isSameOrChildPath(candidate, normalizedSourcePath)) return candidate
  }
  return null
}

function rewriteYamlScalarValueBlock(
  scalar: string,
  currentPath: string,
  sourcePath: string,
  targetPath: string,
  candidatePathsBeforeMove: string[],
): string {
  const trimmed = scalar.trim()
  if (!trimmed) return scalar

  const quote = (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ? '"'
    : (trimmed.startsWith('\'') && trimmed.endsWith('\''))
      ? '\''
      : ''
  const unquoted = quote ? trimmed.slice(1, -1) : trimmed
  const absolutePath = resolveYamlScalarAbsolutePathBlock(unquoted, currentPath, sourcePath, candidatePathsBeforeMove)
  if (!absolutePath) return scalar

  const movedAbsolutePath = remapMovedPath(
    absolutePath,
    normalizeLinkPath(sourcePath),
    normalizeLinkPath(targetPath),
  )
  const rewrittenPath = formatWikilinkPathLikeOriginal(unquoted, currentPath, movedAbsolutePath)
  if (!rewrittenPath || rewrittenPath === unquoted) return scalar

  const rewrittenUnquoted = quote === '\''
    ? rewrittenPath.replace(/'/g, '\'\'')
    : quote === '"'
      ? rewrittenPath.replace(/"/g, '\\"')
      : rewrittenPath
  return quote ? `${quote}${rewrittenUnquoted}${quote}` : rewrittenUnquoted
}

function rewriteYamlFrontmatterPathScalarsBlock(
  frontmatterBlock: string,
  currentPath: string,
  sourcePath: string,
  targetPath: string,
  candidatePathsBeforeMove: string[],
): string {
  if (!frontmatterBlock) return frontmatterBlock
  const lineBreak = frontmatterBlock.includes('\r\n') ? '\r\n' : '\n'
  const lines = frontmatterBlock.split(/\r?\n/)
  if (lines.length < 3 || lines[0] !== '---') return frontmatterBlock

  const closeIndex = lines.findIndex((line, index) => index > 0 && line === '---')
  if (closeIndex < 0) return frontmatterBlock

  const rewrittenLines = [...lines]
  for (let i = 1; i < closeIndex; i += 1) {
    const line = lines[i]
    if (!line || /^\s*#/.test(line)) continue

    const mappingMatch = /^(\s*[^:#\n][^:\n]*:\s*)(.+)$/.exec(line)
    const listMatch = mappingMatch ? null : /^(\s*-\s+)(.+)$/.exec(line)
    const prefix = mappingMatch?.[1] ?? listMatch?.[1]
    const valuePart = mappingMatch?.[2] ?? listMatch?.[2]
    if (!prefix || !valuePart) continue
    if (valuePart.trimStart().startsWith('|') || valuePart.trimStart().startsWith('>')) continue
    if (/^[^"'#\s][^:]*:\s+/.test(valuePart.trimStart())) continue

    const leadingValueWhitespace = (valuePart.match(/^\s*/) ?? [''])[0]
    const trimmedValue = valuePart.trimStart()
    const commentStart = findYamlCommentStartIndexBlock(trimmedValue)
    const scalarSegment = (commentStart >= 0 ? trimmedValue.slice(0, commentStart) : trimmedValue).trimEnd()
    const commentSegment = commentStart >= 0 ? trimmedValue.slice(commentStart) : ''
    if (!scalarSegment) continue

    const rewrittenScalar = rewriteYamlScalarValueBlock(
      scalarSegment,
      currentPath,
      sourcePath,
      targetPath,
      candidatePathsBeforeMove,
    )
    if (rewrittenScalar === scalarSegment) continue

    rewrittenLines[i] = `${prefix}${leadingValueWhitespace}${rewrittenScalar}${commentSegment ? ` ${commentSegment}` : ''}`
  }

  const rebuilt = rewrittenLines.join(lineBreak)
  if (frontmatterBlock.endsWith('\n') || frontmatterBlock.endsWith('\r\n')) {
    return rebuilt.endsWith(lineBreak) ? rebuilt : `${rebuilt}${lineBreak}`
  }
  return rebuilt
}

function rewriteMovedPathReferencesInMarkdown(
  content: string,
  currentPath: string,
  sourcePath: string,
  targetPath: string,
  candidatePathsBeforeMove: string[],
): string {
  const normalizedCurrentPath = normalizeLinkPath(currentPath)
  const normalizedSourcePath = normalizeLinkPath(sourcePath)
  const normalizedTargetPath = normalizeLinkPath(targetPath)

  const wikilinkTokens = splitTextByWikilinksBlock(content)
  const rewrittenWikilinks = wikilinkTokens.map((token) => {
    if (token.kind !== 'wikilink' || !token.target) return token.text
    const parsedTarget = parseWikilinkTargetBlock(token.target)
    if (!parsedTarget.path) return token.text

    const resolved = resolveWikilinkPathBlock({
      currentPath: normalizedCurrentPath,
      target: token.target,
      candidatePaths: candidatePathsBeforeMove,
    })
    if (!resolved.path || !isSameOrChildPath(resolved.path, normalizedSourcePath)) return token.text

    const movedResolvedPath = remapMovedPath(resolved.path, normalizedSourcePath, normalizedTargetPath)
    const rewrittenPath = formatWikilinkPathLikeOriginal(parsedTarget.path, normalizedCurrentPath, movedResolvedPath)
    const suffix = parsedTarget.blockRef
      ? `#^${parsedTarget.blockRef}`
      : parsedTarget.heading
        ? `#${parsedTarget.heading}`
        : ''
    const aliasPart = token.alias?.trim() ? `|${token.alias.trim()}` : ''
    const embedPrefix = token.embed ? '!' : ''
    return `${embedPrefix}[[${rewrittenPath}${suffix}${aliasPart}]]`
  }).join('')

  const rewrittenLinks = rewrittenWikilinks.replace(
    /(!?)\[([^\]]*?)\]\(([^)\n]+)\)/g,
    (full: string, bang: string, label: string, destination: string) => {
      const rawDestination = destination.trim()
      if (!rawDestination) return full

      const wrapped = rawDestination.startsWith('<') && rawDestination.endsWith('>')
      const unwrappedDestination = wrapped ? rawDestination.slice(1, -1).trim() : rawDestination
      const destinationMatch = /^(\S+)([\s\S]*)$/.exec(unwrappedDestination)
      if (!destinationMatch) return full

      const linkPathWithSuffix = destinationMatch[1] ?? ''
      const trailing = destinationMatch[2] ?? ''
      if (!linkPathWithSuffix || linkPathWithSuffix.startsWith('#') || hasUriScheme(linkPathWithSuffix)) {
        return full
      }

      const hashIdx = linkPathWithSuffix.indexOf('#')
      const pathPart = (hashIdx >= 0 ? linkPathWithSuffix.slice(0, hashIdx) : linkPathWithSuffix).trim()
      const hashSuffix = hashIdx >= 0 ? linkPathWithSuffix.slice(hashIdx) : ''
      if (!pathPart) return full

      const absoluteLinkPath = pathPart.startsWith('/')
        ? normalizeLinkPath(pathPart.slice(1))
        : normalizeLinkPath(joinLinkPath(dirnameLinkPath(normalizedCurrentPath), pathPart))
      if (!absoluteLinkPath || !isSameOrChildPath(absoluteLinkPath, normalizedSourcePath)) return full

      const movedAbsolutePath = remapMovedPath(absoluteLinkPath, normalizedSourcePath, normalizedTargetPath)
      const rewrittenPath = formatMarkdownLinkPathLikeOriginal(pathPart, normalizedCurrentPath, movedAbsolutePath)
      const rewrittenDestinationCore = `${rewrittenPath}${hashSuffix}${trailing}`
      const rewrittenDestination = wrapped ? `<${rewrittenDestinationCore}>` : rewrittenDestinationCore
      return `${bang}[${label}](${rewrittenDestination})`
    },
  )

  const { frontmatter, body } = splitFrontmatterDocumentBlock(rewrittenLinks)
  if (!frontmatter) return rewrittenLinks
  const rewrittenFrontmatter = rewriteYamlFrontmatterPathScalarsBlock(
    frontmatter,
    normalizedCurrentPath,
    normalizedSourcePath,
    normalizedTargetPath,
    candidatePathsBeforeMove,
  )
  if (rewrittenFrontmatter === frontmatter) return rewrittenLinks
  return `${rewrittenFrontmatter}${body}`
}

export async function rewriteMovedPathReferencesOrch(
  sourcePath: string,
  targetPath: string,
): Promise<{ updatedFiles: number }> {
  const normalizedSourcePath = normalizeLinkPath(sourcePath)
  const normalizedTargetPath = normalizeLinkPath(targetPath)
  if (!normalizedSourcePath || !normalizedTargetPath || normalizedSourcePath === normalizedTargetPath) {
    return { updatedFiles: 0 }
  }

  // Query the link index to find only files that reference the moved path
  const backlinks = await getBacklinksForPathPrefix(normalizedSourcePath)
  const affectedFiles = [...new Set(backlinks.map(l => l.sourceFilePath))]

  if (affectedFiles.length === 0) {
    // Still update the link index paths even if no content rewriting needed
    await updateLinkTargets(normalizedSourcePath, normalizedTargetPath)
    await updateLinkSourcePaths(normalizedSourcePath, normalizedTargetPath)
    return { updatedFiles: 0 }
  }

  // Build candidate paths for link resolution (need pre-move paths)
  const allPaths = await getAllFilePaths()
  const markdownPathsAfterMove = [...allPaths]
  const candidatePathsBeforeMove = [...new Set(markdownPathsAfterMove.map(
    (path) => reverseRemapMovedPath(path, normalizedSourcePath, normalizedTargetPath),
  ))]

  const fs = getVaultFS()
  let updatedFiles = 0
  for (const filePath of affectedFiles) {
    let content: string
    try {
      content = await fs.read(filePath)
    } catch {
      continue
    }

    const rewritten = rewriteMovedPathReferencesInMarkdown(
      content,
      filePath,
      normalizedSourcePath,
      normalizedTargetPath,
      candidatePathsBeforeMove,
    )
    if (rewritten === content) continue

    await fs.write(filePath, rewritten)
    updatedFiles += 1
  }

  // Update the link index to reflect the path changes
  await updateLinkTargets(normalizedSourcePath, normalizedTargetPath)
  await updateLinkSourcePaths(normalizedSourcePath, normalizedTargetPath)

  // Re-index affected files to refresh their link records with new content
  for (const filePath of affectedFiles) {
    await syncSingleFile(filePath).catch(() => {})
  }

  return { updatedFiles }
}

function splitExtension(name: string): { stem: string; ext: string } {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, idx), ext: name.slice(idx) }
}

function appendNumberSuffix(name: string, n: number): string {
  if (n <= 1) return name
  const { stem, ext } = splitExtension(name)
  return `${stem} (${n})${ext}`
}

function getElectronVaultRoot(): string {
  const root = getStoredVaultRoot()?.trim()
  if (!root) throw new Error('Vault root is not configured')
  return root
}

function normalizeNewName(name: string): string {
  const next = name.trim()
  if (!next) throw new Error('Name cannot be empty')
  if (next === '.' || next === '..') throw new Error('Invalid name')
  if (next.includes('/') || next.includes('\\')) throw new Error('Name cannot include path separators')
  return next
}

function isAbsoluteRoot(root: string): boolean {
  return root.startsWith('/') || /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\')
}

function decodeFileUriPath(raw: string): string | null {
  if (!raw.toLowerCase().startsWith('file://')) return null
  const noScheme = raw.replace(/^file:\/\//i, '')
  if (!noScheme) return null
  const decoded = decodeURIComponent(noScheme)
  // file:///Users/... -> /Users/...
  if (decoded.startsWith('/')) return decoded
  // file://C:/... -> C:/...
  if (/^[A-Za-z]:\//.test(decoded)) return decoded
  return decoded
}

function resolveAbsoluteVaultRoot(rawRoot: string | null): string | null {
  const raw = (rawRoot ?? '').trim()
  if (!raw) return null
  if (raw === 'browser-fs') return null
  if (raw.startsWith('cap-picker:')) {
    const candidate = raw.slice('cap-picker:'.length).trim()
    return isAbsoluteRoot(candidate) ? candidate : null
  }
  const fromFileUri = decodeFileUriPath(raw)
  if (fromFileUri && isAbsoluteRoot(fromFileUri)) return fromFileUri
  if (isAbsoluteRoot(raw)) return raw
  return null
}

async function postVaultApi<T = unknown>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = typeof body?.detail === 'string' ? body.detail : ''
    } catch {
      detail = ''
    }
    throw new Error(detail || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

async function nextAvailableSiblingName(parentPath: string, preferredName: string): Promise<string> {
  const fs = getVaultFS()
  let folders: string[] = []
  let files: string[] = []
  try {
    const listed = await fs.list(parentPath)
    folders = listed.folders
    files = listed.files
  } catch {
    // If parent listing fails, fallback to preferred name and let filesystem call surface any errors.
    return preferredName
  }

  const taken = new Set([...folders, ...files].map(name => name.toLowerCase()))
  let n = 1
  while (true) {
    const candidate = appendNumberSuffix(preferredName, n)
    if (!taken.has(candidate.toLowerCase())) return candidate
    n += 1
  }
}

export async function getFileContent(path: string): Promise<{ content: string; size_bytes: number }> {
  const fs = getVaultFS()
  const content = await fs.read(path)
  return { content, size_bytes: new Blob([content]).size }
}

export async function getFileStats(paths: string[]): Promise<FileStat[]> {
  const fs = getVaultFS()
  const results: FileStat[] = []
  for (const p of paths) {
    try {
      const content = await fs.read(p)
      results.push({
        path: p,
        lines: content.split('\n').length,
        words: content.split(/\s+/).filter(Boolean).length,
        size_bytes: new Blob([content]).size,
      })
    } catch {
      // Skip files that can't be read
    }
  }
  return results
}

export async function listFiles(limit?: number): Promise<string[]> {
  const fs = getVaultFS()
  const files = (await fs.walkVault(['.md']))
    .map(e => e.path)
    .filter(p => !p.includes('.excalidraw'))
    .sort()

  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
    return files.slice(0, limit)
  }

  return files
}

export async function listFolders(limit = 1000): Promise<string[]> {
  // Walk vault and collect unique directory paths
  const fs = getVaultFS()
  const entries = await fs.walkVault(['.md'])
  const folderSet = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    // Add all parent directories
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join('/'))
    }
  }
  return [...folderSet].sort().slice(0, limit)
}

export async function listPdfFiles(limit = 500): Promise<string[]> {
  const fs = getVaultFS()
  const entries = await fs.walkVault(['.pdf'])
  return entries
    .map(e => e.path)
    .sort()
    .slice(0, limit)
}

export async function listChildFolders(path: string): Promise<string[]> {
  const fs = getVaultFS()
  try {
    const { folders } = await fs.list(path)
    return folders.sort()
  } catch {
    return []
  }
}

export async function listFolderEntries(path: string): Promise<FolderEntries> {
  const fs = getVaultFS()
  try {
    const { folders, files } = await fs.list(path)
    const visibleFolders = folders.filter(name => !name.startsWith('.')).sort()
    const visibleFiles = files.filter(name => !name.startsWith('.')).sort()

    // No map → alphabetical, exactly like before. (Rule 2: degrade gracefully.)
    if (!visibleFiles.includes(FOLDER_MAP_FILENAME)) {
      return { folders: visibleFolders, files: visibleFiles }
    }

    let mapSource = ''
    try {
      mapSource = await fs.read(path ? `${path}/${FOLDER_MAP_FILENAME}` : FOLDER_MAP_FILENAME)
    } catch {
      // Read failure → treat as no-map, don't reorder. Preserves rule 1 (folder is truth):
      // every file still appears, alphabetical.
      return { folders: visibleFolders, files: visibleFiles }
    }

    const { orderedFiles, map } = resolveFolderMapAgainstFiles(mapSource, visibleFiles)
    return { folders: visibleFolders, files: orderedFiles, map }
  } catch {
    return { folders: [], files: [] }
  }
}

/** Frontmatter facts surfaced in the explorer's hover tooltip. */
export interface FileTooltipMetaBlock {
  /** Frontmatter `summary:` — what the page is about. */
  summary?: string
  /** Frontmatter `created_at:` (ISO string as written). */
  createdAt?: string
  /** Frontmatter `updated_at:` (ISO string as written). */
  updatedAt?: string
}

/**
 * Read a file's frontmatter facts for the explorer hover tooltip: `summary:` plus
 * `created_at:` / `updated_at:` for recency context.
 *
 * Per the map-files spec (revised 2026-07-10), the tooltip shows what a page is
 * *about* — a property of the page itself — not the `_map.md` line, which says why
 * the page sits at its position. Reading from frontmatter also gives tooltips to
 * unmapped files and files in folders without any `_map.md`.
 *
 * Returns null when the file isn't markdown, can't be read, or carries none of these
 * fields — callers show no tooltip then. Intentionally lazy: read one file on hover
 * rather than every file on folder expand.
 */
// Read a top-level scalar (e.g. `summary`) from raw frontmatter text. Handles
// quoted and unquoted values; skips YAML block scalars (`|`/`>`).
function readFrontmatterScalarBlock(frontmatter: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(frontmatter)
  if (!m) return undefined
  const raw = m[1].trim()
  if (/^[|>][-+]?$/.test(raw)) return undefined
  const unquoted = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim()
  return unquoted || undefined
}

export async function readFileTooltipMeta(path: string): Promise<FileTooltipMetaBlock | null> {
  if (!/\.md$/i.test(path)) return null
  const fs = getVaultFS()
  try {
    const content = await fs.read(path)
    const { frontmatter } = splitFrontmatterDocumentBlock(content)
    const summary = frontmatter ? readFrontmatterScalarBlock(frontmatter, 'summary') : undefined

    // Prefer frontmatter created_at/updated_at; fall back to filesystem
    // ctime (birthtime on desktop) / mtime so every file gets dates, even
    // loose markdown authored outside the app.
    let ctimeSeconds: number | null = null
    let mtimeSeconds: number | null = null
    try {
      const stat = await fs.stat(path)
      ctimeSeconds = stat.ctime ?? null
      mtimeSeconds = stat.mtime ?? null
    } catch {
      // stat is best-effort; frontmatter dates alone are still useful.
    }

    const { created, updated } = resolveFrontmatterDatesBlock(content, { ctimeSeconds, mtimeSeconds })
    const meta: FileTooltipMetaBlock = {
      summary,
      createdAt: created ? created.toISOString() : undefined,
      updatedAt: updated ? updated.toISOString() : undefined,
    }
    return meta.summary || meta.createdAt || meta.updatedAt ? meta : null
  } catch {
    return null
  }
}

export async function listMarkdownEntries(): Promise<VaultEntry[]> {
  const fs = getVaultFS()
  return fs.walkVault(['.md'])
}

/**
 * Path-only variant of {@link listMarkdownEntries} served from the Dexie cache.
 * Falls back to a vault walk on cold start (before sync has populated IDB).
 * Prefer this in callers that only need paths — it skips the iCloud FS walk
 * on iPhone/iPad once the first sync has completed.
 */
export async function listMarkdownPaths(): Promise<string[]> {
  const cached = await getAllFilePaths()
  if (cached.size > 0) return [...cached]
  const fs = getVaultFS()
  const entries = await fs.walkVault(['.md'])
  return entries.map(e => e.path)
}

export async function listVaultEntries(extensions: string[]): Promise<VaultEntry[]> {
  const fs = getVaultFS()
  return fs.walkVault(extensions)
}

export async function getVaultPathKind(path: string): Promise<VaultPathKind> {
  const normalized = normalizeRelPath(path)
  if (!normalized) return 'folder'

  const fs = getVaultFS()
  const { parent, name } = splitParent(normalized)
  try {
    const listed = await fs.list(parent)
    if (listed.folders.includes(name)) return 'folder'
    if (listed.files.includes(name)) return 'file'
    return 'missing'
  } catch {
    return 'missing'
  }
}

export async function listFolderDescendantPaths(folderPath: string): Promise<string[]> {
  const fs = getVaultFS()
  const root = normalizeRelPath(folderPath)
  if (!root) return []

  const output: string[] = []
  const queue: string[] = [root]
  const seen = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    output.push(current)

    let listed: { folders: string[]; files: string[] }
    try {
      listed = await fs.list(current)
    } catch {
      // If listing fails this path is likely not a folder; keep it as-is.
      continue
    }

    for (const folderName of listed.folders) {
      queue.push(joinRel(current, folderName))
    }
    for (const fileName of listed.files) {
      output.push(joinRel(current, fileName))
    }
  }

  return output
}

export function getRelativePathForClipboardOrch(path: string): string {
  return normalizeRelPath(path)
}

export function getAbsolutePathForClipboardOrch(path: string): string | null {
  const root = resolveAbsoluteVaultRoot(getStoredVaultRoot())
  if (!root) return null
  const normalizedRoot = root.replace(/[\\/]+$/g, '')
  const normalizedRel = normalizeRelPath(path)
  if (!normalizedRel) return normalizedRoot
  const separator = normalizedRoot.includes('\\') && !normalizedRoot.includes('/') ? '\\' : '/'
  const relWithSeparator = normalizedRel.replace(/[\\/]+/g, separator)
  return `${normalizedRoot}${separator}${relWithSeparator}`
}

export async function createFolderOrch(parentPath: string, preferredName = 'New Folder'): Promise<string> {
  const fs = getVaultFS()
  const cleanParent = normalizeRelPath(parentPath)
  const cleanPreferred = normalizeNewName(preferredName)
  const name = await nextAvailableSiblingName(cleanParent, cleanPreferred)
  const outputPath = joinRel(cleanParent, name)
  await fs.mkdir(outputPath)
  return outputPath
}

export async function createFileOrch(
  parentPath: string,
  preferredName = 'New File.md',
  content = '',
): Promise<string> {
  const fs = getVaultFS()
  const cleanParent = normalizeRelPath(parentPath)
  const cleanPreferred = normalizeNewName(preferredName)
  const name = await nextAvailableSiblingName(cleanParent, cleanPreferred)
  const outputPath = joinRel(cleanParent, name)
  await fs.create(outputPath, content)
  return outputPath
}

export async function createDrawingOrch(
  parentPath: string,
  preferredName = 'New Drawing.excalidraw.md',
): Promise<string> {
  return createFileOrch(parentPath, preferredName, DRAWING_TEMPLATE)
}

export async function renameVaultPathOrch(path: string, nextName: string): Promise<string> {
  const currentPath = normalizeRelPath(path)
  if (!currentPath) throw new Error('Cannot rename vault root')
  const { parent } = splitParent(currentPath)
  const targetPath = joinRel(parent, normalizeNewName(nextName))
  if (targetPath === currentPath) return currentPath

  const fs = getVaultFS()
  if (await fs.exists(targetPath)) {
    throw new Error(`A file or folder already exists at "${targetPath}"`)
  }

  if (isElectron()) {
    const api = window.electronAPI
    if (!api?.rename) throw new Error('Rename is unavailable in this desktop build')
    await api.rename(getElectronVaultRoot(), currentPath, targetPath)
    // Link rewriting is best-effort and expensive — run in background, don't block rename
    rewriteMovedPathReferencesOrch(currentPath, targetPath)
      .catch(err => console.error('[rename] link rewrite failed (non-fatal):', err))
    return targetPath
  }

  await postVaultApi('/api/tools/vault/rename', { from_path: currentPath, to_path: targetPath })
  // Link rewriting is best-effort and expensive — run in background, don't block rename
  rewriteMovedPathReferencesOrch(currentPath, targetPath)
    .catch(err => console.error('[rename] link rewrite failed (non-fatal):', err))
  return targetPath
}

export async function moveVaultPathOrch(sourcePath: string, targetFolderPath: string): Promise<string> {
  const currentPath = normalizeRelPath(sourcePath)
  const targetFolder = normalizeRelPath(targetFolderPath)
  if (!currentPath) throw new Error('Cannot move vault root')

  const sourceKind = await getVaultPathKind(currentPath)
  if (sourceKind === 'missing') throw new Error(`Path does not exist: "${currentPath}"`)
  if (sourceKind === 'folder' && isSameOrChildPath(targetFolder, currentPath)) {
    throw new Error('Cannot move a folder into itself or its subfolder')
  }
  if (targetFolder && await getVaultPathKind(targetFolder) !== 'folder') {
    throw new Error(`Target folder does not exist: "${targetFolder}"`)
  }

  const { name } = splitParent(currentPath)
  if (!name) throw new Error('Invalid source path')
  const targetPath = joinRel(targetFolder, name)
  if (targetPath === currentPath) return currentPath

  const fs = getVaultFS()
  if (await fs.exists(targetPath)) {
    throw new Error(`A file or folder already exists at "${targetPath}"`)
  }

  if (isElectron()) {
    const api = window.electronAPI
    if (!api?.rename) throw new Error('Move is unavailable in this desktop build')
    await api.rename(getElectronVaultRoot(), currentPath, targetPath)
    await rewriteMovedPathReferencesOrch(currentPath, targetPath)
    return targetPath
  }

  await postVaultApi('/api/tools/vault/rename', { from_path: currentPath, to_path: targetPath })
  await rewriteMovedPathReferencesOrch(currentPath, targetPath)
  return targetPath
}

export async function deleteVaultPathOrch(path: string): Promise<void> {
  const targetPath = normalizeRelPath(path)
  if (!targetPath) throw new Error('Cannot delete vault root')

  if (isElectron()) {
    const api = window.electronAPI
    if (!api?.deletePath) throw new Error('Delete is unavailable in this desktop build')
    await api.deletePath(getElectronVaultRoot(), targetPath, true)
    return
  }

  await postVaultApi('/api/tools/vault/delete', { path: targetPath, recursive: true })
}

export async function copyVaultPathOrch(sourcePath: string, targetPath: string): Promise<void> {
  const fromPath = normalizeRelPath(sourcePath)
  const toPath = normalizeRelPath(targetPath)
  if (!fromPath || !toPath) throw new Error('Invalid copy path')

  if (isElectron()) {
    const api = window.electronAPI
    if (!api?.copyPath) throw new Error('Copy is unavailable in this desktop build')
    await api.copyPath(getElectronVaultRoot(), fromPath, toPath)
    return
  }

  await postVaultApi('/api/tools/vault/copy', { from_path: fromPath, to_path: toPath })
}

export async function duplicateFileOrch(filePath: string): Promise<string> {
  const source = normalizeRelPath(filePath)
  const { parent, name } = splitParent(source)
  if (!name) throw new Error('Invalid file path')
  const { stem, ext } = splitExtension(name)
  const copyBase = `${stem} copy${ext}`
  const nextName = await nextAvailableSiblingName(parent, copyBase)
  const targetPath = joinRel(parent, nextName)
  await copyVaultPathOrch(source, targetPath)
  return targetPath
}

export async function revealVaultPathOrch(path: string): Promise<void> {
  if (!isElectron()) throw new Error('Open in Finder is available only on desktop Electron')
  const api = window.electronAPI
  if (!api?.revealPath) throw new Error('Open in Finder is unavailable in this desktop build')
  await api.revealPath(getElectronVaultRoot(), normalizeRelPath(path))
}

export function getOpenInSystemLabelOrch(): 'Finder' | 'Files' | null {
  if (isElectron()) return 'Finder'
  if (isCapacitorNative()) return 'Files'
  return null
}

async function openVaultPathInFilesOrch(path: string): Promise<void> {
  const normalizedPath = normalizeRelPath(path)
  if (!normalizedPath) throw new Error('Invalid path')

  const { vaultRoot } = normalizeCapacitorStoredVaultRoot(getStoredVaultRoot())
  const targetPath = joinVaultPath(vaultRoot, normalizedPath)
  const isAbsolute = vaultRoot.startsWith('/')
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Capacitor } = await import('@capacitor/core')
  // Capacitor absolute mode uses file:// URIs without a directory value.
  // The runtime supports this, but GetUriOptions typing currently requires directory.
  const absoluteGetUriOptions = { path: `file://${targetPath}` } as unknown as Parameters<typeof Filesystem.getUri>[0]
  const uriResult = isAbsolute
    ? await Filesystem.getUri(absoluteGetUriOptions)
    : await Filesystem.getUri({ path: targetPath, directory: Directory.Documents })

  const launchUri = uriResult.uri.startsWith('file://')
    ? Capacitor.convertFileSrc(uriResult.uri)
    : uriResult.uri

  const opened = window.open(launchUri, '_blank')
  if (opened) return
  window.location.assign(launchUri)
}

export async function openVaultPathInSystemOrch(path: string): Promise<'finder' | 'files'> {
  if (isElectron()) {
    await revealVaultPathOrch(path)
    return 'finder'
  }
  if (isCapacitorNative()) {
    await openVaultPathInFilesOrch(path)
    return 'files'
  }
  throw new Error('Open in system file manager is available only on Electron and Capacitor')
}

export async function openVaultPathWithDefaultAppOrch(path: string): Promise<'app' | 'files'> {
  const normalizedPath = normalizeRelPath(path)
  if (!normalizedPath) throw new Error('Invalid path')

  if (isElectron()) {
    const api = window.electronAPI
    if (!api?.openPath) throw new Error('Open with default app is unavailable in this desktop build')
    await api.openPath(getElectronVaultRoot(), normalizedPath)
    return 'app'
  }
  if (isCapacitorNative()) {
    await openVaultPathInFilesOrch(normalizedPath)
    return 'files'
  }
  throw new Error('Open with default app is available only on Electron and Capacitor')
}

export async function openExternalUrlOrch(url: string): Promise<void> {
  const normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Only http/https URLs are supported.')
  }

  if (isElectron()) {
    const api = window.electronAPI
    if (api?.openExternal) {
      await api.openExternal(normalized)
      return
    }
  }

  window.open(normalized, '_blank', 'noopener,noreferrer')
}

export function buildThinkingSpaceFileUrlOrch(path: string): string {
  const normalizedPath = normalizeRelPath(path)
  const encodedPath = encodeURIComponent(normalizedPath)
  const route = `/thinking-space?file=${encodedPath}`
  if (window.location.hash.startsWith('#/')) {
    const base = window.location.href.split('#')[0]
    return `${base}#${route}`
  }
  const basePath = '/thinking-space'
  return `${window.location.origin}${basePath}?file=${encodedPath}`
}

export function openFileInNewTabOrch(path: string): void {
  const normalizedPath = normalizeRelPath(path)
  const route = `/thinking-space?file=${encodeURIComponent(normalizedPath)}`
  window.dispatchEvent(new CustomEvent<string>('ltm:workspace-open-route-in-new-tab', { detail: route }))
}

export function openFileInNewWindowOrch(path: string): void {
  const normalizedPath = normalizeRelPath(path)
  const route = `/thinking-space?file=${encodeURIComponent(normalizedPath)}`

  if (isElectron()) {
    const api = window.electronAPI
    if (!api?.newWindow) throw new Error('Open in New Window is unavailable in this desktop build')
    void api.newWindow(route)
    return
  }

  const url = buildThinkingSpaceFileUrlOrch(path)
  window.open(url, '_blank', 'noopener,noreferrer,popup=yes,width=1280,height=900')
}
