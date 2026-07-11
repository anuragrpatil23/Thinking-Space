// 1) Imports
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, Flame, RefreshCw, X } from 'lucide-react'
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
  const [hiddenProjects, setHiddenProjects] = useState<ReadonlySet<string>>(new Set())
  const [unabsorbedLens, setUnabsorbedLens] = useState(false)
  const [brush, setBrush] = useState<[number, number] | null>(null)
  const [cardOpen, setCardOpen] = useState(true)
  // Active day/session lens from the AI-activity card, plus a zoom request the
  // canvas consumes (session clicks re-frame the camera on the touched notes).
  const [cardSelection, setCardSelection] = useState<GraphCardSelection | null>(null)
  const [zoomReq, setZoomReq] = useState<{ ids: ReadonlySet<string>; nonce: number } | null>(null)
  const zoomNonce = useRef(0)
  const { hostRef, isDark } = useDarkModeClassBlock<HTMLDivElement>()
  const { openFile } = useMarkdownViewer()
  const navigate = useNavigate()
  const rafRef = useRef(0)

  // 5) Derived data/selectors
  const effectiveScrubMs = scrubMs ?? data?.maxBirthMs ?? Date.now()

  // Precedence: the card lens (day/session) is the most explicit gesture, then
  // the timeline brush, then the standing unabsorbed toggle. The setters below
  // clear the others so only one is ever live — last gesture wins.
  const emphasis: VaultGraphEmphasis = useMemo(() => {
    // An empty node set must never become a lens — it would dim the whole graph
    // to nothing. A day/session that maps to no notes just shows the graph as-is.
    if (cardSelection && cardSelection.ids.size > 0) return { mode: 'nodes', ids: cardSelection.ids }
    if (brush) return { mode: 'window', startMs: brush[0], endMs: brush[1] }
    if (unabsorbedLens) return { mode: 'unabsorbed' }
    return NO_EMPHASIS
  }, [cardSelection, brush, unabsorbedLens])

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

  const aiTouches = useMemo(
    () => visibleNodes.filter(node => node.aiTouchMs > 0).map(node => node.aiTouchMs),
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

  const handleBrush = useCallback((window: [number, number] | null) => {
    if (window) setCardSelection(null)
    setBrush(window)
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
      setBrush(null)
      setUnabsorbedLens(false)
      setCardSelection({ ids: sel.ids, approximate: sel.approximate, label: meta.label, kind: 'day' })
    },
    [data],
  )

  // Session click → highlight the exact notes it touched and zoom to them.
  const handleCardSelectChain = useCallback(
    (chain: ActivityChain) => {
      if (!data) return
      const sel = selectGraphNodesForChainsBlock([chain], data.nodes, getStoredVaultRoot() ?? '')
      if (sel.ids.size === 0) return // this session touched no notes in the graph
      setBrush(null)
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
    setHiddenProjects(prev => {
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
  const brushLabel =
    brush &&
    `${new Date(brush[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(
      brush[1],
    ).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  // The AI-activity card, handed to the canvas as a world-anchored element that
  // pans/zooms with the graph like a home-canvas panel (it opens proportional to
  // the fit view, not at full size). Same chrome as home's FloatingPanel
  // (rounded 14 / border / shadow / solid bg / padding); you pan away to explore
  // rather than closing it — the header pill toggles it off.
  const activityCard = (
    <div className="w-[880px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] border border-border bg-background p-5 shadow-xl">
      <Suspense
        fallback={
          <p className="animate-pulse text-sm text-muted-foreground">Loading AI activity…</p>
        }
      >
        <AiActivityPanelBlock
          onSelectionChange={handleCardSelection}
          onSelectChain={handleCardSelectChain}
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
          <h1 className="text-sm font-semibold">Vault Graph</h1>
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
              setBrush(null)
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
          {brush && (
            <button
              type="button"
              onClick={() => setBrush(null)}
              className="flex items-center gap-1.5 rounded-full border border-[#FF9E3D]/60 bg-[#FF9E3D]/10 px-2.5 py-0.5 text-xs text-[#FF9E3D]"
              title="Clear the brushed AI-activity window"
            >
              AI window · {brushLabel}
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
          {cardSelection && (
            <button
              type="button"
              onClick={() => setCardSelection(null)}
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
            const hidden = hiddenProjects.has(project)
            return (
              <button
                key={project}
                type="button"
                onClick={() => handleToggleProject(project)}
                aria-pressed={!hidden}
                className={`flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs transition-opacity ${
                  hidden ? 'opacity-35' : 'opacity-100'
                } hover:opacity-80`}
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
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleRefresh}
            disabled={loading}
            aria-label="Rebuild graph"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Graph canvas; the AI-activity control card floats over it as a
          world-anchored panel (pans/zooms with the graph), pinned to the
          bottom-right and opening proportional to the fit view. */}
      <div className="relative min-h-0 flex-1">
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
            worldCard={cardOpen ? activityCard : null}
            onNodeClick={handleNodeClick}
          />
        )}
      </div>

      {/* Growth timeline + AI-activity brush lane */}
      {data && !error && (
        <div className="border-t border-border px-4 py-2">
          <VaultGraphTimelineBlock
            minMs={data.minBirthMs}
            maxMs={data.maxBirthMs}
            birthsMs={visibleBirths}
            aiTouchesMs={aiTouches}
            scrubMs={effectiveScrubMs}
            playing={playing}
            brush={brush}
            onScrub={handleScrub}
            onTogglePlay={handleTogglePlay}
            onBrush={handleBrush}
          />
        </div>
      )}
    </div>
  )
}
