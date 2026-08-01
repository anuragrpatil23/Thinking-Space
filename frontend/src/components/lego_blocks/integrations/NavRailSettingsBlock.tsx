import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  SETTINGS_PANE_WIDTH_BLOCK,
  SettingsGroupBlock,
  SettingsRowBlock,
  SettingsSectionHeaderBlock,
} from '@/components/lego_blocks/units/SettingsGroupBlock'
import { cn } from '@/lib/utils'
import {
  applyNavRailPrefsBlock,
  getNavRailPrefsBlock,
  moveNavRailItemBlock,
  NAV_RAIL_MANAGEABLE_ITEMS_BLOCK,
  NAV_RAIL_PREFS_EVENT,
  resetNavRailPrefsBlock,
  setNavRailHomePositionBlock,
  setNavRailItemHiddenBlock,
  type NavRailPrefsBlock,
} from '@/services/lego_blocks/units/navRailPrefsBlock'

// Per-profile sidebar customization: reorder or hide the main rail icons.
// Hidden pages stay routable and in the ⌘K palette — this only shapes the rail.

export function NavRailSettingsBlock({ webullLabel }: { webullLabel?: string }) {
  const [prefs, setPrefs] = useState<NavRailPrefsBlock>(() => getNavRailPrefsBlock())

  useEffect(() => {
    const listener = () => setPrefs(getNavRailPrefsBlock())
    window.addEventListener(NAV_RAIL_PREFS_EVENT, listener)
    return () => window.removeEventListener(NAV_RAIL_PREFS_EVENT, listener)
  }, [])

  const labelFor = useCallback((id: string, fallback: string) => {
    if (id === '/webull' && webullLabel?.trim()) return webullLabel.trim()
    return fallback
  }, [webullLabel])

  const renderGroup = (group: 'primary' | 'tools', heading: string) => {
    const groupItems = NAV_RAIL_MANAGEABLE_ITEMS_BLOCK.filter((item) => item.group === group)
    // Display order = prefs-ordered, but including hidden items so they can be
    // toggled back on from where they'd reappear.
    const orderedVisible = applyNavRailPrefsBlock(
      groupItems.map((item) => ({ to: item.id })),
      { order: prefs.order, hidden: [], homePosition: prefs.homePosition },
    ).map((entry) => entry.to)
    return (
      <SettingsGroupBlock heading={heading}>
        {orderedVisible.map((id, index) => {
          const item = groupItems.find((entry) => entry.id === id)
          if (!item) return null
          const hidden = prefs.hidden.includes(id)
          return (
            <SettingsRowBlock
              key={id}
              label={(
                <span className={cn('block truncate', hidden && 'text-muted-foreground line-through')}>
                  {labelFor(id, item.label)}
                </span>
              )}
              control={(
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    aria-label={`Move ${item.label} up`}
                    onClick={() => moveNavRailItemBlock(orderedVisible, id, 'up')}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={index === orderedVisible.length - 1}
                    aria-label={`Move ${item.label} down`}
                    onClick={() => moveNavRailItemBlock(orderedVisible, id, 'down')}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                    onClick={() => setNavRailItemHiddenBlock(id, !hidden)}
                  >
                    {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </>
              )}
            />
          )
        })}
      </SettingsGroupBlock>
    )
  }

  return (
    <>
      <SettingsSectionHeaderBlock
        title="Navigation"
        description={(
          <>
            Reorder or hide sidebar icons for this profile. Hidden pages stay reachable from quick
            search (⌘K) — this only shapes the rail. Shortcuts ⌘1…⌘{'n'} follow the visible order.
          </>
        )}
      />

      <SettingsGroupBlock heading="Home glyph">
        <SettingsRowBlock
          label="Home position"
          control={(
            <>
              <Button
                type="button"
                variant={prefs.homePosition !== 'bottom' ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={prefs.homePosition !== 'bottom'}
                onClick={() => setNavRailHomePositionBlock('top')}
              >
                Top
              </Button>
              <Button
                type="button"
                variant={prefs.homePosition === 'bottom' ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={prefs.homePosition === 'bottom'}
                onClick={() => setNavRailHomePositionBlock('bottom')}
              >
                Bottom
              </Button>
            </>
          )}
        />
      </SettingsGroupBlock>

      {renderGroup('primary', 'Main rail')}
      {renderGroup('tools', 'Tools group')}

      <div className={cn(SETTINGS_PANE_WIDTH_BLOCK, 'flex flex-wrap gap-2')}>
        <Button type="button" variant="outline" size="sm" onClick={resetNavRailPrefsBlock}>
          Reset to Default
        </Button>
      </div>
    </>
  )
}
