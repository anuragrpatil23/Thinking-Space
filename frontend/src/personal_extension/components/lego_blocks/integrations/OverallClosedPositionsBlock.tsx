// Every closed position across companies, newest close first, on Overall
// Positions: the company page's closed table over all of them. Fifty at a time:
// each row's sale and result are worked out only once it is shown.
import { Suspense, useMemo, useState } from 'react'
import type { WebullCompanyOverviewBlock } from '@/personal_extension/services/lego_blocks/integrations/webullExecutionStorageBlock'
import { closedPositionsBlock, type WebullClosedPositionBlock } from '@/personal_extension/services/lego_blocks/units/webullClosedPositionsBlock'
import type { GapPositionLinkBlock } from '@/personal_extension/services/lego_blocks/units/webullGapLinkMatchBlock'
import { PrivateCompanyPanelsBlock } from '@/personal_extension/components/lego_blocks/units/privatePersonalBlock'
import { ClosedPositionsTableBlock } from './WebullCompanyPageBlock'

const PAGE = 50

export function OverallClosedPositionsBlock({ companies, executionRoot, gapLinks, accountLabel, onOpenFile }: {
  companies: WebullCompanyOverviewBlock[]
  executionRoot: string
  gapLinks: GapPositionLinkBlock[]
  accountLabel?: (accountId: string | null, accountNumber: string | null) => string | null
  onOpenFile: (path: string) => void
}) {
  const [shown, setShown] = useState(PAGE)
  // Each closed row with the company folder its file is in
  const { rows, folderOf } = useMemo(() => {
    const folderOf = new Map<string, string>()
    const rows: WebullClosedPositionBlock[] = []
    for (const c of companies) {
      for (const row of closedPositionsBlock(c.positions.filter(p => p.status === 'archived'))) {
        folderOf.set(row.fileName, c.companyTicker.toUpperCase())
        rows.push(row)
      }
    }
    rows.sort((a, b) => (b.closedOn ?? '').localeCompare(a.closedOn ?? ''))
    return { rows, folderOf }
  }, [companies])
  const root = executionRoot.replace(/\/+$/, '')
  const pathOf = (row: WebullClosedPositionBlock) => `${root}/${folderOf.get(row.fileName) ?? row.symbol}/archived_positions/${row.fileName}`
  const SaleCells = PrivateCompanyPanelsBlock
  if (!rows.length) return <p className="text-sm text-zinc-500">Nothing closed yet.</p>
  return (
    <div className="space-y-2">
      <ClosedPositionsTableBlock
        rows={rows.slice(0, shown)}
        gapLinks={gapLinks}
        accountLabel={accountLabel}
        filePath={pathOf}
        onOpenFile={onOpenFile}
        renderSaleCells={SaleCells ? (row, path) => (
          <Suspense fallback={<><td /><td /></>}>
            <SaleCells slot="closed-row" rowFilePath={path} ticker={folderOf.get(row.fileName) ?? row.symbol} executionRoot={executionRoot} prices={[]} livePrice={null} studyFrontmatter={null} onOpenFile={onOpenFile} />
          </Suspense>
        ) : undefined}
      />
      {rows.length > shown && (
        <button type="button" onClick={() => setShown(n => n + PAGE)} className="text-sm text-sky-600 hover:text-sky-700 dark:text-sky-400">
          Show {Math.min(PAGE, rows.length - shown)} more <span className="text-zinc-500">({rows.length - shown} older)</span>
        </button>
      )}
    </div>
  )
}
