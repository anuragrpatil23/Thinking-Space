// Per area (Chat tab, editor, New Note, the Feed...): one line each saying
// whether it follows the defaults or what it overrides; "Change" opens its
// provider, model and thinking. Same settings as before (aiSettingsOrch),
// only laid out so the page reads at a glance.

import { useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { SETTINGS_CONTROL_CLASS_BLOCK, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { cn } from '@/lib/utils'
import type { AiProvider, AiProviderStatus } from '@/services/orchestrators/chatOrch'
import {
  listAiModelOptionsOrch,
  listAiModelScopesOrch,
  resolveAiModelForProviderOrch,
  resolveAiModelForScopeProviderOrch,
  resolveAiProviderForScopeOrch,
  resolveAiSelectionFromProvidersOrch,
  resolveAiThinkingOverrideForScopeProviderOrch,
  resolveContractThinkingOrch,
  setAiScopeProviderModelOrch,
  setAiScopeProviderOrch,
  setAiScopeProviderThinkingOrch,
  type AiSettingsScope,
} from '@/services/orchestrators/aiSettingsOrch'

const AI_SCOPE_LABELS_BLOCK: Record<AiSettingsScope, string> = {
  chat: 'Chat tab',
  markdown_editor: 'Markdown editor',
  new_thought: 'New Note',
  todos: 'New Note todos',
  steward_metadata: 'Steward metadata',
  ai_activity: 'AI activity',
  feed: 'Feed (AI reads)',
}

const SCOPE_DESCRIPTIONS: Record<AiSettingsScope, string> = {
  chat: 'Replies in the Chat tab.',
  markdown_editor: 'Inline assist in the editor.',
  new_thought: 'Drafting help in New Note.',
  todos: 'Cleaning up todo text.',
  steward_metadata: 'Steward metadata proposals.',
  ai_activity: 'Session titles, digests and undertaking suggestions.',
  feed: 'Article points, story cards, companies of kept articles.',
}

export default function AiPerAreaBlock({ providers, onMessage }: {
  providers: AiProviderStatus[]
  onMessage: (text: string, isError?: boolean) => void
}) {
  const scopes = listAiModelScopesOrch()
  const [open, setOpen] = useState<AiSettingsScope | null>(null)
  const [modelInput, setModelInput] = useState('')
  // Settings live outside React state: bump to re-read after a change
  const [, setTick] = useState(0)
  const changed = (text: string) => { setTick(t => t + 1); onMessage(text) }
  const labelOf = (provider: AiProvider | null) => providers.find(p => p.provider === provider)?.label ?? provider ?? 'none'

  return (
    <>
      {scopes.map((scope) => {
        const selection = resolveAiSelectionFromProvidersOrch(providers, { scope })
        const provider = selection?.provider ?? null
        const providerOverride = resolveAiProviderForScopeOrch(scope)
        const model = provider ? resolveAiModelForScopeProviderOrch(scope, provider) : ''
        const modelOverride = Boolean(provider && model && model !== resolveAiModelForProviderOrch(provider))
        const thinkingOverride = provider === 'opensource-ai' ? resolveAiThinkingOverrideForScopeProviderOrch(scope, 'opensource-ai') : null
        const overridden = Boolean(providerOverride) || modelOverride || thinkingOverride !== null
        const summary = overridden
          ? [labelOf(provider), model || null, thinkingOverride === null ? null : `thinking ${thinkingOverride ? 'on' : 'off'}`].filter(Boolean).join(' · ')
          : 'Follows the default'
        const isOpen = open === scope
        const known = provider ? listAiModelOptionsOrch(provider) : []
        return (
          <div key={scope}>
            <SettingsRowBlock
              label={AI_SCOPE_LABELS_BLOCK[scope]}
              description={SCOPE_DESCRIPTIONS[scope]}
              control={(
                <span className="flex items-center gap-3">
                  <span className={cn('max-w-[22rem] truncate text-[12px]', overridden ? 'text-foreground' : 'text-muted-foreground')} title={summary}>{summary}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setOpen(isOpen ? null : scope); setModelInput(model) }}
                  >
                    {isOpen ? 'Close' : 'Change'}
                  </Button>
                </span>
              )}
            />
            {isOpen && (
              <div className="space-y-3 px-3.5 pb-3.5 text-[12px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">Provider</span>
                  <select
                    value={providerOverride ?? ''}
                    onChange={(event) => {
                      const next = (event.target.value || null) as AiProvider | null
                      setAiScopeProviderOrch(scope, next)
                      setModelInput(next ? resolveAiModelForScopeProviderOrch(scope, next) : (resolveAiSelectionFromProvidersOrch(providers, { scope })?.model ?? ''))
                      changed(`${AI_SCOPE_LABELS_BLOCK[scope]}: ${next ? labelOf(next) : 'follows the default provider'}.`)
                    }}
                    aria-label={`${AI_SCOPE_LABELS_BLOCK[scope]} provider`}
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[14rem]')}
                  >
                    <option value="">Default ({labelOf(resolveAiSelectionFromProvidersOrch(providers)?.provider ?? null)})</option>
                    {providers.map(p => (
                      <option key={p.provider} value={p.provider} disabled={!p.available}>{p.label}{p.available ? '' : ' (unavailable)'}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">Model</span>
                  <input
                    value={modelInput}
                    onChange={(event) => setModelInput(event.target.value)}
                    disabled={!provider}
                    list={`ai-models-${scope}`}
                    aria-label={`${AI_SCOPE_LABELS_BLOCK[scope]} model`}
                    placeholder={provider ? resolveAiModelForProviderOrch(provider) : 'No provider available'}
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[18rem] flex-1')}
                  />
                  <datalist id={`ai-models-${scope}`}>{known.map(m => <option key={m} value={m} />)}</datalist>
                  <Button
                    size="sm"
                    disabled={!provider || !modelInput.trim()}
                    onClick={() => {
                      if (!provider) return
                      setAiScopeProviderModelOrch(scope, provider, modelInput.trim())
                      changed(`${AI_SCOPE_LABELS_BLOCK[scope]} model set to ${modelInput.trim()}.`)
                    }}
                  >
                    Save
                  </Button>
                  {modelOverride && provider && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAiScopeProviderModelOrch(scope, provider, '')
                        setModelInput(resolveAiModelForScopeProviderOrch(scope, provider))
                        changed(`${AI_SCOPE_LABELS_BLOCK[scope]} model follows the default.`)
                      }}
                    >
                      Use default
                    </Button>
                  )}
                </div>
                {provider === 'opensource-ai' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground">Thinking</span>
                    <span className="inline-flex rounded-md border border-border/70 p-0.5">
                      {([['default', null], ['on', true], ['off', false]] as const).map(([key, value]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setAiScopeProviderThinkingOrch(scope, 'opensource-ai', value)
                            changed(`${AI_SCOPE_LABELS_BLOCK[scope]} thinking: ${key}.`)
                          }}
                          className={cn(
                            'rounded px-2.5 py-1 text-[12px]',
                            thinkingOverride === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {key === 'default' ? 'Default' : key === 'on' ? 'On' : 'Off'}
                        </button>
                      ))}
                    </span>
                    <span className="text-muted-foreground">
                      Background tasks here think: {resolveContractThinkingOrch(scope, 'opensource-ai') ? 'on' : 'off'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
