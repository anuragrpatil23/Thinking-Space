// Read the Webull statement CSVs (written by kai-workspace/F9/tools/
// webull_statements_to_csv.py) and turn them into option lots and share totals.
// Read-only; loaded once per execution root and shared by every company page.

import { getFileContent } from '@/services/orchestrators/fileSystemOrch'
import {
  buildOptionLotsBlock,
  parseCsvBlock,
  stockByCompanyBlock,
  type WebullOptionLotBlock,
} from '../units/webullTrackRecordBlock'

export interface WebullTrackRecordSourceBlock {
  lots: WebullOptionLotBlock[]
  stock: Map<string, { bought: number; sold: number; held: number; net: number }>
  lastStatement: string
  /** The long-form report the script writes, for "Full history". */
  reportPath: string
}

const cache = new Map<string, Promise<WebullTrackRecordSourceBlock | null>>()

async function loadBlock(executionRoot: string): Promise<WebullTrackRecordSourceBlock | null> {
  const folder = `${executionRoot}/statements`
  try {
    const [trades, monthEnds] = await Promise.all([
      getFileContent(`${folder}/webull-trades.csv`).then(r => parseCsvBlock(r.content)),
      getFileContent(`${folder}/webull-month-end.csv`).then(r => parseCsvBlock(r.content)),
    ])
    const { lots, lastStatement } = buildOptionLotsBlock(trades, monthEnds)
    return { lots, stock: stockByCompanyBlock(trades, monthEnds, lastStatement), lastStatement, reportPath: `${folder}/options-history.html` }
  } catch {
    // No statements exported yet: the company page simply shows no track record.
    return null
  }
}

export function loadWebullTrackRecordSourceBlock(executionRoot: string): Promise<WebullTrackRecordSourceBlock | null> {
  const root = executionRoot.trim().replace(/\/+$/, '')
  let pending = cache.get(root)
  if (!pending) {
    pending = loadBlock(root)
    cache.set(root, pending)
  }
  return pending
}
