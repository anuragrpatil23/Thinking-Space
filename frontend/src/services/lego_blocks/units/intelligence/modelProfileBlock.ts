// Per-model capability registry. Contracts declare what they NEED (tools,
// structured output, no reasoning). Providers ask the profile whether a given
// model can meet those requirements and how to configure the request.
//
// A profile is derived by pattern-matching the model id — not by asking the
// server, because most local servers don't tell us what family a loaded model
// belongs to. When a model doesn't match any known pattern we fall back to a
// conservative default (tools off, JSON schema off, no reasoning toggle).

export type ProviderId = 'openai-compat' | 'anthropic' | 'claude-cli'

export interface ModelProfile {
  /** Human-readable family name for diagnostics UI. */
  family: string
  provider: ProviderId
  /** Does the model support OpenAI-style function/tool calling? */
  supportsTools: boolean
  /** Does the model support `response_format: json_schema` (OpenAI) or
   *  json-mode / equivalent? For Anthropic we always coerce structured output
   *  via a dedicated tool, so this stays true when provider=anthropic. */
  supportsJsonSchema: boolean
  /** Model has a hidden-thinking mode that must be actively disabled for
   *  single-shot internal tasks. */
  hasReasoningMode: boolean
  /** Recommended max output tokens for this model class. Reasoning models
   *  need much more headroom because "content" tokens come after the hidden
   *  thought, even when the toggle is off (some servers still leak). */
  recommendedMaxTokens: number
  /** Approximate context window for guarding oversized inputs. */
  contextWindow: number
}

// Ordered patterns — first match wins. Case-insensitive substring match on
// the model id. Add entries here as new families come online.
const FAMILIES: Array<{ match: RegExp; profile: ModelProfile }> = [
  {
    match: /qwen3\.?6|qwen3-next|qwen-3-next/i,
    profile: {
      family: 'Qwen 3.6 / Qwen3-Next',
      provider: 'openai-compat',
      supportsTools: true,
      supportsJsonSchema: true,
      hasReasoningMode: true,
      recommendedMaxTokens: 1024,
      contextWindow: 128_000,
    },
  },
  {
    match: /qwen[-_ ]?3/i,
    profile: {
      family: 'Qwen 3',
      provider: 'openai-compat',
      supportsTools: true,
      supportsJsonSchema: true,
      hasReasoningMode: true,
      recommendedMaxTokens: 1024,
      contextWindow: 32_000,
    },
  },
  {
    match: /qwen[-_ ]?2/i,
    profile: {
      family: 'Qwen 2',
      provider: 'openai-compat',
      supportsTools: true,
      supportsJsonSchema: false,
      hasReasoningMode: false,
      recommendedMaxTokens: 512,
      contextWindow: 32_000,
    },
  },
  {
    match: /gemma[-_ ]?[34]/i,
    profile: {
      family: 'Gemma 3/4',
      provider: 'openai-compat',
      supportsTools: false,
      supportsJsonSchema: false,
      hasReasoningMode: false,
      recommendedMaxTokens: 512,
      contextWindow: 128_000,
    },
  },
  {
    match: /llama[-_ ]?3\.[123]|llama[-_ ]?3\.\d/i,
    profile: {
      family: 'Llama 3.x',
      provider: 'openai-compat',
      supportsTools: true,
      supportsJsonSchema: true,
      hasReasoningMode: false,
      recommendedMaxTokens: 512,
      contextWindow: 128_000,
    },
  },
  {
    match: /deepseek[-_ ]?r1|r1[-_ ]?distill/i,
    profile: {
      family: 'DeepSeek R1',
      provider: 'openai-compat',
      supportsTools: false,
      supportsJsonSchema: false,
      hasReasoningMode: true,
      recommendedMaxTokens: 2048,
      contextWindow: 64_000,
    },
  },
  // Anthropic entries — matched by model prefix on the Claude side.
  {
    match: /claude[-_ ]?opus[-_ ]?4/i,
    profile: {
      family: 'Claude Opus 4.x',
      provider: 'anthropic',
      supportsTools: true,
      supportsJsonSchema: true,
      hasReasoningMode: true,
      recommendedMaxTokens: 4096,
      contextWindow: 200_000,
    },
  },
  {
    match: /claude[-_ ]?sonnet[-_ ]?4|claude[-_ ]?4[-_ ]?sonnet/i,
    profile: {
      family: 'Claude Sonnet 4.x',
      provider: 'anthropic',
      supportsTools: true,
      supportsJsonSchema: true,
      hasReasoningMode: true,
      recommendedMaxTokens: 4096,
      contextWindow: 200_000,
    },
  },
  {
    match: /claude[-_ ]?haiku[-_ ]?4|claude[-_ ]?4[-_ ]?haiku/i,
    profile: {
      family: 'Claude Haiku 4.x',
      provider: 'anthropic',
      supportsTools: true,
      supportsJsonSchema: true,
      hasReasoningMode: false,
      recommendedMaxTokens: 2048,
      contextWindow: 200_000,
    },
  },
  {
    match: /claude/i,
    profile: {
      family: 'Claude (unknown version)',
      provider: 'anthropic',
      supportsTools: true,
      supportsJsonSchema: true,
      hasReasoningMode: false,
      recommendedMaxTokens: 2048,
      contextWindow: 200_000,
    },
  },
]

const UNKNOWN_LOCAL_PROFILE: ModelProfile = {
  family: 'Unknown (OpenAI-compatible)',
  provider: 'openai-compat',
  supportsTools: false,
  supportsJsonSchema: false,
  hasReasoningMode: false,
  recommendedMaxTokens: 512,
  contextWindow: 8_000,
}

export function resolveModelProfileBlock(modelId: string, providerHint?: ProviderId): ModelProfile {
  if (!modelId) {
    return providerHint === 'anthropic'
      ? { ...UNKNOWN_LOCAL_PROFILE, family: 'Unknown Claude', provider: 'anthropic' }
      : UNKNOWN_LOCAL_PROFILE
  }
  for (const entry of FAMILIES) {
    if (entry.match.test(modelId)) return entry.profile
  }
  return providerHint === 'anthropic'
    ? { ...UNKNOWN_LOCAL_PROFILE, family: 'Unknown Claude', provider: 'anthropic' }
    : UNKNOWN_LOCAL_PROFILE
}
