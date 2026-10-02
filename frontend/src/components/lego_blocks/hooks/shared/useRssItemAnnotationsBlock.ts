import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  ensureRssItemAnnotationProvidersBlock,
  rssItemAnnotationsBlock,
  rssItemAnnotationsVersionBlock,
  subscribeRssItemAnnotationsBlock,
  type RssItemAnnotationBlock,
} from '@/services/lego_blocks/units/rssItemAnnotationBlock'

/** Marks that optional modules put on reader articles; re-renders when they change. */
export function useRssItemAnnotationsBlock(): (itemId: string) => RssItemAnnotationBlock[] {
  useEffect(() => { ensureRssItemAnnotationProvidersBlock() }, [])
  const version = useSyncExternalStore(subscribeRssItemAnnotationsBlock, rssItemAnnotationsVersionBlock)
  // A new function each time the marks change, so memoized rows re-render.
  return useMemo(() => {
    void version
    return (itemId: string) => rssItemAnnotationsBlock(itemId)
  }, [version])
}
