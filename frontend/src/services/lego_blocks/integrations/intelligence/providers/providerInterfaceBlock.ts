// The provider contract every backend implements. Kept small on purpose —
// the orchestrator does the interesting work (schema validation, tool loop,
// caching, retry policy). Providers only translate between the normalized
// request/response types and whatever wire format the backend speaks.

import type {
  IntelligenceRequest,
  IntelligenceResponse,
} from '@/services/lego_blocks/units/intelligence/intelligenceRequestBlock'
import type { ProviderId } from '@/services/lego_blocks/units/intelligence/modelProfileBlock'

export interface ProviderAvailability {
  available: boolean
  /** Resolved default model this provider will use if the caller doesn't
   *  override. Null when unavailable or no model can be inferred. */
  defaultModel: string | null
  /** Provider-specific diagnostic detail — shape varies by provider. */
  details: Record<string, unknown>
  /** Optional single-line reason for unavailability, shown in the UI. */
  reason?: string
}

export interface IntelligenceProvider {
  id: ProviderId
  /** Cheap synchronous check based on stored config. Never touches network. */
  isConfigured(): boolean
  /** Full network probe. Cached inside the provider so repeated calls are
   *  cheap; caller can force-refresh via `force`. */
  availability(force?: boolean): Promise<ProviderAvailability>
  /** Execute a normalized request. Providers MUST honor `signal` for
   *  cancellation and MUST return within the caller's timeout window (they
   *  don't set their own timeout — orchestrator does). */
  chat(request: IntelligenceRequest, signal: AbortSignal): Promise<IntelligenceResponse>
}
