// Provider adapter that routes intelligence requests through the Claude Code
// CLI (`claude -p`) via a main-process shell-out. Pro-plan users already pay
// for Claude via subscription; hitting the API SDK on top of that would
// double-bill them. The CLI reuses the OAuth login that the interactive
// Claude Code session set up, so no separate credential setup is needed.
//
// Constraints (vs. anthropicProviderBlock via SDK):
//   - No streaming (buffered stdout).
//   - No native tool calling. Tool-using contracts should stay on the SDK
//     provider; this one is meant for text-only / schema-via-instruction
//     tasks (chain digests, session titles, day atoms).
//   - JSON schema is not natively enforced. If a schema is present we still
//     let the request through — contracts fall back to instruction-based
//     JSON output and validate on the orchestrator side.
//   - Only available inside Electron. In the browser (`window.electronAPI`
//     missing) the provider reports unconfigured.

import type {
  IntelligenceRequest,
  IntelligenceResponse,
} from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'
import type {
  IntelligenceProvider,
  ProviderAvailability,
} from './providerInterfaceBlock'

const DEFAULT_MODEL = 'haiku'

// Flatten the message list into a single prompt string. The CLI has no
// concept of an ongoing conversation via -p — each invocation is a one-shot.
// For internal intelligence tasks (which are single-user-turn) this is
// exactly what we need, and previous tool/assistant turns aren't in the mix.
function flattenMessagesBlock(request: IntelligenceRequest): string {
  const parts: string[] = []
  for (const m of request.messages) {
    if (m.role === 'tool') continue
    if (m.role === 'assistant' && !m.content) continue
    if (m.role === 'user') {
      parts.push(m.content)
    } else if (m.role === 'assistant') {
      parts.push(`Previous assistant: ${m.content}`)
    }
  }
  return parts.join('\n\n')
}

function newRequestIdBlock(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class ClaudeCliProviderBlock implements IntelligenceProvider {
  readonly id = 'claude-cli' as const

  private probeCache: { available: boolean; version: string | null } | null = null

  isConfigured(): boolean {
    // Presence of the electron bridge implies we can attempt the shell-out.
    // Actual binary availability is answered by availability() via the probe.
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    return !!api && typeof api.claudeCliChat === 'function'
  }

  async availability(force?: boolean): Promise<ProviderAvailability> {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || typeof api.claudeCliProbe !== 'function') {
      return {
        available: false,
        defaultModel: null,
        details: { transport: 'claude -p (electron ipc)' },
        reason: 'Claude Code CLI is only available inside the Thinking Space desktop app',
      }
    }
    if (!this.probeCache || force) {
      this.probeCache = await api.claudeCliProbe()
    }
    if (!this.probeCache.available) {
      return {
        available: false,
        defaultModel: null,
        details: { transport: 'claude -p', version: null },
        reason: 'Claude Code CLI (`claude`) not found on PATH',
      }
    }
    return {
      available: true,
      defaultModel: DEFAULT_MODEL,
      details: {
        transport: 'claude -p',
        version: this.probeCache.version,
        defaultModel: DEFAULT_MODEL,
        note: 'Uses interactive Claude Code OAuth — no API tokens billed for Pro-plan users.',
      },
    }
  }

  async chat(request: IntelligenceRequest, signal: AbortSignal): Promise<IntelligenceResponse> {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || typeof api.claudeCliChat !== 'function') {
      throw new Error('claude-cli: bridge not available (running outside Electron?)')
    }
    if (request.tools && request.tools.length > 0) {
      // Fail loud rather than silently ignore — the caller expects tools to
      // work and would be misled by an empty toolCalls response.
      throw new Error('claude-cli: tool calling is not supported via `claude -p`; use the anthropic SDK provider')
    }

    const requestId = newRequestIdBlock()
    // Wall-clock budget — `claude -p` can be slow to warm up. 60s is plenty
    // for the digest/title-shaped inputs this provider is designed for.
    const timeoutMs = 60_000

    signal.addEventListener('abort', () => {
      if (typeof api.claudeCliCancel === 'function') void api.claudeCliCancel(requestId)
    }, { once: true })

    const started = performance.now()
    const result = await api.claudeCliChat(requestId, {
      model: request.model || DEFAULT_MODEL,
      system: request.system,
      userPrompt: flattenMessagesBlock(request),
      timeoutMs,
    })
    const latencyMs = result.latencyMs ?? (performance.now() - started)
    if (!result.ok || typeof result.content !== 'string') {
      throw new Error(`claude-cli: ${result.error ?? 'unknown error'}`)
    }

    return {
      content: result.content,
      reasoning: '',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      providerModel: request.model || DEFAULT_MODEL,
      latencyMs,
    }
  }
}

export const claudeCliProvider = new ClaudeCliProviderBlock()
