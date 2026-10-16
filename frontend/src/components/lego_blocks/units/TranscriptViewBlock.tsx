import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  TranscriptFileTouchBlock,
  TranscriptItemBlock,
  TranscriptSummaryBlock,
  TranscriptToolBlock,
} from '@/services/lego_blocks/units/parseTranscriptEventsBlock'
import { cn } from '@/lib/utils'

/**
 * One session's transcript, drawn the way Claude Code draws it in a terminal:
 * `>` prompt rows, `⏺` replies, and tool runs folded into one line
 * ("Read 6 files, edited 2 files") that opens into `⏺ Edit(path)` / `⎿` rows.
 *
 * Tool traffic is most of a transcript by volume and almost none of it by
 * meaning, so it is folded by default — but never dropped: the files a session
 * created and edited are the summary at the top, and each one jumps to the
 * call that changed it.
 */

/** A pause long enough to read as "came back to it later". */
const GAP_MS = 20 * 60_000

type Row =
  | { kind: 'item'; index: number; item: Exclude<TranscriptItemBlock, { kind: 'tool' }> }
  | { kind: 'tools'; start: number; tools: Array<{ index: number; tool: TranscriptToolBlock }> }
  | { kind: 'gap'; ms: number; key: string }

function buildRows(items: TranscriptItemBlock[]): Row[] {
  const rows: Row[] = []
  let lastTs: number | null = null
  items.forEach((item, index) => {
    if (item.ts !== null && lastTs !== null && item.ts - lastTs > GAP_MS) {
      rows.push({ kind: 'gap', ms: item.ts - lastTs, key: `gap-${index}` })
    }
    if (item.ts !== null) lastTs = item.ts
    if (item.kind === 'tool') {
      const prev = rows[rows.length - 1]
      if (prev?.kind === 'tools') prev.tools.push({ index, tool: item.tool })
      else rows.push({ kind: 'tools', start: index, tools: [{ index, tool: item.tool }] })
      return
    }
    rows.push({ kind: 'item', index, item })
  })
  return rows
}

function fmtGap(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m later`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m later` : `${h}h later`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Read 6 files, edited 2 files, ran 3 commands" — Claude Code's folded line. */
function foldLabel(tools: TranscriptToolBlock[]): string {
  const files = (verb: TranscriptToolBlock['verb']) =>
    new Set(tools.filter(t => t.verb === verb).map(t => t.file ?? t.target)).size
  const count = (verb: TranscriptToolBlock['verb']) => tools.filter(t => t.verb === verb).length
  const parts: string[] = []
  if (files('read')) parts.push(`read ${plural(files('read'), 'file')}`)
  if (files('create')) parts.push(`created ${plural(files('create'), 'file')}`)
  if (files('edit')) parts.push(`edited ${plural(files('edit'), 'file')}`)
  if (count('run')) parts.push(`ran ${plural(count('run'), 'command')}`)
  if (count('search')) parts.push(`searched ${plural(count('search'), 'pattern')}`)
  if (count('web')) parts.push(`${plural(count('web'), 'web lookup')}`)
  if (count('agent')) parts.push(`ran ${plural(count('agent'), 'agent')}`)
  if (count('other')) parts.push(`used ${plural(count('other'), 'tool')}`)
  const s = parts.join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function Dot({ tone = 'text' }: { tone?: 'text' | 'ok' | 'error' | 'muted' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'w-4 shrink-0 select-none',
        tone === 'text' && 'text-foreground',
        tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'error' && 'text-destructive',
        tone === 'muted' && 'text-muted-foreground/60',
      )}
    >
      ⏺
    </span>
  )
}

function DiffCount({ added, removed }: { added?: number; removed?: number }) {
  if (!added && !removed) return null
  return (
    <span className="shrink-0 tabular-nums">
      {added ? <span className="text-emerald-600 dark:text-emerald-400">+{added}</span> : null}
      {added && removed ? ' ' : null}
      {removed ? <span className="text-destructive/80">−{removed}</span> : null}
    </span>
  )
}

function ToolRow({ tool, id, flash }: { tool: TranscriptToolBlock; id: string; flash: boolean }) {
  const multiline = tool.verb === 'run' && tool.target.includes('\n')
  return (
    <div id={id} className={cn('rounded px-1 -mx-1 transition-colors duration-700', flash && 'bg-amber-400/20')}>
      <div className="flex min-w-0">
        <Dot tone={tool.isError ? 'error' : 'ok'} />
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-foreground">{tool.name}</span>
          {tool.target && (
            <span className={cn('text-foreground/70', multiline ? 'whitespace-pre-wrap' : 'break-all')}>
              ({tool.target})
            </span>
          )}
        </div>
      </div>
      {tool.result && (
        <div className="flex min-w-0 pl-4 text-muted-foreground">
          <span className="w-6 shrink-0 select-none">⎿</span>
          <span className={cn('min-w-0 truncate', tool.isError && 'text-destructive')}>
            {tool.file && (tool.added || tool.removed)
              ? <DiffCount added={tool.added} removed={tool.removed} />
              : tool.result}
          </span>
        </div>
      )}
    </div>
  )
}

function PasteChip({ n, lines, body }: { n: number; lines: number; body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        title={open ? 'Hide pasted text' : 'Show pasted text'}
      >
        [Pasted text #{n} +{lines} line{lines === 1 ? '' : 's'}]
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border/40 bg-background/70 px-2 py-1.5 text-[11.5px] text-foreground/80">
          {body}
        </pre>
      )}
    </span>
  )
}

function FilesSummary({
  summary,
  onJump,
}: {
  summary: TranscriptSummaryBlock
  onJump: (itemIndex: number) => void
}) {
  const [showReads, setShowReads] = useState(false)
  const changed = summary.files.filter(f => f.change !== 'read')
  const reads = summary.files.filter(f => f.change === 'read')
  const created = changed.filter(f => f.change === 'created').length
  const added = changed.reduce((n, f) => n + f.added, 0)
  const removed = changed.reduce((n, f) => n + f.removed, 0)

  const stats = [
    plural(summary.prompts, 'prompt'),
    plural(summary.toolCalls, 'tool call'),
    summary.commands ? plural(summary.commands, 'command') : null,
    summary.errors ? plural(summary.errors, 'error') : null,
  ].filter(Boolean)

  const fileRow = (f: TranscriptFileTouchBlock) => (
    <button
      key={f.path}
      type="button"
      onClick={() => onJump(f.firstItem)}
      className="flex w-full min-w-0 items-baseline gap-2 rounded px-1 -mx-1 text-left hover:bg-foreground/[0.05]"
      title={`Jump to the first ${f.change === 'read' ? 'read' : 'change'}`}
    >
      <span
        className={cn(
          'w-3 shrink-0 select-none',
          f.change === 'created' && 'text-emerald-600 dark:text-emerald-400',
          f.change === 'edited' && 'text-amber-600 dark:text-amber-400',
          f.change === 'read' && 'text-muted-foreground/60',
        )}
      >
        {f.change === 'created' ? 'A' : f.change === 'edited' ? 'M' : '·'}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/85" style={{ direction: 'rtl', textAlign: 'left' }}>
        {/* rtl keeps the filename visible when the path truncates */}
        <bdi>{f.path}</bdi>
      </span>
      {f.change !== 'read' && f.ops > 1 && (
        <span className="shrink-0 text-muted-foreground/70">×{f.ops}</span>
      )}
      <DiffCount added={f.added} removed={f.removed} />
    </button>
  )

  return (
    <div className="mb-4 rounded-md border border-border/50 bg-muted/25 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
        <span className="select-none text-amber-600 dark:text-amber-400">✻</span>
        <span>{stats.join(' · ')}</span>
      </div>
      {changed.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 flex items-baseline gap-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            <span>
              {created ? `${created} created` : ''}
              {created && changed.length - created ? ' · ' : ''}
              {changed.length - created ? `${changed.length - created} edited` : ''}
            </span>
            <span className="normal-case tracking-normal">
              <DiffCount added={added} removed={removed} />
            </span>
          </div>
          {changed.map(fileRow)}
        </div>
      )}
      {reads.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowReads(s => !s)}
            className="text-muted-foreground hover:text-foreground"
          >
            {showReads ? '▾' : '▸'} read {plural(reads.length, 'file')}
          </button>
          {showReads && <div className="mt-1">{reads.map(fileRow)}</div>}
        </div>
      )}
      {changed.length === 0 && reads.length === 0 && (
        <div className="mt-1 text-muted-foreground/70">No files touched.</div>
      )}
    </div>
  )
}

interface TranscriptViewBlockProps {
  items: TranscriptItemBlock[]
  summary: TranscriptSummaryBlock
  /** Prefix for element ids, so several sessions can share one scroll pane. */
  idPrefix: string
}

export default function TranscriptViewBlock({ items, summary, idPrefix }: TranscriptViewBlockProps) {
  const rows = useMemo(() => buildRows(items), [items])
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const [flash, setFlash] = useState<number | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  const itemId = useCallback((i: number) => `${idPrefix}-${i}`, [idPrefix])

  const jump = useCallback((itemIndex: number) => {
    const group = rows.find(
      r => r.kind === 'tools' && r.tools.some(t => t.index === itemIndex),
    ) as Extract<Row, { kind: 'tools' }> | undefined
    if (group) setOpen(prev => new Set(prev).add(group.start))
    setFlash(itemIndex)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1600)
    // After the group has expanded and laid out.
    requestAnimationFrame(() => {
      document.getElementById(itemId(itemIndex))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [rows, itemId])

  return (
    <div className="font-mono text-[12.5px] leading-relaxed">
      <FilesSummary summary={summary} onJump={jump} />
      <div className="space-y-3">
        {rows.map(row => {
          if (row.kind === 'gap') {
            return (
              <div key={row.key} className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground/70">
                <span className="h-px flex-1 bg-border/50" />
                <span>{fmtGap(row.ms)}</span>
                <span className="h-px flex-1 bg-border/50" />
              </div>
            )
          }
          if (row.kind === 'tools') {
            const expanded = row.tools.length === 1 || open.has(row.start)
            if (expanded) {
              return (
                <div key={`t-${row.start}`} className="space-y-1">
                  {row.tools.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setOpen(prev => { const n = new Set(prev); n.delete(row.start); return n })}
                      className="text-[11px] text-muted-foreground/70 hover:text-foreground"
                    >
                      ▾ collapse
                    </button>
                  )}
                  {row.tools.map(({ index, tool }) => (
                    <ToolRow key={tool.id + index} tool={tool} id={itemId(index)} flash={flash === index} />
                  ))}
                </div>
              )
            }
            const errors = row.tools.filter(t => t.tool.isError).length
            return (
              <button
                key={`t-${row.start}`}
                id={itemId(row.start)}
                type="button"
                onClick={() => setOpen(prev => new Set(prev).add(row.start))}
                className="group flex w-full min-w-0 text-left"
              >
                <Dot tone={errors ? 'error' : 'muted'} />
                <span className="min-w-0 flex-1 text-muted-foreground group-hover:text-foreground">
                  {foldLabel(row.tools.map(t => t.tool))}
                  {errors ? <span className="text-destructive"> · {plural(errors, 'error')}</span> : null}
                  <span className="text-muted-foreground/50"> (expand)</span>
                </span>
              </button>
            )
          }

          const { item, index } = row
          if (item.kind === 'user') {
            return (
              <div
                key={index}
                id={itemId(index)}
                className="-mx-2 flex min-w-0 rounded bg-muted/60 px-2 py-1.5 text-foreground"
              >
                <span className="w-4 shrink-0 select-none text-muted-foreground">&gt;</span>
                <div className="min-w-0 flex-1 space-y-1" style={{ overflowWrap: 'anywhere' }}>
                  {item.segments.map((seg, i) =>
                    seg.kind === 'text'
                      ? <div key={i} className="whitespace-pre-wrap">{seg.text}</div>
                      : <PasteChip key={i} {...seg.paste} />,
                  )}
                </div>
              </div>
            )
          }
          if (item.kind === 'assistant') {
            return (
              <div key={index} id={itemId(index)} className="flex min-w-0">
                <Dot />
                <article
                  className={cn(
                    'prose prose-sm dark:prose-invert min-w-0 max-w-none flex-1 font-mono text-[12.5px]',
                    'prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2',
                    'prose-headings:mb-1 prose-headings:mt-3 prose-headings:text-[13px]',
                    'prose-code:before:content-none prose-code:after:content-none',
                  )}
                  style={{ overflowWrap: 'anywhere' }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                </article>
              </div>
            )
          }
          if (item.kind === 'command') {
            return (
              <div key={index} id={itemId(index)} className="flex text-muted-foreground">
                <span className="w-4 shrink-0 select-none">&gt;</span>
                <span>{item.name}{item.args ? ` ${item.args}` : ''}</span>
              </div>
            )
          }
          return (
            <div key={index} id={itemId(index)} className="text-muted-foreground/80">
              <span className="select-none text-amber-600 dark:text-amber-400">✻ </span>
              Conversation compacted
            </div>
          )
        })}
      </div>
    </div>
  )
}
