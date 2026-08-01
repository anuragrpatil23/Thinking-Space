// User-editable mapping for AI activity projects.
//
// Detection is automatic and not configurable: a session's project is the
// folder name of its working directory (`autoInferProjectFromPathBlock`).
// The cwd is the truth — what the user CAN edit is the presentation on top:
//   - rules: rewrite/merge detected project names into canonical names
//   - colors: assign an explicit color per canonical project
//
// Both apply post-parse (in the activity hook + color block), so changing
// them never invalidates the parse cache — they regroup/recolor instantly.

import { getJsonStorageItem, setJsonStorageItem, STORAGE_KEYS } from '@/services/lego_blocks/units/storageKeyBlock'
import {
  readCachedProjectAliasesBlock,
  readCachedProjectColorsBlock,
  readCachedProjectRegistryBlock,
  resolveProjectByAliasBlock,
  resolveProjectByCwdBlock,
} from '@/services/lego_blocks/units/projectRegistryBlock'

export type AiActivityRuleMode = 'exact' | 'contains'

export interface AiActivityProjectRule {
  id: string
  /** 'exact' matches the raw detected project name verbatim (precise rename/merge).
   *  'contains' matches a case-insensitive substring of the raw name OR the
   *  session path (catch paths the heuristics misclassify). */
  mode: AiActivityRuleMode
  /** Text to match. */
  match: string
  /** Canonical project name to emit when the rule fires. Also the display name. */
  output: string
  enabled: boolean
}

export interface AiActivityMappingSettings {
  /** Evaluated in order; first match wins. */
  rules: AiActivityProjectRule[]
  /** Canonical project name -> hex color (e.g. "#34d399"). */
  colors: Record<string, string>
}

const DEFAULT_SETTINGS: AiActivityMappingSettings = { rules: [], colors: {} }

function sanitizeRule(raw: unknown): AiActivityProjectRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const match = typeof r.match === 'string' ? r.match.trim() : ''
  const output = typeof r.output === 'string' ? r.output.trim() : ''
  if (!match || !output) return null
  const mode: AiActivityRuleMode = r.mode === 'contains' ? 'contains' : 'exact'
  const id = typeof r.id === 'string' && r.id ? r.id : `rule-${Math.random().toString(36).slice(2, 10)}`
  return { id, mode, match, output, enabled: r.enabled !== false }
}

function sanitizeColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const hex = normalizeHex(value)
    if (hex) out[key] = hex
  }
  return out
}

function sanitizeSettings(raw: unknown): AiActivityMappingSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const r = raw as Partial<AiActivityMappingSettings>
  const rules = Array.isArray(r.rules)
    ? r.rules.map(sanitizeRule).filter((x): x is AiActivityProjectRule => x != null)
    : []
  return { rules, colors: sanitizeColors(r.colors) }
}

/** Normalize a hex color to `#rrggbb` lowercase, or null if unparseable. */
export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  }
  return null
}

// ---- in-memory cache + change notification ----------------------------------

let cached: AiActivityMappingSettings | null = null
const listeners = new Set<() => void>()

export function readAiActivityMappingBlock(): AiActivityMappingSettings {
  if (cached) return cached
  cached = sanitizeSettings(getJsonStorageItem<unknown>(STORAGE_KEYS.aiActivityProjectMapping, DEFAULT_SETTINGS))
  return cached
}

export function writeAiActivityMappingBlock(next: AiActivityMappingSettings): AiActivityMappingSettings {
  const normalized = sanitizeSettings(next)
  cached = normalized
  setJsonStorageItem(STORAGE_KEYS.aiActivityProjectMapping, normalized)
  for (const cb of listeners) cb()
  return normalized
}

/** Subscribe to mapping changes (same-renderer). Returns an unsubscribe fn. */
export function subscribeAiActivityMappingBlock(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ---- resolvers --------------------------------------------------------------

/** Resolve the canonical (possibly renamed/merged) project name for a session.
 *  `contains` rules match the raw name, the transcript path, and (when known)
 *  the session's working directory. */
export function resolveCanonicalProjectBlock(
  rawProject: string,
  path: string | null,
  cwd?: string | null,
  settings?: AiActivityMappingSettings,
): string {
  const snapshot = settings ?? readAiActivityMappingBlock()
  // Explicit user rules win — a deliberate override beats any automatic map.
  for (const rule of snapshot.rules) {
    if (!rule.enabled) continue
    if (rule.mode === 'exact') {
      if (rawProject === rule.match) return rule.output
    } else {
      const needle = rule.match.toLowerCase()
      if (rawProject.toLowerCase().includes(needle)) return rule.output
      if (path && path.toLowerCase().includes(needle)) return rule.output
      if (cwd && cwd.toLowerCase().includes(needle)) return rule.output
    }
  }
  // Registry: longest-prefix match on the real cwd, more principled than the
  // basename that produced `rawProject`. Collapses a project's folder variants
  // to one name. Empty cache (not loaded) → no match → basename fallback.
  if (cwd) {
    const canonical = resolveProjectByCwdBlock(cwd, readCachedProjectRegistryBlock())
    if (canonical) return canonical
  }
  // Aliases last, and only on the detected name: a path is stronger evidence
  // than a folder's spelling, so a session whose cwd is inside a registered root
  // must never be pulled elsewhere by a name another project claimed.
  const byAlias = resolveProjectByAliasBlock(rawProject, readCachedProjectAliasesBlock())
  if (byAlias) return byAlias
  return rawProject
}

// ---- path → project auto-infer (parse-time) ----------------------------------

/** Segments that are infrastructure, not projects (dotdirs, loose doc files), or
 *  junk that isn't a real folder name (shell/JSON fragments that leaked through
 *  cwd detection — they contain metacharacters a real directory never has). */
function isInfraSegment(seg: string): boolean {
  if (seg.startsWith('.') || /\.(md|txt|json)$/i.test(seg)) return true
  if (/["'`$()|;*<>]/.test(seg)) return true
  return false
}

/** The automatic project name for a working directory: its folder name (the
 *  deepest non-infrastructure segment). Returns null for degenerate paths. */
export function autoInferProjectFromPathBlock(path: string): string | null {
  const segs = path.split(/[\\/]/).filter(Boolean)
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    if (!isInfraSegment(segs[i])) return segs[i]
  }
  return null
}

/**
 * Explicit color override (hex) for a canonical project, or null.
 *
 * Two sources, and the order matters: a color set on the project itself is the
 * definition, but a color set here is a per-device override the user typed on
 * the mapping page, so it stays on top rather than being silently replaced the
 * first time someone edits the project.
 */
export function resolveProjectColorOverrideBlock(
  canonical: string,
  settings?: AiActivityMappingSettings,
): string | null {
  const snapshot = settings ?? readAiActivityMappingBlock()
  return snapshot.colors[canonical] ?? readCachedProjectColorsBlock()[canonical] ?? null
}

export function newRuleIdBlock(): string {
  return `rule-${Math.random().toString(36).slice(2, 10)}`
}
