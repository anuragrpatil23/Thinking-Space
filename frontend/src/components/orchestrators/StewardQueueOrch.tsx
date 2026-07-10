import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import VaultExplorerBlock from '@/components/lego_blocks/integrations/VaultExplorerBlock'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import type { CapabilityActor } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'
import type { AiTelemetryEvent } from '@/services/orchestrators/aiTelemetryOrch'
import { listFolderEntries, readFileTooltipMeta } from '@/services/orchestrators/fileSystemOrch'
import { getOrganizerNodeByPathOrch } from '@/services/orchestrators/organizerNodeLookupOrch'
import { invokeCapabilityOrThrow } from '@/services/orchestrators/capabilityRouterOrch'
import StewardProposalQueueBlock from '@/components/lego_blocks/integrations/StewardProposalQueueBlock'
import {
  applyStewardMetadataToFileOrch,
  generateStewardMetadataSuggestionForFileOrch,
  type StewardSimilaritySnapshot,
} from '@/services/orchestrators/stewardMetadataOrch'
import {
  clearResolvedStewardProposalsOrch,
  createStewardFileYamlMetadataProposalOrch,
  enqueueStewardProposalsOrch,
  markStewardProposalAcceptedOrch,
  markStewardProposalRejectedOrch,
  readStewardProposalQueueOrch,
  writeStewardProposalQueueOrch,
  type StewardProposal,
  type StewardProposalPayload,
} from '@/services/orchestrators/stewardProposalQueueOrch'

const STEWARD_ACTOR: CapabilityActor = {
  kind: 'human',
  id: 'ui.steward-queue',
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return fallback
}

function formatTelemetryTime(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function summarizeSimilarityForRationale(similarity?: StewardSimilaritySnapshot): string {
  if (!similarity) return ''
  const topEpic = similarity.epics[0]?.key
  const topIdea = similarity.ideas[0]?.key
  const topThought = similarity.thoughts[0]?.key
  const parts = [topEpic, topIdea, topThought].filter(Boolean)
  if (parts.length === 0) return ''
  return `Similarity hints (${similarity.engine}): ${parts.join(', ')}.`
}

export default function StewardQueueOrch() {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<NodeRecord | null>(null)
  const [resolvingSelection, setResolvingSelection] = useState(false)
  const [queue, setQueue] = useState<StewardProposal[]>(() => readStewardProposalQueueOrch())
  const [generating, setGenerating] = useState(false)
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastGenerationTelemetry, setLastGenerationTelemetry] = useState<AiTelemetryEvent | null>(null)
  const [lastSimilarity, setLastSimilarity] = useState<StewardSimilaritySnapshot | null>(null)

  const updateQueue = useCallback((updater: (prev: StewardProposal[]) => StewardProposal[]) => {
    setQueue(prev => {
      const next = updater(prev)
      writeStewardProposalQueueOrch(next)
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!selectedFilePath) {
      setSelectedNode(null)
      return
    }

    setResolvingSelection(true)
    setError(null)
    void (async () => {
      try {
        const node = await getOrganizerNodeByPathOrch(selectedFilePath)
        if (cancelled) return
        setSelectedNode(node ?? null)
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, 'Failed to resolve selected file in organizer cache'))
          setSelectedNode(null)
        }
      } finally {
        if (!cancelled) setResolvingSelection(false)
      }
    })()

    return () => { cancelled = true }
  }, [selectedFilePath])

  const canGenerate = !!selectedFilePath && selectedFilePath.toLowerCase().endsWith('.md')

  const generateForSelectedFile = useCallback(async () => {
    if (!selectedFilePath) {
      setError('Select a file first.')
      return
    }
    if (!selectedFilePath.toLowerCase().endsWith('.md')) {
      setError('Steward metadata proposals are only supported for markdown files.')
      return
    }

    setGenerating(true)
    setError(null)
    setMessage(null)
    try {
      const suggestion = await generateStewardMetadataSuggestionForFileOrch(selectedFilePath)
      setLastGenerationTelemetry(suggestion.telemetry ?? null)
      setLastSimilarity(suggestion.similarity ?? null)
      const similarityContext = summarizeSimilarityForRationale(suggestion.similarity)
      const proposal = createStewardFileYamlMetadataProposalOrch({
        filePath: selectedFilePath,
        node: selectedNode,
        summary: suggestion.summary,
        tags: suggestion.tags,
        suggestedEpicKey: suggestion.suggestedEpicKey,
        suggestedIdeaKey: suggestion.suggestedIdeaKey,
        rationale: [suggestion.rationale, similarityContext].filter(Boolean).join(' '),
      })
      updateQueue(prev => {
        const { queue: next, added } = enqueueStewardProposalsOrch(prev, [proposal])
        if (added > 0) {
          const source = suggestion.usedAi
            ? `AI (${suggestion.provider}${suggestion.model ? `/${suggestion.model}` : ''})`
            : 'heuristics'
          const fileLabel = selectedNode?.title || selectedFilePath.split('/').pop() || selectedFilePath
          setMessage(`Queued metadata proposal for ${fileLabel} from ${source}.`)
        } else {
          setMessage('An equivalent pending metadata proposal already exists for this file.')
        }
        return next
      })
    } catch (err) {
      setError(errorMessage(err, 'Failed to generate steward metadata proposal'))
      setLastGenerationTelemetry(null)
      setLastSimilarity(null)
    } finally {
      setGenerating(false)
    }
  }, [selectedFilePath, selectedNode, updateQueue])

  const acceptProposal = useCallback(async (proposal: StewardProposal, payload: StewardProposalPayload) => {
    if (proposal.status !== 'pending') return
    setBusyProposalId(proposal.id)
    setError(null)
    setMessage(null)

    try {
      let appliedPayload: StewardProposalPayload

      if (proposal.action === 'update_file_yaml_metadata') {
        const summary = (payload.summary ?? '').trim()
        const tags = (payload.tags ?? []).filter(Boolean)
        if (!summary) throw new Error('Summary cannot be empty.')
        if (tags.length === 0) throw new Error('At least one tag is required.')

        const suggestedEpicKey = (payload.suggestedEpicKey ?? '').trim() || undefined
        const suggestedIdeaKey = (payload.suggestedIdeaKey ?? '').trim() || undefined

        await applyStewardMetadataToFileOrch({
          filePath: proposal.nodeFilePath,
          summary,
          tags,
          suggestedEpicKey,
          suggestedIdeaKey,
        })

        appliedPayload = {
          summary,
          tags,
          suggestedEpicKey,
          suggestedIdeaKey,
        }
      } else if (proposal.action === 'update_description') {
        const description = (payload.description ?? '').trim()
        if (!description) throw new Error('Description cannot be empty.')
        if (!proposal.nodeUuid) throw new Error('Missing organizer node for description update.')
        await invokeCapabilityOrThrow({
          capability: 'organizer.node.update',
          input: {
            uuid: proposal.nodeUuid,
            updates: { description },
          },
          actor: STEWARD_ACTOR,
        })
        appliedPayload = { description }
      } else {
        const tags = (payload.tags ?? []).filter(Boolean)
        if (tags.length === 0) throw new Error('At least one tag is required.')
        if (!proposal.nodeUuid) throw new Error('Missing organizer node for tag update.')
        await invokeCapabilityOrThrow({
          capability: 'organizer.node.update',
          input: {
            uuid: proposal.nodeUuid,
            updates: { tags },
          },
          actor: STEWARD_ACTOR,
        })
        appliedPayload = { tags }
      }

      updateQueue(prev => markStewardProposalAcceptedOrch(prev, proposal.id, appliedPayload))
      if (selectedNode?.uuid && proposal.nodeUuid && selectedNode.uuid === proposal.nodeUuid) {
        const refreshed = await getOrganizerNodeByPathOrch(proposal.nodeFilePath)
        if (refreshed) {
          setSelectedNode(refreshed)
        }
      }
      setMessage(`Accepted steward proposal: ${proposal.title}`)
    } catch (err) {
      setError(errorMessage(err, `Failed to apply proposal: ${proposal.title}`))
    } finally {
      setBusyProposalId(null)
    }
  }, [selectedNode?.uuid, updateQueue])

  const rejectProposal = useCallback((proposal: StewardProposal) => {
    if (proposal.status !== 'pending') return
    updateQueue(prev => markStewardProposalRejectedOrch(prev, proposal.id))
    setMessage(`Rejected steward proposal: ${proposal.title}`)
    setError(null)
  }, [updateQueue])

  const clearResolved = useCallback(() => {
    const resolvedCount = queue.filter(item => item.status !== 'pending').length
    if (resolvedCount === 0) return
    updateQueue(prev => clearResolvedStewardProposalsOrch(prev))
    setMessage(`Cleared ${resolvedCount} resolved steward proposal${resolvedCount === 1 ? '' : 's'}.`)
  }, [queue, updateQueue])

  return (
    <div className="space-y-4">
      {(message || error) && (
        <div className="space-y-2">
          {message && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="flex min-h-[420px] h-[calc(100dvh-16rem)] flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">File Explorer</CardTitle>
            <CardDescription>Select the file you want steward proposals for.</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <VaultExplorerBlock
              loadEntries={listFolderEntries}
              loadFileMeta={readFileTooltipMeta}
              onOpenFile={() => {}}
              onSelectFile={setSelectedFilePath}
              title="Vault Files"
              className="h-full"
            />
          </CardContent>
        </Card>

        <div className="space-y-3">
          {(selectedFilePath || resolvingSelection) && (
            <Card>
              <CardContent className="space-y-2 pt-4 text-xs text-muted-foreground">
                <div>
                  Selected: <span className="font-mono text-foreground">{selectedFilePath ?? 'resolving...'}</span>
                </div>
                {resolvingSelection ? (
                  <div className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Resolving organizer node...
                  </div>
                ) : selectedNode ? (
                  <div>
                    Node: <span className="text-foreground">{selectedNode.title}</span> ({selectedNode.type})
                  </div>
                ) : (
                  <div>No organizer node found for this file yet.</div>
                )}
              </CardContent>
            </Card>
          )}

          {lastGenerationTelemetry && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Last Generation Telemetry</CardTitle>
                <CardDescription>
                  {lastGenerationTelemetry.provider} • {lastGenerationTelemetry.model}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <div>
                  Status: <span className="text-foreground">{lastGenerationTelemetry.status}</span>
                </div>
                <div>
                  Time: <span className="text-foreground">{lastGenerationTelemetry.latencyMs ?? '-'} ms</span>
                </div>
                <div>
                  Tokens:
                  <span className="text-foreground">
                    {' '}in {lastGenerationTelemetry.inputTokens ?? '-'} / out {lastGenerationTelemetry.outputTokens ?? '-'} / total {lastGenerationTelemetry.totalTokens ?? '-'}
                  </span>
                </div>
                <div>
                  Requested: <span className="text-foreground">{formatTelemetryTime(lastGenerationTelemetry.requestedAt) ?? 'n/a'}</span>
                </div>
                <div>
                  Responded: <span className="text-foreground">{formatTelemetryTime(lastGenerationTelemetry.respondedAt) ?? 'n/a'}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {lastSimilarity && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Similarity Surfacing</CardTitle>
                <CardDescription>
                  Engine: {lastSimilarity.engine}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div>
                  <span className="text-foreground">Epics:</span>{' '}
                  {lastSimilarity.epics.slice(0, 3).map(item => `${item.key} (${item.score.toFixed(2)})`).join(' • ') || 'none'}
                </div>
                <div>
                  <span className="text-foreground">Ideas:</span>{' '}
                  {lastSimilarity.ideas.slice(0, 3).map(item => `${item.key} (${item.score.toFixed(2)})`).join(' • ') || 'none'}
                </div>
                <div>
                  <span className="text-foreground">Thoughts:</span>{' '}
                  {lastSimilarity.thoughts.slice(0, 3).map(item => `${item.key} (${item.score.toFixed(2)})`).join(' • ') || 'none'}
                </div>
              </CardContent>
            </Card>
          )}

          <StewardProposalQueueBlock
            proposals={queue}
            selectedFileLabel={selectedFilePath ?? undefined}
            canGenerate={canGenerate}
            generating={generating}
            busyProposalId={busyProposalId}
            onGenerateForSelectedFile={() => { void generateForSelectedFile() }}
            onAccept={(proposal, payload) => { void acceptProposal(proposal, payload) }}
            onReject={rejectProposal}
            onClearResolved={clearResolved}
          />
        </div>
      </div>
    </div>
  )
}
