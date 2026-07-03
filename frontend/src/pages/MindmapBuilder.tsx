import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Workflow } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import SearchDropdown from '@/components/lego_blocks/integrations/SearchDropdownBlock'
import ExcalidrawDocumentBlock from '@/components/lego_blocks/integrations/ExcalidrawDocumentBlock'
import {
  buildMindmapPreviewOrch,
  getDefaultMindmapBuildOptionsOrch,
  listMindmapSourceFilesOrch,
  saveMindmapSceneOrch,
  suggestMindmapOutputPathOrch,
  type MindmapBuildOptions,
  type MindmapPreviewData,
} from '@/services/orchestrators/mindmapBuilderOrch'

export default function MindmapBuilder() {
  type ToggleOptionKey =
    | 'includeFullText'
    | 'centerText'
    | 'multicolorBranches'
    | 'boxNodes'
    | 'roundedCorners'
    | 'fillSweep'
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [options, setOptions] = useState<MindmapBuildOptions>(() => getDefaultMindmapBuildOptionsOrch())
  const [debouncedOptions, setDebouncedOptions] = useState<MindmapBuildOptions>(() => getDefaultMindmapBuildOptionsOrch())
  const [preview, setPreview] = useState<MindmapPreviewData | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setLoadingFiles(true)
    listMindmapSourceFilesOrch()
      .then((nextFiles) => {
        setFiles(nextFiles)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to list markdown files')
      })
      .finally(() => {
        setLoadingFiles(false)
      })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedOptions(options)
    }, 120)
    return () => {
      window.clearTimeout(timer)
    }
  }, [options])

  useEffect(() => {
    if (!selectedFile) {
      setPreview(null)
      return
    }

    setOutputPath((prev) => {
      if (prev.trim()) return prev
      return suggestMindmapOutputPathOrch(selectedFile)
    })

    let cancelled = false
    setLoadingPreview(true)
    setError(null)

    buildMindmapPreviewOrch(selectedFile, debouncedOptions)
      .then((nextPreview) => {
        if (cancelled) return
        setPreview(nextPreview)
      })
      .catch((err) => {
        if (cancelled) return
        setPreview(null)
        setError(err instanceof Error ? err.message : 'Failed to build preview')
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedOptions, selectedFile])

  const toggleOption = (key: ToggleOptionKey) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSave = async () => {
    if (!selectedFile) return

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const result = await saveMindmapSceneOrch({
        inputPath: selectedFile,
        options,
        outputPath,
      })
      setOutputPath(result.outputPath)
      setMessage(
        `${result.message} (${Math.round(result.timingMs.total)} ms total; write ${Math.round(result.timingMs.write)} ms)`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mindmap')
    } finally {
      setSaving(false)
    }
  }

  const statsLine = useMemo(() => {
    if (!preview) return null
    return `${preview.sourceLines} source lines, ${preview.headingCount} headings, ${preview.nodeCount} nodes, ${preview.connectionCount} links • read ${Math.round(preview.timingMs.read)} ms • build ${Math.round(preview.timingMs.build)} ms • serialize ${Math.round(preview.timingMs.serialize)} ms`
  }, [preview])

  return (
    <div className="ltm-page">
      <div className="ltm-page-shell ltm-shell-narrow">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Workflow className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Mindmap Builder (Full Text)</h1>
              <p className="text-muted-foreground">
                Frontend-native import of markdown headings and full section content into Excalidraw
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source Markdown</CardTitle>
              <CardDescription>
                Select a markdown note to convert into a mindmap.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SearchDropdown
                items={files}
                selected={selectedFile}
                onSelect={(value) => {
                  setSelectedFile(value)
                  setOutputPath(suggestMindmapOutputPathOrch(value))
                  setMessage(null)
                }}
                placeholder={loadingFiles ? 'Loading files...' : 'Search markdown files...'}
              />
              {selectedFile && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{selectedFile}</span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mindmap Settings</CardTitle>
              <CardDescription>
                Matches core Mindmap Builder behavior while staying frontend-only and Excalidraw-upgrade-safe.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Growth Mode</span>
                  <select
                    className="h-10 w-full rounded-lg border border-input bg-background px-3"
                    value={options.growthMode}
                    onChange={(e) => setOptions((prev) => ({
                      ...prev,
                      growthMode: e.target.value as MindmapBuildOptions['growthMode'],
                    }))}
                  >
                    <option value="radial">Radial</option>
                    <option value="right-facing">Right-facing</option>
                    <option value="left-facing">Left-facing</option>
                    <option value="right-left">Right-Left</option>
                    <option value="up-facing">Up-facing</option>
                    <option value="down-facing">Down-facing</option>
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">Connector Type</span>
                  <select
                    className="h-10 w-full rounded-lg border border-input bg-background px-3"
                    value={options.arrowType}
                    onChange={(e) => setOptions((prev) => ({
                      ...prev,
                      arrowType: e.target.value as MindmapBuildOptions['arrowType'],
                    }))}
                  >
                    <option value="curved">Curved</option>
                    <option value="straight">Straight</option>
                    <option value="elbow">Elbow</option>
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">Font Scale</span>
                  <select
                    className="h-10 w-full rounded-lg border border-input bg-background px-3"
                    value={options.fontScale}
                    onChange={(e) => setOptions((prev) => ({
                      ...prev,
                      fontScale: e.target.value as MindmapBuildOptions['fontScale'],
                    }))}
                  >
                    <option value="normal">Normal</option>
                    <option value="fibonacci">Fibonacci</option>
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">Font Family</span>
                  <select
                    className="h-10 w-full rounded-lg border border-input bg-background px-3"
                    value={options.fontFamily}
                    onChange={(e) => setOptions((prev) => ({
                      ...prev,
                      fontFamily: e.target.value as MindmapBuildOptions['fontFamily'],
                    }))}
                  >
                    <option value="helvetica">Helvetica</option>
                    <option value="excalidraw">Excalidraw Script</option>
                    <option value="cascadia">Cascadia</option>
                    <option value="virgil">Virgil</option>
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">Max Heading Depth</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={options.maxDepth}
                    onChange={(e) => setOptions((prev) => ({
                      ...prev,
                      maxDepth: Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                    }))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3"
                  />
                </label>

                <label className="space-y-1 text-sm md:col-span-2">
                  <span className="font-medium">Wrap Width (px, 10000 = infinite)</span>
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    value={options.maxWrapWidth}
                    onChange={(e) => setOptions((prev) => ({
                      ...prev,
                      maxWrapWidth: Math.max(100, Math.min(10000, Number(e.target.value) || 10000)),
                    }))}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                  <span className="text-sm">Include full section text</span>
                  <Switch checked={options.includeFullText} onCheckedChange={() => toggleOption('includeFullText')} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                  <span className="text-sm">Fill radial sweep</span>
                  <Switch checked={options.fillSweep} onCheckedChange={() => toggleOption('fillSweep')} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                  <span className="text-sm">Center text in nodes</span>
                  <Switch checked={options.centerText} onCheckedChange={() => toggleOption('centerText')} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                  <span className="text-sm">Multicolor branches</span>
                  <Switch checked={options.multicolorBranches} onCheckedChange={() => toggleOption('multicolorBranches')} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                  <span className="text-sm">Box nodes</span>
                  <Switch checked={options.boxNodes} onCheckedChange={() => toggleOption('boxNodes')} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                  <span className="text-sm">Rounded corners</span>
                  <Switch checked={options.roundedCorners} onCheckedChange={() => toggleOption('roundedCorners')} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Output</CardTitle>
              <CardDescription>
                Save generated mindmap as an Excalidraw markdown file.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="Output path"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              />
              <Button onClick={handleSave} disabled={!selectedFile || saving || loadingPreview}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Excalidraw Mindmap
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>
                {statsLine ?? 'Choose a markdown source to build preview.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="relative">
              {preview && (
                <div className={`h-[70vh] transition-opacity ${loadingPreview ? 'opacity-60' : 'opacity-100'}`}>
                  <ExcalidrawDocumentBlock content={preview.sceneMarkdown} className="h-full" />
                </div>
              )}
              {loadingPreview && (
                <div className={`absolute inset-0 flex items-center justify-center text-muted-foreground ${preview ? 'bg-background/50 backdrop-blur-[1px]' : ''}`}>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Building mindmap preview...
                </div>
              )}
              {!loadingPreview && !preview && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No preview available.
                </div>
              )}
              {preview && preview.nodeCount >= 800 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Large scene detected. Preview keeps the previous canvas mounted while regenerating to reduce visual jank.
                </p>
              )}
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-500/45 bg-red-50 dark:bg-red-500/20 p-4 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {message && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/45 bg-emerald-50 dark:bg-emerald-500/20 p-4 text-sm text-emerald-700 dark:text-emerald-300">
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
