// Public surface for every internal AI task in the app. Consumers pass in a
// Contract (WHAT to do) and get back a typed, cached, provider-agnostic
// result. Callers never see raw HTTP, prompt strings, or model quirks.
//
// Design notes:
//   - `runContract` is the primary entry point. Handles: provider resolution,
//     model resolution, JSON-schema steering, sanitizer + validation, cache
//     read/write, telemetry, cancellation, timeout.
//   - `runWithTools` is for open-ended tool tasks (no structured schema).
//   - `availability` and `diagnose` power the Settings → AI → Diagnostics panel.

import { runToolLoopBlock, type ToolResolver } from '@/services/lego_blocks/integrations/intelligence/toolLoopBlock'
import { enqueueIntelligenceJobBlock } from '@/services/lego_blocks/integrations/intelligence/jobQueueBlock'
import {
  readIntelligenceCacheBlock,
  writeIntelligenceCacheBlock,
} from '@/services/lego_blocks/integrations/intelligence/intelligenceCacheBlock'
import {
  listProvidersBlock,
  resolveProviderBlock,
} from '@/services/lego_blocks/integrations/intelligence/providerRegistryBlock'
import type { IntelligenceProvider } from '@/services/lego_blocks/integrations/intelligence/providers/providerInterfaceBlock'
import type { Contract } from '@/services/lego_blocks/units/intelligence/promptContractBlock'
import { resolveModelProfileBlock, type ModelProfile, type ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'
import {
  resolveContractThinkingBlock,
  type AiSettingsScope,
} from '@/services/lego_blocks/integrations/aiSettingsBlock'
import {
  type IntelligenceRequest,
  type IntelligenceToolDefinition,
} from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'
import { stripReasoningLeakageBlock } from '@/services/lego_blocks/units/intelligence/reasoningStripBlock'
import { type Infer, type SchemaNode, toJsonSchemaBlock, validateBlock } from '@/services/lego_blocks/units/intelligence/schemaBlock'
import {
  makeIntelligenceErrorBlock,
  type IntelligenceError,
} from '@/services/lego_blocks/units/intelligence/intelligenceErrorsBlock'
import { recordTelemetryBlock } from '@/services/lego_blocks/units/intelligence/intelligenceTelemetryBlock'

export interface RunContractOptions {
  provider?: ProviderId
  /** Override the provider's default model. Rare — Settings usually decides. */
  model?: string
  /** Force cache miss (still writes back). */
  refresh?: boolean
  /** Per-call timeout. Default 30s — plenty for local inference. */
  timeoutMs?: number
  /** Cancel from the caller (component unmount, etc.). */
  signal?: AbortSignal
  /** Settings scope this run belongs to. When set, the user's per-scope
   *  thinking preference decides reasoning for local models. Omit to keep the
   *  reasoning-off default. */
  scope?: AiSettingsScope
}

export interface RunContractSuccess<T> {
  ok: true
  value: T
  meta: Record<string, unknown>
  providerId: ProviderId
  model: string
  cacheHit: boolean
}

export interface RunContractFailure {
  ok: false
  error: IntelligenceError
}

export type RunContractResult<T> = RunContractSuccess<T> | RunContractFailure

/** Whether to suppress the model's hidden reasoning for this run.
 *
 *  Internal tasks want single-shot answers, so reasoning-off stays the default
 *  and only an EXPLICIT opt-in flips it. That asymmetry is deliberate: the
 *  thinking setting defaults to on (right for chat, where the user is watching
 *  a stream), but a contract run is a single shot against a fixed token budget
 *  — silently enabling reasoning there makes every digest slower and risks the
 *  answer being truncated by the reasoning trail. So an untouched setting must
 *  mean "off here" even though it reads as "on" for chat.
 *
 *  Precedence: scope override > provider-level setting > off.
 *  Local models only — the toggle is opensource-ai-only and reasoning is
 *  already opt-in on the Anthropic providers. Returns undefined when the model
 *  has no reasoning mode to toggle. */
function resolveDisableReasoningBlock(
  profile: ModelProfile,
  providerId: ProviderId,
  scope: AiSettingsScope | undefined,
): boolean | undefined {
  if (!profile.hasReasoningMode) return undefined
  if (!scope || providerId !== 'openai-compat') return true
  return !resolveContractThinkingBlock(scope, 'opensource-ai')
}

/** Telemetry label for a resolved reasoning state. undefined (no reasoning
 *  mode on this model) stays undefined rather than reporting a misleading
 *  "off" for a model that never had a toggle. */
function reasoningLabelBlock(disableReasoning: boolean | undefined): 'on' | 'off' | undefined {
  if (disableReasoning === undefined) return undefined
  return disableReasoning ? 'off' : 'on'
}

export interface RunWithToolsOptions {
  provider?: ProviderId
  model?: string
  system: string
  userPrompt: string
  tools: IntelligenceToolDefinition[]
  resolveTool: ToolResolver
  maxSteps?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** See RunContractOptions.scope. */
  scope?: AiSettingsScope
}

export interface DiagnosticsSnapshot {
  defaultProvider: ProviderId
  providers: Array<{
    id: ProviderId
    configured: boolean
    available: boolean
    defaultModel: string | null
    details: Record<string, unknown>
    reason?: string
  }>
}

// Hash inputs deterministically for cache keys. Web-crypto SHA-256 is
// available in Electron renderer and modern browsers. Falls back to a JSON
// string hash when subtle isn't available (SSR, tests).
async function hashInputBlock(value: unknown): Promise<string> {
  const json = JSON.stringify(value ?? null)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(json)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const arr = new Uint8Array(digest)
    let hex = ''
    for (let i = 0; i < arr.length; i += 1) hex += arr[i].toString(16).padStart(2, '0')
    return hex.slice(0, 32)
  }
  let h = 5381
  for (let i = 0; i < json.length; i += 1) h = ((h << 5) + h + json.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

function makeTimeoutSignalBlock(caller: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
  const cancelCaller = caller
    ? () => {
      if (caller.aborted) controller.abort(caller.reason)
      else caller.addEventListener('abort', () => controller.abort(caller.reason), { once: true })
    }
    : null
  cancelCaller?.()
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

async function resolveModelForRun(
  provider: IntelligenceProvider,
  explicit: string | undefined,
): Promise<string | null> {
  if (explicit) return explicit
  const av = await provider.availability()
  return av.defaultModel
}

function extractJsonFromContent(content: string): unknown {
  // Fast path: content already looks like JSON.
  const trimmed = content.trim()
  if (!trimmed) return null
  const first = trimmed[0]
  if (first === '{' || first === '[') {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
  }
  // Slow path: pull the first balanced JSON object out of the text. Handles
  // models that wrap output in fences or prose.
  const start = trimmed.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const chunk = trimmed.slice(start, i + 1)
        try { return JSON.parse(chunk) } catch { return null }
      }
    }
  }
  return null
}

export async function runContract<TInput, TOutputSchema extends SchemaNode>(
  contract: Contract<TInput, TOutputSchema>,
  input: TInput,
  options: RunContractOptions = {},
): Promise<RunContractResult<ReturnType<NonNullable<typeof contract.finalize>> extends { value: infer V } | null ? V : Infer<TOutputSchema>>> {
  type Value = ReturnType<NonNullable<typeof contract.finalize>> extends { value: infer V } | null ? V : Infer<TOutputSchema>

  const providerId = options.provider
  let provider: IntelligenceProvider
  try {
    provider = resolveProviderBlock(providerId)
  } catch (err) {
    return failure({ kind: 'no-provider-configured', message: err instanceof Error ? err.message : String(err) })
  }
  if (!provider.isConfigured()) {
    return failure(makeIntelligenceErrorBlock('no-provider-configured', `Provider ${provider.id} not configured`, {
      providerId: provider.id,
      taskId: contract.id,
    }))
  }

  const model = await resolveModelForRun(provider, options.model)
  if (!model) {
    return failure(makeIntelligenceErrorBlock('no-model-available', 'Provider has no model available', {
      providerId: provider.id,
      taskId: contract.id,
    }))
  }
  const profile = resolveModelProfileBlock(model, provider.id)
  const disableReasoning = resolveDisableReasoningBlock(profile, provider.id, options.scope)

  // Cache lookup — key spans task + input + prompt version + model + reasoning
  // state so any of those changing invalidates automatically. Reasoning is in
  // the key because toggling thinking changes the answer, not just its cost.
  const inputHash = contract.cacheKey
    ? contract.cacheKey(input)
    : await hashInputBlock(input)
  const cacheKey = `${inputHash}|v${contract.promptVersion}|${model}|r${disableReasoning === false ? 'on' : 'off'}`
  if (!options.refresh) {
    const cached = await readIntelligenceCacheBlock(contract.id, cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached.valueJson) as { value: Value; meta: Record<string, unknown> }
        recordTelemetryBlock({
          taskId: contract.id,
          providerId: cached.providerId,
          model: cached.model,
          latencyMs: 0,
          status: 'cache-hit',
          cacheHit: true,
        })
        return {
          ok: true,
          value: parsed.value,
          meta: parsed.meta ?? {},
          providerId: cached.providerId as ProviderId,
          model: cached.model,
          cacheHit: true,
        }
      } catch {
        // Corrupt record — fall through and regenerate.
      }
    }
  }

  return enqueueIntelligenceJobBlock(`${contract.id}:${cacheKey}`, async () => {
    const timeoutMs = options.timeoutMs ?? 30_000
    const { signal, cancel } = makeTimeoutSignalBlock(options.signal, timeoutMs)
    try {
      const built = contract.buildRequest(input, {
        model,
        recommendedMaxTokens: profile.recommendedMaxTokens,
      })
      // Attach the contract's output schema to the request so providers can
      // steer via native json_schema when they support it. Even when native
      // steering is unreliable, we also inject a plain-text instruction into
      // `system` describing the required JSON shape — belt-and-suspenders,
      // and the extractJsonFromContent path handles the model's response.
      let system = built.system
      if (contract.outputSchema.kind !== 'string') {
        const schemaJson = JSON.stringify(toJsonSchemaBlock(contract.outputSchema))
        system = `${built.system}\n\nRespond with a single JSON object matching this schema (no prose, no code fence): ${schemaJson}`
      }
      const request: IntelligenceRequest = {
        ...built,
        system,
        model,
        responseSchema: contract.outputSchema.kind === 'string' ? undefined : contract.outputSchema,
      }
      // When the contract didn't opt in explicitly, fall back to the reasoning
      // state resolved above (contract override > scope setting > off).
      if (request.disableReasoning == null) {
        request.disableReasoning = disableReasoning
      }
      const response = await provider.chat(request, signal)

      // Strip inline reasoning leakage (top-level `reasoning` field is already
      // separate on the provider response).
      const stripped = stripReasoningLeakageBlock(response.content)

      let parsedValue: Infer<TOutputSchema>
      if (contract.outputSchema.kind === 'string') {
        // Trivial contracts (single string) skip JSON parsing so a bare text
        // response works even when the server ignores response_format.
        parsedValue = stripped.content as Infer<TOutputSchema>
      } else {
        const raw = extractJsonFromContent(stripped.content)
        const validation = validateBlock(contract.outputSchema, raw)
        if (!validation.ok) {
          return failure(makeIntelligenceErrorBlock('schema-violation', validation.errors.join('; '), {
            providerId: provider.id,
            taskId: contract.id,
            model,
            details: { rawContent: response.content.slice(0, 400) },
          })) as RunContractResult<Value>
        }
        parsedValue = validation.value
      }

      const finalized = contract.finalize(parsedValue, input)
      if (!finalized) {
        recordTelemetryBlock({
          taskId: contract.id,
          providerId: provider.id,
          model,
          latencyMs: response.latencyMs,
          status: 'error',
          finishReason: response.finishReason,
          usage: response.usage,
          reasoning: reasoningLabelBlock(disableReasoning),
          error: makeIntelligenceErrorBlock('empty-content', 'Contract discarded model output', {
            providerId: provider.id,
            model,
            taskId: contract.id,
          }),
        })
        return failure(makeIntelligenceErrorBlock('empty-content', 'Contract discarded model output', {
          providerId: provider.id,
          model,
          taskId: contract.id,
        })) as RunContractResult<Value>
      }

      const value = finalized.value as Value
      await writeIntelligenceCacheBlock({
        taskId: contract.id,
        cacheKey,
        providerId: provider.id,
        model: response.providerModel,
        generatedAt: new Date().toISOString(),
        valueJson: JSON.stringify({ value, meta: finalized.meta }),
      })

      recordTelemetryBlock({
        taskId: contract.id,
        providerId: provider.id,
        model: response.providerModel,
        latencyMs: response.latencyMs,
        status: 'ok',
        finishReason: response.finishReason,
        usage: response.usage,
        reasoning: reasoningLabelBlock(disableReasoning),
        cacheHit: false,
        responsePreview: response.content.slice(0, 200),
      })

      return {
        ok: true,
        value,
        meta: finalized.meta,
        providerId: provider.id,
        model: response.providerModel,
        cacheHit: false,
      } satisfies RunContractSuccess<Value>
    } catch (err) {
      return failure(mapErrorBlock(err, provider.id, contract.id, model))
    } finally {
      cancel()
    }
  }) as Promise<RunContractResult<Value>>
}

export async function runWithTools(options: RunWithToolsOptions): Promise<RunContractResult<string>> {
  let provider: IntelligenceProvider
  try {
    provider = resolveProviderBlock(options.provider)
  } catch (err) {
    return failure({ kind: 'no-provider-configured', message: err instanceof Error ? err.message : String(err) })
  }
  if (!provider.isConfigured()) {
    return failure(makeIntelligenceErrorBlock('no-provider-configured', `Provider ${provider.id} not configured`, {
      providerId: provider.id,
    }))
  }
  const model = await resolveModelForRun(provider, options.model)
  if (!model) {
    return failure(makeIntelligenceErrorBlock('no-model-available', 'Provider has no model available', {
      providerId: provider.id,
    }))
  }
  const profile = resolveModelProfileBlock(model, provider.id)
  if (!profile.supportsTools) {
    return failure(makeIntelligenceErrorBlock('model-unsupported', `Model ${model} does not support tool calls`, {
      providerId: provider.id,
      model,
    }))
  }
  const timeoutMs = options.timeoutMs ?? 60_000
  const { signal, cancel } = makeTimeoutSignalBlock(options.signal, timeoutMs)
  try {
    const outcome = await runToolLoopBlock({
      provider,
      request: {
        model,
        system: options.system,
        messages: [{ role: 'user', content: options.userPrompt }],
        maxTokens: profile.recommendedMaxTokens,
        temperature: 0.2,
        disableReasoning: resolveDisableReasoningBlock(profile, provider.id, options.scope),
      },
      tools: options.tools,
      resolveTool: options.resolveTool,
      maxSteps: options.maxSteps,
      signal,
    })
    recordTelemetryBlock({
      taskId: 'tool-loop',
      providerId: provider.id,
      model: outcome.finalResponse.providerModel,
      latencyMs: outcome.finalResponse.latencyMs,
      status: 'ok',
      finishReason: outcome.finalResponse.finishReason,
      usage: outcome.finalResponse.usage,
      responsePreview: outcome.finalResponse.content.slice(0, 200),
    })
    return {
      ok: true,
      value: outcome.finalResponse.content,
      meta: { toolCalls: outcome.toolCalls, steps: outcome.steps },
      providerId: provider.id,
      model: outcome.finalResponse.providerModel,
      cacheHit: false,
    }
  } catch (err) {
    return failure(mapErrorBlock(err, provider.id, 'tool-loop', model))
  } finally {
    cancel()
  }
}

export async function availability(providerId?: ProviderId) {
  const provider = resolveProviderBlock(providerId)
  return provider.availability()
}

export async function diagnose(): Promise<DiagnosticsSnapshot> {
  const providers = await Promise.all(
    listProvidersBlock().map(async p => {
      const av = await p.availability().catch(() => ({ available: false, defaultModel: null, details: {}, reason: 'probe failed' }))
      return {
        id: p.id,
        configured: p.isConfigured(),
        available: av.available,
        defaultModel: av.defaultModel,
        details: av.details,
        reason: av.reason,
      }
    }),
  )
  const { readDefaultProviderBlock } = await import('@/services/lego_blocks/integrations/intelligence/providerRegistryBlock')
  return { defaultProvider: readDefaultProviderBlock(), providers }
}

// ---------- helpers ----------

function failure(error: IntelligenceError): RunContractFailure {
  return { ok: false, error }
}

function mapErrorBlock(err: unknown, providerId: string, taskId: string, model: string): IntelligenceError {
  if (err instanceof DOMException) {
    if (err.name === 'AbortError') {
      return makeIntelligenceErrorBlock('aborted', 'Cancelled', { providerId, taskId, model })
    }
    if (err.name === 'TimeoutError') {
      return makeIntelligenceErrorBlock('timeout', 'Request timed out', { providerId, taskId, model })
    }
  }
  if (err && typeof err === 'object' && 'httpStatus' in err) {
    return makeIntelligenceErrorBlock('http-error', err instanceof Error ? err.message : String(err), {
      providerId,
      taskId,
      model,
      httpStatus: (err as { httpStatus?: number }).httpStatus,
    })
  }
  return makeIntelligenceErrorBlock('provider-unreachable', err instanceof Error ? err.message : String(err), {
    providerId,
    taskId,
    model,
  })
}
