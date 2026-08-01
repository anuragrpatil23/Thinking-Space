// Detected projects — the diagnosis half of project setup.
//
// Settings ▸ Projects is where a project is *defined* (name, folders, aliases,
// color). This page is where you see what that definition actually did: every
// project the AI-activity parser found, the working directories behind it, and
// which rung of the precedence ladder claimed it. Nothing here is a second
// definition — the only write is "Make this a project", which hands the
// detected folders to the real Projects list.
//
// The old page let you rename and recolor detected projects with local rules.
// Those rules still run (removing them would drop attribution people rely on),
// but they are shown as legacy: a rename here only relabels the activity views,
// while a real project also owns its chain directory and organizer records.

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { useAiActivityBlock } from '@/components/lego_blocks/hooks/shared/useAiActivityBlock'
import { useProjectsBlock } from '@/components/lego_blocks/hooks/shared/useProjectsBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { addProjectBlock } from '@/services/lego_blocks/integrations/projectsStorageBlock'
import { loadProjectRegistryBlock } from '@/services/lego_blocks/integrations/projectRegistryLoaderBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { isValidProjectKeyBlock } from '@/services/lego_blocks/units/projectBlock'
import {
  autoInferProjectFromPathBlock,
  explainCanonicalProjectBlock,
  readAiActivityMappingBlock,
  writeAiActivityMappingBlock,
  type AiActivityMappingSettings,
  type AiActivityProjectRule,
  type AiActivityRuleMode,
  type ProjectAttributionSourceBlock,
} from '@/services/lego_blocks/units/aiActivityMappingBlock'

const DEFAULT_NEW_COLOR = '#38bdf8'

/** How many working directories a new project adopts as roots. Beyond a
 *  handful they are almost always one-off checkouts, and an over-broad root
 *  set claims other projects' sessions. */
const ADOPT_MAX_ROOTS = 4

function strokeToHex(stroke: string): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(stroke)
  if (!m) return DEFAULT_NEW_COLOR
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
}

interface DetectedDirsBlock {
  /** Working directories for this project, busiest first. */
  dirs: string[]
  /** Why this project resolved the way it did, from its busiest session. */
  source: ProjectAttributionSourceBlock
  via: string
}

function attributionTextBlock(source: ProjectAttributionSourceBlock, via: string): string {
  if (source === 'root') return `folder ${via}`
  if (source === 'alias') return `alias "${via}"`
  if (source === 'rule') return `rule "${via}"`
  return 'not claimed — folder name'
}

export default function AiActivityProjectMappingSettingsBlock() {
  const activity = useAiActivityBlock('all')
  const { projects: defined } = useProjectsBlock()
  const [settings, setSettings] = useState<AiActivityMappingSettings>(() => readAiActivityMappingBlock())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const commit = (next: AiActivityMappingSettings) => {
    setSettings(writeAiActivityMappingBlock(next))
  }

  const definedKeys = useMemo(
    () => new Set(defined.map(p => p.key).filter(Boolean)),
    [defined],
  )

  // Detected (post-mapping) projects, real ones first then noise/unknown.
  const projects = useMemo(() => {
    return [...activity.projects].sort((a, b) => {
      const rank = (p: typeof a) => (p.isUnknown ? 2 : p.isNoise ? 1 : 0)
      const r = rank(a) - rank(b)
      if (r !== 0) return r
      return b.totalMsgs - a.totalMsgs
    })
  }, [activity.projects])

  // The truth behind each project: which working directories its sessions ran
  // in, and which rung of the ladder claimed the busiest of them. Read-only —
  // the detected paths are never editable, they are the evidence.
  const detailsByProject = useMemo(() => {
    const counts = new Map<string, Map<string, number>>()
    for (const s of activity.sessions) {
      if (!s.cwd) continue
      const dirs = counts.get(s.project) ?? new Map<string, number>()
      dirs.set(s.cwd, (dirs.get(s.cwd) ?? 0) + 1)
      counts.set(s.project, dirs)
    }
    const out = new Map<string, DetectedDirsBlock>()
    for (const [project, dirs] of counts) {
      const sorted = [...dirs.entries()].sort((a, b) => b[1] - a[1]).map(([dir]) => dir)
      // Replay the ladder for the busiest directory. `s.project` has already
      // been rewritten to the canonical name, so the raw detected name is
      // recovered the same way the parser produced it in the first place.
      const busiest = sorted[0]
      const raw = autoInferProjectFromPathBlock(busiest) ?? '<unknown>'
      const { source, via } = explainCanonicalProjectBlock(raw, null, busiest, settings)
      out.set(project, { dirs: sorted, source, via })
    }
    return out
  }, [activity.sessions, settings])

  const setColor = (name: string, hex: string | null) => {
    const colors = { ...settings.colors }
    if (hex) colors[name] = hex
    else delete colors[name]
    commit({ ...settings, colors })
  }

  // Adoption: the detected name becomes the key, because that is the address
  // its chains are already filed under (`ai-activity/chains/<key>/`). Choosing
  // anything else here would strand every digest this project already has.
  const adopt = async (canonical: string, dirs: string[]) => {
    setError(null)
    if (!isValidProjectKeyBlock(canonical)) {
      setError(`"${canonical}" can't be a project address (it contains a path separator).`)
      return
    }
    setBusy(canonical)
    try {
      const added = await addProjectBlock({
        name: canonical,
        key: canonical,
        roots: dirs.slice(0, ADOPT_MAX_ROOTS),
      })
      if (!added) {
        setError('Could not write projects.json — it may be open or unreadable.')
        return
      }
      await loadProjectRegistryBlock()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the project.')
    } finally {
      setBusy(null)
    }
  }

  const updateRule = (id: string, patch: Partial<AiActivityProjectRule>) => {
    commit({ ...settings, rules: settings.rules.map(r => (r.id === id ? { ...r, ...patch } : r)) })
  }

  const removeRule = (id: string) => {
    commit({ ...settings, rules: settings.rules.filter(r => r.id !== id) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Detected projects</CardTitle>
        <CardDescription>
          What the activity parser actually found: every project, the working directories behind it,
          and what claimed it. The paths are the evidence and aren't editable. To change a name,
          folders, aliases or color, edit the project in <span className="font-medium">Projects</span>{' '}
          — anything here that isn't a project yet can be made one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {activity.loading && projects.length === 0 && (
            <p className="text-xs text-muted-foreground">Loading activity…</p>
          )}
          {!activity.loading && projects.length === 0 && (
            <p className="text-xs text-muted-foreground/70">No AI activity found yet.</p>
          )}
          <div className="space-y-1.5">
            {projects.map(p => (
              <ProjectRow
                key={p.name}
                canonical={p.name}
                meta={`${p.totalChains} chain${p.totalChains === 1 ? '' : 's'} · ${p.totalMsgs} msg${p.totalMsgs === 1 ? '' : 's'}${p.isNoise ? ' · noise' : p.isUnknown ? ' · unknown' : ''}`}
                details={detailsByProject.get(p.name) ?? null}
                isDefined={definedKeys.has(p.name)}
                isBucket={p.isNoise || p.isUnknown}
                hasColorOverride={!!settings.colors[p.name]}
                busy={busy === p.name}
                onColor={hex => setColor(p.name, hex)}
                onResetColor={() => setColor(p.name, null)}
                onAdopt={() => void adopt(p.name, detailsByProject.get(p.name)?.dirs ?? [])}
              />
            ))}
          </div>
        </div>

        {/* Legacy rules. Never offered for new use — a rule relabels activity
            views only, while a project also owns its chains and records. Kept
            editable so the ones people already rely on can be seen and undone. */}
        {settings.rules.length > 0 && (
          <div className="space-y-2 border-t border-border/60 pt-4">
            <h3 className="text-sm font-medium text-foreground">Mapping rules (legacy)</h3>
            <p className="text-xs text-muted-foreground">
              These run before folders and aliases and override both. They predate projects having
              folders of their own; prefer adding the folder or alias to the project instead, then
              remove the rule here.
            </p>
            <div className="space-y-1.5">
              {settings.rules.map(rule => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onChange={patch => updateRule(rule.id, patch)}
                  onRemove={() => removeRule(rule.id)}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface ProjectRowProps {
  /** The canonical project string — the key its chains are filed under. */
  canonical: string
  meta: string
  details: DetectedDirsBlock | null
  isDefined: boolean
  /** `[noise]` / `<unknown>` buckets are not projects and can't be adopted. */
  isBucket: boolean
  hasColorOverride: boolean
  busy: boolean
  onColor: (hex: string) => void
  onResetColor: () => void
  onAdopt: () => void
}

function ProjectRow({
  canonical,
  meta,
  details,
  isDefined,
  isBucket,
  hasColorOverride,
  busy,
  onColor,
  onResetColor,
  onAdopt,
}: ProjectRowProps) {
  const [showAll, setShowAll] = useState(false)
  const swatch = strokeToHex(getProjectColor(canonical).stroke)
  const label = projectLabelBlock(canonical)
  const dirs = details?.dirs ?? []
  const visibleDirs = showAll ? dirs : dirs.slice(0, 1)

  return (
    <div className="rounded-md border border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        {isDefined ? (
          <span
            className="h-6 w-6 shrink-0 rounded border border-border/60"
            style={{ background: swatch }}
            aria-hidden
          />
        ) : (
          // Undefined projects have nowhere else to store a color, so the
          // override stays available here.
          <input
            type="color"
            value={swatch}
            onChange={e => onColor(e.target.value)}
            className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border/60 bg-transparent p-0"
            title="Set color"
            aria-label={`Color for ${label}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-foreground">{label}</span>
            {label !== canonical && (
              <span className="truncate font-mono text-[11px] text-muted-foreground/60" title="Filed under">
                {canonical}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{meta}</div>
        </div>
        {/* An override wins over the project's own color, so it must always be
            clearable — otherwise a stale one is invisible and permanent. */}
        {hasColorOverride && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onResetColor} title="Use the project's color">
            Reset color
          </Button>
        )}
        {isDefined ? (
          <span className="shrink-0 text-xs text-muted-foreground/70">In Projects</span>
        ) : isBucket ? null : (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onAdopt}>
            {busy ? 'Adding…' : 'Make this a project'}
          </Button>
        )}
      </div>

      {details && (
        <div className="mt-1.5 space-y-0.5 pl-8">
          <div className="text-[11px] text-muted-foreground/70">
            {attributionTextBlock(details.source, details.via)}
          </div>
          {visibleDirs.map(dir => (
            <div key={dir} className="truncate font-mono text-[11px] text-muted-foreground/60" title={dir}>
              {dir}
            </div>
          ))}
          {dirs.length > 1 && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              className="text-[11px] text-muted-foreground/70 underline-offset-2 hover:underline"
            >
              {showAll ? 'Show less' : `+${dirs.length - 1} more folder${dirs.length === 2 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface RuleRowProps {
  rule: AiActivityProjectRule
  onChange: (patch: Partial<AiActivityProjectRule>) => void
  onRemove: () => void
}

function RuleRow({ rule, onChange, onRemove }: RuleRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2">
      <input
        type="checkbox"
        checked={rule.enabled}
        onChange={e => onChange({ enabled: e.target.checked })}
        className="h-4 w-4 shrink-0 cursor-pointer"
        title={rule.enabled ? 'Enabled' : 'Disabled'}
        aria-label="Rule enabled"
      />
      <select
        value={rule.mode}
        onChange={e => onChange({ mode: e.target.value as AiActivityRuleMode })}
        className="h-8 rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring"
      >
        <option value="exact">name is</option>
        <option value="contains">contains</option>
      </select>
      <input
        type="text"
        value={rule.match}
        onChange={e => onChange({ match: e.target.value })}
        placeholder={rule.mode === 'exact' ? 'detected name' : 'name or path fragment'}
        className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm outline-none focus:border-ring"
      />
      <span className="text-xs text-muted-foreground">→</span>
      <input
        type="text"
        value={rule.output}
        onChange={e => onChange({ output: e.target.value })}
        placeholder="project name"
        className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm outline-none focus:border-ring"
      />
      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={onRemove}>
        Remove
      </Button>
    </div>
  )
}
