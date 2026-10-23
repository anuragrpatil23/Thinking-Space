import { useEffect, useState } from 'react'
import {
  loadWebullCompanyDossierBlock,
  type WebullCompanyDossierBlock,
} from '@/personal_extension/services/lego_blocks/integrations/webullCompanyDossierVaultBlock'

/** Load a company's page from the vault whenever the company changes, or `reloadKey` does. */
export function useWebullCompanyDossierBlock(executionRoot: string | null, ticker: string, companyName: string | null, reloadKey = 0) {
  const [dossier, setDossier] = useState<WebullCompanyDossierBlock | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // A research-only company may have a name but no ticker yet.
    if (!executionRoot || (!ticker && !companyName)) {
      setDossier(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadWebullCompanyDossierBlock({ executionRoot, ticker, companyName })
      .then((next) => {
        if (!cancelled) setDossier(next)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load company page.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyName, executionRoot, reloadKey, ticker])

  return { dossier, loading, error }
}
