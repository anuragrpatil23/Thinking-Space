// Multi-turn tool-calling loop. Sits on top of a provider and drives the
// dialogue until the model produces a terminal (non-tool) response or the
// step budget is exhausted. Each tool call is dispatched via the caller's
// resolver so the loop stays decoupled from the capability registry — a
// consumer can plug in any resolver (registry, mock, or a hand-picked map).

import type { IntelligenceProvider } from './providers/providerInterfaceBlock'
import type {
  IntelligenceMessage,
  IntelligenceRequest,
  IntelligenceResponse,
  IntelligenceToolCall,
  IntelligenceToolDefinition,
} from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'

export interface ToolResolveResult {
  /** JSON-serializable value returned to the model as the tool's output. */
  content: unknown
  /** Set on failure so the model sees a clear error string. */
  error?: string
}

export type ToolResolver = (call: IntelligenceToolCall, signal: AbortSignal) => Promise<ToolResolveResult>

export interface ToolLoopOptions {
  provider: IntelligenceProvider
  request: IntelligenceRequest
  tools: IntelligenceToolDefinition[]
  resolveTool: ToolResolver
  maxSteps?: number
  signal: AbortSignal
  /** Called after each round trip — useful for telemetry. */
  onStep?: (step: number, response: IntelligenceResponse) => void
}

export interface ToolLoopOutcome {
  /** Final assistant response (no tool_calls). */
  finalResponse: IntelligenceResponse
  /** Number of provider round-trips consumed. */
  steps: number
  /** All tool calls executed across the loop, in order. */
  toolCalls: IntelligenceToolCall[]
}

const DEFAULT_MAX_STEPS = 6

export async function runToolLoopBlock(opts: ToolLoopOptions): Promise<ToolLoopOutcome> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  // Clone messages so we don't mutate the caller's array as the loop grows it.
  const messages: IntelligenceMessage[] = [...opts.request.messages]
  const executedCalls: IntelligenceToolCall[] = []

  for (let step = 1; step <= maxSteps; step += 1) {
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError')
    const request: IntelligenceRequest = {
      ...opts.request,
      messages,
      tools: opts.tools,
    }
    const response = await opts.provider.chat(request, opts.signal)
    opts.onStep?.(step, response)

    if (response.finishReason !== 'tool_calls' || response.toolCalls.length === 0) {
      return { finalResponse: response, steps: step, toolCalls: executedCalls }
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    })

    // Resolve each tool call sequentially. Parallel resolution is possible
    // but complicates cancellation and rarely matters for internal tasks;
    // add later if a real workload needs it.
    for (const call of response.toolCalls) {
      executedCalls.push(call)
      let result: ToolResolveResult
      try {
        result = await opts.resolveTool(call, opts.signal)
      } catch (err) {
        result = {
          content: null,
          error: err instanceof Error ? err.message : String(err),
        }
      }
      const payload = result.error
        ? JSON.stringify({ error: result.error })
        : typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content ?? null)
      messages.push({
        role: 'tool',
        content: payload,
        toolCallId: call.id,
        toolName: call.name,
      })
    }
  }

  throw new Error(`tool loop exceeded ${maxSteps} steps`)
}
