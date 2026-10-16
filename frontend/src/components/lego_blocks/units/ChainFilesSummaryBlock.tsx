import { useMemo } from 'react'
import type {
  TranscriptFileTouchBlock,
  TranscriptSummaryBlock,
  TranscriptUsageBlock,
} from '@/services/lego_blocks/units/parseTranscriptEventsBlock'
import { addUsageBlock } from '@/services/lego_blocks/units/parseTranscriptEventsBlock'
import { formatTokens, formatUsd } from '@/services/lego_blocks/units/aiPriceTableBlock'
import { usageCostBlock } from '@/services/lego_blocks/units/transcriptUsageCostBlock'
import {
  TX_JUMP_EVENT,
  TranscriptFileRowBlock,
  type TranscriptFileOpenerBlock,
  type TxJumpDetail,
} from '@/components/lego_blocks/units/TranscriptViewBlock'

/**
 * What a whole chain changed, across every session in it.
 *
 * A chain is often one piece of work spread over several sittings; each
 * session's card answers "what did this sitting do", and only this one answers
 * "what did the work do". A file touched in several sessions is one row —
 * created if any session created it, line counts summed — and jumps to the
 * first session that changed it.
 */

export interface ChainSummaryPartBlock {
  /** 1-based session number, as shown in the drawer. */
  index: number
  summary: TranscriptSummaryBlock
}

interface MergedFile {
  file: TranscriptFileTouchBlock
  /** Session that first changed it — the jump target. */
  firstSession: number
  sessions: Set<number>
}

const RANK = { read: 0, edited: 1, created: 2 } as const

export default function ChainFilesSummaryBlock({
  parts,
  opener,
}: {
  parts: ChainSummaryPartBlock[]
  opener?: TranscriptFileOpenerBlock
}) {
  const { files, usage } = useMemo(() => {
    const byKey = new Map<string, MergedFile>()
    const total: TranscriptUsageBlock = {}
    for (const { index, summary } of parts) {
      for (const [model, t] of Object.entries(summary.usage)) addUsageBlock(total, model, t)
      for (const f of summary.files) {
        if (f.change === 'read') continue
        const key = f.abs ?? f.path
        const prev = byKey.get(key)
        if (!prev) {
          byKey.set(key, { file: { ...f }, firstSession: index, sessions: new Set([index]) })
          continue
        }
        prev.sessions.add(index)
        prev.file.ops += f.ops
        prev.file.added += f.added
        prev.file.removed += f.removed
        if (RANK[f.change] > RANK[prev.file.change]) prev.file.change = f.change
      }
    }
    const list = [...byKey.values()].sort(
      (a, b) => RANK[b.file.change] - RANK[a.file.change] || a.file.path.localeCompare(b.file.path),
    )
    return { files: list, usage: total }
  }, [parts])

  const { usd, tokens, partial } = usageCostBlock(usage)
  const jump = (m: MergedFile) => {
    window.dispatchEvent(
      new CustomEvent<TxJumpDetail>(TX_JUMP_EVENT, {
        detail: { prefix: `tx-${m.firstSession}`, index: m.file.firstItem },
      }),
    )
  }

  return (
    <div className="mb-6 rounded-md border border-border/40 bg-muted/20 px-3 py-2.5 font-mono text-[12.5px] leading-[1.7]">
      <div className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
        <span className="select-none text-violet-500/80 dark:text-violet-400/80">✻</span>
        <span>
          Whole chain · {parts.length} sessions
          {files.length ? ` · ${files.length} file${files.length === 1 ? '' : 's'} changed` : ''}
        </span>
        {tokens > 0 && (
          <span className="ml-auto tabular-nums text-muted-foreground/60" title={`${tokens.toLocaleString()} tokens`}>
            {usd !== null ? `${formatUsd(usd)}${partial ? '+' : ''}` : `${formatTokens(tokens)} tok`}
          </span>
        )}
      </div>
      {files.length > 0 && (
        <div className="mt-2">
          {files.map(m => (
            <TranscriptFileRowBlock
              key={m.file.abs ?? m.file.path}
              f={m.file}
              onJump={() => jump(m)}
              opener={opener}
              badge={[...m.sessions].sort((a, b) => a - b).map(n => `S${n}`).join(',')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
