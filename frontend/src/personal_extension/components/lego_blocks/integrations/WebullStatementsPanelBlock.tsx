// Track record → Statements: every Webull statement in the vault (newest first),
// with the months missing and those the CSVs have not read yet, and a place to
// drop new ones. The app does the bookkeeping: a dropped PDF that is already
// here (same bytes, filed or in the inbox) is skipped, a different file with a
// taken name gets a number, and the rest go into statements/inbox/ as they were
// downloaded. The app never looks inside a PDF: an agent reads each one (which
// account, which month), files it and turns it into the CSVs, from the prompt
// this panel copies; the table follows along as the files land.
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { useStatementsChangedBlock } from '@/personal_extension/components/lego_blocks/hooks/useStatementsChangedBlock'
import { F9PanelBlock } from '@/personal_extension/components/lego_blocks/units/F9NativeBlock'
import {
  statementFoldersBlock,
  statementAccountsBlock,
  statementRowsBlock,
  statementsAgentPromptBlock,
  type StatementAccountBlock,
  type StatementFolderBlock,
  type StatementRowBlock,
} from '@/personal_extension/services/lego_blocks/units/webullStatementsBlock'

const monthWord = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ym)
const dayWord = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

type StatusBlock = StatementRowBlock['status'] | 'unsorted'
const STATUS_TONE: Record<StatusBlock, { label: string; dot: string; tint: string }> = {
  unsorted: { label: 'Not read yet', dot: 'bg-violet-500', tint: 'bg-violet-50 dark:bg-violet-500/10' },
  read: { label: 'Read', dot: 'bg-emerald-500', tint: 'bg-emerald-50 dark:bg-emerald-500/10' },
  waiting: { label: 'Not read yet', dot: 'bg-sky-500', tint: 'bg-sky-50 dark:bg-sky-500/10' },
  missing: { label: 'Missing', dot: 'bg-amber-500', tint: 'bg-amber-50 dark:bg-amber-500/10' },
  filed: { label: 'Filed', dot: 'bg-zinc-400', tint: 'bg-zinc-100 dark:bg-zinc-800' },
}

function StatusChipBlock({ status }: { status: StatusBlock }) {
  const t = STATUS_TONE[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-200', t.tint)}>
      <span className={cn('h-[7px] w-[7px] rounded-full', t.dot)} />{t.label}
    </span>
  )
}

const hashOf = async (data: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map(b => b.toString(16).padStart(2, '0')).join('')

export default function WebullStatementsPanelBlock({ executionRoot, onOpenFile }: { executionRoot: string; onOpenFile: (path: string) => void }) {
  const root = `${executionRoot.replace(/\/+$/, '')}/statements`
  const [accounts, setAccounts] = useState<StatementAccountBlock[] | null>(null)
  const [rows, setRows] = useState<StatementRowBlock[]>([])
  const [inbox, setInbox] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  // What a drop did; a skipped duplicate names the file it copies, to open and compare.
  const [notes, setNotes] = useState<Array<{ text: string; dupOf?: { path: string; label: string } }>>([])
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  // Each file's content hash, kept per path: a statement dropped again is caught by its bytes.
  const hashes = useRef(new Map<string, string>())

  const load = useCallback(async () => {
    const fs = getVaultFS()
    // Every account folder under webull/, a new account type (a Roth IRA) included.
    const folders = statementFoldersBlock(await fs.list(`${root}/webull`).then(l => l.folders).catch(() => [] as string[]))
    const [lists, inboxFiles, periods, trades] = await Promise.all([
      Promise.all(folders.map(f => fs.list(`${root}/webull/${f}`).then(l => l.files).catch(() => [] as string[]))),
      fs.list(`${root}/inbox`).then(l => l.files.filter(f => /\.pdf$/i.test(f)).sort()).catch(() => [] as string[]),
      fs.read(`${root}/webull-statement-periods.csv`).catch(() => null),
      fs.read(`${root}/webull-trades.csv`).catch(() => null),
    ])
    const next = statementAccountsBlock(Object.fromEntries(folders.map((f, i) => [f, lists[i]])) as Record<StatementFolderBlock, string[]>, periods)
    setAccounts(next)
    setRows(statementRowsBlock(next, periods, trades))
    setInbox(inboxFiles)
  }, [root])
  useEffect(() => { void load().catch(err => setError(err instanceof Error ? err.message : String(err))) }, [load])
  // An agent reading the inbox and filing statements: show it as it lands.
  useStatementsChangedBlock(executionRoot, () => { void load().catch(() => undefined) }, true)

  const take = async (files: FileList | null) => {
    const all = Array.from(files ?? [])
    const pdfs = all.filter(f => /\.pdf$/i.test(f.name))
    const out: Array<{ text: string; dupOf?: { path: string; label: string } }> = []
    if (all.length > pdfs.length) out.push({ text: `${all.length - pdfs.length} not a PDF, left out.` })
    if (!pdfs.length) { setNotes(out); return }
    setSaving(true)
    setError(null)
    try {
      const fs = getVaultFS()
      // What is already here, by content: filed statements and the inbox.
      const known = new Map<string, { path: string; label: string }>()
      const here = [
        ...rows.filter(r => r.path).map(r => ({ path: `${root}/${r.path}`, label: `${r.path} (${monthWord(r.period)} · ${r.account}, ${r.status === 'read' ? 'read' : 'not read yet'})` })),
        ...inbox.map(name => ({ path: `${root}/inbox/${name}`, label: `inbox/${name} (not read yet)` })),
      ]
      await Promise.all(here.map(async ({ path, label }) => {
        let h = hashes.current.get(path)
        if (!h) {
          const bytes = await fs.readBytes(path).catch(() => null)
          if (!bytes) return
          h = await hashOf(bytes.slice().buffer)
          hashes.current.set(path, h)
        }
        known.set(h, { path, label })
      }))
      const names = new Set(inbox)
      let added = 0
      for (const f of pdfs) {
        const data = await f.arrayBuffer()
        const h = await hashOf(data)
        const dup = known.get(h)
        if (dup) { out.push({ text: `${f.name}: skipped, the same file as`, dupOf: dup }); continue }
        // Keep the download's name; a different file with the same name gets a number.
        let name = f.name
        for (let n = 2; names.has(name); n++) name = f.name.replace(/(\.pdf)$/i, ` ${n}$1`)
        const path = `${root}/inbox/${name}`
        await fs.mkdir(`${root}/inbox`).catch(() => undefined)
        await fs.writeBytes(path, new Uint8Array(data))
        hashes.current.set(path, h)
        known.set(h, { path, label: `inbox/${name} (added just now)` })
        names.add(name)
        added++
      }
      if (added) out.unshift({ text: `${added} ${added === 1 ? 'statement' : 'statements'} added, waiting for an agent to read.` })
      setNotes(out)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const waiting = (accounts ?? []).flatMap(a => a.waiting)
  const toDo = inbox.length + waiting.length
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(statementsAgentPromptBlock(root, inbox, waiting)).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <F9PanelBlock className="grid gap-6 p-5 text-[13px] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-4">
        {accounts === null ? <p className="text-zinc-500">Reading the statements folder…</p>
          : rows.length + inbox.length === 0 ? <p className="text-zinc-500">No statements in {root} yet.</p>
            : (
              <div className="max-h-[320px] overflow-y-auto rounded-[10px] ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 z-[1] bg-card [&_th]:border-b-[0.5px] [&_th]:border-[#E5E5EA] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:text-zinc-500 dark:[&_th]:border-zinc-800">
                    <tr><th className="!pl-4">Statement</th><th>Account</th><th>Covers</th><th className="!text-right">Trades</th><th className="!pr-4">Status</th></tr>
                  </thead>
                  <tbody className="[&>tr>td]:border-b-[0.5px] [&>tr>td]:border-[#EFEFF2] [&>tr>td]:px-3 [&>tr>td]:py-2 dark:[&>tr>td]:border-zinc-800/70">
                    {inbox.map(name => (
                      <tr key={`inbox|${name}`} onClick={() => onOpenFile(`${root}/inbox/${name}`)} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="!pl-4 max-w-[220px] truncate font-medium" title={name}>{name}</td>
                        <td className="text-zinc-400" colSpan={3}>the agent reads which account and month</td>
                        <td className="!pr-4"><StatusChipBlock status="unsorted" /></td>
                      </tr>
                    ))}
                    {rows.map(r => (
                      <tr
                        key={r.key}
                        onClick={r.path ? () => onOpenFile(`${root}/${r.path}`) : undefined}
                        className={cn(r.path && 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50')}
                      >
                        <td className="!pl-4 whitespace-nowrap font-medium tabular-nums">{monthWord(r.period)}</td>
                        <td className="whitespace-nowrap text-zinc-600 dark:text-zinc-300">{r.account}</td>
                        <td className="whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">{r.start && r.end ? `${dayWord(r.start).replace(/, \d{4}$/, '')} – ${dayWord(r.end)}` : ''}</td>
                        <td className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{r.status === 'read' ? r.trades : ''}</td>
                        <td className="!pr-4"><StatusChipBlock status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        {toDo > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-sky-50/70 px-3 py-2.5 dark:bg-sky-500/10">
            <span className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-200">
              {toDo} {toDo === 1 ? 'statement' : 'statements'} waiting for an agent to read.
            </span>
            <button type="button" onClick={() => { void copyPrompt() }} className="rounded-[8px] bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900">
              {copied ? 'Copied' : 'Copy the prompt for an agent'}
            </button>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <button
          type="button"
          disabled={saving}
          onClick={() => input.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files) }}
          className={cn(
            'flex h-full min-h-[140px] w-full flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed px-4 text-center transition-colors disabled:opacity-60',
            dragging ? 'border-sky-500 bg-sky-50/70 dark:bg-sky-500/10' : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50',
          )}
        >
          <span className="font-medium">{saving ? 'Adding…' : 'Drop Webull statements here'}</span>
          <span className="text-[12px] text-zinc-500 dark:text-zinc-400">as many as you downloaded, or click to choose</span>
        </button>
        <input ref={input} type="file" multiple accept="application/pdf,.pdf" className="hidden" onChange={e => { const files = e.target.files; void take(files).finally(() => { e.target.value = '' }) }} />
        {notes.length > 0 && (
          <div className="mt-2 space-y-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
            {notes.map((m, i) => (
              <p key={i}>
                {m.text}
                {m.dupOf && (
                  <> <button type="button" onClick={() => onOpenFile(m.dupOf!.path)} className="text-sky-600 hover:underline dark:text-sky-400">{m.dupOf.label}</button></>
                )}
              </p>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </F9PanelBlock>
  )
}
