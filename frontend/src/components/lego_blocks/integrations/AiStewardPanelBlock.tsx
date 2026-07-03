import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
  applyStewardMetadataToFileOrch,
  generateStewardMetadataSuggestionForFileOrch,
  type StewardMetadataSuggestion,
} from '@/services/orchestrators/stewardMetadataOrch'
import { getVaultFS } from '@/services/orchestrators/runtimeOrch'
import { cn } from '@/lib/utils'

interface AiStewardPanelBlockProps {
  filePath?: string
  disabled?: boolean
  onApplySuggestion?: (suggestion: StewardMetadataSuggestion) => void | Promise<void>
  onRunningChange?: (running: boolean) => void
  className?: string
  showMissingFileMessage?: boolean
}

interface PurposeProposalState {
  suggestion: StewardMetadataSuggestion
  generatedAt: string
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
}

export default function AiStewardPanelBlock({
  filePath,
  disabled = false,
  onApplySuggestion,
  onRunningChange,
  className,
  showMissingFileMessage = true,
}: AiStewardPanelBlockProps) {
  const resolvedFilePath = (filePath ?? '').trim()
  const [fileCheckLoading, setFileCheckLoading] = useState(false)
  const [fileAvailable, setFileAvailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [proposal, setProposal] = useState<PurposeProposalState | null>(null)
  const [proposalEditMode, setProposalEditMode] = useState(false)

  useEffect(() => {
    if (!resolvedFilePath) {
      setFileCheckLoading(false)
      setFileAvailable(false)
      return
    }

    let cancelled = false
    setFileCheckLoading(true)
    void (async () => {
      try {
        const fs = getVaultFS()
        const exists = await fs.exists(resolvedFilePath)
        if (cancelled) return
        setFileAvailable(Boolean(exists))
      } catch {
        if (cancelled) return
        setFileAvailable(false)
      } finally {
        if (!cancelled) setFileCheckLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [resolvedFilePath])

  useEffect(() => {
    onRunningChange?.(loading)
  }, [loading, onRunningChange])

  useEffect(() => {
    return () => {
      onRunningChange?.(false)
    }
  }, [onRunningChange])

  useEffect(() => {
    setLoading(false)
    setError(null)
    setMessage(null)
    setProposal(null)
    setProposalEditMode(false)
  }, [resolvedFilePath, fileAvailable])

  useEffect(() => {
    if (!message) return
    const timeoutId = window.setTimeout(() => {
      setMessage(null)
    }, 2800)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [message])

  const generateProposal = useCallback(async () => {
    if (!resolvedFilePath || !fileAvailable) return
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const suggestion = await generateStewardMetadataSuggestionForFileOrch(resolvedFilePath)
      setProposal({
        suggestion,
        generatedAt: new Date().toISOString(),
      })
      setProposalEditMode(false)
      const source = suggestion.usedAi
        ? `AI (${suggestion.provider}${suggestion.model ? `/${suggestion.model}` : ''})`
        : 'heuristics'
      setMessage(`Generated purpose proposal from ${source}. Review and accept or reject.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate steward metadata')
    } finally {
      setLoading(false)
    }
  }, [fileAvailable, resolvedFilePath])

  const acceptProposal = useCallback(async () => {
    if (!proposal) return
    try {
      if (onApplySuggestion) {
        await onApplySuggestion(proposal.suggestion)
      } else if (resolvedFilePath && fileAvailable) {
        await applyStewardMetadataToFileOrch({
          filePath: resolvedFilePath,
          summary: proposal.suggestion.summary,
          tags: proposal.suggestion.tags,
          suggestedEpicKey: proposal.suggestion.suggestedEpicKey,
          suggestedIdeaKey: proposal.suggestion.suggestedIdeaKey,
        })
      } else {
        throw new Error('Cannot apply steward proposal without a saved file.')
      }
      setProposal(null)
      setError(null)
      setMessage('Applied purpose proposal.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply purpose proposal')
    }
  }, [fileAvailable, onApplySuggestion, proposal, resolvedFilePath])

  const dismissProposal = useCallback(() => {
    if (!proposal) return
    setProposal(null)
    setProposalEditMode(false)
    setError(null)
    setMessage(onApplySuggestion ? 'Rejected purpose proposal.' : 'Dismissed purpose proposal.')
  }, [onApplySuggestion, proposal])

  const updateProposalSuggestion = useCallback((patch: Partial<StewardMetadataSuggestion>) => {
    setProposal((current) => {
      if (!current) return current
      return {
        ...current,
        suggestion: {
          ...current.suggestion,
          ...patch,
        },
      }
    })
  }, [])

  if (!resolvedFilePath || (!fileCheckLoading && !fileAvailable)) {
    if (!showMissingFileMessage) return null
    return (
      <div className={cn('rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground', className)}>
        AI Steward is hidden for raw content. Save or open an existing file path to enable steward proposals.
      </div>
    )
  }

  if (fileCheckLoading) {
    return (
      <div className={cn('rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground', className)}>
        Checking file context for AI Steward...
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">
          AI Steward
        </div>
        <button
          type="button"
          onClick={() => { void generateProposal() }}
          disabled={disabled || loading}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          title="Generate steward purpose metadata for this file"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? 'Generating...' : 'Purpose for This File'}
        </button>
      </div>
      <div className="text-xs text-muted-foreground">
        Steward generates metadata proposal for the file based on its understanding.
      </div>

      {message && (
        <div className="inline-flex h-8 items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20 px-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {proposal && (
        <div className="space-y-2 rounded-lg border border-border/70 bg-background px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Purpose Proposal
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] text-muted-foreground">
                {new Date(proposal.generatedAt).toLocaleString()}
              </div>
              <button
                type="button"
                onClick={() => setProposalEditMode(prev => !prev)}
                className="rounded-md border border-border/70 px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:opacity-60"
                disabled={disabled}
              >
                {proposalEditMode ? 'Done' : 'Edit'}
              </button>
            </div>
          </div>

          {proposalEditMode ? (
            <>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Summary
                </label>
                <textarea
                  value={proposal.suggestion.summary}
                  onChange={(event) => updateProposalSuggestion({ summary: event.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={disabled}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Tags (comma separated)
                </label>
                <input
                  value={proposal.suggestion.tags.join(', ')}
                  onChange={(event) => updateProposalSuggestion({ tags: parseTagsInput(event.target.value) })}
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={disabled}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Suggested Epic Key
                  </label>
                  <input
                    value={proposal.suggestion.suggestedEpicKey ?? ''}
                    onChange={(event) => updateProposalSuggestion({ suggestedEpicKey: event.target.value.trim() || undefined })}
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Suggested Idea Key
                  </label>
                  <input
                    value={proposal.suggestion.suggestedIdeaKey ?? ''}
                    onChange={(event) => updateProposalSuggestion({ suggestedIdeaKey: event.target.value.trim() || undefined })}
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Rationale
                </label>
                <textarea
                  value={proposal.suggestion.rationale}
                  onChange={(event) => updateProposalSuggestion({ rationale: event.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-border/60 bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                  disabled={disabled}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-foreground">{proposal.suggestion.summary}</p>

              {(proposal.suggestion.tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1">
                  {proposal.suggestion.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="text-[11px] text-muted-foreground">
                Suggested epic: {proposal.suggestion.suggestedEpicKey || 'none'} | Suggested idea: {proposal.suggestion.suggestedIdeaKey || 'none'}
              </div>

              <div className="text-[11px] text-muted-foreground">
                {proposal.suggestion.rationale}
              </div>
            </>
          )}

          {proposalEditMode && (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-muted-foreground">
                Edit before applying.
              </div>
              <button
                type="button"
                onClick={() => {
                  setProposal((current) => {
                    if (!current) return current
                    return {
                      ...current,
                      suggestion: {
                        ...current.suggestion,
                        summary: current.suggestion.summary.trim(),
                        rationale: current.suggestion.rationale.trim(),
                        tags: current.suggestion.tags.map(tag => tag.trim()).filter(Boolean),
                      },
                    }
                  })
                }}
                className="rounded-md border border-border/70 px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                disabled={disabled}
              >
                Normalize Fields
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void acceptProposal() }}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-95 disabled:opacity-60"
              disabled={disabled}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={dismissProposal}
              className="rounded-md border border-border/70 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
              disabled={disabled}
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
