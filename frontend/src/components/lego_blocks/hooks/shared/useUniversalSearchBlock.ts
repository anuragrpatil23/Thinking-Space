import { useCallback, useEffect, useMemo, useState } from 'react'
import { rankFuzzyItemsBlock } from '@/services/lego_blocks/units/fuzzySearchBlock'

export interface UseUniversalSearchBlockOptions<T> {
  items: T[]
  query: string
  getCandidates: (item: T) => string | string[]
  /** Optional additive rank boost (e.g. recency) — see rankFuzzyItemsBlock. */
  getBoost?: (item: T) => number
  limit?: number
  onSelect: (item: T) => void
  allowCustomValue?: boolean
  onSelectCustomValue?: (value: string) => void
}

export interface UseUniversalSearchBlockResult<T> {
  filteredItems: T[]
  highlightIndex: number
  setHighlightIndex: (index: number) => void
  selectItem: (item: T) => void
  selectHighlighted: () => boolean
  moveHighlightUp: () => void
  moveHighlightDown: () => void
  /**
   * Convenience: handles ArrowUp/ArrowDown/Enter. Returns true if the event was consumed,
   * letting callers fall through (e.g. for Escape) when false.
   */
  handleKeyboardNav: (e: React.KeyboardEvent) => boolean
}

export function useUniversalSearchBlock<T>({
  items,
  query,
  getCandidates,
  getBoost,
  limit = 50,
  onSelect,
  allowCustomValue,
  onSelectCustomValue,
}: UseUniversalSearchBlockOptions<T>): UseUniversalSearchBlockResult<T> {
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const filteredItems = useMemo<T[]>(() => {
    const trimmed = query.trim()
    if (!trimmed) return items.slice(0, limit)
    const ranked = rankFuzzyItemsBlock<T>({
      items,
      query: trimmed,
      limit,
      getCandidates,
      getBoost,
    })
    return ranked.map(r => r.item)
  }, [items, query, limit, getCandidates, getBoost])

  useEffect(() => {
    if (filteredItems.length === 0) {
      setHighlightIndex(-1)
      return
    }
    setHighlightIndex(prev => {
      if (prev >= 0 && prev < filteredItems.length) return prev
      return 0
    })
  }, [filteredItems.length, query])

  const selectItem = useCallback(
    (item: T) => {
      onSelect(item)
    },
    [onSelect],
  )

  const moveHighlightUp = useCallback(() => {
    setHighlightIndex(prev => {
      if (filteredItems.length === 0) return -1
      const next = prev - 1
      return next < 0 ? filteredItems.length - 1 : next
    })
  }, [filteredItems.length])

  const moveHighlightDown = useCallback(() => {
    setHighlightIndex(prev => {
      if (filteredItems.length === 0) return -1
      const next = prev + 1
      return next >= filteredItems.length ? 0 : next
    })
  }, [filteredItems.length])

  const selectHighlighted = useCallback((): boolean => {
    if (highlightIndex >= 0 && highlightIndex < filteredItems.length) {
      selectItem(filteredItems[highlightIndex])
      return true
    }
    if (allowCustomValue) {
      const trimmed = query.trim()
      if (trimmed) {
        onSelectCustomValue?.(trimmed)
        return true
      }
    }
    return false
  }, [allowCustomValue, filteredItems, highlightIndex, onSelectCustomValue, query, selectItem])

  const handleKeyboardNav = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveHighlightDown()
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveHighlightUp()
        return true
      }
      if (e.key === 'Enter') {
        const handled = selectHighlighted()
        if (handled) e.preventDefault()
        return handled
      }
      return false
    },
    [moveHighlightDown, moveHighlightUp, selectHighlighted],
  )

  return {
    filteredItems,
    highlightIndex,
    setHighlightIndex,
    selectItem,
    selectHighlighted,
    moveHighlightUp,
    moveHighlightDown,
    handleKeyboardNav,
  }
}
