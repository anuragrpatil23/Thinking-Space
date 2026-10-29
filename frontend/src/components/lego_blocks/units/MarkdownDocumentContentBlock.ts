import { isValidElement, type ReactNode } from 'react'
import yaml from 'js-yaml'

const MARKDOWN_BLANK_LINE_MARKER = 'LTM-BLANK-LINE-MARKER-V2'
const LEGACY_MARKDOWN_BLANK_LINE_MARKERS = new Set([
  'LTM-PRESERVE-BLANK-LINE-MARKER',
  '__LTM_PRESERVE_BLANK_LINE__',
  'LTM_PRESERVE_BLANK_LINE',
  'LTM PRESERVE BLANK LINE',
])

export const DEFERRED_RENDER_CHARS = 180_000

export interface MarkdownMeta {
  lines: number | null
  words: number | null
  headings: number | null
  size: string
  createdAt: string | null
  updatedAt: string | null
}

export interface MarkdownFrontmatterMetaEntry {
  key: string
  value: string
}

export interface MarkdownFrontmatterMetaState {
  hasFrontmatter: boolean
  yamlText: string
  entries: MarkdownFrontmatterMetaEntry[]
  parseError: string | null
}

export function stripFrontmatter(content: string): string {
  return splitFrontmatter(content).body
}

export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') return { frontmatter: '', body: normalized }

  let closingIndex = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      closingIndex = i
      break
    }
  }
  if (closingIndex < 0) return { frontmatter: '', body: normalized }

  const frontmatter = `${lines.slice(0, closingIndex + 1).join('\n')}\n`
  const body = lines.slice(closingIndex + 1).join('\n')
  return { frontmatter, body }
}

export function isBlankLineMarkerText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed === MARKDOWN_BLANK_LINE_MARKER) return true
  if (LEGACY_MARKDOWN_BLANK_LINE_MARKERS.has(trimmed)) return true
  const normalized = trimmed
    .replace(/[_*\-`]+/g, '')
    .replace(/\s+/g, '')
    .toUpperCase()
  return normalized === 'LTMPRESERVEBLANKLINE' || normalized === 'LTMBLANKLINEMARKERV2'
}

export function extractTextFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('')
  if (isValidElement(node)) return extractTextFromNode(node.props.children as ReactNode)
  return ''
}

export function preserveExtraBlankLinesInMarkdown(content: string): string {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (isBlankLineMarkerText(line) ? '' : line))
    .join('\n')
  const lines = normalized.split('\n')
  const output: string[] = []
  let inFence = false

  const isFenceLine = (line: string): boolean => {
    const trimmed = line.trimStart()
    return trimmed.startsWith('```') || trimmed.startsWith('~~~')
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (isFenceLine(line)) {
      inFence = !inFence
      output.push(line)
      continue
    }

    if (!inFence && line === '') {
      let runEnd = index
      while (runEnd < lines.length && lines[runEnd] === '') runEnd += 1
      const runLength = runEnd - index

      if (runLength <= 2) {
        for (let i = 0; i < runLength; i += 1) output.push('')
      } else {
        // A marker at column 0 ends any open list, so indented text after the
        // gap (still part of the item in plain markdown) turned into a code
        // block. Inside a list, indent the marker to stay in the item.
        const indent = markerIndentInList(lines, index, runEnd)
        output.push('', '')
        for (let i = 0; i < runLength - 2; i += 1) {
          output.push(`${indent}${MARKDOWN_BLANK_LINE_MARKER}`, '')
        }
      }

      index = runEnd - 1
      continue
    }

    output.push(line)
  }

  return output.join('\n')
}

const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/
const leadingSpaces = (line: string): number => line.length - line.trimStart().length

/** Indent for blank-line markers in the run `[start, end)`: none outside a
 *  list; inside one, the shallower of the lines around the gap, so the marker
 *  joins the item the following text belongs to. */
function markerIndentInList(lines: string[], start: number, end: number): string {
  const next = lines.slice(end).find(line => line.trim() !== '')
  if (next === undefined || leadingSpaces(next) === 0) return ''
  let prevIndex = start - 1
  while (prevIndex >= 0 && lines[prevIndex].trim() === '') prevIndex -= 1
  if (prevIndex < 0) return ''
  // The block the gap sits in starts at the nearest unindented line above it.
  let rootIndex = prevIndex
  while (rootIndex > 0 && (lines[rootIndex].trim() === '' || leadingSpaces(lines[rootIndex]) > 0)) rootIndex -= 1
  if (!LIST_ITEM_LINE.test(lines[rootIndex])) return ''
  return ' '.repeat(Math.min(leadingSpaces(lines[prevIndex]), leadingSpaces(next)))
}

type HastNodeBlock = { type: string; tagName?: string; value?: string; children?: HastNodeBlock[] }
const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'pre', 'blockquote', 'table', 'div', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const isBlockNode = (node: HastNodeBlock | undefined) => node?.type === 'element' && BLOCK_TAGS.has(node.tagName ?? '')

/** Rehype plugin: drop whitespace-only text that only separates block children
 *  of a list item or quote. Invisible normally, but with "preserve newlines"
 *  (`white-space: pre-wrap` on `li`) the "\n" before a loose item's `<p>` put
 *  the bullet on a line of its own, text below. Inline soft breaks (between
 *  two inline nodes) are left alone. */
export function rehypeTrimBlockWhitespaceBlock() {
  const visit = (node: HastNodeBlock) => {
    if (!node.children) return
    if (node.type === 'element' && (node.tagName === 'li' || node.tagName === 'blockquote')) {
      const kids = node.children
      node.children = kids.filter((child, i) => !(
        child.type === 'text'
        && !(child.value ?? '').trim()
        && (isBlockNode(kids[i - 1]) || isBlockNode(kids[i + 1]))
      ))
    }
    node.children.forEach(visit)
  }
  return (tree: HastNodeBlock) => visit(tree)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatUnixTimestampForMeta(timestampSeconds: number | null): string | null {
  if (typeof timestampSeconds !== 'number' || !Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return null
  const date = new Date(timestampSeconds * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export function scheduleDeferredWork(callback: () => void): () => void {
  if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
    const idleId = (window as any).requestIdleCallback(() => callback(), { timeout: 240 })
    return () => (window as any).cancelIdleCallback?.(idleId)
  }

  const timeoutId = window.setTimeout(callback, 32)
  return () => window.clearTimeout(timeoutId)
}

export function yieldToNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      resolve()
      return
    }
    window.requestAnimationFrame(() => resolve())
  })
}

export function frontmatterBlockToYamlText(frontmatterBlock: string): string {
  if (!frontmatterBlock) return ''
  const normalized = frontmatterBlock.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() === '---') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines[lines.length - 1]?.trim() === '---') lines.pop()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

export function yamlTextToFrontmatterBlock(yamlText: string): string {
  const normalized = yamlText.replace(/\r\n/g, '\n').replace(/^\n+/, '').trimEnd()
  if (normalized.trim() === '') return ''
  return `---\n${normalized}\n---\n`
}

export function parseFrontmatterObject(frontmatterBlock: string): Record<string, unknown> {
  const yamlText = frontmatterBlockToYamlText(frontmatterBlock)
  if (!yamlText.trim()) return {}
  try {
    const parsed = yaml.load(yamlText)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    return {}
  }
  return {}
}

export function frontmatterObjectToBlock(frontmatter: Record<string, unknown>): string {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue
    sanitized[key] = value
  }
  const dumped = yaml.dump(sanitized, { lineWidth: 120, noRefs: true }).trimEnd()
  return yamlTextToFrontmatterBlock(dumped)
}

function toFrontmatterEntryValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function buildFrontmatterMetaState(content: string): MarkdownFrontmatterMetaState {
  const { frontmatter } = splitFrontmatter(content)
  if (!frontmatter) {
    return {
      hasFrontmatter: false,
      yamlText: '',
      entries: [],
      parseError: null,
    }
  }

  const yamlText = frontmatterBlockToYamlText(frontmatter)
  if (yamlText.trim() === '') {
    return {
      hasFrontmatter: true,
      yamlText,
      entries: [],
      parseError: null,
    }
  }

  try {
    const parsed = yaml.load(yamlText)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: toFrontmatterEntryValue(value),
      }))
      return {
        hasFrontmatter: true,
        yamlText,
        entries,
        parseError: null,
      }
    }

    return {
      hasFrontmatter: true,
      yamlText,
      entries: [
        {
          key: '(value)',
          value: toFrontmatterEntryValue(parsed),
        },
      ],
      parseError: null,
    }
  } catch (error) {
    return {
      hasFrontmatter: true,
      yamlText,
      entries: [],
      parseError: error instanceof Error ? error.message : 'Invalid YAML frontmatter',
    }
  }
}
