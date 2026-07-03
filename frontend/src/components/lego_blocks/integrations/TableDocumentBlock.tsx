import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import * as Toolbar from '@radix-ui/react-toolbar'
import {
  DataSheetGrid,
  type DataSheetGridRef,
  keyColumn,
  textColumn,
} from 'react-datasheet-grid'
import 'react-datasheet-grid/dist/style.css'
import { ExternalLink, FileSpreadsheet, FolderOpen, Pencil, Plus, Save, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ContextMenuBlock, { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import GoogleWorkspaceViewerBlock from '@/components/lego_blocks/integrations/GoogleWorkspaceViewerBlock'
import type {
  TableCellAlign,
  TableCellFormatBlock,
  TableDocumentBlock as TableDocumentModelBlock,
  TableSheetBlock,
} from '@/services/lego_blocks/units/tableDocumentSchemaBlock'
import {
  TableDocumentConflictError,
  readTableDocument,
  saveTableDocument,
} from '@/services/orchestrators/tableDocumentsOrch'
import {
  getOpenInSystemLabelOrch,
  openExternalUrlOrch,
  openVaultPathInSystemOrch,
  renameVaultPathOrch,
} from '@/services/orchestrators/fileSystemOrch'
import { resolveGoogleSheetOpenUrlBlock } from '@/services/lego_blocks/units/googleSheetTableCodecBlock'
import {
  readGoogleDriveAuthOrch,
  type GoogleDriveAuthStateOrch,
} from '@/services/orchestrators/googleDriveAuthOrch'
import {
  listGoogleDriveSheetsOrch,
  type GoogleDriveFilePickerItemOrch,
} from '@/services/orchestrators/googleDrivePickerOrch'
import { isGoogleDriveVaultOrch } from '@/services/orchestrators/googleDriveVaultOrch'

type ViewerMode = 'view' | 'edit'
type GridRowBlock = Record<string, string | null>

interface TableDocumentBlockProps {
  path: string
  initialMode?: ViewerMode
  onSaved?: (result: { output_path: string; revision_path: string | null }) => void
  onOpenPath?: (path: string) => void
  onOpenPathForEdit?: (path: string) => void
  onClose?: () => void
  showCloseButton?: boolean
  className?: string
}

interface GridCellWithIdBlock {
  col: number
  row: number
}

interface GridSelectionWithIdBlock {
  min: GridCellWithIdBlock
  max: GridCellWithIdBlock
}

interface SelectionRangeBlock {
  start: GridCellWithIdBlock
  end: GridCellWithIdBlock
}

function TableDocumentBlock({
  path,
  initialMode = 'view',
  onSaved,
  onOpenPath,
  onOpenPathForEdit,
  onClose,
  showCloseButton = false,
  className,
}: TableDocumentBlockProps) {
  const [mode, setMode] = useState<ViewerMode>(initialMode)
  const [document, setDocument] = useState<TableDocumentModelBlock | null>(null)
  const [draft, setDraft] = useState<TableDocumentModelBlock | null>(null)
  const [baseMtime, setBaseMtime] = useState<number | null>(null)
  const [baseHash, setBaseHash] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [openInSystemError, setOpenInSystemError] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [isHeaderRenameActive, setIsHeaderRenameActive] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [conflict, setConflict] = useState<TableDocumentConflictError | null>(null)
  const [activeCell, setActiveCell] = useState<GridCellWithIdBlock | null>(null)
  const [selection, setSelection] = useState<GridSelectionWithIdBlock | null>(null)
  const [googleAuth, setGoogleAuth] = useState<GoogleDriveAuthStateOrch | null>(() => readGoogleDriveAuthOrch())
  const [googlePickerOpen, setGooglePickerOpen] = useState(false)
  const [googlePickerQuery, setGooglePickerQuery] = useState('')
  const [googlePickerItems, setGooglePickerItems] = useState<GoogleDriveFilePickerItemOrch[]>([])
  const [googlePickerLoading, setGooglePickerLoading] = useState(false)
  const [googlePickerError, setGooglePickerError] = useState<string | null>(null)
  const [showGoogleAdvancedFields, setShowGoogleAdvancedFields] = useState(false)
  const [columnContextMenu, setColumnContextMenu] = useState<{ x: number; y: number; col: number } | null>(null)
  const headerRenameInputRef = useRef<HTMLInputElement | null>(null)
  const gridRootRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<DataSheetGridRef | null>(null)
  const pendingColumnRevealRef = useRef<{ row: number; col: number } | null>(null)
  const scopeId = useId()

  const gridScopeClass = useMemo(() => {
    const suffix = scopeId.replace(/[^a-zA-Z0-9_-]/g, '')
    return `table-document-grid-${suffix}`
  }, [scopeId])

  const loadDocument = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSaveError(null)
    setConflict(null)
    setSuccessMessage(null)
    try {
      const result = await readTableDocument(path)
      setDocument(result.document)
      setDraft(result.document)
      setBaseMtime(result.mtime)
      setBaseHash(result.hash)
      setActiveCell({ row: 0, col: 0 })
      setSelection({ min: { row: 0, col: 0 }, max: { row: 0, col: 0 } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load table')
      setDocument(null)
      setDraft(null)
      setBaseMtime(null)
      setBaseHash(null)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    setMode(initialMode)
    void loadDocument()
  }, [initialMode, loadDocument, path])

  const activeSheet = useMemo(() => {
    if (!draft) return null
    return draft.sheets.find(sheet => sheet.id === draft.activeSheetId) ?? draft.sheets[0] ?? null
  }, [draft])

  const isEditing = mode === 'edit'

  const hasChanges = useMemo(() => {
    if (!draft || !document) return false
    return JSON.stringify(draft) !== JSON.stringify(document)
  }, [draft, document])

  const filename = path.split('/').pop() || path
  const breadcrumb = path.split('/').slice(0, -1).join(' / ')
  const canRenameInHeader = !!(onOpenPathForEdit || onOpenPath)
  const openInSystemLabel = getOpenInSystemLabelOrch()
  const canOpenInSystem = openInSystemLabel !== null
  const openInSystemButtonLabel = openInSystemLabel ?? 'System'
  const hasGoogleConnection = Boolean(googleAuth?.accessToken)
  const isGoogleDriveVault = useMemo(() => isGoogleDriveVaultOrch(), [])
  const activeGoogleDescriptor = (isEditing ? draft : document)?.google
  const googleSheetOpenUrl = useMemo(
    () => resolveGoogleSheetOpenUrlBlock(activeGoogleDescriptor),
    [activeGoogleDescriptor],
  )
  const isGoogleSheetDocument = (isEditing ? draft : document)?.kind === 'gsheet'
  const canOpenGoogleSheet = Boolean(googleSheetOpenUrl) || canOpenInSystem

  useEffect(() => {
    setRenameDraft(filename)
    setRenameError(null)
    setRenaming(false)
    setIsHeaderRenameActive(false)
  }, [filename])

  useEffect(() => {
    if (isEditing) return
    setIsHeaderRenameActive(false)
  }, [isEditing])

  useEffect(() => {
    if (!isHeaderRenameActive) return
    const input = headerRenameInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [isHeaderRenameActive])

  useEffect(() => {
    if (!isEditing) {
      setGooglePickerOpen(false)
      setGooglePickerQuery('')
      setGooglePickerError(null)
      setShowGoogleAdvancedFields(false)
    }
  }, [isEditing])

  useEffect(() => {
    if (columnContextMenu && (!isEditing || !activeSheet)) {
      setColumnContextMenu(null)
    }
  }, [activeSheet, columnContextMenu, isEditing])

  useEffect(() => {
    if (!isEditing || draft?.kind !== 'gsheet') return
    setGoogleAuth(readGoogleDriveAuthOrch())
  }, [draft?.kind, isEditing])

  const loadGoogleSheetsPicker = useCallback(async (query: string) => {
    setGooglePickerLoading(true)
    setGooglePickerError(null)
    try {
      const items = await listGoogleDriveSheetsOrch({
        query,
        pageSize: 24,
      })
      setGooglePickerItems(items)
    } catch (err) {
      setGooglePickerItems([])
      setGooglePickerError(err instanceof Error ? err.message : 'Failed to load Google Sheets from Drive')
    } finally {
      setGooglePickerLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!googlePickerOpen || !isEditing || !hasGoogleConnection || draft?.kind !== 'gsheet') return
    const handle = window.setTimeout(() => {
      void loadGoogleSheetsPicker(googlePickerQuery.trim())
    }, 220)
    return () => {
      window.clearTimeout(handle)
    }
  }, [draft?.kind, googlePickerOpen, googlePickerQuery, hasGoogleConnection, isEditing, loadGoogleSheetsPicker])

  const commitHeaderRename = useCallback(async () => {
    if (!isEditing || !canRenameInHeader || renaming) return
    const nextName = renameDraft.trim()
    if (!nextName || nextName === filename) {
      setRenameDraft(filename)
      setIsHeaderRenameActive(false)
      return
    }
    setRenaming(true)
    setRenameError(null)
    try {
      const nextPath = await renameVaultPathOrch(path, nextName)
      setRenameDraft(nextPath.split('/').pop() || nextPath)
      setIsHeaderRenameActive(false)
      if (onOpenPathForEdit) onOpenPathForEdit(nextPath)
      else if (onOpenPath) onOpenPath(nextPath)
    } catch (err) {
      setRenameDraft(filename)
      setRenameError(err instanceof Error ? err.message : 'Failed to rename file')
    } finally {
      setRenaming(false)
    }
  }, [canRenameInHeader, filename, isEditing, onOpenPath, onOpenPathForEdit, path, renameDraft, renaming])

  const startHeaderRename = useCallback(() => {
    if (!isEditing || !canRenameInHeader || renaming) return
    setRenameDraft(filename)
    setRenameError(null)
    setIsHeaderRenameActive(true)
  }, [canRenameInHeader, filename, isEditing, renaming])

  const handleOpenInSystem = useCallback(() => {
    if (!canOpenInSystem) return
    setOpenInSystemError(null)
    void openVaultPathInSystemOrch(path).catch((err) => {
      setOpenInSystemError(err instanceof Error ? err.message : 'Failed to open file in system file manager')
    })
  }, [canOpenInSystem, path])

  const handleOpenGoogleSheet = useCallback(() => {
    setOpenInSystemError(null)
    if (googleSheetOpenUrl) {
      void openExternalUrlOrch(googleSheetOpenUrl).catch((err) => {
        setOpenInSystemError(err instanceof Error ? err.message : 'Failed to open Google Sheets')
      })
      return
    }
    if (!canOpenInSystem) return
    void openVaultPathInSystemOrch(path).catch((err) => {
      setOpenInSystemError(err instanceof Error ? err.message : 'Failed to open file in system file manager')
    })
  }, [canOpenInSystem, googleSheetOpenUrl, path])

  const columnCount = useMemo(() => {
    if (!activeSheet) return 1
    return Math.max(1, activeSheet.rows.reduce((max, row) => Math.max(max, row.length), 1))
  }, [activeSheet])

  const activeSheetRows = useMemo(() => {
    if (!activeSheet) return [[{ value: '', format: undefined }]]
    return ensureTableRectBlock(activeSheet.rows, Math.max(1, activeSheet.rows.length), columnCount)
  }, [activeSheet, columnCount])

  const canPersistCellFormatting = draft?.kind === 'xlsx'

  const rowCount = activeSheetRows.length

  const selectedBounds = useMemo(() => {
    return resolveSelectionBoundsBlock(selection, activeCell, rowCount, columnCount)
  }, [activeCell, columnCount, rowCount, selection])

  const currentCell = useMemo(() => {
    return activeSheetRows[selectedBounds.start.row]?.[selectedBounds.start.col] ?? null
  }, [activeSheetRows, selectedBounds.start.col, selectedBounds.start.row])

  const currentFormat = currentCell?.format ?? {}

  const formattedCellCssText = useMemo(() => {
    const rules: string[] = []
    for (let rowIndex = 0; rowIndex < activeSheetRows.length; rowIndex++) {
      const row = activeSheetRows[rowIndex]
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const format = sanitizeFormatBlock(row[colIndex]?.format)
        if (!format) continue
        const declarations: string[] = []
        if (format.bold) declarations.push('font-weight: 700')
        if (format.italic) declarations.push('font-style: italic')
        if (format.underline) declarations.push('text-decoration: underline')
        if (format.align) declarations.push(`text-align: ${format.align}`)
        if (format.textColor) {
          const color = sanitizeCssColorBlock(format.textColor)
          if (color) declarations.push(`color: ${color}`)
        }
        if (format.backgroundColor) {
          const color = sanitizeCssColorBlock(format.backgroundColor)
          if (color) declarations.push(`background-color: ${color}`)
        }
        if (declarations.length === 0) continue
        rules.push(
          `.${gridScopeClass} .${formattedCellClassNameBlock(rowIndex, colIndex)} .dsg-input { ${declarations.join('; ')}; }`,
        )
      }
    }
    return rules.join('\n')
  }, [activeSheetRows, gridScopeClass])

  const gridRows = useMemo<GridRowBlock[]>(() => {
    return activeSheetRows.map((row) => {
      const out: GridRowBlock = {}
      for (let col = 0; col < columnCount; col++) {
        out[columnKeyBlock(col)] = row[col]?.value ?? ''
      }
      return out
    })
  }, [activeSheetRows, columnCount])

  const applyDraftChange = useCallback((updater: (current: TableDocumentModelBlock) => TableDocumentModelBlock) => {
    setDraft((current) => {
      if (!current) return current
      const next = updater(cloneDocumentBlock(current))
      setSuccessMessage(null)
      return next
    })
  }, [])

  const gridColumns = useMemo(() => {
    return Array.from({ length: columnCount }, (_, colIndex) => {
      const key = columnKeyBlock(colIndex)
      return {
        ...keyColumn(
          key,
          {
            ...textColumn,
            disabled: !isEditing,
          },
        ),
        id: key,
        title: (
          <div className="flex h-full w-full items-center" title={isEditing ? 'Right-click for column actions' : undefined}>
            {columnLabelBlock(colIndex)}
          </div>
        ),
        headerClassName: `ts-table-column-header ts-table-column-header-${colIndex}`,
        minWidth: 120,
      }
    })
  }, [columnCount, isEditing])

  const gridCellClassName = useCallback((opts: { rowIndex: number; columnId?: string }) => {
    const colIndex = columnIndexFromKeyBlock(opts.columnId)
    if (colIndex === null) return undefined
    const format = activeSheetRows[opts.rowIndex]?.[colIndex]?.format
    if (!sanitizeFormatBlock(format)) return undefined
    return formattedCellClassNameBlock(opts.rowIndex, colIndex)
  }, [activeSheetRows])

  const handleGridRowsChange = useCallback((rows: GridRowBlock[]) => {
    applyDraftChange((current) => mutateActiveSheetBlock(current, (sheet) => {
      const previousRows = ensureTableRectBlock(sheet.rows, Math.max(1, sheet.rows.length), columnCount)
      const normalizedRows = (rows.length > 0 ? rows : [createEmptyGridRowBlock(columnCount)]).map((gridRow, rowIndex) => {
        return Array.from({ length: columnCount }, (_, colIndex) => {
          const key = columnKeyBlock(colIndex)
          const previous = previousRows[rowIndex]?.[colIndex]
          return {
            value: String(gridRow[key] ?? ''),
            format: previous?.format ? { ...previous.format } : undefined,
          }
        })
      })
      return {
        ...sheet,
        rows: normalizedRows,
      }
    }))
  }, [applyDraftChange, columnCount])

  const applyFormatToSelection = useCallback((updater: (format: TableCellFormatBlock | undefined) => TableCellFormatBlock | undefined) => {
    if (!canPersistCellFormatting) return
    applyDraftChange((current) => mutateActiveSheetBlock(current, (sheet) => {
      const rows = ensureTableRectBlock(sheet.rows, selectedBounds.end.row + 1, selectedBounds.end.col + 1)
      for (let r = selectedBounds.start.row; r <= selectedBounds.end.row; r++) {
        for (let c = selectedBounds.start.col; c <= selectedBounds.end.col; c++) {
          const cell = rows[r][c]
          rows[r][c] = {
            ...cell,
            format: sanitizeFormatBlock(updater(cell.format)),
          }
        }
      }
      return { ...sheet, rows }
    }))
  }, [applyDraftChange, canPersistCellFormatting, selectedBounds.end.col, selectedBounds.end.row, selectedBounds.start.col, selectedBounds.start.row])

  const toggleBooleanFormat = useCallback((key: 'bold' | 'italic' | 'underline') => {
    applyFormatToSelection((format) => ({ ...format, [key]: !format?.[key] }))
  }, [applyFormatToSelection])

  const setAlignFormat = useCallback((align: TableCellAlign) => {
    applyFormatToSelection((format) => ({ ...format, align }))
  }, [applyFormatToSelection])

  const setColorFormat = useCallback((key: 'textColor' | 'backgroundColor', value: string) => {
    applyFormatToSelection((format) => ({ ...format, [key]: value }))
  }, [applyFormatToSelection])

  const setNumberFormat = useCallback((value: TableCellFormatBlock['numberFormat']) => {
    applyFormatToSelection((format) => ({ ...format, numberFormat: value }))
  }, [applyFormatToSelection])

  const setActiveSheetBlock = useCallback((sheetId: string) => {
    applyDraftChange((current) => ({
      ...current,
      activeSheetId: sheetId,
    }))
    setActiveCell({ row: 0, col: 0 })
    setSelection({ min: { row: 0, col: 0 }, max: { row: 0, col: 0 } })
  }, [applyDraftChange])

  const addSheet = useCallback(() => {
    applyDraftChange((current) => {
      const nextId = `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const nextSheet: TableSheetBlock = {
        id: nextId,
        name: `Sheet${current.sheets.length + 1}`,
        rows: [[{ value: '', format: undefined }]],
      }
      return {
        ...current,
        sheets: [...current.sheets, nextSheet],
        activeSheetId: nextId,
      }
    })
    setActiveCell({ row: 0, col: 0 })
    setSelection({ min: { row: 0, col: 0 }, max: { row: 0, col: 0 } })
  }, [applyDraftChange])

  const addRowsAndColumns = useCallback((rowCountToAdd: number, columnCountToAdd: number) => {
    const nextRowCount = Math.max(0, Math.round(rowCountToAdd))
    const nextColumnCount = Math.max(0, Math.round(columnCountToAdd))
    if (nextRowCount === 0 && nextColumnCount === 0) return

    const nextColumnTotal = columnCount + nextColumnCount
    const firstNewColumn = columnCount
    const lastNewColumn = Math.max(firstNewColumn, nextColumnTotal - 1)
    const focusColumn = nextColumnCount > 0
      ? lastNewColumn
      : clampBlock(activeCell?.col ?? selectedBounds.start.col, 0, Math.max(0, nextColumnTotal - 1))
    const focusRow = nextRowCount > 0
      ? rowCount
      : clampBlock(activeCell?.row ?? selectedBounds.start.row, 0, Math.max(0, rowCount - 1))
    applyDraftChange((current) => mutateActiveSheetBlock(current, (sheet) => {
      const rows = ensureTableRectBlock(sheet.rows, Math.max(1, sheet.rows.length), columnCount)
      const expandedRows = rows.map((row) => {
        if (nextColumnCount === 0) return row
        return [...row, ...createEmptyTableRowBlock(nextColumnCount)]
      })
      const appendedRows = Array.from({ length: nextRowCount }, () => createEmptyTableRowBlock(nextColumnTotal))
      return {
        ...sheet,
        rows: [...expandedRows, ...appendedRows],
      }
    }))
    setActiveCell({ row: focusRow, col: focusColumn })
    setSelection({
      min: { row: focusRow, col: nextColumnCount > 0 ? firstNewColumn : focusColumn },
      max: { row: focusRow, col: focusColumn },
    })
    pendingColumnRevealRef.current = nextColumnCount > 0
      ? { row: focusRow, col: focusColumn }
      : null
  }, [activeCell?.col, activeCell?.row, applyDraftChange, columnCount, rowCount, selectedBounds.start.col, selectedBounds.start.row])

  const deleteColumn = useCallback((colIndex: number) => {
    if (columnCount <= 1) return
    const nextFocusCol = clampBlock(colIndex > 0 ? colIndex - 1 : 0, 0, Math.max(0, columnCount - 2))
    const focusRow = clampBlock(activeCell?.row ?? selectedBounds.start.row, 0, Math.max(0, rowCount - 1))
    applyDraftChange((current) => mutateActiveSheetBlock(current, (sheet) => {
      const rows = ensureTableRectBlock(sheet.rows, Math.max(1, sheet.rows.length), columnCount)
      return {
        ...sheet,
        rows: rows.map((row) => row.filter((_, index) => index !== colIndex)),
      }
    }))
    setActiveCell({ row: focusRow, col: nextFocusCol })
    setSelection({
      min: { row: focusRow, col: nextFocusCol },
      max: { row: focusRow, col: nextFocusCol },
    })
    setColumnContextMenu(null)
  }, [activeCell?.row, applyDraftChange, columnCount, rowCount, selectedBounds.start.row])

  const updateGoogleMetadata = useCallback((key: 'spreadsheetId' | 'title' | 'openUrl' | 'sheetName' | 'range', value: string) => {
    applyDraftChange((current) => ({
      ...current,
      google: {
        kind: 'google_sheet',
        ...current.google,
        [key]: value,
      },
    }))
  }, [applyDraftChange])

  const handlePickGoogleSheet = useCallback((item: GoogleDriveFilePickerItemOrch) => {
    applyDraftChange((current) => ({
      ...current,
      google: {
        kind: 'google_sheet',
        ...current.google,
        spreadsheetId: item.id,
        title: item.name,
        openUrl: item.webViewLink || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(item.id)}/edit`,
      },
    }))
    setGooglePickerOpen(false)
    setGooglePickerQuery('')
    setGooglePickerError(null)
  }, [applyDraftChange])

  const handleSave = useCallback(async () => {
    if (!draft || baseMtime === null) return
    setSaving(true)
    setSaveError(null)
    setConflict(null)
    setSuccessMessage(null)
    try {
      const result = await saveTableDocument({
        path,
        document: draft,
        baseMtime,
        baseHash,
      })
      setDocument(cloneDocumentBlock(draft))
      setBaseMtime(result.mtime)
      setBaseHash(result.hash)
      setMode('view')
      setSuccessMessage('Saved.')
      onSaved?.(result)
    } catch (err) {
      if (err instanceof TableDocumentConflictError) {
        setConflict(err)
        setSaveError(err.message)
      } else {
        setSaveError(err instanceof Error ? err.message : 'Failed to save table')
      }
    } finally {
      setSaving(false)
    }
  }, [baseHash, baseMtime, draft, onSaved, path])

  const startEditing = useCallback(() => {
    if (!document) return
    setDraft(cloneDocumentBlock(document))
    setMode('edit')
    setSaveError(null)
    setSuccessMessage(null)
    setConflict(null)
  }, [document])

  const cancelEditing = useCallback(() => {
    setDraft(document ? cloneDocumentBlock(document) : null)
    setMode('view')
    setSaveError(null)
    setConflict(null)
    setSuccessMessage(null)
  }, [document])

  const loadLatestConflictVersion = useCallback(() => {
    if (!conflict) return
    const latest = cloneDocumentBlock(conflict.currentDocument)
    setDocument(latest)
    setDraft(latest)
    setBaseMtime(conflict.currentMtime)
    setBaseHash(conflict.currentHash)
    setSaveError(null)
    setConflict(null)
    setMode('edit')
  }, [conflict])

  const handleActiveCellChange = useCallback((cell: GridCellWithIdBlock | null) => {
    if (!cell) return
    const nextCell = {
      row: clampBlock(cell.row, 0, Math.max(0, rowCount - 1)),
      col: clampBlock(cell.col, 0, Math.max(0, columnCount - 1)),
    }
    setActiveCell(nextCell)
    if (!selection) {
      setSelection({ min: nextCell, max: nextCell })
    }
  }, [columnCount, rowCount, selection])

  const handleSelectionChange = useCallback((nextSelection: GridSelectionWithIdBlock | null) => {
    if (!nextSelection) return
    setSelection({
      min: {
        row: clampBlock(nextSelection.min.row, 0, Math.max(0, rowCount - 1)),
        col: clampBlock(nextSelection.min.col, 0, Math.max(0, columnCount - 1)),
      },
      max: {
        row: clampBlock(nextSelection.max.row, 0, Math.max(0, rowCount - 1)),
        col: clampBlock(nextSelection.max.col, 0, Math.max(0, columnCount - 1)),
      },
    })
  }, [columnCount, rowCount])

  const gridHeight = useMemo(() => {
    return Math.min(780, Math.max(320, gridRows.length * 36 + 84))
  }, [gridRows.length])

  const gridInstanceKey = useMemo(
    () => `${path}:${draft?.activeSheetId ?? 'sheet'}:${columnCount}:${rowCount}`,
    [columnCount, draft?.activeSheetId, path, rowCount],
  )

  useEffect(() => {
    const pendingReveal = pendingColumnRevealRef.current
    if (!pendingReveal) return
    pendingColumnRevealRef.current = null
    const run = () => {
      const container = gridRootRef.current?.querySelector('.dsg-container') as HTMLDivElement | null
      if (container) {
        container.scrollLeft = container.scrollWidth
      }
      gridRef.current?.setActiveCell({
        row: pendingReveal.row,
        col: pendingReveal.col,
      })
    }
    const frame1 = window.requestAnimationFrame(() => {
      const frame2 = window.requestAnimationFrame(run)
      pendingColumnRevealRef.current = null
      return frame2
    })
    return () => {
      window.cancelAnimationFrame(frame1)
    }
  }, [gridInstanceKey])

  useEffect(() => {
    const root = gridRootRef.current
    if (!root || !isEditing) return

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const headerCell = target.closest('.ts-table-column-header')
      if (!(headerCell instanceof HTMLElement)) return
      const className = Array.from(headerCell.classList).find((name) => name.startsWith('ts-table-column-header-'))
      if (!className) return
      const value = Number.parseInt(className.slice('ts-table-column-header-'.length), 10)
      if (!Number.isFinite(value)) return
      event.preventDefault()
      setColumnContextMenu({
        x: event.clientX,
        y: event.clientY,
        col: value,
      })
    }

    root.addEventListener('contextmenu', onContextMenu)
    return () => {
      root.removeEventListener('contextmenu', onContextMenu)
    }
  }, [isEditing])

  const columnContextMenuEntries = useMemo<ContextMenuEntryBlock[]>(() => {
    if (!columnContextMenu) return []
    const label = columnLabelBlock(columnContextMenu.col)
    return [
      {
        key: 'delete-column',
        label: `Delete column ${label}`,
        onClick: () => deleteColumn(columnContextMenu.col),
        disabled: !isEditing || columnCount <= 1,
        destructive: true,
      },
    ]
  }, [columnContextMenu, columnCount, deleteColumn, isEditing])

  return (
    <div className={cn(
      'flex h-full min-h-0 flex-col bg-card',
      isGoogleSheetDocument ? 'p-0' : 'p-2',
      className,
    )}>
      <div className="ts-doc-header border-b border-border/50 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex w-full min-w-0 items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              {isEditing && canRenameInHeader && isHeaderRenameActive ? (
                <input
                  ref={headerRenameInputRef}
                  type="text"
                  value={renameDraft}
                  onChange={(event) => {
                    setRenameDraft(event.target.value)
                    if (renameError) setRenameError(null)
                  }}
                  onBlur={() => { void commitHeaderRename() }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void commitHeaderRename()
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setRenameDraft(filename)
                      setRenameError(null)
                      setIsHeaderRenameActive(false)
                    }
                  }}
                  disabled={renaming || saving}
                  className="h-8 min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 text-sm font-medium shadow-none outline-none ring-0 focus:border-0 focus:bg-transparent focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:opacity-60"
                  aria-label="File name"
                />
              ) : isEditing && canRenameInHeader ? (
                <button
                  type="button"
                  onClick={startHeaderRename}
                  className="min-w-0 flex-1 truncate text-left font-medium"
                  title="Rename file"
                >
                  {filename}
                </button>
              ) : (
                <span className="truncate font-medium">{filename}</span>
              )}
            </div>
            {breadcrumb && <div className="mt-0.5 truncate text-xs text-muted-foreground">{breadcrumb}</div>}
            {renameError && <div className="mt-1 truncate text-xs text-destructive">{renameError}</div>}
            {openInSystemError && <div className="mt-1 truncate text-xs text-destructive">{openInSystemError}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isGoogleSheetDocument && (
              <button
                type="button"
                onClick={handleOpenGoogleSheet}
                disabled={!canOpenGoogleSheet}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                title={googleSheetOpenUrl
                  ? 'Open in Google Sheets'
                  : canOpenInSystem
                    ? `Open file in ${openInSystemButtonLabel}`
                    : 'Google Sheets link unavailable'}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Google Sheets</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenInSystem}
              disabled={!canOpenInSystem}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              title={canOpenInSystem ? `Open file in ${openInSystemButtonLabel}` : 'Open in system file manager is unavailable on web'}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{openInSystemButtonLabel}</span>
            </button>
            {!isEditing && (
              <button
                onClick={startEditing}
                disabled={loading || !!error || !document}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                title="Edit table"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {isEditing && (
              <>
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSave() }}
                  disabled={!hasChanges || saving || baseMtime === null}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
            {showCloseButton && onClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 transition-colors hover:bg-muted"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {isEditing && !isGoogleSheetDocument && (
        <Toolbar.Root
          aria-label="Table formatting toolbar"
          className="border-b border-border/40 bg-background px-5 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Toolbar.Button
              type="button"
              className={formatButtonClassBlock(!!currentFormat.bold)}
              onClick={() => toggleBooleanFormat('bold')}
              disabled={!canPersistCellFormatting}
            >
              B
            </Toolbar.Button>
            <Toolbar.Button
              type="button"
              className={formatButtonClassBlock(!!currentFormat.italic)}
              onClick={() => toggleBooleanFormat('italic')}
              disabled={!canPersistCellFormatting}
            >
              <i>I</i>
            </Toolbar.Button>
            <Toolbar.Button
              type="button"
              className={formatButtonClassBlock(!!currentFormat.underline)}
              onClick={() => toggleBooleanFormat('underline')}
              disabled={!canPersistCellFormatting}
            >
              <u>U</u>
            </Toolbar.Button>
            <Toolbar.Separator className="h-6 w-px bg-border/70" />
            <Toolbar.Button
              type="button"
              className={formatButtonClassBlock(currentFormat.align === 'left')}
              onClick={() => setAlignFormat('left')}
              disabled={!canPersistCellFormatting}
            >
              Left
            </Toolbar.Button>
            <Toolbar.Button
              type="button"
              className={formatButtonClassBlock(currentFormat.align === 'center')}
              onClick={() => setAlignFormat('center')}
              disabled={!canPersistCellFormatting}
            >
              Center
            </Toolbar.Button>
            <Toolbar.Button
              type="button"
              className={formatButtonClassBlock(currentFormat.align === 'right')}
              onClick={() => setAlignFormat('right')}
              disabled={!canPersistCellFormatting}
            >
              Right
            </Toolbar.Button>
            <Toolbar.Separator className="h-6 w-px bg-border/70" />
            <label className="inline-flex items-center gap-1 rounded border border-border/70 bg-background px-2 py-1 text-xs">
              Text
              <input
                type="color"
                value={normalizeColorForPickerBlock(currentFormat.textColor)}
                onChange={(event) => setColorFormat('textColor', event.target.value)}
                disabled={!canPersistCellFormatting}
              />
            </label>
            <label className="inline-flex items-center gap-1 rounded border border-border/70 bg-background px-2 py-1 text-xs">
              Fill
              <input
                type="color"
                value={normalizeColorForPickerBlock(currentFormat.backgroundColor, '#ffffff')}
                onChange={(event) => setColorFormat('backgroundColor', event.target.value)}
                disabled={!canPersistCellFormatting}
              />
            </label>
            <select
              className="rounded border border-border/70 bg-background px-2 py-1 text-xs disabled:opacity-50"
              value={currentFormat.numberFormat || 'general'}
              onChange={(event) => setNumberFormat(event.target.value as TableCellFormatBlock['numberFormat'])}
              disabled={!canPersistCellFormatting}
            >
              <option value="general">General</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="percent">Percent</option>
              <option value="date">Date</option>
              <option value="text">Text</option>
            </select>
          </div>
          {!canPersistCellFormatting && (
            <div className="mt-2 text-xs text-muted-foreground">
              Cell formatting is saved to XLSX files. CSV/TSV do not support persistent cell styles in Excel.
            </div>
          )}
        </Toolbar.Root>
      )}

      {!isGoogleSheetDocument && (
        <div className="border-b border-border/30 bg-background px-5 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {draft?.sheets.map((sheet) => (
              <button
                key={sheet.id}
                type="button"
                onClick={() => setActiveSheetBlock(sheet.id)}
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  draft.activeSheetId === sheet.id ? 'bg-primary text-primary-foreground' : 'border border-border/70 bg-background hover:bg-muted',
                )}
              >
                {sheet.name}
              </button>
            ))}
            {isEditing && (
              <button
                type="button"
                onClick={addSheet}
                className="inline-flex items-center gap-1 rounded border border-border/70 bg-background px-2 py-1 text-xs hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> Sheet
              </button>
            )}
          </div>
        </div>
      )}

      {isEditing && draft?.kind === 'gsheet' && (
        <div className="border-b border-border/40 bg-muted/10 px-5 py-2.5">
          <div className="mb-2.5 space-y-2 rounded-md border border-border/60 bg-background/65 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGooglePickerOpen((value) => !value)}
                disabled={!hasGoogleConnection}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55"
              >
                {googlePickerOpen ? 'Hide Drive Sheets' : 'Pick from Drive'}
              </button>
              {isGoogleDriveVault && (
                <button
                  type="button"
                  onClick={() => setShowGoogleAdvancedFields((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                >
                  {showGoogleAdvancedFields ? 'Hide Advanced' : 'Show Advanced'}
                </button>
              )}
            </div>

            {googlePickerOpen && hasGoogleConnection && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={googlePickerQuery}
                  onChange={(event) => setGooglePickerQuery(event.target.value)}
                  placeholder="Search Google Sheets"
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
                <div className="max-h-44 overflow-auto rounded-md border border-border/60 bg-background/70">
                  {googlePickerLoading && (
                    <div className="px-2.5 py-2 text-xs text-muted-foreground">Loading Google Sheets...</div>
                  )}
                  {!googlePickerLoading && googlePickerItems.length === 0 && (
                    <div className="px-2.5 py-2 text-xs text-muted-foreground">No matching Google Sheets found.</div>
                  )}
                  {!googlePickerLoading && googlePickerItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handlePickGoogleSheet(item)}
                      className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-2.5 py-2 text-left text-xs last:border-b-0 hover:bg-muted/60"
                    >
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{item.id.slice(0, 8)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {googlePickerError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                {googlePickerError}
              </div>
            )}

            {!hasGoogleConnection && (
              <div className="text-[11px] text-muted-foreground">
                Connect Google in Settings {'>'} Google Docs and Sheets only if you want Drive picker. Opening/editing sheets does not require OAuth setup here.
              </div>
            )}
          </div>

          {(!isGoogleDriveVault || showGoogleAdvancedFields) && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                className="rounded border border-border/70 bg-background px-2 py-1.5 text-xs"
                placeholder="Spreadsheet ID"
                value={draft.google?.spreadsheetId || ''}
                onChange={(event) => updateGoogleMetadata('spreadsheetId', event.target.value)}
              />
              <input
                className="rounded border border-border/70 bg-background px-2 py-1.5 text-xs"
                placeholder="Open URL (optional)"
                value={draft.google?.openUrl || ''}
                onChange={(event) => updateGoogleMetadata('openUrl', event.target.value)}
              />
              <input
                className="rounded border border-border/70 bg-background px-2 py-1.5 text-xs"
                placeholder="Sheet Name"
                value={draft.google?.sheetName || ''}
                onChange={(event) => updateGoogleMetadata('sheetName', event.target.value)}
              />
              <input
                className="rounded border border-border/70 bg-background px-2 py-1.5 text-xs"
                placeholder="Range (optional, e.g. Sheet1!A1:Z200)"
                value={draft.google?.range || ''}
                onChange={(event) => updateGoogleMetadata('range', event.target.value)}
              />
            </div>
          )}

          {isGoogleDriveVault && !showGoogleAdvancedFields && (
            <div className="mb-2 text-xs text-muted-foreground">
              Google Drive vault detected. Advanced metadata fields are hidden by default.
            </div>
          )}
        </div>
      )}

      <div className={cn('min-h-0 flex-1', isGoogleSheetDocument ? 'overflow-hidden' : 'overflow-auto')}>
        {!isGoogleSheetDocument && formattedCellCssText && <style>{formattedCellCssText}</style>}
        {loading && <div className="text-sm text-muted-foreground">Loading table...</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}
        {!loading && !error && isGoogleSheetDocument && !googleSheetOpenUrl && (
          <div className="mx-5 mt-5 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
            Add a spreadsheet ID or Google Sheets URL in edit settings to open this file in Google Sheets.
          </div>
        )}
        {!loading && !error && isGoogleSheetDocument && googleSheetOpenUrl && (
          <div className="h-full min-h-0">
            <GoogleWorkspaceViewerBlock
              title={`Google sheet ${filename}`}
              url={googleSheetOpenUrl}
            />
          </div>
        )}
        {!loading && !error && !isGoogleSheetDocument && activeSheet && (
          <>
            <div ref={gridRootRef}>
            <DataSheetGrid<GridRowBlock>
              key={gridInstanceKey}
              ref={gridRef}
              className={gridScopeClass}
              value={gridRows}
              onChange={handleGridRowsChange}
              columns={gridColumns}
              cellClassName={({ rowIndex, columnId }) => gridCellClassName({ rowIndex, columnId })}
              height={gridHeight}
              autoAddRow={isEditing}
              lockRows={!isEditing}
              disableContextMenu={!isEditing}
              addRowsComponent={false}
              onActiveCellChange={({ cell }) => handleActiveCellChange(cell)}
              onSelectionChange={({ selection: nextSelection }) => handleSelectionChange(nextSelection)}
            />
            </div>
            {isEditing && (
              <TableGridFooterControlsBlock onAddRowsAndColumns={addRowsAndColumns} />
            )}
          </>
        )}
      </div>

      {columnContextMenu && columnContextMenuEntries.length > 0 && (
        <ContextMenuBlock
          entries={columnContextMenuEntries}
          position={{ x: columnContextMenu.x, y: columnContextMenu.y }}
          onClose={() => setColumnContextMenu(null)}
        />
      )}

      {(saveError || successMessage || conflict) && (
        <div className="border-t border-border/50 px-5 py-2.5 text-sm">
          {saveError && <div className="text-destructive">{saveError}</div>}
          {successMessage && <div className="text-emerald-700 dark:text-emerald-300">{successMessage}</div>}
          {conflict && (
            <button
              type="button"
              onClick={loadLatestConflictVersion}
              className="mt-2 rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
            >
              Load latest file version
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function cloneDocumentBlock(document: TableDocumentModelBlock): TableDocumentModelBlock {
  return JSON.parse(JSON.stringify(document)) as TableDocumentModelBlock
}

function mutateActiveSheetBlock(document: TableDocumentModelBlock, updater: (sheet: TableSheetBlock) => TableSheetBlock): TableDocumentModelBlock {
  const sheetIndex = document.sheets.findIndex(sheet => sheet.id === document.activeSheetId)
  if (sheetIndex < 0) return document
  const nextSheets = [...document.sheets]
  nextSheets[sheetIndex] = updater(nextSheets[sheetIndex])
  return { ...document, sheets: nextSheets }
}

function ensureTableRectBlock(rows: TableSheetBlock['rows'], minRows: number, minCols: number): TableSheetBlock['rows'] {
  const next: TableSheetBlock['rows'] = rows.map(row => row.map(cell => ({
    value: cell.value,
    format: cell.format ? { ...cell.format } : undefined,
  })))
  while (next.length < minRows) next.push([])
  for (const row of next) {
    while (row.length < minCols) row.push({ value: '', format: undefined })
  }
  return next
}

function sanitizeFormatBlock(format: TableCellFormatBlock | undefined): TableCellFormatBlock | undefined {
  if (!format) return undefined
  const next: TableCellFormatBlock = {}
  if (format.bold) next.bold = true
  if (format.italic) next.italic = true
  if (format.underline) next.underline = true
  if (format.align === 'left' || format.align === 'center' || format.align === 'right') next.align = format.align
  if (format.textColor) next.textColor = format.textColor
  if (format.backgroundColor) next.backgroundColor = format.backgroundColor
  if (format.numberFormat) next.numberFormat = format.numberFormat
  return Object.keys(next).length > 0 ? next : undefined
}

function resolveSelectionBoundsBlock(
  selection: GridSelectionWithIdBlock | null,
  activeCell: GridCellWithIdBlock | null,
  rowCount: number,
  columnCount: number,
): SelectionRangeBlock {
  const fallbackCell = activeCell ?? { row: 0, col: 0 }
  const start = selection?.min ?? fallbackCell
  const end = selection?.max ?? fallbackCell
  return {
    start: {
      row: clampBlock(Math.min(start.row, end.row), 0, Math.max(0, rowCount - 1)),
      col: clampBlock(Math.min(start.col, end.col), 0, Math.max(0, columnCount - 1)),
    },
    end: {
      row: clampBlock(Math.max(start.row, end.row), 0, Math.max(0, rowCount - 1)),
      col: clampBlock(Math.max(start.col, end.col), 0, Math.max(0, columnCount - 1)),
    },
  }
}

function formatButtonClassBlock(active: boolean): string {
  return cn(
    'rounded border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
    active ? 'border-primary bg-primary/10 text-foreground' : 'border-border/70 bg-background hover:bg-muted',
  )
}

function columnKeyBlock(index: number): string {
  return `c${index}`
}

function columnIndexFromKeyBlock(columnId: string | undefined): number | null {
  if (!columnId) return null
  const match = /^c(\d+)$/.exec(columnId)
  if (!match) return null
  const out = Number.parseInt(match[1] || '', 10)
  return Number.isFinite(out) ? out : null
}

function formattedCellClassNameBlock(rowIndex: number, colIndex: number): string {
  return `table-cell-fmt-r${rowIndex}-c${colIndex}`
}

function sanitizeCssColorBlock(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return `#${value.slice(1, 7)}`
  return null
}

function normalizeColorForPickerBlock(input: string | undefined, fallback = '#111111'): string {
  return sanitizeCssColorBlock(input || '') ?? fallback
}

function createEmptyGridRowBlock(columnCount: number): GridRowBlock {
  const row: GridRowBlock = {}
  for (let i = 0; i < columnCount; i++) {
    row[columnKeyBlock(i)] = ''
  }
  return row
}

function createEmptyTableRowBlock(columnCount: number): TableSheetBlock['rows'][number] {
  return Array.from({ length: columnCount }, () => ({ value: '', format: undefined }))
}

function TableGridFooterControlsBlock({
  onAddRowsAndColumns,
}: {
  onAddRowsAndColumns: (rowCount: number, columnCount: number) => void
}) {
  const [rowValue, setRowValue] = useState(1)
  const [rawRowValue, setRawRowValue] = useState('1')
  const [columnValue, setColumnValue] = useState(0)
  const [rawColumnValue, setRawColumnValue] = useState('0')

  const commitAddRowsAndColumns = useCallback(() => {
    onAddRowsAndColumns(rowValue, columnValue)
  }, [columnValue, onAddRowsAndColumns, rowValue])

  return (
    <div className="dsg-add-row">
      <button type="button" className="dsg-add-row-btn" onClick={commitAddRowsAndColumns}>
        Add
      </button>
      <input
        className="dsg-add-row-input"
        value={rawRowValue}
        onBlur={() => setRawRowValue(String(rowValue))}
        type="number"
        min={1}
        onChange={(event) => {
          setRawRowValue(event.target.value)
          setRowValue(Math.max(1, Math.round(Number.parseInt(event.target.value || '0', 10) || 0)))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitAddRowsAndColumns()
          }
        }}
      />
      <span>rows</span>
      <input
        className="dsg-add-row-input"
        value={rawColumnValue}
        onBlur={() => setRawColumnValue(String(columnValue))}
        type="number"
        min={0}
        onChange={(event) => {
          setRawColumnValue(event.target.value)
          setColumnValue(Math.max(0, Math.round(Number.parseInt(event.target.value || '0', 10) || 0)))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitAddRowsAndColumns()
          }
        }}
      />
      <span>columns</span>
    </div>
  )
}

function columnLabelBlock(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function clampBlock(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default memo(TableDocumentBlock)
