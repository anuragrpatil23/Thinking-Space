import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AppWorkspaceTabBlockModel {
  id: string
  label: string
}

interface AppTabsBlockProps {
  tabs: AppWorkspaceTabBlockModel[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onCreateTab: () => void
  onCloseTab: (tabId: string) => void
  className?: string
}

export default function AppTabsBlock({
  tabs,
  activeTabId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  className,
}: AppTabsBlockProps) {
  const stripShellRef = useRef<HTMLDivElement | null>(null)
  const scrollTrackRef = useRef<HTMLDivElement | null>(null)
  const scrollInnerRef = useRef<HTMLDivElement | null>(null)
  const activeTabButtonRef = useRef<HTMLButtonElement | null>(null)
  const createTabButtonRef = useRef<HTMLButtonElement | null>(null)
  const wheelFrameRef = useRef<number | null>(null)
  const wheelTargetLeftRef = useRef(0)
  const [tabsOverflowing, setTabsOverflowing] = useState(false)
  const prefersNativeMomentumScroll = typeof window !== 'undefined' && window.electronAPI?.isElectron === true
  const tabsSignature = useMemo(
    () => tabs.map((tab) => `${tab.id}:${tab.label}`).join('\n'),
    [tabs],
  )

  useLayoutEffect(() => {
    const shell = stripShellRef.current
    const inner = scrollInnerRef.current
    const createButton = createTabButtonRef.current
    if (!shell || !inner || !createButton) return

    const measure = () => {
      const gap = 8
      const nextOverflowing = inner.scrollWidth + createButton.offsetWidth + gap > shell.clientWidth + 1
      setTabsOverflowing((prev) => (prev === nextOverflowing ? prev : nextOverflowing))
      if (!nextOverflowing && scrollTrackRef.current) {
        if (wheelFrameRef.current !== null) {
          window.cancelAnimationFrame(wheelFrameRef.current)
          wheelFrameRef.current = null
        }
        wheelTargetLeftRef.current = 0
        scrollTrackRef.current.scrollLeft = 0
      }
    }

    measure()
    const observer = new ResizeObserver(() => {
      measure()
    })
    observer.observe(shell)
    observer.observe(inner)
    observer.observe(createButton)

    return () => {
      observer.disconnect()
    }
  }, [tabsSignature])

  useEffect(() => {
    activeTabButtonRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTabId, tabs.length])

  useEffect(() => {
    const track = scrollTrackRef.current
    if (!track) return
    if (prefersNativeMomentumScroll) return

    const normalizeWheelDelta = (event: WheelEvent): number => {
      const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return dominantDelta * 16
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return dominantDelta * track.clientWidth
      return dominantDelta
    }

    const stopWheelAnimation = () => {
      if (wheelFrameRef.current === null) return
      window.cancelAnimationFrame(wheelFrameRef.current)
      wheelFrameRef.current = null
    }

    const animateWheelScroll = () => {
      const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth)
      const clampedTarget = Math.min(Math.max(wheelTargetLeftRef.current, 0), maxLeft)
      const delta = clampedTarget - track.scrollLeft
      if (Math.abs(delta) <= 0.5) {
        track.scrollLeft = clampedTarget
        wheelFrameRef.current = null
        return
      }

      track.scrollLeft += delta * 0.22
      wheelFrameRef.current = window.requestAnimationFrame(animateWheelScroll)
    }

    const onWheel = (event: WheelEvent) => {
      if (track.scrollWidth <= track.clientWidth + 1) return
      const delta = normalizeWheelDelta(event)
      if (Math.abs(delta) < 0.5) return
      event.preventDefault()
      const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth)
      const baseLeft = wheelFrameRef.current === null ? track.scrollLeft : wheelTargetLeftRef.current
      wheelTargetLeftRef.current = Math.min(Math.max(baseLeft + delta, 0), maxLeft)
      if (wheelFrameRef.current !== null) return
      wheelFrameRef.current = window.requestAnimationFrame(animateWheelScroll)
    }

    track.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stopWheelAnimation()
      track.removeEventListener('wheel', onWheel)
    }
  }, [prefersNativeMomentumScroll, tabsSignature])

  return (
    <div
      className={cn('ltm-shell-tabs ltm-shell-motion-capsule min-w-0 max-w-full', className)}
      style={{ containerType: 'inline-size' }}
    >
      <div
        ref={stripShellRef}
        className={cn(
          'ltm-tab-strip-shell mx-auto flex min-w-0 w-full items-center justify-center',
          tabsOverflowing ? 'max-w-full overflow-hidden' : 'max-w-[min(100%,960px)]',
        )}
      >
        <div
          className={cn(
            'ltm-tab-strip-rail mx-auto flex min-w-0 items-center gap-2',
            tabsOverflowing ? 'w-full max-w-full' : 'w-auto max-w-full',
          )}
        >
          <div
            ref={scrollTrackRef}
            className={cn(
              'ltm-tab-scroll-track min-w-0 max-w-full',
              tabsOverflowing ? 'flex-1 overflow-x-auto' : 'overflow-x-hidden',
            )}
          >
            <div
              ref={scrollInnerRef}
              className={cn(
                'ltm-tab-scroll-inner inline-flex items-center gap-1 py-1 pr-1',
                tabsOverflowing ? 'min-w-max' : 'w-max max-w-full',
              )}
            >
              {tabs.map((tab, index) => {
                const active = tab.id === activeTabId
                const canClose = tabs.length > 1
                return (
                  <div
                    key={tab.id}
                    className="ltm-tab-slot relative shrink-0"
                  >
                    <div
                      className={cn(
                        'ltm-tab-item ltm-tab-fade group inline-flex h-8 w-[156px] items-center gap-1 rounded-full px-2.5 transition-colors sm:w-[168px]',
                        active
                          ? 'ltm-tab-active border border-white/85 bg-white text-black shadow-[0_1px_0_rgba(255,255,255,0.5)]'
                          : 'border border-transparent bg-transparent text-muted-foreground hover:bg-zinc-300/12 hover:text-foreground',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectTab(tab.id)}
                        ref={active ? activeTabButtonRef : null}
                        className="min-w-0 flex-1 truncate text-left text-[12px] font-medium"
                        title={tab.label}
                        aria-current={active ? 'page' : undefined}
                      >
                        {tab.label}
                      </button>
                      {canClose && (
                        <button
                          type="button"
                          onClick={() => onCloseTab(tab.id)}
                          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          aria-label={`Close ${tab.label} tab`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {index < tabs.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'ltm-tab-separator pointer-events-none absolute right-0 top-1/2 h-4 -translate-y-1/2',
                          active ? 'opacity-0' : 'opacity-100',
                        )}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <button
            ref={createTabButtonRef}
            type="button"
            onClick={onCreateTab}
            className="ltm-top-chrome-capsule ltm-motion-fast inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Create new app tab"
            title="New tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
