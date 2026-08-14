// Detects capabilities of an OpenAI-compatible server so the openai-compat
// provider knows how to shape requests. Different servers accept the
// enable_thinking toggle in different places (mlx_lm.server: top-level
// chat_template_kwargs; some LM Studio builds: extra_body; Ollama: doesn't
// use one at all). Discovering this is much cheaper than always sending
// every known variant.
//
// Cache lifetime is short (60s) so restarting the local server with a
// different backend picks up quickly.

import quirks from '@/data/modelQuirks.json'

const PROBE_TIMEOUT_MS = 5_000
const CACHE_TTL_MS = 60_000

export type ServerFamily =
  | 'mlx_lm'         // Apple mlx_lm.server
  | 'lm_studio'      // LM Studio
  | 'ollama'         // Ollama's OpenAI shim
  | 'llama_cpp'      // llama.cpp server
  | 'vllm'           // vLLM
  | 'openai'         // OpenAI proper
  | 'unknown-openai-compat'

export interface ServerProfile {
  family: ServerFamily
  baseUrl: string
  /** All model ids the server reported via `/v1/models`. First is picked as
   *  the "active" model when the user hasn't overridden. */
  models: string[]
  /** Where the enable_thinking flag has to go, if the server supports it at
   *  all. `null` means don't send it. */
  reasoningToggleLocation: 'top-level' | 'extra-body' | null
  /** Whether the server accepts OpenAI-style tools array. */
  supportsTools: boolean
  /** Whether response_format: json_schema is accepted. */
  supportsJsonSchema: boolean
  probedAt: number
  /** Raw system_fingerprint or version string, for the diagnostics UI. */
  fingerprint: string | null
}

interface ServerFamilyQuirk {
  reasoningToggleLocation: ServerProfile['reasoningToggleLocation']
  supportsTools: boolean
  supportsJsonSchema: boolean
}

// Both tables come from `src/data/modelQuirks.json` — see the notes there.
// Fingerprint order is significant.
const FINGERPRINTS: Array<{ match: RegExp; family: ServerFamily }> =
  quirks.servers.fingerprints.map(entry => ({
    match: new RegExp(entry.match, 'i'),
    family: entry.family as ServerFamily,
  }))

const SERVER_FAMILIES = quirks.servers.families as unknown as Record<ServerFamily, ServerFamilyQuirk>

interface CacheEntry { profile: ServerProfile | null; at: number }
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<ServerProfile | null>>()

export function normalizeBaseUrlBlock(raw: string | null | undefined, fallback = 'http://127.0.0.1:1234/v1'): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const normalized = (trimmed || fallback).replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

export function invalidateServerProfileBlock(baseUrl?: string): void {
  if (!baseUrl) {
    cache.clear()
    return
  }
  cache.delete(normalizeBaseUrlBlock(baseUrl))
}

function detectFamilyFromFingerprint(fingerprint: string | null): ServerFamily {
  if (!fingerprint) return 'unknown-openai-compat'
  const f = fingerprint.toLowerCase()
  for (const entry of FINGERPRINTS) {
    if (entry.match.test(f)) return entry.family
  }
  return 'unknown-openai-compat'
}

function capabilitiesForFamily(family: ServerFamily): {
  reasoningToggleLocation: ServerProfile['reasoningToggleLocation']
  supportsTools: boolean
  supportsJsonSchema: boolean
} {
  // Conservative defaults; enable per known-good server. If a server we
  // haven't tagged actually supports more, contracts still fall back to
  // prompt-based JSON so nothing hard-breaks.
  const entry = SERVER_FAMILIES[family] ?? SERVER_FAMILIES['unknown-openai-compat']
  return {
    reasoningToggleLocation: entry.reasoningToggleLocation,
    supportsTools: entry.supportsTools,
    supportsJsonSchema: entry.supportsJsonSchema,
  }
}

export async function probeServerProfileBlock(
  baseUrlRaw: string | null | undefined,
  apiKey?: string,
  force = false,
): Promise<ServerProfile | null> {
  const baseUrl = normalizeBaseUrlBlock(baseUrlRaw)
  if (!force) {
    const cached = cache.get(baseUrl)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.profile
    const pending = inflight.get(baseUrl)
    if (pending) return pending
  }

  const probe = (async (): Promise<ServerProfile | null> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal,
      })
      if (!res.ok) {
        cache.set(baseUrl, { profile: null, at: Date.now() })
        return null
      }
      const body = (await res.json()) as {
        data?: Array<{ id?: string; system_fingerprint?: string; owned_by?: string }>
      }
      const models = (body?.data ?? [])
        .map(m => (typeof m?.id === 'string' ? m.id.trim() : ''))
        .filter(Boolean)
      // Fingerprint isn't on /models for most servers — sniff on demand via
      // a chat/completions probe would be nicer but expensive. Try to infer
      // from any `owned_by` we can see; also stash the URL for the openai
      // heuristic.
      const ownedBy = body?.data?.find(m => typeof m?.owned_by === 'string')?.owned_by ?? null
      let family: ServerFamily = detectFamilyFromFingerprint(ownedBy)
      if (family === 'unknown-openai-compat') {
        if (/api\.openai\.com/i.test(baseUrl)) family = 'openai'
        else if (/127\.0\.0\.1|localhost/.test(baseUrl)) {
          // Local + unknown family — mlx_lm.server is the app's documented
          // primary path today; assume it and let a real probe override.
          family = 'mlx_lm'
        }
      }
      const caps = capabilitiesForFamily(family)
      const profile: ServerProfile = {
        family,
        baseUrl,
        models,
        ...caps,
        probedAt: Date.now(),
        fingerprint: ownedBy,
      }
      cache.set(baseUrl, { profile, at: Date.now() })
      return profile
    } catch {
      cache.set(baseUrl, { profile: null, at: Date.now() })
      return null
    } finally {
      clearTimeout(timeout)
      inflight.delete(baseUrl)
    }
  })()

  inflight.set(baseUrl, probe)
  return probe
}
