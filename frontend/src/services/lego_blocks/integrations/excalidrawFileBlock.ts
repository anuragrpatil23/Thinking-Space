import { decompressFromBase64LzString } from '@/services/lego_blocks/units/lzStringBlock'
import { normalizeExcalidrawSceneForInteropBlock } from '@/services/lego_blocks/integrations/excalidrawSceneCompatBlock'
import { buildTextElementsSectionBlock } from '@/services/lego_blocks/units/excalidrawWikilinkBlock'
import { restore, serializeAsJSON } from '@excalidraw/excalidraw'
import { generateKeyBetween } from 'fractional-indexing'

export interface ParsedExcalidrawScene {
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

const MAX_SERIALIZE_DEPTH = 80

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasValidZoomShape(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (isFiniteNumber(value)) return true
  if (!isRecord(value)) return false
  return isFiniteNumber(value.value)
}

function hasValidFractionalIndex(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    generateKeyBetween(value, null)
    return true
  } catch {
    return false
  }
}

function hasCanonicalElementShape(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.type !== 'string') return false
  if (typeof value.id !== 'string') return false
  if (!isFiniteNumber(value.x)) return false
  if (!isFiniteNumber(value.y)) return false
  if (!isFiniteNumber(value.width)) return false
  if (!isFiniteNumber(value.height)) return false
  if (!isFiniteNumber(value.version)) return false
  if (!isFiniteNumber(value.versionNonce)) return false
  // Reject scenes with invalid fractional indices (e.g. old z-prefixed keys)
  if (value.index !== undefined && value.index !== null && !hasValidFractionalIndex(value.index)) return false
  return true
}

function isLikelyCanonicalScene(scene: ParsedExcalidrawScene): boolean {
  const appState = scene.appState
  const files = scene.files
  if (appState !== undefined && !isRecord(appState)) return false
  if (files !== undefined && !isRecord(files)) return false
  if (!hasValidZoomShape(appState?.zoom)) return false

  const elements = scene.elements
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]
    if (!isRecord(element)) continue
    const candidateIndex = element.index
    if (candidateIndex !== undefined && candidateIndex !== null && !hasValidFractionalIndex(candidateIndex)) {
      return false
    }
  }

  const sampleSize = Math.min(elements.length, 12)
  for (let index = 0; index < sampleSize; index += 1) {
    if (!hasCanonicalElementShape(elements[index])) return false
  }
  return true
}

function sanitizeMapKey(value: unknown, stack: object[], depth: number): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()

  const sanitized = sanitizeJsonValue(value, stack, depth + 1)
  if (sanitized === undefined) return null
  if (typeof sanitized === 'string') return sanitized
  if (typeof sanitized === 'number' || typeof sanitized === 'boolean' || sanitized === null) {
    return String(sanitized)
  }
  try {
    return JSON.stringify(sanitized)
  } catch {
    return null
  }
}

function sanitizeJsonValue(value: unknown, stack: object[], depth: number): JsonValue | undefined {
  if (depth > MAX_SERIALIZE_DEPTH) return undefined
  if (value === null) return null

  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') {
    const asNumber = Number(value)
    return Number.isFinite(asNumber) ? asNumber : null
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (!(value instanceof Object)) return undefined
  if (value instanceof Date) return value.toISOString()
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return undefined
  if (stack.includes(value)) return undefined

  stack.push(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const sanitized = sanitizeJsonValue(item, stack, depth + 1)
        return sanitized === undefined ? null : sanitized
      })
    }

    if (value instanceof Set) {
      return Array.from(value.values()).map((item) => {
        const sanitized = sanitizeJsonValue(item, stack, depth + 1)
        return sanitized === undefined ? null : sanitized
      })
    }

    if (value instanceof Map) {
      const output: Record<string, JsonValue> = {}
      for (const [key, entryValue] of value.entries()) {
        const safeKey = sanitizeMapKey(key, stack, depth + 1)
        if (!safeKey) continue
        const safeValue = sanitizeJsonValue(entryValue, stack, depth + 1)
        if (safeValue === undefined) continue
        output[safeKey] = safeValue
      }
      return output
    }

    const output: Record<string, JsonValue> = {}
    for (const key of Object.keys(value)) {
      let raw: unknown
      try {
        raw = (value as Record<string, unknown>)[key]
      } catch {
        continue
      }
      const sanitized = sanitizeJsonValue(raw, stack, depth + 1)
      if (sanitized === undefined) continue
      output[key] = sanitized
    }
    return output
  } finally {
    stack.pop()
  }
}

function sanitizeSceneObject(value: unknown): Record<string, JsonValue> {
  const sanitized = sanitizeJsonValue(value, [], 0)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return {}
  return sanitized as Record<string, JsonValue>
}

function sceneToJson(scene: ParsedExcalidrawScene): string {
  const safeAppState = sanitizeSceneObject(scene.appState ?? {})
  const safeFiles = sanitizeSceneObject(scene.files ?? {})

  // `theme` is a VIEW concern, not document data: the canvas follows the app's
  // color mode via Excalidraw's controlled `theme` prop (ExcalidrawDocumentBlock).
  // If we let the forced view theme serialize back, every edit made in dark mode
  // would rewrite the file's stored theme and churn it across synced devices in
  // different modes. Drop it so the on-disk scene stays theme-agnostic.
  delete safeAppState.theme

  // Fast path: serialize directly for canonical scenes.
  try {
    return serializeAsJSON(
      scene.elements as any,
      safeAppState as any,
      safeFiles as any,
      'local',
    )
  } catch {
    // Fallback: repair malformed/corrupt scenes through restore.
  }

  const safeElements = sanitizeElementIndices(scene.elements)
  const restored = restore(
    {
      elements: safeElements as any,
      appState: safeAppState as any,
      files: safeFiles as any,
    },
    null,
    null,
    {
      refreshDimensions: false,
      repairBindings: true,
    },
  )

  return serializeAsJSON(
    restored.elements as any,
    restored.appState as any,
    restored.files as any,
    'local',
  )
}

function tryParseJson(value: string): ParsedExcalidrawScene | null {
  try {
    const parsed = JSON.parse(value) as {
      elements?: unknown
      appState?: Record<string, unknown>
      files?: Record<string, unknown>
    }
    if (!Array.isArray(parsed.elements)) return null
    return {
      elements: parsed.elements,
      appState: parsed.appState,
      files: parsed.files,
    }
  } catch {
    return null
  }
}

function normalizeObsidianHighlighterElements(elements: unknown[]): unknown[] {
  let changed = false

  const normalized = elements.map((element) => {
    if (!element || typeof element !== 'object') return element

    const candidate = element as Record<string, unknown>
    if (candidate.type !== 'freedraw') return element

    const customData = candidate.customData as Record<string, unknown> | undefined
    const strokeOptions = customData?.strokeOptions as Record<string, unknown> | undefined
    const isHighlighter = strokeOptions?.highlighter === true
    if (!isHighlighter) return element

    const strokeColor = typeof candidate.strokeColor === 'string' ? candidate.strokeColor.toLowerCase() : null
    const backgroundColor = typeof candidate.backgroundColor === 'string' ? candidate.backgroundColor : null

    const hasVisibleBackgroundColor = Boolean(
      backgroundColor
      && backgroundColor.trim() !== ''
      && backgroundColor.toLowerCase() !== 'transparent',
    )
    const invisibleStroke = strokeColor === '#fff' || strokeColor === '#ffffff' || strokeColor === 'white'

    if (!hasVisibleBackgroundColor || !invisibleStroke) return element

    changed = true
    return {
      ...candidate,
      // Obsidian highlighter stores visible color in backgroundColor; vanilla Excalidraw
      // renders freedraw using strokeColor, so map it for viewer compatibility.
      strokeColor: backgroundColor,
    }
  })

  return changed ? normalized : elements
}

/** Strip invalid fractional indices so Excalidraw's restore() regenerates them. */
function sanitizeElementIndices(elements: unknown[]): unknown[] {
  let changed = false
  const sanitized = elements.map((el) => {
    if (!isRecord(el)) return el
    const idx = el.index
    if (idx !== undefined && idx !== null && !hasValidFractionalIndex(idx)) {
      changed = true
      const { index: _removed, ...rest } = el
      return rest
    }
    return el
  })
  return changed ? sanitized : elements
}

function normalizeScene(scene: ParsedExcalidrawScene): ParsedExcalidrawScene {
  const normalizedElements = normalizeObsidianHighlighterElements(scene.elements)
  if (isLikelyCanonicalScene({ ...scene, elements: normalizedElements })) {
    return {
      elements: normalizedElements,
      appState: scene.appState ?? {},
      files: scene.files ?? {},
    }
  }

  // Remove invalid fractional indices before restore() so it regenerates valid ones.
  const sanitizedElements = sanitizeElementIndices(normalizedElements)

  try {
    const restored = restore(
      {
        elements: sanitizedElements as any,
        appState: (scene.appState ?? {}) as any,
        files: (scene.files ?? {}) as any,
      },
      null,
      null,
      {
        refreshDimensions: false,
        repairBindings: true,
      },
    )

    return {
      elements: restored.elements as unknown[],
      appState: restored.appState as Record<string, unknown>,
      files: restored.files as Record<string, unknown>,
    }
  } catch {
    // Fallback keeps rendering path resilient for partially malformed scenes.
    return normalizeExcalidrawSceneForInteropBlock({
      elements: sanitizedElements,
      appState: scene.appState,
      files: scene.files,
    })
  }
}

function maybeNormalizeScene(scene: ParsedExcalidrawScene, normalize: boolean): ParsedExcalidrawScene {
  return normalize ? normalizeScene(scene) : scene
}

interface CodeFenceMatch {
  start: number
  end: number
  type: string
  body: string
}

function findCodeFences(content: string): CodeFenceMatch[] {
  const matches: CodeFenceMatch[] = []
  const openFenceRe = /(^|\n)```([a-zA-Z0-9_-]+)?[ \t]*\n/gm
  const closeFenceRe = /\n```[ \t]*(?=\n|$)/g

  let openMatch: RegExpExecArray | null
  while ((openMatch = openFenceRe.exec(content)) !== null) {
    const fenceStart = openMatch.index + (openMatch[1]?.length ?? 0)
    const type = (openMatch[2] ?? '').trim().toLowerCase()
    const bodyStart = openFenceRe.lastIndex

    closeFenceRe.lastIndex = bodyStart
    const closeMatch = closeFenceRe.exec(content)
    if (!closeMatch) break

    matches.push({
      start: fenceStart,
      end: closeMatch.index + closeMatch[0].length,
      type,
      body: content.slice(bodyStart, closeMatch.index),
    })

    openFenceRe.lastIndex = closeMatch.index + closeMatch[0].length
  }

  return matches
}

function parseFromCodeFences(content: string, normalize: boolean): ParsedExcalidrawScene | null {
  const fences = findCodeFences(content)
  for (const fence of fences) {
    const fenceType = fence.type
    const block = fence.body.trim()

    if (fenceType === '' || fenceType === 'json') {
      const parsed = tryParseJson(block)
      if (parsed) return maybeNormalizeScene(parsed, normalize)
      continue
    }

    if (fenceType === 'compressed-json') {
      const decompressed = decompressFromBase64LzString(block.replace(/\s+/g, ''))
      if (!decompressed) continue
      const parsed = tryParseJson(decompressed)
      if (parsed) return maybeNormalizeScene(parsed, normalize)
    }
  }
  return null
}

function parseExcalidrawSceneInternal(content: string, normalize: boolean): ParsedExcalidrawScene | null {
  const raw = content.trim()
  if (!raw) return null

  const direct = tryParseJson(raw)
  if (direct) return maybeNormalizeScene(direct, normalize)

  return parseFromCodeFences(content, normalize)
}

export function parseExcalidrawScene(content: string): ParsedExcalidrawScene | null {
  return parseExcalidrawSceneInternal(content, true)
}

export function parseExcalidrawSceneRaw(content: string): ParsedExcalidrawScene | null {
  return parseExcalidrawSceneInternal(content, false)
}

/** Replace the `## Text Elements` section content in an existing markdown file. */
function replaceTextElementsSection(content: string, newSection: string): string {
  const marker = '## Text Elements\n'
  const idx = content.indexOf(marker)
  if (idx < 0) return content

  const sectionStart = idx + marker.length
  // Find the next `%%` or `##` boundary that ends the text elements section
  const endMarkers = ['\n%%\n', '\n%%\r\n']
  let sectionEnd = -1
  for (const em of endMarkers) {
    const pos = content.indexOf(em, sectionStart)
    if (pos >= 0 && (sectionEnd < 0 || pos < sectionEnd)) sectionEnd = pos
  }
  if (sectionEnd < 0) return content

  return `${content.slice(0, sectionStart)}${newSection}\n${content.slice(sectionEnd)}`
}

export function serializeExcalidrawScene(
  originalContent: string,
  scene: ParsedExcalidrawScene,
): string {
  const serialized = sceneToJson(scene)
  const raw = originalContent.trim()
  const textElements = buildTextElementsSectionBlock(scene.elements)

  // Pure JSON format (.excalidraw files) — return bare JSON.
  if (raw) {
    const direct = tryParseJson(raw)
    if (direct) {
      return `${serialized}\n`
    }
  }

  // Preserve original structure (frontmatter, headings, etc.) — only replace the code fence body.
  const fences = findCodeFences(originalContent)
  for (const fence of fences) {
    const fenceType = fence.type
    if (fenceType === 'compressed-json') {
      let result = `${originalContent.slice(0, fence.start)}\`\`\`json\n${serialized}\n\`\`\`${originalContent.slice(fence.end)}`
      result = replaceTextElementsSection(result, textElements)
      return result
    }

    if (fenceType === '' || fenceType === 'json') {
      const parsed = tryParseJson(fence.body.trim())
      if (!parsed) continue
      let result = `${originalContent.slice(0, fence.start)}\`\`\`json\n${serialized}\n\`\`\`${originalContent.slice(fence.end)}`
      result = replaceTextElementsSection(result, textElements)
      return result
    }
  }

  return `---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==\n\n# Excalidraw Data\n\n## Text Elements\n${textElements}\n%%\n## Drawing\n\`\`\`json\n${serialized}\n\`\`\`\n%%\n`
}
