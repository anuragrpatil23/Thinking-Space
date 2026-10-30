import { useEffect, useState } from 'react'
import { loadPrivateGapPositionLinksBlock } from '@/personal_extension/components/lego_blocks/units/privatePersonalBlock'
import type { GapPositionLinkBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'

/** Every gap's positions, for showing which gap holds a position; empty without the private Gaps folder. */
export function useGapPositionLinksBlock(executionRoot: string | null): GapPositionLinkBlock[] {
  const [links, setLinks] = useState<GapPositionLinkBlock[]>([])
  useEffect(() => {
    if (!executionRoot) { setLinks([]); return }
    let cancelled = false
    void loadPrivateGapPositionLinksBlock(executionRoot).then(next => { if (!cancelled) setLinks(next) })
    return () => { cancelled = true }
  }, [executionRoot])
  return links
}
