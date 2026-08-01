import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/lego_blocks/units/ui/select'
import {
  getVaultPathKind,
  type VaultPathKind,
} from '@/services/orchestrators/fileSystemOrch'
// The folder cache used to live here. It moved to a unit block (2026-07-31)
// when the destination browser's tree needed the same data — two private caches
// walking one vault would double the filesystem calls and let the two pickers
// disagree about what exists.
import { fetchFolderChildrenBlock } from '@/services/lego_blocks/units/folderChildrenCacheBlock'

function parseRecents(raw: string | null): string[][] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(entry => normalizeSegments(entry))
      .filter(segments => segments.length > 0)
  } catch {
    return []
  }
}

export function addRecent(
  storageKey: string,
  segments: string[],
  max: number = 10,
) {
  const raw = localStorage.getItem(storageKey)
  let recents: string[][] = raw ? JSON.parse(raw) : []
  const path = normalizeSegments(segments).join('/')
  recents = recents.filter(r => normalizeSegments(r).join('/') !== path)
  recents.unshift(normalizeSegments(segments))
  if (recents.length > max) recents = recents.slice(0, max)
  localStorage.setItem(storageKey, JSON.stringify(recents))
  window.dispatchEvent(new CustomEvent('folder-recents-updated', { detail: storageKey }))
}

interface Level {
  options: string[]
  selected: string | null
  loading: boolean
}

function normalizeSegments(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.flatMap(segment => (typeof segment === 'string' ? segment.split('/') : []))
    : (typeof value === 'string' ? value.split('/') : [])
  return parts
    .map(segment => segment.trim())
    .filter(Boolean)
}

function endsWithSegments(path: string[], suffix: string[]): boolean {
  if (suffix.length === 0) return true
  if (path.length < suffix.length) return false
  const offset = path.length - suffix.length
  for (let i = 0; i < suffix.length; i += 1) {
    if (path[offset + i] !== suffix[i]) return false
  }
  return true
}

function stripSuffix(path: string[], suffix: string[]): string[] {
  return endsWithSegments(path, suffix)
    ? path.slice(0, path.length - suffix.length)
    : path
}

function withSuffix(path: string[], suffix: string[]): string[] {
  return endsWithSegments(path, suffix)
    ? [...path]
    : [...path, ...suffix]
}

export interface CascadingFolderPickerChange {
  baseSegments: string[]
  basePath: string
  destinationSegments: string[]
  destinationPath: string
}

interface CascadingFolderPickerProps {
  defaultPath?: string[]
  requiredSuffixSegments?: string[]
  onChange: (change: CascadingFolderPickerChange) => void
  storageKey?: string
  maxRecents?: number
  previewLabel?: string
}

export default function CascadingFolderPicker({
  defaultPath,
  requiredSuffixSegments = [],
  onChange,
  storageKey = 'ltm-folder-recents',
  maxRecents = 10,
  previewLabel = 'Destination preview',
}: CascadingFolderPickerProps) {
  const [levels, setLevels] = useState<Level[]>([])
  const [recents, setRecents] = useState<string[][]>([])
  const [customSegments, setCustomSegments] = useState<string[]>([])
  const [customDraft, setCustomDraft] = useState('')
  const [hasChildren, setHasChildren] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [destinationState, setDestinationState] = useState<'idle' | 'checking' | VaultPathKind | 'error'>('idle')

  const requiredSuffix = useMemo(
    () => normalizeSegments(requiredSuffixSegments),
    [requiredSuffixSegments],
  )

  useEffect(() => {
    setRecents(parseRecents(localStorage.getItem(storageKey)))
  }, [storageKey])

  const refreshRecents = useCallback(() => {
    setRecents(parseRecents(localStorage.getItem(storageKey)))
  }, [storageKey])

  const fetchChildren = useCallback(
    (path: string): Promise<string[]> => fetchFolderChildrenBlock(path),
    [],
  )

  const getSelectedSegments = useCallback(
    (lvls: Level[]) => lvls.filter(level => level.selected).map(level => level.selected!),
    [],
  )

  const emitChange = useCallback((baseSegmentsInput: string[]) => {
    const baseSegments = normalizeSegments(baseSegmentsInput)
    const destinationSegments = withSuffix(baseSegments, requiredSuffix)
    onChange({
      baseSegments,
      basePath: baseSegments.join('/'),
      destinationSegments,
      destinationPath: destinationSegments.join('/'),
    })
  }, [onChange, requiredSuffix])

  const hydrateFromSegments = useCallback(async (segmentsInput: string[]) => {
    const defaultBaseSegments = stripSuffix(normalizeSegments(segmentsInput), requiredSuffix)
    const rootChildren = await fetchChildren('')
    const nextLevels: Level[] = [{ options: rootChildren, selected: null, loading: false }]

    let firstMissingIndex = -1
    let nextHasChildren = false

    for (let i = 0; i < defaultBaseSegments.length; i += 1) {
      const segment = defaultBaseSegments[i]
      if (!nextLevels[i] || !nextLevels[i].options.includes(segment)) {
        firstMissingIndex = i
        break
      }

      nextLevels[i].selected = segment
      const pathSoFar = defaultBaseSegments.slice(0, i + 1).join('/')
      const children = await fetchChildren(pathSoFar)

      if (children.length > 0 && i < defaultBaseSegments.length - 1) {
        nextLevels.push({ options: children, selected: null, loading: false })
      } else if (i === defaultBaseSegments.length - 1) {
        nextHasChildren = children.length > 0
      }
    }

    const fallbackSegments = firstMissingIndex >= 0
      ? defaultBaseSegments.slice(firstMissingIndex).filter(Boolean)
      : []

    const selectedSegments = getSelectedSegments(nextLevels)
    const baseSegments = [...selectedSegments, ...fallbackSegments]

    setCustomSegments(fallbackSegments)
    setCustomDraft('')
    setHasChildren(nextHasChildren)
    setExpanded(false)
    setLevels(nextLevels)

    if (baseSegments.length > 0 || defaultBaseSegments.length > 0) {
      emitChange(baseSegments)
    }
  }, [emitChange, fetchChildren, getSelectedSegments, requiredSuffix])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (cancelled) return
      await hydrateFromSegments(defaultPath ?? [])
    })()

    return () => {
      cancelled = true
    }
    // Initialize from incoming default path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelect = useCallback(async (levelIndex: number, value: string) => {
    let selectedSegments: string[] = []

    setLevels(prev => {
      const updated = prev.slice(0, levelIndex + 1).map((level, index) => (
        index === levelIndex ? { ...level, selected: value } : level
      ))
      selectedSegments = getSelectedSegments(updated)
      return updated
    })

    setCustomSegments([])
    setCustomDraft('')
    setExpanded(false)
    setHasChildren(false)

    const children = await fetchChildren(selectedSegments.join('/'))
    setHasChildren(children.length > 0)
    emitChange(selectedSegments)
  }, [emitChange, fetchChildren, getSelectedSegments])

  const handleExpand = useCallback(async () => {
    const selectedSegments = getSelectedSegments(levels)
    if (selectedSegments.length === 0) return

    setExpanded(true)
    const children = await fetchChildren(selectedSegments.join('/'))
    if (children.length > 0) {
      setLevels(prev => [
        ...prev,
        { options: children, selected: null, loading: false },
      ])
    }
  }, [fetchChildren, getSelectedSegments, levels])

  const applyRecent = useCallback(async (segments: string[]) => {
    await hydrateFromSegments(segments)
  }, [hydrateFromSegments])

  const handleAppendCustomSegments = useCallback(() => {
    const nextSegments = normalizeSegments([customDraft])
    if (nextSegments.length === 0) return

    const selectedSegments = getSelectedSegments(levels)

    setCustomSegments(prev => {
      const merged = [...prev, ...nextSegments]
      emitChange([...selectedSegments, ...merged])
      return merged
    })

    setCustomDraft('')
    setExpanded(false)
    setHasChildren(false)
  }, [customDraft, emitChange, getSelectedSegments, levels])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refreshRecents()
    }

    const onCustom = (event: Event) => {
      if ((event as CustomEvent).detail === storageKey) refreshRecents()
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener('folder-recents-updated', onCustom)

    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('folder-recents-updated', onCustom)
    }
  }, [refreshRecents, storageKey])

  const selectedSegments = getSelectedSegments(levels)
  const baseSegments = [...selectedSegments, ...customSegments]
  const destinationSegments = withSuffix(baseSegments, requiredSuffix)
  const destinationPath = destinationSegments.join('/')
  const requiredSuffixPath = requiredSuffix.join('/')

  useEffect(() => {
    let cancelled = false

    if (!destinationPath) {
      setDestinationState('idle')
      return () => { cancelled = true }
    }

    setDestinationState('checking')
    void getVaultPathKind(destinationPath)
      .then(kind => {
        if (!cancelled) setDestinationState(kind)
      })
      .catch(() => {
        if (!cancelled) setDestinationState('error')
      })

    return () => {
      cancelled = true
    }
  }, [destinationPath])

  const destinationStateLabel = useMemo(() => {
    if (destinationState === 'checking') return 'Checking destination status...'
    if (destinationState === 'folder') return 'Using existing folder'
    if (destinationState === 'missing') return 'Folder does not exist yet. It will be created on save.'
    if (destinationState === 'file') return 'Destination points to a file. Choose a folder path.'
    if (destinationState === 'error') return 'Could not verify destination status. Save may still create it.'
    return null
  }, [destinationState])

  const lastLevelHasSelection = levels.length > 0 && levels[levels.length - 1].selected !== null
  const showGoDeeper = customSegments.length === 0 && hasChildren && lastLevelHasSelection && !expanded

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {levels.map((level, index) => {
          if (!level.loading && level.options.length === 0) return null

          return (
            <div key={index}>
              {level.loading ? (
                <div className="flex h-10 w-full items-center justify-center rounded-lg border border-input">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Select
                  value={level.selected || ''}
                  onValueChange={(value) => { void handleSelect(index, value) }}
                >
                  <SelectTrigger className="w-full rounded-full">
                    <SelectValue placeholder={index === 0 ? 'Select folder...' : 'Select subfolder...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {level.options.map(option => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )
        })}

        {showGoDeeper && (
          <button
            type="button"
            onClick={() => { void handleExpand() }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-3 w-3" />
            Go deeper
          </button>
        )}
      </div>

      <div className="space-y-1.5 border-t border-border/40 pt-3">
        <label className="text-xs text-muted-foreground">Add new folder segment</label>
        <div className="flex gap-2">
          <input
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleAppendCustomSegments()
              }
            }}
            placeholder="new-folder or nested/a/b"
            className="h-9 flex-1 rounded-full border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
          <button
            type="button"
            onClick={handleAppendCustomSegments}
            className="inline-flex h-9 items-center rounded-full border border-input bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            Add
          </button>
        </div>
        {customSegments.length > 0 && (
          <p className="text-[11px] text-muted-foreground/70">
            Appended: {customSegments.join(' / ')}
          </p>
        )}
      </div>

      {destinationPath && (
        <div className="space-y-1.5 border-t border-border/40 pt-3">
          <label className="text-xs text-muted-foreground">{previewLabel}</label>
          <p className="text-xs text-muted-foreground/80 break-all">
            {destinationPath}
          </p>
          {requiredSuffixPath && (
            <p className="text-[11px] text-muted-foreground/70 break-all">
              Required folder suffix: {requiredSuffixPath}
            </p>
          )}
          {destinationStateLabel && (
            <p className="text-[11px] text-muted-foreground/70 break-all">
              {destinationStateLabel}
            </p>
          )}
        </div>
      )}

      {recents.length > 0 && (
        <div className="space-y-1.5 border-t border-border/40 pt-3">
          <label className="text-xs text-muted-foreground">Recent</label>
          <div className="flex flex-col gap-1.5">
            {recents.slice(0, maxRecents).map((segments, index) => (
              <button
                key={index}
                type="button"
                onClick={() => { void applyRecent(segments) }}
                className="text-left rounded-full border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors break-words"
              >
                {normalizeSegments(segments).join(' / ')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
