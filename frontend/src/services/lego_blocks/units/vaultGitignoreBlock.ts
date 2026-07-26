// Maintains a Thinking-Space-managed section inside the vault root .gitignore.
// Used to keep high-churn, intentionally-unindexed paths (e.g. Webull tick
// data) out of git commits without disturbing entries the user added by hand.
//
// The managed section is delimited by sentinel comments and rebuilt in full
// each time, so callers just hand over the current set of managed prefixes.

import type { VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'

const GITIGNORE_PATH = '.gitignore'
const BEGIN_MARKER = '# BEGIN Thinking Space managed exclusions'
const END_MARKER = '# END Thinking Space managed exclusions'

// Vault-relative prefixes that Thinking Space always keeps out of git,
// regardless of which caller triggered the sync. These directories hold
// auto-generated activity dumps + AI-derived digests: high-churn, machine-
// written, and often containing sensitive signal (screen-time streams,
// per-doc reading windows). Baked in so the ignore lands even for users
// who never touch settings that today explicitly call the sync (e.g. Webull).
const APP_MANAGED_GITIGNORE_BASELINE = ['ai-raw', 'ai-activity']

// Subpaths that must stay *tracked* even though their parent prefix is ignored.
//
// `ai-activity/thinking-organizer/` holds undertaking records — the head
// sentence, tags, sections and `grew_out_of` edges of the Thinking Organizer
// index. Unlike everything else under `ai-activity/` (raw sessions, chains,
// ranges) these are hand-written and hand-edited, revised destructively, and
// regenerable from nothing. Losing git history there loses the data outright,
// so the parent exclusion is narrowed rather than blanket.
//
// Emitted as `/<prefix>/*` + `!/<prefix>/<keep>/` on purpose: the directory
// form `/<prefix>/` makes git skip descending into it entirely, which silently
// kills any later negation.
const APP_MANAGED_GITIGNORE_EXCEPTIONS: Record<string, string[]> = {
  'ai-activity': ['thinking-organizer'],
}

function normalizePrefix(value: string): string | null {
  const trimmed = value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildManagedBlock(prefixes: string[]): string {
  if (prefixes.length === 0) return ''
  const lines = [
    BEGIN_MARKER,
    '# Auto-managed by Thinking Space — edit through the app, not by hand.',
    ...prefixes.flatMap(p => {
      const keep = APP_MANAGED_GITIGNORE_EXCEPTIONS[p]
      if (!keep?.length) return [`/${p}/`]
      // Order matters: the exclusion must precede its negations.
      return [`/${p}/*`, ...keep.map(sub => `!/${p}/${sub}/`)]
    }),
    END_MARKER,
  ]
  return lines.join('\n')
}

function stripExistingManagedBlock(content: string): string {
  const begin = content.indexOf(BEGIN_MARKER)
  if (begin === -1) return content
  const endIdx = content.indexOf(END_MARKER, begin)
  if (endIdx === -1) return content
  const endLineEnd = content.indexOf('\n', endIdx)
  const cut = endLineEnd === -1 ? content.length : endLineEnd + 1
  const before = content.slice(0, begin).replace(/\n*$/, '')
  const after = content.slice(cut).replace(/^\n+/, '')
  if (!before && !after) return ''
  if (!before) return after
  if (!after) return `${before}\n`
  return `${before}\n\n${after}`
}

function dedupePrefixes(prefixes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of prefixes) {
    const normalized = normalizePrefix(raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out.sort()
}

/**
 * Rewrite the managed section of the vault .gitignore to exactly match
 * `prefixes`. Safe to call repeatedly — no-op if the file already matches.
 */
export async function setManagedVaultGitignorePrefixes(
  prefixes: string[],
  fsParam?: VaultFS,
): Promise<void> {
  const fs = fsParam ?? getVaultFS()
  const normalized = dedupePrefixes([...APP_MANAGED_GITIGNORE_BASELINE, ...prefixes])

  let existing = ''
  try {
    if (await fs.exists(GITIGNORE_PATH)) {
      existing = await fs.read(GITIGNORE_PATH)
    }
  } catch {
    existing = ''
  }

  const stripped = stripExistingManagedBlock(existing)
  const managedBlock = buildManagedBlock(normalized)

  let next: string
  if (!managedBlock) {
    next = stripped
  } else if (!stripped) {
    next = `${managedBlock}\n`
  } else {
    const base = stripped.endsWith('\n') ? stripped : `${stripped}\n`
    next = `${base}\n${managedBlock}\n`
  }

  if (next === existing) return
  await fs.write(GITIGNORE_PATH, next)
}
