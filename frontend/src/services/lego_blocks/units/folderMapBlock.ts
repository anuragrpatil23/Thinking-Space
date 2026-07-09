/**
 * Parse a folder's `_map.md` into an ordering + section structure for the explorer.
 *
 * Contract (per spec at lifeblood_systems/thinkingspace.ai/map-files-folder-ordering-spec.md):
 * - A bullet whose text contains a [[wikilink]] is an entry. First wikilink names the file.
 *   Text after the closing ]] (stripped of leading separator punctuation) is the description.
 * - ## headings split entries into named sections, in document order.
 * - Sub-bullets are reserved for future nesting. Currently flattened into their parent section.
 * - Everything else (prose, frontmatter, H1) is ignored — documentation for humans.
 *
 * Two safety rules the parser upholds:
 * 1. Folder is truth: `applyFolderMapBlock` guarantees every folder file appears in the output,
 *    with unmapped files appended after mapped ones (alphabetical).
 * 2. Graceful degrade: no map → alphabetical; malformed lines → skipped; missing targets → flagged
 *    on the entry but never suppress the rest.
 */

export interface FolderMapEntry {
  /** Wikilink target as written (no extension, no path). Match against folder basenames. */
  key: string
  /** Description text after the separator, or empty string. */
  description: string
  /** True if the map targets a file that isn't in the folder. */
  missing?: boolean
  /** True if this is a duplicate reference (first occurrence wins for ordering). */
  duplicate?: boolean
}

export interface FolderMapSection {
  /** Section title from `##` heading, or empty string for the implicit leading section. */
  title: string
  entries: FolderMapEntry[]
}

export interface ParsedFolderMap {
  sections: FolderMapSection[]
}

export interface FolderMapDisplay {
  sections: FolderMapSection[]
  /** Files present in the folder but not referenced by the map. Alphabetical. */
  unmapped: string[]
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/
const HEADING_RE = /^##\s+(.+?)\s*#*\s*$/
const FRONTMATTER_FENCE = '---'

const stripBasename = (target: string): string => {
  const trimmed = target.trim()
  const lastSlash = trimmed.lastIndexOf('/')
  const base = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
  return base.replace(/\.md$/i, '')
}

const extractDescription = (rest: string): string => {
  // Strip leading whitespace and any of: — – - : (with optional surrounding spaces).
  // Handles the canonical " — " plus the messy real-world variants.
  return rest.replace(/^[\s ]*[—–\-:]+[\s ]*/, '').trim()
}

/**
 * Parse `_map.md` source into ordered sections + entries.
 * Returns { sections: [] } for empty or map-less input; never throws on malformed markdown.
 */
export function parseFolderMapBlock(source: string): ParsedFolderMap {
  if (!source) return { sections: [] }

  const lines = source.split(/\r?\n/)
  let i = 0

  // Skip YAML frontmatter if present.
  if (lines[0]?.trim() === FRONTMATTER_FENCE) {
    i = 1
    while (i < lines.length && lines[i].trim() !== FRONTMATTER_FENCE) i++
    if (i < lines.length) i++ // consume closing fence
  }

  const sections: FolderMapSection[] = []
  let current: FolderMapSection = { title: '', entries: [] }
  const seen = new Set<string>()

  for (; i < lines.length; i++) {
    const line = lines[i]
    const heading = HEADING_RE.exec(line)
    if (heading) {
      if (current.entries.length > 0) sections.push(current)
      current = { title: heading[1].trim(), entries: [] }
      continue
    }

    const bullet = BULLET_RE.exec(line)
    if (!bullet) continue
    const body = bullet[2]
    const linkMatch = WIKILINK_RE.exec(body)
    if (!linkMatch) continue

    const key = stripBasename(linkMatch[1])
    if (!key) continue
    const rest = body.slice(linkMatch.index + linkMatch[0].length)
    const entry: FolderMapEntry = {
      key,
      description: extractDescription(rest),
    }
    if (seen.has(key)) entry.duplicate = true
    else seen.add(key)
    current.entries.push(entry)
  }

  if (current.entries.length > 0) sections.push(current)
  return { sections }
}

/**
 * Combine a parsed map with the folder's actual file list to produce the display order.
 *
 * `folderFiles` is the list of file basenames in the folder (without extension, matching
 * the wikilink form). Files not referenced by the map are returned in `unmapped`, sorted
 * alphabetically. Entries pointing at files not in the folder are marked `missing`.
 *
 * The parser is intentionally strict about "folder is truth": every file in `folderFiles`
 * ends up either in a section or in `unmapped`. Never lost.
 */
export function applyFolderMapBlock(
  parsed: ParsedFolderMap,
  folderFiles: readonly string[],
): FolderMapDisplay {
  const present = new Set(folderFiles)
  const mapped = new Set<string>()
  const sections: FolderMapSection[] = parsed.sections.map(section => ({
    title: section.title,
    entries: section.entries.map(entry => {
      const missing = !present.has(entry.key)
      if (!missing && !entry.duplicate) mapped.add(entry.key)
      return missing ? { ...entry, missing: true } : entry
    }),
  }))

  const unmapped = folderFiles.filter(f => !mapped.has(f)).slice().sort((a, b) => a.localeCompare(b))
  return { sections, unmapped }
}
