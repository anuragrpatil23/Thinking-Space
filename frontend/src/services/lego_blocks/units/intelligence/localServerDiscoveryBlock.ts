// Finds OpenAI-compatible servers already running on this machine so the user
// doesn't have to know or type a base URL.
//
// Every mainstream local runtime binds a predictable loopback port and answers
// `GET /v1/models`, so a short parallel probe of the known ports is enough to
// populate Settings. The candidate list lives in `src/data/modelQuirks.json`
// alongside the other server knowledge — adding a runtime is a data edit.
//
// Loopback only, by design: this walks a fixed list of 127.0.0.1 ports and
// never touches a non-local address, so it can't be pointed at a network.

import quirks from '@/data/modelQuirks.json'
import { normalizeBaseUrlBlock } from './serverProfileBlock'

const PROBE_TIMEOUT_MS = 1_500

export interface DiscoveredLocalServer {
  /** Normalized, ready to store as the provider base URL. */
  baseUrl: string
  /** Human label for the runtime that usually owns this port. */
  runtime: string
  /** Model ids the server reports. First is the one it will serve by default. */
  models: string[]
}

interface Candidate { port: number; runtime: string }

const CANDIDATES = quirks.servers.discovery as Candidate[]

async function probeOneBlock(
  candidate: Candidate,
  signal: AbortSignal | undefined,
): Promise<DiscoveredLocalServer | null> {
  const baseUrl = normalizeBaseUrlBlock(`http://127.0.0.1:${candidate.port}`)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
  const onAbort = () => { controller.abort() }
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal })
    if (!res.ok) return null
    const body = await res.json() as { data?: Array<{ id?: unknown }> }
    const models = (body?.data ?? [])
      .map(entry => (typeof entry?.id === 'string' ? entry.id : null))
      .filter((id): id is string => !!id)
    if (models.length === 0) return null
    return { baseUrl, runtime: candidate.runtime, models }
  } catch {
    // Nothing listening, wrong protocol, or timed out — all mean "not here".
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Probe every known local port in parallel. Never rejects — an unreachable
 *  port is a normal result, not an error. */
export async function discoverLocalServersBlock(
  signal?: AbortSignal,
): Promise<DiscoveredLocalServer[]> {
  const results = await Promise.all(CANDIDATES.map(c => probeOneBlock(c, signal)))
  return results.filter((r): r is DiscoveredLocalServer => r !== null)
}
