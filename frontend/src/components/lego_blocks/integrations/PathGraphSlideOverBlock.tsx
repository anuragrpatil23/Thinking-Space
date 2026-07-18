import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'
import VaultGraphCanvasBlock, {
  type VaultGraphEmphasis,
} from '@/components/lego_blocks/units/VaultGraphCanvasBlock'
import { loadVaultGraph, type VaultGraphData, type VaultGraphNode } from '@/services/orchestrators/vaultGraphOrch'
import { selectGraphNodesForPathBlock } from '@/services/lego_blocks/integrations/vaultGraphBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import { openFileInNewTabOrch } from '@/services/orchestrators/fileSystemOrch'

export interface PathGraphTarget {
  /** Vault-relative path of the note or folder. */
  path: string
  kind: 'file' | 'folder'
}

interface PathGraphSlideOverBlockProps {
  /** The note/folder to light in the graph. `null` closes the panel. */
  target: PathGraphTarget | null
  onClose: () => void
}

function leafName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? path : path.slice(idx + 1)
}

const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>()

/**
 * A "peek" into the vault graph from the explorer: opens the same unified graph
 * the /vault-graph page shows, lensed + zoomed to a note (plus its linked
 * neighbors) or to every note under a folder. Reuses the shared loadVaultGraph
 * snapshot (5-min TTL + dedupe) and is mounted lazily so the graph canvas never
 * loads until the user actually peeks.
 */
export default function PathGraphSlideOverBlock({ target, onClose }: PathGraphSlideOverBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const [data, setData] = useState<VaultGraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zoomNonce = useRef(0)

  useEffect(() => {
    if (!target) return
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
  }, [target])

  useEffect(() => {
    if (target) return
    setData(null)
    setError(null)
  }, [target])

  const selection = useMemo(() => {
    if (!target || !data) return null
    return selectGraphNodesForPathBlock(target.path, target.kind, data.nodes, data.links)
  }, [target, data])

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

  if (!target) return null

  const litCount = selection?.ids.size ?? 0
  const title = target.kind === 'folder'
    ? `${leafName(target.path) || 'Vault'} · in graph`
    : `${leafName(target.path)} · in graph`
  const subtitle = target.kind === 'folder'
    ? (litCount > 0 ? `${litCount} note${litCount === 1 ? '' : 's'} in this folder` : 'no notes in this folder are in the graph')
    : (litCount > 0
        ? `this note + ${litCount - 1} linked note${litCount - 1 === 1 ? '' : 's'}`
        : 'this note is not in the graph yet')

  return createPortal(
    <div ref={hostRef} className="fixed inset-0 z-[100]">
      <style>{`
        @keyframes ltm-path-graph-slideover-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="absolute right-0 top-0 flex h-full w-[min(920px,94vw)] flex-col overflow-hidden border-l border-border/40 bg-background shadow-2xl"
        style={{
          animation: 'ltm-path-graph-slideover-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
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
