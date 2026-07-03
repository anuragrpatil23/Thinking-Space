import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Maximize2, Save, Settings2, X } from 'lucide-react'
import ExcalidrawDocumentBlock from '@/components/lego_blocks/integrations/ExcalidrawDocumentBlock'
import {
  buildMindmapPreviewFromContentOrch,
  getDefaultMindmapBuildOptionsOrch,
  saveMindmapSceneFromContentOrch,
  suggestMindmapOutputPathOrch,
  type MindmapBuildOptions,
  type MindmapPreviewData,
} from '@/services/orchestrators/mindmapBuilderOrch'

interface MarkdownMindmapPanelBlockProps {
  inputPath: string
  content: string
  open: boolean
}

type MindmapToggleOptionKey =
  | 'includeFullText'
  | 'fillSweep'
  | 'centerText'
  | 'multicolorBranches'
  | 'boxNodes'
  | 'roundedCorners'

export default function MarkdownMindmapPanelBlock({
  inputPath,
  content,
  open,
}: MarkdownMindmapPanelBlockProps) {
  const normalizedPath = inputPath.trim()
  const supportsMindmap = normalizedPath.length > 0
    && /\.md$/i.test(normalizedPath)
    && !/\.excalidraw\.md$/i.test(normalizedPath)
  const [mindmapImmersiveOpen, setMindmapImmersiveOpen] = useState(false)
  const [mindmapSettingsOpen, setMindmapSettingsOpen] = useState(false)
  const [mindmapOptions, setMindmapOptions] = useState<MindmapBuildOptions>(() => getDefaultMindmapBuildOptionsOrch())
  const [debouncedMindmapOptions, setDebouncedMindmapOptions] = useState<MindmapBuildOptions>(() => getDefaultMindmapBuildOptionsOrch())
  const [mindmapOutputPath, setMindmapOutputPath] = useState('')
  const [mindmapPreview, setMindmapPreview] = useState<MindmapPreviewData | null>(null)
  const [mindmapLoading, setMindmapLoading] = useState(false)
  const [mindmapSaving, setMindmapSaving] = useState(false)
  const [mindmapError, setMindmapError] = useState<string | null>(null)
  const [mindmapMessage, setMindmapMessage] = useState<string | null>(null)
  const lastMindmapSourcePathRef = useRef('')

  const mindmapStatsLine = useMemo(() => {
    if (!mindmapPreview) return null
    return `${mindmapPreview.sourceLines} lines • ${mindmapPreview.headingCount} headings • ${mindmapPreview.nodeCount} nodes • ${mindmapPreview.connectionCount} links • build ${Math.round(mindmapPreview.timingMs.build)} ms`
  }, [mindmapPreview])

  const mindmapPreviewCanvas = (
    <>
      {mindmapPreview && (
        <ExcalidrawDocumentBlock
          content={mindmapPreview.sceneMarkdown}
          className="h-full"
        />
      )}
      {mindmapLoading && (
        <div className={`absolute inset-0 flex items-center justify-center text-xs text-muted-foreground ${mindmapPreview ? 'bg-background/50 backdrop-blur-[1px]' : ''}`}>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Building mindmap preview...
        </div>
      )}
      {!mindmapLoading && !mindmapPreview && (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          No preview available.
        </div>
      )}
    </>
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedMindmapOptions(mindmapOptions)
    }, 120)
    return () => {
      window.clearTimeout(timer)
    }
  }, [mindmapOptions])

  useEffect(() => {
    if (!supportsMindmap) {
      setMindmapImmersiveOpen(false)
      setMindmapPreview(null)
      setMindmapOutputPath('')
      setMindmapError(null)
      setMindmapMessage(null)
      lastMindmapSourcePathRef.current = ''
      return
    }
    if (lastMindmapSourcePathRef.current === normalizedPath) return
    lastMindmapSourcePathRef.current = normalizedPath
    setMindmapOutputPath(suggestMindmapOutputPathOrch(normalizedPath))
    setMindmapPreview(null)
    setMindmapError(null)
    setMindmapMessage(null)
  }, [normalizedPath, supportsMindmap])

  useEffect(() => {
    if (!open) {
      setMindmapImmersiveOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !supportsMindmap) {
      setMindmapLoading(false)
      return
    }
    let cancelled = false
    setMindmapLoading(true)
    setMindmapError(null)
    const timer = window.setTimeout(() => {
      try {
        const nextPreview = buildMindmapPreviewFromContentOrch({
          inputPath: normalizedPath,
          content,
          options: debouncedMindmapOptions,
        })
        if (cancelled) return
        setMindmapPreview(nextPreview)
      } catch (err) {
        if (cancelled) return
        setMindmapPreview(null)
        setMindmapError(err instanceof Error ? err.message : 'Failed to build mindmap preview')
      } finally {
        if (!cancelled) setMindmapLoading(false)
      }
    }, 10)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [content, debouncedMindmapOptions, normalizedPath, open, supportsMindmap])

  useEffect(() => {
    if (!mindmapImmersiveOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMindmapImmersiveOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mindmapImmersiveOpen])

  const toggleMindmapOption = useCallback((key: MindmapToggleOptionKey) => {
    setMindmapOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleSaveMindmap = useCallback(async () => {
    if (!supportsMindmap || !mindmapOutputPath.trim()) return

    setMindmapSaving(true)
    setMindmapError(null)
    setMindmapMessage(null)
    try {
      const result = await saveMindmapSceneFromContentOrch({
        inputPath: normalizedPath,
        content,
        options: mindmapOptions,
        outputPath: mindmapOutputPath,
      })
      setMindmapOutputPath(result.outputPath)
      setMindmapMessage(
        `${result.message} (${Math.round(result.timingMs.total)} ms total; write ${Math.round(result.timingMs.write)} ms)`,
      )
    } catch (err) {
      setMindmapError(err instanceof Error ? err.message : 'Failed to save mindmap')
    } finally {
      setMindmapSaving(false)
    }
  }, [content, mindmapOptions, mindmapOutputPath, normalizedPath, supportsMindmap])

  if (!supportsMindmap || !open) return null

  return (
    <>
      <div className="space-y-3 border-b border-border/30 bg-muted/[0.08] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium text-foreground">Mindmap Preview</div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <button
            type="button"
            onClick={() => setMindmapSettingsOpen(prev => !prev)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {mindmapSettingsOpen ? 'Hide settings' : 'Show settings'}
          </button>
          <input
            type="text"
            value={mindmapOutputPath}
            onChange={(event) => setMindmapOutputPath(event.target.value)}
            placeholder="Mindmap output path"
            className="h-8 w-full rounded-md border border-border/60 bg-background px-3 text-xs text-foreground"
          />
          <button
            type="button"
            onClick={() => { void handleSaveMindmap() }}
            disabled={mindmapLoading || mindmapSaving || !mindmapOutputPath.trim()}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mindmapSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save mindmap
              </>
            )}
          </button>
        </div>

        {mindmapSettingsOpen && (
          <div className="space-y-3 rounded-md border border-border/60 bg-background/70 p-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Growth mode</span>
                <select
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2"
                  value={mindmapOptions.growthMode}
                  onChange={(event) => setMindmapOptions(prev => ({
                    ...prev,
                    growthMode: event.target.value as MindmapBuildOptions['growthMode'],
                  }))}
                >
                  <option value="radial">Radial</option>
                  <option value="right-facing">Right-facing</option>
                  <option value="left-facing">Left-facing</option>
                  <option value="right-left">Right-left</option>
                  <option value="up-facing">Up-facing</option>
                  <option value="down-facing">Down-facing</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Connector type</span>
                <select
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2"
                  value={mindmapOptions.arrowType}
                  onChange={(event) => setMindmapOptions(prev => ({
                    ...prev,
                    arrowType: event.target.value as MindmapBuildOptions['arrowType'],
                  }))}
                >
                  <option value="curved">Curved</option>
                  <option value="straight">Straight</option>
                  <option value="elbow">Elbow</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Font scale</span>
                <select
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2"
                  value={mindmapOptions.fontScale}
                  onChange={(event) => setMindmapOptions(prev => ({
                    ...prev,
                    fontScale: event.target.value as MindmapBuildOptions['fontScale'],
                  }))}
                >
                  <option value="normal">Normal</option>
                  <option value="fibonacci">Fibonacci</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Font family</span>
                <select
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2"
                  value={mindmapOptions.fontFamily}
                  onChange={(event) => setMindmapOptions(prev => ({
                    ...prev,
                    fontFamily: event.target.value as MindmapBuildOptions['fontFamily'],
                  }))}
                >
                  <option value="helvetica">Helvetica</option>
                  <option value="excalidraw">Excalidraw Script</option>
                  <option value="cascadia">Cascadia</option>
                  <option value="virgil">Virgil</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Max heading depth</span>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={mindmapOptions.maxDepth}
                  onChange={(event) => setMindmapOptions(prev => ({
                    ...prev,
                    maxDepth: Math.max(1, Math.min(6, Number(event.target.value) || 1)),
                  }))}
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Wrap width (px)</span>
                <input
                  type="number"
                  min={100}
                  max={10000}
                  value={mindmapOptions.maxWrapWidth}
                  onChange={(event) => setMindmapOptions(prev => ({
                    ...prev,
                    maxWrapWidth: Math.max(100, Math.min(10000, Number(event.target.value) || 10000)),
                  }))}
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2"
                />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground">
                Include full section text
                <input
                  type="checkbox"
                  checked={mindmapOptions.includeFullText}
                  onChange={() => toggleMindmapOption('includeFullText')}
                  className="h-3.5 w-3.5"
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground">
                Fill sweep
                <input
                  type="checkbox"
                  checked={mindmapOptions.fillSweep}
                  onChange={() => toggleMindmapOption('fillSweep')}
                  className="h-3.5 w-3.5"
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground">
                Center text
                <input
                  type="checkbox"
                  checked={mindmapOptions.centerText}
                  onChange={() => toggleMindmapOption('centerText')}
                  className="h-3.5 w-3.5"
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground">
                Multicolor branches
                <input
                  type="checkbox"
                  checked={mindmapOptions.multicolorBranches}
                  onChange={() => toggleMindmapOption('multicolorBranches')}
                  className="h-3.5 w-3.5"
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground">
                Box nodes
                <input
                  type="checkbox"
                  checked={mindmapOptions.boxNodes}
                  onChange={() => toggleMindmapOption('boxNodes')}
                  className="h-3.5 w-3.5"
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground">
                Rounded corners
                <input
                  type="checkbox"
                  checked={mindmapOptions.roundedCorners}
                  onChange={() => toggleMindmapOption('roundedCorners')}
                  className="h-3.5 w-3.5"
                />
              </label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {mindmapStatsLine ?? 'Build a preview, then pop out for a larger view.'}
          </div>
          <button
            type="button"
            onClick={() => setMindmapImmersiveOpen(true)}
            disabled={!mindmapPreview && !mindmapLoading}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Pop out
          </button>
        </div>

        <div className="relative h-[42vh] min-h-[280px] overflow-hidden rounded-md border border-border/60 bg-background">
          {mindmapPreviewCanvas}
        </div>

        {mindmapError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {mindmapError}
          </div>
        )}
        {mindmapMessage && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/45 bg-emerald-50 dark:bg-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {mindmapMessage}
          </div>
        )}
      </div>

      {mindmapImmersiveOpen && (
        <div className="fixed inset-2 z-[70] sm:inset-4">
          <div
            className="absolute inset-0 rounded-xl bg-black/45 backdrop-blur-[1px]"
            onClick={() => setMindmapImmersiveOpen(false)}
          />
          <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">Mindmap Preview (Pop-out)</div>
                <div className="truncate text-xs text-muted-foreground">{mindmapStatsLine ?? 'Previewing current markdown content'}</div>
              </div>
              <button
                type="button"
                onClick={() => setMindmapImmersiveOpen(false)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 p-2">
              <div className="relative h-full overflow-hidden rounded-md border border-border/60 bg-background">
                {mindmapPreviewCanvas}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
