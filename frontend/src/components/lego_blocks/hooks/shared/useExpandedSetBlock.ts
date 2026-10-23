import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * localStorage-backed Set<string> for tracking expanded IDs in sidebar panels.
 * Collapsed by default unless `defaultIds` is provided.
 *
 * Performance: debounces localStorage writes to avoid blocking the main thread
 * on rapid toggle sequences (e.g., expand/collapse spam).
 */
export function useExpandedSetBlock(
  storageKey: string,
  defaultIds?: Iterable<string>,
): {
  expanded: Set<string>
  isExpanded: (id: string) => boolean
  toggle: (id: string) => void
  /** Replace the whole set (expand all / collapse all). */
  setAll: (ids: Iterable<string>) => void
} {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return new Set(JSON.parse(saved) as string[])
    } catch { /* ignore */ }
    return defaultIds ? new Set(defaultIds) : new Set()
  })

  // Debounce localStorage writes — 500ms after last change instead of on every toggle
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    writeTimerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]))
    }, 500)
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    }
  }, [storageKey, expanded])

  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded])

  const setAll = useCallback((ids: Iterable<string>) => setExpanded(new Set(ids)), [])

  return { expanded, isExpanded, toggle, setAll }
}
