// The knobs that decide what a local digest costs, with the reasoning and the
// measured numbers attached.
//
// These used to be constants in code and JSON. They aren't really constants —
// they're judgement calls that depend on the machine and the model, and the
// right value moves when either changes. A number without its rationale is
// impossible to revisit safely, so each control carries why it exists and the
// evidence needed to pick a value.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { cn } from '@/lib/utils'
import {
  AI_INPUT_BUDGET_DEFAULT_TOKENS,
  AI_INPUT_BUDGET_MAX_TOKENS,
  AI_INPUT_BUDGET_MIN_TOKENS,
  getAiInputBudgetTokens,
  setAiInputBudgetTokens,
} from '@/services/lego_blocks/units/storageKeyBlock'
import {
  cancelAllRunningJobsBlock,
  cancelRunningJobBlock,
  listRunningJobsBlock,
  subscribeRunningJobsBlock,
  type RunningJob,
} from '@/services/lego_blocks/units/intelligence/runningJobsBlock'

// Measured on this machine: Apple M5 Max, Qwen3.8-27B at 4bit via rapid-mlx.
// Prefill dominates and gets *worse* per token as the prompt grows, which is
// the entire reason an input budget exists — the model's context window is far
// larger than anything worth waiting for.
const PREFILL_SAMPLES: Array<{ tokens: number; seconds: number }> = [
  { tokens: 1_072, seconds: 1.8 },
  { tokens: 5_322, seconds: 5.9 },
  { tokens: 21_268, seconds: 29.7 },
  { tokens: 63_768, seconds: 146.7 },
]

/** Interpolate the measured curve so a chosen budget shows its real cost. */
function estimatePrefillSeconds(tokens: number): number {
  const pts = PREFILL_SAMPLES
  if (tokens <= pts[0].tokens) return (tokens / pts[0].tokens) * pts[0].seconds
  for (let i = 1; i < pts.length; i += 1) {
    if (tokens <= pts[i].tokens) {
      const a = pts[i - 1]
      const b = pts[i]
      const f = (tokens - a.tokens) / (b.tokens - a.tokens)
      return a.seconds + f * (b.seconds - a.seconds)
    }
  }
  const last = pts[pts.length - 1]
  return (tokens / last.tokens) * last.seconds
}

function humanSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

function elapsed(since: number): string {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function IntelligenceTuningBlock() {
  const [budget, setBudget] = useState(() => getAiInputBudgetTokens())
  const [saved, setSaved] = useState<string | null>(null)
  const [jobs, setJobs] = useState<RunningJob[]>(() => listRunningJobsBlock())
  const [, forceTick] = useState(0)

  useEffect(() => subscribeRunningJobsBlock(() => setJobs(listRunningJobsBlock())), [])

  // Re-render while jobs are in flight so the elapsed clock advances.
  useEffect(() => {
    if (jobs.length === 0) return
    const t = setInterval(() => forceTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [jobs.length])

  const onSaveBudget = useCallback((next: number) => {
    setAiInputBudgetTokens(next)
    setBudget(getAiInputBudgetTokens())
    setSaved(`Input budget set to ${getAiInputBudgetTokens().toLocaleString()} tokens.`)
  }, [])

  const prefill = estimatePrefillSeconds(budget)

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Input budget
        </div>
        <div className="rounded-md border border-border/50 p-3 text-xs">
          <p className="text-muted-foreground">
            How much of a session&rsquo;s transcript a digest may read. This is a{' '}
            <strong className="text-foreground">latency</strong> budget, not a context-window one —
            the model&rsquo;s window is far larger than anything worth waiting for. Turns above the
            budget are head-and-tailed, and whole mid-session turns are dropped if the total still
            doesn&rsquo;t fit.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="number"
              value={budget}
              min={AI_INPUT_BUDGET_MIN_TOKENS}
              max={AI_INPUT_BUDGET_MAX_TOKENS}
              step={1000}
              onChange={(e) => setBudget(Number(e.target.value))}
              aria-label="Input budget in tokens"
              className={cn('w-32 rounded-md border border-border/70 bg-background px-2 py-1')}
            />
            <span className="text-muted-foreground">tokens</span>
            <Button size="sm" onClick={() => onSaveBudget(budget)}>Save</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSaveBudget(AI_INPUT_BUDGET_DEFAULT_TOKENS)}
            >
              Reset to {AI_INPUT_BUDGET_DEFAULT_TOKENS.toLocaleString()}
            </Button>
          </div>

          <div className="mt-2 text-muted-foreground">
            At {budget.toLocaleString()} tokens, expect roughly{' '}
            <strong className="text-foreground">{humanSeconds(prefill)}</strong> of prefill before
            the model writes anything — per digest.
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-muted-foreground">
              Measured prefill cost on this machine
            </summary>
            <table className="mt-2 w-full text-[11px] text-muted-foreground">
              <thead>
                <tr className="text-left">
                  <th className="font-medium">Prompt</th>
                  <th className="font-medium">Prefill</th>
                  <th className="font-medium">Throughput</th>
                </tr>
              </thead>
              <tbody>
                {PREFILL_SAMPLES.map(s => (
                  <tr key={s.tokens}>
                    <td>{s.tokens.toLocaleString()} tok</td>
                    <td>{s.seconds}s</td>
                    <td>{Math.round(s.tokens / s.seconds).toLocaleString()} tok/s</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Throughput <em>falls</em> as the prompt grows, so cost rises faster than length.
              Apple M5 Max, Qwen3.8-27B 4bit.
            </p>
          </details>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Running now
          </div>
          {jobs.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => { cancelAllRunningJobsBlock() }}>
              Cancel all
            </Button>
          )}
        </div>
        {jobs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/50 p-3 text-xs text-muted-foreground">
            Nothing running. Requests appear here while in flight — a model may think for as long as
            it wants, so this is how you stop one that has gone too long.
          </div>
        ) : (
          <div className="space-y-1">
            {jobs.map(job => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{job.taskId}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{job.model}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{elapsed(job.startedAt)}</span>
                  <Button size="sm" variant="outline" onClick={() => { cancelRunningJobBlock(job.id) }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {saved && <div className="text-xs text-muted-foreground">{saved}</div>}
    </div>
  )
}
