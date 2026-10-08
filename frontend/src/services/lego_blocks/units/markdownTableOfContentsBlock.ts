export interface MarkdownTableOfContentsItemBlock {
  id: string
  title: string
  level: number
  depth: number
  line: number
}

/**
 * A heading as it reads once rendered: inline markdown (code ticks, emphasis,
 * links, wikilinks) is dropped so an outline shows `GET /health`, not the
 * backticks around it. Code spans are set aside first so their contents — an
 * `a_b_c` or a `*` — are never mistaken for emphasis.
 */
export function stripInlineMarkdownBlock(value: string): string {
  const codeSpans: string[] = []
  const withoutCode = value.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_match, _ticks, body: string) => {
    codeSpans.push(body.trim())
    return `\uE000${codeSpans.length - 1}\uE000`
  })
  const plain = withoutCode
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/(^|[^\w*\\])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w\\])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
  return plain.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => codeSpans[Number(index)] ?? '')
}

function normalizeHeadingTitleBlock(value: string): string {
  return stripInlineMarkdownBlock(value.trim().replace(/\s+#+\s*$/, ''))
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function isFenceLineBlock(value: string): { marker: '`' | '~'; size: number } | null {
  const match = value.match(/^\s{0,3}(`{3,}|~{3,})/)
  if (!match) return null
  const marker = match[1][0] as '`' | '~'
  return { marker, size: match[1].length }
}

export function parseMarkdownTableOfContentsBlock(markdown: string): MarkdownTableOfContentsItemBlock[] {
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const items: MarkdownTableOfContentsItemBlock[] = []
  const levelStack: number[] = []
  let inFrontmatter = false
  let frontmatterClosed = false
  let activeFence: { marker: '`' | '~'; size: number } | null = null

  if (lines[0]?.trim() === '---') {
    inFrontmatter = true
  }

  const pushHeading = (title: string, level: number, line: number) => {
    const normalizedTitle = normalizeHeadingTitleBlock(title)
    if (!normalizedTitle) return
    while (levelStack.length > 0 && levelStack[levelStack.length - 1] >= level) {
      levelStack.pop()
    }
    const depth = levelStack.length
    levelStack.push(level)
    items.push({
      id: `${line}:${level}:${normalizedTitle.toLowerCase()}`,
      title: normalizedTitle,
      level,
      depth,
      line,
    })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const line = lines[index]
    const trimmed = line.trim()

    if (inFrontmatter) {
      if (lineNumber > 1 && (trimmed === '---' || trimmed === '...')) {
        inFrontmatter = false
        frontmatterClosed = true
      }
      continue
    }

    const fence = isFenceLineBlock(line)
    if (activeFence) {
      if (fence && fence.marker === activeFence.marker && fence.size >= activeFence.size) {
        activeFence = null
      }
      continue
    }
    if (fence) {
      activeFence = fence
      continue
    }

    const atxMatch = line.match(/^\s{0,3}(#{1,})[ \t]+(.+?)\s*$/)
    if (atxMatch) {
      pushHeading(atxMatch[2], atxMatch[1].length, lineNumber)
      continue
    }

    if (frontmatterClosed || lineNumber > 1 || !inFrontmatter) {
      const nextLine = lines[index + 1] ?? ''
      const setextMatch = nextLine.match(/^\s{0,3}(=+|-+)\s*$/)
      if (!setextMatch) continue
      if (!trimmed || /^\s*[>*\-+]|^\s*\d+\.\s+/.test(line)) continue
      pushHeading(line, setextMatch[1][0] === '=' ? 1 : 2, lineNumber)
    }
  }

  return items
}
