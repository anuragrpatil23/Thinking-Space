import { Fragment, Suspense, lazy, useMemo, useState } from 'react'
import { Check, Maximize2, Pencil, Plus, RefreshCw, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isReadingSource, isManualSource, type ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { getManualSession } from '@/services/lego_blocks/integrations/manualSessionBlock'
import type { ManualSessionRecord } from '@/services/lego_blocks/units/manualSessionParserBlock'
import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getProjectColor } from '@/components/lego_blocks/units/aiActivityColorsBlock'
import { projectLabelBlock } from '@/services/lego_blocks/units/projectRegistryBlock'
import {
  estimateCostUsd,
  formatTokens,
  formatUsd,
  sumTokens,
} from '@/services/lego_blocks/units/aiPriceTableBlock'
import ChainTranscriptSlideOverBlock from '@/components/lego_blocks/integrations/ChainTranscriptSlideOverBlock'
import ReadingSessionEditModalBlock, {
  isReadingSessionEditableBlock,
} from '@/components/lego_blocks/integrations/ReadingSessionEditModalBlock'
import { useChainDigestBlock } from '@/components/lego_blocks/hooks/units/useChainDigestBlock'
import AiActivitySourceChipBlock from '@/components/lego_blocks/units/AiActivitySourceChipBlock'
import LightMarkdownTextBlock from '@/components/lego_blocks/units/LightMarkdownTextBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import ContextMenuBlock, { type ContextMenuEntryBlock } from '@/components/lego_blocks/units/ui/ContextMenuBlock'
import { loadVaultGraph } from '@/services/orchestrators/vaultGraphOrch'

const SessionGraphSlideOverBlock = lazy(
  () => import('@/components/lego_blocks/integrations/SessionGraphSlideOverBlock'),
)
const ManualSessionEditModalBlock = lazy(
  () => import('@/components/lego_blocks/integrations/ManualSessionEditModalBlock'),
)

/** Warm the shared graph snapshot on peek-intent (row hover) so the first open
 *  is instant; loadVaultGraph dedupes in-flight + reuses its 5-min snapshot. */
function warmVaultGraph() {
  void loadVaultGraph().catch(() => {})
}

interface AiActivityDayTableBlockProps {
  /** Title shown above the table (e.g. day or range label). */
  title: string
  /** Chains to display, in display order. */
  chains: ActivityChain[]
  /** Optional summary line above the table (e.g. "14 sessions · 176 msgs"). */
  summary?: string
  /** When set, rows whose project matches get a tinted background — mirrors the
   *  chip filter so the user can see which rows the filter is highlighting. */
  highlightProject?: string | null
  /** When set, rows whose calendar date doesn't match get a day-divider above
   *  them so the user can see when the table crosses midnight (overnight tail). */
  anchorDateIso?: string | null
  /** Called when a reading-session edit lands. Caller should refresh AI
   *  activity so the new times propagate to the timeline, totals, heatmap, etc. */
  onReadingEdited?: () => void
  /** Controller mode (vault graph): clicking a row selects the chain so the
   *  graph can zoom to the notes it touched, in addition to expanding it. */
  onSelectChain?: (chain: ActivityChain) => void
  /** Key of the chain currently selected as the graph lens (controller mode). */
  selectedChainKey?: string | null
  /** Peek mode (home AI-activity card, not the graph page): ⌘-click a row or
   *  right-click → "Show in graph" opens a slideover with the session's files
   *  lit and zoomed. Off by default so the graph page keeps its inline lens. */
  enableGraphPeek?: boolean
  /** When set, a "+ Log session" button appears in the header and manual rows
   *  are editable. undefined = feature not wired here; false = wired but the
   *  writeAiActivity opt-in is off (button disabled with a nudge). */
  manualSessionsEnabled?: boolean
  /** Existing project labels for the manual-session combobox (noise excluded). */
  knownProjects?: string[]
  /** Called after a manual session is created/edited/deleted so the caller
   *  refreshes AI activity. */
  onManualChanged?: () => void
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

function fmtSpan(startIso: string, endIso: string): string {
  const a = fmtTime(startIso)
  const b = fmtTime(endIso)
  if (a === b) return a
  // If the end is on a later calendar day, suffix the end with +Nd so it's
  // unambiguous the session crossed midnight (or multiple). Otherwise "4:48pm–
  // 9:14am" reads like a 16-hour single sitting when it's really "started at
  // 4:48pm, came back the next morning."
  const sd = new Date(startIso)
  const ed = new Date(endIso)
  const startDay = Date.UTC(sd.getFullYear(), sd.getMonth(), sd.getDate())
  const endDay = Date.UTC(ed.getFullYear(), ed.getMonth(), ed.getDate())
  const dayDelta = Math.round((endDay - startDay) / 86_400_000)
  if (dayDelta > 0) return `${a}–${b} +${dayDelta}d`
  return `${a}–${b}`
}

/** Format a chain's duration as `Nh Mm`, `Nh`, `Mm`, or `<1m`. Single-instant
 *  chains (end==start) render as em-dash since "0m" reads as missing data. */
function fmtDuration(startIso: string, endIso: string): string {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '—'
  const totalMin = Math.round((end - start) / 60_000)
  if (totalMin < 1) return '<1m'
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

function isoDayLocal(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtDividerDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function hasTokenUsage(
  tokens: ActivityChain['sessions'][number]['tokens'],
): tokens is NonNullable<ActivityChain['sessions'][number]['tokens']> {
  if (!tokens) return false
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation > 0
}

function estimateChainCostUsd(chain: ActivityChain): number {
  return chain.sessions.reduce((total, session) => {
    if (!hasTokenUsage(session.tokens)) return total
    return total + estimateCostUsd(session.tokens, session.model)
  }, 0)
}

function modelSummaryLabel(chain: ActivityChain): string | null {
  const models = Array.from(
    new Set(
      chain.sessions
        .map(session => session.model)
        .filter((model): model is string => Boolean(model)),
    ),
  )
  if (models.length === 0) return null
  if (models.length === 1) return models[0]
  return `${models.length} models`
}

/** Escape a value for a single Markdown table cell: collapse newlines and
 *  escape pipes so the topic text can't break the column layout when pasted
 *  into another AI or a test fixture. */
function mdCell(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim()
}

/** Serialize the entire drill-down table to a Markdown document so it can be
 *  handed to another AI for analysis or dropped into a test. Includes the
 *  token/cost/model detail that's otherwise hidden until a row is expanded, so
 *  the copied text is the full picture, not just what's on screen. */
function buildDrillDownMarkdown(
  title: string,
  summary: string | undefined,
  chains: ActivityChain[],
): string {
  const lines: string[] = []
  lines.push(`# ${title}`)
  if (summary) lines.push('', summary)
  lines.push('')
  lines.push(
    '| Start | End | Duration | Project | Source | Model | Msgs | Sessions | Fresh tokens | Cached tokens | Est. cost | Topic |',
  )
  lines.push(
    '| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  )
  let totalFresh = 0
  let totalCached = 0
  let totalCost = 0
  let totalMsgs = 0
  for (const c of chains) {
    const tokens = sumTokens(c.sessions.map(s => s.tokens))
    const hasTokens =
      tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation > 0
    const fresh = tokens.input + tokens.output
    const cached = tokens.cacheRead + tokens.cacheCreation
    const cost = hasTokens ? estimateChainCostUsd(c) : 0
    totalFresh += fresh
    totalCached += cached
    totalCost += cost
    totalMsgs += c.msgCount
    lines.push(
      `| ${mdCell(fmtTime(c.startedIso))} | ${mdCell(fmtTime(c.endedIso))} | ${mdCell(
        fmtDuration(c.startedIso, c.endedIso),
      )} | ${mdCell(c.project)} | ${mdCell(c.source)} | ${mdCell(
        modelSummaryLabel(c) ?? '—',
      )} | ${c.msgCount} | ${c.sessions.length} | ${
        hasTokens ? formatTokens(fresh) : '—'
      } | ${hasTokens ? formatTokens(cached) : '—'} | ${
        hasTokens ? formatUsd(cost) : '—'
      } | ${mdCell(c.topic)} |`,
    )
  }
  lines.push('')
  lines.push(
    `**Totals:** ${chains.length} chains · ${totalMsgs} msgs · ${formatTokens(
      totalFresh,
    )} fresh + ${formatTokens(totalCached)} cached tokens · ~${formatUsd(
      totalCost,
    )} est.`,
  )
  return lines.join('\n')
}

export default function AiActivityDayTableBlock({
  title,
  chains,
  summary,
  highlightProject = null,
  anchorDateIso = null,
  onReadingEdited,
  onSelectChain,
  selectedChainKey = null,
  enableGraphPeek = false,
  manualSessionsEnabled,
  knownProjects = [],
  onManualChanged,
}: AiActivityDayTableBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [transcriptChain, setTranscriptChain] = useState<ActivityChain | null>(null)
  const [editingChain, setEditingChain] = useState<ActivityChain | null>(null)
  const [peekChain, setPeekChain] = useState<ActivityChain | null>(null)
  const [rowMenu, setRowMenu] = useState<{ chain: ActivityChain; x: number; y: number } | null>(null)
  const [manualModal, setManualModal] = useState<
    { mode: 'create' } | { mode: 'edit'; record: ManualSessionRecord } | null
  >(null)

  // A manual chain carries the record key on its (single) session; the note
  // isn't on the chain, so load the full record before opening the editor.
  const openManualEdit = async (chain: ActivityChain) => {
    const key = chain.sessions[0]?.sessionId
    if (!key) return
    const record = await getManualSession(getVaultFS(), key)
    if (record) setManualModal({ mode: 'edit', record })
  }
  const [copied, setCopied] = useState(false)

  // Sort by start time, oldest first for chronological reading.
  const sorted = useMemo(
    () => [...chains].sort((a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso)),
    [chains],
  )

  // Day totals across every chain — used for the footer line. Tokens come from
  // the underlying sessions; cost is summed per-model so each chain uses the
  // right price tier (opus/sonnet/gpt-5 differ a lot).
  const dayTotals = useMemo(() => {
    let totalCostUsd = 0
    // Split tokens into "real" usage (fresh input + output) vs cached (cache
    // reads + writes). Cached tokens are the bulk of the volume but the cheap
    // part of the bill — surfacing them as one blob hid the actual work being
    // done. Footer now shows fresh / cached separately.
    let totalFreshTokens = 0
    let totalCachedTokens = 0
    let chainsWithTokens = 0
    for (const c of sorted) {
      let chainHasTokens = false
      for (const s of c.sessions) {
        const t = s.tokens
        if (!hasTokenUsage(t)) continue
        chainHasTokens = true
        totalCostUsd += estimateCostUsd(t, s.model)
        totalFreshTokens += t.input + t.output
        totalCachedTokens += t.cacheRead + t.cacheCreation
      }
      if (chainHasTokens) chainsWithTokens += 1
    }
    return { totalCostUsd, totalFreshTokens, totalCachedTokens, chainsWithTokens }
  }, [sorted])

  /** Copy `rows` as the drill-down Markdown — the whole table, or one row of it.
   *  Same builder either way, so a single row copies with the same header and
   *  hidden token/cost columns the full table carries. */
  const copyRowsAsMarkdown = async (rows: ActivityChain[]) => {
    try {
      const md = buildDrillDownMarkdown(title, summary, rows)
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be denied (permissions, insecure context) — fail quietly
      // rather than throwing.
    }
  }

  return (
    <div ref={hostRef} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {summary && (
            <p className="text-[11px] text-muted-foreground/80">{summary}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {manualSessionsEnabled !== undefined && (
            <button
              type="button"
              onClick={() => manualSessionsEnabled && setManualModal({ mode: 'create' })}
              disabled={!manualSessionsEnabled}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                manualSessionsEnabled
                  ? 'border-border/40 bg-card/40 text-muted-foreground hover:border-border/70 hover:text-foreground'
                  : 'cursor-not-allowed border-border/30 bg-card/20 text-muted-foreground/50',
              )}
              title={manualSessionsEnabled
                ? 'Log a session by hand (e.g. "painting 4h") — it shows on the timeline and totals.'
                : 'Enable vault-backed AI Activity in Settings → AI to log sessions by hand.'}
            >
              <Plus className="h-2.5 w-2.5" />
              Log session
            </button>
          )}
          {/* Copy lives in the right-click menu now — see `rowMenu`. It is a
              once-in-a-while action, and a permanent chip for it competed with
              the ones that are not. The confirmation stays: a clipboard write
              that says nothing is indistinguishable from one that failed. */}
          {copied && (
            <span className="inline-flex items-center gap-1 rounded-full border border-foreground/70 bg-foreground/10 px-2 py-0.5 text-[10px] text-foreground">
              <Check className="h-2.5 w-2.5" />
              Copied
            </span>
          )}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-card/40 px-3 py-4 text-xs text-muted-foreground/70">
          No sessions on this day.
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-border/40 bg-card/40"
          style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}
        >
          {/* overflow-x-auto + the table's min-width make the table pan
              horizontally on narrow screens (iPhone) instead of crushing the
              fixed columns to nothing; touch-action pan-x re-enables horizontal
              drag inside the shell's pan-y-only main scroller. */}
          {/* table-layout: fixed so colgroup widths are authoritative AND a wide
              `colSpan` cell (the expanded row's full topic text) cannot stretch
              the table past its container — long topics wrap inside the row
              instead of running off the right edge. */}
          <table className="w-full text-xs" style={{ tableLayout: 'fixed', minWidth: 600 }}>
            {/* Explicit column widths so the Topic column takes the remaining
                space instead of fighting with the natural widths of the other
                cells. Without this, Time gets too much breathing room and
                Topic is squashed to ~10 chars. */}
            <colgroup>
              <col style={{ width: '170px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '130px' }} />
              <col style={{ width: '54px' }} />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-border/30 text-left text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">Time</th>
                <th className="px-3 py-1.5 text-right font-medium">Duration</th>
                <th className="px-3 py-1.5 font-medium">Project</th>
                <th className="px-3 py-1.5 text-right font-medium">Msgs</th>
                <th className="px-3 py-1.5 font-medium">Topic</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Track the last calendar date emitted so we can drop a divider
                // when the table crosses midnight. Initialise with anchor (the
                // day the user clicked) so the very first row doesn't get a
                // divider unless it's already on a different day.
                let lastDate = anchorDateIso ?? (sorted[0] ? isoDayLocal(sorted[0].startedIso) : null)
                return sorted.map(c => {
                  const rowDate = isoDayLocal(c.startedIso)
                  const showDivider = rowDate !== lastDate
                  lastDate = rowDate
                  const color = getProjectColor(c.project, isDark)
                  const isHighlighted = highlightProject != null && c.project === highlightProject
                  const isExpanded = expandedKey === c.key
                  const isSelected = selectedChainKey === c.key
                  const chainTokens = sumTokens(c.sessions.map(s => s.tokens))
                  const hasTokens =
                    chainTokens.input + chainTokens.output + chainTokens.cacheRead + chainTokens.cacheCreation > 0
                  const costUsd = hasTokens ? estimateChainCostUsd(c) : 0
                  const modelLabel = modelSummaryLabel(c)
                  const isReconstructed = c.sessions.every(s => s.reconstructed)
                  // Reading/memorization chains (GoodNotes, memorized, markdown,
                  // excalidraw) have no transcript and no tokens — they're
                  // document/practice sessions, not conversations.
                  const isReading = isReadingSource(c.source)
                  const isManual = isManualSource(c.source)
                  return (
                    <Fragment key={c.key}>
                      {showDivider && (
                        <tr className="border-y border-border/30 bg-muted/20">
                          <td colSpan={5} className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {fmtDividerDate(rowDate)}
                            {anchorDateIso && rowDate > anchorDateIso && (
                              <span className="ml-1.5 text-muted-foreground/60">· overnight tail</span>
                            )}
                          </td>
                        </tr>
                      )}
                  <tr
                    className={cn(
                      'cursor-pointer border-b border-border/20 transition-colors last:border-0',
                      'hover:bg-foreground/[0.04]',
                      isExpanded && 'bg-foreground/[0.04]',
                    )}
                    style={{
                      ...(isHighlighted ? { background: color.chipBg } : undefined),
                      // Ember left-rail marks the chain driving the graph lens.
                      ...(isSelected ? { boxShadow: 'inset 3px 0 0 #FF9E3D' } : undefined),
                    }}
                    onClick={(e) => {
                      // Peek mode: ⌘/Ctrl-click opens the graph slideover for
                      // this session instead of expanding the row.
                      if (enableGraphPeek && !isManual && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        setPeekChain(c)
                        return
                      }
                      onSelectChain?.(c)
                      setExpandedKey(prev => (prev === c.key ? null : c.key))
                    }}
                    // Every row opens the menu now, not just graph-peekable
                    // ones: copy works on any row, and a menu that appears on
                    // some rows and not others teaches people it is not there.
                    onContextMenu={(e) => {
                      e.preventDefault()
                      // The canvas surface this table can sit on has its own
                      // onContextMenu; without stopping here it opens straight
                      // over this menu.
                      e.stopPropagation()
                      setRowMenu({ chain: c, x: e.clientX, y: e.clientY })
                    }}
                    onMouseEnter={enableGraphPeek && !isManual ? warmVaultGraph : undefined}
                    title={
                      onSelectChain
                        ? 'Zoom the graph to the notes this session touched'
                        : enableGraphPeek
                          ? '⌘-click to open in graph · right-click for more'
                          : undefined
                    }
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-foreground/80">
                      {fmtSpan(c.startedIso, c.endedIso)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground/70">
                      {fmtDuration(c.startedIso, c.endedIso)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5" style={{ color: color.stroke }}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color.stroke }} />
                        <span className="truncate" title={projectLabelBlock(c.project)}>
                          {projectLabelBlock(c.project)}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground/80">
                      {isManual ? <span className="text-muted-foreground/50">—</span> : c.msgCount}
                    </td>
                    <ChainTopicCellBlock chain={c} isReconstructed={isReconstructed} />
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-border/20 bg-foreground/[0.02]">
                      <td
                        colSpan={5}
                        className="space-y-2 px-3 py-2 text-[11px] text-muted-foreground"
                        // table-layout: fixed alone doesn't always stop long
                        // unbroken text from stretching a colSpan cell. The
                        // width:0 / max-width:0 pair forces the cell to compute
                        // its width purely from the column track, so the inner
                        // content has to wrap inside the available space.
                        style={{ width: 0, maxWidth: 0 }}
                      >
                        <ChainTopicExpandedBlock chain={c} />
                        {hasTokens ? (
                          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                            <span>
                              <strong className="tabular-nums text-foreground/80">
                                {formatTokens(chainTokens.input + chainTokens.cacheRead + chainTokens.cacheCreation)}
                              </strong>{' '}
                              input
                              <span className="ml-1 text-muted-foreground/70">
                                ({formatTokens(chainTokens.input)} fresh ·{' '}
                                {formatTokens(chainTokens.cacheRead)} cached ·{' '}
                                {formatTokens(chainTokens.cacheCreation)} writes)
                              </span>
                            </span>
                            <span>
                              <strong className="tabular-nums text-foreground/80">
                                {formatTokens(chainTokens.output)}
                              </strong>{' '}
                              output
                            </span>
                            <span>
                              ~<strong className="tabular-nums text-foreground/80">{formatUsd(costUsd)}</strong>{' '}
                              est.
                            </span>
                            {modelLabel && (
                              <span className="rounded bg-muted/40 px-1.5 py-0.5 text-foreground/70">
                                {modelLabel}
                              </span>
                            )}
                            <span className="text-muted-foreground/60">
                              · {c.sessions.length} session{c.sessions.length === 1 ? '' : 's'}
                            </span>
                          </div>
                        ) : isReconstructed ? (
                          <span className="text-muted-foreground/60">
                            Reconstructed from <code>~/.claude/history.jsonl</code> — the original
                            transcript was deleted by Claude Code's 30-day cleanup. Prompt counts
                            and times are real; tokens, cost, and assistant turns are unrecoverable.
                          </span>
                        ) : c.source === 'chatgpt' || c.source === 'grok' ? (
                          <span className="text-muted-foreground/60">
                            Web chat ({c.source}) — providers don't expose token usage in exports.
                          </span>
                        ) : isManual ? (
                          <span className="text-muted-foreground/60">
                            {c.topic && c.topic !== c.project ? `${c.topic} — ` : ''}a session you logged by hand.
                          </span>
                        ) : isReading ? (
                          <span className="text-muted-foreground/60">
                            {c.source === 'goodnotes'
                              ? "Reading session (GoodNotes) — harvested from the document's open-time; duration and page count are real, there's no transcript."
                              : c.source === 'memorized'
                                ? 'Memorization session — recorded from the notebook timer; duration is real, there’s no transcript.'
                                : c.source === 'reading-draw'
                                  ? 'Drawing session (Excalidraw) — recorded from time the canvas was open; duration is real, there’s no transcript.'
                                  : 'Reading session (Markdown) — recorded from time the document was open; duration is real, there’s no transcript.'}
                          </span>
                        ) : c.source === 'claude-code' || c.source === 'codex' ? (
                          // A native transcript with no usage in this window —
                          // a sitting of user turns whose assistant replies fell
                          // outside it, or a provider that logged none. Says
                          // only that, because the branch below used to catch
                          // this case and explain it as a vault export, which
                          // described the wrong file entirely. Absence of a
                          // number is not evidence of where the row came from.
                          <span className="text-muted-foreground/60">
                            No token usage recorded in this sitting's window.
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">
                            No token data — this chain came from the vault markdown source only.
                          </span>
                        )}
                        {(enableGraphPeek || (!isReconstructed && !isReading)) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {!isReconstructed && !isReading && !isManual && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation()
                              setTranscriptChain(c)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-border/80 hover:bg-card/80 hover:text-foreground"
                          >
                            <Maximize2 className="h-3 w-3" />
                            Show entire chain
                          </button>
                          )}
                          {isManual && manualSessionsEnabled && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation()
                              void openManualEdit(c)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-border/80 hover:bg-card/80 hover:text-foreground"
                            title="Edit or delete this logged session"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit session
                          </button>
                          )}
                          {enableGraphPeek && !isManual && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation()
                              setPeekChain(c)
                            }}
                            onMouseEnter={warmVaultGraph}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-border/80 hover:bg-card/80 hover:text-foreground"
                            title="Open the vault graph zoomed to this session's files"
                          >
                            <Share2 className="h-3 w-3" />
                            Show in graph
                          </button>
                          )}
                        </div>
                        )}
                        {isReading && isReadingSessionEditableBlock(c.source) && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation()
                              setEditingChain(c)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-border/80 hover:bg-card/80 hover:text-foreground"
                            title="Adjust this session's start, end, or pages. Other nearby records of the same document will be absorbed."
                          >
                            <Pencil className="h-3 w-3" />
                            Edit session
                          </button>
                        </div>
                        )}
                      </td>
                    </tr>
                  )}
                    </Fragment>
                  )
                })
              })()}
            </tbody>
          </table>
        </div>
      )}
      {dayTotals.chainsWithTokens > 0 && (
        <div className="flex items-baseline justify-end gap-3 px-1 text-[11px] text-muted-foreground">
          <span title="Fresh input + output tokens — the real work, billed at full rate.">
            <strong className="tabular-nums text-foreground/80">
              {formatTokens(dayTotals.totalFreshTokens)}
            </strong>{' '}
            fresh
          </span>
          <span
            className="text-muted-foreground/70"
            title="Cache reads + cache writes — high volume, low cost."
          >
            +{formatTokens(dayTotals.totalCachedTokens)} cached
          </span>
          <span>
            ~<strong className="tabular-nums text-foreground/80">{formatUsd(dayTotals.totalCostUsd)}</strong>{' '}
            est.
          </span>
          {dayTotals.chainsWithTokens < sorted.length && (
            <span className="text-muted-foreground/60">
              (across {dayTotals.chainsWithTokens} of {sorted.length} chains)
            </span>
          )}
        </div>
      )}
      <ChainTranscriptSlideOverBlock chain={transcriptChain} onClose={() => setTranscriptChain(null)} />
      {rowMenu && (
        <ContextMenuBlock
          position={{ x: rowMenu.x, y: rowMenu.y }}
          onClose={() => setRowMenu(null)}
          entries={([
            // Graph + transcript only where they lead somewhere; copy always.
            enableGraphPeek && !isManualSource(rowMenu.chain.source) && {
              key: 'show-in-graph',
              label: 'Show in graph',
              onClick: () => { setPeekChain(rowMenu.chain); setRowMenu(null) },
            },
            enableGraphPeek &&
              !isManualSource(rowMenu.chain.source) &&
              !isReadingSource(rowMenu.chain.source) && {
                key: 'open-transcript',
                label: 'Open transcript',
                onClick: () => { setTranscriptChain(rowMenu.chain); setRowMenu(null) },
              },
            { key: 'copy-sep', kind: 'separator' as const },
            {
              key: 'copy-row',
              label: 'Copy row as Markdown',
              onClick: () => { void copyRowsAsMarkdown([rowMenu.chain]); setRowMenu(null) },
            },
            sorted.length > 0 && {
              key: 'copy-table',
              label: 'Copy table as Markdown',
              onClick: () => { void copyRowsAsMarkdown(sorted); setRowMenu(null) },
            },
          ].filter(Boolean)) as ContextMenuEntryBlock[]}
        />
      )}
      {peekChain && (
        <Suspense fallback={null}>
          <SessionGraphSlideOverBlock chain={peekChain} onClose={() => setPeekChain(null)} />
        </Suspense>
      )}
      {manualModal && (
        <Suspense fallback={null}>
          <ManualSessionEditModalBlock
            record={manualModal.mode === 'edit' ? manualModal.record : null}
            knownProjects={knownProjects}
            defaultDateIso={anchorDateIso}
            onClose={() => setManualModal(null)}
            onSaved={() => { onManualChanged?.() }}
          />
        </Suspense>
      )}
      {editingChain && (
        <ReadingSessionEditModalBlock
          chain={editingChain}
          dayChains={sorted}
          onClose={() => setEditingChain(null)}
          onSaved={() => {
            setEditingChain(null)
            onReadingEdited?.()
          }}
        />
      )}
    </div>
  )
}

// Topic cell — shows the AI-generated short title when a local LLM is
// running and a title has been cached; otherwise renders chain.topic (first
// user message). Subtle styling distinguishes the two so it's clear when the
// label is summarized vs raw.
function ChainTopicCellBlock({
  chain,
  isReconstructed,
}: {
  chain: ActivityChain
  isReconstructed: boolean
}) {
  const { title, summary, isAi, loading } = useChainDigestBlock(chain)
  const tooltip = isAi
    ? summary
      ? `${title}\n\n${summary}\n\n(original: ${chain.topic})`
      : `${title}\n\n(original: ${chain.topic})`
    : chain.topic
  return (
    <td
      className="max-w-0 truncate px-3 py-1.5 text-foreground/70"
      title={tooltip}
    >
      {isReconstructed && (
        <span
          className="mr-1.5 rounded bg-amber-500/15 dark:bg-amber-500/25 px-1 py-px text-[9px] uppercase tracking-[0.08em] text-amber-500/90"
          title="Rebuilt from the prompt history log — the original transcript was deleted by Claude Code's cleanup. Times and prompt counts are real; tokens and assistant turns are gone."
        >
          rebuilt
        </span>
      )}
      <span className={cn(isAi && 'text-foreground/85')}>{title}</span>
      {loading && (
        <span className="ml-1 text-[9px] uppercase tracking-[0.08em] text-muted-foreground/60">
          …
        </span>
      )}
    </td>
  )
}

// Expanded-row topic block — shows the AI title (if any) as the headline
// label, with the original first-message snippet below for context. Keeps
// the previous multi-session topic list intact.
function ChainTopicExpandedBlock({ chain }: { chain: ActivityChain }) {
  const { title, summary, isAi, loading, generator, refresh } = useChainDigestBlock(chain)
  const seen = new Set<string>([chain.topic])
  const extras =
    chain.sessions.length > 1
      ? chain.sessions
          .map(s => s.topic)
          .filter(t => t && !seen.has(t) && (seen.add(t), true))
      : []
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
          Topic
        </span>
        <AiActivitySourceChipBlock generator={generator} />
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            refresh()
          }}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/40 bg-card/40 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground disabled:opacity-40"
          title="Regenerate this title with the currently-selected provider (bypasses reuse — forces a re-run even if a higher-tier version is cached)"
        >
          <RefreshCw className={cn('h-2.5 w-2.5', loading && 'animate-spin')} />
          regenerate
        </button>
      </div>
      {/* The chain's own title, set apart from the body it heads. At the same
          weight and size as the summary it read as the summary's first
          sentence — which is exactly what it is not: it names the whole chain,
          while the body below is one section per session. */}
      <div
        className="whitespace-pre-wrap pb-0.5 text-[13px] font-semibold leading-snug text-foreground"
        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
      >
        {title}
      </div>
      {summary && (
        <LightMarkdownTextBlock
          text={summary}
          className="border-t border-border/40 pt-1.5 text-[11px] leading-relaxed text-foreground/70"
        />
      )}
      {isAi && (
        <div
          className="whitespace-pre-wrap pl-3 text-[10px] text-muted-foreground/70"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
        >
          opened with: {chain.topic}
        </div>
      )}
      {extras.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-3 text-muted-foreground/80">
          {extras.map((t, i) => (
            <li
              key={i}
              className="whitespace-pre-wrap"
              style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            >
              · {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
