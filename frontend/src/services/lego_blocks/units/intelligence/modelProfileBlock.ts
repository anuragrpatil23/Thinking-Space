// Per-model capability registry. Contracts declare what they NEED (tools,
// structured output, no reasoning). Providers ask the profile whether a given
// model can meet those requirements and how to configure the request.
//
// A profile is derived by pattern-matching the model id against the table in
// `src/data/modelQuirks.json`. Pattern matching rather than asking the server,
// because server-advertised metadata is unreliable: rapid-mlx reports
// tool_call_parser/reasoning_parser for models it has an alias for, but nulls
// for anything served by raw HuggingFace repo id. When a model matches no
// pattern we fall back to a conservative default (tools off, JSON schema off,
// no reasoning toggle).

import quirks from '@/data/modelQuirks.json'

export type ProviderId = 'openai-compat' | 'anthropic' | 'claude-cli'

// Coarse label for *what kind of thing* produced a generated record (chain
// digest, day atom). Deliberately provider-family-level, not model-level:
//   - 'local'      → an on-device openai-compat server (mlx/LM Studio/Ollama…)
//   - 'claude'     → Anthropic, via SDK or the claude CLI
//   - 'rule-based' → the deterministic fallback/stub, no model involved
// Persisted alongside each record so we can (a) refuse to save rule-based
// output and (b) regenerate when the user switches the selected provider to a
// different family. See `generationSourceForProviderBlock`.
export type GenerationSource = 'local' | 'claude' | 'rule-based'

/** Map a concrete provider id to its coarse generation source family. */
export function generationSourceForProviderBlock(id: ProviderId): GenerationSource {
  return id === 'openai-compat' ? 'local' : 'claude'
}

// Quality ladder for generated records: claude > local > rule-based. Used to
// decide reuse-vs-regenerate: a stored record is kept whenever its rank is at
// least the tier the current selection would produce, so switching to a
// *lower* tier never stomps a better body we already have — the user has to
// explicitly pick the higher tier to upgrade. Parallels the range-summary
// pipeline's `rangeSummaryTierRankBlock`, just over the coarse source family.
// Legacy records (generator '') are assumed local-tier so a later switch to
// Claude still upgrades them, without a regeneration storm on same-tier reads.
export function generationSourceRankBlock(source: GenerationSource | ''): number {
  switch (source) {
    case 'claude':
      return 2
    case 'local':
      return 1
    case 'rule-based':
      return 0
    default:
      return 1
  }
}

/** Coerce an unknown (parsed-JSON/YAML) value to a valid GenerationSource, or
 *  '' when it's absent/unrecognized. Shared by every persisted record that
 *  carries a `generator` field so the parse rule lives in exactly one place. */
export function parseGenerationSourceBlock(value: unknown): GenerationSource | '' {
  return value === 'local' || value === 'claude' || value === 'rule-based' ? value : ''
}

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
  /** Whether the assist UI offers a thinking switch for this model. Usually
   *  tracks hasReasoningMode, but they differ for unknown local models: we
   *  don't send a toggle we're unsure of, yet still let the user reach for
   *  one. */
  thinkingToggleVisible: boolean
  /** Recommended max output tokens for this model class. Reasoning models
   *  need much more headroom because "content" tokens come after the hidden
   *  thought, even when the toggle is off (some servers still leak). */
  recommendedMaxTokens: number
  /** Approximate context window for guarding oversized inputs. */
  contextWindow: number
}

// The table itself lives in `src/data/modelQuirks.json` so supporting a newly
// released model is a data edit, not a code change. This module only compiles
// and validates it. Order is significant — see the notes in that file.

interface RawProfile {
  family: string
  provider: string
  supportsTools: boolean
  supportsJsonSchema: boolean
  hasReasoningMode: boolean
  thinkingToggleVisible?: boolean
  recommendedMaxTokens: number
  contextWindow: number
}

/** Fail loudly at module load rather than silently degrading every model to
 *  the unknown profile — a typo in the quirks file is a build-time mistake,
 *  not a runtime condition to tolerate. */
function toProfileBlock(raw: RawProfile, where: string): ModelProfile {
  if (raw.provider !== 'openai-compat' && raw.provider !== 'anthropic' && raw.provider !== 'claude-cli') {
    throw new Error(`modelQuirks.json: invalid provider "${raw.provider}" at ${where}`)
  }
  return {
    family: raw.family,
    provider: raw.provider,
    supportsTools: raw.supportsTools,
    supportsJsonSchema: raw.supportsJsonSchema,
    hasReasoningMode: raw.hasReasoningMode,
    thinkingToggleVisible: raw.thinkingToggleVisible ?? raw.hasReasoningMode,
    recommendedMaxTokens: raw.recommendedMaxTokens,
    contextWindow: raw.contextWindow,
  }
}

const FAMILIES: Array<{ match: RegExp; profile: ModelProfile }> = (
  quirks.models as Array<RawProfile & { match: string }>
).map((entry, i) => ({
  match: new RegExp(entry.match, 'i'),
  profile: toProfileBlock(entry, `models[${i}] (${entry.family})`),
}))

const UNKNOWN_LOCAL_PROFILE = toProfileBlock(quirks.unknownLocal as RawProfile, 'unknownLocal')
const UNKNOWN_ANTHROPIC_PROFILE = toProfileBlock(quirks.unknownAnthropic as RawProfile, 'unknownAnthropic')

export function resolveModelProfileBlock(modelId: string, providerHint?: ProviderId): ModelProfile {
  const fallback = providerHint === 'anthropic' ? UNKNOWN_ANTHROPIC_PROFILE : UNKNOWN_LOCAL_PROFILE
  if (!modelId) return fallback
  for (const entry of FAMILIES) {
    if (entry.match.test(modelId)) return entry.profile
  }
  return fallback
}
