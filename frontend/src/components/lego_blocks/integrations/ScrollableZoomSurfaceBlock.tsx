import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  BACKLOG_COLUMN_WIDTH_SCALE_CSS_VAR_BLOCK,
  scaledWidthStyleFromClassBlock,
} from '@/components/lego_blocks/units/BacklogRowColumnsBlock'
import { cn } from '@/lib/utils'
import { getSpaceStorageKeyBlock } from '@/services/orchestrators/storageOrch'

interface ScrollableZoomSurfaceBlockProps {
  children: ReactNode
  className?: string
  viewportClassName?: string
  contentClassName?: string
  minWidthClassName?: string
  controlsLabel?: string
  defaultZoom?: number
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  fitToWidthLabel?: string
  fitColumnsToWidthLabel?: string
  showFitColumnsToWidthButton?: boolean
  resetLabel?: string
  persistStateKey?: string
}

interface PersistedScrollableZoomStateBlock {
  zoom?: number
  columnWidthScale?: number
  fitColumnsLocked?: boolean
}

function readPersistedScrollableZoomStateBlock(storageKey: string): PersistedScrollableZoomStateBlock | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedScrollableZoomStateBlock | null
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function clampZoomBlock(value: number, min: number, max?: number): number {
  const boundedMin = Math.max(value, min)
  if (typeof max === 'number' && Number.isFinite(max)) {
    return Math.min(boundedMin, max)
  }
  return boundedMin
}

export default function ScrollableZoomSurfaceBlock({
  children,
  className,
  viewportClassName,
  contentClassName,
  minWidthClassName,
  controlsLabel = 'Table zoom',
  defaultZoom = 1,
  minZoom = 0.7,
  maxZoom,
  zoomStep = 0.1,
  fitToWidthLabel = 'Fit table to width',
  fitColumnsToWidthLabel = 'Fit columns to width',
  showFitColumnsToWidthButton = false,
  resetLabel = 'Reset',
  persistStateKey,
}: ScrollableZoomSurfaceBlockProps) {
  const normalizedPersistStateKey = persistStateKey?.trim() ?? ''
  const storageKey = normalizedPersistStateKey
    ? getSpaceStorageKeyBlock(`scrollable-zoom-surface:${normalizedPersistStateKey}`)
    : ''
  const initialZoom = clampZoomBlock(defaultZoom, minZoom, maxZoom)
  const [zoom, setZoom] = useState<number>(() => {
    if (!storageKey) return initialZoom
    const persisted = readPersistedScrollableZoomStateBlock(storageKey)
    if (!persisted || typeof persisted.zoom !== 'number' || !Number.isFinite(persisted.zoom)) return initialZoom
    return clampZoomBlock(persisted.zoom, minZoom, maxZoom)
  })
  const [columnWidthScale, setColumnWidthScale] = useState<number>(() => {
    if (!storageKey) return 1
    const persisted = readPersistedScrollableZoomStateBlock(storageKey)
    if (!persisted || typeof persisted.columnWidthScale !== 'number' || !Number.isFinite(persisted.columnWidthScale)) return 1
    return Math.max(persisted.columnWidthScale, 0.05)
  })
  const [fitColumnsLocked, setFitColumnsLocked] = useState<boolean>(() => {
    if (!storageKey) return false
    const persisted = readPersistedScrollableZoomStateBlock(storageKey)
    return !!persisted?.fitColumnsLocked
  })
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const zoomPercent = `${Math.round(zoom * 100)}%`
  const hasMaxZoom = typeof maxZoom === 'number' && Number.isFinite(maxZoom)
  const canZoomOut = zoom > minZoom
  const canZoomIn = !hasMaxZoom || zoom < maxZoom
  const fitToWidth = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const viewportWidth = viewport.clientWidth
    if (viewportWidth <= 0) return
    const renderedWidth = content.getBoundingClientRect().width
    if (renderedWidth <= 0 || zoom <= 0) return
    const baseWidth = renderedWidth / zoom
    if (baseWidth <= 0) return
    const nextZoom = clampZoomBlock(Number((viewportWidth / baseWidth).toFixed(2)), minZoom, maxZoom)
    setZoom(nextZoom)
  }, [maxZoom, minZoom, zoom])
  const applyColumnsFit = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const viewportWidth = viewport.clientWidth
    if (viewportWidth <= 0) return
    const renderedWidth = content.getBoundingClientRect().width
    if (renderedWidth <= 0) return
    setColumnWidthScale((current) => Number((current * (viewportWidth / renderedWidth)).toFixed(3)))
  }, [])
  const toggleFitColumnsToWidth = useCallback(() => {
    if (fitColumnsLocked) {
      setFitColumnsLocked(false)
      setColumnWidthScale(1)
      return
    }
    applyColumnsFit()
    setFitColumnsLocked(true)
  }, [applyColumnsFit, fitColumnsLocked])
  const resetView = useCallback(() => {
    setZoom(clampZoomBlock(defaultZoom, minZoom, maxZoom))
    setColumnWidthScale(1)
    setFitColumnsLocked(false)
  }, [defaultZoom, maxZoom, minZoom])
  const canReset = Math.abs(zoom - clampZoomBlock(defaultZoom, minZoom, maxZoom)) > 0.001
    || Math.abs(columnWidthScale - 1) > 0.001
    || fitColumnsLocked
  const scaledMinWidthStyle = scaledWidthStyleFromClassBlock(minWidthClassName)
  const contentScaleStyle = {
    [BACKLOG_COLUMN_WIDTH_SCALE_CSS_VAR_BLOCK]: String(columnWidthScale),
  } as CSSProperties

  useEffect(() => {
    if (!fitColumnsLocked) return
    let rafId = 0
    const scheduleFit = () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        applyColumnsFit()
      })
    }

    scheduleFit()
    const viewport = viewportRef.current
    const content = contentRef.current
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleFit())
      : null
    if (observer && viewport) observer.observe(viewport)
    if (observer && content) observer.observe(content)
    window.addEventListener('resize', scheduleFit)

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', scheduleFit)
      observer?.disconnect()
    }
  }, [applyColumnsFit, fitColumnsLocked])

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    const payload: PersistedScrollableZoomStateBlock = {
      zoom,
      columnWidthScale,
      fitColumnsLocked,
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      // Ignore persistence errors (quota/privacy mode).
    }
  }, [columnWidthScale, fitColumnsLocked, storageKey, zoom])

  return (
    <div className={cn('space-y-2', className)}>
      <div ref={viewportRef} className={cn('overflow-x-auto', viewportClassName)}>
        <div
          ref={contentRef}
          className={cn(minWidthClassName, contentClassName)}
          style={{ ...scaledMinWidthStyle, ...contentScaleStyle, zoom }}
        >
          {children}
        </div>
      </div>
      <div className="flex w-full items-center justify-start gap-1.5 overflow-x-auto whitespace-nowrap px-1 pb-1 text-xs [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:justify-end">
        <span className="hidden shrink-0 text-muted-foreground sm:inline">{controlsLabel}</span>
        {showFitColumnsToWidthButton && (
          <Button
            type="button"
            variant={fitColumnsLocked ? 'default' : 'outline'}
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[11px] sm:h-7 sm:px-2 sm:text-xs"
            onClick={toggleFitColumnsToWidth}
          >
            {fitColumnsToWidthLabel}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-[11px] sm:h-7 sm:px-2 sm:text-xs"
          onClick={fitToWidth}
        >
          {fitToWidthLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-[11px] sm:h-7 sm:px-2 sm:text-xs"
          onClick={resetView}
          disabled={!canReset}
        >
          {resetLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-6 w-6 shrink-0 sm:h-7 sm:w-7"
          disabled={!canZoomOut}
          onClick={() => setZoom((current) => clampZoomBlock(Number((current - zoomStep).toFixed(2)), minZoom, maxZoom))}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[2.5rem] shrink-0 text-center font-medium tabular-nums text-muted-foreground sm:min-w-[3rem]">
          {zoomPercent}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-6 w-6 shrink-0 sm:h-7 sm:w-7"
          disabled={!canZoomIn}
          onClick={() => setZoom((current) => clampZoomBlock(Number((current + zoomStep).toFixed(2)), minZoom, maxZoom))}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
