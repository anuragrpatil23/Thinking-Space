import { useState, useEffect } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/lego_blocks/units/ui/card'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import { FileText, Check, Loader2 } from 'lucide-react'
import SearchDropdown from '@/components/lego_blocks/integrations/SearchDropdownBlock'
import { invokeCapabilityOrThrow } from '@/services/orchestrators/capabilityRouterOrch'
import type { FormatOptions, FormatPreviewData, FormatResult } from '@/services/lego_blocks/units/typesBlock'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'

const FORMAT_ACTOR: CapabilityActor = { kind: 'human', id: 'ui.tools.excalidraw' }

export default function FormatExcalidraw() {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [options, setOptions] = useState<FormatOptions>({
    normalize_book: true,
    strip_fences: true,
    split_long_paragraphs: false,
    join_lines: true,
  })
  const [preview, setPreview] = useState<FormatPreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [formatting, setFormatting] = useState(false)
  const [result, setResult] = useState<FormatResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load file list on mount
  useEffect(() => {
    invokeCapabilityOrThrow({
      capability: 'tools.files.list_markdown',
      input: {},
      actor: FORMAT_ACTOR,
    })
      .then(({ files }) => setFiles(files))
      .catch(err => setError(err.message))
  }, [])

  // Load preview when file or options change
  useEffect(() => {
    if (!selectedFile) {
      setPreview(null)
      return
    }

    setLoading(true)
    setResult(null)
    setError(null)

    invokeCapabilityOrThrow({
      capability: 'tools.excalidraw.preview',
      input: { inputPath: selectedFile, options },
      actor: FORMAT_ACTOR,
    })
      .then(({ preview }) => setPreview(preview))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [selectedFile, options])

  const handleFormat = async () => {
    if (!selectedFile) return

    setFormatting(true)
    setError(null)
    setResult(null)

    try {
      const { result } = await invokeCapabilityOrThrow({
        capability: 'tools.excalidraw.format',
        input: { inputPath: selectedFile, options },
        actor: FORMAT_ACTOR,
      })
      setResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setFormatting(false)
    }
  }

  const toggleOption = (key: keyof FormatOptions) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSelectFile = (file: string) => {
    setSelectedFile(file)
  }

  return (
    <div className="ltm-page">
      <div className="ltm-page-shell ltm-shell-narrow">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Format for Excalidraw
              </h1>
              <p className="text-muted-foreground">
                Transform markdown for mindmap import
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6">
          {/* File Selection with Search */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Select File</CardTitle>
              <CardDescription>
                Search and choose a markdown file from your vault
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <SearchDropdown
                  items={files}
                  selected={selectedFile}
                  onSelect={handleSelectFile}
                  placeholder="Search files..."
                />
              </div>

              {selectedFile && (
                <div className="mt-3 text-sm text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{selectedFile}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Options */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Normalize book structure</div>
                  <div className="text-sm text-muted-foreground">
                    Convert PART/CHAPTER patterns to markdown headings
                  </div>
                </div>
                <Switch
                  checked={options.normalize_book}
                  onCheckedChange={() => toggleOption('normalize_book')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Strip standalone code fences</div>
                  <div className="text-sm text-muted-foreground">
                    Remove orphaned ``` lines
                  </div>
                </div>
                <Switch
                  checked={options.strip_fences}
                  onCheckedChange={() => toggleOption('strip_fences')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Join wrapped lines</div>
                  <div className="text-sm text-muted-foreground">
                    Merge lines within paragraphs
                  </div>
                </div>
                <Switch
                  checked={options.join_lines}
                  onCheckedChange={() => toggleOption('join_lines')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Split long paragraphs</div>
                  <div className="text-sm text-muted-foreground">
                    Break long content into multiple bullets
                  </div>
                </div>
                <Switch
                  checked={options.split_long_paragraphs}
                  onCheckedChange={() => toggleOption('split_long_paragraphs')}
                />
              </div>
            </CardContent>
          </Card>

          {/* Preview */}
          {selectedFile && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preview</CardTitle>
                {preview && (
                  <CardDescription>
                    {preview.original_lines} lines → {preview.formatted_lines} lines
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Loading preview...
                  </div>
                ) : preview ? (
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        Original
                      </div>
                      <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                        {preview.original}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        Formatted
                      </div>
                      <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                        {preview.formatted}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Select a file to preview
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-500/20 border border-red-200 dark:border-red-500/45 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Success */}
          {result?.success && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-500/20 border border-green-200 dark:border-green-500/45 text-green-700 dark:text-green-300 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4" />
                File formatted successfully
              </div>
              <div className="mt-2 text-green-600 dark:text-green-400">
                Saved to: <span className="font-mono">{result.output_path}</span>
              </div>
            </div>
          )}

          {/* Action */}
          <Button
            size="lg"
            className="w-full"
            onClick={handleFormat}
            disabled={!selectedFile || formatting}
          >
            {formatting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Formatting...
              </>
            ) : (
              'Format & Save'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
