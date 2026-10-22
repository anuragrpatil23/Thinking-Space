import { useEffect, useMemo, useState } from 'react'
import {
  loadWebullCompanyUniverseSourcesBlock,
  type WebullCompanyUniverseSourcesBlock,
} from '@/personal_extension/services/lego_blocks/integrations/webullCompanyUniverseVaultBlock'
import {
  buildWebullCompanyUniverseBlock,
  type WebullUniverseCompanyBlock,
} from '@/personal_extension/services/lego_blocks/units/webullCompanyUniverseBlock'

/** Every company the vault knows about, grouped held / watchlist / researched. */
export function useWebullCompanyUniverseBlock(
  executionRoot: string | null,
  executionCompanies: Array<{ ticker: string; cost: number }>,
): WebullUniverseCompanyBlock[] {
  const [sources, setSources] = useState<WebullCompanyUniverseSourcesBlock>({ studies: [], research: [] })

  useEffect(() => {
    if (!executionRoot) {
      setSources({ studies: [], research: [] })
      return
    }
    let cancelled = false
    void loadWebullCompanyUniverseSourcesBlock(executionRoot)
      .then(next => { if (!cancelled) setSources(next) })
      .catch(() => { /* the sidebar falls back to held companies */ })
    return () => {
      cancelled = true
    }
  }, [executionRoot])

  return useMemo(() => buildWebullCompanyUniverseBlock({
    executionCompanies,
    studies: sources.studies,
    research: sources.research,
    today: new Date().toISOString().slice(0, 10),
  }), [executionCompanies, sources])
}
