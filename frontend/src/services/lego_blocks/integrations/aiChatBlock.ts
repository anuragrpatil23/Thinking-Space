/**
 * AI chat block — sends messages to configured AI providers.
 *
 * Electron: direct SDK calls from renderer with IPC-sourced credentials.
 * Web: POST to backend /api/ai/chat which proxies the call.
 */

import { isCapacitorNative, isElectron } from '@/services/lego_blocks/integrations/fsBlock'
import {
  defaultProviderModelBlock,
  type AiProvider,
  getClaudeCredentialsBlock,
  getCodexCredentialsBlock,
  getAzureCredentialsBlock,
} from '@/services/lego_blocks/integrations/aiProviderBlock'
import { resolveAiThinkingForProviderBlock } from '@/services/lego_blocks/integrations/aiSettingsBlock'
import {
  getManualAzureCredentialsBlock,
  getManualClaudeApiKeyBlock,
  getManualOpenSourceAiCredentialsBlock,
  getManualOpenAiApiKeyBlock,
} from '@/services/lego_blocks/integrations/aiCredentialStoreBlock'
import {
  normalizeBaseUrlBlock,
  probeServerProfileBlock,
} from '@/services/lego_blocks/units/intelligence/serverProfileBlock'
import {
  getNativeClaudeOauthCredentialsBlock,
  getNativeCodexOauthCredentialsBlock,
} from '@/services/lego_blocks/integrations/aiOauthCredentialStoreBlock'
import { aiDebugBlock, aiDebugErrorMessageBlock, aiDebugWarnBlock } from '@/services/lego_blocks/units/aiDebugBlock'

const CLAUDE_MAX_OUTPUT_TOKENS = 64000

// ── Types ──

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  role: 'assistant'
  content: string
  provider: AiProvider
  model: string
  requested_at?: string
  responded_at?: string
  latency_ms?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  thread_id?: string
}

export interface ChatSendOptions {
  threadId?: string
  model?: string
  opensourceAi?: {
    baseUrl?: string
    apiKey?: string
    model?: string
    think?: boolean
  }
}

// ── Electron: direct API calls ──

function resolveRequestedModel(provider: AiProvider, requested?: string): string {
  const normalized = typeof requested === 'string' ? requested.trim() : ''
  return normalized || defaultProviderModelBlock(provider)
}

function resolveOpenSourceAiConfigBlock(options?: ChatSendOptions): {
  baseUrl: string
  apiKey?: string
  model?: string
  think: boolean
} {
  const manual = getManualOpenSourceAiCredentialsBlock()
  const baseUrl = normalizeBaseUrlBlock(options?.opensourceAi?.baseUrl || manual?.baseUrl)
  const apiKey = (options?.opensourceAi?.apiKey || manual?.apiKey || '').trim() || undefined
  const model = (options?.opensourceAi?.model || manual?.model || '').trim() || undefined
  const think = typeof options?.opensourceAi?.think === 'boolean'
    ? options.opensourceAi.think
    : resolveAiThinkingForProviderBlock('opensource-ai')
  return {
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    think,
  }
}

async function sendClaudeDirectBlock(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const manualApiKey = getManualClaudeApiKeyBlock()
  const oauthCredentials = getNativeClaudeOauthCredentialsBlock()
  const client = manualApiKey
    ? new Anthropic({
      apiKey: manualApiKey,
      dangerouslyAllowBrowser: true,
    })
    : oauthCredentials
      ? new Anthropic({
        authToken: oauthCredentials.accessToken,
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
        dangerouslyAllowBrowser: true,
      })
    : await (async () => {
      const creds = await getClaudeCredentialsBlock()
      if (!creds) throw new Error('Claude credentials not available')
      return new Anthropic({
        authToken: creds.accessToken,
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
        dangerouslyAllowBrowser: true,
      })
    })()

  const requestedModel = resolveRequestedModel('claude', model)
  const requestedAt = new Date().toISOString()
  const started = performance.now()
  const response = await client.messages.create({
    model: requestedModel,
    // Anthropic Messages API requires max_tokens; keep a high ceiling.
    max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => ('text' in block ? (block as { text: string }).text : ''))
    .join('')

  const respondedAt = new Date().toISOString()
  const latencyMs = Math.round(performance.now() - started)
  const inputTokens = response.usage?.input_tokens
  const outputTokens = response.usage?.output_tokens
  const totalTokens = (
    typeof inputTokens === 'number' && typeof outputTokens === 'number'
      ? inputTokens + outputTokens
      : undefined
  )
  return {
    role: 'assistant',
    content: text,
    provider: 'claude',
    model: requestedModel,
    requested_at: requestedAt,
    responded_at: respondedAt,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  }
}

async function sendAzureDirectBlock(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
  const manual = getManualAzureCredentialsBlock()
  const { default: OpenAI } = await import('openai')
  const client = manual
    ? new OpenAI({
      apiKey: manual.apiKey,
      baseURL: `${manual.endpoint.replace(/\/+$/, '')}/openai/deployments/${manual.deployment}`,
      defaultQuery: { 'api-version': manual.apiVersion },
      defaultHeaders: { 'api-key': manual.apiKey },
      dangerouslyAllowBrowser: true,
    })
    : await (async () => {
      const creds = await getAzureCredentialsBlock()
      if (!creds) throw new Error('Azure credentials not available')
      return new OpenAI({
        apiKey: creds.accessToken,
        baseURL: 'https://fuchs-lab-openai.openai.azure.com/openai/deployments/gpt-5',
        defaultQuery: { 'api-version': '2024-12-01-preview' },
        defaultHeaders: { Authorization: `Bearer ${creds.accessToken}` },
        dangerouslyAllowBrowser: true,
      })
    })()

  const requestedModel = resolveRequestedModel('azure-gpt', model)
  const requestedAt = new Date().toISOString()
  const started = performance.now()
  const payload = {
    model: requestedModel,
    messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  }
  const response = await client.chat.completions.create(payload)

  const text = response.choices[0]?.message?.content ?? ''
  const respondedAt = new Date().toISOString()
  const latencyMs = Math.round(performance.now() - started)
  return {
    role: 'assistant',
    content: text,
    provider: 'azure-gpt',
    model: requestedModel,
    requested_at: requestedAt,
    responded_at: respondedAt,
    latency_ms: latencyMs,
    input_tokens: response.usage?.prompt_tokens ?? undefined,
    output_tokens: response.usage?.completion_tokens ?? undefined,
    total_tokens: response.usage?.total_tokens ?? undefined,
  }
}

async function sendOpenSourceAiDirectBlock(
  messages: ChatMessage[],
  model?: string,
  options?: ChatSendOptions,
): Promise<ChatResponse> {
  const { default: OpenAI } = await import('openai')
  const config = resolveOpenSourceAiConfigBlock(options)
  const sentinel = defaultProviderModelBlock('opensource-ai')
  const optionModel = typeof model === 'string' ? model.trim() : ''
  // Treat empty AND the `local-model` sentinel as "not set" — fall back to
  // the user's configured model, then auto-discover whatever is loaded on
  // the local server, then the sentinel as last resort.
  let requestedModel = optionModel && optionModel !== sentinel ? optionModel : (config.model || '')
  if (!requestedModel || requestedModel === sentinel) {
    const profile = await probeServerProfileBlock(config.baseUrl, config.apiKey)
    const discovered = profile?.models[0] ?? null
    requestedModel = discovered || optionModel || sentinel
  }
  const client = new OpenAI({
    apiKey: config.apiKey || 'local-not-required',
    baseURL: config.baseUrl,
    dangerouslyAllowBrowser: true,
  })
  const requestedAt = new Date().toISOString()
  const started = performance.now()
  let response: Awaited<ReturnType<typeof client.chat.completions.create>>
  try {
    const payload: Record<string, unknown> = {
      model: requestedModel,
      messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: config.think,
        },
        enable_thinking: config.think,
      },
    }
    response = await client.chat.completions.create(payload as never)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const hostHint = (
      config.baseUrl.includes('127.0.0.1') || config.baseUrl.includes('localhost')
    )
      ? ' If this runtime is not on the same host as LM Studio, use host.docker.internal or your host LAN IP.'
      : ''
    throw new Error(`Open Source AI connection failed at ${config.baseUrl}: ${msg}.${hostHint}`)
  }

  const text = response.choices[0]?.message?.content ?? ''
  const respondedAt = new Date().toISOString()
  const latencyMs = Math.round(performance.now() - started)
  return {
    role: 'assistant',
    content: text,
    provider: 'opensource-ai',
    model: response.model || requestedModel,
    requested_at: requestedAt,
    responded_at: respondedAt,
    latency_ms: latencyMs,
    input_tokens: response.usage?.prompt_tokens ?? undefined,
    output_tokens: response.usage?.completion_tokens ?? undefined,
    total_tokens: response.usage?.total_tokens ?? undefined,
  }
}

function parseCodexSseResponseBlock(raw: string, requestedModel: string): {
  text: string
  model: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
} {
  let text = ''
  let model = requestedModel
  let usage: Record<string, unknown> | null = null
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue
    const payload = trimmed.slice(6).trim()
    if (!payload) continue
    try {
      const event = JSON.parse(payload) as Record<string, unknown>
      const type = event.type
      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta
      } else if (type === 'response.output_text.done' && !text && typeof event.text === 'string') {
        text = event.text
      } else if (type === 'response.completed' && event.response && typeof event.response === 'object') {
        const response = event.response as Record<string, unknown>
        if (typeof response.model === 'string' && response.model.trim()) {
          model = response.model.trim()
        }
        if (response.usage && typeof response.usage === 'object') {
          usage = response.usage as Record<string, unknown>
        }
      }
    } catch {
      // Ignore malformed event lines.
    }
  }

  const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined
  const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined
  const totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : undefined
  return { text, model, inputTokens, outputTokens, totalTokens }
}

async function sendCodexOauthDirectBlock(
  messages: ChatMessage[],
  accessToken: string,
  accountId: string | undefined,
  model: string,
): Promise<ChatResponse> {
  const requestedAt = new Date().toISOString()
  const started = performance.now()
  const payload = {
    model,
    instructions: 'You are a helpful assistant.',
    input: messages.map((message) => ({
      role: message.role,
      content: [{
        type: message.role === 'user' ? 'input_text' : 'output_text',
        text: message.content,
      }],
    })),
    store: false,
    stream: true,
  }
  const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
    },
    body: JSON.stringify(payload),
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`Codex OAuth chat failed (HTTP ${response.status}): ${raw.slice(0, 300)}`)
  }

  const parsed = parseCodexSseResponseBlock(raw, model)
  const respondedAt = new Date().toISOString()
  const latencyMs = Math.round(performance.now() - started)
  return {
    role: 'assistant',
    content: parsed.text,
    provider: 'openai-codex',
    model: parsed.model,
    requested_at: requestedAt,
    responded_at: respondedAt,
    latency_ms: latencyMs,
    input_tokens: parsed.inputTokens,
    output_tokens: parsed.outputTokens,
    total_tokens: parsed.totalTokens,
  }
}

async function sendCodexDirectBlock(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
  const requestedModel = resolveRequestedModel('openai-codex', model)
  const manualApiKey = getManualOpenAiApiKeyBlock()
  const oauthCredentials = getNativeCodexOauthCredentialsBlock()

  if (manualApiKey) {
    const requestedAt = new Date().toISOString()
    const started = performance.now()
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({
      apiKey: manualApiKey,
      dangerouslyAllowBrowser: true,
    })
    const response = await client.chat.completions.create({
      model: requestedModel,
      messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    })
    const text = response.choices[0]?.message?.content ?? ''
    const respondedAt = new Date().toISOString()
    const latencyMs = Math.round(performance.now() - started)
    return {
      role: 'assistant',
      content: text,
      provider: 'openai-codex',
      model: response.model || requestedModel,
      requested_at: requestedAt,
      responded_at: respondedAt,
      latency_ms: latencyMs,
      input_tokens: response.usage?.prompt_tokens ?? undefined,
      output_tokens: response.usage?.completion_tokens ?? undefined,
      total_tokens: response.usage?.total_tokens ?? undefined,
    }
  }

  if (oauthCredentials) {
    return sendCodexOauthDirectBlock(
      messages,
      oauthCredentials.accessToken,
      oauthCredentials.accountId,
      requestedModel,
    )
  }

  const requestedAt = new Date().toISOString()
  const started = performance.now()
  const creds = await getCodexCredentialsBlock()
  if (!creds || !isElectron()) throw new Error('Codex credentials not available')
  const response = await window.electronAPI!.aiChatCodex(messages, creds.accessToken, creds.accountId, requestedModel)

  const text = response.text ?? ''
  const respondedAt = new Date().toISOString()
  const latencyMs = Math.round(performance.now() - started)
  const inputTokens = response.inputTokens
  const outputTokens = response.outputTokens
  const totalTokens = response.totalTokens
  return {
    role: 'assistant',
    content: text,
    provider: 'openai-codex',
    model: response.model || requestedModel,
    requested_at: requestedAt,
    responded_at: respondedAt,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  }
}

async function sendCodexCliViaBackendBlock(
  messages: ChatMessage[],
  options?: ChatSendOptions,
): Promise<ChatResponse> {
  const res = await fetch('/api/ai/chat/codex-cli', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      thread_id: options?.threadId || null,
      model: options?.model || null,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI chat failed (HTTP ${res.status}): ${detail.slice(0, 300)}`)
  }
  return res.json()
}

// ── Web: backend proxy ──

async function sendViaBackendBlock(
  provider: AiProvider,
  messages: ChatMessage[],
  options?: ChatSendOptions,
): Promise<ChatResponse> {
  if (provider === 'codex-cli') return sendCodexCliViaBackendBlock(messages, options)
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      messages,
      model: options?.model || null,
      opensource_ai: provider === 'opensource-ai'
        ? (() => {
          const config = resolveOpenSourceAiConfigBlock(options)
          return {
            base_url: config.baseUrl,
            api_key: config.apiKey || null,
            model: config.model || null,
            think: config.think,
          }
        })()
        : null,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI chat failed (HTTP ${res.status}): ${detail.slice(0, 300)}`)
  }
  return res.json()
}

// ── Public API ──

export async function sendChatBlock(
  provider: AiProvider,
  messages: ChatMessage[],
  options?: ChatSendOptions,
): Promise<ChatResponse> {
  const runtime = isElectron() ? 'electron' : (isCapacitorNative() ? 'capacitor' : 'web')
  const requestedModel = typeof options?.model === 'string' ? options.model.trim() : null
  aiDebugBlock('chat_send_start', {
    provider,
    requestedModel,
    threadId: options?.threadId ?? null,
    messageCount: messages.length,
    runtime,
  })

  try {
    if (provider === 'codex-cli') return sendCodexCliViaBackendBlock(messages, options)
    if (runtime === 'electron' || runtime === 'capacitor') {
      if (provider === 'opensource-ai') return sendOpenSourceAiDirectBlock(messages, options?.model, options)
      if (provider === 'claude') return sendClaudeDirectBlock(messages, options?.model)
      if (provider === 'openai-codex') return sendCodexDirectBlock(messages, options?.model)
      if (provider === 'azure-gpt') return sendAzureDirectBlock(messages, options?.model)
      throw new Error(`Unknown provider: ${provider}`)
    }
    return sendViaBackendBlock(provider, messages, options)
  } catch (error) {
    aiDebugWarnBlock('chat_send_failed', {
      provider,
      requestedModel,
      threadId: options?.threadId ?? null,
      runtime,
      error: aiDebugErrorMessageBlock(error),
    })
    throw error
  }
}
