// 1) Imports
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, Flame, Info, X } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import VaultGraphCanvasBlock, {
  VAULT_GRAPH_FALLBACK_COLOR,
  vaultGraphEmphasisMatch,
  type VaultGraphEmphasis,
} from '@/components/lego_blocks/units/VaultGraphCanvasBlock'
import VaultGraphTimelineBlock from '@/components/lego_blocks/units/VaultGraphTimelineBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { addGlobalSyncRefreshListenerBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import { selectGraphNodesForChainsBlock } from '@/services/lego_blocks/integrations/vaultGraphBlock'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import {
  loadVaultGraph,
  type VaultGraphData,
  type VaultGraphNode,
} from '@/services/orchestrators/vaultGraphOrch'

// The AI-activity card pulls the heatmap/table stack (and recharts through its
// own lazy boundaries); load it only when the drawer opens so it never lands in
// the graph route's initial chunk.
const AiActivityPanelBlock = lazy(
  () => import('@/components/lego_blocks/integrations/AiActivityPanelBlock'),
)

// 2) Local constants and types
/** Full-range replay duration — slow enough to watch clusters form. */
const REPLAY_DURATION_MS = 25_000
const NO_EMPHASIS: VaultGraphEmphasis = { mode: 'none' }

/** A day/session lens produced by the AI-activity card: the node ids to light,
 *  where it came from, and whether it's exact or a time-window guess. */
interface GraphCardSelection {
  ids: Set<string>
  approximate: boolean
  label: string
  kind: 'day' | 'session'
}

// 3) Orchestrator component
export default function VaultGraphOrch() {
  // 4) State and data hooks
  const [data, setData] = useState<VaultGraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scrubMs, setScrubMs] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  // Projects the chips have isolated to. Empty = show everything; otherwise only
  // these projects' nodes are shown (chips act as an include filter, not hide).
  const [focusedProjects, setFocusedProjects] = useState<ReadonlySet<string>>(new Set())
  const [unabsorbedLens, setUnabsorbedLens] = useState(false)
  const [cardOpen, setCardOpen] = useState(true)
  // Active day/session lens from the AI-activity card, plus a zoom request the
  // canvas consumes (session clicks re-frame the camera on the touched notes).
  const [cardSelection, setCardSelection] = useState<GraphCardSelection | null>(null)
  const [zoomReq, setZoomReq] = useState<{ ids: ReadonlySet<string>; nonce: number } | null>(null)
  // Transient toast when a day/session click maps to no graph notes (e.g. the
  // session worked outside the vault), so a dead click isn't silent.
  const [notice, setNotice] = useState<string | null>(null)
  // Bumped whenever the graph deselects, so the AI-activity card drops its
  // session-row highlight in step with the graph.
  const [deselectNonce, setDeselectNonce] = useState(0)
  const zoomNonce = useRef(0)
  const { hostRef, isDark } = useDarkModeClassBlock<HTMLDivElement>()
  const { openFile } = useMarkdownViewer()
  const navigate = useNavigate()
  const rafRef = useRef(0)

  // 5) Derived data/selectors
  const effectiveScrubMs = scrubMs ?? data?.maxBirthMs ?? Date.now()

  // The canvas still filters by a hidden set; derive it by inverting the chip
  // isolation — every project not in focus is hidden (none, when focus empty).
  const hiddenProjects = useMemo<ReadonlySet<string>>(() => {
    if (focusedProjects.size === 0) return new Set()
    const hidden = new Set<string>()
    for (const project of data?.projects ?? []) {
      if (!focusedProjects.has(project)) hidden.add(project)
    }
    return hidden
  }, [focusedProjects, data])

  // Precedence: the card lens (day/session) is the most explicit gesture, then
  // the standing unabsorbed toggle. The setters below clear the other so only
  // one is ever live — last gesture wins.
  const emphasis: VaultGraphEmphasis = useMemo(() => {
    // An empty node set must never become a lens — it would dim the whole graph
    // to nothing. A day/session that maps to no notes just shows the graph as-is.
    if (cardSelection && cardSelection.ids.size > 0) return { mode: 'nodes', ids: cardSelection.ids }
    if (unabsorbedLens) return { mode: 'unabsorbed' }
    return NO_EMPHASIS
  }, [cardSelection, unabsorbedLens])

  const projectColors = useMemo(() => {
    const map = new Map<string, string>()
    for (const project of data?.projects ?? []) {
      map.set(project, getProjectColor(project, isDark).stroke)
    }
    return map
  }, [data, isDark])

  const visibleNodes = useMemo(() => {
    if (!data) return []
    return data.nodes.filter(node => !hiddenProjects.has(node.project))
  }, [data, hiddenProjects])

  const visibleBirths = useMemo(
    () => visibleNodes.map(node => node.birthMs).sort((a, b) => a - b),
    [visibleNodes],
  )

  const unabsorbedCount = useMemo(
    () => visibleNodes.filter(node => vaultGraphEmphasisMatch({ mode: 'unabsorbed' }, node)).length,
    [visibleNodes],
  )

  const emphasisCount = useMemo(() => {
    if (emphasis.mode === 'none') return null
    return visibleNodes.filter(node => vaultGraphEmphasisMatch(emphasis, node)).length
  }, [visibleNodes, emphasis])

  const bornCount = useMemo(() => {
    // visibleBirths is sorted — count entries at or before the playhead.
    let lo = 0
    let hi = visibleBirths.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (visibleBirths[mid] <= effectiveScrubMs) lo = mid + 1
      else hi = mid
    }
    return lo
  }, [visibleBirths, effectiveScrubMs])

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!data) return counts
    for (const node of data.nodes) {
      counts.set(node.project, (counts.get(node.project) ?? 0) + 1)
    }
    return counts
  }, [data])

  // 6) Side effects
  const fetchData = useCallback((force: boolean) => {
    setLoading(true)
    setError(null)
    loadVaultGraph({ force })
      .then(result => {
        setData(result)
        setScrubMs(result.maxBirthMs)
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to build the vault graph.')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    fetchData(false)
  }, [fetchData])

  // Rebuild on the top-chrome universal refresh instead of a dedicated button.
  useEffect(() => addGlobalSyncRefreshListenerBlock(() => fetchData(true)), [fetchData])

  // Auto-dismiss the "no notes touched" toast a few seconds after it appears.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3600)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!playing || !data) return
    const range = Math.max(1, data.maxBirthMs - data.minBirthMs)
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last
      last = now
      setScrubMs(prev => {
        const current = prev ?? data.minBirthMs
        const next = current + (range * dt) / REPLAY_DURATION_MS
        if (next >= data.maxBirthMs) {
          setPlaying(false)
          return data.maxBirthMs
        }
        return next
      })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, data])

  // 7) Action handlers
  const handleTogglePlay = useCallback(() => {
    if (!data) return
    setPlaying(prev => {
      if (prev) return false
      // Replay from the beginning when the playhead already sits at the end.
      setScrubMs(current =>
        current === null || current >= data.maxBirthMs ? data.minBirthMs : current,
      )
      return true
    })
  }, [data])

  const handleScrub = useCallback((ms: number) => {
    setPlaying(false)
    setScrubMs(ms)
  }, [])

  // Day drill → highlight the notes that day's sessions touched (no camera
  // move). Passing an empty/inactive drill clears a day lens but leaves a
  // session lens alone (a session click doesn't change the drilled day).
  const handleCardSelection = useCallback(
    (chains: ActivityChain[], meta: { label: string; active: boolean }) => {
      // Clear a stale day lens when the drill goes inactive or maps to nothing;
      // leave a session lens alone (a session click doesn't change the day).
      const clearDayLens = () => setCardSelection(prev => (prev?.kind === 'day' ? null : prev))
      if (!data || !meta.active || chains.length === 0) {
        clearDayLens()
        return
      }
      const sel = selectGraphNodesForChainsBlock(chains, data.nodes, getStoredVaultRoot() ?? '')
      if (sel.ids.size === 0) {
        clearDayLens()
        return
      }
      setUnabsorbedLens(false)
      setCardSelection({ ids: sel.ids, approximate: sel.approximate, label: meta.label, kind: 'day' })
    },
    [data],
  )

  // Session click → highlight the exact notes it touched and zoom to them. When
  // it touched no vault notes (worked in a code repo, or a GC'd chat with no
  // time-window match), surface a toast instead of a silent dead click.
  const handleCardSelectChain = useCallback(
    (chain: ActivityChain) => {
      if (!data) return
      const sel = selectGraphNodesForChainsBlock([chain], data.nodes, getStoredVaultRoot() ?? '')
      if (sel.ids.size === 0) {
        const hadProvenance = (chain.touchedPaths?.length ?? 0) > 0
        setNotice(
          hadProvenance
            ? 'This session worked outside the vault — no vault notes touched'
            : 'No vault notes matched this session',
        )
        return
      }
      setNotice(null)
      setUnabsorbedLens(false)
      setCardSelection({
        ids: sel.ids,
        approximate: sel.approximate,
        label: chain.topic,
        kind: 'session',
      })
      zoomNonce.current += 1
      setZoomReq({ ids: sel.ids, nonce: zoomNonce.current })
    },
    [data],
  )

  // Clicking empty canvas clears the active session/day lens (and the stray
  // toast), so a blank-area click deselects the session. Bumping the nonce tells
  // the card to drop its session-row highlight too.
  const handleClearCardSelection = useCallback(() => {
    setCardSelection(null)
    setNotice(null)
    setDeselectNonce(n => n + 1)
  }, [])

  // Only modifier clicks reach here (plain clicks select in-canvas): ⌘ opens the
  // note in the shared markdown side panel, ⌥ jumps to it in the explorer.
  const handleNodeClick = useCallback(
    (node: VaultGraphNode, event: MouseEvent) => {
      if (event.metaKey) {
        openFile(node.id)
      } else if (event.altKey) {
        navigate(`/thinking-space?file=${encodeURIComponent(node.id)}`)
      }
    },
    [openFile, navigate],
  )

  const handleToggleProject = useCallback((project: string) => {
    setFocusedProjects(prev => {
      const next = new Set(prev)
      if (next.has(project)) next.delete(project)
      else next.add(project)
      return next
    })
  }, [])

  const handleRefresh = useCallback(() => {
    fetchData(true)
  }, [fetchData])

  // 8) Render helpers
  // The AI-activity card, docked to the canvas's right edge as a fixed panel
  // (fills the docked column's height with its own scroll). Same chrome as
  // home's FloatingPanel (rounded 14 / border / shadow / solid bg / padding);
  // the header pill toggles it off.
  const activityCard = (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden rounded-[14px] border border-border bg-background p-5 shadow-xl">
      <Suspense
        fallback={
          <p className="animate-pulse text-sm text-muted-foreground">Loading AI activity…</p>
        }
      >
        <AiActivityPanelBlock
          onSelectionChange={handleCardSelection}
          onSelectChain={handleCardSelectChain}
          initialDrillToday={false}
          deselectNonce={deselectNonce}
        />
      </Suspense>
    </div>
  )

  // 9) Return JSX
  return (
    <div ref={hostRef} className="flex h-full min-h-0 flex-col">
      {/* Header: identity, live counts, lenses, project legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold">Thinking Space Graph</h1>
          {data && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {emphasisCount !== null
                ? `${emphasisCount.toLocaleString()} lit`
                : `${bornCount.toLocaleString()} / ${visibleBirths.length.toLocaleString()} notes · ${data.links.length.toLocaleString()} links`}
            </span>
          )}
        </div>

        {/* Lens controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setCardSelection(null)
              setUnabsorbedLens(prev => !prev)
            }}
            aria-pressed={unabsorbedLens}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              unabsorbedLens
                ? 'border-[#FF9E3D]/60 bg-[#FF9E3D]/10 text-[#FF9E3D]'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
            title="Notes AI built that no human edit has touched since"
          >
            <Flame className="h-3 w-3" aria-hidden="true" />
            Unabsorbed
            <span className="font-mono tabular-nums opacity-70">{unabsorbedCount.toLocaleString()}</span>
          </button>
          {cardSelection && (
            <button
              type="button"
              onClick={handleClearCardSelection}
              className="flex max-w-[22rem] items-center gap-1.5 rounded-full border border-[#FF9E3D]/60 bg-[#FF9E3D]/10 px-2.5 py-0.5 text-xs text-[#FF9E3D]"
              title={
                cardSelection.approximate
                  ? 'Approximate — no file-edit provenance for this selection, lit by time window'
                  : 'Notes these AI sessions edited (exact, from file-edit provenance)'
              }
            >
              <span className="truncate">
                {cardSelection.kind === 'session' ? 'Session' : 'Day'} · {cardSelection.label}
              </span>
              {cardSelection.approximate && <span className="opacity-70">~approx</span>}
              <X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {data?.projects.map(project => {
            const filtering = focusedProjects.size > 0
            const focused = focusedProjects.has(project)
            // Shown when nothing is isolated, or when this project is in focus.
            const shown = !filtering || focused
            return (
              <button
                key={project}
                type="button"
                onClick={() => handleToggleProject(project)}
                aria-pressed={focused}
                title={
                  focused
                    ? `Showing only ${project} — click to remove`
                    : filtering
                      ? `Add ${project} to the view`
                      : `Show only ${project}`
                }
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-opacity ${
                  focused ? 'border-foreground/50' : 'border-border'
                } ${shown ? 'opacity-100' : 'opacity-35'} hover:opacity-80`}
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: projectColors.get(project) ?? VAULT_GRAPH_FALLBACK_COLOR }}
                />
                <span className="text-muted-foreground">{project}</span>
                <span className="font-mono tabular-nums text-muted-foreground/70">
                  {projectCounts.get(project)?.toLocaleString()}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() =>
              setCardOpen(prev => {
                // Closing the control retires the lens it produced.
                if (prev) setCardSelection(null)
                return !prev
              })
            }
            aria-pressed={cardOpen}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              cardOpen
                ? 'border-foreground/60 bg-foreground/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
            title="Drive the graph from the AI-activity card — pick a day to light its notes, click a session to zoom to the notes it touched"
          >
            <Activity className="h-3 w-3" aria-hidden="true" />
            AI activity
          </button>
        </div>
      </div>

      {/* Graph canvas; the AI-activity control card docks to the canvas's
          right edge as a fixed panel, and the graph is inset to its left so
          the two never overlap. */}
      <div className="relative min-h-0 flex-1">
        {/* Toast for a session/day click that mapped to no graph notes. */}
        {notice && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur">
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
              {notice}
            </div>
          </div>
        )}
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="animate-pulse text-sm text-muted-foreground">Mapping the vault…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              Try again
            </Button>
          </div>
        )}
        {data && !error && (
          <VaultGraphCanvasBlock
            data={data}
            scrubMs={effectiveScrubMs}
            hiddenProjects={hiddenProjects}
            projectColors={projectColors}
            isDark={isDark}
            playing={playing}
            emphasis={emphasis}
            zoomTo={zoomReq}
            sidePanel={cardOpen ? activityCard : null}
            onNodeClick={handleNodeClick}
            onBackgroundClick={handleClearCardSelection}
          />
        )}
      </div>

      {/* Growth timeline scrubber */}
      {data && !error && (
        <div className="border-t border-border px-4 py-2">
          <VaultGraphTimelineBlock
            minMs={data.minBirthMs}
            maxMs={data.maxBirthMs}
            birthsMs={visibleBirths}
            scrubMs={effectiveScrubMs}
            playing={playing}
            onScrub={handleScrub}
            onTogglePlay={handleTogglePlay}
          />
        </div>
      )}
    </div>
  )
}
