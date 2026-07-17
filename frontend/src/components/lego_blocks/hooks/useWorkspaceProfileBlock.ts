import { useEffect, useState } from 'react'
import {
  getCurrentWorkspaceProfileBlock,
  isWorkspaceProfilesSupportedBlock,
  subscribeWorkspaceProfileChangedBlock,
  updateWorkspaceProfileBlock,
  type WorkspaceProfileBlock,
} from '@/services/lego_blocks/units/profileContextBlock'
import { readCachedUserProfileBlock } from '@/services/lego_blocks/units/userProfileBlock'

/**
 * This window's workspace profile, kept live across renames/recolors, with the
 * accent color mirrored onto the document root so CSS can tint the shell:
 *   --ltm-profile-accent          (CSS custom property)
 *   data-ltm-profile-accent       (presence marker for selectors)
 */
export function useWorkspaceProfileBlock(): WorkspaceProfileBlock {
  const [profile, setProfile] = useState<WorkspaceProfileBlock>(() => getCurrentWorkspaceProfileBlock())

  useEffect(() => subscribeWorkspaceProfileChangedBlock(setProfile), [])

  // Personalize the default profile's synthesized "Main" name from the name
  // the user entered in Settings → Profile ("Anurag Patil" → "Anurag's Space").
  // Only the literal "Main" is upgraded, so a deliberate rename always sticks.
  useEffect(() => {
    if (!isWorkspaceProfilesSupportedBlock()) return
    const current = getCurrentWorkspaceProfileBlock()
    if (!current.isDefault || current.name !== 'Main') return
    const userName = readCachedUserProfileBlock().name.trim()
    if (!userName || userName === 'You') return
    const firstName = userName.split(/\s+/)[0]
    if (!firstName) return
    void updateWorkspaceProfileBlock({ id: current.id, name: `${firstName}'s Space` })
      .then(setProfile)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (profile.accentColor) {
      root.style.setProperty('--ltm-profile-accent', profile.accentColor)
      root.setAttribute('data-ltm-profile-accent', 'true')
    } else {
      root.style.removeProperty('--ltm-profile-accent')
      root.removeAttribute('data-ltm-profile-accent')
    }
  }, [profile.accentColor])

  return profile
}
