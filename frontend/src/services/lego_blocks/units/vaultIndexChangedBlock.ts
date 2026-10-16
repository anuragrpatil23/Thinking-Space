// "The vault index cache just changed" — fired after every sync pass so
// readers of the cache (search) can drop what they derived from it. Listeners
// only mark themselves stale; they never do work inline.

type Listener = () => void
const listeners = new Set<Listener>()

export function notifyVaultIndexChangedBlock(): void {
  for (const listener of listeners) listener()
}

export function onVaultIndexChangedBlock(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
