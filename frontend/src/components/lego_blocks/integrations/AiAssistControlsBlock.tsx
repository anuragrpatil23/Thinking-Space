import { useMemo, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import type { AiAssistAction } from '@/services/orchestrators/aiAssistOrch'
import type { AiAssistPromptHistoryEntryBlock } from '@/services/orchestrators/aiAssistPromptHistoryOrch'
import UniversalSearchBlock from '@/components/lego_blocks/integrations/UniversalSearchBlock'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import { cn } from '@/lib/utils'

const AI_ASSIST_ACTIONS: Array<{ action: AiAssistAction; label: string }> = [
  { action: 'grammar', label: 'Grammar' },
  { action: 'clarity', label: 'Clarity' },
  { action: 'structure', label: 'Structure' },
  { action: 'tone', label: 'Tone' },
]

interface AiAssistControlsBlockProps {
  selectedProvider: string | null
  selectedModel: string | null
  showThinkToggle?: boolean
  thinkEnabled?: boolean
  onThinkEnabledChange?: (enabled: boolean) => void
  runningAction: AiAssistAction | null
  loading?: boolean
  disabled?: boolean
  onRun: (action: AiAssistAction) => void
  onRunCustomPrompt: (prompt: string) => void
  promptHistory?: AiAssistPromptHistoryEntryBlock[]
  statusPill?: { tone: 'neutral' | 'success' | 'error'; text: string } | null
  helperText?: string
  inlineReviewActionsSlot?: ReactNode
}

function formatPromptHistoryLastUsedBlock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function AiAssistControlsBlock({
  selectedProvider,
  selectedModel,
  showThinkToggle = false,
  thinkEnabled = true,
  onThinkEnabledChange,
  runningAction,
  loading = false,
  disabled = false,
  onRun,
  onRunCustomPrompt,
  promptHistory = [],
  statusPill = null,
  helperText = 'Preview-first only. Suggestions never auto-save until you explicitly apply and save.',
  inlineReviewActionsSlot = null,
}: AiAssistControlsBlockProps) {
  const [customPrompt, setCustomPrompt] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<AiAssistAction>('clarity')
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false)
  const searchablePromptHistory = useMemo(
    () => promptHistory.filter((entry) => entry.prompt.trim().length > 0),
    [promptHistory],
  )
  const unavailable = !selectedProvider || !selectedModel
  const actionDisabled = disabled || loading || unavailable || !!runningAction
  const canRunPrompt = !actionDisabled && customPrompt.trim().length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center text-sm font-medium text-foreground">AI assist</span>
        {statusPill && (
          <span
            className={cn(
              'inline-flex h-8 items-center rounded-md border px-2 text-xs',
              statusPill.tone === 'success' && 'border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
              statusPill.tone === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
              statusPill.tone === 'neutral' && 'border-border/60 bg-background text-muted-foreground',
            )}
          >
            {statusPill.text}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Prompt
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <UniversalSearchBlock<AiAssistPromptHistoryEntryBlock>
            items={searchablePromptHistory}
            query={customPrompt}
            onQueryChange={setCustomPrompt}
            onSelect={(entry) => setCustomPrompt(entry.prompt)}
            getItemKey={(entry) => entry.id}
            getItemLabel={(entry) => entry.prompt}
            getItemDescription={(entry) => `Used ${entry.useCount}x • ${formatPromptHistoryLastUsedBlock(entry.lastUsedAt)}`}
            getItemSearchCandidates={(entry) => [entry.prompt]}
            placeholder="Ask AI what to change in this note. Example: tighten this into crisp action items."
            limit={20}
            showEmptyStateWhenOpen={false}
            dismissOnOutsideClick
            open={promptHistoryOpen}
            onOpenChange={setPromptHistoryOpen}
            allowCustomValue
            onSelectCustomValue={setCustomPrompt}
            closeOnSelect={false}
            onEscapeKeyDown={() => setPromptHistoryOpen(false)}
            disabled={actionDisabled}
            className="w-full"
            inputClassName="h-8 rounded-md border border-border/60 bg-background pl-8 pr-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
            dropdownClassName="z-50 mt-1 rounded-md border border-border/70 bg-background shadow-lg"
            listClassName="max-h-52 overflow-auto p-1"
            itemClassName="rounded-sm"
          />
          <button
            type="button"
            onClick={() => onRunCustomPrompt(customPrompt.trim())}
            disabled={!canRunPrompt}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {runningAction === 'custom' ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Presets</label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-8 items-center rounded-md border border-border/60 bg-background p-0.5">
            {AI_ASSIST_ACTIONS.map((item) => (
              <button
                key={item.action}
                type="button"
                onClick={() => setSelectedPreset(item.action)}
                disabled={actionDisabled}
                className={cn(
                  'rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  selectedPreset === item.action
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onRun(selectedPreset)}
            disabled={actionDisabled}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {runningAction === selectedPreset ? 'Running...' : `Run ${AI_ASSIST_ACTIONS.find((item) => item.action === selectedPreset)?.label ?? 'Preset'}`}
          </button>
        </div>
      </div>

      {showThinkToggle && (
        <label className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2">
          <div className="text-xs text-muted-foreground">Think before answering</div>
          <Switch
            checked={!!thinkEnabled}
            onCheckedChange={(checked) => onThinkEnabledChange?.(checked)}
            disabled={disabled || loading}
          />
        </label>
      )}

      {inlineReviewActionsSlot}

      <div className="text-xs text-muted-foreground">
        {helperText}
      </div>
    </div>
  )
}
