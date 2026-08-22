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
/** Folders picked by hand in the composer's Explorer, newest first — distinct
 *  from the recents above, which are written on *save* and therefore full of
 *  places the composer sent you rather than places you went looking for.
 *
 *  This is the list the settings panel shows, because it is the answer to the
 *  one question project + note type cannot answer: the sub-area inside a project
 *  (`operations/sfw/airms/meetings`) that you found once and want back. */
export const BROWSED_DESTINATIONS_KEY_BLOCK = 'ltm-new-note-browsed-destinations'
/** Enough to hold the handful of odd corners a vault has, short enough that the
 *  list stays scannable without a search field. */
export const BROWSED_DESTINATIONS_LIMIT_BLOCK = 6
export const CUSTOM_SHORTCUTS_KEY_BLOCK = 'ltm-new-note-custom-shortcuts'
export const LEGACY_QUICK_DESTINATIONS_KEY_BLOCK = 'ltm-new-note-quick-destinations'
export const DESTINATION_USAGE_COUNTS_KEY_BLOCK = 'ltm-new-note-destination-usage-counts'
/** Where a note goes before you have said anything about where it goes: the
 *  vault root, which the `thought` kind's suffix then turns into `thoughts/`.
 *
 *  It used to be `['lifeblood_systems', 'sfdl']` — one user's project folder,
 *  hardcoded into shipped source, which on any other vault names a folder that
 *  does not exist. Empty is the honest default: no project chosen yet. */
export const DEFAULT_BASE_PATH_BLOCK: string[] = []
export const AUTO_SAVE_PREF_KEY_BLOCK = 'ltm-new-note-auto-save'

export const BUILT_IN_SHORTCUTS_BLOCK: DestinationShortcutBlock[] = [
  { id: 'thoughts', label: 'Thoughts', pathSegments: ['thoughts'], builtIn: true },
  { id: 'meetings', label: 'Meetings', pathSegments: ['meetings'], builtIn: true },
  { id: 'todo', label: 'To Do', pathSegments: ['todos'], builtIn: true },
  { id: 'none', label: 'None', pathSegments: [], builtIn: true },
]

/** The built-in shortcut a note kind seeds the destination with, or `null` for
 *  "leave the folder where it is".
 *
 *  Kind and folder are *not* the same question — the kind is a tag (or, for
 *  `todo`, a different capability), the folder is a place, and the 2026-07-31
 *  decision to stop showing folder shortcuts named Thought/Meeting/To Do was
 *  about exactly that confusion. So this is a seed, not a lock: picking a kind
 *  moves the folder, and picking a folder afterwards overrides it and sticks.
 *  Last action wins.
 *
 *  `none` seeds nothing. It means "no kind tag", not "no folder" — a note that
 *  is untagged still belongs somewhere, and dumping it at the project root
 *  would make the least-opinionated choice the most destructive one. */
export function noteKindShortcutIdBlock(kind: NoteKindBlock): string | null {
  if (kind === 'thought') return 'thoughts'
  if (kind === 'meeting') return 'meetings'
  if (kind === 'todo') return 'todo'
  return null
}

// ---------------------------------------------------------------------------
// Projects as destinations
// ---------------------------------------------------------------------------

/** A project offered as a destination base — the project half of the
 *  `<project>/<kind folder>` path the composer has always built. */
export interface ProjectDestinationBlock {
  key: string
  name: string
  group: string
  /** Vault-relative segments. Never empty. */
  segments: string[]
}

/** The first vault-relative root a project has, or `null` when it has none.
 *
 *  A project may be rooted entirely outside the vault — Mount Sinai's only root
 *  is a code checkout under `~/Documents`, and the Vault project has no roots at
 *  all. Those are perfectly good projects for activity attribution and useless
 *  as note destinations, so they are filtered out here rather than listed and
 *  broken on click. */
export function vaultRelativeProjectRootBlock(roots: readonly string[]): string[] | null {
  for (const root of roots) {
    if (root.startsWith('/')) continue
    const segments = normalizeSegmentsBlock(root)
    if (segments.length > 0) return segments
  }
  return null
}

export function projectDestinationsBlock(
  projects: ReadonlyArray<{ key: string; name: string; group: string; roots: string[] }>,
): ProjectDestinationBlock[] {
  const out: ProjectDestinationBlock[] = []
  for (const project of projects) {
    const segments = vaultRelativeProjectRootBlock(project.roots)
    if (!segments) continue
    out.push({
      key: project.key,
      name: project.name.trim() || project.key,
      group: project.group.trim(),
      segments,
    })
  }
  return out
}

/** Which project a destination base belongs to, by longest-prefix match — the
 *  same rule the activity registry resolves session cwds with, so a base deep
 *  inside a project (`operations/sfw/airms/meetings`, reached via Explorer)
 *  still lights up its project rather than reading as unfiled. */
export function projectForSegmentsBlock(
  destinations: readonly ProjectDestinationBlock[],
  segments: readonly string[],
): ProjectDestinationBlock | null {
  let best: ProjectDestinationBlock | null = null
  for (const destination of destinations) {
    if (destination.segments.length > segments.length) continue
    if (best && destination.segments.length <= best.segments.length) continue
    let matches = true
    for (let index = 0; index < destination.segments.length; index += 1) {
      if (destination.segments[index] !== segments[index]) { matches = false; break }
    }
    if (matches) best = destination
  }
  return best
}

/** Quick destinations that the project + note-type picker cannot reproduce, as
 *  plain paths — the ones worth keeping as recents when the concept goes away.
 *
 *  A quick destination was a whole path snapshot, and most of them were a user
 *  hand-rebuilding `<project>/<kind folder>` because there was no way to say it
 *  structurally ("sfdl thoughts", "F9 thoughts"). Those are reproduced exactly
 *  by the new picker and need no memorial. What is *not* reproducible is a
 *  sub-area inside a project ("sfw airms meetings" →
 *  `operations/sfw/airms/meetings`), and dropping those silently would delete a
 *  roamed preference the user would only miss a week later. */
export function unreachableQuickDestinationPathsBlock(
  quickDestinations: ReadonlyArray<{ pathSegments: string[] }>,
  destinations: readonly ProjectDestinationBlock[],
): string[] {
  const reachable = new Set<string>()
  for (const destination of destinations) {
    reachable.add(destination.segments.join('/'))
    for (const shortcut of BUILT_IN_SHORTCUTS_BLOCK) {
      reachable.add(withSuffixBlock(destination.segments, shortcut.pathSegments).join('/'))
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const quick of quickDestinations) {
    const path = normalizeSegmentsBlock(quick.pathSegments).join('/')
    if (!path || reachable.has(path) || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

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

/** `2026-08-19.md` → `2026-08-19.md`, `2026-08-19-2.md`, `2026-08-19-3.md`…
 *
 *  The composer opens whatever is already at the target path — that is the
 *  feature, one note per day per folder — so "new note" has to *not* land on it.
 *  Suffixing the stem is the smallest thing that keeps the date (and therefore
 *  the sort order, and the frontmatter title) intact. */
export function numberedFilenameBlock(filename: string, attempt: number): string {
  const normalized = ensureMarkdownFilenameBlock(filename)
  if (attempt <= 1) return normalized
  return `${normalized.slice(0, -3)}-${attempt}.md`
}

/** Where the search for a free name gives up. Twenty notes in one folder on one
 *  day is not a naming problem any more, and an unbounded loop against the file
 *  system is not a thing to ship. */
export const NEW_NOTE_NAME_ATTEMPTS_BLOCK = 20

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
  tags?: string[]
}): string {
  const lines = [
    `title: ${JSON.stringify(options.title)}`,
    'type: thought',
    'status: active',
  ]
  // Preview only shows what the user typed. The kind tag and the `emotion/*`
  // ones are appended on save by `createThought`, so listing them here would
  // claim more certainty than a preview has.
  const tags = options.tags ?? []
  if (tags.length > 0) {
    lines.push('tags:')
    for (const tag of tags) lines.push(`  - ${JSON.stringify(tag)}`)
  }
  if (options.emotions.length > 0) {
    lines.push('emotions:')
    for (const emotion of options.emotions) lines.push(`  - ${JSON.stringify(emotion)}`)
  }
  lines.push('created_at: <generated on save>')
  lines.push('updated_at: <generated on save>')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Editor body <-> on-disk content
//
// The editor only ever sees prose. Two things are stripped on the way out and
// put back on the way in: the YAML frontmatter (generated on save — ten lines
// of uuid/key/tags appearing above the caret mid-sentence is unusable) and the
// canvas fence (nobody should stare at raw JSON in doc mode).
//
// That makes this pair the one place in the composer where a pure-function bug
// can delete text with nothing on screen to show it: the editor hands back a
// body, and whatever this reassembles is what gets written. It lives here, and
// is round-trip tested, for exactly that reason.
// ---------------------------------------------------------------------------

/** Split frontmatter from body *losslessly*: `frontmatter + body === content`.
 *
 *  `splitNoteFrontmatterBlock` strips one leading newline off the body, which
 *  is right for display and wrong here — the composer reassembles on every
 *  keystroke, so that strip ate one blank line off the top of the note per
 *  save, cumulatively. Caught by the round-trip property test, 2026-08-22. */
export function splitNoteContentExactBlock(content: string): { frontmatter: string; body: string } {
  const lines = content.split('\n')
  // `---\r` counts: a CRLF note must still have its frontmatter hidden from the
  // editor. Splitting on '\n' and keeping the '\r' inside each line means the
  // join below reproduces the original bytes, so the split stays lossless
  // without normalising anything.
  const isFence = (line: string | undefined) => line === '---' || line === '---\r'
  if (!isFence(lines[0])) return { frontmatter: '', body: content }
  let closingIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (isFence(lines[index])) { closingIndex = index; break }
  }
  if (closingIndex < 0) return { frontmatter: '', body: content }
  const frontmatter = `${lines.slice(0, closingIndex + 1).join('\n')}\n`
  return { frontmatter, body: content.slice(frontmatter.length) }
}

/** The prose the editor should show for on-disk `content`. */
export function noteEditorBodyBlock(
  content: string,
  parseCanvas: (value: string) => { bodyWithoutCanvas: string },
): string {
  const { body } = splitNoteContentExactBlock(content)
  return parseCanvas(body).bodyWithoutCanvas
}

/** On-disk content for a `nextBody` the editor produced, preserving whatever
 *  frontmatter and canvas fence `content` already carried. */
export function applyEditorBodyBlock<TTile>(
  content: string,
  nextBody: string,
  canvas: {
    parse: (value: string) => { tiles: TTile[]; hadFence: boolean; bodyWithoutCanvas: string }
    apply: (body: string, tiles: TTile[]) => string
  },
): string {
  const { frontmatter, body } = splitNoteContentExactBlock(content)
  const parsed = canvas.parse(body)
  // An unchanged body must reproduce the file byte for byte. Canvas placement
  // is normalised (the fence moves to the end), so without this short-circuit
  // a note whose fence sits mid-document would be rewritten just by being
  // opened and touched — and the composer touches it on every keystroke.
  if (nextBody === parsed.bodyWithoutCanvas) return content
  const nextWithCanvas = parsed.hadFence ? canvas.apply(nextBody, parsed.tiles) : nextBody
  return frontmatter + nextWithCanvas
}

// ---------------------------------------------------------------------------
// Durability decisions
//
// See docs/contracts/DURABILITY.md. These are the predicates that decide
// whether typed text may be discarded, and when a failed write is retried.
// They live here rather than inline in the orchestrator because they are the
// rules worth testing — the orchestrator around them is wiring.
// ---------------------------------------------------------------------------

/** Does the buffer hold text that is not on disk?
 *
 *  The single question every destructive path has to ask before it clears or
 *  replaces `content`. `base` is the last content known to be written — it is
 *  re-seeded after each successful save and each destination load, so equality
 *  means "already persisted" and anything else means "would be lost".
 *
 *  Whitespace-only content is not worth protecting; it is also what `canSave`
 *  refuses to write, so treating it as unsaved would deadlock every transition
 *  behind a save that can never succeed. */
export function bufferHasUnsavedTextBlock(content: string, base: string): boolean {
  if (!content.trim()) return false
  return content !== base
}

/** First retry delay after a failed save; doubles per consecutive failure. */
export const SAVE_RETRY_BASE_MS_BLOCK = 2000
/** Backoff ceiling. Long enough not to hammer an unavailable vault, short
 *  enough that a vault coming back is noticed within half a minute. */
export const SAVE_RETRY_MAX_MS_BLOCK = 30000

/** Backoff for the nth consecutive failed save. `0` means "no failure
 *  outstanding, do not schedule anything" and is the caller's cue to skip the
 *  timer entirely rather than schedule a zero-delay one. */
export function saveRetryDelayBlock(
  failureCount: number,
  baseMs = SAVE_RETRY_BASE_MS_BLOCK,
  maxMs = SAVE_RETRY_MAX_MS_BLOCK,
): number {
  if (!Number.isFinite(failureCount) || failureCount <= 0) return 0
  // 2 ** 1023 overflows to Infinity, and Math.min(Infinity, max) is still max,
  // so this is safe for any count — but clamp the exponent anyway so the
  // intermediate stays a real number and the behaviour is obvious to a reader.
  const exponent = Math.min(failureCount - 1, 32)
  return Math.min(baseMs * 2 ** exponent, maxMs)
}

/** What a completed move should do with the file it came from.
 *
 *  This is the one decision in the composer that deletes a file the user can
 *  see, so it is split out here to be tested directly rather than reasoned
 *  about inside an async callback.
 *
 *  `lastWritten` is what the composer last put at that path; `sessionStart` is
 *  what was there when this session first arrived. They differ because
 *  auto-save re-seeds the first one on every write — which is exactly why the
 *  second has to exist. Without it, a note you appended two lines to looks
 *  entirely yours, and the move would delete somebody's whole day. */
export type OriginCleanupActionBlock = 'delete' | 'restore' | 'leave' | 'changed-elsewhere'

export function originCleanupActionBlock(options: {
  /** Current content at the origin, or `null` if it is already gone. */
  onDisk: string | null
  lastWritten: string
  sessionStart: string
  /** Did this session bring the origin file into existence? */
  createdHere: boolean
}): OriginCleanupActionBlock {
  if (options.onDisk === null) return 'leave'
  // Something else wrote here since we last did. Not ours to touch, in either
  // direction — the same discipline `saveThoughtEdit` applies to conflicts.
  if (options.onDisk !== options.lastWritten) return 'changed-elsewhere'
  // We made it, so removing it takes nothing that predates us.
  if (options.createdHere) return 'delete'
  // It existed but held nothing: still safe to remove, and leaving it would be
  // the husk this contract exists to stop creating.
  if (!options.sessionStart.trim()) return 'delete'
  // It existed and had content. Put it back exactly as we found it — the note
  // moves, the additions go with it, the original day note stays whole.
  return 'restore'
}

/** Should an explicit save (Cmd+S / Ctrl+S) do anything?
 *
 *  Silence is the default answer. A reflex keystroke that raises a banner
 *  whenever there is nothing to write teaches people to stop pressing it, and
 *  the shortcut has to stay trustworthy in manual mode where it is the *only*
 *  way text reaches the note.
 *
 *  The todo branch is the sharp edge: `todos.create` appends, so re-submitting
 *  an unchanged list adds every task a second time. Auto-save avoids this by
 *  skipping todo mode entirely; an explicit save has to carry the guard
 *  itself, because a keystroke repeats far more readily than a button press. */
export function shouldRequestSaveBlock(options: {
  makeThisTodo: boolean
  content: string
  base: string
  saving: boolean
  loadingTargetContent: boolean
  canSave: boolean
  todoItemCount: number
  lastTodoSubmit: string | null
}): boolean {
  if (options.saving || options.loadingTargetContent) return false
  if (options.makeThisTodo) {
    if (options.todoItemCount === 0) return false
    if (options.lastTodoSubmit === options.content) return false
  } else if (!bufferHasUnsavedTextBlock(options.content, options.base)) {
    return false
  }
  return options.canSave
}

/** Should the composer write on the way out (unmount, navigation, quit)?
 *
 *  Todo mode is excluded because `todos.create` *appends*: a flush there could
 *  duplicate every task, which is why auto-save skips it too. */
export function shouldFlushOnTeardownBlock(options: {
  makeThisTodo: boolean
  content: string
  base: string
}): boolean {
  if (options.makeThisTodo) return false
  return bufferHasUnsavedTextBlock(options.content, options.base)
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
