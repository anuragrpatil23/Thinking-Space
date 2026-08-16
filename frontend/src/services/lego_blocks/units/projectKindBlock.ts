// What kind of work a project is, and the colors that kind wears.
//
// The work-mix heatmap needs to know whether a day's hours were thinking,
// building, or the job. Deriving that per session is not possible — the
// signal isn't in a transcript — and asking per session is a standing tax the
// user won't pay. So the classification rides on the *project*, set once in
// Settings ▸ Projects and folded over `ActivityDay.byChainProjectDurationMs`
// forever after.
//
// The cost of that choice is honest and worth stating: a project is only ever
// mostly one kind. Building a feature in a thinking project counts as
// thinking, and the day-level override in the heatmap is the escape hatch.
//
// Kinds are deliberately few. Merging two later is lossless; splitting one is
// a reconstruction from memory, so this errs granular (`conditioning` exists
// with no derivable input yet — see the note on it below).

/** Unset ('') is distinct from `other`: it means nobody has classified this
 *  project yet, which the settings UI surfaces and the fold treats as `other`. */
export type ProjectKindBlock =
  | ''
  | 'thinking'
  | 'building'
  | 'maintenance'
  | 'conditioning'
  | 'other'

export const PROJECT_KINDS_BLOCK: Exclude<ProjectKindBlock, ''>[] = [
  'thinking',
  'building',
  'maintenance',
  'conditioning',
  'other',
]

export interface ProjectKindMetaBlock {
  kind: Exclude<ProjectKindBlock, ''>
  /** User-facing name. Deliberately plain — the model's private vocabulary
   *  (writes, diffs, conditioning-as-zone-2) stays out of the UI. */
  label: string
  /** One line under the label in the settings dropdown. */
  hint: string
  /** `rgb(r,g,b)` so consumers can splice in their own alpha, matching the
   *  existing heatmap tint path. */
  stroke: string
  strokeDark: string
}

export const PROJECT_KIND_META_BLOCK: Record<
  Exclude<ProjectKindBlock, ''>,
  ProjectKindMetaBlock
> = {
  thinking: {
    kind: 'thinking',
    label: 'Thinking',
    hint: 'Work where the point is to arrive somewhere you were not.',
    stroke: 'rgb(217,119,6)',
    strokeDark: 'rgb(251,191,36)',
  },
  building: {
    kind: 'building',
    label: 'Building',
    hint: 'Making the tools and systems that the thinking runs on.',
    stroke: 'rgb(37,99,235)',
    strokeDark: 'rgb(96,165,250)',
  },
  maintenance: {
    kind: 'maintenance',
    label: 'Maintenance',
    hint: 'The job, and anything else that has to keep running.',
    stroke: 'rgb(100,116,139)',
    strokeDark: 'rgb(148,163,184)',
  },
  conditioning: {
    kind: 'conditioning',
    label: 'Conditioning',
    hint: 'Reading and input that keeps judgement sharp. Rarely visible here.',
    stroke: 'rgb(5,150,105)',
    strokeDark: 'rgb(52,211,153)',
  },
  other: {
    kind: 'other',
    label: 'Other',
    hint: 'Everything that does not belong to the four above.',
    stroke: 'rgb(120,113,108)',
    strokeDark: 'rgb(168,162,158)',
  },
}

export function projectKindStrokeBlock(kind: ProjectKindBlock, isDark: boolean): string {
  const meta = PROJECT_KIND_META_BLOCK[normalizeProjectKindBlock(kind) || 'other']
  return isDark ? meta.strokeDark : meta.stroke
}

export function projectKindLabelBlock(kind: ProjectKindBlock): string {
  const normalized = normalizeProjectKindBlock(kind)
  return normalized ? PROJECT_KIND_META_BLOCK[normalized].label : 'Unset'
}

/** Anything unrecognised becomes '' rather than `other`, so a typo in a
 *  hand-edited projects.json reads as "not classified" and shows up in
 *  settings instead of quietly counting as a measured category. */
export function normalizeProjectKindBlock(value: unknown): ProjectKindBlock {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().toLowerCase()
  return (PROJECT_KINDS_BLOCK as string[]).includes(trimmed)
    ? (trimmed as ProjectKindBlock)
    : ''
}

/** Minimal shape this module needs from a project — deliberately structural so
 *  this unit stays independent of `projectBlock` (which imports the kind type). */
export interface ProjectKindSourceBlock {
  key: string
  name: string
  aliases?: string[]
  kind?: ProjectKindBlock
}

/**
 * Build the name→kind lookup the fold uses.
 *
 * Activity days are keyed by the *canonical project name* the parser emits,
 * which may be the project's key, its name, or one of its aliases depending on
 * which rung of the precedence ladder claimed the session. All three are
 * registered so a project classified once is classified for every spelling its
 * sessions arrive under.
 */
export function buildProjectKindMapBlock(
  projects: ProjectKindSourceBlock[],
): Record<string, ProjectKindBlock> {
  const map: Record<string, ProjectKindBlock> = {}
  for (const project of projects) {
    const kind = normalizeProjectKindBlock(project.kind)
    if (!kind) continue
    for (const alias of [project.key, project.name, ...(project.aliases ?? [])]) {
      const clean = typeof alias === 'string' ? alias.trim() : ''
      if (clean) map[clean] = kind
    }
  }
  return map
}
