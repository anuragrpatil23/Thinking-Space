import {
  Brain,
  Briefcase,
  Clover,
  House,
  Library,
  Moon,
  Palette,
  Rocket,
  TreePine,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react'

// Profile avatars render as flat line icons, matching the sidebar rail's
// lucide set — a full-color emoji glyph sitting next to monochrome rail icons
// reads as a foreign object. Profiles still STORE the emoji codepoint (that is
// what is on disk for existing profiles and what the OS-level window title
// uses), so this is a render-time mapping only: no migration, and an unknown
// or custom glyph falls back to drawing the emoji as-is.

const PROFILE_ICON_GLYPHS_BLOCK: Record<string, LucideIcon> = {
  '🌳': TreePine,
  '🏠': House,
  '💼': Briefcase,
  '🚀': Rocket,
  '📚': Library,
  '🧠': Brain,
  '🎨': Palette,
  '⚡': Zap,
  '🌊': Waves,
  '🌙': Moon,
  '🍀': Clover,
}

export function profileAvatarIconBlock(icon: string | null | undefined): LucideIcon | null {
  if (!icon) return null
  return PROFILE_ICON_GLYPHS_BLOCK[icon] ?? null
}

/**
 * Draws a profile glyph: a flat lucide icon when the stored value maps to one,
 * otherwise the raw stored text (custom emoji, or a name initial passed as
 * `fallbackText`).
 */
export function ProfileAvatarIconBlock({
  icon,
  fallbackText,
  className = 'h-[15px] w-[15px]',
}: {
  icon: string | null | undefined
  fallbackText: string
  className?: string
}) {
  const Icon = profileAvatarIconBlock(icon)
  if (Icon) return <Icon className={className} strokeWidth={1.75} aria-hidden />
  return <>{icon || fallbackText}</>
}
