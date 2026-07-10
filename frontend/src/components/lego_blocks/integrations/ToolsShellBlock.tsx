import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { getVisibleToolsSubtabs } from '@/components/lego_blocks/units/toolsSubtabsBlock'
import { useSessionStateBlock } from '@/components/lego_blocks/hooks/shared/useSessionStateBlock'
import { useUILayoutBlock } from '@/components/lego_blocks/hooks/shared/useUILayoutBlock'
import { useNativeBackHandlerBlock } from '@/components/lego_blocks/hooks/shared/useNativeBackHandlerBlock'
import { isCapacitorNative } from '@/services/lego_blocks/integrations/fsBlock'
import {
  pushNativeWithForwardBlock,
  setNativeNavigationStackBlock,
} from '@/services/lego_blocks/units/topChromeNativeBridgeBlock'
import {
  dispatchToolsSidebarChromeStateBlock,
  TOOLS_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK,
} from '@/services/lego_blocks/units/toolsSidebarChromeBlock'

export { isToolsShellRoute } from '@/components/lego_blocks/units/toolsSubtabsBlock'

export default function ToolsShellBlock() {
  const location = useLocation()
  const navigate = useNavigate()
  const { layout } = useUILayoutBlock()
  const isIPhoneIosSurface = layout.surface === 'capacitor-ios' && layout.mode === 'phone'

  const visibleSubtabs = useMemo(() => getVisibleToolsSubtabs(), [])
  const [sidebarCollapsed, setSidebarCollapsed] = useSessionStateBlock('tools-sidebar-collapsed', false)

  // iPhone list/detail mode. On entering the Tools rail tab, the user lands
  // on the list page (sidebar full-screen); tapping a tool pushes them to
  // its detail page (content full-screen, no sidebar). Reset to list when
  // we detect "external" navigation (rail tap, deep link), distinguished
  // from our own intentional push via lastPushedPathRef.
  const [phonePickedTool, setPhonePickedTool] = useState(false)
  const lastPushedPathRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isIPhoneIosSurface) return
    if (location.pathname === lastPushedPathRef.current) {
      lastPushedPathRef.current = null  // consume the marker
      return
    }
    // External navigation (rail tap re-entered Tools, etc.) — reset to list.
    setPhonePickedTool(false)
  }, [location.pathname, isIPhoneIosSurface])

  const phoneListMode = isIPhoneIosSurface && !phonePickedTool
  const phoneDetailMode = isIPhoneIosSurface && phonePickedTool

  // Cascade back handler — when user presses native back chevron / edge-swipe,
  // return to the tools list (full-screen sidebar). React renders the same
  // Outlet underneath but it's hidden by the list layout.
  useNativeBackHandlerBlock({
    active: phoneDetailMode,
    onBack: () => {
      setPhonePickedTool(false)
    },
  })

  const handlePhoneToolTap = useCallback((to: string) => (e: React.MouseEvent) => {
    if (!(isCapacitorNative() && isIPhoneIosSurface)) return
    e.preventDefault()
    lastPushedPathRef.current = to
    void (async () => {
      try {
        await setNativeNavigationStackBlock(['/personal-tools'])
        await pushNativeWithForwardBlock('/personal-tools', () => {
          setPhonePickedTool(true)
          navigate(to)
        })
      } catch (err) {
        console.warn('[ToolsShell] phone push failed, falling back to navigate', err)
        setPhonePickedTool(true)
        navigate(to)
      }
    })()
  }, [isIPhoneIosSurface, navigate])

  useEffect(() => {
    dispatchToolsSidebarChromeStateBlock({ enabled: true, collapsed: sidebarCollapsed, label: 'Tools' })
    return () => {
      dispatchToolsSidebarChromeStateBlock({ enabled: false, collapsed: false, label: 'Tools' })
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    const handler = () => setSidebarCollapsed(prev => !prev)
    window.addEventListener(TOOLS_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
    return () => window.removeEventListener(TOOLS_SIDEBAR_CHROME_TOGGLE_EVENT_BLOCK, handler)
  }, [setSidebarCollapsed])

  return (
    <div className="ltm-tools-shell flex h-full min-h-0 w-full">
      {/* On iPhone, the desktop collapse state is ignored — list/detail mode
          is the sole authority. Sidebar always shows in list mode. */}
      {!phoneDetailMode && (
      <aside
        className={cn(
          'ltm-tools-shell-nav overflow-hidden',
          phoneListMode
            ? 'flex-1'
            : cn(
                'shrink-0 transition-[width,opacity] duration-200 ease-out',
                sidebarCollapsed ? 'w-0 opacity-0' : 'w-[220px] opacity-100',
              ),
        )}
        aria-hidden={!phoneListMode && sidebarCollapsed}
      >
      <div
        className={cn(
          'h-full overflow-y-auto border-border/60 bg-background/40 px-3 py-4',
          phoneListMode ? 'w-full' : 'w-[220px] border-r',
          !phoneListMode && sidebarCollapsed && 'pointer-events-none',
        )}
      >
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Tools
        </p>
        <nav className="space-y-1">
          {visibleSubtabs.map((tab) => {
            const Icon = tab.icon
            const active = tab.isActive(location.pathname)
            return (
              <Link
                key={tab.id}
                to={tab.to}
                onClick={handlePhoneToolTap(tab.to)}
                className={`ltm-motion-fast flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  active && !phoneListMode
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{tab.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
      </aside>
      )}
      <div className={`ltm-tools-shell-content min-w-0 overflow-auto ${phoneListMode ? 'hidden' : 'flex-1'}`}>
        <Outlet />
      </div>
    </div>
  )
}
