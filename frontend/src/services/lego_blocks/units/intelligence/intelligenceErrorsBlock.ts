// Typed error taxonomy so callers can distinguish "no server" from "model
// misbehaved" from "schema violation" without string-matching messages.
// Every error carries a `kind` and enough context for the diagnostics UI to
// render an actionable panel (which provider, which task, what went wrong).

export type IntelligenceErrorKind =
  | 'no-provider-configured'   // No provider is set up (missing creds/base URL)
  | 'provider-unreachable'     // Server down, network error, wrong URL
  | 'no-model-available'       // Provider reached, no model loaded (LM Studio empty)
  | 'model-unsupported'        // Contract needs a capability model lacks (tools, JSON)
  | 'timeout'                  // Request exceeded the configured budget
  | 'aborted'                  // AbortSignal fired (unmount/user cancel)
  | 'http-error'               // Non-2xx from the server
  | 'malformed-response'       // Server returned unparseable JSON
  | 'empty-content'            // Model produced only reasoning, no usable output
  | 'schema-violation'         // Output failed schema validation after repair
  | 'tool-loop-exceeded'       // Too many tool-call round trips
  | 'internal'                 // Bug in our code

export interface IntelligenceError {
  kind: IntelligenceErrorKind
  message: string
  providerId?: string
  model?: string
  taskId?: string
  httpStatus?: number
  details?: Record<string, unknown>
}

export function makeIntelligenceErrorBlock(
  kind: IntelligenceErrorKind,
  message: string,
  extra: Partial<IntelligenceError> = {},
): IntelligenceError {
  return { kind, message, ...extra }
}

export function isIntelligenceErrorBlock(v: unknown): v is IntelligenceError {
  if (!v || typeof v !== 'object') return false
  const rec = v as Record<string, unknown>
  return typeof rec.kind === 'string' && typeof rec.message === 'string'
}
