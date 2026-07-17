import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/lego_blocks/units/storageKeyBlock'

export interface MarkdownEditorSettingsBlock {
  preserveSpacesInViewMode: boolean
  preserveNewlinesInViewMode: boolean
  /** Live preview: hide markdown syntax markers on non-cursor lines and style
   *  headings/emphasis/links in the editor. Off = the raw IA-writer feel. */
  livePreviewSyntaxHiding: boolean
  /** Document font for markdown (applies to reading view AND prose editing so
   *  the two surfaces always match). 'mono' recreates the typewriter feel. */
  documentFontFamily: 'sans' | 'serif' | 'mono'
  /** Document font size in px (12–24). */
  documentFontSizePx: number
}

export const DOCUMENT_FONT_STACKS_BLOCK: Record<MarkdownEditorSettingsBlock['documentFontFamily'], string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Iowan Old Style", "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
}

function sanitizeDocumentFontFamilyBlock(value: unknown): MarkdownEditorSettingsBlock['documentFontFamily'] {
  return value === 'serif' || value === 'mono' ? value : 'sans'
}

function sanitizeDocumentFontSizeBlock(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 16
  return Math.min(24, Math.max(12, n))
}

const DEFAULT_MARKDOWN_EDITOR_SETTINGS_BLOCK: MarkdownEditorSettingsBlock = {
  preserveSpacesInViewMode: true,
  preserveNewlinesInViewMode: true,
  livePreviewSyntaxHiding: true,
  documentFontFamily: 'sans',
  documentFontSizePx: 16,
}

function sanitizeMarkdownEditorSettingsBlock(
  value: Partial<MarkdownEditorSettingsBlock> | null | undefined,
): MarkdownEditorSettingsBlock {
  return {
    preserveSpacesInViewMode: value?.preserveSpacesInViewMode ?? true,
    preserveNewlinesInViewMode: value?.preserveNewlinesInViewMode ?? true,
    livePreviewSyntaxHiding: value?.livePreviewSyntaxHiding ?? true,
    documentFontFamily: sanitizeDocumentFontFamilyBlock(value?.documentFontFamily),
    documentFontSizePx: sanitizeDocumentFontSizeBlock(value?.documentFontSizePx),
  }
}

export function getDefaultMarkdownEditorSettingsBlock(): MarkdownEditorSettingsBlock {
  return { ...DEFAULT_MARKDOWN_EDITOR_SETTINGS_BLOCK }
}

export function readMarkdownEditorSettingsBlock(): MarkdownEditorSettingsBlock {
  const raw = getJsonStorageItem<Partial<MarkdownEditorSettingsBlock> | null>(
    STORAGE_KEYS.markdownEditorSettings,
    null,
  )
  return sanitizeMarkdownEditorSettingsBlock(raw)
}

export function writeMarkdownEditorSettingsBlock(settings: MarkdownEditorSettingsBlock): void {
  setJsonStorageItem(
    STORAGE_KEYS.markdownEditorSettings,
    sanitizeMarkdownEditorSettingsBlock(settings),
  )
}
