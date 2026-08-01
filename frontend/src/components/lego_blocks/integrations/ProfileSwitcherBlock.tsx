import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  isWorkspaceProfilesSupportedBlock,
  listWorkspaceProfilesBlock,
  openWorkspaceProfileWindowBlock,
  type WorkspaceProfileBlock,
} from '@/services/lego_blocks/units/profileContextBlock'
import { useWorkspaceProfileBlock } from '@/components/lego_blocks/hooks/useWorkspaceProfileBlock'
import { ProfileAvatarIconBlock } from '@/components/lego_blocks/units/ProfileAvatarIconBlock'

// Chrome-style profile avatar for the sidebar rail bottom: shows the current
// profile's glyph inside its accent ring; clicking opens a switcher menu
// listing every profile (click → that profile's window) plus a link to
// Settings → Thinking Space Profiles. Falls back to a plain Settings link
// off-desktop.

const AVATAR_FALLBACK_RING_BLOCK = 'var(--ltm-shell-surface-border, #d4d4d8)'

export function profileAvatarFallbackTextBlock(profile: Pick<WorkspaceProfileBlock, 'name'>): string {
  const initial = profile.name.trim().charAt(0)
  return initial ? initial.toUpperCase() : '•'
}

function ProfileAvatarFaceBlock({
  profile,
  sizeClassName,
}: {
  profile: Pick<WorkspaceProfileBlock, 'name' | 'icon' | 'accentColor'>
  sizeClassName: string
}) {
  return (
    <span
      className={`inline-flex ${sizeClassName} shrink-0 items-center justify-center rounded-full border-2 bg-background text-[13px] font-semibold leading-none`}
      style={{
        borderColor: profile.accentColor ?? AVATAR_FALLBACK_RING_BLOCK,
        color: profile.accentColor ?? 'inherit',
      }}
    >
      <ProfileAvatarIconBlock icon={profile.icon} fallbackText={profileAvatarFallbackTextBlock(profile)} />
    </span>
  )
}

export function ProfileSwitcherBlock() {
  const currentProfile = useWorkspaceProfileBlock()
  const supported = isWorkspaceProfilesSupportedBlock()
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<WorkspaceProfileBlock[]>([])
  const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number }>({ left: 72, bottom: 16 })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const toggleMenu = useCallback(() => {
    setOpen((prev) => {
      if (prev) return false
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        setMenuPosition({
          left: Math.round(rect.right + 10),
          bottom: Math.round(Math.max(12, window.innerHeight - rect.bottom)),
        })
      }
      void listWorkspaceProfilesBlock().then(setProfiles).catch(() => setProfiles([]))
      return true
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const switchTo = useCallback(async (profile: WorkspaceProfileBlock) => {
    setOpen(false)
    if (profile.id === currentProfile.id) return
    await openWorkspaceProfileWindowBlock(profile.id).catch(() => undefined)
  }, [currentProfile.id])

  if (!supported) {
    return (
      <Link
        to="/settings?tab=workspace_profiles"
        aria-label="Thinking Space Profiles"
        className="ltm-motion-fast ltm-rail-item inline-flex h-10 w-full items-center justify-center rounded-lg transition-colors"
      >
        <ProfileAvatarFaceBlock profile={currentProfile} sizeClassName="h-7 w-7" />
      </Link>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        aria-label={`Profile: ${currentProfile.name}`}
        aria-expanded={open}
        className="ltm-motion-fast ltm-rail-item inline-flex h-10 w-full items-center justify-center rounded-lg transition-transform hover:scale-105"
      >
        <ProfileAvatarFaceBlock profile={currentProfile} sizeClassName="h-7 w-7" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[80] w-[240px] rounded-xl border border-border bg-background p-1.5 text-sm shadow-lg [-webkit-app-region:no-drag]"
          style={{ left: `${menuPosition.left}px`, bottom: `${menuPosition.bottom}px` }}
          role="menu"
        >
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Thinking Space Profiles
          </p>
          {profiles.map((profile) => {
            const isCurrent = profile.id === currentProfile.id
            return (
              <button
                key={profile.id}
                type="button"
                role="menuitem"
                onClick={() => void switchTo(profile)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <ProfileAvatarFaceBlock profile={profile} sizeClassName="h-6 w-6" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{profile.name}</span>
                {isCurrent ? (
                  <span className="text-[10px] text-muted-foreground">this window</span>
                ) : profile.openWindowCount > 0 ? (
                  <span className="text-[10px] text-muted-foreground">open</span>
                ) : null}
              </button>
            )
          })}
          <div className="my-1 h-px bg-border" />
          <Link
            to="/settings?tab=workspace_profiles"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Manage Thinking Space Profiles…
          </Link>
        </div>,
        document.body,
      )}
    </>
  )
}
