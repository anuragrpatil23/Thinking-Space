// Per area (Chat tab, editor, New Note, the Feed...): one line each saying
// whether it follows the defaults or what it overrides; "Change" opens its
// provider, model and thinking. Same settings as before (aiSettingsOrch),
// only laid out so the page reads at a glance.

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { SETTINGS_CONTROL_CLASS_BLOCK } from '@/components/lego_blocks/units/SettingsGroupBlock'
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

export default function AiPerAreaBlock({ providers, onMessage, scopes: only, mode = 'chat', localBackground = false }: {
  providers: AiProviderStatus[]
  onMessage: (text: string, isError?: boolean) => void
  /** The areas to list (default: all) */
  scopes?: AiSettingsScope[]
  /**
   * 'background': areas whose work runs through the background provider —
   * only their thinking can differ, so each row carries Default / On / Off
   * inline and nothing opens. 'chat': provider, model and thinking per area.
   */
  mode?: 'chat' | 'background'
  /** Background work runs on the local model (thinking only means something there) */
  localBackground?: boolean
}) {
  const scopes = only ?? listAiModelScopesOrch()
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
        if (mode === 'background') {
          const override = resolveAiThinkingOverrideForScopeProviderOrch(scope, 'opensource-ai')
          return (
            <div key={scope} className="flex items-center justify-between gap-4 px-3.5 py-3">
              <span className="min-w-0 space-y-0.5">
                <span className="block text-[13px] font-medium leading-tight text-foreground">{AI_SCOPE_LABELS_BLOCK[scope]}</span>
                <span className="block text-[12px] leading-snug text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span>
              </span>
              {localBackground ? (
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">
                    Thinking {resolveContractThinkingOrch(scope, 'opensource-ai') ? 'on' : 'off'}
                  </span>
                  <span className="inline-flex rounded-md border border-border/70 p-0.5" role="radiogroup" aria-label={`${AI_SCOPE_LABELS_BLOCK[scope]} thinking`}>
                    {([['default', null], ['on', true], ['off', false]] as const).map(([key, value]) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={override === value}
                        onClick={() => {
                          setAiScopeProviderThinkingOrch(scope, 'opensource-ai', value)
                          changed(`${AI_SCOPE_LABELS_BLOCK[scope]} thinking: ${key === 'default' ? 'follows Background tasks' : key}.`)
                        }}
                        className={cn('rounded px-2.5 py-1 text-[12px]', override === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
                      >
                        {key === 'default' ? 'Default' : key === 'on' ? 'On' : 'Off'}
                      </button>
                    ))}
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-[12px] text-muted-foreground">Runs on the background provider</span>
              )}
            </div>
          )
        }
        return (
          <div key={scope}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => { setOpen(isOpen ? null : scope); setModelInput(model) }}
              className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 space-y-0.5">
                <span className="block text-[13px] font-medium leading-tight text-foreground">{AI_SCOPE_LABELS_BLOCK[scope]}</span>
                <span className="block text-[12px] leading-snug text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    'max-w-[22rem] truncate text-[12px]',
                    overridden ? 'rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300' : 'text-muted-foreground',
                  )}
                  title={summary}
                >
                  {summary}
                </span>
                <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
              </span>
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-border/40 bg-muted/20 px-3.5 py-3.5 text-[12px]">
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
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && provider && modelInput.trim() && modelInput.trim() !== model) {
                        setAiScopeProviderModelOrch(scope, provider, modelInput.trim())
                        changed(`${AI_SCOPE_LABELS_BLOCK[scope]} model set to ${modelInput.trim()}.`)
                      }
                    }}
                    onChange={(event) => setModelInput(event.target.value)}
                    disabled={!provider}
                    list={`ai-models-${scope}`}
                    aria-label={`${AI_SCOPE_LABELS_BLOCK[scope]} model`}
                    placeholder={provider ? resolveAiModelForProviderOrch(provider) : 'No provider available'}
                    className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'min-w-[18rem] flex-1')}
                  />
                  <datalist id={`ai-models-${scope}`}>{known.map(m => <option key={m} value={m} />)}</datalist>
                  {provider && modelInput.trim() && modelInput.trim() !== model && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setAiScopeProviderModelOrch(scope, provider, modelInput.trim())
                        changed(`${AI_SCOPE_LABELS_BLOCK[scope]} model set to ${modelInput.trim()}.`)
                      }}
                    >
                      Save
                    </Button>
                  )}
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
