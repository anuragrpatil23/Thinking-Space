import { useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import {
  parseStewardTagDraftOrch,
  type StewardProposal,
  type StewardProposalPayload,
} from '@/services/orchestrators/stewardProposalQueueOrch'

interface StewardProposalQueueBlockProps {
  proposals: StewardProposal[]
  selectedFileLabel?: string
  canGenerate: boolean
  generating?: boolean
  busyProposalId?: string | null
  onGenerateForSelectedFile: () => void
  onAccept: (proposal: StewardProposal, payload: StewardProposalPayload) => void
  onReject: (proposal: StewardProposal) => void
  onClearResolved?: () => void
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return date.toLocaleString()
}

function proposalPayloadPreview(proposal: StewardProposal): string {
  if (proposal.action === 'update_description') {
    return proposal.payload.description ?? ''
  }
  if (proposal.action === 'update_tags') {
    const tags = proposal.payload.tags ?? []
    return tags.join(', ')
  }
  return proposal.payload.summary ?? ''
}

export default function StewardProposalQueueBlock({
  proposals,
  selectedFileLabel,
  canGenerate,
  generating = false,
  busyProposalId = null,
  onGenerateForSelectedFile,
  onAccept,
  onReject,
  onClearResolved,
}: StewardProposalQueueBlockProps) {
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [summaryDraft, setSummaryDraft] = useState('')
  const [suggestedEpicDraft, setSuggestedEpicDraft] = useState('')
  const [suggestedIdeaDraft, setSuggestedIdeaDraft] = useState('')

  const pendingCount = useMemo(
    () => proposals.filter(item => item.status === 'pending').length,
    [proposals],
  )
  const hasResolved = useMemo(
    () => proposals.some(item => item.status !== 'pending'),
    [proposals],
  )
  const sorted = useMemo(
    () => [...proposals].sort((a, b) => {
      if (a.status === b.status) return b.updatedAt.localeCompare(a.updatedAt)
      if (a.status === 'pending') return -1
      if (b.status === 'pending') return 1
      return b.updatedAt.localeCompare(a.updatedAt)
    }),
    [proposals],
  )

  const startModify = (proposal: StewardProposal) => {
    setEditingProposalId(proposal.id)
    if (proposal.action === 'update_description') {
      setDescriptionDraft(proposal.payload.description ?? '')
      setTagsDraft('')
      setSummaryDraft('')
      setSuggestedEpicDraft('')
      setSuggestedIdeaDraft('')
      return
    }
    if (proposal.action === 'update_tags') {
      setTagsDraft((proposal.payload.tags ?? []).join(', '))
      setDescriptionDraft('')
      setSummaryDraft('')
      setSuggestedEpicDraft('')
      setSuggestedIdeaDraft('')
      return
    }
    setSummaryDraft(proposal.payload.summary ?? '')
    setTagsDraft((proposal.payload.tags ?? []).join(', '))
    setSuggestedEpicDraft(proposal.payload.suggestedEpicKey ?? '')
    setSuggestedIdeaDraft(proposal.payload.suggestedIdeaKey ?? '')
    setDescriptionDraft('')
  }

  const cancelModify = () => {
    setEditingProposalId(null)
    setDescriptionDraft('')
    setTagsDraft('')
    setSummaryDraft('')
    setSuggestedEpicDraft('')
    setSuggestedIdeaDraft('')
  }

  const acceptWithCurrentDraft = (proposal: StewardProposal) => {
    if (proposal.action === 'update_description') {
      onAccept(proposal, { description: descriptionDraft })
      return
    }
    if (proposal.action === 'update_tags') {
      onAccept(proposal, { tags: parseStewardTagDraftOrch(tagsDraft) })
      return
    }
    onAccept(proposal, {
      summary: summaryDraft,
      tags: parseStewardTagDraftOrch(tagsDraft),
      suggestedEpicKey: suggestedEpicDraft.trim(),
      suggestedIdeaKey: suggestedIdeaDraft.trim(),
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Steward Proposal Queue
        </CardTitle>
        <CardDescription>
          Review pending steward actions and explicitly accept, modify, or reject each proposal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={onGenerateForSelectedFile}
            disabled={!canGenerate || generating}
          >
            {generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            Propose For Selected File
          </Button>
          <span className="text-xs text-muted-foreground">
            {selectedFileLabel ? `Selected file: ${selectedFileLabel}` : 'Select a markdown file to generate metadata proposals.'}
          </span>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-xs">
            Pending {pendingCount}
          </span>
          {onClearResolved && hasResolved && (
            <Button size="sm" variant="outline" onClick={onClearResolved}>
              Clear Resolved
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
            Queue is empty.
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map(proposal => {
              const pending = proposal.status === 'pending'
              const editing = editingProposalId === proposal.id
              const busy = busyProposalId === proposal.id
              return (
                <div key={proposal.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{proposal.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {proposal.nodeTitle} • {proposal.nodeType.replace(/_/g, ' ')} • {formatTimestamp(proposal.updatedAt)}
                      </p>
                      <p className="text-xs text-muted-foreground">{proposal.rationale}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        proposal.status === 'pending'
                          ? 'bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300'
                          : proposal.status === 'accepted'
                            ? 'bg-emerald-500/15 dark:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {proposal.status}
                    </span>
                  </div>

                  {!editing ? (
                    <div className="mt-2 rounded border border-border/50 bg-muted/20 px-2 py-1.5 text-xs">
                      {proposal.action === 'update_tags' ? (
                        <div className="flex flex-wrap gap-1">
                          {(proposal.payload.tags ?? []).map(tag => (
                            <span key={`${proposal.id}-${tag}`} className="rounded-full bg-muted px-1.5 py-0.5">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : proposal.action === 'update_file_yaml_metadata' ? (
                        <div className="space-y-1">
                          <p className="whitespace-pre-wrap">{proposalPayloadPreview(proposal)}</p>
                          {(proposal.payload.tags ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(proposal.payload.tags ?? []).map(tag => (
                                <span key={`${proposal.id}-${tag}`} className="rounded-full bg-muted px-1.5 py-0.5">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            Suggested epic: {proposal.payload.suggestedEpicKey || 'none'} | Suggested idea: {proposal.payload.suggestedIdeaKey || 'none'}
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{proposalPayloadPreview(proposal)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {proposal.action === 'update_description' ? (
                        <textarea
                          value={descriptionDraft}
                          onChange={(event) => setDescriptionDraft(event.target.value)}
                          rows={4}
                          className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Modify description before accepting"
                        />
                      ) : proposal.action === 'update_tags' ? (
                        <input
                          value={tagsDraft}
                          onChange={(event) => setTagsDraft(event.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="tag/one, tag/two"
                        />
                      ) : (
                        <div className="space-y-2">
                          <textarea
                            value={summaryDraft}
                            onChange={(event) => setSummaryDraft(event.target.value)}
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="Concise summary"
                          />
                          <input
                            value={tagsDraft}
                            onChange={(event) => setTagsDraft(event.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="tag/one, tag/two"
                          />
                          <input
                            value={suggestedEpicDraft}
                            onChange={(event) => setSuggestedEpicDraft(event.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="suggested epic key (optional)"
                          />
                          <input
                            value={suggestedIdeaDraft}
                            onChange={(event) => setSuggestedIdeaDraft(event.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="suggested idea key (optional)"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {pending && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!editing ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => startModify(proposal)} disabled={busy}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Modify
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => onReject(proposal)} disabled={busy}>
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Reject
                          </Button>
                          <Button size="sm" onClick={() => onAccept(proposal, proposal.payload)} disabled={busy}>
                            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                            Accept
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={cancelModify} disabled={busy}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => acceptWithCurrentDraft(proposal)} disabled={busy}>
                            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                            Accept Modified
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
