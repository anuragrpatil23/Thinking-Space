import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ParsedTranscriptBlock,
  TranscriptFileTouchBlock,
  TranscriptItemBlock,
  TranscriptSummaryBlock,
  TranscriptToolBlock,
  TranscriptUsageBlock,
} from '@/services/lego_blocks/units/parseTranscriptEventsBlock'
import { formatTokens, formatUsd } from '@/services/lego_blocks/units/aiPriceTableBlock'
import { usageCostBlock } from '@/services/lego_blocks/units/transcriptUsageCostBlock'
import { cn } from '@/lib/utils'

/**
 * One session's transcript, drawn the way Claude Code draws it in a terminal:
 * `>` prompt rows, `⏺` replies, and tool runs folded into one line
 * ("Read 6 files, ran 3 commands") that opens into `⏺ Bash(…)` / `⎿` rows.
 *
 * Tool traffic is most of a transcript by volume and almost none of it by
 * meaning, so reads, commands and searches fold — even a lone one, since a
 * single `cat` of a long path is four lines of noise. Edits, creates and
 * subagent runs stay inline: those are what the session *did*. An edit opens
 * into its diff; a subagent opens into its own transcript; a vault file opens
 * in the app. The files it changed head the transcript and jump to the change.
 *
 * Navigation hooks for the drawer (timeline rail, j/k, search) are data
 * attributes, so the drawer can work across several sessions in one pane:
 *   data-tx-prompt · data-tx-edit · data-tx-error · data-tx-hit
 * A drawer-level jump arrives as a `tx-jump` window event naming the view's
 * `idPrefix`, because only the view knows which fold holds the target.
 */

/** A pause long enough to read as "came back to it later". */
const GAP_MS = 20 * 60_000

export const TX_JUMP_EVENT = 'tx-jump'
export interface TxJumpDetail { prefix: string; index: number }

/** Opens a touched file in the app, when it is one the app can open. */
export interface TranscriptFileOpenerBlock {
  /** Vault-relative path for an absolute one, or null when it can't be opened here. */
  resolve: (abs: string | undefined) => string | null
  open: (vaultRel: string) => void
}

type ToolEntry = { index: number; tool: TranscriptToolBlock }
type Row =
  | { kind: 'item'; index: number; item: Exclude<TranscriptItemBlock, { kind: 'tool' }> }
  | { kind: 'fold'; start: number; tools: ToolEntry[] }
  | { kind: 'tool'; entry: ToolEntry }
  | { kind: 'gap'; ms: number; key: string }

/** Calls that are the session's actual output — never folded. */
function isInline(t: TranscriptToolBlock): boolean {
  return t.verb === 'edit' || t.verb === 'create' || t.verb === 'agent'
}

function buildRows(items: TranscriptItemBlock[]): Row[] {
  const rows: Row[] = []
  let lastTs: number | null = null
  items.forEach((item, index) => {
    if (item.ts !== null && lastTs !== null && item.ts - lastTs > GAP_MS) {
      rows.push({ kind: 'gap', ms: item.ts - lastTs, key: `gap-${index}` })
    }
    if (item.ts !== null) lastTs = item.ts
    if (item.kind === 'tool') {
      const entry = { index, tool: item.tool }
      if (isInline(item.tool)) {
        rows.push({ kind: 'tool', entry })
        return
      }
      const prev = rows[rows.length - 1]
      if (prev?.kind === 'fold') prev.tools.push(entry)
      else rows.push({ kind: 'fold', start: index, tools: [entry] })
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

/** "9:57am" — the reader already knows the day from the session header. */
function fmtTime(ts: number | null): string {
  if (ts === null) return ''
  const d = new Date(ts)
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function UsageLabel({ usage, className }: { usage: TranscriptUsageBlock | undefined; className?: string }) {
  const { usd, tokens, partial } = usageCostBlock(usage)
  if (!tokens) return null
  return (
    <span
      className={cn('shrink-0 tabular-nums text-muted-foreground/60', className)}
      title={`${tokens.toLocaleString()} tokens${partial ? ' · some models unpriced' : ''} · list-price equivalent`}
    >
      {usd !== null ? `${formatUsd(usd)}${partial ? '+' : ''}` : `${formatTokens(tokens)} tok`}
    </span>
  )
}

/** "Read 6 files, ran 3 commands" — Claude Code's folded line. */
function foldLabel(tools: TranscriptToolBlock[]): string {
  const files = new Set(tools.filter(t => t.verb === 'read').map(t => t.file ?? t.target)).size
  const count = (verb: TranscriptToolBlock['verb']) => tools.filter(t => t.verb === verb).length
  const parts: string[] = []
  if (files) parts.push(`read ${plural(files, 'file')}`)
  if (count('run')) parts.push(`ran ${plural(count('run'), 'command')}`)
  if (count('search')) parts.push(`searched ${plural(count('search'), 'pattern')}`)
  if (count('web')) parts.push(plural(count('web'), 'web lookup'))
  if (count('other')) parts.push(`used ${plural(count('other'), 'tool')}`)
  const s = parts.join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function itemText(item: TranscriptItemBlock): string {
  switch (item.kind) {
    case 'user':
      return item.segments.map(s => (s.kind === 'text' ? s.text : s.paste.body)).join('\n')
    case 'assistant':
      return item.text
    case 'tool':
      return `${item.tool.name} ${item.tool.target} ${item.tool.result ?? ''}`
    case 'command':
      return `${item.name} ${item.args}`
    default:
      return ''
  }
}

function Dot({ tone = 'text' }: { tone?: 'text' | 'ok' | 'error' | 'muted' | 'agent' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'w-4 shrink-0 select-none',
        tone === 'text' && 'text-foreground/80',
        tone === 'ok' && 'text-emerald-600/80 dark:text-emerald-400/80',
        tone === 'error' && 'text-destructive/80',
        tone === 'muted' && 'text-muted-foreground/50',
        tone === 'agent' && 'text-violet-500/80 dark:text-violet-400/80',
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
      {added ? <span className="text-emerald-600/90 dark:text-emerald-400/90">+{added}</span> : null}
      {added && removed ? ' ' : null}
      {removed ? <span className="text-destructive/70">−{removed}</span> : null}
    </span>
  )
}

function DiffBlock({ lines, more }: { lines: string[]; more?: number }) {
  return (
    <div className="mt-1 overflow-x-auto rounded border border-border/40 bg-background/60 py-1 text-[11.5px] leading-[1.55]">
      {lines.map((l, i) => {
        if (l === '@@') return <div key={i} className="px-2 text-muted-foreground/40">⋯</div>
        const sign = l[0]
        return (
          <div
            key={i}
            className={cn(
              'whitespace-pre px-2',
              sign === '+' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300/90',
              sign === '-' && 'bg-destructive/10 text-destructive/85',
              sign !== '+' && sign !== '-' && 'text-muted-foreground/70',
            )}
          >
            {l || ' '}
          </div>
        )
      })}
      {more ? <div className="px-2 pt-0.5 text-muted-foreground/50">… {plural(more, 'more line')}</div> : null}
    </div>
  )
}

const hitRing = 'ring-1 ring-amber-400/50 bg-amber-400/[0.07]'
const flashBg = 'bg-amber-400/20'

function OpenButton({ rel, opener }: { rel: string; opener: TranscriptFileOpenerBlock }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); opener.open(rel) }}
      className="shrink-0 rounded px-1 text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground"
      title="Open in Thinking Space"
    >
      open ↗
    </button>
  )
}

interface ToolRowProps {
  tool: TranscriptToolBlock
  id: string
  flash: boolean
  hit: boolean
  query: string
  opener?: TranscriptFileOpenerBlock
  loadSubagent?: (agentId: string) => Promise<ParsedTranscriptBlock>
}

function ToolRow({ tool, id, flash, hit, query, opener, loadSubagent }: ToolRowProps) {
  const [showDiff, setShowDiff] = useState(false)
  const [agent, setAgent] = useState<
    { state: 'closed' } | { state: 'loading' } | { state: 'open'; parsed: ParsedTranscriptBlock } | { state: 'error'; message: string }
  >({ state: 'closed' })
  const multiline = tool.verb === 'run' && tool.target.includes('\n')
  const inline = isInline(tool)
  const rel = opener?.resolve(tool.abs) ?? null
  const canDrill = tool.verb === 'agent' && !!tool.agentId && !!loadSubagent

  const toggleAgent = () => {
    if (!canDrill) return
    if (agent.state === 'open' || agent.state === 'error') { setAgent({ state: 'closed' }); return }
    setAgent({ state: 'loading' })
    loadSubagent!(tool.agentId!)
      .then(parsed => setAgent({ state: 'open', parsed }))
      .catch(err => setAgent({ state: 'error', message: err instanceof Error ? err.message : String(err) }))
  }

  return (
    <div
      id={id}
      data-tx-edit={tool.verb === 'edit' || tool.verb === 'create' ? '' : undefined}
      data-tx-error={tool.isError ? '' : undefined}
      data-tx-hit={hit ? '' : undefined}
      className={cn(
        '-mx-1 rounded px-1 transition-colors duration-700',
        flash && flashBg,
        hit && hitRing,
      )}
    >
      <div className="flex min-w-0 items-baseline">
        <Dot tone={tool.isError ? 'error' : tool.verb === 'agent' ? 'agent' : 'ok'} />
        <div className="min-w-0 flex-1">
          <span className={cn('font-medium', inline ? 'text-foreground/90' : 'text-foreground/75')}>
            {tool.name}
          </span>
          {tool.target && (
            <span className={cn('text-muted-foreground', multiline ? 'whitespace-pre-wrap' : 'break-all')}>
              ({tool.target})
            </span>
          )}
        </div>
        {rel && <OpenButton rel={rel} opener={opener!} />}
      </div>
      {tool.result && (
        <div className="flex min-w-0 pl-4 text-muted-foreground/80">
          <span className="w-6 shrink-0 select-none">⎿</span>
          {tool.diff?.length ? (
            <button
              type="button"
              onClick={() => setShowDiff(s => !s)}
              className="min-w-0 truncate text-left hover:text-foreground"
              title={showDiff ? 'Hide the diff' : 'Show the diff'}
            >
              <DiffCount added={tool.added} removed={tool.removed} />
              <span className="text-muted-foreground/50"> {showDiff ? '▾' : '▸'} diff</span>
            </button>
          ) : canDrill ? (
            <button
              type="button"
              onClick={toggleAgent}
              className="min-w-0 truncate text-left hover:text-foreground"
            >
              {tool.result}
              <span className="text-muted-foreground/50">
                {' '}{agent.state === 'open' ? '▾' : '▸'} {agent.state === 'loading' ? 'loading…' : 'steps'}
              </span>
            </button>
          ) : (
            <span className={cn('min-w-0 truncate', tool.isError && 'text-destructive/80')}>
              {tool.file && (tool.added || tool.removed)
                ? <DiffCount added={tool.added} removed={tool.removed} />
                : tool.result}
            </span>
          )}
        </div>
      )}
      {showDiff && tool.diff && <div className="pl-4"><DiffBlock lines={tool.diff} more={tool.diffMore} /></div>}
      {agent.state === 'error' && (
        <div className="pl-10 text-[11px] text-destructive/75">Couldn’t read this agent’s transcript — {agent.message}</div>
      )}
      {agent.state === 'open' && (
        <div className="mb-1 ml-2 mt-1.5 border-l border-violet-500/30 pl-3">
          {agent.parsed.items.length ? (
            <TranscriptViewBlock
              items={agent.parsed.items}
              summary={agent.parsed.summary}
              idPrefix={`${id}-a`}
              query={query}
              opener={opener}
              nested
            />
          ) : (
            <div className="text-muted-foreground/60">No steps recorded.</div>
          )}
        </div>
      )}
    </div>
  )
}

function PasteChip({ n, lines, body, forceOpen }: { n: number; lines: number; body: string; forceOpen: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = open || forceOpen
  return (
    <span className="block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-muted-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
        title={shown ? 'Hide pasted text' : 'Show pasted text'}
      >
        [Pasted text #{n} +{lines} line{lines === 1 ? '' : 's'}]
      </button>
      {shown && (
        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border/40 bg-background/70 px-2 py-1.5 text-[11.5px] text-foreground/75">
          {body}
        </pre>
      )}
    </span>
  )
}

/** A row in a files list — shared with the chain-wide card. */
export function TranscriptFileRowBlock({
  f,
  onJump,
  opener,
  badge,
}: {
  f: TranscriptFileTouchBlock
  onJump: () => void
  opener?: TranscriptFileOpenerBlock
  /** Leading tag, e.g. the session number in a chain card. */
  badge?: string
}) {
  const rel = opener?.resolve(f.abs) ?? null
  return (
    <div className="group -mx-1 flex min-w-0 items-baseline gap-2 rounded px-1 hover:bg-foreground/[0.05]">
      <button
        type="button"
        onClick={onJump}
        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        title={`Jump to the first ${f.change === 'read' ? 'read' : 'change'}`}
      >
        <span
          className={cn(
            'w-3 shrink-0 select-none',
            f.change === 'created' && 'text-emerald-600/90 dark:text-emerald-400/90',
            f.change === 'edited' && 'text-amber-600/90 dark:text-amber-400/90',
            f.change === 'read' && 'text-muted-foreground/50',
          )}
        >
          {f.change === 'created' ? 'A' : f.change === 'edited' ? 'M' : '·'}
        </span>
        {badge && <span className="shrink-0 text-muted-foreground/50">{badge}</span>}
        {/* rtl keeps the filename visible when the path truncates */}
        <span className="min-w-0 flex-1 truncate text-foreground/80" style={{ direction: 'rtl', textAlign: 'left' }}>
          <bdi>{f.path}</bdi>
        </span>
        {f.change !== 'read' && f.ops > 1 && (
          <span className="shrink-0 text-muted-foreground/60">×{f.ops}</span>
        )}
        <DiffCount added={f.added} removed={f.removed} />
      </button>
      {rel && <OpenButton rel={rel} opener={opener!} />}
    </div>
  )
}

function FilesSummary({
  summary,
  onJump,
  onNextError,
  errorCursor,
  opener,
}: {
  summary: TranscriptSummaryBlock
  onJump: (itemIndex: number) => void
  onNextError: () => void
  /** 1-based position of the last error jumped to, or 0. */
  errorCursor: number
  opener?: TranscriptFileOpenerBlock
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
  ].filter(Boolean)

  const row = (f: TranscriptFileTouchBlock) => (
    <TranscriptFileRowBlock key={f.path} f={f} onJump={() => onJump(f.firstItem)} opener={opener} />
  )

  return (
    <div className="mb-4 rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
        <span className="select-none text-amber-600/80 dark:text-amber-400/80">✻</span>
        <span>{stats.join(' · ')}</span>
        {summary.errors > 0 && (
          <button
            type="button"
            onClick={onNextError}
            className="text-destructive/75 underline-offset-2 hover:text-destructive hover:underline"
            title="Step through the failed calls"
          >
            · {errorCursor ? `error ${errorCursor}/${summary.errors}` : plural(summary.errors, 'error')} ↓
          </button>
        )}
        <UsageLabel usage={summary.usage} className="ml-auto" />
      </div>
      {changed.length > 0 && (
        <div className="mt-2">
          {/* With one file the row already says all of this. */}
          {changed.length > 1 && (
            <div className="mb-1 flex items-baseline gap-2 text-[11px] text-muted-foreground/80">
              <span>
                {created ? `${created} created` : ''}
                {created && changed.length - created ? ' · ' : ''}
                {changed.length - created ? `${changed.length - created} edited` : ''}
              </span>
              <DiffCount added={added} removed={removed} />
            </div>
          )}
          {changed.map(row)}
        </div>
      )}
      {reads.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowReads(s => !s)}
            className="text-muted-foreground/80 hover:text-foreground"
          >
            {showReads ? '▾' : '▸'} read {plural(reads.length, 'file')}
          </button>
          {showReads && <div className="mt-1">{reads.map(row)}</div>}
        </div>
      )}
      {changed.length === 0 && reads.length === 0 && (
        <div className="mt-1 text-muted-foreground/60">No files touched.</div>
      )}
    </div>
  )
}

interface TranscriptViewBlockProps {
  items: TranscriptItemBlock[]
  summary: TranscriptSummaryBlock
  /** Prefix for element ids, so several sessions can share one scroll pane. */
  idPrefix: string
  /** Lower-cased search query; matching rows are marked and folds open. */
  query?: string
  opener?: TranscriptFileOpenerBlock
  loadSubagent?: (agentId: string) => Promise<ParsedTranscriptBlock>
  /** A subagent's steps inside its parent: no summary card, no prompt marks
   *  (j/k and the rail are for the conversation, not the agent's brief). */
  nested?: boolean
}

export default function TranscriptViewBlock({
  items, summary, idPrefix, query = '', opener, loadSubagent, nested = false,
}: TranscriptViewBlockProps) {
  const rows = useMemo(() => buildRows(items), [items])
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const [flash, setFlash] = useState<number | null>(null)
  const [errorCursor, setErrorCursor] = useState(0)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  const hits = useMemo(() => {
    const set = new Set<number>()
    if (!query) return set
    items.forEach((item, i) => { if (itemText(item).toLowerCase().includes(query)) set.add(i) })
    return set
  }, [items, query])

  const errorItems = useMemo(
    () => items.flatMap((it, i) => (it.kind === 'tool' && it.tool.isError ? [i] : [])),
    [items],
  )

  const itemId = useCallback((i: number) => `${idPrefix}-${i}`, [idPrefix])

  const jump = useCallback((itemIndex: number) => {
    const fold = rows.find(
      r => r.kind === 'fold' && r.tools.some(t => t.index === itemIndex),
    ) as Extract<Row, { kind: 'fold' }> | undefined
    if (fold) setOpen(prev => new Set(prev).add(fold.start))
    setFlash(itemIndex)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1600)
    // After the fold has expanded and laid out.
    requestAnimationFrame(() => {
      document.getElementById(itemId(itemIndex))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [rows, itemId])

  useEffect(() => {
    const onJump = (e: Event) => {
      const d = (e as CustomEvent<TxJumpDetail>).detail
      if (d?.prefix === idPrefix) jump(d.index)
    }
    window.addEventListener(TX_JUMP_EVENT, onJump)
    return () => window.removeEventListener(TX_JUMP_EVENT, onJump)
  }, [idPrefix, jump])

  const nextError = useCallback(() => {
    if (!errorItems.length) return
    const next = errorCursor % errorItems.length
    setErrorCursor(next + 1)
    jump(errorItems[next])
  }, [errorItems, errorCursor, jump])

  return (
    <div className="font-mono text-[12.5px] leading-[1.7] text-foreground/85">
      {!nested && (
        <FilesSummary
          summary={summary}
          onJump={jump}
          onNextError={nextError}
          errorCursor={errorCursor}
          opener={opener}
        />
      )}
      <div className={nested ? 'space-y-2' : 'space-y-3'}>
        {rows.map(row => {
          if (row.kind === 'gap') {
            return (
              <div key={row.key} className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground/60">
                <span className="h-px flex-1 bg-border/40" />
                <span>{fmtGap(row.ms)}</span>
                <span className="h-px flex-1 bg-border/40" />
              </div>
            )
          }
          const toolRow = ({ index, tool }: ToolEntry) => (
            <ToolRow
              key={tool.id + index}
              tool={tool}
              id={itemId(index)}
              flash={flash === index}
              hit={hits.has(index)}
              query={query}
              opener={opener}
              loadSubagent={loadSubagent}
            />
          )
          if (row.kind === 'tool') return toolRow(row.entry)
          if (row.kind === 'fold') {
            const foldHit = row.tools.some(t => hits.has(t.index))
            const foldError = row.tools.some(t => t.tool.isError)
            if (open.has(row.start) || foldHit) {
              return (
                <div key={`f-${row.start}`} className="space-y-1">
                  {!foldHit && (
                    <button
                      type="button"
                      onClick={() => setOpen(prev => { const n = new Set(prev); n.delete(row.start); return n })}
                      className="text-[11px] text-muted-foreground/60 hover:text-foreground"
                    >
                      ▾ collapse
                    </button>
                  )}
                  {row.tools.map(toolRow)}
                </div>
              )
            }
            const errors = row.tools.filter(t => t.tool.isError).length
            return (
              <button
                key={`f-${row.start}`}
                id={itemId(row.start)}
                data-tx-error={foldError ? '' : undefined}
                type="button"
                onClick={() => setOpen(prev => new Set(prev).add(row.start))}
                className="group flex w-full min-w-0 text-left"
              >
                <Dot tone={errors ? 'error' : 'muted'} />
                <span className="min-w-0 flex-1 text-muted-foreground/80 group-hover:text-foreground">
                  {foldLabel(row.tools.map(t => t.tool))}
                  {errors ? <span className="text-destructive/70"> · {plural(errors, 'error')}</span> : null}
                  <span className="text-muted-foreground/40"> (expand)</span>
                </span>
              </button>
            )
          }

          const { item, index } = row
          const hit = hits.has(index)
          if (item.kind === 'user') {
            return (
              <div
                key={index}
                id={itemId(index)}
                data-tx-prompt={nested ? undefined : ''}
                data-tx-hit={hit ? '' : undefined}
                className={cn(
                  '-mx-2 flex min-w-0 scroll-mt-4 gap-2 rounded bg-muted/50 px-2 py-1.5 text-foreground/90',
                  hit && hitRing,
                )}
              >
                <span className="w-2 shrink-0 select-none text-muted-foreground/70">&gt;</span>
                <div className="min-w-0 flex-1 space-y-1" style={{ overflowWrap: 'anywhere' }}>
                  {item.segments.map((seg, i) =>
                    seg.kind === 'text'
                      ? <div key={i} className="whitespace-pre-wrap">{seg.text}</div>
                      : (
                        <PasteChip
                          key={i}
                          {...seg.paste}
                          forceOpen={!!query && seg.paste.body.toLowerCase().includes(query)}
                        />
                      ),
                  )}
                </div>
                <span className="flex shrink-0 items-baseline gap-2 text-[11px]">
                  {!nested && <UsageLabel usage={item.usage} />}
                  {item.ts !== null && (
                    <span className="tabular-nums text-muted-foreground/60" title={new Date(item.ts).toLocaleString()}>
                      {fmtTime(item.ts)}
                    </span>
                  )}
                </span>
              </div>
            )
          }
          if (item.kind === 'assistant') {
            return (
              <div
                key={index}
                id={itemId(index)}
                data-tx-hit={hit ? '' : undefined}
                className={cn('group/reply relative -mx-1 flex min-w-0 rounded px-1', hit && hitRing)}
              >
                {item.ts !== null && (
                  // Replies stream for minutes; the time is there when you look for it.
                  <span
                    className="pointer-events-none absolute right-1 top-0 text-[11px] tabular-nums text-muted-foreground/50 opacity-0 transition-opacity group-hover/reply:opacity-100"
                  >
                    {fmtTime(item.ts)}
                  </span>
                )}
                <Dot />
                <article
                  className={cn(
                    'prose prose-sm dark:prose-invert min-w-0 max-w-none flex-1 font-mono text-[12.5px] leading-[1.7]',
                    'text-foreground/85 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-2',
                    // Bold in monospace reads heavy — medium weight, a shade brighter instead.
                    'prose-strong:font-medium prose-strong:text-foreground',
                    'prose-headings:mb-1 prose-headings:mt-4 prose-headings:text-[12.5px] prose-headings:font-medium',
                    'prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
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
              <div key={index} id={itemId(index)} className="flex text-muted-foreground/80">
                <span className="w-4 shrink-0 select-none">&gt;</span>
                <span>{item.name}{item.args ? ` ${item.args}` : ''}</span>
              </div>
            )
          }
          return (
            <div key={index} id={itemId(index)} className="text-muted-foreground/70">
              <span className="select-none text-amber-600/80 dark:text-amber-400/80">✻ </span>
              Conversation compacted
            </div>
          )
        })}
      </div>
    </div>
  )
}
