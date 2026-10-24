// How the app reaches each AI: the local server, the Claude Code CLI, and the
// API keys. One row each, with its status; "Edit" opens that one's fields and
// it saves on its own (no page-wide "Save logins" to forget). Stored on this
// device only (aiCredentialsOrch).

import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { SETTINGS_CONTROL_CLASS_BLOCK, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { cn } from '@/lib/utils'
import type { DiagnosticsSnapshot } from '@/services/orchestrators/intelligenceOrch'
import {
  getNativeAiLoginStateOrch,
  setNativeAzureLoginOrch,
  setNativeClaudeLoginOrch,
  setNativeOpenAiLoginOrch,
  setNativeOpenSourceAiLoginOrch,
} from '@/services/orchestrators/aiCredentialsOrch'
import {
  discoverLocalServersBlock,
  type DiscoveredLocalServer,
} from '@/services/lego_blocks/units/intelligence/localServerDiscoveryBlock'
import { setManualOpenSourceAiCredentialsBlock } from '@/services/lego_blocks/integrations/aiCredentialStoreBlock'

type ConnectionIdBlock = 'local' | 'claude-cli' | 'claude-api' | 'openai' | 'azure'
type StatusBlock = 'ready' | 'unreachable' | 'not set' | 'saved'

function StatusPillBlock({ status }: { status: StatusBlock }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
        status === 'ready' || status === 'saved' ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400' : '',
        status === 'unreachable' ? 'bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400' : '',
        status === 'not set' ? 'bg-muted text-muted-foreground' : '',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', status === 'ready' || status === 'saved' ? 'bg-emerald-500' : status === 'unreachable' ? 'bg-red-500' : 'bg-zinc-400')} />
      {status}
    </span>
  )
}

function hostOfBlock(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The configured local port is dead, but a runtime often answers on another known port: offer it. */
function ElsewhereOnLoopbackBlock({ configured, onUse }: { configured: string; onUse: (baseUrl: string) => void }) {
  const [found, setFound] = useState<DiscoveredLocalServer[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void discoverLocalServersBlock(controller.signal)
      .then(servers => setFound(servers.filter(s => s.baseUrl !== configured)))
      .catch(() => setFound([]))
    return () => controller.abort()
  }, [configured])
  if (found === null) return <p className="text-xs text-muted-foreground">Checking the other local ports…</p>
  if (found.length === 0) return <p className="text-xs text-muted-foreground">Nothing answers on the known local ports. Start your model server, then Refresh.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {found.map(server => (
        <Button key={server.baseUrl} size="sm" variant="outline" onClick={() => onUse(server.baseUrl)}>
          Use {server.runtime} at {hostOfBlock(server.baseUrl)}
        </Button>
      ))}
    </div>
  )
}

export default function AiConnectionsBlock({ snapshot, refreshing, onRefresh, onChanged, onMessage }: {
  snapshot: DiagnosticsSnapshot | null
  refreshing: boolean
  onRefresh: () => void
  /** A connection changed: re-read providers and status */
  onChanged: () => Promise<void> | void
  onMessage: (text: string, isError?: boolean) => void
}) {
  const [login, setLogin] = useState(() => getNativeAiLoginStateOrch())
  const [draft, setDraft] = useState(login)
  const [open, setOpen] = useState<ConnectionIdBlock | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [discovered, setDiscovered] = useState<DiscoveredLocalServer[]>([])

  const status = (id: 'openai-compat' | 'anthropic' | 'claude-cli') => snapshot?.providers.find(p => p.id === id)
  const local = status('openai-compat')
  const cli = status('claude-cli')
  const claudeApi = status('anthropic')

  const toggle = (id: ConnectionIdBlock) => {
    setDraft(login)
    setOpen(prev => (prev === id ? null : id))
  }
  const saved = async (text: string) => {
    const next = getNativeAiLoginStateOrch()
    setLogin(next)
    setDraft(next)
    setOpen(null)
    await onChanged()
    onMessage(text)
  }
  const field = (key: keyof typeof draft, placeholder: string, opts: { secret?: boolean; label: string }) => (
    <input
      value={draft[key]}
      onChange={(event) => setDraft(prev => ({ ...prev, [key]: event.target.value }))}
      type={opts.secret ? 'password' : 'text'}
      aria-label={opts.label}
      placeholder={placeholder}
      className={cn(SETTINGS_CONTROL_CLASS_BLOCK, 'w-full')}
    />
  )
  const editButton = (id: ConnectionIdBlock, configured: boolean) => (
    <Button size="sm" variant="outline" onClick={() => toggle(id)}>
      {open === id ? 'Close' : configured ? 'Edit' : 'Add'}
    </Button>
  )
  const saveRow = (onSave: () => void, onRemove: (() => void) | null) => (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onSave}>Save</Button>
      {onRemove && <Button size="sm" variant="outline" onClick={onRemove}>Remove</Button>}
    </div>
  )
  // The header keeps its status and buttons; an open connection's fields sit underneath
  const row = (id: ConnectionIdBlock, label: string, description: ReactNode, control: ReactNode, editor?: ReactNode) => (
    <div key={id}>
      <SettingsRowBlock label={label} description={description} control={control} />
      {open === id && editor && <div className="space-y-3 px-3.5 pb-3.5">{editor}</div>}
    </div>
  )

  const localStatus: StatusBlock = local?.available ? 'ready' : local?.configured ? 'unreachable' : 'not set'
  const localModel = local?.defaultModel ?? login.openSourceAiModel

  return (
    <>
      {row(
        'local',
        'Local model server',
        login.openSourceAiBaseUrl
          ? <>{hostOfBlock(login.openSourceAiBaseUrl)}{localModel ? ` · ${localModel}` : ''}{local?.reason && !local.available ? <span className="block text-red-600 dark:text-red-400">{local.reason}</span> : null}</>
          : 'LM Studio, MLX or any OpenAI-compatible server on this Mac.',
        <span className="flex items-center gap-2">
          <StatusPillBlock status={localStatus} />
          <Button size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Checking…' : 'Refresh'}</Button>
          {editButton('local', Boolean(login.openSourceAiBaseUrl))}
        </span>,
        <>
          {localStatus === 'unreachable' && (
            <ElsewhereOnLoopbackBlock
              configured={login.openSourceAiBaseUrl}
              onUse={(baseUrl) => {
                // Base URL only: an empty model id means "auto-detect", and a pinned one stays as chosen
                setManualOpenSourceAiCredentialsBlock({ baseUrl })
                void saved(`Local model server moved to ${hostOfBlock(baseUrl)}.`)
              }}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={detecting}
              onClick={() => {
                setDetecting(true)
                void discoverLocalServersBlock()
                  .then((found) => {
                    setDiscovered(found)
                    onMessage(found.length === 0 ? 'No local servers on the usual ports. Enter the address by hand.' : `Found ${found.length} local server${found.length === 1 ? '' : 's'}: pick one to fill in.`)
                  })
                  .catch(() => onMessage('Could not scan for local servers.', true))
                  .finally(() => setDetecting(false))
              }}
            >
              {detecting ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Scanning…</span> : 'Detect local servers'}
            </Button>
            {discovered.map(server => (
              <button
                key={server.baseUrl}
                type="button"
                className="rounded-md border border-border/70 px-2 py-1 text-xs hover:bg-muted"
                onClick={() => setDraft(prev => ({ ...prev, openSourceAiBaseUrl: server.baseUrl, openSourceAiModel: server.models[0] ?? '' }))}
              >
                <span className="font-medium">{server.runtime}</span>
                <span className="ml-1 opacity-70">{hostOfBlock(server.baseUrl)}{server.models[0] ? ` · ${server.models[0]}` : ''}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {field('openSourceAiBaseUrl', 'http://127.0.0.1:1234/v1', { label: 'Local server address' })}
            {field('openSourceAiApiKey', 'API key (optional)', { secret: true, label: 'Local server API key' })}
            {field('openSourceAiModel', 'Model id (blank: auto-detect)', { label: 'Local model id' })}
          </div>
          {local && Object.keys(local.details).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Detected capabilities</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{JSON.stringify(local.details, null, 2)}</pre>
            </details>
          )}
          {saveRow(
            () => {
              setNativeOpenSourceAiLoginOrch({ baseUrl: draft.openSourceAiBaseUrl, apiKey: draft.openSourceAiApiKey, model: draft.openSourceAiModel })
              void saved('Local model server saved.')
            },
            login.openSourceAiBaseUrl ? () => {
              setNativeOpenSourceAiLoginOrch({ baseUrl: '', apiKey: '', model: '' })
              void saved('Local model server removed.')
            } : null,
          )}
        </>,
      )}

      {row(
        'claude-cli',
        'Claude Code CLI',
        cli?.available ? `Your Claude subscription, through the CLI on this Mac${cli.defaultModel ? ` · ${cli.defaultModel}` : ''}.` : (cli?.reason ?? 'Uses the Claude Code CLI signed in on this Mac.'),
        <StatusPillBlock status={cli?.available ? 'ready' : cli?.configured ? 'unreachable' : 'not set'} />,
      )}

      {row(
        'claude-api',
        'Claude API',
        login.claudeApiKey ? 'API key saved on this device.' : 'An Anthropic API key, billed per use.',
        <span className="flex items-center gap-2">
          <StatusPillBlock status={claudeApi?.available ? 'ready' : login.claudeApiKey ? 'saved' : 'not set'} />
          {editButton('claude-api', Boolean(login.claudeApiKey))}
        </span>,
        <>
          {field('claudeApiKey', 'sk-ant-…', { secret: true, label: 'Claude API key' })}
          {saveRow(
            () => { setNativeClaudeLoginOrch(draft.claudeApiKey); void saved('Claude API key saved.') },
            login.claudeApiKey ? () => { setNativeClaudeLoginOrch(''); void saved('Claude API key removed.') } : null,
          )}
        </>,
      )}

      {row(
        'openai',
        'OpenAI (Codex)',
        login.openAiApiKey ? 'API key saved on this device.' : 'An OpenAI API key.',
        <span className="flex items-center gap-2">
          <StatusPillBlock status={login.openAiApiKey ? 'saved' : 'not set'} />
          {editButton('openai', Boolean(login.openAiApiKey))}
        </span>,
        <>
          {field('openAiApiKey', 'sk-…', { secret: true, label: 'OpenAI API key' })}
          {saveRow(
            () => { setNativeOpenAiLoginOrch(draft.openAiApiKey); void saved('OpenAI API key saved.') },
            login.openAiApiKey ? () => { setNativeOpenAiLoginOrch(''); void saved('OpenAI API key removed.') } : null,
          )}
        </>,
      )}

      {row(
        'azure',
        'Azure OpenAI',
        login.azureApiKey ? `Saved${login.azureDeployment ? ` · ${login.azureDeployment}` : ''}.` : 'A key, endpoint and deployment from Azure.',
        <span className="flex items-center gap-2">
          <StatusPillBlock status={login.azureApiKey ? 'saved' : 'not set'} />
          {editButton('azure', Boolean(login.azureApiKey))}
        </span>,
        <>
          {field('azureApiKey', 'Azure API key', { secret: true, label: 'Azure OpenAI API key' })}
          <div className="grid gap-2 md:grid-cols-3">
            {field('azureEndpoint', 'Endpoint', { label: 'Azure endpoint' })}
            {field('azureDeployment', 'Deployment', { label: 'Azure deployment' })}
            {field('azureApiVersion', 'API version', { label: 'Azure API version' })}
          </div>
          {saveRow(
            () => {
              setNativeAzureLoginOrch({ apiKey: draft.azureApiKey, endpoint: draft.azureEndpoint, deployment: draft.azureDeployment, apiVersion: draft.azureApiVersion })
              void saved('Azure OpenAI saved.')
            },
            login.azureApiKey ? () => {
              setNativeAzureLoginOrch({ apiKey: '', endpoint: '', deployment: '', apiVersion: '' })
              void saved('Azure OpenAI removed.')
            } : null,
          )}
        </>,
      )}
    </>
  )
}
