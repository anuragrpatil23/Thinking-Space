// Provider adapter for Claude via @anthropic-ai/sdk. Supports both the manual
// API key path (readAiManualCredentialsBlock().claude.apiKey) and the OAuth
// token path used by the existing chat surface. Native tool calling and
// structured output are supported directly by the Messages API.

import {
  getManualClaudeApiKeyBlock,
  readAiManualCredentialsBlock,
} from '@/services/lego_blocks/integrations/aiCredentialStoreBlock'
import { getNativeClaudeOauthCredentialsBlock } from '@/services/lego_blocks/integrations/aiOauthCredentialStoreBlock'
import { getClaudeCredentialsBlock } from '@/services/lego_blocks/integrations/aiProviderBlock'
import { toJsonSchemaBlock } from '@/services/lego_blocks/units/intelligence/schemaBlock'
import type {
  IntelligenceMessage,
  IntelligenceRequest,
  IntelligenceResponse,
  IntelligenceToolCall,
} from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'
import type {
  IntelligenceProvider,
  ProviderAvailability,
} from './providerInterfaceBlock'

// Default model when the caller doesn't specify. Kept in one place so bumps
// happen atomically.
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

// Schema-only responses are coerced into a synthetic tool. Anthropic doesn't
// have a native "JSON mode", but forced tool use is the sanctioned pattern:
// declare a single tool matching the schema and set tool_choice to force it.
const STRUCTURED_OUTPUT_TOOL_NAME = '__intelligence_structured_output'

type AnthropicClient = {
  messages: {
    create: (args: Record<string, unknown>) => Promise<{
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'thinking'; thinking: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: string; [key: string]: unknown }
      >
      stop_reason?: string | null
      model?: string
      usage?: { input_tokens?: number; output_tokens?: number }
    }>
  }
}

async function makeClientBlock(): Promise<AnthropicClient> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const apiKey = getManualClaudeApiKeyBlock()
  if (apiKey) {
    return new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) as unknown as AnthropicClient
  }
  const oauth = getNativeClaudeOauthCredentialsBlock()
  if (oauth?.accessToken) {
    return new Anthropic({
      authToken: oauth.accessToken,
      defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
      dangerouslyAllowBrowser: true,
    }) as unknown as AnthropicClient
  }
  const creds = await getClaudeCredentialsBlock()
  if (!creds) throw new Error('anthropic: no credentials configured')
  return new Anthropic({
    authToken: creds.accessToken,
    defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    dangerouslyAllowBrowser: true,
  }) as unknown as AnthropicClient
}

function toAnthropicMessages(messages: IntelligenceMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'tool') {
      // Tool results become a user message with a tool_result content block.
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          },
        ],
      })
      continue
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Array<Record<string, unknown>> = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

function normalizeFinishReason(
  stopReason: string | null | undefined,
  toolCalls: IntelligenceToolCall[],
): 'stop' | 'tool_calls' | 'length' | 'error' {
  if (toolCalls.length > 0) return 'tool_calls'
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    default:
      return 'stop'
  }
}

export class AnthropicProviderBlock implements IntelligenceProvider {
  readonly id = 'anthropic' as const

  isConfigured(): boolean {
    if (getManualClaudeApiKeyBlock()) return true
    if (getNativeClaudeOauthCredentialsBlock()) return true
    return false
  }

  async availability(): Promise<ProviderAvailability> {
    // Anthropic has no cheap network probe — asking "list models" costs a
    // real API call. If credentials exist, the provider is treated as
    // available. Real failures surface on `chat` and land in telemetry.
    if (!this.isConfigured()) {
      return { available: false, defaultModel: null, details: {}, reason: 'No API key or OAuth credentials' }
    }
    const manual = readAiManualCredentialsBlock().claude?.apiKey ? 'apiKey' : 'oauth'
    return {
      available: true,
      defaultModel: DEFAULT_CLAUDE_MODEL,
      details: { authMode: manual, defaultModel: DEFAULT_CLAUDE_MODEL },
    }
  }

  async chat(request: IntelligenceRequest, signal: AbortSignal): Promise<IntelligenceResponse> {
    const client = await makeClientBlock()
    const args: Record<string, unknown> = {
      model: request.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: toAnthropicMessages(request.messages),
    }

    // Tools + structured-output coercion.
    const tools: Array<Record<string, unknown>> = []
    if (request.tools && request.tools.length > 0) {
      for (const t of request.tools) {
        tools.push({
          name: t.name,
          description: t.description,
          input_schema: toJsonSchemaBlock(t.parameters),
        })
      }
    }
    if (request.responseSchema) {
      // Force a single-tool response that matches the schema. Content is
      // extracted from the tool_use input on the response side.
      tools.push({
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        description: 'Return the required structured output.',
        input_schema: toJsonSchemaBlock(request.responseSchema),
      })
      args.tool_choice = { type: 'tool', name: STRUCTURED_OUTPUT_TOOL_NAME }
    }
    if (tools.length > 0) args.tools = tools

    // disableReasoning is a no-op for Claude — extended thinking is opt-in,
    // not on by default. If the caller wants thinking, they can set an
    // explicit `thinking` option via a future extension.

    // Abort propagation: Anthropic SDK doesn't expose AbortSignal on messages.create
    // for every version — wrap in a race against the signal.
    const request$ = client.messages.create(args)
    const abort$ = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
    const started = performance.now()
    const response = await Promise.race([request$, abort$])
    const latencyMs = performance.now() - started

    const textParts: string[] = []
    const reasoningParts: string[] = []
    const toolCalls: IntelligenceToolCall[] = []
    let structuredOutput: Record<string, unknown> | null = null
    for (const block of response.content) {
      if (block.type === 'text' && typeof (block as { text?: string }).text === 'string') {
        textParts.push((block as { text: string }).text)
      } else if (block.type === 'thinking' && typeof (block as { thinking?: string }).thinking === 'string') {
        reasoningParts.push((block as { thinking: string }).thinking)
      } else if (block.type === 'tool_use') {
        const use = block as { id: string; name: string; input: Record<string, unknown> }
        if (use.name === STRUCTURED_OUTPUT_TOOL_NAME) {
          structuredOutput = use.input
        } else {
          toolCalls.push({ id: use.id, name: use.name, args: use.input })
        }
      }
    }

    // If we forced structured output, project it into `content` as JSON so
    // downstream schema validation sees the same shape as openai-compat.
    const content = structuredOutput
      ? JSON.stringify(structuredOutput)
      : textParts.join('')

    return {
      content,
      reasoning: reasoningParts.join('\n'),
      toolCalls,
      finishReason: normalizeFinishReason(response.stop_reason ?? null, toolCalls),
      usage: {
        promptTokens: response.usage?.input_tokens ?? 0,
        completionTokens: response.usage?.output_tokens ?? 0,
      },
      providerModel: response.model || (args.model as string),
      latencyMs,
    }
  }
}

export const anthropicProvider = new AnthropicProviderBlock()
