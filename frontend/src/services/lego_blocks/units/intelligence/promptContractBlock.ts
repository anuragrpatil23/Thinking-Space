// A Contract is the atomic unit of an intelligence task. It bundles:
//   - a stable id (used for cache namespacing and telemetry grouping),
//   - a monotonically increasing `promptVersion` (bump to invalidate cache
//     across the whole task class after prompt/sanitizer changes),
//   - a builder that turns typed input into a normalized request,
//   - a sanitizer that turns raw model output into the typed output,
//   - an optional cache-key hasher (defaults to sha over the serialized input).
//
// Contracts are provider-neutral. They describe WHAT the model should do; the
// orchestrator wires the WHICH-provider decision on top.

import type { Infer, SchemaNode } from './schemaBlock'
import type { IntelligenceRequest, IntelligenceToolDefinition } from './intelligenceRequestBlock'

export interface ContractBuildContext {
  /** Model id the provider resolved this request to. Contracts rarely need
   *  it, but a few (Qwen /no_think prefix, Gemma no-tools workarounds) do. */
  model: string
}
// Note: no token budget here on purpose. A contract controls its output
// LENGTH through its prompt ("1-5 bullets", "one line title") — the only
// mechanism the model can actually obey. The request's stop-limit is a
// runaway guard owned by the model profile, not something a contract tunes.

export interface ContractOutput<T> {
  value: T
  /** Anything the model produced beyond the typed output — kept for telemetry
   *  (e.g. reasoning trail, unused fields the model added). Never null;
   *  contracts can return {} when nothing extra. */
  meta: Record<string, unknown>
}

export interface Contract<TInput, TOutputSchema extends SchemaNode, TOutput = unknown> {
  /** Stable identifier — namespaces the cache. e.g. "session-title". */
  id: string
  /** Bump this when the prompt or sanitizer changes so old cached outputs
   *  are treated as stale. */
  promptVersion: number
  /** Zod-lite schema for the structured output. Providers use this to steer
   *  the model (json_schema when supported) and the orchestrator uses it to
   *  validate before returning to the caller. */
  outputSchema: TOutputSchema
  /** Tool definitions available to the model during this task. Most contracts
   *  don't use tools (empty or omitted). */
  tools?: IntelligenceToolDefinition[]
  /** Build the normalized request. Contracts must NOT set `model` — the
   *  orchestrator injects the resolved model. All other fields are the
   *  contract's responsibility. */
  buildRequest: (input: TInput, ctx: ContractBuildContext) => Omit<IntelligenceRequest, 'model'>
  /** Turn validated structured output into the contract's typed output.
   *  Return null to signal "unusable; fall through to caller's fallback"
   *  without treating it as an error.
   *
   *  `TOutput` is inferred from the implementation, so a caller reading
   *  `contract.finalize(...)?.value` gets the contract's real output type. It
   *  was hardcoded to `unknown`, which erased every contract's output at the
   *  type level and made even `value.title` an error at the call site. Defaults
   *  to `unknown` so a `Contract<A, B>` written before this still compiles. */
  finalize: (parsed: Infer<TOutputSchema>, input: TInput) => ContractOutput<TOutput> | null
  /** Optional custom cache key. Defaults to a hash over `JSON.stringify(input)`
   *  in the orchestrator when omitted. Provide this for inputs that contain
   *  volatile fields (timestamps, references) that shouldn't invalidate. */
  cacheKey?: (input: TInput) => string
}

// Helper for contracts to declare themselves with less ceremony. Preserves
// the schema's type parameter for downstream Infer<>.
export function defineContractBlock<TInput, TOutputSchema extends SchemaNode, TOutput>(
  c: Contract<TInput, TOutputSchema, TOutput>,
): Contract<TInput, TOutputSchema, TOutput> {
  return c
}
