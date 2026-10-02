// Extension point for the RSS reader: an optional module can put a short text
// mark on articles (for example "Note" on an article that something else in
// the vault refers to). The reader does not know what a mark means. It shows
// the label and calls onOpen when the mark is clicked.
//
// Modules opt in by file name: any `*.rssItemAnnotations.ts` under src/ is
// imported the first time the reader shows marks, and registers a provider on
// import. When no such module exists the glob is empty and nothing shows.

export interface RssItemAnnotationBlock {
  /** Short plain text, shown as a small chip. */
  label: string
  /** Tooltip. */
  title?: string
  onOpen: (ctx: { navigate: (to: string) => void }) => void
}

export interface RssItemAnnotationProviderBlock {
  id: string
  annotate: (itemId: string) => RssItemAnnotationBlock | null
  /** The provider calls onChange when its marks change; returns an unsubscribe. */
  subscribe?: (onChange: () => void) => () => void
}

const providers = new Map<string, { provider: RssItemAnnotationProviderBlock; unsubscribe: (() => void) | null }>()
const listeners = new Set<() => void>()
let version = 0

function notifyBlock(): void {
  version += 1
  for (const listener of listeners) listener()
}

export function registerRssItemAnnotationProviderBlock(provider: RssItemAnnotationProviderBlock): () => void {
  providers.get(provider.id)?.unsubscribe?.()
  providers.set(provider.id, { provider, unsubscribe: provider.subscribe?.(notifyBlock) ?? null })
  notifyBlock()
  return () => {
    const entry = providers.get(provider.id)
    if (entry?.provider !== provider) return
    entry.unsubscribe?.()
    providers.delete(provider.id)
    notifyBlock()
  }
}

export function rssItemAnnotationsBlock(itemId: string): RssItemAnnotationBlock[] {
  const out: RssItemAnnotationBlock[] = []
  for (const { provider } of providers.values()) {
    try {
      const mark = provider.annotate(itemId)
      if (mark) out.push(mark)
    } catch {
      // A broken provider must never break the reader.
    }
  }
  return out
}

export function subscribeRssItemAnnotationsBlock(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function rssItemAnnotationsVersionBlock(): number {
  return version
}

let loadStarted = false

/** Import the opt-in provider modules once. Safe to call on every mount. */
export function ensureRssItemAnnotationProvidersBlock(): void {
  if (loadStarted) return
  loadStarted = true
  const modules = import.meta.glob('/src/**/*.rssItemAnnotations.ts')
  for (const load of Object.values(modules)) {
    void load().catch(() => { /* an optional module failed to load; the reader carries on */ })
  }
}
