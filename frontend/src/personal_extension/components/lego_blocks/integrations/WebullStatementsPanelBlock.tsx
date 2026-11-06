// Track record → Statements: every Webull statement in the vault by account,
// with the months missing and those the CSVs have not read yet, and a place to
// drop a new one. Dropping files the PDF where the statements skill expects it
// (after you confirm the account and month: the app does not read PDFs); an
// agent then reads it into the CSVs, from the prompt this panel copies.
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { F9PanelBlock } from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import {
  STATEMENT_FOLDERS_BLOCK,
  nextStatementPeriodBlock,
  statementAccountsBlock,
  statementPathBlock,
  statementRowsBlock,
  statementsAgentPromptBlock,
  type StatementAccountBlock,
  type StatementFolderBlock,
  type StatementRowBlock,
} from '@/personal_extension/services/lego_blocks/units/webullStatementsBlock'

const monthWord = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ym)
const dayWord = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const FIELD = 'rounded-[8px] border border-black/[0.08] bg-white px-2 py-1 text-[13px] outline-none focus:border-sky-500 dark:border-white/[0.1] dark:bg-zinc-900'

const STATUS_TONE: Record<StatementRowBlock['status'], { label: string; dot: string; tint: string }> = {
  read: { label: 'Read', dot: 'bg-emerald-500', tint: 'bg-emerald-50 dark:bg-emerald-500/10' },
  waiting: { label: 'Waiting to be read', dot: 'bg-sky-500', tint: 'bg-sky-50 dark:bg-sky-500/10' },
  missing: { label: 'Missing', dot: 'bg-amber-500', tint: 'bg-amber-50 dark:bg-amber-500/10' },
  filed: { label: 'Filed', dot: 'bg-zinc-400', tint: 'bg-zinc-100 dark:bg-zinc-800' },
}

export default function WebullStatementsPanelBlock({ executionRoot, onOpenFile }: { executionRoot: string; onOpenFile: (path: string) => void }) {
  const root = `${executionRoot.replace(/\/+$/, '')}/statements`
  const [accounts, setAccounts] = useState<StatementAccountBlock[] | null>(null)
  const [rows, setRows] = useState<StatementRowBlock[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ file: File; folder: StatementFolderBlock; period: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    const fs = getVaultFS()
    const folders = STATEMENT_FOLDERS_BLOCK.map(f => f.folder)
    const lists = await Promise.all(folders.map(f => fs.list(`${root}/webull/${f}`).then(l => l.files).catch(() => [] as string[])))
    const [periods, trades] = await Promise.all([
      fs.read(`${root}/webull-statement-periods.csv`).catch(() => null),
      fs.read(`${root}/webull-trades.csv`).catch(() => null),
    ])
    const next = statementAccountsBlock(Object.fromEntries(folders.map((f, i) => [f, lists[i]])) as Record<StatementFolderBlock, string[]>, periods)
    setAccounts(next)
    setRows(statementRowsBlock(next, periods, trades))
  }, [root])
  useEffect(() => { void load().catch(err => setError(err instanceof Error ? err.message : String(err))) }, [load])

  const take = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) { setError(`${file.name} is not a PDF.`); return }
    setError(null)
    const folder: StatementFolderBlock = /ira/i.test(file.name) ? 'ira' : 'individual'
    setPending({ file, folder, period: nextStatementPeriodBlock(accounts?.find(a => a.folder === folder)) })
  }

  const file = async () => {
    if (!pending) return
    const rel = statementPathBlock(pending.folder, pending.period)
    const path = `${root}/${rel}`
    setSaving(true)
    setError(null)
    try {
      const fs = getVaultFS()
      // Never over a statement already filed: that month is taken.
      if (await fs.exists(path)) throw new Error(`${rel} is already there. Pick the month printed on the statement.`)
      await fs.mkdir(path.slice(0, path.lastIndexOf('/'))).catch(() => undefined)
      await fs.writeBytes(path, new Uint8Array(await pending.file.arrayBuffer()))
      setPending(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const waiting = (accounts ?? []).flatMap(a => a.waiting)
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(statementsAgentPromptBlock(root, waiting)).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <F9PanelBlock className="grid gap-6 p-5 text-[13px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="min-w-0 space-y-4">
        {accounts === null ? <p className="text-zinc-500">Reading the statements folder…</p>
          : rows.length === 0 ? <p className="text-zinc-500">No statements in {root}/webull yet.</p>
            : (
              <div className="max-h-[320px] overflow-y-auto rounded-[10px] ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 z-[1] bg-card [&_th]:border-b-[0.5px] [&_th]:border-[#E5E5EA] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:text-zinc-500 dark:[&_th]:border-zinc-800">
                    <tr><th className="!pl-4">Statement</th><th>Account</th><th>Covers</th><th className="!text-right">Trades</th><th className="!pr-4">Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr
                        key={r.key}
                        onClick={r.path ? () => onOpenFile(`${root}/${r.path}`) : undefined}
                        className={cn('[&>td]:border-b-[0.5px] [&>td]:border-[#EFEFF2] [&>td]:px-3 [&>td]:py-2 dark:[&>td]:border-zinc-800/70', r.path && 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50')}
                      >
                        <td className="!pl-4 whitespace-nowrap font-medium tabular-nums">{monthWord(r.period)}</td>
                        <td className="whitespace-nowrap text-zinc-600 dark:text-zinc-300">{r.account}</td>
                        <td className="whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">{r.start && r.end ? `${dayWord(r.start).replace(/, \d{4}$/, '')} – ${dayWord(r.end)}` : ''}</td>
                        <td className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{r.status === 'read' ? r.trades : ''}</td>
                        <td className="!pr-4 whitespace-nowrap">
                          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-200', STATUS_TONE[r.status].tint)}>
                            <span className={cn('h-[7px] w-[7px] rounded-full', STATUS_TONE[r.status].dot)} />{STATUS_TONE[r.status].label}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        {waiting.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-sky-50/70 px-3 py-2.5 dark:bg-sky-500/10">
            <span className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-200">
              {waiting.length} {waiting.length === 1 ? 'statement' : 'statements'} waiting for an agent to read into the CSVs.
            </span>
            <button type="button" onClick={() => { void copyPrompt() }} className="rounded-[8px] bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900">
              {copied ? 'Copied' : 'Copy the prompt for an agent'}
            </button>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {pending ? (
          <div className="space-y-3 rounded-[12px] border border-black/[0.06] p-4 dark:border-white/[0.08]">
            <p className="truncate font-medium" title={pending.file.name}>{pending.file.name}</p>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Which account, and the month printed on it?</p>
            <div className="flex flex-wrap gap-2">
              <select value={pending.folder} onChange={e => { const folder = e.target.value as StatementFolderBlock; setPending({ ...pending, folder, period: nextStatementPeriodBlock(accounts?.find(a => a.folder === folder)) }) }} className={FIELD}>
                {STATEMENT_FOLDERS_BLOCK.filter(f => f.folder !== 'individual/apex').map(f => <option key={f.folder} value={f.folder}>{f.label}</option>)}
              </select>
              <input
                type={pending.folder === 'tax' ? 'number' : 'month'}
                value={pending.folder === 'tax' ? pending.period.slice(0, 4) : pending.period}
                onChange={e => setPending({ ...pending, period: e.target.value })}
                className={cn(FIELD, 'tabular-nums')}
              />
            </div>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Filed as statements/{statementPathBlock(pending.folder, pending.folder === 'tax' ? pending.period.slice(0, 4) : pending.period)}</p>
            <div className="flex gap-2">
              <button type="button" disabled={saving || !pending.period} onClick={() => { void file() }} className="rounded-[8px] bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900">
                {saving ? 'Filing…' : 'File it'}
              </button>
              <button type="button" onClick={() => { setPending(null); setError(null) }} className="rounded-[8px] px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files) }}
            className={cn(
              'flex h-full min-h-[140px] w-full flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed px-4 text-center transition-colors',
              dragging ? 'border-sky-500 bg-sky-50/70 dark:bg-sky-500/10' : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50',
            )}
          >
            <span className="font-medium">Drop a Webull statement here</span>
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400">or click to choose a PDF</span>
          </button>
        )}
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { take(e.target.files); e.target.value = '' }} />
        {error && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </F9PanelBlock>
  )
}
