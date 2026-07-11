import { useEffect, useState, type ReactNode, type Ref } from 'react'
import { Search } from 'lucide-react'
import { useUniversalSearchBlock } from '@/components/lego_blocks/hooks/shared/useUniversalSearchBlock'
import { cn } from '@/lib/utils'

type ItemState = {
  highlighted: boolean
  selected: boolean
}

type ItemClassName<T> = string | ((item: T, state: ItemState) => string)

export interface UniversalSearchBlockProps<T> {
  items: T[]
  query: string
  onQueryChange: (value: string) => void
  onSelect: (item: T) => void
  getItemKey: (item: T) => string
  getItemLabel: (item: T) => string
  getItemDescription?: (item: T) => string | undefined
  getItemSearchCandidates?: (item: T) => string[]
  /** Optional additive rank boost (e.g. recency) — see rankFuzzyItemsBlock. */
  getItemRankBoost?: (item: T) => number
  placeholder?: string
  limit?: number
  selectedItemKey?: string | null
  emptyMessage?: string
  showDropdown?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  dismissOnOutsideClick?: boolean
  closeOnSelect?: boolean
  showEmptyStateWhenOpen?: boolean
  allowCustomValue?: boolean
  onSelectCustomValue?: (value: string) => void
  onEscapeKeyDown?: () => void
  inputRef?: Ref<HTMLInputElement>
  disabled?: boolean
  className?: string
  inputWrapperClassName?: string
  inputClassName?: string
  dropdownClassName?: string
  listClassName?: string
  emptyClassName?: string
  itemClassName?: ItemClassName<T>
  renderItem?: (item: T, state: ItemState) => ReactNode
}

function resolveItemClassName<T>(item: T, state: ItemState, className: ItemClassName<T> | undefined): string {
  if (!className) return ''
  if (typeof className === 'function') return className(item, state)
  return className
}

export default function UniversalSearchBlock<T>({
  items,
  query,
  onQueryChange,
  onSelect,
  getItemKey,
  getItemLabel,
  getItemDescription,
  getItemSearchCandidates,
  getItemRankBoost,
  placeholder = 'Search...',
  limit = 50,
  selectedItemKey = null,
  emptyMessage = 'No matches found.',
  showDropdown = true,
  open,
  onOpenChange,
  dismissOnOutsideClick = true,
  closeOnSelect = true,
  showEmptyStateWhenOpen = true,
  allowCustomValue = false,
  onSelectCustomValue,
  onEscapeKeyDown,
  inputRef,
  disabled = false,
  className,
  inputWrapperClassName,
  inputClassName,
  dropdownClassName,
  listClassName,
  emptyClassName,
  itemClassName,
  renderItem,
}: UniversalSearchBlockProps<T>) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = typeof open === 'boolean' ? open : internalOpen

  const setOpen = (next: boolean) => {
    if (typeof open !== 'boolean') setInternalOpen(next)
    onOpenChange?.(next)
  }

  const search = useUniversalSearchBlock<T>({
    items,
    query,
    limit,
    onSelect: (item) => {
      if (disabled) return
      onSelect(item)
      if (closeOnSelect) setOpen(false)
    },
    allowCustomValue,
    onSelectCustomValue: (value) => {
      onSelectCustomValue?.(value)
      setOpen(false)
    },
    getCandidates: item => getItemSearchCandidates?.(item) ?? [
      getItemLabel(item),
      getItemDescription?.(item) ?? '',
    ],
    getBoost: getItemRankBoost,
  })
  const { filteredItems, highlightIndex, setHighlightIndex, selectItem } = search

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      return
    }
  }, [disabled])

  useEffect(() => {
    if (!isOpen) setHighlightIndex(-1)
  }, [isOpen, setHighlightIndex])

  return (
    <div className={cn('relative', className)}>
      <div className={cn('relative', inputWrapperClassName)}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={query}
          onChange={(event) => {
            if (disabled) return
            onQueryChange(event.target.value)
            if (!isOpen) setOpen(true)
          }}
          onFocus={() => {
            if (disabled) return
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (disabled) return
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              onEscapeKeyDown?.()
              return
            }
            if (!isOpen) return
            search.handleKeyboardNav(event)
          }}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            disabled && 'cursor-not-allowed opacity-60',
            inputClassName,
          )}
        />
      </div>

      {showDropdown && !disabled && isOpen && (filteredItems.length > 0 || showEmptyStateWhenOpen) && (
        <div className={cn('absolute z-50 mt-1 w-full overflow-hidden rounded-lg border bg-background shadow-lg', dropdownClassName)}>
          {filteredItems.length > 0 ? (
            <div className={cn('max-h-64 overflow-auto', listClassName)}>
              {filteredItems.map((item, index) => {
                const key = getItemKey(item)
                const state: ItemState = {
                  highlighted: index === highlightIndex,
                  selected: !!selectedItemKey && selectedItemKey === key,
                }
                return (
                  <button
                    key={key}
                    type="button"
                    onMouseEnter={() => setHighlightIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectItem(item)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm transition-colors',
                      state.highlighted || state.selected ? 'bg-accent' : 'hover:bg-accent',
                      resolveItemClassName(item, state, itemClassName),
                    )}
                  >
                    {renderItem ? renderItem(item, state) : (
                      <div className="min-w-0">
                        <div className="truncate">{getItemLabel(item)}</div>
                        {getItemDescription && getItemDescription(item) && (
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {getItemDescription(item)}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className={cn('px-3 py-3 text-sm text-muted-foreground', emptyClassName)}>
              {emptyMessage}
            </div>
          )}
        </div>
      )}

      {showDropdown && dismissOnOutsideClick && isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  )
}
