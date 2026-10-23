import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  BACKLOG_COLUMN_WIDTH_SCALE_CSS_VAR_BLOCK,
  scaledWidthStyleFromClassBlock,
} from '@/components/lego_blocks/units/BacklogRowColumnsBlock'
import { cn } from '@/lib/utils'

const QUIET_BUTTON_CLASS_BLOCK = 'h-6 shrink-0 px-1.5 text-[11px] font-normal text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'

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
  /** 'quiet': borderless grey text controls (F9's native tables). */
  controlsAppearance?: 'buttons' | 'quiet'
  /** Where the zoom controls dock (e.g. a section header); none keeps them under the table. */
  controlsHost?: HTMLElement | null
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
  controlsAppearance = 'buttons',
  controlsHost = null,
}: ScrollableZoomSurfaceBlockProps) {
  const normalizedPersistStateKey = persistStateKey?.trim() ?? ''
  const storageKey = normalizedPersistStateKey ? `scrollable-zoom-surface:${normalizedPersistStateKey}` : ''
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

  const quiet = controlsAppearance === 'quiet'
  // Pinned cells inside cast a light shadow only once the content has scrolled sideways.
  const [scrolledX, setScrolledX] = useState(false)
  // Quiet (F9): just a − 100% + stepper, and Reset once there is something to
  // reset. No Fit buttons: native tables already fill the width.
  const quietPillButtonClass = 'inline-flex h-[22px] items-center justify-center rounded-[5px] px-2 text-[11px] leading-none transition-colors disabled:opacity-40'
  const quietControls = (
    <div className={cn(controlsHost ? '' : 'w-full pt-1.5', 'flex items-center justify-start gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:justify-end')} role="group" aria-label={controlsLabel}>
      {canReset && (
        <button type="button" onClick={resetView} className="inline-flex h-6 items-center text-[11px] leading-none text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          {resetLabel}
        </button>
      )}
      <div className="flex h-6 items-center rounded-md bg-zinc-100 p-px text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-300">
        <button
          type="button"
          className={cn(quietPillButtonClass, 'px-1.5 hover:text-zinc-900 dark:hover:text-white')}
          disabled={!canZoomOut}
          onClick={() => setZoom((current) => clampZoomBlock(Number((current - zoomStep).toFixed(2)), minZoom, maxZoom))}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="min-w-[2.6rem] text-center text-[11px] leading-none tabular-nums">{zoomPercent}</span>
        <button
          type="button"
          className={cn(quietPillButtonClass, 'px-1.5 hover:text-zinc-900 dark:hover:text-white')}
          disabled={!canZoomIn}
          onClick={() => setZoom((current) => clampZoomBlock(Number((current + zoomStep).toFixed(2)), minZoom, maxZoom))}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
  const controls = quiet ? quietControls : (
    <div className={cn(controlsHost ? '' : 'w-full', 'flex items-center justify-start overflow-x-auto whitespace-nowrap px-1 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:justify-end', quiet ? cn('gap-0.5 text-[11px] text-zinc-500', !controlsHost && 'pt-1.5') : 'gap-1.5 text-xs')}>
      <span className="hidden shrink-0 text-muted-foreground sm:inline">{controlsLabel}</span>
      {showFitColumnsToWidthButton && (
        <Button
          type="button"
          variant={fitColumnsLocked ? (quiet ? 'secondary' : 'default') : (quiet ? 'ghost' : 'outline')}
          size="sm"
          className={quiet ? QUIET_BUTTON_CLASS_BLOCK : 'h-6 shrink-0 px-1.5 text-[11px] sm:h-7 sm:px-2 sm:text-xs'}
          onClick={toggleFitColumnsToWidth}
        >
          {fitColumnsToWidthLabel}
        </Button>
      )}
      <Button
        type="button"
        variant={quiet ? 'ghost' : 'outline'}
        size="sm"
        className={quiet ? QUIET_BUTTON_CLASS_BLOCK : 'h-6 shrink-0 px-1.5 text-[11px] sm:h-7 sm:px-2 sm:text-xs'}
        onClick={fitToWidth}
      >
        {fitToWidthLabel}
      </Button>
      <Button
        type="button"
        variant={quiet ? 'ghost' : 'outline'}
        size="sm"
        className={quiet ? QUIET_BUTTON_CLASS_BLOCK : 'h-6 shrink-0 px-1.5 text-[11px] sm:h-7 sm:px-2 sm:text-xs'}
        onClick={resetView}
        disabled={!canReset}
      >
        {resetLabel}
      </Button>
      <Button
        type="button"
        variant={quiet ? 'ghost' : 'outline'}
        size="icon"
        className={quiet ? 'h-6 w-6 shrink-0 text-zinc-500' : 'h-6 w-6 shrink-0 sm:h-7 sm:w-7'}
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
        variant={quiet ? 'ghost' : 'outline'}
        size="icon"
        className={quiet ? 'h-6 w-6 shrink-0 text-zinc-500' : 'h-6 w-6 shrink-0 sm:h-7 sm:w-7'}
        disabled={!canZoomIn}
        onClick={() => setZoom((current) => clampZoomBlock(Number((current + zoomStep).toFixed(2)), minZoom, maxZoom))}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={viewportRef}
        className={cn('group/zoomsurface overflow-x-auto', viewportClassName)}
        data-scrolled-x={scrolledX ? '' : undefined}
        onScroll={(event) => {
          const next = event.currentTarget.scrollLeft > 0
          if (next !== scrolledX) setScrolledX(next)
        }}
      >
        <div
          ref={contentRef}
          className={cn(minWidthClassName, contentClassName)}
          style={{ ...scaledMinWidthStyle, ...contentScaleStyle, zoom }}
        >
          {children}
        </div>
      </div>
      {controlsHost ? createPortal(controls, controlsHost) : controls}
    </div>
  )
}
