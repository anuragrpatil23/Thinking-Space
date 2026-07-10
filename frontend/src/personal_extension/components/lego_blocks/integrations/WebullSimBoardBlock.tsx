import { useCallback, useEffect, useState } from 'react'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import { addGlobalSyncRefreshListenerBlock } from '@/services/lego_blocks/units/globalSyncRefreshBlock'
import {
  loadWebullSimOverviewOrch,
  type WebullSimOverviewBlock,
} from '@/personal_extension/services/orchestrators/webullSimOrch'
import WebullSimTimelineBlock from './WebullSimTimelineBlock'

interface WebullSimBoardBlockProps {
  /** Render the timeline at full intrinsic width (canvas grows to fit). */
  fitWidth?: boolean
  /** Notified whenever a fresh overview loads — lets a canvas host size the world. */
  onOverviewLoaded?: (overview: WebullSimOverviewBlock) => void
}

// Self-loading Sim timeline: reads the f9-sim vault data and renders the
// timeline + summary strip. Shared by the canvas anchor (Study-style board) and
// the non-electron card fallback so the load/refresh/empty logic lives once.
// Clicking a case mark opens the note in the in-app markdown side panel.
export default function WebullSimBoardBlock({ fitWidth = false, onOverviewLoaded }: WebullSimBoardBlockProps) {
  const { openFile } = useMarkdownViewer()
  const [overview, setOverview] = useState<WebullSimOverviewBlock | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await loadWebullSimOverviewOrch()
      setOverview(next)
      onOverviewLoaded?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the Sim timeline.')
    } finally {
      setLoading(false)
    }
  }, [onOverviewLoaded])

  useEffect(() => {
    void load()
  }, [load])

  // Reload when the universal top-chrome refresh fires (no local refresh button).
  useEffect(() => addGlobalSyncRefreshListenerBlock(() => { void load() }), [load])

  const openCase = useCallback((filePath: string) => {
    openFile(filePath, { mode: 'view' })
  }, [openFile])

  return (
    <div className="space-y-3">
      {loading && !overview && (
        <p className="text-sm text-muted-foreground">Loading the Sim timeline from the vault…</p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {overview && !overview.configured && (
        <p className="text-sm text-muted-foreground">{overview.warnings[0]}</p>
      )}
      {overview && overview.configured && (
        <WebullSimTimelineBlock model={overview.model} onOpenCase={openCase} fitWidth={fitWidth} />
      )}
    </div>
  )
}
