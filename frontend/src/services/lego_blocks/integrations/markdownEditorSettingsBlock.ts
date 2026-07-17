import { STORAGE_KEYS, getJsonStorageItem, setJsonStorageItem } from '@/services/lego_blocks/units/storageKeyBlock'

export interface MarkdownEditorSettingsBlock {
  preserveSpacesInViewMode: boolean
  preserveNewlinesInViewMode: boolean
  /** Live preview: hide markdown syntax markers on non-cursor lines and style
   *  headings/emphasis/links in the editor. Off = the raw IA-writer feel. */
  livePreviewSyntaxHiding: boolean
}

const DEFAULT_MARKDOWN_EDITOR_SETTINGS_BLOCK: MarkdownEditorSettingsBlock = {
  preserveSpacesInViewMode: true,
  preserveNewlinesInViewMode: true,
  livePreviewSyntaxHiding: true,
}

function sanitizeMarkdownEditorSettingsBlock(
  value: Partial<MarkdownEditorSettingsBlock> | null | undefined,
): MarkdownEditorSettingsBlock {
  return {
    preserveSpacesInViewMode: value?.preserveSpacesInViewMode ?? true,
    preserveNewlinesInViewMode: value?.preserveNewlinesInViewMode ?? true,
    livePreviewSyntaxHiding: value?.livePreviewSyntaxHiding ?? true,
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
