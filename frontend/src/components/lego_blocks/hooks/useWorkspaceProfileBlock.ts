import { useEffect, useState } from 'react'
import {
  getCurrentWorkspaceProfileBlock,
  subscribeWorkspaceProfileChangedBlock,
  type WorkspaceProfileBlock,
} from '@/services/lego_blocks/units/profileContextBlock'

/**
 * This window's workspace profile, kept live across renames/recolors, with the
 * accent color mirrored onto the document root so CSS can tint the shell:
 *   --ltm-profile-accent          (CSS custom property)
 *   data-ltm-profile-accent       (presence marker for selectors)
 */
export function useWorkspaceProfileBlock(): WorkspaceProfileBlock {
  const [profile, setProfile] = useState<WorkspaceProfileBlock>(() => getCurrentWorkspaceProfileBlock())

  useEffect(() => subscribeWorkspaceProfileChangedBlock(setProfile), [])

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
