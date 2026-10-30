import { useEffect, useState } from 'react'
import { readWebullArchivedPositionsBlock } from '@/personal_extension/services/lego_blocks/integrations/webullExecutionStorageBlock'
import { closedPositionsBlock, type WebullClosedPositionBlock } from '@/personal_extension/services/lego_blocks/units/webullClosedPositionsBlock'

/** One company's closed positions, read from its archived_positions folder. */
export function useWebullClosedPositionsBlock(executionRoot: string | null, ticker: string): WebullClosedPositionBlock[] {
  const [rows, setRows] = useState<WebullClosedPositionBlock[]>([])
  useEffect(() => {
    setRows([])
    if (!executionRoot || !ticker) return
    let cancelled = false
    void readWebullArchivedPositionsBlock(executionRoot, ticker)
      .then(list => { if (!cancelled) setRows(closedPositionsBlock(list)) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => {
      cancelled = true
    }
  }, [executionRoot, ticker])
  return rows
}
