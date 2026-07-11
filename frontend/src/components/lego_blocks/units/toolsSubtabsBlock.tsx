import { type ComponentType } from 'react'
import { BadgeCheck, Bot, Boxes, GitBranch, Globe, Handshake, KeyRound, Terminal as TerminalIcon, Wrench } from 'lucide-react'
import excalidrawLogo from '@/assets/excalidraw-logo.svg'
import { isExcalidrawPlusRoute } from '@/components/lego_blocks/units/ExcalidrawPlusRoutesBlock'
import { isEmbeddedTerminalSupported } from '@/services/orchestrators/runtimeOrch'

export interface ToolsSubtab {
  id: string
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  isActive: (pathname: string) => boolean
  visible?: () => boolean
  // routed === true → renders inside ToolsShellBlock's <Outlet/>.
  // routed === false → a persistent full-screen surface (AI, Web) mounted
  // outside the router; it still appears in the switcher but isn't a shell child.
  routed: boolean
}

export function ExcalidrawPlusIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-block`}
      style={{
        backgroundColor: 'currentColor',
        maskImage: `url(${excalidrawLogo})`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskImage: `url(${excalidrawLogo})`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}

export const TOOLS_SUBTABS: readonly ToolsSubtab[] = [
  {
    id: 'ai',
    label: 'AI',
    to: '/ai/chat',
    icon: Bot,
    isActive: (pathname) => pathname === '/ai/chat' || pathname.startsWith('/ai/'),
    routed: false,
  },
  {
    id: 'web',
    label: 'Web',
    to: '/web',
    icon: Globe,
    isActive: (pathname) => pathname === '/web',
    routed: false,
  },
  {
    id: 'insights',
    label: 'Insights',
    to: '/git-insights',
    icon: GitBranch,
    isActive: (pathname) => pathname === '/git-insights',
    routed: true,
  },
  {
    id: 'excalidraw-plus',
    label: 'Excalidraw++',
    to: '/excalidraw-plus',
    icon: ExcalidrawPlusIcon,
    isActive: isExcalidrawPlusRoute,
    routed: true,
  },
  {
    id: 'capabilities',
    label: 'AI Capabilities',
    to: '/capabilities',
    icon: Boxes,
    isActive: (pathname) => pathname === '/capabilities' || pathname === '/extension-builder',
    routed: true,
  },
  {
    id: 'ai-steward',
    label: 'AI Steward',
    to: '/ai-steward',
    icon: Handshake,
    isActive: (pathname) => pathname === '/ai-steward',
    routed: true,
  },
  {
    id: 'ai-integrity',
    label: 'AI Integrity Fix',
    to: '/ai-integrity',
    icon: BadgeCheck,
    isActive: (pathname) => pathname === '/ai-integrity',
    routed: true,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    to: '/terminal',
    icon: TerminalIcon,
    isActive: (pathname) => pathname === '/terminal',
    visible: () => isEmbeddedTerminalSupported(),
    routed: true,
  },
  {
    id: 'password-manager',
    label: 'Passwords',
    to: '/password-manager',
    icon: KeyRound,
    isActive: (pathname) => pathname === '/password-manager',
    routed: true,
  },
  {
    id: 'personal-tools',
    label: 'Heading Assignments',
    to: '/personal-tools',
    icon: Wrench,
    isActive: (pathname) => pathname === '/personal-tools' || pathname === '/personal-extension',
    routed: true,
  },
]

export function getVisibleToolsSubtabs(): ToolsSubtab[] {
  return TOOLS_SUBTABS.filter(tab => (tab.visible ? tab.visible() : true))
}

// Only routed subtabs render through ToolsShellBlock's <Outlet/>; the persistent
// AI/Web surfaces live elsewhere, so they must not count as a shell route.
export function isToolsShellRoute(pathname: string): boolean {
  return TOOLS_SUBTABS.some(tab => tab.routed && tab.isActive(pathname))
}
