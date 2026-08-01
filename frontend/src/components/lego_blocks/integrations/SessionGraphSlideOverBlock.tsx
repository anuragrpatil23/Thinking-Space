import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'
import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import VaultGraphCanvasBlock, {
  type VaultGraphEmphasis,
} from '@/components/lego_blocks/units/VaultGraphCanvasBlock'
import { loadVaultGraph, type VaultGraphData, type VaultGraphNode } from '@/services/orchestrators/vaultGraphOrch'
import { selectGraphNodesForChainsBlock } from '@/services/lego_blocks/integrations/vaultGraphBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import { openFileInNewTabOrch } from '@/services/orchestrators/fileSystemOrch'

interface SessionGraphSlideOverBlockProps {
  /** The session (chain) to light in the graph. `null` closes the panel. */
  chain: ActivityChain | null
  onClose: () => void
}

function fmtClock(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

function fmtWhen(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const date = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const a = fmtClock(startIso)
  const b = endIso ? fmtClock(endIso) : a
  return a === b ? `${date} · ${a}` : `${date} · ${a}–${b}`
}

/**
 * A "peek" into the vault graph from the AI-activity card: opens the same
 * unified graph the /vault-graph page shows, but lensed + zoomed to just the
 * files this session touched. Reuses the shared loadVaultGraph snapshot (5-min
 * TTL + in-flight dedupe) so a warm graph opens instantly. Rendered lazily so
 * the graph canvas never loads until the user actually peeks.
 */
export default function SessionGraphSlideOverBlock({ chain, onClose }: SessionGraphSlideOverBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const [data, setData] = useState<VaultGraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zoomNonce = useRef(0)

  useEffect(() => {
    if (!chain) return
    let cancelled = false
    setLoading(true)
    setError(null)
    loadVaultGraph()
      .then(next => { if (!cancelled) { setData(next); setLoading(false) } })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [chain])

  useEffect(() => {
    if (chain) return
    // Reset when closed so re-opening a different session recomputes cleanly.
    setData(null)
    setError(null)
  }, [chain])

  const selection = useMemo(() => {
    if (!chain || !data) return null
    return selectGraphNodesForChainsBlock([chain], data.nodes, getStoredVaultRoot() ?? '')
  }, [chain, data])

  const emphasis: VaultGraphEmphasis = useMemo(() => {
    if (selection && selection.ids.size > 0) return { mode: 'nodes', ids: selection.ids }
    return { mode: 'none' }
  }, [selection])

  const zoomTo = useMemo(() => {
    if (!selection || selection.ids.size === 0) return null
    zoomNonce.current += 1
    return { ids: selection.ids, nonce: zoomNonce.current }
  }, [selection])

  const projectColors = useMemo(() => {
    const map = new Map<string, string>()
    for (const project of data?.projects ?? []) {
      map.set(project, getProjectColor(project, isDark).stroke)
    }
    return map
  }, [data, isDark])

  const litCount = selection?.ids.size ?? 0

  if (!chain) return null

  const filesLabel = litCount > 0
    ? `${litCount} file${litCount === 1 ? '' : 's'} touched`
    : (selection?.approximate ? 'no vault files matched' : 'worked outside the vault')

  return createPortal(
    <div ref={hostRef} className="fixed inset-0 z-[100]">
      <style>{`
        @keyframes ltm-session-graph-slideover-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="absolute right-0 top-0 flex h-full w-[min(920px,94vw)] flex-col overflow-hidden border-l border-border/40 bg-background shadow-2xl"
        style={{
          animation: 'ltm-session-graph-slideover-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {projectLabelBlock(chain.project)} · in graph
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {chain.topic || '(no topic)'}
            </div>
            <div className="truncate text-[11px] text-muted-foreground/80">
              {fmtWhen(chain.startedIso, chain.endedIso)} · {filesLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building the graph…
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {error}
            </div>
          )}
          {data && !error && (
            <VaultGraphCanvasBlock
              data={data}
              scrubMs={data.maxBirthMs}
              hiddenProjects={EMPTY_HIDDEN}
              projectColors={projectColors}
              isDark={isDark}
              playing={false}
              emphasis={emphasis}
              zoomTo={zoomTo}
              onNodeClick={(node: VaultGraphNode) => { openFileInNewTabOrch(node.id) }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>()
