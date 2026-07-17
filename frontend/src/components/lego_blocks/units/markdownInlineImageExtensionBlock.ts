import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import {
  parseThinkingSpaceWikilinkHrefOrch,
  resolveWikilinkAssetTargetOrch,
} from '@/services/orchestrators/obsidianLinkOrch'
import { readImageDocumentOrch } from '@/services/orchestrators/imageDocumentsOrch'

// Live-preview phase 1 (CM6 decoration model — markdown stays the document,
// rendering happens on top): image embeds render inline as widgets while the
// cursor is elsewhere; putting the cursor on the line reveals the raw syntax
// (per-line reveal, the Obsidian behavior). Handles the two syntaxes the app
// writes/reads: `![[vault-target]]` wikilink embeds (what paste-to-attachment
// inserts) and `![alt](url-or-relative-path)` markdown images.

const WIKILINK_EMBED_RE_BLOCK = /!\[\[([^\]\n]+?)\]\]/g
const MARKDOWN_IMAGE_RE_BLOCK = /!\[([^\]\n]*)\]\(([^)\n]+?)\)/g
const IMAGE_EXTENSIONS_BLOCK = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'])
const PLACEHOLDER_HEIGHT_PX_BLOCK = 120
const MAX_RENDER_HEIGHT_PX_BLOCK = 480

interface LoadedImageEntryBlock {
  url: string
  width: number
  height: number
}

// Session-scoped cache keyed by `${notePath}::${target}` — object URLs plus
// natural dimensions, so revisits render at full size immediately (reserved
// height = no scroll jank on the second encounter onward).
const imageCacheBlock = new Map<string, LoadedImageEntryBlock | 'error'>()
const pendingLoadsBlock = new Set<string>()

function hasImageExtensionBlock(target: string): boolean {
  const clean = target.split(/[#|?]/)[0] ?? ''
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS_BLOCK.has(clean.slice(dot + 1).toLowerCase())
}

function normalizeRelativePathBlock(baseDir: string, relative: string): string | null {
  const joined = `${baseDir ? `${baseDir}/` : ''}${relative}`
  const segments: string[] = []
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(part)
  }
  return segments.join('/')
}

async function resolveImageTargetBlock(
  kind: 'wikilink' | 'relative',
  target: string,
  notePath: string,
): Promise<string | null> {
  if (kind === 'wikilink') {
    return resolveWikilinkAssetTargetOrch({ currentPath: notePath, target })
  }
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  return normalizeRelativePathBlock(noteDir, decodeURIComponent(target))
}

function loadImageBlock(
  cacheKey: string,
  kind: 'wikilink' | 'relative',
  target: string,
  notePath: string,
  onSettled: () => void,
): void {
  if (imageCacheBlock.has(cacheKey) || pendingLoadsBlock.has(cacheKey)) return
  pendingLoadsBlock.add(cacheKey)
  void (async () => {
    try {
      const resolvedPath = await resolveImageTargetBlock(kind, target, notePath)
      if (!resolvedPath) throw new Error('not found')
      const doc = await readImageDocumentOrch(resolvedPath)
      const blob = new Blob([Uint8Array.from(doc.bytes)], { type: doc.mime })
      const url = URL.createObjectURL(blob)
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const probe = new Image()
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
        probe.onerror = () => resolve({ width: 0, height: 0 })
        probe.src = url
      })
      imageCacheBlock.set(cacheKey, { url, ...dimensions })
    } catch {
      imageCacheBlock.set(cacheKey, 'error')
    } finally {
      pendingLoadsBlock.delete(cacheKey)
      onSettled()
    }
  })()
}

class InlineImageWidgetBlock extends WidgetType {
  constructor(
    private readonly cacheKey: string,
    private readonly kind: 'wikilink' | 'relative' | 'external',
    private readonly target: string,
    private readonly notePath: string,
    private readonly alt: string,
    private readonly requestRefresh: () => void,
  ) {
    super()
  }

  override eq(other: InlineImageWidgetBlock): boolean {
    return other.cacheKey === this.cacheKey
      && imageCacheBlock.get(this.cacheKey) === imageCacheBlock.get(other.cacheKey)
  }

  override toDOM(): HTMLElement {
    const container = document.createElement('span')
    container.className = 'ltm-cm-inline-image'
    container.style.display = 'inline-block'
    container.style.maxWidth = '100%'
    container.style.verticalAlign = 'text-bottom'

    const appendImg = (src: string, width: number, height: number) => {
      const img = document.createElement('img')
      img.src = src
      img.alt = this.alt
      img.draggable = false
      img.style.maxWidth = '100%'
      img.style.maxHeight = `${MAX_RENDER_HEIGHT_PX_BLOCK}px`
      img.style.borderRadius = '6px'
      img.style.display = 'block'
      if (width > 0 && height > 0) {
        // Natural dimensions reserve layout space before decode — no jank.
        img.width = width
        img.height = height
        img.style.height = 'auto'
      }
      container.appendChild(img)
    }

    if (this.kind === 'external') {
      appendImg(this.target, 0, 0)
      return container
    }

    const cached = imageCacheBlock.get(this.cacheKey)
    if (cached && cached !== 'error') {
      appendImg(cached.url, cached.width, cached.height)
      return container
    }

    if (cached === 'error') {
      const badge = document.createElement('span')
      badge.textContent = `image not found: ${this.target}`
      badge.className = 'ltm-cm-inline-image-error'
      badge.style.cssText = 'font-size:11px;opacity:0.6;border:1px dashed currentColor;border-radius:4px;padding:1px 6px;'
      container.appendChild(badge)
      return container
    }

    const placeholder = document.createElement('span')
    placeholder.style.cssText = `display:inline-block;width:180px;height:${PLACEHOLDER_HEIGHT_PX_BLOCK}px;border-radius:6px;background:currentColor;opacity:0.08;`
    container.appendChild(placeholder)
    loadImageBlock(this.cacheKey, this.kind, this.target, this.notePath, this.requestRefresh)
    return container
  }

  override ignoreEvent(): boolean {
    // Clicks land on the widget (e.g. future lightbox); cursor placement via
    // clicking beside it still works because the syntax range is replaced.
    return false
  }
}

interface InlineImageExtensionOptionsBlock {
  getCurrentPath: () => string | null
}

export function createMarkdownInlineImageExtensionBlock(
  options: InlineImageExtensionOptionsBlock,
): ViewPlugin<{ decorations: DecorationSet }> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(private readonly view: EditorView) {
        this.decorations = this.build(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.length > 0) {
          this.decorations = this.build(update.view)
        }
      }

      private requestRefresh = () => {
        // A load settled — rebuild decorations so placeholders become images.
        queueMicrotask(() => {
          try {
            this.view.dispatch({})
          } catch {
            // View was destroyed while the image loaded; nothing to refresh.
          }
        })
      }

      private build(view: EditorView): DecorationSet {
        const notePath = options.getCurrentPath()
        const builder = new RangeSetBuilder<Decoration>()
        if (!notePath) return builder.finish()

        const cursorLines = new Set<number>()
        for (const range of view.state.selection.ranges) {
          cursorLines.add(view.state.doc.lineAt(range.head).number)
          cursorLines.add(view.state.doc.lineAt(range.anchor).number)
        }

        for (const { from, to } of view.visibleRanges) {
          let position = from
          while (position <= to) {
            const line = view.state.doc.lineAt(position)
            if (!cursorLines.has(line.number)) {
              type MatchBlock = { start: number; end: number; kind: 'wikilink' | 'relative' | 'external'; target: string; alt: string }
              const matches: MatchBlock[] = []

              WIKILINK_EMBED_RE_BLOCK.lastIndex = 0
              for (let m = WIKILINK_EMBED_RE_BLOCK.exec(line.text); m; m = WIKILINK_EMBED_RE_BLOCK.exec(line.text)) {
                const target = (m[1] ?? '').split('|')[0].trim()
                if (!hasImageExtensionBlock(target)) continue
                matches.push({ start: m.index, end: m.index + m[0].length, kind: 'wikilink', target, alt: target })
              }

              MARKDOWN_IMAGE_RE_BLOCK.lastIndex = 0
              for (let m = MARKDOWN_IMAGE_RE_BLOCK.exec(line.text); m; m = MARKDOWN_IMAGE_RE_BLOCK.exec(line.text)) {
                const rawUrl = (m[2] ?? '').trim()
                const isExternal = /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('data:')
                if (!isExternal && !hasImageExtensionBlock(rawUrl)) continue
                // A wikilink parsed as href (preview pipeline) also matches here; skip those.
                if (parseThinkingSpaceWikilinkHrefOrch(rawUrl)) continue
                matches.push({
                  start: m.index,
                  end: m.index + m[0].length,
                  kind: isExternal ? 'external' : 'relative',
                  target: rawUrl,
                  alt: m[1] ?? '',
                })
              }

              matches.sort((a, b) => a.start - b.start)
              let lastEnd = -1
              for (const match of matches) {
                if (match.start < lastEnd) continue
                lastEnd = match.end
                const cacheKey = `${notePath}::${match.target}`
                builder.add(
                  line.from + match.start,
                  line.from + match.end,
                  Decoration.replace({
                    widget: new InlineImageWidgetBlock(
                      cacheKey,
                      match.kind,
                      match.target,
                      notePath,
                      match.alt,
                      this.requestRefresh,
                    ),
                  }),
                )
              }
            }
            position = line.to + 1
          }
        }
        return builder.finish()
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
