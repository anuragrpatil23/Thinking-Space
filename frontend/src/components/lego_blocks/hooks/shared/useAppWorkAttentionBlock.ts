import { useMemo, useState } from 'react'
import { useRouteActivityBlock } from '@/components/lego_blocks/hooks/shared/useRouteActivityBlock'
import { useReadingAttentionBlock } from '@/components/lego_blocks/hooks/shared/useReadingAttentionBlock'

/**
 * Credit time spent thinking on an app page that is not a document — a gap,
 * the Drops list, a company — the way reading a document is credited.
 *
 * Same accounting as reading: time accrues only between signs of presence
 * inside the page, never for a page left open, and the span is filed under
 * `path` so the project comes from its folder. `path` need not be a file that
 * exists; only its folder and the title are used.
 *
 * Returns the ref callback for the page's root. Nothing is measured until that
 * element is mounted: bound to `document` instead, every click anywhere in the
 * app would count as work on this page.
 */
export function useAppWorkAttentionBlock(path: string | null, title: string): (el: HTMLElement | null) => void {
  const [surface, setSurface] = useState<HTMLElement | null>(null)
  const surfaceRef = useMemo(() => ({ current: surface }), [surface])
  const visible = useRouteActivityBlock()
  useReadingAttentionBlock(surface ? path : null, visible, { surfaceRef, title, source: 'working-app' })
  return setSurface
}
