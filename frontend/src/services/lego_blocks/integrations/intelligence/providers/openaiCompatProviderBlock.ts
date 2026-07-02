// Provider adapter for any OpenAI-compatible server: mlx_lm.server, LM Studio,
// Ollama's `/v1` shim, llama.cpp server, vLLM, OpenAI proper.
//
// The one non-obvious thing this file does is put `chat_template_kwargs` in
// the right place per server family — the previous implementation put it
// inside `extra_body`, which mlx_lm.server silently ignores, causing Qwen 3
// models to always reason regardless of the disable flag. See serverProfile
// for the family → location mapping.

import {
  getManualOpenSourceAiCredentialsBlock,
  type ManualOpenSourceAiCredentials,
} from '@/services/lego_blocks/integrations/aiCredentialStoreBlock'
import {
  normalizeBaseUrlBlock,
  probeServerProfileBlock,
  type ServerProfile,
} from '@/services/lego_blocks/units/intelligence/serverProfileBlock'
import { toJsonSchemaBlock } from '@/services/lego_blocks/units/intelligence/schemaBlock'
import type {
  IntelligenceRequest,
  IntelligenceResponse,
  IntelligenceToolCall,
} from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'
import type {
  IntelligenceProvider,
  ProviderAvailability,
} from './providerInterfaceBlock'

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | null
      // mlx_lm.server ≥0.31 emits reasoning in a separate top-level field
      // instead of inline <think> tags. Handle both.
      reasoning?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  system_fingerprint?: string
  error?: { message?: string }
}

function normalizeMessages(request: IntelligenceRequest): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: request.system }]
  for (const m of request.messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId ?? '',
        // OpenAI tools protocol wants the tool name mirrored on the reply.
        ...(m.toolName ? { name: m.toolName } : {}),
        content: m.content,
      })
      continue
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

function attachReasoningToggle(body: Record<string, unknown>, profile: ServerProfile, disable: boolean): void {
  if (!disable || !profile.reasoningToggleLocation) return
  const payload = { chat_template_kwargs: { enable_thinking: false }, enable_thinking: false }
  if (profile.reasoningToggleLocation === 'top-level') {
    Object.assign(body, payload)
  } else {
    // extra-body for vLLM-style servers
    const existing = (body.extra_body as Record<string, unknown> | undefined) ?? {}
    body.extra_body = { ...existing, ...payload }
  }
}

function attachTools(body: Record<string, unknown>, request: IntelligenceRequest, profile: ServerProfile): void {
  if (!request.tools || request.tools.length === 0) return
  if (!profile.supportsTools) return
  body.tools = request.tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: toJsonSchemaBlock(t.parameters),
    },
  }))
  body.tool_choice = 'auto'
}

function attachResponseFormat(body: Record<string, unknown>, request: IntelligenceRequest, profile: ServerProfile): void {
  if (!request.responseSchema || !profile.supportsJsonSchema) return
  body.response_format = {
    type: 'json_schema',
    json_schema: {
      name: 'output',
      strict: true,
      schema: toJsonSchemaBlock(request.responseSchema),
    },
  }
}

function parseToolCalls(raw: OpenAiChatCompletionResponse['choices'] extends (infer C)[] | undefined ? C : never): IntelligenceToolCall[] {
  const tcs = raw?.message?.tool_calls ?? []
  const out: IntelligenceToolCall[] = []
  for (const tc of tcs) {
    if (!tc?.function?.name) continue
    let args: Record<string, unknown> = {}
    try {
      args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
    } catch {
      args = {}
    }
    out.push({ id: tc.id ?? crypto.randomUUID(), name: tc.function.name, args })
  }
  return out
}

function normalizeFinishReason(raw?: string, toolCalls?: IntelligenceToolCall[]): 'stop' | 'tool_calls' | 'length' | 'error' {
  if (toolCalls && toolCalls.length > 0) return 'tool_calls'
  switch (raw) {
    case 'tool_calls': return 'tool_calls'
    case 'length': return 'length'
    case 'stop':
    case null:
    case undefined:
      return 'stop'
    default:
      return 'stop'
  }
}

function resolveConfig(): ManualOpenSourceAiCredentials | null {
  const manual = getManualOpenSourceAiCredentialsBlock()
  if (!manual?.baseUrl) return null
  return manual
}

export class OpenaiCompatProviderBlock implements IntelligenceProvider {
  readonly id = 'openai-compat' as const

  isConfigured(): boolean {
    return !!resolveConfig()
  }

  async availability(force = false): Promise<ProviderAvailability> {
    const cfg = resolveConfig()
    if (!cfg) {
      return { available: false, defaultModel: null, details: {}, reason: 'Base URL not configured' }
    }
    const baseUrl = normalizeBaseUrlBlock(cfg.baseUrl)
    const profile = await probeServerProfileBlock(baseUrl, cfg.apiKey, force)
    if (!profile) {
      return { available: false, defaultModel: null, details: { baseUrl }, reason: 'Server unreachable' }
    }
    const defaultModel = cfg.model?.trim() || profile.models[0] || null
    if (!defaultModel) {
      return {
        available: false,
        defaultModel: null,
        details: { baseUrl, family: profile.family },
        reason: 'Server has no loaded model',
      }
    }
    return {
      available: true,
      defaultModel,
      details: {
        baseUrl,
        family: profile.family,
        models: profile.models,
        supportsTools: profile.supportsTools,
        supportsJsonSchema: profile.supportsJsonSchema,
        reasoningToggleLocation: profile.reasoningToggleLocation,
        fingerprint: profile.fingerprint,
      },
    }
  }

  async chat(request: IntelligenceRequest, signal: AbortSignal): Promise<IntelligenceResponse> {
    const cfg = resolveConfig()
    if (!cfg) throw new Error('openai-compat provider not configured')
    const baseUrl = normalizeBaseUrlBlock(cfg.baseUrl)
    const profile = (await probeServerProfileBlock(baseUrl, cfg.apiKey)) ?? {
      family: 'unknown-openai-compat',
      baseUrl,
      models: [],
      reasoningToggleLocation: null,
      supportsTools: false,
      supportsJsonSchema: false,
      probedAt: 0,
      fingerprint: null,
    } satisfies ServerProfile

    const body: Record<string, unknown> = {
      model: request.model,
      messages: normalizeMessages(request),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    }
    attachReasoningToggle(body, profile, !!request.disableReasoning)
    attachTools(body, request, profile)
    attachResponseFormat(body, request, profile)

    const startedAt = performance.now()
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
    const latencyMs = performance.now() - startedAt
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`openai-compat HTTP ${res.status}: ${text.slice(0, 200)}`)
      ;(err as Error & { httpStatus?: number }).httpStatus = res.status
      throw err
    }
    const parsed = (await res.json()) as OpenAiChatCompletionResponse
    const choice = parsed.choices?.[0]
    if (!choice) throw new Error('openai-compat: no choices in response')
    const toolCalls = parseToolCalls(choice)
    return {
      content: choice.message?.content ?? '',
      reasoning: choice.message?.reasoning ?? '',
      toolCalls,
      finishReason: normalizeFinishReason(choice.finish_reason, toolCalls),
      usage: {
        promptTokens: parsed.usage?.prompt_tokens ?? 0,
        completionTokens: parsed.usage?.completion_tokens ?? 0,
      },
      providerModel: parsed.model || request.model,
      latencyMs,
    }
  }
}

export const openaiCompatProvider = new OpenaiCompatProviderBlock()
