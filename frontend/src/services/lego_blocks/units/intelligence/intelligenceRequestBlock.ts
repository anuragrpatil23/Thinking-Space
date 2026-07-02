// Provider-neutral request/response shape. Providers translate to/from their
// wire format (OpenAI vs Anthropic); everything above the provider layer
// speaks these types.
//
// Deliberately narrow: we don't model streaming (this subsystem is for
// internal intelligence tasks, not user chat), n>1 completions, or logprobs.

import type { SchemaNode } from './schemaBlock'

export interface IntelligenceMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** Only set on role: 'tool' — id from the assistant's previous tool_call. */
  toolCallId?: string
  /** Only set on role: 'tool' — mirrors the assistant's tool call name for
   *  providers that require it (Anthropic accepts either shape; OpenAI wants
   *  the name on the tool result). */
  toolName?: string
  /** Only set on role: 'assistant' when the assistant emitted tool calls. */
  toolCalls?: IntelligenceToolCall[]
}

export interface IntelligenceToolCall {
  id: string
  name: string
  /** Parsed JSON args. Providers stringify/parse as needed. */
  args: Record<string, unknown>
}

export interface IntelligenceToolDefinition {
  name: string
  description: string
  parameters: SchemaNode
}

export interface IntelligenceRequest {
  /** Model id in whatever form the target provider expects. */
  model: string
  system: string
  messages: IntelligenceMessage[]
  /** If set, provider steers the model toward structured output matching the
   *  schema (JSON-schema for openai-compat servers that support it, tool
   *  emulation for Anthropic). */
  responseSchema?: SchemaNode
  tools?: IntelligenceToolDefinition[]
  maxTokens: number
  temperature: number
  /** Suppress hidden reasoning for models that support the toggle. Providers
   *  pick the right transport (top-level chat_template_kwargs, /no_think prefix,
   *  Anthropic thinking config disabled, etc.). */
  disableReasoning?: boolean
}

export type IntelligenceFinishReason =
  | 'stop'         // Model finished naturally
  | 'tool_calls'   // Model requested tool invocations
  | 'length'       // Hit max_tokens
  | 'error'        // Provider-side error surfaced as finish reason

export interface IntelligenceResponse {
  content: string
  /** Any hidden reasoning the model exposed. Empty string when suppressed or
   *  when the model didn't produce reasoning. Never returned to the caller as
   *  part of `content` — kept separate so contracts can decide what to do
   *  with it (log, discard, feed to a repair prompt). */
  reasoning: string
  toolCalls: IntelligenceToolCall[]
  finishReason: IntelligenceFinishReason
  usage: { promptTokens: number; completionTokens: number }
  /** Model id echoed by the provider (may differ from the request if the
   *  provider substitutes a version or normalizes an alias). */
  providerModel: string
  /** Wall-clock latency for the HTTP round trip, ms. */
  latencyMs: number
}
