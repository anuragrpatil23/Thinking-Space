// A result remembered across mounts. React's useMemo forgets when a view is
// left, so coming back to the Feed regrouped every story from scratch even
// though the feed store (module-level) had not changed at all. This keeps the
// last few results per name, keyed on the identity of their inputs: the same
// store snapshot gives the same answer instantly; any new snapshot computes.

const caches = new Map<string, Array<{ deps: readonly unknown[]; value: unknown }>>()
const KEEP = 4

export function identityMemoBlock<T>(name: string, deps: readonly unknown[], compute: () => T): T {
  const entries = caches.get(name) ?? []
  const hit = entries.find(e => e.deps.length === deps.length && e.deps.every((d, i) => Object.is(d, deps[i])))
  if (hit) return hit.value as T
  const value = compute()
  caches.set(name, [{ deps, value }, ...entries].slice(0, KEEP))
  return value
}
