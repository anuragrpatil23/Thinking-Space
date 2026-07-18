// User-triggered backfill of Thinking Space `uuid` fields for faster, reliable
// indexing.
//
// Most hand-written vault notes never get a `uuid:` — only notes created through
// the organizer/node path do (see createNote in yamlNoteBlock). A note with no
// uuid can't hold a stable identity in the IndexedDB node index, so any feature
// that reads notes back by metadata (memorization sessions, etc.) silently can't
// find them. Thinking Space deliberately does NOT stamp uuids on its own — this
// orchestrator is the explicit, opt-in action a user runs from Settings.
//
// Scope on purpose: only notes that ALREADY have YAML frontmatter but lack a
// usable uuid are touched. Plain frontmatter-less files are left completely
// alone. The write is surgical — a single `uuid:` line inserted into the
// existing frontmatter block; nothing else in the file is reformatted.

import { v4 as uuidv4 } from 'uuid'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { smartSync } from '@/services/orchestrators/vaultSyncOrch'

export interface VaultUuidBackfillResult {
  /** Markdown files walked. */
  scanned: number
  /** Files that already had frontmatter with a usable uuid (left untouched). */
  alreadyHadUuid: number
  /** Candidates found: frontmatter present, uuid missing/empty. */
  candidates: number
  /** Candidates successfully stamped and written. */
  stamped: number
  /** Candidates that failed to write. */
  failed: number
  errors: Array<{ path: string; error: string }>
}

// Paths we never stamp: harvested AI transcripts and TS-internal state. These
// aren't user notes and shouldn't grow a uuid.
const EXCLUDED_PREFIXES = ['ai-activity/', 'ai-raw/', 'ai_raw/', '.thinking-space/', '.thinkingspace/', '.obsidian/']

function isExcluded(path: string): boolean {
  return EXCLUDED_PREFIXES.some(prefix => path.startsWith(prefix))
}

/**
 * Insert a `uuid:` into the file's leading frontmatter block, preserving every
 * other byte. Returns the new content, or null when there's nothing to do:
 *  - the file has no leading `---` frontmatter block, or
 *  - it already carries a non-empty uuid.
 * An existing-but-empty `uuid:` line is filled in place; otherwise a new line is
 * inserted right after the opening fence.
 */
export function stampUuidInFrontmatter(content: string, uuid: string = uuidv4()): string | null {
  const usesCRLF = content.includes('\r\n')
  const lines = content.split(/\r?\n/)

  // Locate the opening fence — the first non-blank line must be `---`.
  let open = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue
    if (lines[i].trim() === '---') { open = i; break }
    return null // first real content isn't a frontmatter fence
  }
  if (open === -1) return null

  // Locate the closing fence.
  let close = -1
  for (let i = open + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { close = i; break }
  }
  if (close === -1) return null

  // Look for an existing uuid line inside the block.
  let uuidLineIndex = -1
  for (let i = open + 1; i < close; i += 1) {
    if (/^\s*uuid\s*:/.test(lines[i])) { uuidLineIndex = i; break }
  }

  if (uuidLineIndex !== -1) {
    const rawValue = lines[uuidLineIndex].replace(/^\s*uuid\s*:\s*/, '').trim().replace(/^["']|["']$/g, '')
    if (rawValue) return null // already has a real uuid — leave it
    lines[uuidLineIndex] = `uuid: "${uuid}"`
  } else {
    lines.splice(open + 1, 0, `uuid: "${uuid}"`)
  }

  return lines.join(usesCRLF ? '\r\n' : '\n')
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

/**
 * Scan every markdown note and stamp a uuid onto those that have frontmatter but
 * no usable uuid, then re-sync so the index picks them up. Safe to run
 * repeatedly — notes that already carry a uuid are skipped.
 */
export async function backfillVaultUuidsOrch(): Promise<VaultUuidBackfillResult> {
  const fs = getVaultFS()
  const result: VaultUuidBackfillResult = {
    scanned: 0,
    alreadyHadUuid: 0,
    candidates: 0,
    stamped: 0,
    failed: 0,
    errors: [],
  }

  const entries = (await fs.walkVault(['.md'])).filter(entry => !isExcluded(entry.path))
  result.scanned = entries.length

  await runWithConcurrency(entries, 8, async entry => {
    let content: string
    try {
      content = await fs.read(entry.path)
    } catch (err) {
      result.failed += 1
      result.errors.push({ path: entry.path, error: err instanceof Error ? err.message : String(err) })
      return
    }

    const next = stampUuidInFrontmatter(content)
    if (next === null) {
      // Either no frontmatter (not a candidate) or already has a uuid.
      if (/^\s*uuid\s*:\s*\S/m.test(content)) result.alreadyHadUuid += 1
      return
    }

    result.candidates += 1
    try {
      await fs.write(entry.path, next)
      result.stamped += 1
    } catch (err) {
      result.failed += 1
      result.errors.push({ path: entry.path, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // Rebuild the index so the freshly-stamped notes are queryable immediately.
  if (result.stamped > 0) {
    await smartSync()
  }

  return result
}
