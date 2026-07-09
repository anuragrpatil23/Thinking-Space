import { Eye, EyeOff, PanelLeft, PanelLeftClose } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SidebarChromeBlock } from '@/services/lego_blocks/units/sidebarChromeBlock'

export interface SidebarChromeButtonLabels {
  show: string
  hide: string
}

export interface SidebarChromeButtonBlockProps {
  block: SidebarChromeBlock<any>
  collapsed: boolean
  toggleLabels: SidebarChromeButtonLabels
  headerVisible?: boolean
  showHeaderToggle?: boolean
  headerToggleLabels?: SidebarChromeButtonLabels
  variant?: 'default' | 'soft'
  wrap?: boolean
}

const BASE_BUTTON_CLASS = 'ltm-sidebar-chrome-toggle ltm-motion-fast inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground'

const VARIANT_CLASSES: Record<NonNullable<SidebarChromeButtonBlockProps['variant']>, string> = {
  default: 'border border-border/60 bg-background/85',
  soft: 'border border-border/50 bg-background/75 hover:bg-background/90',
}

export default function SidebarChromeButtonBlock({
  block,
  collapsed,
  toggleLabels,
  headerVisible,
  showHeaderToggle,
  headerToggleLabels,
  variant = 'default',
  wrap = true,
}: SidebarChromeButtonBlockProps) {
  const toggleLabel = collapsed ? toggleLabels.show : toggleLabels.hide
  const showHeaderBtn = Boolean(headerToggleLabels && showHeaderToggle)
  const headerLabel = headerToggleLabels
    ? (headerVisible ? headerToggleLabels.hide : headerToggleLabels.show)
    : ''
  const variantClass = VARIANT_CLASSES[variant]
  const variantClassHeader = VARIANT_CLASSES.default

  const buttons = (
    <>
      <button
        type="button"
        onClick={block.dispatchToggle}
        className={cn(BASE_BUTTON_CLASS, variantClass)}
        aria-label={toggleLabel}
        title={toggleLabel}
      >
        {collapsed ? <PanelLeft className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>
      {showHeaderBtn && (
        <button
          type="button"
          onClick={block.dispatchToggleHeader}
          className={cn(BASE_BUTTON_CLASS, variantClassHeader)}
          aria-label={headerLabel}
          title={headerLabel}
        >
          {headerVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
    </>
  )

  if (!wrap) return buttons
  return <div className="inline-flex items-center gap-2">{buttons}</div>
}
