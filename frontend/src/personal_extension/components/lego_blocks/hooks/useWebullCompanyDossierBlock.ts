import { useEffect, useState } from 'react'
import {
  loadWebullCompanyDossierBlock,
  type WebullCompanyDossierBlock,
} from '@/personal_extension/services/lego_blocks/integrations/webullCompanyDossierVaultBlock'

/** Load a company's page from the vault whenever the company changes. */
export function useWebullCompanyDossierBlock(executionRoot: string | null, ticker: string, companyName: string | null) {
  const [dossier, setDossier] = useState<WebullCompanyDossierBlock | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!executionRoot || !ticker) {
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
  }, [companyName, executionRoot, ticker])

  return { dossier, loading, error }
}
