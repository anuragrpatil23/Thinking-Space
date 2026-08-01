// Note composer domain — the pure half of New Note.
//
// Everything here is a plain function or constant: no React, no DOM beyond
// localStorage, no vault I/O. It was extracted out of `pages/NewThought.tsx`
// (2026-07-31) alongside `useNoteComposerOrch`, which owns the stateful half.
//
// The split exists so the composer has a real interface rather than being
// braided through JSX. That matters for two reasons: the architecture contract
// requires domain logic to live in blocks rather than orchestrators, and a
// headless composer is the precondition for ever rendering this surface with
// something other than React (a native iOS view, for instance).

export interface DestinationShortcutBlock {
  id: string
  label: string
  pathSegments: string[]
  builtIn?: boolean
}

export interface QuickDestinationBlock {
  id: string
  label: string
  pathSegments: string[]
}

/** Ambient save state for the editing badge — mirrors the explorer's pattern,
 *  which is why New Note needs no Save button while auto-save is on. */
export type NoteSaveStateBlock = 'idle' | 'dirty' | 'saving' | 'saved'

/** What kind of note this is. Replaces the old "Make this a to do" switch
 *  (2026-07-31): the choice routes to a different capability and changes what
 *  save means, which is too much weight for a toggle sitting in a list of
 *  cosmetic ones.
 *
 *  Only `todo` changes the capability (`todos.create`); the rest go through
 *  `thoughts.create` and differ by tag. Note kind is deliberately *not*
 *  `frontmatter.type` — that field is the hierarchy's `NodeType`, a closed
 *  union with a level mapping (see ADR-004), and inventing a `meeting` level
 *  would destabilise the organizer. Tags are the universal field the note
 *  reader already queries. */
export type NoteKindBlock = 'thought' | 'meeting' | 'todo' | 'none'

export const NOTE_KIND_PREF_KEY_BLOCK = 'ltm-new-note-kind'

export const NOTE_KINDS_BLOCK: Array<{ id: NoteKindBlock; label: string }> = [
  { id: 'thought', label: 'Thought' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'todo', label: 'To Do' },
  { id: 'none', label: 'None' },
]

/** Kind tag written alongside the emotion tags, or `null` for an untagged
 *  note. `todo` never reaches this — it takes the todos capability instead. */
export function noteKindTagBlock(kind: NoteKindBlock): string | null {
  if (kind === 'thought') return 'thought'
  if (kind === 'meeting') return 'meeting'
  return null
}

export interface NoteContentMetaBlock {
  lines: number
  words: number
  headings: number
  size: string
}

export const DESTINATION_RECENTS_KEY_BLOCK = 'ltm-new-note-destination-recents'
export const CUSTOM_SHORTCUTS_KEY_BLOCK = 'ltm-new-note-custom-shortcuts'
export const LEGACY_QUICK_DESTINATIONS_KEY_BLOCK = 'ltm-new-note-quick-destinations'
export const DESTINATION_USAGE_COUNTS_KEY_BLOCK = 'ltm-new-note-destination-usage-counts'
export const DEFAULT_BASE_PATH_BLOCK = ['lifeblood_systems', 'sfdl']
export const AUTO_SAVE_PREF_KEY_BLOCK = 'ltm-new-note-auto-save'

export const BUILT_IN_SHORTCUTS_BLOCK: DestinationShortcutBlock[] = [
  { id: 'thoughts', label: 'Thoughts', pathSegments: ['thoughts'], builtIn: true },
  { id: 'meetings', label: 'Meetings', pathSegments: ['meetings'], builtIn: true },
  { id: 'todo', label: 'To Do', pathSegments: ['todos'], builtIn: true },
  { id: 'none', label: 'None', pathSegments: [], builtIn: true },
]

// ---------------------------------------------------------------------------
// Dates + filenames
// ---------------------------------------------------------------------------

export function todayFilenameBlock(): string {
  return `${todayDateStrBlock()}.md`
}

export function todayDateStrBlock(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function filenameFromTitleBlock(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `${slug}.md` : todayFilenameBlock()
}

export function ensureMarkdownFilenameBlock(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return todayFilenameBlock()
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}

// ---------------------------------------------------------------------------
// Path segments
// ---------------------------------------------------------------------------

export function normalizeSegmentsBlock(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.flatMap(segment => (typeof segment === 'string' ? segment.split('/') : []))
    : (typeof value === 'string' ? value.split('/') : [])
  return parts
    .map(segment => segment.trim())
    .filter(Boolean)
}

function endsWithSegments(path: string[], suffix: string[]): boolean {
  if (suffix.length === 0) return true
  if (path.length < suffix.length) return false
  const offset = path.length - suffix.length
  for (let index = 0; index < suffix.length; index += 1) {
    if (path[offset + index] !== suffix[index]) return false
  }
  return true
}

/** Append `suffix` unless `path` already ends with it — so selecting the
 *  "Thoughts" shortcut twice doesn't yield `.../thoughts/thoughts`. */
export function withSuffixBlock(path: string[], suffix: string[]): string[] {
  return endsWithSegments(path, suffix) ? [...path] : [...path, ...suffix]
}

/** Join a destination folder and a leaf filename into a vault path, or `null`
 *  when either half is still missing. */
export function buildTargetPathBlock(destinationPath: string, leafFilename: string): string | null {
  if (!destinationPath.trim() || !leafFilename.trim()) return null
  return `${destinationPath.replace(/\/$/, '')}/${leafFilename}`
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function readJsonStorageBlock<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonStorageBlock<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}

export function readCustomShortcutsBlock(): DestinationShortcutBlock[] {
  const parsed = readJsonStorageBlock<Array<{ id: string; label: string; pathSegments: string[] }>>(
    CUSTOM_SHORTCUTS_KEY_BLOCK,
    [],
  )
  return parsed
    .map(shortcut => ({
      id: shortcut.id,
      label: shortcut.label.trim(),
      pathSegments: normalizeSegmentsBlock(shortcut.pathSegments),
      builtIn: false,
    }))
    .filter(shortcut => shortcut.id && shortcut.label && shortcut.pathSegments.length > 0)
}

export function writeCustomShortcutsBlock(shortcuts: DestinationShortcutBlock[]): void {
  writeJsonStorageBlock(
    CUSTOM_SHORTCUTS_KEY_BLOCK,
    shortcuts
      .filter(shortcut => !shortcut.builtIn)
      .map(shortcut => ({
        id: shortcut.id,
        label: shortcut.label,
        pathSegments: shortcut.pathSegments,
      })),
  )
}

export function readLegacyQuickDestinationsBlock(): QuickDestinationBlock[] {
  const parsed = readJsonStorageBlock<Array<{ id: string; label: string; pathSegments: string[] }>>(
    LEGACY_QUICK_DESTINATIONS_KEY_BLOCK,
    [],
  )
  return parsed
    .map(destination => ({
      id: destination.id,
      label: destination.label.trim(),
      pathSegments: normalizeSegmentsBlock(destination.pathSegments),
    }))
    .filter(destination => destination.id && destination.label && destination.pathSegments.length > 0)
}

export function clearLegacyQuickDestinationsBlock(): void {
  try {
    localStorage.removeItem(LEGACY_QUICK_DESTINATIONS_KEY_BLOCK)
  } catch {
    // Ignore storage failures in restricted runtimes.
  }
}

export function readDestinationUsageCountsBlock(): Record<string, number> {
  const parsed = readJsonStorageBlock<Record<string, number>>(DESTINATION_USAGE_COUNTS_KEY_BLOCK, {})
  const normalized: Record<string, number> = {}
  for (const [path, count] of Object.entries(parsed)) {
    const cleanedPath = normalizeSegmentsBlock(path).join('/')
    if (!cleanedPath) continue
    if (!Number.isFinite(count) || count <= 0) continue
    normalized[cleanedPath] = Math.round(count)
  }
  return normalized
}

export function writeDestinationUsageCountsBlock(counts: Record<string, number>): void {
  writeJsonStorageBlock(DESTINATION_USAGE_COUNTS_KEY_BLOCK, counts)
}

export function topUsedDestinationsBlock(
  counts: Record<string, number>,
  limit = 5,
): Array<{ path: string; count: number }> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, count]) => ({ path, count }))
}

export function createShortcutIdBlock(prefix: 'custom' | 'quick'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Content derivation
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

export function computeNoteContentMetaBlock(content: string): NoteContentMetaBlock {
  const normalized = content.replace(/\r\n/g, '\n')
  const trimmed = normalized.trim()
  return {
    lines: trimmed ? normalized.split('\n').length : 0,
    words: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
    headings: (normalized.match(/^#{1,6}\s/gm) || []).length,
    size: formatBytes(new TextEncoder().encode(normalized).length),
  }
}

/** Split a leading `---` YAML block off the body.
 *
 *  Deliberately local rather than importing `markdownFrontmatterBlock`: that
 *  module pulls `js-yaml` and lands in a different Rollup chunk, and importing
 *  it from here produced a chunk cycle that failed at runtime with
 *  "splitMarkdownFrontmatterBlock is not defined" (2026-07-31). The composer
 *  only needs the string split, not the parse. */
export function splitNoteFrontmatterBlock(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') return { frontmatter: '', body: normalized }

  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) return { frontmatter: '', body: normalized }

  return {
    frontmatter: `${lines.slice(0, closingIndex + 1).join('\n')}\n`,
    body: lines.slice(closingIndex + 1).join('\n').replace(/^\n/, ''),
  }
}

/** Non-empty trimmed lines — one todo item each. */
export function splitTodoItemsBlock(content: string): string[] {
  return content.split('\n').map(line => line.trim()).filter(Boolean)
}

export function resolveNoteTitleBlock(options: {
  useCustomTitle: boolean
  title: string
  normalizedFilename: string
}): string {
  if (options.useCustomTitle && options.title.trim()) return options.title.trim()
  return options.normalizedFilename
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'untitled'
}

/** Preview only — the real frontmatter is generated on save by the capability. */
export function buildFrontmatterPreviewBlock(options: {
  title: string
  emotions: string[]
}): string {
  const lines = [
    `title: ${JSON.stringify(options.title)}`,
    'type: thought',
    'status: active',
  ]
  if (options.emotions.length > 0) {
    lines.push('emotions:')
    for (const emotion of options.emotions) lines.push(`  - ${JSON.stringify(emotion)}`)
  }
  lines.push('created_at: <generated on save>')
  lines.push('updated_at: <generated on save>')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Draft reconciliation
// ---------------------------------------------------------------------------

/** What the user typed that isn't part of the loaded file yet. Switching
 *  destinations must not silently eat an unsaved draft. */
export function computeDraftRemainderBlock(current: string, base: string): string {
  if (!current) return ''
  if (!base) return current
  if (current.startsWith(base)) return current.slice(base.length)
  return current
}

/** Re-attach a preserved draft onto freshly loaded file content. */
export function mergeDraftBlock(base: string, draft: string): string {
  if (!draft) return base
  if (!base) return draft
  return base.endsWith('\n') || draft.startsWith('\n') ? base + draft : `${base}\n${draft}`
}
