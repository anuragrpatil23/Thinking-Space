import { useEffect, useMemo, useState } from 'react'
import {
  loadWebullTrackRecordSourceBlock,
  type WebullTrackRecordSourceBlock,
} from '@/personal_extension/services/lego_blocks/integrations/webullTrackRecordVaultBlock'
import {
  companyTrackRecordBlock,
  overallTrackRecordBlock,
  type WebullCompanyTrackRecordBlock,
  type WebullOverallTrackRecordBlock,
} from '@/personal_extension/services/lego_blocks/units/webullTrackRecordBlock'

/** One company's track record from the statements, plus where the full report lives. */
export function useWebullTrackRecordBlock(executionRoot: string | null, ticker: string): {
  record: WebullCompanyTrackRecordBlock | null
  reportPath: string | null
} {
  const [source, setSource] = useState<WebullTrackRecordSourceBlock | null>(null)

  useEffect(() => {
    if (!executionRoot) return
    let cancelled = false
    void loadWebullTrackRecordSourceBlock(executionRoot).then(next => { if (!cancelled) setSource(next) })
    return () => {
      cancelled = true
    }
  }, [executionRoot])

  const record = useMemo(
    () => (source && ticker ? companyTrackRecordBlock({ ticker, lots: source.lots, stock: source.stock, lastStatement: source.lastStatement }) : null),
    [source, ticker],
  )
  return { record, reportPath: source?.reportPath ?? null }
}

/** The track record across every company, for Overall. */
export function useWebullOverallTrackRecordBlock(executionRoot: string | null): {
  record: WebullOverallTrackRecordBlock | null
  reportPath: string | null
} {
  const [source, setSource] = useState<WebullTrackRecordSourceBlock | null>(null)

  useEffect(() => {
    if (!executionRoot) return
    let cancelled = false
    void loadWebullTrackRecordSourceBlock(executionRoot).then(next => { if (!cancelled) setSource(next) })
    return () => {
      cancelled = true
    }
  }, [executionRoot])

  const record = useMemo(
    () => (source ? overallTrackRecordBlock({ lots: source.lots, stock: source.stock, lastStatement: source.lastStatement }) : null),
    [source],
  )
  return { record, reportPath: source?.reportPath ?? null }
}
