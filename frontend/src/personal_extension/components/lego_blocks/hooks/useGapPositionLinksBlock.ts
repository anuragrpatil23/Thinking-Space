import { useEffect, useState } from 'react'
import { loadPrivateGapPositionLinksBlock } from '@/personal_extension/components/lego_blocks/units/privatePersonalBlock'
import type { GapPositionLinkBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'

/** Fired on window by the private Gaps folder after it writes any gap's positions log. */
const GAP_POSITIONS_CHANGED_EVENT = 'f9:gap-positions-changed'

/**
 * Every gap's positions, for showing which gap holds a position; empty without
 * the private Gaps folder. Read again when a gap's positions change, and
 * whenever `refreshKey` does (the table's own refresh).
 */
export function useGapPositionLinksBlock(executionRoot: string | null, refreshKey?: string | null): GapPositionLinkBlock[] {
  const [links, setLinks] = useState<GapPositionLinkBlock[]>([])
  const [changes, setChanges] = useState(0)
  useEffect(() => {
    const onChanged = () => setChanges(n => n + 1)
    window.addEventListener(GAP_POSITIONS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(GAP_POSITIONS_CHANGED_EVENT, onChanged)
  }, [])
  useEffect(() => {
    if (!executionRoot) { setLinks([]); return }
    let cancelled = false
    void loadPrivateGapPositionLinksBlock(executionRoot).then(next => { if (!cancelled) setLinks(next) })
    return () => { cancelled = true }
  }, [executionRoot, refreshKey, changes])
  return links
}
