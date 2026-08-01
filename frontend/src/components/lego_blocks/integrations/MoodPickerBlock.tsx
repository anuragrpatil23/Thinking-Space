import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { HOW_WE_FEEL, type EmotionItem, type EmotionColor } from '@/data/howWeFeel'
import { cn } from '@/lib/utils'

// Emotion picker, as a popover under its title-bar button.
//
// This started as a full-surface quadrant + bubble-field copy of How We Feel.
// It did not survive contact: 80 identically-coloured circles is a wall, not a
// choice, and blowing the whole window away to tag a feeling is a bigger
// interruption than the act deserves (2026-07-31). What actually helps is
// reading the words, so this is a list — colour narrows it, text carries it.

/** The mood meter's axes. The data file only carries a colour, so the reading
 *  of each colour lives here — it is presentation, not data. */
const QUADRANTS_BLOCK: {
  color: EmotionColor
  energy: string
  pleasantness: string
  dot: string
}[] = [
  {
    color: 'Red',
    energy: 'High energy',
    pleasantness: 'Unpleasant',
    dot: 'bg-red-400',
  },
  {
    color: 'Yellow',
    energy: 'High energy',
    pleasantness: 'Pleasant',
    dot: 'bg-amber-400',
  },
  {
    color: 'Blue',
    energy: 'Low energy',
    pleasantness: 'Unpleasant',
    dot: 'bg-blue-400',
  },
  {
    color: 'Green',
    energy: 'Low energy',
    pleasantness: 'Pleasant',
    dot: 'bg-emerald-400',
  },
]

const QUADRANT_BY_COLOR_BLOCK = new Map(QUADRANTS_BLOCK.map(entry => [entry.color, entry]))

/** Solid colour for a feeling, for callers showing mood without opening the
 *  picker — the title-bar dot. `undefined` when nothing is picked or the label
 *  is unknown, so the caller renders its own empty state. */
export function moodDotClassForLabelBlock(label: string | undefined): string | undefined {
  if (!label) return undefined
  const item = HOW_WE_FEEL.find(entry => entry.label === label)
  return item ? QUADRANT_BY_COLOR_BLOCK.get(item.colorGroup)?.dot : undefined
}

export interface MoodPickerBlockProps {
  selected: string[]
  onChange: (next: string[]) => void
  onClose: () => void
}

export default function MoodPickerBlock({ selected, onChange, onClose }: MoodPickerBlockProps) {
  const [quadrant, setQuadrant] = useState<EmotionColor | null>(null)
  const [query, setQuery] = useState('')
  const [justPicked, setJustPicked] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return HOW_WE_FEEL.filter((item) => {
      if (quadrant && item.colorGroup !== quadrant) return false
      if (!needle) return true
      return item.label.toLowerCase().includes(needle)
        || item.definition.toLowerCase().includes(needle)
    })
  }, [quadrant, query])

  const toggle = (item: EmotionItem) => {
    if (selected.includes(item.label)) {
      onChange(selected.filter(label => label !== item.label))
      setJustPicked(null)
      return
    }
    onChange([...selected, item.label])
    setJustPicked(item.label)
  }

  return (
    // Roomy on purpose: definitions are the point of the list, and at 26rem the
    // longer ones were truncating on nearly every row.
    <div className="flex max-h-[min(38rem,78vh)] w-[min(34rem,calc(100vw-2rem))] flex-col">
      {/* --- selections --- */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border/50 p-3">
          {selected.map((label) => {
            const dot = moodDotClassForLabelBlock(label)
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange(selected.filter(entry => entry !== label))}
                title={`Remove ${label}`}
                className="ltm-tag-pop ltm-motion-fast inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs transition-colors hover:border-foreground/30"
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
                {label}
                <X className="h-2.5 w-2.5 opacity-40" />
              </button>
            )
          })}
        </div>
      )}

      {/* --- search --- */}
      <div className="p-3 pb-2">
        {/* The icon is positioned against the input, not the padded wrapper —
            the wrapper's uneven top/bottom padding would throw `top-1/2` off. */}
        <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            // Escape clears the search before it closes — losing the popover to
            // a stray key would discard what you just typed.
            if (query) setQuery('')
            else onClose()
          }}
          placeholder="How do you feel?"
          aria-label="Search feelings"
          className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2.5 text-xs outline-none transition-colors focus:border-foreground/30"
        />
        </div>
      </div>

      {/* --- quadrant ---
          The mood meter itself, in miniature: a real 2×2 with energy on the
          vertical axis and pleasantness on the horizontal, each cell a dot and
          its name. The row of bare circles this replaced needed a hover to say
          what any of them meant (2026-07-31), and the row before that spent a
          quarter of the panel on four boxes. Dot plus label, in the same
          dot-then-word rhythm as the list below. Clicking the active cell clears
          back to all feelings. */}
      {/* Centred as a block (`w-fit` + `mx-auto`), not per cell: centring each
          cell's contents inside a stretched column would stagger the dots row to
          row, and the four dots lining up is what makes it read as a quadrant. */}
      <div className="mx-auto grid w-fit grid-cols-2 gap-x-5 gap-y-0.5 px-3 pb-4 pt-1">
        {QUADRANTS_BLOCK.map((entry) => {
          const active = quadrant === entry.color
          return (
            <button
              key={entry.color}
              type="button"
              onClick={() => setQuadrant(active ? null : entry.color)}
              aria-pressed={active}
              className={cn(
                'ltm-motion-fast group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                active ? 'bg-muted' : 'hover:bg-muted/50',
              )}
            >
              {/* Bigger than the list's dots on purpose — these four are the
                  legend for every dot below, so they read as the key. */}
              <span
                className={cn(
                  'ltm-motion-fast h-4 w-4 shrink-0 rounded-full transition-transform group-hover:scale-110',
                  entry.dot,
                  !active && 'opacity-70',
                )}
              />
              <span
                className={cn(
                  'truncate text-[11px] transition-colors',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {entry.energy} · {entry.pleasantness}
              </span>
            </button>
          )
        })}
      </div>

      {/* --- the list --- */}
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5">
        {visible.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            Nothing matches “{query.trim()}”.
          </div>
        ) : visible.map((item) => {
          const entry = QUADRANT_BY_COLOR_BLOCK.get(item.colorGroup)
          const isSelected = selected.includes(item.label)
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => toggle(item)}
              className={cn(
                // Table, not a flex row: the words vary from "Sad" to
                // "Apprehensive", so a flex row started every definition at a
                // different x and the second column zig-zagged down the page.
                // Fixed first column means both are scannable straight down.
                'ltm-motion-fast group grid w-full grid-cols-[1rem_7.5rem_1fr_1rem] items-baseline gap-x-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                isSelected ? 'bg-muted' : 'hover:bg-muted/60',
                justPicked === item.label && 'ltm-bubble-pop',
              )}
            >
              <span className={cn('h-2 w-2 translate-y-[1px] rounded-full transition-transform group-hover:scale-125', entry?.dot)} />
              <span className="truncate text-xs font-medium text-foreground">{item.label}</span>
              {/* The definition is the reason this is a list rather than a grid
                  of identical circles — dimmed so it reads as support, never
                  competing with the word itself. */}
              <span className="truncate text-[11px] text-muted-foreground/70">
                {item.definition}
              </span>
              {isSelected
                ? <Check className="h-3 w-3 translate-y-[2px] text-foreground" />
                : <span />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
