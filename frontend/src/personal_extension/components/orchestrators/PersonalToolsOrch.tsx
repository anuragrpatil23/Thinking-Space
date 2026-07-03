import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, RefreshCw, Save } from 'lucide-react'
import UniversalSearchBlock from '@/components/lego_blocks/integrations/UniversalSearchBlock'
import {
  UNIVERSAL_SEARCH_DROPDOWN_PRESET_BLOCK,
  buildPathSearchCandidatesBlock,
} from '@/components/lego_blocks/integrations/universalSearchPresetBlock'
import { copyTextToClipboard } from '@/components/lego_blocks/units/BacklogListDomainBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/lego_blocks/units/ui/select'
import { useMarkdownViewer } from '@/components/orchestrators/MarkdownViewerOrch'
import {
  deleteHeadingAssignmentPresetOrch,
  listHeadingAssignmentFileOptionsOrch,
  loadHeadingAssignmentPresetsOrch,
  readHeadingAssignmentDocumentOrch,
  saveHeadingAssignmentPresetOrch,
  saveHeadingAssignmentExportOrch,
  type HeadingAssignmentFileOptionOrch,
} from '../../services/orchestrators/headingAssignmentOrch'
import {
  buildHeadingAssignmentExportBlock,
  parseHeadingAssignmentValuesBlock,
  type HeadingAssignmentHeadingBlock,
  type HeadingAssignmentPresetBlock,
} from '../../services/lego_blocks/units/headingAssignmentBlock'

type PersonalToolId = 'heading-assignments'

const TOOL_ITEMS: Array<{
  id: PersonalToolId
  label: string
  description: string
}> = [
  {
    id: 'heading-assignments',
    label: 'Heading Assignments',
    description: 'Map markdown headings to your own dropdown values and export the result.',
  },
]

const fieldClassName = 'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
const textareaClassName = 'flex min-h-[132px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
const ASSIGNMENT_EMPTY_VALUE = '__unassigned__'
const DEFAULT_EXPORT_FILE_NAME = 'heading-assignment.txt'

function sameStringArrayBlock(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameAssignmentsBlock(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left[key] === right[key])
}

function getParentFolderPathBlock(filePath: string): string {
  const normalizedPath = filePath
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  if (!normalizedPath) return ''

  const lastSlashIndex = normalizedPath.lastIndexOf('/')
  return lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : ''
}

export default function PersonalToolsOrch() {
  const { openFile } = useMarkdownViewer()
  const [fileOptions, setFileOptions] = useState<HeadingAssignmentFileOptionOrch[]>([])
  const [fileQuery, setFileQuery] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [headings, setHeadings] = useState<HeadingAssignmentHeadingBlock[]>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [dropdownValuesText, setDropdownValuesText] = useState('')
  const [presets, setPresets] = useState<HeadingAssignmentPresetBlock[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const [exportFileName, setExportFileName] = useState(DEFAULT_EXPORT_FILE_NAME)
  const [bootstrapLoading, setBootstrapLoading] = useState(true)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const activeTool = TOOL_ITEMS[0]
  const dropdownValues = useMemo(
    () => parseHeadingAssignmentValuesBlock(dropdownValuesText),
    [dropdownValuesText],
  )
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  )
  const selectedFileOption = useMemo(
    () => fileOptions.find((option) => option.path === selectedFilePath) ?? null,
    [fileOptions, selectedFilePath],
  )
  const outputText = useMemo(
    () => buildHeadingAssignmentExportBlock(headings, assignments),
    [assignments, headings],
  )
  const exportFolderPath = useMemo(
    () => getParentFolderPathBlock(selectedFilePath),
    [selectedFilePath],
  )

  const loadDocument = useCallback(async (path: string) => {
    const trimmedPath = path.trim()
    if (!trimmedPath) {
      setHeadings([])
      setAssignments({})
      setDocumentError(null)
      return
    }

    setDocumentLoading(true)
    setDocumentError(null)
    try {
      const document = await readHeadingAssignmentDocumentOrch(trimmedPath)
      setHeadings(document.headings)
      setAssignments((previous) => {
        const validHeadingIds = new Set(document.headings.map((heading) => heading.id))
        const nextEntries = Object.entries(previous)
          .filter(([headingId]) => validHeadingIds.has(headingId))
        const nextAssignments = Object.fromEntries(nextEntries)
        return sameAssignmentsBlock(previous, nextAssignments) ? previous : nextAssignments
      })
    } catch (error) {
      setHeadings([])
      setAssignments({})
      setDocumentError(error instanceof Error ? error.message : 'Failed to read the selected markdown file.')
    } finally {
      setDocumentLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setBootstrapLoading(true)
    void Promise.all([
      listHeadingAssignmentFileOptionsOrch(),
      loadHeadingAssignmentPresetsOrch(),
    ])
      .then(([nextFileOptions, nextPresets]) => {
        if (cancelled) return
        setFileOptions(nextFileOptions)
        setPresets(nextPresets)
        setBootstrapError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setBootstrapError(error instanceof Error ? error.message : 'Failed to load personal tools data.')
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void loadDocument(selectedFilePath)
  }, [loadDocument, selectedFilePath])

  useEffect(() => {
    const allowedHeadingIds = new Set(headings.map((heading) => heading.id))
    const allowedValues = new Set(dropdownValues)
    setAssignments((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(([headingId, value]) => allowedHeadingIds.has(headingId) && allowedValues.has(value)),
      )
      return sameAssignmentsBlock(previous, next) ? previous : next
    })
  }, [dropdownValues, headings])

  const handlePresetSelect = useCallback((presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = presets.find((candidate) => candidate.id === presetId)
    if (!preset) return
    setPresetName(preset.name)
    setDropdownValuesText(preset.values.join('\n'))
    setFeedback(`Loaded preset “${preset.name}”.`)
    setActionError(null)
  }, [presets])

  const handleSavePreset = useCallback(async () => {
    setFeedback(null)
    setActionError(null)
    try {
      const result = await saveHeadingAssignmentPresetOrch({
        id: selectedPresetId || undefined,
        name: presetName,
        values: dropdownValues,
      })
      setPresets(result.presets)
      setSelectedPresetId(result.preset.id)
      setPresetName(result.preset.name)
      setDropdownValuesText(result.preset.values.join('\n'))
      setFeedback(`Saved preset “${result.preset.name}” to the vault.`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to save preset.')
    }
  }, [dropdownValues, presetName, selectedPresetId])

  const handleDeletePreset = useCallback(async () => {
    if (!selectedPreset) {
      setActionError('Select a saved preset before deleting.')
      setFeedback(null)
      return
    }
    setFeedback(null)
    setActionError(null)
    try {
      const nextPresets = await deleteHeadingAssignmentPresetOrch(selectedPreset.id)
      setPresets(nextPresets)
      setSelectedPresetId('')
      setPresetName('')
      setFeedback(`Deleted preset “${selectedPreset.name}”.`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to delete preset.')
    }
  }, [selectedPreset])

  const handleAssignmentChange = useCallback((headingId: string, value: string) => {
    setAssignments((previous) => {
      const next = { ...previous }
      if (value === ASSIGNMENT_EMPTY_VALUE) {
        delete next[headingId]
      } else {
        next[headingId] = value
      }
      return next
    })
  }, [])

  const handleCopyOutput = useCallback(async () => {
    setFeedback(null)
    setActionError(null)
    try {
      await copyTextToClipboard(outputText)
      setFeedback('Copied the heading assignment export to the clipboard.')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to copy the export.')
    }
  }, [outputText])

  const handleSaveOutput = useCallback(async () => {
    setFeedback(null)
    setActionError(null)
    try {
      const outputPath = await saveHeadingAssignmentExportOrch({
        targetFolderPath: exportFolderPath,
        fileName: exportFileName,
        content: outputText,
      })
      setFeedback(`Saved the heading assignment export to ${outputPath}.`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to save the heading assignment export.')
    }
  }, [exportFileName, exportFolderPath, outputText])

  const handleReloadFileOptions = useCallback(async () => {
    setFeedback(null)
    setActionError(null)
    try {
      const nextOptions = await listHeadingAssignmentFileOptionsOrch()
      setFileOptions((previous) => sameStringArrayBlock(
        previous.map(option => option.path),
        nextOptions.map(option => option.path),
      ) ? previous : nextOptions)
      if (selectedFilePath && !nextOptions.some((option) => option.path === selectedFilePath)) {
        setSelectedFilePath('')
        setFileQuery('')
      }
      setFeedback('Refreshed the markdown file list from the vault.')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to refresh the markdown file list.')
    }
  }, [selectedFilePath])

  const handleFileSelect = useCallback((option: HeadingAssignmentFileOptionOrch) => {
    setSelectedFilePath(option.path)
    setFileQuery(option.label)
    setFeedback(`Selected ${option.label}.`)
    setActionError(null)
  }, [])

  return (
    <div className="ltm-page-shell ltm-shell-ultra">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          {activeTool.label}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {activeTool.description}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{activeTool.label}</CardTitle>
            <CardDescription>
              Pick a markdown file with universal search, assign one dropdown value to each heading, then copy or save the pipe-delimited export.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Markdown file
              </div>
              <UniversalSearchBlock<HeadingAssignmentFileOptionOrch>
                {...UNIVERSAL_SEARCH_DROPDOWN_PRESET_BLOCK}
                items={fileOptions}
                query={fileQuery}
                onQueryChange={setFileQuery}
                onSelect={handleFileSelect}
                getItemKey={(item) => item.path}
                getItemLabel={(item) => item.label}
                getItemDescription={(item) => item.path}
                getItemSearchCandidates={(item) => [
                  item.label,
                  item.path,
                  ...buildPathSearchCandidatesBlock(item.path),
                ]}
                selectedItemKey={selectedFilePath || null}
                placeholder={bootstrapLoading ? 'Loading markdown files…' : 'Search vault files by name or path'}
                emptyMessage="No markdown files match this search."
                inputWrapperClassName="relative"
                inputClassName="h-10 border border-slate-200 bg-white pl-10 pr-4 text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-border dark:bg-background dark:text-foreground"
                dropdownClassName="z-50 mt-1"
                listClassName="max-h-64 overflow-auto p-1"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleReloadFileOptions}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh files
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => openFile(selectedFilePath, { mode: 'edit' })}
                disabled={!selectedFilePath}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Open file
              </Button>
            </div>

            <div className="rounded-md border border-border/60 bg-background px-3 py-3 text-sm">
              <div className="font-medium text-foreground">
                {selectedFileOption ? selectedFileOption.label : 'No file selected yet'}
              </div>
              <div className="mt-1 text-muted-foreground">
                {selectedFileOption
                  ? `${headings.length} headings loaded from ${selectedFileOption.path}`
                  : `${fileOptions.length} markdown files available in the vault`}
              </div>
            </div>

            {documentLoading && <p className="text-xs text-muted-foreground">Reading headings from the selected file…</p>}
            {bootstrapError && <p className="text-sm text-red-600 dark:text-red-400">{bootstrapError}</p>}
            {documentError && <p className="text-sm text-red-600 dark:text-red-400">{documentError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dropdown values</CardTitle>
            <CardDescription>
              Save reusable value sets in the vault so they sync with the rest of your personal data.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Saved dropdown set
                </label>
                <Select value={selectedPresetId || undefined} onValueChange={handlePresetSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a saved set from the vault" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.length > 0
                      ? presets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.name}
                        </SelectItem>
                      ))
                      : (
                        <SelectItem value="__no-presets__" disabled>
                          No saved sets yet
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Preset name
                </label>
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Example: Priority labels"
                  className={fieldClassName}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Dropdown values
                </label>
                <textarea
                  value={dropdownValuesText}
                  onChange={(event) => setDropdownValuesText(event.target.value)}
                  placeholder={'One value per line\nHigh\nMedium\nLow'}
                  className={textareaClassName}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                One exact selectable value per line. Lines are preserved as entered and written to the vault for reuse.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSavePreset} disabled={dropdownValues.length === 0}>
                  <Save className="mr-2 h-4 w-4" />
                  Save set
                </Button>
                <Button type="button" variant="outline" onClick={handleDeletePreset} disabled={!selectedPresetId}>
                  Delete set
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {dropdownValues.length} dropdown values ready for assignment
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Heading assignments</CardTitle>
            <CardDescription>
              Each markdown heading from the selected file gets one dropdown selector.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedFilePath.length === 0 && (
              <p className="text-sm text-muted-foreground">Select a markdown file to load its headings.</p>
            )}
            {selectedFilePath.length > 0 && !documentLoading && headings.length === 0 && !documentError && (
              <p className="text-sm text-muted-foreground">No markdown headings were found in the selected file.</p>
            )}
            {headings.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border/60 bg-white dark:bg-background">
                <table className="w-full min-w-[840px] table-fixed text-left text-sm">
                  <thead className="border-b border-border/50 bg-muted/20 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Heading</th>
                      <th className="w-[280px] px-3 py-2 font-medium">Assigned Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headings.map((heading, index) => {
                      const assignedValue = assignments[heading.id] ?? ''
                      const assigned = assignedValue.length > 0
                      const rowBorderClassName = index > 0 ? 'border-t border-slate-200' : ''
                      return (
                        <tr key={heading.id}>
                          <td className={`px-3 py-3 align-top text-foreground ${rowBorderClassName}`}>
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {assigned && (
                                <span className="rounded-full bg-emerald-100 dark:bg-emerald-500/30 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                                  Assigned
                                </span>
                              )}
                            </div>
                            <div
                              className="break-words font-medium leading-6"
                              style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 14}px` }}
                            >
                              {heading.title}
                            </div>
                          </td>
                          <td className={`px-3 py-3 align-top ${rowBorderClassName}`}>
                            <Select
                              value={assignments[heading.id] ?? ASSIGNMENT_EMPTY_VALUE}
                              onValueChange={(value) => handleAssignmentChange(heading.id, value)}
                              disabled={dropdownValues.length === 0}
                            >
                              <SelectTrigger className={assigned ? 'border-emerald-300 dark:border-emerald-500/55 bg-white shadow-sm focus:ring-emerald-500 dark:bg-background' : 'border-slate-200 bg-white shadow-sm dark:border-border dark:bg-background'}>
                                <SelectValue placeholder={dropdownValues.length === 0 ? 'Add values first' : 'Choose a value'} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={ASSIGNMENT_EMPTY_VALUE}>Unassigned</SelectItem>
                                {dropdownValues.map((value, index) => (
                                  <SelectItem key={`${heading.id}-${index}-${value}`} value={value}>
                                    {value}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
            <CardDescription>
              Output format: one line per heading as <code>Heading|Assigned Value</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(feedback || actionError) && (
              <p className={`text-sm ${actionError ? 'text-red-600' : 'text-emerald-700'}`}>
                {actionError ?? feedback}
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Save folder
                </label>
                <input
                  readOnly
                  value={exportFolderPath}
                  placeholder="Select a markdown file to use its folder"
                  className={`${fieldClassName} bg-muted/30 text-muted-foreground`}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  File name
                </label>
                <input
                  value={exportFileName}
                  onChange={(event) => setExportFileName(event.target.value)}
                  placeholder={DEFAULT_EXPORT_FILE_NAME}
                  className={fieldClassName}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {exportFolderPath
                ? `Saves to ${exportFolderPath}/${exportFileName.trim() || DEFAULT_EXPORT_FILE_NAME}`
                : 'Select a markdown file to choose the save location automatically.'}
            </p>
            <textarea
              readOnly
              value={outputText}
              className={`${textareaClassName} min-h-[360px] font-mono text-xs`}
              placeholder="Your heading export will appear here."
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleCopyOutput} disabled={headings.length === 0}>
                Copy export
              </Button>
              <Button type="button" variant="outline" onClick={handleSaveOutput} disabled={headings.length === 0 || !selectedFilePath}>
                <Save className="mr-2 h-4 w-4" />
                Save txt
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadDocument(selectedFilePath)}
                disabled={!selectedFilePath}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh headings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
