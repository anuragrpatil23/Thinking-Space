// "Check Webull API access": one read-only call to each part of the API the
// app might use, and what came back, so features are built only on what this
// account actually returns. Results stay on screen; "Copy report" puts them on
// the clipboard as text.
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { checkWebullApiAccessBlock, type WebullAccessCheckBlock } from '@/personal_extension/services/lego_blocks/integrations/webullApiBlock'

export function WebullApiAccessCheckBlock() {
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<WebullAccessCheckBlock[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const run = async () => {
    setBusy(true); setError(null); setRows(null)
    try { setRows(await checkWebullApiAccessBlock()) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  const report = () => (rows ?? []).map(r => `${r.ok ? 'OK ' : 'NO '} ${r.area} | ${r.status ?? '-'} ${r.path} | ${r.note}`).join('\n')
  return (
    <div className="mt-4 border-t border-zinc-200 pt-3 text-[12px] dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <p className="text-zinc-500 dark:text-zinc-400">What this account can read from Webull's API: one read-only call to each part (takes about 15 seconds).</p>
        <span className="flex shrink-0 gap-3">
          {rows && <button type="button" onClick={() => { void navigator.clipboard.writeText(report()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }} className="text-sky-600 hover:text-sky-700 dark:text-sky-400">{copied ? 'Copied' : 'Copy report'}</button>}
          <button type="button" disabled={busy} onClick={() => { void run() }} className="text-sky-600 hover:text-sky-700 disabled:opacity-50 dark:text-sky-400">{busy ? 'Checking…' : 'Check API access'}</button>
        </span>
      </div>
      {error && <p className="mt-1 text-red-600 dark:text-red-400">{error}</p>}
      {rows && (
        <ul className="mt-2 space-y-1">
          {rows.map(r => (
            <li key={r.area} className="grid grid-cols-[1rem_10rem_1fr] gap-2">
              <span className={cn(r.ok ? 'text-emerald-600' : 'text-red-600')}>{r.ok ? '✓' : '✗'}</span>
              <span className="text-zinc-700 dark:text-zinc-300">{r.area}</span>
              <span className="truncate text-zinc-500" title={`${r.status ?? ''} ${r.path}\n${r.note}`}>{r.status ?? '—'} · {r.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
