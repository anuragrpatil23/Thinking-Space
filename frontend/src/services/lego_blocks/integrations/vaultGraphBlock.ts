// Vault graph assembly — pure transformation from already-loaded sources
// (vault walk, Dexie link index, git births, AI session activity) into the
// node/link structure the graph view renders. No I/O here; the orchestrator
// gathers inputs and this block shapes them.

import type { VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import type { LinkRecord } from '@/services/lego_blocks/integrations/dbBlock'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'

/** The subset of the Dexie link record the graph needs — code-import edges
 *  supply the same shape without touching Dexie. */
export type GraphLinkInput = Pick<LinkRecord, 'sourceFilePath' | 'targetFilePath'>

export interface VaultGraphNode {
  /** Vault-relative file path — stable node identity. */
  id: string
  /** Filename without extension. */
  title: string
  /** Canonical project (same buckets and colors as the AI activity card). */
  project: string
  /** In+out link count — drives node radius. */
  degree: number
  /** When the note came into existence (git birth, fs ctime fallback), ms. */
  birthMs: number
  /** 0..1 — how recently an AI session plausibly touched this note. */
  heat: number
  /** Last modification fell inside a vault AI-session window; its time in ms.
   *  0 when the last touch was human (or predates activity data). */
  aiTouchMs: number
  /** The note's birth also fell inside an AI-session window. Together with
   *  aiTouchMs > 0 this marks "AI-built, never human-edited since". */
  aiBorn: boolean
  // force-graph mutates nodes in place with layout coordinates.
  x?: number
  y?: number
  fx?: number
  fy?: number
}

export interface VaultGraphLink {
  source: string
  target: string
}

export interface VaultGraphData {
  nodes: VaultGraphNode[]
  links: VaultGraphLink[]
  /** Earliest and latest node birth, ms — the timeline's domain. */
  minBirthMs: number
  maxBirthMs: number
  /** Projects present, largest first — drives the legend. */
  projects: string[]
}

// Transcript archives and app internals would drown the real notes.
const EXCLUDED_PREFIXES = ['ai-raw/', 'ai-activity/', 'history/']

/** Heat decays with age; after ~3 months an AI touch is cold. */
const HEAT_HALF_LIFE_DAYS = 21

/** Slack around a session window — saves land shortly after the last message. */
const SESSION_SLACK_MS = 5 * 60_000

function isExcluded(path: string): boolean {
  // Any dot-folder segment (.thinking-space, .obsidian, .claude, .trash, …)
  // is machine territory, wherever it sits in the tree.
  if (path.startsWith('.') || path.includes('/.')) return true
  return EXCLUDED_PREFIXES.some(prefix => path.startsWith(prefix))
}

// The three life containers hold projects one level down; everything else
// (kai-workspace, Excalidraw, …) is its own project.
const CONTAINER_ROOTS = new Set(['acceleration_core', 'lifeblood_systems', 'operations'])

/** Raw project guess from a note's path, before canonical mapping rules. */
function rawProjectOf(path: string): string {
  const segs = path.split('/')
  if (segs.length === 1) return 'vault'
  if (CONTAINER_ROOTS.has(segs[0]) && segs.length >= 3) return segs[1]
  return segs[0]
}

function titleOf(path: string): string {
  // Notes drop the .md; code files keep their extension — `App.tsx` and
  // `App.css` in the same folder must stay distinguishable.
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.endsWith('.md') ? base.slice(0, -3) : base
}

/**
 * Merge AI sessions that ran inside the vault into sorted, disjoint
 * [start, end] windows. A file whose mtime falls inside one was plausibly
 * written by that session — the cheap attribution.
 */
export function buildVaultSessionWindowsBlock(
  sessions: ParsedSession[],
  vaultFolderName: string,
): Array<[number, number]> {
  const raw: Array<[number, number]> = []
  for (const s of sessions) {
    const inVault = (s.cwd && s.cwd.includes(vaultFolderName)) || s.project === vaultFolderName
    if (!inVault) continue
    const start = Date.parse(s.startedIso)
    if (!Number.isFinite(start)) continue
    const endParsed = s.endedIso ? Date.parse(s.endedIso) : NaN
    const end = Number.isFinite(endParsed) ? endParsed : start
    raw.push([start - SESSION_SLACK_MS, Math.max(start, end) + SESSION_SLACK_MS])
  }
  raw.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const w of raw) {
    const last = merged[merged.length - 1]
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1])
    else merged.push([w[0], w[1]])
  }
  return merged
}

/** Strip the vault root off an absolute file-edit path, yielding the vault-
 *  relative node id — or null when the path is outside the vault. No extension
 *  filter: the caller's node-membership check decides what counts, which lets
 *  the same provenance mapping serve notes and code graphs. */
function absPathToNodeId(absPath: string, vaultRoot: string): string | null {
  const root = vaultRoot.replace(/\/+$/, '')
  if (root && absPath.startsWith(`${root}/`)) return absPath.slice(root.length + 1)
  return null
}

export interface GraphNodeSelection {
  /** Node ids the selected chains touched (provenance ∪ time-window fallback). */
  ids: Set<string>
  /** True when at least one chain contributed via the time-window fallback
   *  rather than file-edit provenance — so the highlight is a plausible guess,
   *  not a fact. Chat sessions and GC'd transcripts have no provenance. */
  approximate: boolean
}

/**
 * Map AI activity chains to the graph nodes they touched. Prefers exact file-
 * edit provenance (`chain.touchedPaths`, absolute → vault-relative, kept only
 * when the note exists in the graph); falls back to the time-window heuristic
 * (nodes whose AI-touch fell inside the chain's span) for any chain that has no
 * provenance. Powers the vault-graph day-highlight and session-zoom controls.
 */
export function selectGraphNodesForChainsBlock(
  chains: ActivityChain[],
  nodes: VaultGraphNode[],
  vaultRoot: string,
): GraphNodeSelection {
  const nodeIds = new Set(nodes.map(n => n.id))
  const ids = new Set<string>()
  let approximate = false
  for (const chain of chains) {
    const touchedPaths = chain.touchedPaths ?? []
    const provenance = touchedPaths
      .map(p => absPathToNodeId(p, vaultRoot))
      .filter((id): id is string => id !== null && nodeIds.has(id))
    if (provenance.length > 0) {
      for (const id of provenance) ids.add(id)
      continue
    }
    // Has file-edit provenance, but none of it landed in the vault — the session
    // worked entirely outside it (a code repo, etc). That's a KNOWN "touched no
    // vault notes", not an unknown: contribute nothing and do NOT fall back to
    // the time window (which would light unrelated notes that merely overlapped
    // in time), and don't mark the selection approximate.
    if (touchedPaths.length > 0) continue
    // No provenance at all (chat session, GC'd transcript): attribute by time —
    // notes whose last AI-touch fell inside the chain's (slack-padded) span.
    approximate = true
    const start = Date.parse(chain.startedIso) - SESSION_SLACK_MS
    const end = Date.parse(chain.endedIso) + SESSION_SLACK_MS
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    for (const n of nodes) {
      if (n.aiTouchMs >= start && n.aiTouchMs <= end) ids.add(n.id)
    }
  }
  return { ids, approximate }
}

export interface PathGraphSelection {
  /** Node ids to light in the graph. */
  ids: Set<string>
  /** The focal node (the note itself), when the target is a file that exists
   *  in the graph — lets the UI zoom/center on it. */
  focusId: string | null
  /** True when nothing in the graph matched the target path. */
  empty: boolean
}

/**
 * Select graph nodes to light for an explorer "Show in graph":
 *  - a file lights the note itself plus every note directly linked to it
 *    (wikilink / import edges, either direction);
 *  - a folder lights every note that lives under it.
 * `targetPath` is vault-relative (same identity space as node ids).
 */
export function selectGraphNodesForPathBlock(
  targetPath: string,
  kind: 'file' | 'folder',
  nodes: VaultGraphNode[],
  links: VaultGraphLink[],
): PathGraphSelection {
  const nodeIds = new Set(nodes.map(n => n.id))
  const ids = new Set<string>()

  if (kind === 'folder') {
    const prefix = targetPath === '' ? '' : `${targetPath.replace(/\/+$/, '')}/`
    for (const id of nodeIds) {
      if (prefix === '' || id.startsWith(prefix)) ids.add(id)
    }
    return { ids, focusId: null, empty: ids.size === 0 }
  }

  const focusId = nodeIds.has(targetPath) ? targetPath : null
  if (focusId) {
    ids.add(focusId)
    for (const link of links) {
      if (link.source === focusId && nodeIds.has(link.target)) ids.add(link.target)
      else if (link.target === focusId && nodeIds.has(link.source)) ids.add(link.source)
    }
  }
  return { ids, focusId, empty: ids.size === 0 }
}

function inAnyWindow(windows: Array<[number, number]>, t: number): boolean {
  let lo = 0
  let hi = windows.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [start, end] = windows[mid]
    if (t < start) hi = mid - 1
    else if (t > end) lo = mid + 1
    else return true
  }
  return false
}

export function buildVaultGraphBlock(input: {
  entries: VaultEntry[]
  links: GraphLinkInput[]
  births: Map<string, number>
  sessions: ParsedSession[]
  vaultFolderName: string
  nowMs: number
  /** Extensions that become nodes. Defaults to markdown notes; the code graph
   *  passes CODE_GRAPH_NODE_EXTENSIONS. */
  nodeExtensions?: string[]
  /** Canonical project mapping (the AI activity card's rules); identity when
   *  absent so the block stays pure and testable. */
  resolveProject?: (rawProject: string, path: string) => string
}): VaultGraphData {
  const { entries, links, births, sessions, vaultFolderName, nowMs } = input
  const resolveProject = input.resolveProject ?? ((raw: string) => raw)
  const nodeExtensions = input.nodeExtensions ?? ['.md']

  const windows = buildVaultSessionWindowsBlock(sessions, vaultFolderName)

  const nodeByPath = new Map<string, VaultGraphNode>()
  for (const entry of entries) {
    if (!nodeExtensions.some(ext => entry.path.endsWith(ext)) || isExcluded(entry.path)) continue
    const mtimeMs = entry.mtime * 1000
    const ctimeMs = entry.ctime > 0 ? entry.ctime * 1000 : mtimeMs
    const birthMs = births.get(entry.path) ?? ctimeMs

    let heat = 0
    let aiTouchMs = 0
    if (windows.length > 0 && inAnyWindow(windows, mtimeMs)) {
      aiTouchMs = mtimeMs
      const ageDays = Math.max(0, (nowMs - mtimeMs) / 86_400_000)
      heat = Math.pow(0.5, ageDays / HEAT_HALF_LIFE_DAYS)
    }
    const aiBorn = windows.length > 0 && inAnyWindow(windows, birthMs)

    nodeByPath.set(entry.path, {
      id: entry.path,
      title: titleOf(entry.path),
      project: resolveProject(rawProjectOf(entry.path), entry.path),
      degree: 0,
      birthMs,
      heat,
      aiTouchMs,
      aiBorn,
    })
  }

  // Dedupe parallel edges (a note linking the same target twice) and drop
  // self-links; degree counts each kept edge on both ends.
  const seen = new Set<string>()
  const graphLinks: VaultGraphLink[] = []
  for (const link of links) {
    const { sourceFilePath: source, targetFilePath: target } = link
    if (source === target) continue
    const a = nodeByPath.get(source)
    const b = nodeByPath.get(target)
    if (!a || !b) continue
    const key = source < target ? `${source}\x00${target}` : `${target}\x00${source}`
    if (seen.has(key)) continue
    seen.add(key)
    graphLinks.push({ source, target })
    a.degree++
    b.degree++
  }

  const nodes = Array.from(nodeByPath.values())

  let minBirthMs = Infinity
  let maxBirthMs = 0
  const projectCounts = new Map<string, number>()
  for (const node of nodes) {
    if (node.birthMs < minBirthMs) minBirthMs = node.birthMs
    if (node.birthMs > maxBirthMs) maxBirthMs = node.birthMs
    projectCounts.set(node.project, (projectCounts.get(node.project) ?? 0) + 1)
  }
  if (!Number.isFinite(minBirthMs)) {
    minBirthMs = nowMs
    maxBirthMs = nowMs
  }

  const projects = Array.from(projectCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  return { nodes, links: graphLinks, minBirthMs, maxBirthMs, projects }
}
