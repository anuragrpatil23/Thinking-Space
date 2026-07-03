import { useState, useEffect } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/lego_blocks/units/ui/card'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import { FileType, Check, Loader2 } from 'lucide-react'
import SearchDropdown from '@/components/lego_blocks/integrations/SearchDropdownBlock'
import { invokeCapabilityOrThrow } from '@/services/orchestrators/capabilityRouterOrch'
import type { ConvertOptions, PdfPreviewData, PdfConvertResult } from '@/services/lego_blocks/units/typesBlock'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'

const PDF_ACTOR: CapabilityActor = { kind: 'human', id: 'ui.tools.pdf' }

export default function PdfToMarkdown() {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [options, setOptions] = useState<ConvertOptions>({
    preserve_layout: true,
    page_breaks: true,
  })
  const [preview, setPreview] = useState<PdfPreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<PdfConvertResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load file list on mount
  useEffect(() => {
    invokeCapabilityOrThrow({
      capability: 'tools.files.list_pdf',
      input: { limit: 500 },
      actor: PDF_ACTOR,
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
      capability: 'tools.pdf.preview',
      input: { inputPath: selectedFile, options },
      actor: PDF_ACTOR,
    })
      .then(({ preview }) => setPreview(preview))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [selectedFile, options])

  const handleConvert = async () => {
    if (!selectedFile) return

    setConverting(true)
    setError(null)
    setResult(null)

    try {
      const { result } = await invokeCapabilityOrThrow({
        capability: 'tools.pdf.convert',
        input: { inputPath: selectedFile, options },
        actor: PDF_ACTOR,
      })
      setResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setConverting(false)
    }
  }

  const toggleOption = (key: keyof ConvertOptions) => {
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
              <FileType className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                PDF to Markdown
              </h1>
              <p className="text-muted-foreground">
                Convert PDF files to markdown format
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6">
          {/* File Selection with Search */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Select PDF</CardTitle>
              <CardDescription>
                Search and choose a PDF file from your vault
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SearchDropdown
                items={files}
                selected={selectedFile}
                onSelect={handleSelectFile}
                placeholder="Search PDF files..."
                emptyMessage="No PDF files found"
                getSearchCandidates={(filePath) => {
                  const baseName = filePath.split('/').pop() ?? filePath
                  return [baseName, filePath]
                }}
              />

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
                  <div className="font-medium text-sm">Preserve layout</div>
                  <div className="text-sm text-muted-foreground">
                    Try to maintain the original text layout
                  </div>
                </div>
                <Switch
                  checked={options.preserve_layout}
                  onCheckedChange={() => toggleOption('preserve_layout')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">Page breaks</div>
                  <div className="text-sm text-muted-foreground">
                    Add horizontal rules between pages
                  </div>
                </div>
                <Switch
                  checked={options.page_breaks}
                  onCheckedChange={() => toggleOption('page_breaks')}
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
                    {preview.page_count} pages, {preview.total_chars.toLocaleString()} characters
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Converting PDF...
                  </div>
                ) : preview ? (
                  <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                    {preview.preview}
                  </pre>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Select a PDF to preview
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
                Converted {result.page_count} pages to markdown
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
            onClick={handleConvert}
            disabled={!selectedFile || converting}
          >
            {converting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Converting...
              </>
            ) : (
              'Convert & Save'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
