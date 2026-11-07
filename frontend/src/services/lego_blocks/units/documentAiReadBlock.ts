// Extension point for documents: an optional module can show what an AI read
// in a document, in a box above its text (the Feed article's "AI read" box,
// for any document). The viewer does not know what a reading is. It asks each
// provider whether it has one for the path and renders the provider's
// component above the text.
//
// Modules opt in by file name: any `*.documentAiRead.tsx` under src/ is
// imported the first time a document is shown, and registers a provider on
// import. With no such module the glob is empty and nothing shows.

import type { ComponentType } from 'react'

export interface DocumentAiReadProviderBlock {
  id: string
  /** Cheap and synchronous: only the path, never the file. */
  matches: (path: string) => boolean
  /** Renders the reading (or nothing, when there is none for this document). */
  Component: ComponentType<{ path: string }>
}

const providers = new Map<string, DocumentAiReadProviderBlock>()
const listeners = new Set<() => void>()

export function registerDocumentAiReadProviderBlock(provider: DocumentAiReadProviderBlock): () => void {
  providers.set(provider.id, provider)
  for (const listener of listeners) listener()
  return () => {
    if (providers.get(provider.id) !== provider) return
    providers.delete(provider.id)
    for (const listener of listeners) listener()
  }
}

export function documentAiReadProvidersBlock(path: string): DocumentAiReadProviderBlock[] {
  return [...providers.values()].filter((p) => {
    try {
      return p.matches(path)
    } catch {
      // A broken provider must never break the viewer.
      return false
    }
  })
}

export function subscribeDocumentAiReadProvidersBlock(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

let loadStarted = false

/** Import the opt-in provider modules once. Safe to call on every mount. */
export function ensureDocumentAiReadProvidersBlock(): void {
  if (loadStarted) return
  loadStarted = true
  const modules = import.meta.glob('/src/**/*.documentAiRead.tsx')
  for (const load of Object.values(modules)) {
    void load().catch(() => { /* an optional module failed to load; the viewer carries on */ })
  }
}
