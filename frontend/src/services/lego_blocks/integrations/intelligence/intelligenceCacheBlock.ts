// Generic sidecar-JSON cache for intelligence outputs. One file per record
// under ~/.thinking-space/intelligence-cache/<taskId>/<key>.json in Electron;
// memory-only on non-Electron platforms. Records are keyed by
// (taskId, inputHash, promptVersion, model) — set by the orchestrator.
//
// A short in-memory mirror avoids IPC round-trips when the same key is
// looked up repeatedly during a single render cycle.
//
// Writes go through the main process (electron IPC); the renderer never
// touches disk directly.

export interface IntelligenceCacheRecord {
  /** Task contract id — namespaces the on-disk directory. */
  taskId: string
  /** Fully-resolved cache key: `${inputHash}|${promptVersion}|${model}`. */
  cacheKey: string
  /** Provider id that produced the value ('openai-compat' | 'anthropic'). */
  providerId: string
  /** Model id echoed by the provider. */
  model: string
  /** ISO timestamp. */
  generatedAt: string
  /** Serialized value — cache is opaque about the shape. */
  valueJson: string
}

interface CacheApi {
  intelligenceCacheGet?: (taskId: string, cacheKey: string) => Promise<IntelligenceCacheRecord | null>
  intelligenceCacheSet?: (record: IntelligenceCacheRecord) => Promise<{ ok: boolean; error?: string }>
  intelligenceCacheClear?: (taskId?: string) => Promise<{ ok: boolean; error?: string }>
}

function getApi(): CacheApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { electronAPI?: CacheApi }).electronAPI
  if (!api || !api.intelligenceCacheGet || !api.intelligenceCacheSet) return null
  return api
}

const memory = new Map<string, IntelligenceCacheRecord | null>()

function memoryKey(taskId: string, cacheKey: string): string {
  return `${taskId}\x00${cacheKey}`
}

export function intelligenceCacheAvailableBlock(): boolean {
  return getApi() !== null
}

export async function readIntelligenceCacheBlock(
  taskId: string,
  cacheKey: string,
): Promise<IntelligenceCacheRecord | null> {
  if (!taskId || !cacheKey) return null
  const mk = memoryKey(taskId, cacheKey)
  if (memory.has(mk)) return memory.get(mk) ?? null
  const api = getApi()
  if (!api?.intelligenceCacheGet) {
    memory.set(mk, null)
    return null
  }
  try {
    const rec = await api.intelligenceCacheGet(taskId, cacheKey)
    memory.set(mk, rec)
    return rec
  } catch {
    memory.set(mk, null)
    return null
  }
}

export async function writeIntelligenceCacheBlock(record: IntelligenceCacheRecord): Promise<boolean> {
  const api = getApi()
  if (!api?.intelligenceCacheSet) return false
  try {
    const res = await api.intelligenceCacheSet(record)
    if (res?.ok) {
      memory.set(memoryKey(record.taskId, record.cacheKey), record)
      return true
    }
    return false
  } catch {
    return false
  }
}

export async function clearIntelligenceCacheBlock(taskId?: string): Promise<boolean> {
  const api = getApi()
  if (!api?.intelligenceCacheClear) return false
  try {
    const res = await api.intelligenceCacheClear(taskId)
    if (res?.ok) {
      if (taskId) {
        for (const k of memory.keys()) if (k.startsWith(`${taskId}\x00`)) memory.delete(k)
      } else {
        memory.clear()
      }
      return true
    }
    return false
  } catch {
    return false
  }
}

export function forgetIntelligenceCacheBlock(taskId: string, cacheKey: string): void {
  memory.delete(memoryKey(taskId, cacheKey))
}
