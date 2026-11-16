import { useEffect, useState } from 'react'
import { loadPrivatePositionBoughtBlock } from '@/personal_extension/components/lego_blocks/units/privatePersonalBlock'
import type { PositionBoughtBlock } from '@/personal_extension/services/lego_blocks/units/webullPositionBoughtBlock'

/** When each held position was bought, keyed as positionBoughtKeyBlock; read again whenever `refreshKey` changes (a new sync). */
export function usePositionBoughtBlock(executionRoot: string | null, refreshKey?: string | null): Record<string, PositionBoughtBlock> {
  const [bought, setBought] = useState<Record<string, PositionBoughtBlock>>({})
  useEffect(() => {
    if (!executionRoot) { setBought({}); return }
    let cancelled = false
    void loadPrivatePositionBoughtBlock(executionRoot).then(next => { if (!cancelled) setBought(next) })
    return () => { cancelled = true }
  }, [executionRoot, refreshKey])
  return bought
}
